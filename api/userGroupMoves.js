import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { GroupAccessError } from './authorization.js'
import { getEventGroupId, getUserGroupId, isDeveloper, normalizeGroupUser } from './groups.js'
import { sanitizeIdArray, sanitizeUserId } from './dataModel.js'
import { lockGroups, revisionFilter, runGroupTransaction } from './groupTransactions.js'
import { writeAudit } from './audit.js'

const PREVIEW_LIFETIME = 10 * 60 * 1000
const GROUP_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/
const ID_FIELDS = ['participants', 'opkomstmakerIds', 'schoonmakerIds']
function invalid(message, status = 400) { throw new GroupAccessError(message, status) }
function hasUser(event, id) {
  return ID_FIELDS.some(field => sanitizeIdArray(event[field]).includes(id)) || Object.hasOwn(event.attendance || {}, id)
}
function streepje(event, id) {
  if (!event.isOpkomst || !Object.hasOwn(event.attendance || {}, id)) return 0
  const value = event.attendance[id]
  return Number(sanitizeIdArray(event.participants).includes(id) !== Boolean(value && typeof value === 'object' ? value.present : value))
}
function canonical(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

export function planUserGroupMove({ user, groups, events, destinationGroupId, now = new Date() }) {
  if (!user) invalid('Gebruiker niet gevonden', 404)
  if (isDeveloper(user)) invalid('Developer-accounts horen niet bij een groep')
  if (typeof destinationGroupId !== 'string' || !GROUP_KEY.test(destinationGroupId)) invalid('Ongeldige bestemmingsgroep')
  const normalized = normalizeGroupUser(user)
  const source = groups.find(group => group.id === normalized.groupId)
  const destination = groups.find(group => group.id === destinationGroupId)
  if (!source || !destination) invalid('Groep niet gevonden', 404)
  if (source.id === destination.id) invalid('Kies een andere groep')
  if (source.status !== 'active' || destination.status !== 'active') invalid('Heractiveer de bron- en bestemmingsgroep voordat je verplaatst', 403)
  const changes = []
  const history = []
  let destinationOpkomsten = 0
  let futureAssignments = 0
  for (const event of events) {
    const groupId = getEventGroupId(event)
    const containsUser = hasUser(event, user.id)
    if (containsUser && groupId !== source.id) invalid('Er bestaan verwijzingen buiten de huidige groep. Herstel deze eerst.', 409)
    const startsAt = new Date(event.start)
    if (groupId === source.id && containsUser) {
      if (Number.isNaN(startsAt.getTime())) invalid('Een gekoppeld evenement heeft een ongeldige startdatum', 409)
      const future = startsAt > now
      const before = Object.fromEntries(ID_FIELDS.map(field => [field, sanitizeIdArray(event[field]).includes(user.id) ? [user.id] : []]))
      if (Object.hasOwn(event.attendance || {}, user.id)) before.attendance = { [user.id]: event.attendance[user.id] }
      // Archive this user's original references/attendance only; other members'
      // data remains on the event and does not need duplication in the archive.
      history.push({ eventId: event.id, title: event.title, start: event.start, end: event.end, allDay: Boolean(event.allDay),
        isOpkomst: Boolean(event.isOpkomst), future, references: before, streepjes: streepje(event, user.id) })
      const fields = Object.fromEntries(ID_FIELDS.filter(field => Object.hasOwn(event, field))
        .map(field => [field, sanitizeIdArray(event[field]).filter(id => id !== user.id)]))
      if (Object.hasOwn(event, 'attendance')) fields.attendance = Object.fromEntries(Object.entries(event.attendance || {}).filter(([id]) => Number(id) !== user.id))
      // Preserve past maker display without reintroducing account references.
      if (!future) for (const [ids, names] of [['opkomstmakerIds', 'legacyOpkomstmakerNames'], ['schoonmakerIds', 'legacySchoonmakerNames']]) {
        if (sanitizeIdArray(event[ids]).includes(user.id)) fields[names] = [...new Set([...(event[names] || []), normalized.firstName])]
      }
      if (future && (sanitizeIdArray(event.opkomstmakerIds).includes(user.id) || sanitizeIdArray(event.schoonmakerIds).includes(user.id))) futureAssignments++
      changes.push({ event, fields })
    } else if (groupId === destination.id && event.isOpkomst && startsAt > now && normalized.status === 'active') {
      changes.push({ event, fields: { participants: [...sanitizeIdArray(event.participants), user.id].sort((a, b) => a - b) } })
      destinationOpkomsten++
    }
  }
  const summary = { sourceGroupId: source.id, destinationGroupId: destination.id, status: normalized.status,
    previousRole: normalized.role, role: 'user', archivedEvents: history.length,
    archivedStreepjes: history.reduce((total, item) => total + item.streepjes, 0), futureAssignments, destinationOpkomsten }
  // Full record snapshots detect password/status/attendance/title changes too;
  // neither the digest nor preview response includes credentials.
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ user, source, destination,
    events: events.filter(event => [source.id, destination.id].includes(getEventGroupId(event))).sort((a, b) => String(a.id).localeCompare(String(b.id))) }))).digest('hex')
  return { user: normalized, source, destination, changes, history, summary, fingerprint }
}

function sign(payload, secret) { return createHmac('sha256', secret).update(payload).digest('base64url') }
export function makeMovePreviewToken(plan, actorId, secret, now = new Date()) {
  const payload = Buffer.from(JSON.stringify({ userId: plan.user.id, actorId, destinationGroupId: plan.destination.id,
    fingerprint: plan.fingerprint, cutoff: now.toISOString(), expiresAt: now.getTime() + PREVIEW_LIFETIME })).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}
function readToken(token, secret, now) {
  if (typeof token !== 'string' || token.length > 2048) invalid('Bekijk eerst de gevolgen van deze verplaatsing', 400)
  const [payload, signature, extra] = token.split('.')
  const expected = sign(payload || '', secret)
  if (extra || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) invalid('Ongeldige verplaatsingspreview', 400)
  let data
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { invalid('Ongeldige verplaatsingspreview', 400) }
  if (!Number.isFinite(data.expiresAt) || data.expiresAt <= now.getTime()) invalid('Deze preview is verlopen. Bekijk de gevolgen opnieuw.', 409)
  return data
}

async function readMoveData(db, session, userId, destinationGroupId) {
  const user = await db.collection('users').findOne({ id: userId }, { session })
  const groups = await db.collection('groups').find({}, { session }).toArray()
  const events = await db.collection('events').find({}, { session }).toArray()
  return { user, groups, events, destinationGroupId }
}
async function requireDeveloper(db, session, actorId) {
  if (!isDeveloper(await db.collection('users').findOne({ id: actorId }, { session }))) invalid('Alleen developers kunnen gebruikers verplaatsen', 403)
}
export async function previewUserGroupMove(client, db, { userId, destinationGroupId, actorId, secret, now = new Date() }) {
  if (sanitizeUserId(userId) === null) invalid('Ongeldig gebruikers-ID')
  return runGroupTransaction(client, async session => {
    await requireDeveloper(db, session, actorId)
    const plan = planUserGroupMove({ ...await readMoveData(db, session, userId, destinationGroupId), now })
    return { summary: plan.summary, previewToken: makeMovePreviewToken(plan, actorId, secret, now) }
  })
}
export async function applyUserGroupMove(client, db, { userId, destinationGroupId, actorId, previewToken, secret, now = new Date() }) {
  const token = readToken(previewToken, secret, now)
  if (token.userId !== userId || token.actorId !== actorId || token.destinationGroupId !== destinationGroupId) invalid('Deze preview hoort bij een andere verplaatsing', 400)
  return runGroupTransaction(client, async session => {
    await requireDeveloper(db, session, actorId)
    const input = await readMoveData(db, session, userId, destinationGroupId)
    if (input.events.some(event => [getUserGroupId(input.user), destinationGroupId].includes(getEventGroupId(event))
      && new Date(event.start) > new Date(token.cutoff) && new Date(event.start) <= now)) {
      invalid('Een evenement is gestart sinds de preview. Bekijk de gevolgen opnieuw.', 409)
    }
    const plan = planUserGroupMove({ ...input, now: new Date(token.cutoff) })
    if (plan.fingerprint !== token.fingerprint) invalid('Gegevens zijn veranderd sinds de preview. Bekijk de gevolgen opnieuw.', 409)
    await lockGroups(db, session, [plan.source.id, plan.destination.id])
    const moveId = randomUUID()
    const archive = { id: moveId, userId, groupId: plan.source.id, destinationGroupId,
      name: `${plan.user.firstName} ${plan.user.lastName}`.trim(), movedAt: now, actorId,
      previousRole: plan.user.role, status: plan.user.status, streepjes: plan.summary.archivedStreepjes, events: plan.history }
    await db.collection('userGroupHistory').insertOne(archive, { session })
    for (const { event, fields } of plan.changes) {
      const result = await db.collection('events').updateOne(revisionFilter(event), { $set: { ...fields, groupId: getEventGroupId(event), _revision: (event._revision || 0) + 1 } }, { session })
      if (!result.matchedCount) invalid('Een evenement is ondertussen gewijzigd', 409)
    }
    const user = { ...plan.user, groupId: destinationGroupId, role: 'user', isAdmin: false, isDeveloper: false,
      _revision: (input.user._revision || 0) + 1, sessionVersion: (input.user.sessionVersion || 0) + 1 }
    delete user._id
    const result = await db.collection('users').updateOne(revisionFilter(input.user), { $set: user }, { session })
    if (!result.matchedCount) invalid('Deze gebruiker is ondertussen gewijzigd', 409)
    await db.collection('sessions').updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } }, { session })
    await writeAudit(db, { action: 'user-group-moved', actor: { id: actorId, role: 'developer' }, groupId: plan.source.id,
      destinationGroupId, collection: 'users', targetId: userId, changedFields: ['groupId', 'role', 'sessions', 'eventReferences'] }, session)
    return { user, moveId, summary: plan.summary }
  })
}

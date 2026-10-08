import express from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { GroupAccessError, resolveRequestGroupId } from './authorization.js'
import { getEventGroupId, getUserGroupId, isDeveloper } from './groups.js'
import { recordFingerprint } from './audit.js'
import { mapGroupForClient, persistGroupSettings, validateGroupInput } from './groupManagement.js'
import { buildUserUpdate, mapManagedUser } from './userManagement.js'
import { EVENT_EDIT_FIELDS, validateEventInput } from './eventManagement.js'
import { sanitizeIdArray } from './dataModel.js'
import { membershipMode, mapMembership } from './memberships.js'

export const DATABASE_COLLECTIONS = ['groups', 'users', 'events', 'userGroupHistory', 'auditLogs', 'sessions', 'resetCodes', 'groupMemberships', 'groupMembershipHistory']
const EDIT_FIELDS = { users: ['firstName', 'lastName', 'email', 'role', 'status'], events: EVENT_EDIT_FIELDS, groups: ['name', 'slug', 'status', 'settings'] }
function pick(record, fields) { return Object.fromEntries(fields.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]])) }
export function mapDatabaseRecord(collection, record) {
  if (collection === 'groupMemberships') return mapMembership(record)
  if (collection === 'groupMembershipHistory') return pick(record, ['id', 'membershipId', 'userId', 'groupId', 'action', 'timestamp', 'actorId', 'state', 'previousState', 'role', 'status', 'previousRole', 'previousStatus', 'periods', 'migrationAccessCutoff'])
  if (collection === 'groups') return mapGroupForClient(record)
  if (collection === 'users') return mapManagedUser(record)
  if (collection === 'events') return { ...pick(record, ['id', ...EVENT_EDIT_FIELDS]), groupId: getEventGroupId(record),
    ...Object.fromEntries(['participants', 'opkomstmakerIds', 'schoonmakerIds'].map(field => [field, sanitizeIdArray(record[field])])),
    ...Object.fromEntries(['schoonmaakOptions', 'legacyOpkomstmakerNames', 'legacySchoonmakerNames'].map(field => [field, Array.isArray(record[field]) ? record[field].filter(value => typeof value === 'string') : []])),
    attendance: Object.fromEntries(Object.entries(record.attendance || {}).map(([id, value]) => [id, Boolean(value?.present ?? value)])) }
  if (collection === 'auditLogs') return pick(record, ['id', 'timestamp', 'action', 'actorId', 'actorRole', 'groupId', 'destinationGroupId', 'collection', 'targetId', 'changedFields'])
  if (collection === 'sessions') return pick(record, ['sessionId', 'userId', 'createdAt', 'expiresAt', 'lastSeenAt', 'revokedAt'])
  if (collection === 'resetCodes') return pick(record, ['email', 'createdAt', 'expiresAt'])
  if (collection === 'userGroupHistory') return { ...pick(record, ['id', 'userId', 'groupId', 'destinationGroupId', 'name', 'movedAt', 'actorId', 'previousRole', 'status', 'streepjes']), events: (record.events || []).map(event => ({ ...pick(event, ['eventId', 'title', 'start', 'end', 'allDay', 'isOpkomst', 'future', 'streepjes']),
    participant: (event.references?.participants || []).includes(record.userId), opkomstmaker: (event.references?.opkomstmakerIds || []).includes(record.userId), schoonmaker: (event.references?.schoonmakerIds || []).includes(record.userId),
    attendance: Object.hasOwn(event.references?.attendance || {}, record.userId) ? Boolean(event.references.attendance[record.userId]?.present ?? event.references.attendance[record.userId]) : null })) }
  throw new GroupAccessError('Onbekende collectie', 400)
}
export function editableDatabaseRecord(collection, record) {
  if (!EDIT_FIELDS[collection] || (collection === 'users' && isDeveloper(record))) return null
  const safe = mapDatabaseRecord(collection, record)
  return pick(safe, EDIT_FIELDS[collection])
}
function signature(payload, secret) { return createHmac('sha256', secret).update(payload).digest('base64url') }
export function signRecordPreview(data, secret) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  return `${payload}.${signature(payload, secret)}`
}
export function readRecordPreview(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) throw new GroupAccessError('Bekijk eerst de wijziging', 400)
  const [payload, signed, extra] = token.split('.')
  const expected = signature(payload || '', secret)
  if (extra || !signed || !/^[A-Za-z0-9_-]{43}$/.test(signed) || !timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) throw new GroupAccessError('Ongeldige preview', 400)
  let data
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { throw new GroupAccessError('Ongeldige preview', 400) }
  if (!Number.isFinite(data.expiresAt) || data.expiresAt <= now) throw new GroupAccessError('Preview verlopen. Bekijk de wijziging opnieuw.', 409)
  return data
}

export function createDatabaseManagementRouter({ requireAuthenticatedUser, getDb, getClient, secret, updateUser, updateEvent }) {
  const router = express.Router()
  router.use(async (req, res, next) => {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return
    if (!isDeveloper(auth.user)) throw new GroupAccessError('Alleen toegankelijk voor developers')
    req.databaseActor = auth.user
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  router.get('/:collection', async (req, res) => {
    const { collection } = req.params
    if (!DATABASE_COLLECTIONS.includes(collection)) throw new GroupAccessError('Onbekende collectie', 400)
    const groupId = resolveRequestGroupId(req, req.databaseActor, { allowAllGroups: true })
    const page = Number(req.query.page || 1)
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new GroupAccessError('Ongeldige pagina', 400)
    const db = await getDb()
    const migrated = await membershipMode(db)
    let filter = {}
    if (groupId) {
      if (collection === 'groups') filter.id = groupId
      else if (['sessions', 'resetCodes'].includes(collection)) {
        const members = await db.collection('users').find(groupId === 'stam-default' ? { $or: [{ groupId }, { groupId: { $exists: false } }] } : { groupId }).toArray()
        const field = collection === 'sessions' ? 'userId' : 'email'
        filter[field] = { $in: members.filter(user => !isDeveloper(user)).map(user => user[collection === 'sessions' ? 'id' : 'email']) }
      } else if (collection === 'auditLogs') filter.$or = [{ groupId }, { destinationGroupId: groupId }]
      else filter = ['users', 'events'].includes(collection) && groupId === 'stam-default' ? { $or: [{ groupId }, { groupId: { $exists: false } }] } : { groupId }
      if (migrated && ['users', 'sessions', 'resetCodes'].includes(collection)) {
        const memberships = await db.collection('groupMemberships').find({ groupId }).toArray()
        const identities = await db.collection('users').find({ id: { $in: memberships.map(m => m.userId) } }).toArray()
        filter = collection === 'users' ? { id: { $in: identities.map(u => u.id) } } : collection === 'sessions' ? { userId: { $in: identities.map(u => u.id) } } : { email: { $in: identities.map(u => u.email) } }
      }
    }
    if (collection === 'auditLogs') {
      if (req.query.action) { if (typeof req.query.action !== 'string' || req.query.action.length > 80) throw new GroupAccessError('Ongeldige actie', 400); filter.action = req.query.action }
      if (req.query.actorId) { const id = Number(req.query.actorId); if (!Number.isSafeInteger(id) || id < 1) throw new GroupAccessError('Ongeldige actor', 400); filter.actorId = id }
    }
    const total = await db.collection(collection).countDocuments(filter)
    const records = await db.collection(collection).find(filter).sort(collection === 'auditLogs' ? { timestamp: -1, id: -1 } : collection === 'userGroupHistory' ? { movedAt: -1, id: -1 } : collection === 'sessions' ? { createdAt: -1, sessionId: 1 } : collection === 'resetCodes' ? { createdAt: -1, email: 1 } : { id: 1 }).skip((page - 1) * 30).limit(30).toArray()
    const groups = ['users', 'events'].includes(collection) ? await db.collection('groups').find({}).toArray() : []
    res.json({ records: records.map(record => ({ record: mapDatabaseRecord(collection, record), editable: migrated && collection === 'users' ? pick(record, ['firstName', 'lastName', 'email']) : ['users', 'events'].includes(collection) && groups.find(group => group.id === (collection === 'users' ? getUserGroupId(record) : getEventGroupId(record)))?.status !== 'active' ? null : editableDatabaseRecord(collection, record) })), total, page, pages: Math.max(1, Math.ceil(total / 30)) })
  })
  router.post('/:collection/:id/preview', async (req, res) => {
    const { collection } = req.params
    if (!EDIT_FIELDS[collection]) throw new GroupAccessError('Deze collectie is alleen leesbaar', 400)
    const id = collection === 'users' ? Number(req.params.id) : req.params.id
    const db = await getDb()
    const current = await db.collection(collection).findOne({ id })
    if (!current) throw new GroupAccessError('Record niet gevonden', 404)
    if (!editableDatabaseRecord(collection, current)) throw new GroupAccessError('Dit record is alleen leesbaar', 400)
    const migrated = await membershipMode(db)
    if (migrated && collection === 'users' && Object.keys(req.body).some(key => !['firstName', 'lastName', 'email'].includes(key))) throw new GroupAccessError('Rollen en statussen worden via lidmaatschappen beheerd', 400)
    if (collection !== 'groups' && !(migrated && collection === 'users')) {
      const groupId = collection === 'users' ? getUserGroupId(current) : getEventGroupId(current)
      const group = await db.collection('groups').findOne({ id: groupId })
      if (group?.status !== 'active') throw new GroupAccessError('Groep is gearchiveerd')
    }
    let next
    if (collection === 'users') next = buildUserUpdate(req.databaseActor, current, req.body)
    else if (collection === 'groups') { const patch = validateGroupInput(req.body); next = { ...current, ...patch, settings: { ...current.settings, ...patch.settings } } }
    else {
      const identities = await db.collection('users').find({}).toArray()
      if (migrated) {
        const memberships = await db.collection('groupMemberships').find({}).toArray()
        for (const user of identities) user.memberships = memberships.filter(m => m.userId === user.id)
      }
      validateEventInput(current, req.body, identities); next = { ...current, ...req.body }
    }
    const before = editableDatabaseRecord(collection, current)
    const after = editableDatabaseRecord(collection, next)
    const changedFields = Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    if (!changedFields.length) throw new GroupAccessError('Geen wijzigingen gevonden', 400)
    res.json({ before, after, changedFields, previewToken: signRecordPreview({ collection, id, actorId: req.databaseActor.id,
      fingerprint: recordFingerprint(current), patchFingerprint: recordFingerprint(req.body), expiresAt: Date.now() + 10 * 60 * 1000 }, secret) })
  })
  router.patch('/:collection/:id', async (req, res) => {
    const { collection } = req.params
    const id = collection === 'users' ? Number(req.params.id) : req.params.id
    if (!req.body || Object.keys(req.body).some(key => !['patch', 'previewToken'].includes(key))) throw new GroupAccessError('Ongeldige bevestiging', 400)
    if (!req.body.patch || typeof req.body.patch !== 'object' || Array.isArray(req.body.patch)) throw new GroupAccessError('Wijzigingen ontbreken', 400)
    const token = readRecordPreview(req.body.previewToken, secret)
    if (token.collection !== collection || token.id !== id || token.actorId !== req.databaseActor.id || token.patchFingerprint !== recordFingerprint(req.body.patch)) throw new GroupAccessError('Preview hoort bij andere gegevens', 400)
    const patch = req.body.patch
    if (collection === 'groups') {
      const group = await persistGroupSettings(await getClient(), await getDb(), id, patch, req.databaseActor, { expectedFingerprint: token.fingerprint })
      return res.json({ group: mapGroupForClient(group) })
    }
    // Reuse regular endpoints, including live actor, group, uniqueness, status,
    // session revocation and transactional reference validation.
    req.body = patch
    if (collection === 'users') return updateUser(req, res, { expectedFingerprint: token.fingerprint })
    if (collection === 'events') return updateEvent(req, res, { expectedFingerprint: token.fingerprint })
    throw new GroupAccessError('Deze collectie is alleen leesbaar', 400)
  })
  return router
}

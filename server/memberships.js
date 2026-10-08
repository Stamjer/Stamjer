import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { isDeveloper } from '../shared/roles.js'
import { GroupAccessError, canManageGroup } from './authorization.js'
import { lockGroups, revisionFilter, runGroupTransaction } from './groupTransactions.js'
import { recordFingerprint, writeAudit } from './audit.js'
import { sanitizeIdArray } from './dataModel.js'

export const MEMBERSHIP_SCHEMA = 'multi-group-v2'
export const MEMBERSHIP_INDEXES = {
  groupMemberships: [
    [{ id: 1 }, { unique: true, name: 'membership_id_unique' }],
    [{ userId: 1, groupId: 1 }, { unique: true, name: 'membership_user_group_unique' }],
    [{ groupId: 1, state: 1 }, { name: 'membership_group_state' }]
  ],
  groupMembershipHistory: [[{ id: 1 }, { unique: true, name: 'membership_history_id' }]],
  paymentRequests: [
    [{ id: 1 }, { unique: true, name: 'payment_request_id' }],
    [{ userId: 1, groupId: 1, requestKey: 1 }, { unique: true, name: 'payment_request_retry' }],
    [{ userId: 1, groupId: 1, submittedAt: -1 }, { name: 'payment_request_history' }]
  ],
  paymentRequestFiles: [[{ requestId: 1, id: 1 }, { unique: true, name: 'payment_file_id' }]],
  counters: [[{ id: 1 }, { unique: true, name: 'counter_id' }]],
  schemaMigrations: [[{ id: 1 }, { unique: true, name: 'schema_migration_id' }]]
}

export async function membershipMode(db, session) {
  const schema = await db.collection('schemaMigrations').findOne({ id: MEMBERSHIP_SCHEMA }, { session })
  if (schema && schema.state !== 'complete') throw new GroupAccessError('Lidmaatschapsmigratie is nog niet voltooid.', 503)
  return schema?.state === 'complete'
}

// Date-only and floating dates mean Europe/Amsterdam, regardless of server TZ.
// Reject invalid/ambiguous local times (DST fold/gap) rather than guessing.
export function eventStartInstant(value) {
  if (value instanceof Date) return Number.isFinite(+value) ? +value : null
  if (typeof value !== 'string') return null
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(value)
  if (!match) return null
  const [, y, m, d, h = '00', min = '00', s = '00', ms = '0'] = match
  const wall = Date.UTC(+y, +m - 1, +d, +h, +min, +s, +ms.padEnd(3, '0'))
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const candidates = [1, 2].map(offset => wall - offset * 3600000).filter(instant => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]))
    return parts.year === y && parts.month === m && parts.day === d && parts.hour === h && parts.minute === min && parts.second === s
  })
  return candidates.length === 1 ? candidates[0] : null
}

export function validatePeriods(periods) {
  if (!Array.isArray(periods)) throw new GroupAccessError('Lidmaatschapsperioden ontbreken', 400)
  let previousEnd = -Infinity
  const ids = new Set()
  for (const [index, period] of periods.entries()) {
    const grandfathered = period.joinedAt === null && index === 0 && period.provenance === 'legacy-import'
    const start = grandfathered ? -Infinity : eventStartInstant(period.joinedAt)
    const end = period.endedAt == null ? Infinity : eventStartInstant(period.endedAt)
    if (!period.id || ids.has(period.id) || (!grandfathered && !Number.isFinite(start)) || (end !== Infinity && !Number.isFinite(end)) || !(end > start) || start < previousEnd) throw new GroupAccessError('Ongeldige of overlappende lidmaatschapsperioden', 400)
    ids.add(period.id)
    previousEnd = end
  }
  return true
}

export function validateMembership(membership) {
  if (!['current', 'ended', 'historical'].includes(membership.state) || !['user', 'admin'].includes(membership.role) || !['active', 'inactive'].includes(membership.status)) throw new GroupAccessError('Ongeldige rol, status of lidmaatschap', 400)
  validatePeriods(membership.periods)
  if (membership.state !== 'historical' && (!membership.periods.length || (membership.state === 'current' ? membership.periods.at(-1).endedAt !== null : membership.periods.some(p => p.endedAt === null)))) throw new GroupAccessError('Ongeldige lidmaatschapsgrenzen', 400)
  return true
}

export function canSeeCalendarEvent(membership, event) {
  if (!membership || membership.groupId !== event.groupId || !['current', 'ended'].includes(membership.state)) return false
  const start = eventStartInstant(event.start)
  if (start === null) return false
  return (membership.periods || []).some(period => {
    const joined = period.joinedAt === null && period.provenance === 'legacy-import' && period === membership.periods[0] ? -Infinity : eventStartInstant(period.joinedAt)
    const ended = period.endedAt == null ? Infinity : eventStartInstant(period.endedAt)
    return joined !== null && start >= joined && start < ended
  })
}

export function membershipFor(user, groupId) { return user?.memberships?.find(m => m.groupId === groupId && m.state !== 'historical') || null }
export function scopedUser(user, membership) {
  return { ...user, groupId: membership?.groupId || null, role: isDeveloper(user) ? 'developer' : membership?.state === 'current' ? membership.role : 'user',
    isAdmin: !isDeveloper(user) && membership?.state === 'current' && membership.role === 'admin',
    status: membership?.state === 'ended' ? 'alumni' : membership?.status || 'inactive', membershipId: membership?.id || null, membershipState: membership?.state || null,
    membership: membership || null }
}
export function mapMembership(membership) {
  const { id, userId, groupId, role, status, state, periods, createdAt, updatedAt, _revision, migrationAccessCutoff } = membership
  return { id, userId, groupId, role, status, state, displayStatus: state === 'ended' ? 'alumni' : status, periods, createdAt, updatedAt, _revision, ...(migrationAccessCutoff ? { migrationAccessCutoff } : {}) }
}
export async function liveGroupActor(db, actor, groupId, session) {
  const identity = actor && await db.collection('users').findOne({ id: actor.id }, { session })
  if (!identity) throw new GroupAccessError('Ongeldige sessie', 401)
  if (isDeveloper(identity)) return identity
  const membership = await db.collection('groupMemberships').findOne({ userId: identity.id, groupId }, { session })
  return scopedUser({ ...identity, memberships: membership ? [membership] : [] }, membership)
}

export function newMembership(userId, groupId, { role = 'user', status = 'active', now = new Date() } = {}) {
  if (!['user', 'admin'].includes(role) || !['active', 'inactive'].includes(status)) throw new GroupAccessError('Ongeldige rol of status', 400)
  return { id: randomUUID(), userId, groupId, role, status, state: 'current', periods: [{ id: randomUUID(), joinedAt: now.toISOString(), endedAt: null }],
    calendarTokenVersion: 0, createdAt: now, updatedAt: now, _revision: 1 }
}

export function subscriptionToken(membership, secret) {
  return createHmac('sha256', secret).update(`membership-calendar-v2:${membership.id}:${membership.calendarTokenVersion || 0}`).digest('base64url')
}
export function validSubscriptionToken(membership, token, secret) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(subscriptionToken(membership, secret)))
}

async function history(db, membership, actor, action, previous, session) {
  await db.collection('groupMembershipHistory').insertOne({ id: randomUUID(), membershipId: membership.id, userId: membership.userId, groupId: membership.groupId,
    action, timestamp: membership.updatedAt, actorId: actor.id, periods: membership.periods, role: membership.role, status: membership.status,
    state: membership.state, previousState: previous?.state ?? null, previousRole: previous?.role ?? null, previousStatus: previous?.status ?? null }, { session })
  await writeAudit(db, { actor, action: `membership-${action}`, groupId: membership.groupId, collection: 'groupMemberships', targetId: membership.id,
    changedFields: ['state', 'periods', 'role', 'status'] }, session)
}

export async function updateFuturePlans(db, session, membership, { now = new Date(), removeAssignments = false } = {}) {
  const events = await db.collection('events').find({ groupId: membership.groupId }, { session }).toArray()
  let changed = 0
  for (const event of events) {
    const instant = eventStartInstant(event.start)
    if (instant === null || instant <= +now) continue
    const next = { ...event }
    if (event.isOpkomst) {
      const ids = sanitizeIdArray(event.participants).filter(id => id !== membership.userId)
      if (membership.state === 'current' && membership.status === 'active') ids.push(membership.userId)
      next.participants = [...new Set(ids)].sort((a, b) => a - b)
    }
    if (removeAssignments) for (const field of ['opkomstmakerIds', 'schoonmakerIds']) next[field] = sanitizeIdArray(event[field]).filter(id => id !== membership.userId)
    if (recordFingerprint(next) === recordFingerprint(event)) continue
    delete next._id
    next._revision = (event._revision || 0) + 1
    const result = await db.collection('events').updateOne(revisionFilter(event), { $set: next }, { session })
    if (!result.matchedCount) throw new GroupAccessError('Evenement ondertussen gewijzigd', 409)
    await writeAudit(db, { action: 'membership-future-plans', actor: { id: membership.userId }, groupId: membership.groupId, collection: 'events', targetId: event.id,
      changedFields: ['participants', ...(removeAssignments ? ['opkomstmakerIds', 'schoonmakerIds'] : [])] }, session)
    changed++
  }
  return changed
}

export async function changeMembership(client, db, { actor, userId, email, groupId, membershipId, action, patch = {}, expectedRevision, now = new Date(), previewToken, secret, self = false }) {
  return runGroupTransaction(client, async session => {
    if (!patch || Object.keys(patch).some(key => !['role', 'status'].includes(key))) throw new GroupAccessError('Ongeldige velden', 400)
    const current = membershipId ? await db.collection('groupMemberships').findOne({ id: membershipId }, { session }) : await db.collection('groupMemberships').findOne({ userId, groupId }, { session })
    const gid = current?.groupId || groupId
    await lockGroups(db, session, [gid], { requireActive: action !== 'rotate' })
    const live = await liveGroupActor(db, actor, gid, session)
    const developer = isDeveloper(live)
    const administrator = canManageGroup(live, gid)
    if (!developer && !administrator && !['update', 'rotate'].includes(action)) throw new GroupAccessError('Geen toegang tot dit lidmaatschap')
    const target = await db.collection('users').findOne(email ? { normalizedEmail: email } : { id: current?.userId ?? userId }, { session })
    if (!target || isDeveloper(target)) throw new GroupAccessError('Geen beschikbaar account voor dit lidmaatschap', 404)
    if (!developer && Object.hasOwn(patch, 'role') && patch.role !== 'user') throw new GroupAccessError('Alleen developers kunnen rollen toekennen')
    if (!developer && action === 'update' && Object.hasOwn(patch, 'role')) throw new GroupAccessError('Alleen developers kunnen rollen wijzigen')
    if (!developer && !administrator && !(action === 'update' && self && live.id === target.id && live.membershipState === 'current' && Object.keys(patch).every(key => key === 'status')) && !(action === 'rotate' && live.id === target.id && live.membership)) throw new GroupAccessError('Geen toegang tot dit lidmaatschap')
    if (!developer && live.role !== 'admin' && action === 'update') {
      const group = await db.collection('groups').findOne({ id: gid }, { session })
      if (group.settings?.allowUserSelfAttendance === false || !['active', 'inactive'].includes(patch.status)) throw new GroupAccessError('Zelf aanwezigheid wijzigen is uitgeschakeld')
    }
    if (expectedRevision !== undefined && current?._revision !== expectedRevision) throw new GroupAccessError('Lidmaatschap ondertussen gewijzigd', 409)
    let next
    if (action === 'join') {
      if (current || await db.collection('groupMemberships').findOne({ userId: target.id, groupId: gid }, { session })) throw new GroupAccessError('Lidmaatschap bestaat al; gebruik opnieuw aansluiten', 409)
      next = newMembership(target.id, gid, { ...patch, now })
    } else {
      if (!current || current.state === 'historical') throw new GroupAccessError('Lidmaatschap niet gevonden', 404)
      next = { ...current, periods: structuredClone(current.periods), updatedAt: now, _revision: (current._revision || 0) + 1 }
      if (action === 'end') {
        if (current.state !== 'current') throw new GroupAccessError('Lidmaatschap is al beëindigd', 409)
        const events = await db.collection('events').find({ groupId: gid }, { session }).toArray()
        verifyEndPreview(current, events, live, previewToken, secret, now)
        next.periods.at(-1).endedAt = now.toISOString()
        next.state = 'ended'
      } else if (action === 'rejoin') {
        if (current.state !== 'ended') throw new GroupAccessError('Lidmaatschap is niet beëindigd', 409)
        next.state = 'current'
        next.role = patch.role ?? 'user'
        next.status = patch.status ?? 'active'
        next.periods.push({ id: randomUUID(), joinedAt: now.toISOString(), endedAt: null })
      } else if (action === 'update') {
        if (current.state !== 'current') throw new GroupAccessError('Alumni-lidmaatschap is alleen leesbaar')
        Object.assign(next, patch)
      } else if (action === 'rotate') next.calendarTokenVersion = (current.calendarTokenVersion || 0) + 1
      else throw new GroupAccessError('Ongeldige actie', 400)
      delete next._id
    }
    validateMembership(next)
    if (current?.state === 'current' && current.role === 'admin' && (next.state !== 'current' || next.role !== 'admin')) {
      const administrators = await db.collection('groupMemberships').find({ groupId: gid, state: 'current', role: 'admin' }, { session }).toArray()
      if (administrators.length <= 1 && !developer) throw new GroupAccessError('De laatste beheerder kan alleen door een developer worden verwijderd.')
    }
    if (current) {
      const result = await db.collection('groupMemberships').updateOne(revisionFilter(current), { $set: next }, { session })
      if (!result.matchedCount) throw new GroupAccessError('Lidmaatschap ondertussen gewijzigd', 409)
    } else await db.collection('groupMemberships').insertOne(next, { session })
    const attendanceUpdates = action === 'rotate' ? 0 : await updateFuturePlans(db, session, next, { now, removeAssignments: action === 'end' })
    await history(db, next, live, action, current, session)
    return { membership: mapMembership(next), attendanceUpdates }
  })
}

function endSnapshot(membership, events, now) {
  return { membership, events: events.filter(event => event.groupId === membership.groupId).sort((a, b) => a.id.localeCompare(b.id)),
    future: events.filter(event => event.groupId === membership.groupId && eventStartInstant(event.start) > +now).map(event => event.id).sort() }
}
export function previewMembershipEnd(membership, events, actor, secret, now = new Date()) {
  if (!canManageGroup(actor, membership.groupId) || membership.state !== 'current') throw new GroupAccessError('Alleen beheerders kunnen een lopend lidmaatschap beëindigen')
  const data = { actorId: actor.id, membershipId: membership.id, fingerprint: recordFingerprint(endSnapshot(membership, events, now)), expiresAt: +now + 600000 }
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`membership-end:${payload}`).digest('base64url')
  const futureEvents = events.filter(event => event.groupId === membership.groupId && eventStartInstant(event.start) > +now)
  return { previewToken: `${payload}.${signature}`, summary: { futureEvents: futureEvents.filter(e => ['participants', 'opkomstmakerIds', 'schoonmakerIds'].some(field => sanitizeIdArray(e[field]).includes(membership.userId))).length,
    membershipId: membership.id, groupId: membership.groupId, userId: membership.userId } }
}
function verifyEndPreview(membership, events, actor, token, secret, now) {
  try {
    const [payload, signature, extra] = String(token).split('.')
    const expected = createHmac('sha256', secret).update(`membership-end:${payload}`).digest('base64url')
    if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error()
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (data.actorId !== actor.id || data.membershipId !== membership.id || data.expiresAt <= +now || data.fingerprint !== recordFingerprint(endSnapshot(membership, events, now))) throw new Error()
  } catch { throw new GroupAccessError('Preview verlopen of gegevens gewijzigd. Bekijk de gevolgen opnieuw.', 409) }
}

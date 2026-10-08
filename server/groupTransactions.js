import { GroupAccessError, canManageGroup, canManageUser, getAttendanceAuthorizationError } from './authorization.js'
import { getEventGroupId, getUserGroupId, isDeveloper, normalizeGroupUser } from './groups.js'
import { sanitizeIdArray } from './dataModel.js'
import { recordFingerprint, writeAudit } from './audit.js'
import { membershipMode, liveGroupActor, scopedUser, eventStartInstant, canSeeCalendarEvent, membershipFor } from './memberships.js'
import { recordAttendanceMetadata } from './attendanceScoring.js'

export async function runGroupTransaction(client, work) {
  const session = client.startSession()
  try {
    return await session.withTransaction(() => work(session), {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary'
    })
  } catch (error) {
    if (error.code === 20 || error.codeName === 'IllegalOperation') {
      throw new GroupAccessError('Groepswijzigingen vereisen MongoDB met transacties (replica set of Atlas).', 503)
    }
    throw error
  } finally { await session.endSession() }
}

// Every user/event mutation and move writes this same group document in its
// transaction. This prevents phantom event inserts and stale membership writes
// across API processes, not just concurrent edits to one existing event.
export async function lockGroups(db, session, groupIds, { requireActive = true } = {}) {
  for (const id of [...new Set(groupIds.filter(Boolean))].sort()) {
    const result = await db.collection('groups').updateOne(
      { id, ...(requireActive ? { status: 'active' } : {}) }, { $inc: { mutationVersion: 1 } }, { session }
    )
    if (!result.matchedCount) throw new GroupAccessError('Groep ontbreekt of is gearchiveerd', 403)
  }
}

function conflict() { throw new GroupAccessError('Gegevens zijn ondertussen gewijzigd. Vernieuw de pagina en probeer opnieuw.', 409) }
export function revisionFilter(record) {
  return { id: record.id, _revision: record._revision ?? { $exists: false } }
}

export async function persistGroupRecord(client, db, collection, input, { creating = false, actor, attendance, allowArchived = false, expectedFingerprint, action, resetCode } = {}) {
  return runGroupTransaction(client, async session => {
    const record = { ...input }
    delete record._id
    const current = await db.collection(collection).findOne({ id: record.id }, { session })
    if (creating ? current !== null : !current || (current._revision || 0) !== (record._revision || 0)) conflict()
    if (expectedFingerprint && recordFingerprint(current) !== expectedFingerprint) conflict()
    const groupId = collection === 'users' ? getUserGroupId(record) : getEventGroupId(record)
    const currentGroupId = current && (collection === 'users' ? getUserGroupId(current) : getEventGroupId(current))
    if (current && currentGroupId !== groupId) conflict()
    await lockGroups(db, session, [groupId], { requireActive: !allowArchived })
    if (resetCode) {
      const pending = await db.collection('resetCodes').findOne({ email: current.email, code: resetCode }, { session })
      if (!pending || (pending.failedAttempts || 0) >= 5 || new Date(pending.expiresAt) <= new Date()) throw new GroupAccessError('Herstelcode ontbreekt of is verlopen', 400)
      await db.collection('resetCodes').deleteOne({ email: current.email, code: resetCode }, { session })
      await db.collection('sessions').updateMany({ userId: current.id, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session })
    }
    const migrated = await membershipMode(db, session)
    if (migrated && collection === 'users') throw new GroupAccessError('Accountgegevens en lidmaatschappen moeten afzonderlijk worden bijgewerkt', 400)
    const liveActor = actor && (migrated ? await liveGroupActor(db, actor, groupId, session) : await db.collection('users').findOne({ id: actor.id }, { session }))
    if (actor) {
      if (!liveActor) throw new GroupAccessError('Ongeldige sessie', 401)
      if (migrated && collection === 'events' && !isDeveloper(liveActor) && !canSeeCalendarEvent(membershipFor(liveActor, groupId), record)) throw new GroupAccessError('Evenement valt buiten je lidmaatschapsperioden', 403)
      if (collection === 'users') {
        if (liveActor.id !== record.id && !canManageUser(liveActor, record)) throw new GroupAccessError('Geen toegang tot deze gebruiker', 403)
        if (((current && normalizeGroupUser(current).role !== normalizeGroupUser(record).role) || (!current && record.role === 'admin')) && !isDeveloper(liveActor)) {
          throw new GroupAccessError('Alleen developers kunnen rollen toekennen', 403)
        }
        if (current && current.status !== record.status && liveActor.id === record.id && normalizeGroupUser(liveActor).role === 'user') {
          const group = await db.collection('groups').findOne({ id: groupId }, { session })
          if (current.status === 'legacy' || group.settings?.allowUserSelfAttendance === false) {
            throw new GroupAccessError('Zelf aanwezigheid wijzigen is voor deze groep uitgeschakeld', 403)
          }
        }
      } else if (attendance) {
        let target = await db.collection('users').findOne({ id: attendance.targetId }, { session })
        if (migrated && target) {
          const membership = await db.collection('groupMemberships').findOne({ userId: target.id, groupId }, { session })
          target = scopedUser({ ...target, memberships: membership ? [membership] : [] }, membership)
        }
        const group = await db.collection('groups').findOne({ id: groupId }, { session })
        if (getAttendanceAuthorizationError(liveActor, target, attendance.attending, record)
          || (normalizeGroupUser(liveActor).role === 'user' && group.settings?.allowUserSelfAttendance === false)) {
          throw new GroupAccessError('Aanwezigheid kan niet worden gewijzigd', 403)
        }
        if (migrated && (eventStartInstant(record.start) === null || eventStartInstant(record.start) <= Date.now() || (!isDeveloper(liveActor) && !canSeeCalendarEvent(membershipFor(liveActor, groupId), record)))) throw new GroupAccessError('Historische deelname kan niet worden gewijzigd', 403)
      } else if (!canManageGroup(liveActor, groupId)) throw new GroupAccessError('Geen toegang tot deze groep', 403)
    }
    if (collection === 'events') {
      if (migrated) {
        const memberships = await db.collection('groupMemberships').find({ groupId }, { session }).toArray()
        if (creating) {
          record.publishedAt = new Date().toISOString()
          if (record.isOpkomst) record.participants = [...new Set([...sanitizeIdArray(record.participants), ...memberships.filter(m => m.state === 'current' && m.status === 'active').map(m => m.userId)])].sort((a, b) => a - b)
        } else record.publishedAt = current.publishedAt
        if (!creating && eventStartInstant(current.start) <= Date.now() && ['participants', 'opkomstmakerIds', 'schoonmakerIds'].some(field => JSON.stringify(record[field]) !== JSON.stringify(current[field]))) throw new GroupAccessError('Historische deelname en taken kunnen niet worden gewijzigd', 403)
        for (const field of ['participants', 'opkomstmakerIds', 'schoonmakerIds']) {
          const previous = new Set(sanitizeIdArray(current?.[field]))
          for (const id of sanitizeIdArray(record[field])) if (!previous.has(id)) {
            const membership = memberships.find(m => m.userId === id)
            if (!membership || membership.state !== 'current' || (field !== 'participants' && membership.status !== 'active') || !canSeeCalendarEvent(membership, record)) conflict()
          }
        }
        for (const id of Object.keys(record.attendance || {})) {
          if (!memberships.some(m => m.userId === Number(id)) && !Object.hasOwn(current?.attendance || {}, id) && !sanitizeIdArray(current?.participants).includes(Number(id))) conflict()
        }
        recordAttendanceMetadata(current, record, memberships)
      } else {
      if (creating && record.isOpkomst) {
        const groupMembers = await db.collection('users').find(groupId === 'stam-default' ? { $or: [{ groupId }, { groupId: { $exists: false } }] } : { groupId }, {
          session, projection: { id: 1, groupId: 1, role: 1, isAdmin: 1, status: 1 }
        }).toArray()
        record.participants = [...new Set([...sanitizeIdArray(record.participants), ...groupMembers.filter(user => !isDeveloper(user) && normalizeGroupUser(user).status === 'active').map(user => user.id)])].sort((a, b) => a - b)
      }
      const ids = new Set([
        ...sanitizeIdArray(record.participants), ...sanitizeIdArray(record.opkomstmakerIds),
        ...sanitizeIdArray(record.schoonmakerIds), ...Object.keys(record.attendance || {}).map(Number)
      ])
      const members = ids.size ? await db.collection('users').find({ id: { $in: [...ids] } }, {
        session, projection: { id: 1, groupId: 1, role: 1, isAdmin: 1, status: 1 }
      }).toArray() : []
      // Ownership is rechecked inside the transaction. Status restrictions for
      // newly selected assignments are handled by endpoint input validation;
      // existing historical assignments survive later status changes.
      const allowedIds = new Set(members.filter(user => !isDeveloper(user) && getUserGroupId(user) === groupId).map(user => user.id))
      if ([...ids].some(id => !allowedIds.has(id))) conflict()
      const byId = new Map(members.map(user => [user.id, normalizeGroupUser(user)]))
      for (const field of ['participants', 'opkomstmakerIds', 'schoonmakerIds']) {
        const previous = new Set(sanitizeIdArray(current?.[field]))
        if (sanitizeIdArray(record[field]).some(id => !previous.has(id) && (field === 'participants' ? byId.get(id).status === 'legacy' : byId.get(id).status !== 'active'))) conflict()
      }
      }
    }
    const next = { ...record, _revision: (current?._revision || 0) + 1 }
    if (creating) await db.collection(collection).insertOne(next, { session })
    else {
      const result = await db.collection(collection).updateOne(revisionFilter(current), { $set: next }, { session })
      if (!result.matchedCount) conflict()
    }
    await writeAudit(db, { action: action || `${collection === 'users' ? 'user' : 'event'}-${creating ? 'created' : 'updated'}`,
      actor: liveActor, groupId, collection, targetId: record.id,
      changedFields: Object.keys(record).filter(key => !['_id', '_revision'].includes(key) && JSON.stringify(current?.[key]) !== JSON.stringify(record[key])) }, session)
    return next
  })
}

import { createHash } from 'node:crypto'
import { MEMBERSHIP_SCHEMA, MEMBERSHIP_INDEXES, validateMembership, eventStartInstant } from './memberships.js'
import { getUserGroupId, isDeveloper, normalizeUserRole } from './groups.js'
import { sanitizeIdArray, sanitizeUserId } from './dataModel.js'
import { recordFingerprint } from './audit.js'
import { freezeLegacyAttendance, durableGroupTotals } from './attendanceScoring.js'

const deterministicId = (kind, key) => `${kind}-${createHash('sha256').update(`${MEMBERSHIP_SCHEMA}:${key}`).digest('hex').slice(0, 32)}`
const pair = (userId, groupId) => `${userId}:${groupId}`
const SOURCE_COLLECTIONS = ['users', 'groups', 'events', 'userGroupHistory', 'sessions', 'paymentRequests', 'paymentRequestFiles']
const refs = event => [...sanitizeIdArray(event.participants), ...sanitizeIdArray(event.opkomstmakerIds), ...sanitizeIdArray(event.schoonmakerIds), ...Object.keys(event.attendance || {}).map(Number)]

function originalRecord(collection, record) {
  const result = { ...record }
  delete result._id
  if (collection === 'users') { delete result.globalRole; delete result.normalizedEmail }
  if (collection === 'events') {
    if (result.membershipOriginalPlans) Object.assign(result, result.membershipOriginalPlans)
    delete result.attendanceMeta; delete result.expectedParticipants; delete result.membershipMigrationId; delete result.membershipOriginalPlans
  }
  return result
}
function sourceFingerprint(source) {
  return recordFingerprint(Object.fromEntries(SOURCE_COLLECTIONS.map(name => [name, (source[name] || []).map(record => originalRecord(name, record)).sort((a, b) => String(a.id ?? a.sessionId).localeCompare(String(b.id ?? b.sessionId)))])))
}
async function readSource(db) {
  const entries = await Promise.all(SOURCE_COLLECTIONS.map(async name => [name, await db.collection(name).find({}).toArray()]))
  const collections = await db.listCollections({}, { nameOnly: true }).toArray()
  const unrecognizedDeclarationCollections = []
  for (const { name } of collections) if (/declar|payment|receipt|expense/i.test(name) && !['paymentRequests', 'paymentRequestFiles'].includes(name) && await db.collection(name).countDocuments({})) unrecognizedDeclarationCollections.push(name)
  return { ...Object.fromEntries(entries), unrecognizedDeclarationCollections }
}

export function planMembershipMigration(source, { resolutions = {}, cutoff = new Date().toISOString() } = {}) {
  const errors = [], warnings = []
  if (!Number.isFinite(Date.parse(cutoff))) errors.push('Invalid migration calendar access cutoff')
  for (const name of source.unrecognizedDeclarationCollections || []) errors.push(`${name}: existing declaration storage needs an explicit schema/retrieval review; it will not be overwritten`)
  const users = source.users || [], events = source.events || [], groups = source.groups || [], archives = source.userGroupHistory || []
  const groupIds = new Set(groups.map(g => g.id)), usersById = new Map(), emails = new Set(), pairs = new Map(), archiveIds = new Set(), archivedSlots = new Set()
  let maxUserId = 0
  for (const user of users) {
    const id = sanitizeUserId(user.id)
    if (id === null || typeof user.id !== 'number' || usersById.has(id)) errors.push(`users/${user.id}: invalid or duplicate global ID`)
    usersById.set(id, user); maxUserId = Math.max(maxUserId, id || 0)
    if (id === 11 && !resolutions.identities?.[id]?.evidence) errors.push('users/11: known deleted historical identity; explicitly verify identity continuity before applying')
    const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : ''
    if (!email || emails.has(email)) errors.push(`users/${user.id}: missing or duplicate normalized email`)
    emails.add(email)
    if (!isDeveloper(user)) {
      const gid = getUserGroupId(user)
      if (!user.groupId || !groupIds.has(gid)) errors.push(`users/${id}: initial group migration missing or invalid group`)
      if (user.status && !['active', 'inactive', 'legacy'].includes(user.status)) errors.push(`users/${id}: invalid participation status`)
      pairs.set(pair(id, gid), { userId: id, groupId: gid, role: normalizeUserRole(user), status: user.status === 'legacy' ? 'inactive' : user.status || 'active', state: user.status === 'legacy' ? 'ended' : 'current', importedAlumni: user.status === 'legacy' })
    }
  }
  for (const archive of archives) {
    maxUserId = Math.max(maxUserId, sanitizeUserId(archive.userId) || 0)
    if (!archive.id || archiveIds.has(archive.id)) errors.push(`archive/${archive.id}: duplicate or missing ID`)
    archiveIds.add(archive.id)
    if (!groupIds.has(archive.groupId) || !groupIds.has(archive.destinationGroupId) || !Number.isFinite(Date.parse(archive.movedAt))) errors.push(`archive/${archive.id}: invalid group or departure date`)
    if (!Array.isArray(archive.events) || !Number.isInteger(archive.streepjes) || archive.streepjes < 0 || archive.events.reduce((sum, e) => sum + e.streepjes, 0) !== archive.streepjes) errors.push(`archive/${archive.id}: inconsistent score aggregate`)
    const sourcePair = pair(archive.userId, archive.groupId)
    if (!pairs.has(sourcePair)) pairs.set(sourcePair, { userId: archive.userId, groupId: archive.groupId, role: archive.previousRole === 'admin' ? 'admin' : 'user', status: archive.status === 'active' ? 'active' : 'inactive', state: usersById.has(archive.userId) ? 'ended' : 'historical' })
    for (const archivedEvent of archive.events || []) {
      if (Object.hasOwn(archivedEvent.references?.attendance || {}, archive.userId)) {
        const key = `${archive.userId}:${archive.groupId}:${archivedEvent.eventId}`
        if (archivedSlots.has(key)) errors.push(`archive/${archive.id}/${archivedEvent.eventId}: repeated archived attendance requires reconciliation`)
        archivedSlots.add(key)
      }
      const live = events.find(e => e.id === archivedEvent.eventId && e.groupId === archive.groupId)
      if (live && Object.hasOwn(live.attendance || {}, archive.userId) && Object.hasOwn(archivedEvent.references?.attendance || {}, archive.userId)) errors.push(`archive/${archive.id}/${archivedEvent.eventId}: live/archive attendance overlap requires reconciliation`)
    }
  }
  const declarationIds = new Set()
  for (const record of source.paymentRequests || []) {
    const id = sanitizeUserId(record.userId)
    if (!record.id || declarationIds.has(record.id) || id === null || !groupIds.has(record.groupId) || !record.form || !Array.isArray(record.attachments)) errors.push(`paymentRequests/${record.id}: unknown declaration schema/ownership requires review`)
    declarationIds.add(record.id)
    if (id !== null) {
      maxUserId = Math.max(maxUserId, id)
      const key = pair(id, record.groupId)
      if (!pairs.has(key)) pairs.set(key, { userId: id, groupId: record.groupId, state: usersById.has(id) ? 'ended' : 'historical', role: 'user', status: 'inactive' })
      const identity = usersById.get(id)
      if (identity?.createdAt && Date.parse(identity.createdAt) > Date.parse(record.submittedAt) && !resolutions.identities?.[id]?.evidence) errors.push(`users/${id}: declaration predates account; verify identity continuity`)
    }
    for (const file of record.attachments || []) if (!(source.paymentRequestFiles || []).some(stored => stored.requestId === record.id && stored.id === file.id)) errors.push(`paymentRequests/${record.id}: receipt reference ${file.id} is missing`)
  }
  for (const event of events) {
    for (const field of ['participants', 'opkomstmakerIds', 'schoonmakerIds']) if (event[field] !== undefined && (!Array.isArray(event[field]) || event[field].some(id => sanitizeUserId(id) === null))) errors.push(`events/${event.id}: invalid ${field} references`)
    if (!event.groupId || !groupIds.has(event.groupId)) errors.push(`events/${event.id}: initial group ownership missing`)
    if (eventStartInstant(event.start) === null) errors.push(`events/${event.id}: invalid or ambiguous Amsterdam start time`)
    for (const id of refs(event)) {
      if (sanitizeUserId(id) === null) { errors.push(`events/${event.id}: invalid identity reference`); continue }
      maxUserId = Math.max(maxUserId, id)
      const key = pair(id, event.groupId)
      if (!pairs.has(key)) {
        if (usersById.has(id)) errors.push(`events/${event.id}: existing user ${id} has unexplained foreign-group references`)
        else { pairs.set(key, { userId: id, groupId: event.groupId, state: 'historical', role: 'user', status: 'inactive' }); warnings.push(`Deleted identity ${id} retained without authentication access in ${event.groupId}`) }
      }
      const user = usersById.get(id)
      if (user?.createdAt && Date.parse(user.createdAt) > eventStartInstant(event.start) && !resolutions.identities?.[id]?.evidence) errors.push(`users/${id}: event predates account; verify no reused historical ID (provide identities.${id}.evidence)`)
    }
  }
  const memberships = [...pairs.entries()].map(([key, record]) => {
    const resolution = resolutions.memberships?.[key]
    const transfers = archives.filter(a => a.userId === record.userId)
    let periods = resolution?.periods
    if (periods !== undefined && !Array.isArray(periods)) { errors.push(`membership/${key}: periods must be an array`); periods = [] }
    if (periods && !resolution.evidence) errors.push(`membership/${key}: reconciliation needs documented evidence`)
    // Preserve recorded arrivals/departures. Only the first imported start may
    // be unknown; this deliberately grandfathers historical calendar access.
    let migrationAccessCutoff
    if (!periods && (record.state !== 'historical' || transfers.some(a => a.groupId === record.groupId))) {
      const boundaries = transfers.flatMap(a => [
        ...(a.groupId === record.groupId ? [{ kind: 'departure', at: a.movedAt }] : []),
        ...(a.destinationGroupId === record.groupId ? [{ kind: 'arrival', at: a.movedAt }] : [])
      ]).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      periods = []
      let open = boundaries[0]?.kind === 'arrival' ? null : { joinedAt: null, endedAt: null, provenance: 'legacy-import' }
      for (const boundary of boundaries) {
        if (boundary.kind === 'arrival') {
          if (open) errors.push(`membership/${key}: conflicting archive arrivals require evidenced periods`)
          open = { joinedAt: boundary.at, endedAt: null, provenance: 'legacy-import' }
        } else {
          if (!open) errors.push(`membership/${key}: conflicting archive departures require evidenced periods`)
          else { periods.push({ ...open, endedAt: boundary.at }); open = null }
        }
      }
      if (record.state === 'current') {
        if (!open) errors.push(`membership/${key}: current membership conflicts with the last archived departure`)
        else periods.push(open)
      } else if (open) {
        migrationAccessCutoff = cutoff
        periods.push({ ...open, endedAt: cutoff, endProvenance: 'migration-access-cutoff' })
      }
    }
    // A verified explicit period can still have an unknown original departure.
    if (record.state === 'ended' && periods?.at(-1)?.endedAt == null && periods?.length) {
      migrationAccessCutoff = cutoff
      periods = periods.map((p, i) => i === periods.length - 1 ? { ...p, endedAt: cutoff, endProvenance: 'migration-access-cutoff' } : p)
    }
    if (migrationAccessCutoff) warnings.push(`membership/${key}: actual departure unknown; ${cutoff} is a migration-time calendar access cutoff, not a departure date`)
    periods = (periods || []).map((p, i) => {
      const joined = eventStartInstant(p.joinedAt), ended = p.endedAt == null ? null : eventStartInstant(p.endedAt)
      return { ...p, id: deterministicId('period', `${key}:${i}:${p.joinedAt}`), joinedAt: joined === null ? p.joinedAt : new Date(joined).toISOString(), endedAt: p.endedAt == null ? null : ended === null ? p.endedAt : new Date(ended).toISOString() }
    })
    try { validateMembership({ ...record, periods }) } catch { errors.push(`membership/${key}: invalid lifecycle or overlapping periods`) }
    if (periods.some(p => Date.parse(p.joinedAt) > Date.parse(cutoff) || (p.endedAt && Date.parse(p.endedAt) > Date.parse(cutoff)))) errors.push(`membership/${key}: evidenced periods cannot extend beyond the migration observation date`)
    if (record.state === 'current' && (periods.length === 0 || periods.at(-1).endedAt !== null)) errors.push(`membership/${key}: current membership needs exactly one open final period`)
    if (record.state === 'ended' && periods.some(p => p.endedAt === null)) errors.push(`membership/${key}: ended membership cannot have an open period`)
    for (const departure of transfers.filter(a => a.groupId === record.groupId)) if (!periods.some(p => p.endedAt && Date.parse(p.endedAt) === Date.parse(departure.movedAt))) errors.push(`membership/${key}: periods do not preserve archive departure ${departure.id}`)
    for (const arrival of transfers.filter(a => a.destinationGroupId === record.groupId)) if (!periods.some(p => Date.parse(p.joinedAt) === Date.parse(arrival.movedAt))) errors.push(`membership/${key}: periods do not preserve archive arrival ${arrival.id}`)
    const { importedAlumni, ...fields } = record
    return { ...fields, id: deterministicId('membership', key), periods, calendarTokenVersion: 0, _revision: 1, createdAt: cutoff, updatedAt: cutoff, migrationId: MEMBERSHIP_SCHEMA,
      ...(importedAlumni ? { previousStatus: 'legacy' } : {}), ...(migrationAccessCutoff ? { migrationAccessCutoff } : {}) }
  })
  const eventUpdates = events.map(event => {
    const original = originalRecord('events', event)
    const planningPatch = {}, originalPlans = {}
    if (eventStartInstant(event.start) >= Date.parse(cutoff)) {
      const endedIds = new Set(memberships.filter(m => m.groupId === event.groupId && m.state !== 'current').map(m => m.userId))
      for (const field of ['participants', 'opkomstmakerIds', 'schoonmakerIds']) if (Array.isArray(original[field]) && original[field].some(id => endedIds.has(id))) {
        originalPlans[field] = original[field]
        planningPatch[field] = original[field].filter(id => !endedIds.has(id))
      }
    }
    return { id: event.id, patch: {
      ...planningPatch, ...(Object.keys(originalPlans).length ? { membershipOriginalPlans: originalPlans } : {}),
      attendanceMeta: freezeLegacyAttendance(original, memberships), expectedParticipants: eventStartInstant(event.start) <= Date.parse(cutoff) ? sanitizeIdArray(original.participants) : null, membershipMigrationId: MEMBERSHIP_SCHEMA,
    } }
  })
  const baseline = Object.fromEntries([...groupIds].map(groupId => {
    const frozen = events.map(e => ({ ...e, attendanceMeta: freezeLegacyAttendance(originalRecord('events', e), memberships) }))
    return [groupId, durableGroupTotals(frozen, groupId, archives, memberships)]
  }))
  return { version: MEMBERSHIP_SCHEMA, lifecycleVersion: 2, cutoff, errors: [...new Set(errors)], warnings: [...new Set(warnings)], memberships, eventUpdates, baseline, maxUserId,
    sourceFingerprint: sourceFingerprint(source), resolutionFingerprint: recordFingerprint(resolutions),
    counts: { users: users.length, events: events.length, memberships: memberships.length, archives: archives.length, existingDeclarations: (source.paymentRequests || []).length },
    historicalDeclarations: 'Email-only submissions are not reconstructed; existing database records are preserved unchanged.' }
}

export async function verifyMembershipMigration(db, { baseline, verifyBaseline = false } = {}) {
  const errors = [], memberships = await db.collection('groupMemberships').find({}).toArray()
  const users = await db.collection('users').find({}).toArray(), events = await db.collection('events').find({}).toArray(), archives = await db.collection('userGroupHistory').find({}).toArray()
  const pairs = new Set(), ids = new Set()
  for (const m of memberships) {
    const key = pair(m.userId, m.groupId)
    if (pairs.has(key) || ids.has(m.id)) errors.push(`duplicate membership ${key}`)
    pairs.add(key); ids.add(m.id)
    try { validateMembership(m) } catch { errors.push(`invalid lifecycle or periods ${m.id}`) }
    if (m.state === 'current' && (!Array.isArray(m.periods) || !m.periods.length || m.periods.at(-1).endedAt !== null)) errors.push(`invalid current period ${m.id}`)
  }
  for (const user of users) if (!isDeveloper(user) && !memberships.some(m => m.userId === user.id)) errors.push(`missing membership ${user.id}`)
  for (const event of events) {
    if (!event.attendanceMeta) errors.push(`missing event integrity metadata ${event.id}`)
    for (const id of Object.keys(event.attendance || {})) if (![0, 1].includes(event.attendanceMeta?.[id]?.streepjes)) errors.push(`missing/invalid attendance contribution ${event.id}/${id}`)
  }
  if (verifyBaseline) for (const [groupId, expected] of Object.entries(baseline || {})) if (recordFingerprint(durableGroupTotals(events, groupId, archives, memberships)) !== recordFingerprint(expected)) errors.push(`streepjes baseline changed ${groupId}`)
  const counter = await db.collection('counters').findOne({ id: 'global-user-id' })
  const maxId = Math.max(0, ...users.map(u => u.id), ...memberships.map(m => m.userId), ...events.flatMap(refs), ...archives.map(a => a.userId))
  if (!counter || counter.value < maxId) errors.push('global ID counter below historical maximum')
  return { errors, counts: { users: users.length, memberships: memberships.length, events: events.length } }
}

export async function migrateMemberships(db, { apply = false, resolutions = {}, confirmedDatabase, cutoff } = {}) {
  if (apply && (!db.databaseName || confirmedDatabase !== db.databaseName)) throw new Error('Explicit database-target verification is required before apply')
  const marker = await db.collection('schemaMigrations').findOne({ id: MEMBERSHIP_SCHEMA })
  if (marker?.state === 'complete') return { version: MEMBERSHIP_SCHEMA, alreadyComplete: true, ...(await verifyMembershipMigration(db)) }
  const source = await readSource(db)
  const plan = planMembershipMigration(source, { resolutions, cutoff: marker?.cutoff || cutoff || new Date().toISOString() })
  if (marker && marker.lifecycleVersion !== 2) plan.errors.push('An older lifecycle migration was started; reconcile or restore it before applying the revised migration')
  if (marker && (marker.sourceFingerprint !== plan.sourceFingerprint || marker.resolutionFingerprint !== plan.resolutionFingerprint)) plan.errors.push('Migration source or resolutions changed after interrupted apply; reconcile before resuming')
  if (marker) {
    // Original planning snapshots keep fingerprints stable across our own
    // cleanup. Verify the applied patch too, so outside edits cannot be hidden
    // by those snapshots and silently overwritten on resume.
    for (const { id, patch } of plan.eventUpdates) {
      const event = source.events.find(e => e.id === id)
      if (event.membershipMigrationId === MEMBERSHIP_SCHEMA && Object.entries(patch).some(([key, value]) => recordFingerprint({ value: event[key] }) !== recordFingerprint({ value }))) plan.errors.push(`events/${id}: migrated metadata or plans changed after interrupted apply`)
    }
    for (const user of source.users) {
      const original = originalRecord('users', user)
      if ((user.globalRole !== undefined && user.globalRole !== (isDeveloper(original) ? 'developer' : 'user')) || (user.normalizedEmail !== undefined && user.normalizedEmail !== user.email.trim().toLowerCase())) plan.errors.push(`users/${user.id}: migrated identity fields changed after interrupted apply`)
    }
  }
  if (!apply || plan.errors.length) return { ...plan, applied: false }
  // Indexes and every mutation are strictly after read-only validation.
  for (const [name, indexes] of Object.entries(MEMBERSHIP_INDEXES)) for (const [keys, options] of indexes) await db.collection(name).createIndex(keys, options)
  await db.collection('users').createIndex({ normalizedEmail: 1 }, { unique: true, name: 'users_normalized_email_unique', partialFilterExpression: { normalizedEmail: { $type: 'string' } } })
  await db.collection('schemaMigrations').updateOne({ id: MEMBERSHIP_SCHEMA }, { $setOnInsert: { id: MEMBERSHIP_SCHEMA, lifecycleVersion: 2, state: 'applying', cutoff: plan.cutoff, sourceFingerprint: plan.sourceFingerprint, resolutionFingerprint: plan.resolutionFingerprint, baseline: plan.baseline } }, { upsert: true })
  for (const membership of plan.memberships) {
    const existing = await db.collection('groupMemberships').findOne({ userId: membership.userId, groupId: membership.groupId })
    if (existing && recordFingerprint(existing) !== recordFingerprint(membership)) throw new Error(`Existing membership differs from migration: ${membership.id}`)
    await db.collection('groupMemberships').updateOne({ userId: membership.userId, groupId: membership.groupId }, { $setOnInsert: membership }, { upsert: true })
    const historyId = deterministicId('history', membership.id)
    await db.collection('groupMembershipHistory').updateOne({ id: historyId }, { $setOnInsert: { id: historyId, membershipId: membership.id, userId: membership.userId, groupId: membership.groupId, action: 'migration-import', timestamp: plan.cutoff,
      actorId: null, role: membership.role, status: membership.status, previousStatus: membership.previousStatus ?? null, state: membership.state, periods: membership.periods, migrationAccessCutoff: membership.migrationAccessCutoff ?? null, migrationId: MEMBERSHIP_SCHEMA } }, { upsert: true })
  }
  for (const user of source.users) await db.collection('users').updateOne({ id: user.id }, { $set: { globalRole: isDeveloper(user) ? 'developer' : 'user', normalizedEmail: user.email.trim().toLowerCase() } })
  for (const event of plan.eventUpdates) await db.collection('events').updateOne({ id: event.id }, { $set: event.patch })
  await db.collection('counters').updateOne({ id: 'global-user-id' }, { $setOnInsert: { id: 'global-user-id', value: plan.maxUserId } }, { upsert: true })
  // Existing declaration ownership/form/attachments and unrelated collections
  // remain byte-for-byte untouched, including sessions and push subscriptions.
  const verification = await verifyMembershipMigration(db, { baseline: plan.baseline, verifyBaseline: true })
  const finalSource = await readSource(db)
  // Calendar migration never adds or modifies publication dates.
  for (const name of SOURCE_COLLECTIONS) {
    const before = source[name].map(r => originalRecord(name, r))
    const after = finalSource[name].map(r => originalRecord(name, r))
    if (recordFingerprint(before) !== recordFingerprint(after)) verification.errors.push(`Original ${name} data changed during migration`)
  }
  if (verification.errors.length) throw new Error(`Migration verification failed: ${verification.errors.join('; ')}`)
  await db.collection('schemaMigrations').updateOne({ id: MEMBERSHIP_SCHEMA, state: 'applying' }, { $set: { state: 'complete', completedAt: new Date().toISOString() } })
  return { ...plan, applied: true, verification }
}

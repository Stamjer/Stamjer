import { eventStartInstant } from './memberships.js'
import { GroupAccessError } from './authorization.js'
import { sanitizeIdArray } from './dataModel.js'

export function legacyContribution(event, userId, value) {
  const present = Boolean(value && typeof value === 'object' ? value.present : value)
  return Number(sanitizeIdArray(event.participants).includes(Number(userId)) !== present)
}

export function freezeLegacyAttendance(event, memberships = []) {
  const metadata = {}
  for (const [id, value] of Object.entries(event.attendance || {})) {
    const membership = memberships.find(m => m.userId === Number(id) && m.groupId === event.groupId)
    metadata[id] = { membershipId: membership?.id || null, periodId: null,
      expectedParticipant: sanitizeIdArray(event.participants).includes(Number(id)),
      streepjes: event.isOpkomst ? legacyContribution(event, id, value) : 0, source: 'legacy-import', recordedAt: null }
  }
  return metadata
}

// Freeze expectations before the first post-start participant change, even when
// actual attendance has not yet been recorded. Corrections reuse that baseline.
export function recordAttendanceMetadata(current, next, memberships, now = new Date()) {
  const instant = eventStartInstant(next.start)
  const oldInstant = eventStartInstant(current?.start)
  const existing = current?.attendanceMeta || {}
  next.attendanceMeta = structuredClone(existing)
  if (current && oldInstant !== null && oldInstant <= +now && !current.expectedParticipants) next.expectedParticipants = sanitizeIdArray(current.participants)
  if (Object.keys(next.attendance || {}).length && !current && (instant === null || instant > +now)) throw new GroupAccessError('Aanwezigheid kan pas na de start worden vastgelegd', 400)
  const baseline = next.expectedParticipants || sanitizeIdArray(current?.participants ?? next.participants)
  for (const [id, value] of Object.entries(next.attendance || {})) {
    const unchanged = current && JSON.stringify(current.attendance?.[id]) === JSON.stringify(value)
    if (unchanged && existing[id]) continue
    if (instant === null || instant > +now) throw new GroupAccessError('Aanwezigheid kan pas na de start worden vastgelegd', 400)
    const membership = memberships.find(m => m.userId === Number(id))
    const period = membership?.periods?.find(p => (p.joinedAt === null && p.provenance === 'legacy-import' || eventStartInstant(p.joinedAt) <= instant) && (p.endedAt == null || instant < Date.parse(p.endedAt)))
    const expected = existing[id]?.expectedParticipant ?? baseline.includes(Number(id))
    next.attendanceMeta[id] = { membershipId: membership?.id || existing[id]?.membershipId || null,
      periodId: period?.id || existing[id]?.periodId || null, expectedParticipant: expected,
      streepjes: next.isOpkomst ? Number(expected !== Boolean(value?.present ?? value)) : 0, source: 'recorded', recordedAt: now }
  }
  for (const id of Object.keys(existing)) if (!Object.hasOwn(next.attendance || {}, id)) delete next.attendanceMeta[id]
  return next
}

export function durableGroupTotals(events, groupId, archives = [], memberships = []) {
  const totals = Object.fromEntries(memberships.filter(m => m.groupId === groupId).map(m => [m.userId, 0]))
  for (const event of events) {
    if (event.groupId !== groupId) continue
    for (const [id, meta] of Object.entries(event.attendanceMeta || {})) totals[id] = (totals[id] || 0) + meta.streepjes
  }
  // Each archive document is counted once. Never add both its aggregate and
  // per-event contributions; migration verifies aggregate/provenance first.
  const seen = new Set()
  for (const archive of archives) if (archive.groupId === groupId && !seen.has(archive.id)) {
    seen.add(archive.id)
    totals[archive.userId] = (totals[archive.userId] || 0) + archive.streepjes
  }
  return totals
}

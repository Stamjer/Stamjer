import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryDb, createMemoryClient } from '../test-support/memoryDb.js'
import { newMembership, changeMembership, validatePeriods, validateMembership, scopedUser, liveGroupActor, previewMembershipEnd, subscriptionToken, validSubscriptionToken, canSeeCalendarEvent, eventStartInstant } from '../server/memberships.js'
import { freezeLegacyAttendance, recordAttendanceMetadata, durableGroupTotals } from '../server/attendanceScoring.js'

const developer = { id: 1, role: 'developer' }
const date = s => new Date(s)
describe('permanent memberships and calendar policy', () => {
  it('derives Alumni only from ended state and rejects independently assignable legacy status', () => {
    const membership = newMembership(2, 'a')
    assert.equal(scopedUser({ id: 2 }, membership).status, 'active')
    assert.equal(scopedUser({ id: 2 }, { ...membership, status: 'inactive' }).status, 'inactive')
    assert.equal(scopedUser({ id: 2 }, { ...membership, state: 'ended' }).status, 'alumni')
    assert.throws(() => newMembership(2, 'a', { status: 'legacy' }), { status: 400 })
    assert.throws(() => validateMembership({ ...membership, status: 'legacy' }), { status: 400 })
  })
  it('grandfathers only the initial imported start and uses exact Amsterdam boundaries regardless of publication', () => {
    const periods = [{ id: 'first', joinedAt: null, endedAt: '2025-01-01', provenance: 'legacy-import' }, { id: 'second', joinedAt: '2025-07-01', endedAt: null }]
    validatePeriods(periods)
    const membership = { groupId: 'a', state: 'current', periods }
    assert.equal(canSeeCalendarEvent(membership, { groupId: 'a', start: '1990-01-01', publishedAt: '2099-01-01' }), true)
    assert.equal(canSeeCalendarEvent(membership, { groupId: 'a', start: '2025-01-01' }), false)
    assert.equal(canSeeCalendarEvent(membership, { groupId: 'a', start: '2025-06-30T22:00:00Z' }), true)
    assert.throws(() => validatePeriods([{ ...periods[0], provenance: undefined }]))
    assert.throws(() => validatePeriods([periods[0], { ...periods[1], joinedAt: null, provenance: 'legacy-import' }]))
    assert.throws(() => validatePeriods([{ ...periods[0], endedAt: 'not-a-date' }]))
    assert.equal(canSeeCalendarEvent({ ...membership, state: 'historical' }, { groupId: 'a', start: '1990-01-01' }), false)
  })
  it('lets live group admins join, change status, end and rejoin only their own memberships without privilege escalation', async () => {
    const admin = newMembership(3, 'a', { role: 'admin', now: date('2020-01-01') })
    const member = newMembership(2, 'a', { now: date('2020-01-01') })
    const other = newMembership(2, 'b', { role: 'admin', now: date('2020-01-01') })
    const db = createMemoryDb({ users: [developer, { id: 2 }, { id: 3 }, { id: 4, normalizedEmail: 'existing@example.test' }], groups: [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }], groupMemberships: [admin, member, other], events: [], paymentRequests: [{ id: 'original', userId: 2, groupId: 'a' }] })
    const client = createMemoryClient(db), actor = { id: 3 }
    const token = subscriptionToken(member, 'secret'), beforeOther = structuredClone(other)
    const updated = await changeMembership(client, db, { actor, membershipId: member.id, action: 'update', patch: { status: 'inactive' } })
    assert.equal(updated.membership.state, 'current')
    assert.deepEqual(updated.membership.periods, member.periods)
    await assert.rejects(changeMembership(client, db, { actor, membershipId: member.id, action: 'update', patch: { status: 'legacy' } }), { status: 400 })
    const current = db.data.groupMemberships.find(m => m.id === member.id)
    const preview = previewMembershipEnd(current, [], await liveGroupActor(db, actor, 'a'), 'secret', date('2025-07-01'))
    await changeMembership(client, db, { actor, membershipId: member.id, action: 'end', previewToken: preview.previewToken, secret: 'secret', now: date('2025-07-01') })
    await assert.rejects(changeMembership(client, db, { actor, membershipId: member.id, action: 'update', patch: { status: 'active' } }), { status: 403 })
    await assert.rejects(changeMembership(client, db, { actor, membershipId: member.id, action: 'rejoin', patch: { role: 'admin' } }), { status: 403 })
    const rejoined = await changeMembership(client, db, { actor, membershipId: member.id, action: 'rejoin', now: date('2025-10-01') })
    assert.equal(rejoined.membership.role, 'user'); assert.equal(rejoined.membership.status, 'active')
    assert.equal(rejoined.membership.periods.length, 2)
    assert.equal(subscriptionToken(db.data.groupMemberships.find(m => m.id === member.id), 'secret'), token)
    await changeMembership(client, db, { actor, email: 'existing@example.test', groupId: 'a', action: 'join' })
    await assert.rejects(changeMembership(client, db, { actor, groupId: 'b', userId: 4, action: 'join' }), { status: 403 })
    await assert.rejects(changeMembership(client, db, { actor, membershipId: other.id, action: 'update', patch: { status: 'inactive' } }), { status: 403 })
    await assert.rejects(changeMembership(client, db, { actor, membershipId: admin.id, action: 'update', patch: { role: 'admin' } }), { status: 403 })
    assert.deepEqual(db.data.groupMemberships.find(m => m.id === other.id), beforeOther)
    assert.equal(db.data.users.length, 4); assert.equal(db.data.paymentRequests[0].groupId, 'a')
    // Recheck a stale actor's membership inside the transaction.
    db.data.groupMemberships.find(m => m.id === admin.id).role = 'user'
    await assert.rejects(changeMembership(client, db, { actor: { id: 3, role: 'admin' }, membershipId: member.id, action: 'update', patch: { status: 'inactive' } }), { status: 403 })
  })
  it('protects the last admin, allows developer recovery, and serializes concurrent rejoining without overlapping periods', async () => {
    const admin = newMembership(3, 'a', { role: 'admin', now: date('2020-01-01') })
    const db = createMemoryDb({ users: [developer, { id: 3 }], groups: [{ id: 'a', status: 'active' }], groupMemberships: [admin], events: [] })
    const client = createMemoryClient(db)
    const actor = await liveGroupActor(db, { id: 3 }, 'a')
    const preview = previewMembershipEnd(admin, [], actor, 'secret', date('2025-01-01'))
    await assert.rejects(changeMembership(client, db, { actor, membershipId: admin.id, action: 'end', previewToken: preview.previewToken, secret: 'secret', now: date('2025-01-01') }), /laatste beheerder/)
    assert.deepEqual(db.writes, [])
    const recovery = previewMembershipEnd(admin, [], developer, 'secret', date('2025-01-01'))
    await changeMembership(client, db, { actor: developer, membershipId: admin.id, action: 'end', previewToken: recovery.previewToken, secret: 'secret', now: date('2025-01-01') })
    const results = await Promise.allSettled([1, 2].map(() => changeMembership(client, db, { actor: developer, membershipId: admin.id, action: 'rejoin', now: date('2025-07-01') })))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    const membership = db.data.groupMemberships[0]
    assert.equal(membership.role, 'user'); assert.equal(membership.periods.length, 2)
    validateMembership(membership)
  })
  it('joins independent groups, ends atomically and rejoins the same record and URL', async () => {
    const db = createMemoryDb({ users: [developer, { id: 2 }], groups: [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }], events: Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, groupId: 'a', start: '2025-08-01', isOpkomst: true, participants: [2], opkomstmakerIds: [2] })) })
    const client = createMemoryClient(db)
    const params = { actor: developer, userId: 2 }
    const a = (await changeMembership(client, db, { ...params, groupId: 'a', action: 'join', patch: { role: 'admin' }, now: date('2025-01-01') })).membership
    await changeMembership(client, db, { ...params, groupId: 'b', action: 'join', now: date('2025-01-01') })
    const before = await db.collection('groupMemberships').findOne({ id: a.id })
    const token = subscriptionToken(before, 'secret')
    const events = db.data.events
    const preview = previewMembershipEnd(before, events, developer, 'secret', date('2025-07-01'))
    assert.equal(preview.summary.futureEvents, 10)
    await changeMembership(client, db, { ...params, membershipId: a.id, action: 'end', previewToken: preview.previewToken, secret: 'secret', now: date('2025-07-01') })
    const ended = db.data.groupMemberships.find(m => m.id === a.id)
    assert.equal(ended.state, 'ended')
    assert.equal(db.data.groupMemberships.find(m => m.groupId === 'b').state, 'current')
    assert.ok(db.data.events.every(e => !e.participants.includes(2) && !e.opkomstmakerIds.includes(2)))
    assert.ok(validSubscriptionToken(ended, token, 'secret'))
    await changeMembership(client, db, { ...params, membershipId: a.id, action: 'rejoin', now: date('2025-10-01') })
    const rejoined = db.data.groupMemberships.find(m => m.id === a.id)
    assert.equal(rejoined.role, 'user')
    assert.equal(rejoined.periods.length, 2)
    assert.ok(validSubscriptionToken(rejoined, token, 'secret'))
    await changeMembership(client, db, { ...params, membershipId: a.id, action: 'rotate' })
    assert.equal(validSubscriptionToken(db.data.groupMemberships.find(m => m.id === a.id), token, 'secret'), false)
  })
  it('includes the full period calendar, excludes gaps, future regardless of publication dates', () => {
    const membership = { groupId: 'a', state: 'current', periods: [{ joinedAt: '2025-01-01', endedAt: '2025-07-01' }, { joinedAt: '2025-10-01', endedAt: null }] }
    const event = { groupId: 'a', start: '2025-05-01', publishedAt: '2025-04-01' }
    assert.ok(canSeeCalendarEvent(membership, event))
    assert.equal(canSeeCalendarEvent(membership, { ...event, publishedAt: '2025-08-01' }), true)
    assert.equal(canSeeCalendarEvent(membership, { ...event, publishedAt: undefined }), true)
    assert.equal(canSeeCalendarEvent(membership, { ...event, start: '2025-08-01' }), false)
    assert.ok(canSeeCalendarEvent(membership, { ...event, start: '2025-11-01' }))
    assert.equal(canSeeCalendarEvent({ ...membership, state: 'ended', periods: membership.periods.slice(0, 1) }, { ...event, start: '2025-11-01' }), false)
  })
  it('rejects overlaps and handles Amsterdam dates independently of server timezone', () => {
    assert.equal(eventStartInstant('2025-07-01'), Date.parse('2025-06-30T22:00:00Z'))
    assert.equal(eventStartInstant('2025-01-01T12:00'), Date.parse('2025-01-01T11:00:00Z'))
    assert.equal(eventStartInstant('2025-10-26T02:30'), null)
    assert.equal(eventStartInstant('2025-03-30T02:30'), null)
    assert.throws(() => validatePeriods([{ id: '1', joinedAt: '2025-01-01', endedAt: '2025-04-01' }, { id: '2', joinedAt: '2025-03-01', endedAt: null }]))
  })
  it('rejects stale/tampered end previews and unauthorized lifecycle actions without writes', async () => {
    const membership = newMembership(2, 'a', { now: date('2020-01-01') })
    const db = createMemoryDb({ users: [developer, { id: 2 }, { id: 3 }], groups: [{ id: 'a', status: 'active' }], groupMemberships: [membership, newMembership(3, 'a', { role: 'admin' })], events: [] })
    const client = createMemoryClient(db)
    const params = { actor: developer, membershipId: membership.id, action: 'end', secret: 'secret' }
    const preview = previewMembershipEnd(membership, [], developer, 'secret')
    await assert.rejects(changeMembership(client, db, { ...params, previewToken: `${preview.previewToken}tampered` }), { status: 409 })
    await assert.rejects(changeMembership(client, db, { ...params, actor: { id: 2 }, previewToken: preview.previewToken }), { status: 403 })
    db.data.events.push({ id: 'new', groupId: 'a', start: '2099-01-01', participants: [] })
    await assert.rejects(changeMembership(client, db, { ...params, previewToken: preview.previewToken }), { status: 409 })
    assert.equal(db.data.groupMemberships[0].state, 'current')
    assert.deepEqual(db.writes, [])
  })
  it('freezes legacy scores including future records and deleted identities; new future attendance is rejected', () => {
    const membership = newMembership(2, 'a', { now: date('2024-01-01') })
    const event = { id: 'e', groupId: 'a', isOpkomst: true, start: '2099-01-01', participants: [2], attendance: { 2: false, 11: true } }
    event.attendanceMeta = freezeLegacyAttendance(event, [membership])
    assert.deepEqual(durableGroupTotals([event], 'a', [{ id: 'archive', userId: 2, groupId: 'a', streepjes: 3 }], [membership]), { 2: 4, 11: 1 })
    const next = { ...event, participants: [] }
    recordAttendanceMetadata(event, next, [membership])
    assert.equal(next.attendanceMeta[2].streepjes, 1)
    assert.throws(() => recordAttendanceMetadata(event, { ...next, attendance: { 2: true } }, [membership]))
    const past = { ...event, start: '2025-01-01' }
    const corrected = recordAttendanceMetadata(past, { ...past, attendance: { 2: true, 11: true } }, [membership])
    assert.equal(corrected.attendanceMeta[2].streepjes, 0)
  })
  it('freezes the actual-start planning baseline, never future planning, and metadata edits retain recorded totals', () => {
    const member = newMembership(2, 'a', { now: date('2020-01-01') })
    const future = { id: 'future', groupId: 'a', isOpkomst: true, start: '2025-05-01', participants: [], attendanceMeta: {}, expectedParticipants: null }
    const planned = recordAttendanceMetadata(future, { ...future, participants: [2] }, [member], date('2025-04-01'))
    assert.equal(planned.expectedParticipants, null)
    assert.deepEqual(durableGroupTotals([planned], 'a', [], [member]), { 2: 0 })
    const actual = recordAttendanceMetadata(planned, { ...planned, attendance: { 2: false } }, [member], date('2025-06-01'))
    assert.equal(actual.attendanceMeta[2].streepjes, 1)
    assert.equal(durableGroupTotals([{ ...actual, isOpkomst: false }], 'a', [], [member])[2], 1)
  })
})

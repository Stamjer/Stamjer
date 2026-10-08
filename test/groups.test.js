import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  calculateGroupStreepjes, DEFAULT_GROUP_ID, getEventMembershipError,
  getGroupMembers, normalizeGroupUser
} from '../api/groups.js'
import {
  canManageGroup, canManageUser, canReadGroup, getAttendanceAuthorizationError,
  resolveRequestGroupId
} from '../api/authorization.js'

const user = { id: 1, groupId: 'stam', role: 'user', status: 'active' }
const admin = { id: 2, groupId: 'stam', role: 'admin', status: 'active' }
const other = { id: 3, groupId: 'explorers', role: 'admin', status: 'active' }
const developer = { id: 4, groupId: null, role: 'developer', status: 'active' }
const users = [user, admin, other, developer]

describe('role and group normalization', () => {
  it('migrates old admin flags and defaults without granting privileges from stale flags', () => {
    assert.deepEqual(normalizeGroupUser({ id: 5, isAdmin: true }), {
      id: 5, role: 'admin', groupId: DEFAULT_GROUP_ID, isAdmin: true, isDeveloper: false, status: 'active'
    })
    assert.equal(normalizeGroupUser({ role: 'user', isAdmin: true }).isAdmin, false)
    assert.equal(normalizeGroupUser({ role: 'invalid', isAdmin: true }).isAdmin, false)
    assert.equal(normalizeGroupUser({ isDeveloper: true }).role, 'user')
  })

  it('forces developer accounts out of group membership', () => {
    assert.equal(normalizeGroupUser({ ...developer, groupId: 'stam', isAdmin: true }).groupId, null)
    assert.equal(normalizeGroupUser(developer).isAdmin, false)
    assert.deepEqual(getGroupMembers(users, 'stam').map(({ id }) => id), [1, 2])
  })
})

describe('group authorization', () => {
  it('limits members and admins to their group', () => {
    assert.equal(canReadGroup(user, 'stam'), true)
    assert.equal(canManageGroup(user, 'stam'), false)
    assert.equal(canManageGroup(admin, 'stam'), true)
    assert.equal(canReadGroup(admin, 'explorers'), false)
    assert.equal(canManageUser(admin, other), false)
    assert.equal(canManageUser(admin, developer), false)
    assert.equal(canManageGroup(null, 'stam'), false)
  })

  it('allows explicit developer access across groups', () => {
    assert.equal(canManageGroup(developer, 'explorers'), true)
    assert.equal(canManageUser(developer, other), true)
    assert.equal(resolveRequestGroupId({ query: { groupId: 'explorers' } }, developer), 'explorers')
    assert.equal(resolveRequestGroupId({ query: { allGroups: 'true' } }, developer, { allowAllGroups: true }), null)
    assert.throws(() => resolveRequestGroupId({}, developer), { status: 400 })
    assert.throws(() => resolveRequestGroupId({ query: { allGroups: 'true' } }, developer), { status: 400 })
  })

  it('rejects group spoofing, ambiguous selectors and malformed query values', () => {
    assert.equal(resolveRequestGroupId({ body: { userId: other.id } }, admin), 'stam')
    assert.throws(() => resolveRequestGroupId({ body: { groupId: 'explorers' } }, admin), { status: 403 })
    assert.throws(() => resolveRequestGroupId({ query: { allGroups: 'true' } }, user, { allowAllGroups: true }), { status: 403 })
    assert.throws(() => resolveRequestGroupId({ query: { groupId: ['stam'] } }, admin), { status: 400 })
    assert.throws(() => resolveRequestGroupId({ query: { groupId: 'stam' }, body: { groupId: 'explorers' } }, developer), { status: 400 })
    assert.throws(() => resolveRequestGroupId({ query: { groupId: 'stam', allGroups: 'true' } }, developer, { allowAllGroups: true }), { status: 400 })
  })

  it('checks actor, target and event group when changing attendance', () => {
    assert.equal(getAttendanceAuthorizationError(admin, user, true, { groupId: 'stam' }), null)
    assert.equal(getAttendanceAuthorizationError(admin, other, true, { groupId: 'explorers' }), 'FORBIDDEN')
    assert.equal(getAttendanceAuthorizationError(user, user, true, { groupId: 'explorers' }), 'FORBIDDEN')
    assert.equal(getAttendanceAuthorizationError(developer, other, true, { groupId: 'explorers' }), null)
    assert.equal(getAttendanceAuthorizationError(developer, user, true, { groupId: 'explorers' }), 'FORBIDDEN')
    assert.equal(getAttendanceAuthorizationError(developer, developer, true, { groupId: 'stam' }), 'FORBIDDEN')
  })
})

describe('group calculations and event references', () => {
  it('ignores foreign events, invalid references and developer streepjes', () => {
    assert.deepEqual(calculateGroupStreepjes(users, [
      { groupId: 'stam', isOpkomst: true, participants: [1], attendance: { 1: false, 2: { present: true }, 3: true, 4: true } },
      { groupId: 'explorers', isOpkomst: true, participants: [1], attendance: { 1: false, 3: true } }
    ], 'stam'), { 1: 1, 2: 1 })
  })

  it('rejects foreign/developer IDs instead of silently discarding them', () => {
    const event = { groupId: 'stam' }
    assert.equal(getEventMembershipError(event, { participants: [1, 2], attendance: { 1: true, 2: { present: false } } }, users), null)
    for (const field of ['participants', 'opkomstmakerIds', 'schoonmakerIds']) {
      assert.ok(getEventMembershipError(event, { [field]: [3] }, users))
      assert.ok(getEventMembershipError(event, { [field]: [4] }, users))
      assert.ok(getEventMembershipError(event, { [field]: ['1junk'] }, users))
      assert.ok(getEventMembershipError(event, { [field]: ['1e0'] }, users))
    }
    assert.ok(getEventMembershipError(event, { attendance: { 3: true } }, users))
    assert.ok(getEventMembershipError(event, { attendance: { 1: 'false' } }, users))
    assert.ok(getEventMembershipError(event, { attendance: [] }, users))
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapGroupForClient, summarizeGroup, validateGroupInput } from '../server/groupManagement.js'
import { buildUserUpdate, mapManagedUser } from '../server/userManagement.js'
import { filterManagedUsers } from '../src/lib/userManagement.js'

describe('group management validation and privacy', () => {
  it('accepts known settings and rejects immutable, secret and unknown fields', () => {
    const group = validateGroupInput({ id: 'explorers', name: ' Explorers ', settings: { paymentRequestEmail: 'TEAM@example.com', allowUserSelfAttendance: false } }, { creating: true })
    assert.equal(group.slug, 'explorers')
    assert.equal(group.name, 'Explorers')
    assert.equal(group.settings.paymentRequestEmail, 'team@example.com')
    for (const body of [
      { id: 'other' }, { calendarFeedToken: 'secret' }, { settings: { arbitrary: true } },
      { settings: { paymentRequestEmail: 'invalid' } }, { settings: { allowUserSelfAttendance: 'false' } },
      { slug: 'Invalid key' }, { name: '' }, { status: 'deleted' },
      { settings: { calendarName: 'Name\rInjected header' } }
    ]) assert.throws(() => validateGroupInput(body), { status: 400 })
  })
  it('never serializes secret or arbitrary database fields in group responses', () => {
    const group = mapGroupForClient({ id: 'stam', settings: { calendarName: 'Stam', token: 'private' }, calendarFeedToken: 'private', _id: 'private', other: 'private' })
    assert.equal(group.hasCalendarSubscription, true)
    assert.doesNotMatch(JSON.stringify(group), /private/)
  })
  it('accepts only boolean declarations settings and exposes saved values', () => {
    for (const enablePaymentRequests of [false, true]) {
      const settings = { enablePaymentRequests }
      assert.deepEqual(validateGroupInput({ settings }).settings, settings)
      const created = validateGroupInput({ id: 'new-group', name: 'New group', settings }, { creating: true })
      assert.equal(created.settings.enablePaymentRequests, enablePaymentRequests)
      assert.equal(mapGroupForClient({ id: 'stam', settings }).settings.enablePaymentRequests, enablePaymentRequests)
    }
    for (const enablePaymentRequests of ['false', 'true', 0, 1, null, {}, []]) {
      assert.throws(() => validateGroupInput({ settings: { enablePaymentRequests } }), { status: 400 })
    }
    assert.equal(mapGroupForClient({ id: 'stam', settings: {} }).settings.enablePaymentRequests, undefined)
  })
  it('excludes developers and other groups from summaries', () => {
    const summary = summarizeGroup({ id: 'stam' }, [
      { id: 1, groupId: 'stam', role: 'admin', status: 'active' },
      { id: 2, groupId: null, role: 'developer', status: 'active' },
      { id: 3, groupId: 'other', role: 'admin', status: 'active' }
    ], [{ groupId: 'stam', isOpkomst: true, start: '2099-01-01' }, { groupId: 'other', isOpkomst: true, start: '2099-01-01' }])
    assert.deepEqual(summary, { users: 1, admins: 1, activeUsers: 1, events: 1, futureOpkomsten: 1 })
  })
  it('accepts only boolean streepjes settings and maps both saved states', () => {
    for (const enableStreepjes of [false, true]) {
      const settings = { enableStreepjes }
      assert.deepEqual(validateGroupInput({ settings }).settings, settings)
      assert.deepEqual(mapGroupForClient({ id: 'stam', settings }).settings, settings)
    }
    for (const enableStreepjes of ['false', 0, 1, null, {}, []]) assert.throws(() => validateGroupInput({ settings: { enableStreepjes } }), { status: 400 })
  })
})

describe('managed user updates', () => {
  const current = { id: 1, role: 'user', groupId: 'stam', password: 'secret', status: 'active' }
  it('uses an allow-list and reserves all role changes for developers', () => {
    assert.equal(buildUserUpdate({ role: 'admin' }, current, { email: ' NEW@example.com ' }).email, 'new@example.com')
    assert.throws(() => buildUserUpdate({ role: 'admin' }, current, { role: 'admin' }), { status: 403 })
    for (const body of [{ password: 'overwrite' }, { groupId: 'other' }, { isAdmin: true }, { role: 'developer' }]) {
      assert.throws(() => buildUserUpdate({ role: 'developer' }, current, body), { status: 400 })
    }
    assert.equal(buildUserUpdate({ role: 'developer' }, current, { role: 'admin' }).isAdmin, true)
    assert.equal(mapManagedUser(current).password, undefined)
    assert.equal(current.role, 'user')
  })
  it('searches emails, filters roles/status and sorts streepjes without changing source data', () => {
    const users = [
      { id: 1, firstName: 'Ada', lastName: 'Member', email: 'team@example.com', role: 'user', status: 'active', streepjes: 1 },
      { id: 2, firstName: 'Grace', lastName: 'Admin', email: 'other@example.com', role: 'admin', status: 'inactive', streepjes: 3 }
    ]
    assert.deepEqual(filterManagedUsers(users, { search: 'TEAM@' }).map(user => user.id), [1])
    assert.deepEqual(filterManagedUsers(users, { role: 'admin', status: 'inactive' }).map(user => user.id), [2])
    assert.deepEqual(filterManagedUsers(users, { sort: 'streepjes' }).map(user => user.id), [2, 1])
    assert.deepEqual(users.map(user => user.id), [1, 2])
  })
})

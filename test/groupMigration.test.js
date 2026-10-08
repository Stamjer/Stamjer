import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { migrateGroups, planGroupMigration } from '../api/groupMigration.js'
import { DEFAULT_GROUP_ID } from '../api/groups.js'
import { createMemoryDb } from '../test-support/memoryDb.js'

const legacyData = {
  users: [{ id: 1, email: 'member@example.test', isAdmin: true, password: 'unchanged' }],
  events: [{ id: 'one', participants: [1], opkomstmakerIds: [1], attendance: { 1: { present: true } }, legacyOpkomstmakerNames: ['Old member'] }],
  sessions: [{ sessionId: 'unchanged', userId: 1 }],
  resetCodes: [{ email: 'member@example.test', code: 'unchanged' }]
}

describe('group migration', () => {
  it('defaults to a read-only dry-run with counts and no writes or index creation', async () => {
    const db = createMemoryDb(legacyData)
    const report = await migrateGroups(db)
    assert.equal(report.mode, 'dry-run')
    assert.deepEqual(report.updates, { users: 1, events: 1 })
    assert.deepEqual(report.errors, [])
    assert.equal(report.applied, false)
    assert.deepEqual(db.writes, [])
    assert.deepEqual(db.data, legacyData)
  })

  it('applies idempotently and preserves credentials, sessions and event history', async () => {
    const db = createMemoryDb(legacyData)
    assert.equal((await migrateGroups(db, { apply: true })).applied, true)
    assert.equal(db.data.users[0].groupId, DEFAULT_GROUP_ID)
    assert.equal(db.data.users[0].role, 'admin')
    assert.equal(db.data.users[0].password, 'unchanged')
    assert.deepEqual(db.data.sessions, legacyData.sessions)
    assert.deepEqual(db.data.resetCodes, legacyData.resetCodes)
    assert.deepEqual(db.data.events[0], { ...legacyData.events[0], groupId: DEFAULT_GROUP_ID })
    const again = await migrateGroups(db, { apply: true })
    assert.deepEqual(again.updates, { users: 0, events: 0 })
    assert.equal(db.data.groups.length, 1)
  })

  it('normalizes developers without migrating them into the default group', () => {
    const plan = planGroupMigration({ users: [{ id: 3, role: 'developer', isAdmin: true, groupId: 'old-group' }] })
    assert.deepEqual(plan.errors, [])
    assert.equal(plan.updates.users[0].fields.groupId, null)
    assert.equal(plan.updates.users[0].fields.isAdmin, false)
  })

  it('refuses all writes for unknown groups, invalid roles or foreign event references', async () => {
    for (const data of [
      { users: [{ id: 1, groupId: 'missing' }] },
      { users: [{ id: 1, role: 'superadmin' }] },
      { users: [{ id: 1, email: 'Same@example.test' }, { id: 2, email: 'same@example.test' }] },
      { users: [{ id: 1 }, { id: 1 }] },
      { users: legacyData.users, events: [{ id: 'bad', participants: [999] }] },
      { groups: [{ id: 'other' }], users: [{ id: 1, groupId: 'other' }], events: legacyData.events }
    ]) {
      const db = createMemoryDb(data)
      const report = await migrateGroups(db, { apply: true })
      assert.ok(report.errors.length)
      assert.equal(report.applied, false)
      assert.deepEqual(db.writes, [])
    }
  })

  it('blocks populated unsupported collections instead of guessing ownership', async () => {
    const db = createMemoryDb({ ...legacyData, notifications: [{ id: 'unknown' }] })
    const report = await migrateGroups(db, { apply: true })
    assert.match(report.errors[0], /notifications/)
    assert.deepEqual(db.writes, [])
  })
})

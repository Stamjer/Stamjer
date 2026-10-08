import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyUserGroupMove, planUserGroupMove, previewUserGroupMove } from '../api/userGroupMoves.js'
import { persistGroupRecord, runGroupTransaction } from '../api/groupTransactions.js'
import { planGroupMigration } from '../api/groupMigration.js'
import { calculateGroupStreepjes } from '../api/groups.js'
import { createMemoryClient, createMemoryDb } from '../test-support/memoryDb.js'

const now = new Date('2026-10-04T12:00:00Z')
const secret = 'move-test-only-secret'
function fixture(status = 'active') {
  const db = createMemoryDb({
    groups: [{ id: 'source', slug: 'source', status: 'active' }, { id: 'destination', slug: 'destination', status: 'active' }],
    users: [{ id: 1, groupId: 'source', role: 'admin', status, firstName: 'Moved', lastName: 'Member', email: 'moved@example.test', password: 'unchanged-hash' },
      { id: 2, role: 'developer', groupId: null, email: 'developer@example.test' },
      { id: 3, role: 'user', status: 'active', groupId: 'source', email: 'other@example.test' }],
    events: [
      { id: 'past', groupId: 'source', title: 'Past', start: '2025-10-04T20:00:00Z', isOpkomst: true,
        participants: [1, 3], opkomstmakerIds: [1], schoonmakerIds: [1], attendance: { 1: { present: false, checkedAt: 'original' }, 3: true }, legacyOpkomstmakerNames: ['Preserved'] },
      { id: 'future-source', groupId: 'source', title: 'Future source', start: '2099-10-04T20:00:00Z', isOpkomst: true, participants: [1, 3], opkomstmakerIds: [1] },
      { id: 'future-destination', groupId: 'destination', title: 'Future destination', start: '2099-10-04T20:00:00Z', isOpkomst: true, participants: [] },
      { id: 'past-destination', groupId: 'destination', title: 'Past destination', start: '2025-10-04T20:00:00Z', isOpkomst: true, participants: [] }
    ],
    sessions: [{ userId: 1, sessionId: 'member-session', revokedAt: null }, { userId: 3, sessionId: 'other-session', revokedAt: null }],
    resetCodes: [{ email: 'moved@example.test', code: 'unchanged' }]
  })
  const client = createMemoryClient(db)
  const options = { userId: 1, destinationGroupId: 'destination', actorId: 2, secret, now }
  const preview = () => previewUserGroupMove(client, db, options)
  const apply = token => applyUserGroupMove(client, db, { ...options, previewToken: token })
  return { db, client, options, preview, apply }
}

describe('user group moves and guarded writes', () => {
  it('previews without writes and exposes counts without credentials', async () => {
    const { db, preview } = fixture()
    const before = structuredClone(db.data)
    const result = await preview()
    assert.deepEqual(db.data, before)
    assert.deepEqual(db.writes, [])
    assert.equal(result.summary.archivedEvents, 2)
    assert.equal(result.summary.archivedStreepjes, 1)
    assert.equal(result.summary.futureAssignments, 1)
    assert.equal(result.summary.destinationOpkomsten, 1)
    assert.doesNotMatch(JSON.stringify(result), /unchanged-hash|password|moved@example/)
  })

  it('atomically archives original references, preserves history, demotes admins and revokes only target sessions', async () => {
    const { db, preview, apply } = fixture()
    const original = structuredClone(db.data.events[0])
    const result = await apply((await preview()).previewToken)
    assert.equal(result.user.groupId, 'destination')
    assert.equal(result.user.role, 'user')
    assert.equal(result.user.status, 'active')
    assert.equal(result.user.password, 'unchanged-hash')
    assert.equal(db.data.sessions[0].revokedAt.getTime(), now.getTime())
    assert.equal(db.data.sessions[1].revokedAt, null)
    assert.equal(db.data.resetCodes[0].code, 'unchanged')
    assert.equal(db.data.userGroupHistory[0].groupId, 'source')
    assert.equal(db.data.userGroupHistory[0].streepjes, 1)
    assert.deepEqual(db.data.userGroupHistory[0].events[0].references.attendance, { 1: original.attendance[1] })
    assert.deepEqual(db.data.userGroupHistory[0].events[0].references.participants, [1])
    assert.deepEqual(db.data.events[0].participants, [3])
    assert.deepEqual(db.data.events[0].attendance, { 3: true })
    assert.deepEqual(db.data.events[0].opkomstmakerIds, [])
    assert.deepEqual(db.data.events[0].legacyOpkomstmakerNames, ['Preserved', 'Moved'])
    assert.deepEqual(db.data.events[0].legacySchoonmakerNames, ['Moved'])
    assert.deepEqual(db.data.events[1].opkomstmakerIds, [])
    assert.deepEqual(db.data.events[2].participants, [1])
    assert.deepEqual(db.data.events[3].participants, [])
    assert.equal(calculateGroupStreepjes(db.data.users, db.data.events, 'destination')[1], 0)
    assert.deepEqual(planGroupMigration(db.data).errors, [])
  })

  it('preserves inactive/legacy status without enrolling in destination opkomsten', async () => {
    for (const status of ['inactive', 'legacy']) {
      const { db, preview, apply } = fixture(status)
      await apply((await preview()).previewToken)
      assert.equal(db.data.users[0].status, status)
      assert.deepEqual(db.data.events[2].participants, [])
    }
  })

  it('rejects non-developers, archived/same/missing groups, developer targets and foreign event references', async () => {
    const { db, client, options } = fixture()
    await assert.rejects(previewUserGroupMove(client, db, { ...options, actorId: 1 }), { status: 403 })
    await assert.rejects(previewUserGroupMove(client, db, { ...options, userId: 2 }), { status: 400 })
    for (const destinationGroupId of ['source', 'missing', 'BAD']) {
      assert.throws(() => planUserGroupMove({ user: db.data.users[0], ...db.data, destinationGroupId, now }))
    }
    db.data.groups[1].status = 'archived'
    await assert.rejects(previewUserGroupMove(client, db, options), { status: 403 })
    db.data.groups[1].status = 'active'
    db.data.events[2].participants = [1]
    await assert.rejects(previewUserGroupMove(client, db, options), { status: 409 })
  })

  it('rejects tampering, replay, mismatched destinations/actors and expired previews', async () => {
    const { db, client, options, preview, apply } = fixture()
    const token = (await preview()).previewToken
    await assert.rejects(apply(token.replace(/.$/, token.endsWith('A') ? 'B' : 'A')), { status: 400 })
    await assert.rejects(apply(`${token.split('.')[0]}.${'é'.repeat(43)}`), { status: 400 })
    await assert.rejects(applyUserGroupMove(client, db, { ...options, previewToken: token, destinationGroupId: 'source' }), { status: 400 })
    await assert.rejects(applyUserGroupMove(client, db, { ...options, previewToken: token, actorId: 1 }), { status: 400 })
    await assert.rejects(applyUserGroupMove(client, db, { ...options, previewToken: token, now: new Date(now.getTime() + 600_001) }), { status: 409 })
    await apply(token)
    await assert.rejects(apply(token))
    assert.equal(db.data.userGroupHistory.length, 1)
  })

  it('rejects changed status/events/groups and events starting since the preview', async () => {
    for (const change of [
      db => { db.data.users[0].status = 'inactive' },
      db => { db.data.events[0].attendance[1] = true },
      db => { db.data.events.push({ id: 'new-event', groupId: 'destination', start: '2099-01-01', isOpkomst: true }) },
      db => { db.data.groups[0].status = 'archived' }
    ]) {
      const { db, preview, apply } = fixture()
      const token = (await preview()).previewToken
      change(db)
      const before = structuredClone(db.data)
      await assert.rejects(apply(token))
      assert.deepEqual(db.data, before)
    }
    const { db, client, options, preview } = fixture()
    db.data.events[1].start = new Date(now.getTime() + 60_000).toISOString()
    const token = (await preview()).previewToken
    await assert.rejects(applyUserGroupMove(client, db, { ...options, previewToken: token, now: new Date(now.getTime() + 120_000) }), { status: 409 })
  })

  it('rolls back archive, events, user and sessions when any transactional write fails', async () => {
    for (const failingCollection of ['events', 'users', 'sessions']) {
      const { db, preview, apply } = fixture()
      const token = (await preview()).previewToken
      const before = structuredClone(db.data)
      const originalCollection = db.collection
      db.collection = name => {
        const collection = originalCollection(name)
        if (name === failingCollection) {
          const method = name === 'sessions' ? 'updateMany' : 'updateOne'
          collection[method] = async () => { throw new Error('Injected database failure') }
        }
        return collection
      }
      await assert.rejects(apply(token), /Injected database failure/)
      assert.deepEqual(db.data, before)
      assert.deepEqual(db.writes, [])
    }
  })

  it('rejects stale user/event writes, new source references and moved-admin actions after commit', async () => {
    const { db, client, preview, apply } = fixture()
    const staleUser = structuredClone(db.data.users[0])
    const staleEvent = structuredClone(db.data.events[0])
    await apply((await preview()).previewToken)
    const before = structuredClone(db.data)
    await assert.rejects(persistGroupRecord(client, db, 'users', staleUser), { status: 409 })
    await assert.rejects(persistGroupRecord(client, db, 'events', staleEvent), { status: 409 })
    await assert.rejects(persistGroupRecord(client, db, 'events', { id: 'new-source', groupId: 'source', participants: [1] }, { creating: true, actor: db.data.users[1] }), { status: 409 })
    await assert.rejects(persistGroupRecord(client, db, 'events', db.data.events[0], { actor: staleUser }), { status: 403 })
    assert.deepEqual(db.data, before)
  })

  it('fails closed when MongoDB cannot execute transactions', async () => {
    let ended = false
    const client = { startSession: () => ({ withTransaction: async () => { throw Object.assign(new Error('Standalone MongoDB'), { code: 20 }) }, endSession: async () => { ended = true } }) }
    await assert.rejects(runGroupTransaction(client, () => assert.fail('Must not execute')), { status: 503 })
    assert.equal(ended, true)
  })

  it('rechecks self-attendance policy inside user writes when settings change after authorization', async () => {
    const { db, client } = fixture()
    db.data.users[0].role = 'user'
    const actor = structuredClone(db.data.users[0])
    db.data.groups[0].settings = { allowUserSelfAttendance: false }
    const before = structuredClone(db.data)
    await assert.rejects(persistGroupRecord(client, db, 'users', { ...actor, status: 'inactive' }, { actor }), { status: 403 })
    assert.deepEqual(db.data, before)
    await persistGroupRecord(client, db, 'users', { ...actor, status: 'inactive' }, { actor: db.data.users[1] })
    assert.equal(db.data.users[0].status, 'inactive')
  })
})

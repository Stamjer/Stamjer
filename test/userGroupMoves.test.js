import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyUserGroupMove, planUserGroupMove, previewUserGroupMove } from '../server/userGroupMoves.js'
import { persistGroupRecord, runGroupTransaction } from '../server/groupTransactions.js'
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
  it('retires preview and apply without touching identities, events, sessions or archives', async () => {
    const { db, preview, apply } = fixture()
    const before = structuredClone(db.data)
    await assert.rejects(preview(), { status: 410 })
    await assert.rejects(apply('old-preview'), { status: 410 })
    assert.deepEqual(db.data, before)
    assert.deepEqual(db.writes, [])
  })
  it('can still interpret legacy archive references without mutations', () => {
    const { db } = fixture()
    const plan = planUserGroupMove({ user: db.data.users[0], ...db.data, destinationGroupId: 'destination', now })
    assert.equal(plan.summary.archivedStreepjes, 1)
    assert.equal(plan.history.length, 2)
    assert.deepEqual(db.writes, [])
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

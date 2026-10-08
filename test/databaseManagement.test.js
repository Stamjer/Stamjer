import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mapDatabaseRecord, readRecordPreview, signRecordPreview } from '../api/databaseManagement.js'
import { persistGroupRecord } from '../api/groupTransactions.js'
import { persistGroupSettings } from '../api/groupManagement.js'
import { sendPasswordInvitation } from '../api/passwordInvitations.js'
import { createMemoryClient, createMemoryDb } from '../test-support/memoryDb.js'

function fixture() {
  const db = createMemoryDb({ groups: [{ id: 'stam', status: 'active', settings: {} }], users: [{ id: 1, role: 'user', groupId: 'stam', status: 'active', email: 'member@example.test' }, { id: 2, role: 'developer', groupId: null }], events: [{ id: 'event', groupId: 'stam', title: 'Original', participants: [1] }] })
  return { db, client: createMemoryClient(db), actor: db.data.users[1] }
}
describe('database previews, audit atomicity and email delivery', () => {
  it('rejects expired, tampered and malformed signed record previews', () => {
    const secret = 'test-secret'
    const token = signRecordPreview({ collection: 'users', id: 1, expiresAt: 1000 }, secret)
    assert.equal(readRecordPreview(token, secret, 999).id, 1)
    assert.throws(() => readRecordPreview(token, secret, 1000), { status: 409 })
    for (const input of [undefined, `${token}a`, token.replace(/^./, 'A')]) assert.throws(() => readRecordPreview(input, secret, 999), { status: 400 })
  })
  it('redacts secrets and arbitrary fields from every curated collection', () => {
    const record = { id: 1, email: 'member@example.test', password: 'secret', tokenHash: 'secret', calendarFeedToken: 'secret', code: 'secret', custom: 'secret', settings: { secret: 'secret' }, references: { secret: 'secret' } }
    for (const collection of ['users', 'events', 'groups', 'sessions', 'resetCodes', 'auditLogs', 'userGroupHistory']) assert.doesNotMatch(JSON.stringify(mapDatabaseRecord(collection, record)), /secret/)
  })
  it('rolls back user/event/group writes when persisting the audit fails', async () => {
    for (const collection of ['users', 'events', 'groups']) {
      const { db, client, actor } = fixture()
      const before = structuredClone(db.data)
      const original = db.collection
      db.collection = name => name === 'auditLogs' ? { async insertOne() { throw new Error('Audit unavailable') } } : original(name)
      const operation = collection === 'groups' ? persistGroupSettings(client, db, 'stam', { name: 'Changed' }, actor)
        : persistGroupRecord(client, db, collection, { ...db.data[collection][0], ...(collection === 'users' ? { firstName: 'Changed' } : { title: 'Changed' }) }, { actor })
      await assert.rejects(operation, /Audit unavailable/)
      assert.deepEqual(db.data, before)
    }
  })
  it('reports unavailable/failed SMTP and deletes only a failed code without claiming delivery', async () => {
    const { db, client, actor } = fixture()
    await assert.rejects(sendPasswordInvitation(client, db, { userId: 1, actor }), { status: 503 })
    assert.equal(db.data.resetCodes, undefined)
    await assert.rejects(sendPasswordInvitation(client, db, { userId: 1, actor, mailer: { async sendMail() { throw new Error('Secret transport details') } } }), { status: 503 })
    assert.equal(db.data.resetCodes.length, 0)
    assert.equal(db.data.auditLogs.at(-1).action, 'password-reset-delivery-failed')
    assert.doesNotMatch(JSON.stringify(db.data.auditLogs), /Secret transport|"code":/)
  })
  it('rechecks newly selected member status inside the transaction', async () => {
    const { db, client, actor } = fixture()
    db.data.users[0].status = 'inactive'
    await assert.rejects(persistGroupRecord(client, db, 'events', { ...db.data.events[0], opkomstmakerIds: [1] }, { actor }), { status: 409 })
  })
  it('automatically enrolls only current active same-group members during event creation', async () => {
    const { db, client, actor } = fixture()
    db.data.users[0].status = 'inactive'
    db.data.users.push({ id: 3, groupId: 'stam', status: 'active' }, { id: 4, groupId: 'other', status: 'active' })
    const saved = await persistGroupRecord(client, db, 'events', { id: 'new', groupId: 'stam', isOpkomst: true, participants: [] }, { actor, creating: true })
    assert.deepEqual(saved.participants, [3])
  })
})

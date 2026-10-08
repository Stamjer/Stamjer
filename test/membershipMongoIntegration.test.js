import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MongoClient } from 'mongodb'
import { changeMembership, previewMembershipEnd, newMembership, MEMBERSHIP_INDEXES, MEMBERSHIP_SCHEMA } from '../server/memberships.js'
import { freezeLegacyAttendance } from '../server/attendanceScoring.js'
import { storePaymentRequest, claimPaymentDelivery } from '../server/paymentHistory.js'

// Never imports dotenv, never consults MONGODB_URI, never selects Stamjer.
const uri = process.env.MONGODB_GROUPS_TEST_URI
test('real MongoDB membership uniqueness, concurrent lifecycle and declaration claims', { skip: !uri, timeout: 60000 }, async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
  const name = `stamjer_groups_test_${randomUUID().replaceAll('-', '')}`
  assert.match(name, /^stamjer_groups_test_[a-f0-9]{32}$/)
  const db = client.db(name)
  let connected = false
  try {
    await client.connect(); connected = true
    const hello = await db.admin().command({ hello: 1 })
    assert.ok(hello.setName || hello.msg === 'isdbgrid')
    await db.collection('groups').insertMany(['a', 'b'].map(id => ({ id, status: 'active', settings: {} })))
    for (const [collection, definitions] of Object.entries(MEMBERSHIP_INDEXES)) {
      for (const [keys, options] of definitions) await db.collection(collection).createIndex(keys, options)
    }
    const actor = { id: 2, globalRole: 'developer', role: 'developer', email: 'dev@example.test' }
    await db.collection('users').insertMany([{ id: 1, globalRole: 'user', role: 'user', email: 'member@example.test', password: 'preserved' }, actor])
    const membership = newMembership(1, 'a', { role: 'admin', now: new Date('2020-01-01T00:00:00Z') })
    await db.collection('groupMemberships').insertOne(membership)
    await db.collection('schemaMigrations').insertOne({ id: MEMBERSHIP_SCHEMA, state: 'complete' })
    const fixtures = [{ id: 'past', groupId: 'a', start: '2025-01-01', publishedAt: '2024-01-01T00:00:00Z', isOpkomst: true, participants: [1], attendance: { 1: false } }, { id: 'future', groupId: 'a', start: '2099-01-01', isOpkomst: true, participants: [1] }]
    await db.collection('events').insertMany(fixtures.map(event => ({ ...event, attendanceMeta: freezeLegacyAttendance(event, [membership]) })))
    await assert.rejects(db.collection('groupMemberships').insertOne({ ...membership, _id: undefined, id: 'duplicate' }), { code: 11000 })
    await changeMembership(client, db, { actor, userId: 1, groupId: 'b', action: 'join' })
    const events = await db.collection('events').find({ groupId: 'a' }).toArray()
    const preview = previewMembershipEnd(membership, events, actor, 'mongo-test')
    const endings = await Promise.allSettled([1, 2].map(() => changeMembership(client, db, { actor, membershipId: membership.id, action: 'end', previewToken: preview.previewToken, secret: 'mongo-test' })))
    assert.equal(endings.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal((await db.collection('events').findOne({ id: 'past' })).attendanceMeta[1].streepjes, 1)
    assert.deepEqual((await db.collection('events').findOne({ id: 'future' })).participants, [])
    assert.equal((await db.collection('groupMemberships').findOne({ userId: 1, groupId: 'b' })).state, 'current')
    const params = { actor: { id: 1 }, groupId: 'b', requestKey: 'mongo-request-test', form: { amount: 1 }, attachments: [] }
    const records = await Promise.all([storePaymentRequest(client, db, params), storePaymentRequest(client, db, params)])
    assert.equal(records[0].record.id, records[1].record.id)
    const claims = await Promise.all([claimPaymentDelivery(db, records[0].record.id), claimPaymentDelivery(db, records[0].record.id)])
    assert.equal(claims.filter(Boolean).length, 1)
  } finally {
    try { if (connected) { assert.match(db.databaseName, /^stamjer_groups_test_[a-f0-9]{32}$/); await db.dropDatabase() } } finally { await client.close() }
  }
})

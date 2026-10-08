import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryDb } from '../test-support/memoryDb.js'
import { planMembershipMigration, migrateMemberships, verifyMembershipMigration } from '../server/membershipMigration.js'
import { canSeeCalendarEvent } from '../server/memberships.js'

function fixture() {
  return { groups: [{ id: 'stam-default', settings: { enablePaymentRequests: false } }], users: [{ id: 2, firstName: 'Member', email: 'member@example.test', password: 'UNCHANGED', groupId: 'stam-default', role: 'admin', status: 'legacy' }],
    events: [{ id: 'old', groupId: 'stam-default', start: '2025-03-01', participants: [2], isOpkomst: true, attendance: { 2: false, 11: true } }],
    sessions: [{ sessionId: 'untouched', userId: 2, tokenHash: 'UNCHANGED' }], pushSubscriptions: [{ userId: 2, secret: 'UNCHANGED' }], userGroupHistory: [], paymentRequests: [] }
}
const resolutions = { memberships: { '2:stam-default': { evidence: 'Verified membership register', periods: [{ joinedAt: '2024-01-01T00:00:00Z', endedAt: null }] } } }
describe('versioned membership migration safety', () => {
  it('imports 22 existing identities with unknown starts, preserves historical scores and removes Alumni future plans', async () => {
    const source = fixture()
    source.users = Array.from({ length: 22 }, (_, i) => ({ id: i + 1 === 11 ? 23 : i + 1, email: `member${i}@example.test`, role: i === 0 ? 'admin' : 'user', groupId: 'stam-default', status: i === 1 ? 'legacy' : i === 2 ? 'inactive' : 'active' }))
    source.events.push({ id: 'future', groupId: 'stam-default', start: '2099-01-01', participants: [1, 2, 3], opkomstmakerIds: [2], schoonmakerIds: [2], isOpkomst: true, attendance: { 2: false } })
    const db = createMemoryDb(source); db.databaseName = 'stamjer_groups_test_grandfathered'
    const dry = await migrateMemberships(db, { cutoff: '2026-10-09T00:00:00Z' })
    assert.deepEqual(dry.errors, []); assert.deepEqual(db.writes, [])
    assert.equal(dry.memberships.filter(m => m.state === 'current').length, 21)
    assert.equal(dry.memberships.filter(m => m.state === 'ended').length, 1)
    assert.equal(dry.memberships.filter(m => m.state === 'historical').length, 1)
    assert.ok(dry.memberships.filter(m => m.state !== 'historical').every(m => m.periods[0].joinedAt === null && m.periods[0].provenance === 'legacy-import'))
    assert.ok(!dry.warnings.some(w => /publication|join date/.test(w)))
    const alumni = dry.memberships.find(m => m.userId === 2)
    assert.ok(canSeeCalendarEvent(alumni, source.events[0]))
    assert.equal(canSeeCalendarEvent(alumni, source.events[1]), false)
    const result = await migrateMemberships(db, { apply: true, confirmedDatabase: db.databaseName, cutoff: dry.cutoff })
    assert.deepEqual(result.verification.errors, [])
    assert.equal(db.data.users.length, 22)
    assert.deepEqual(db.data.events.find(e => e.id === 'future').participants, [1, 3])
    assert.deepEqual(db.data.events.find(e => e.id === 'future').opkomstmakerIds, [])
    assert.equal(db.data.events.find(e => e.id === 'future').attendanceMeta[2].streepjes, 1)
    assert.ok(db.data.events.every(e => !Object.hasOwn(e, 'publishedAt') && !Object.hasOwn(e, 'publicationObservedAt') && !Object.hasOwn(e, 'publicationProvenance')))
  })
  it('uses evidenced departure dates, labels unknown departures, and rejects invalid cutoff or grandfathered periods', () => {
    const source = fixture()
    const exact = { memberships: { '2:stam-default': { evidence: 'Departure register', periods: [{ joinedAt: null, endedAt: '2025-07-01T00:00:00Z', provenance: 'legacy-import' }] } } }
    const plan = planMembershipMigration(source, { resolutions: exact, cutoff: '2026-10-09T00:00:00Z' })
    assert.deepEqual(plan.errors, [])
    assert.equal(plan.memberships.find(m => m.userId === 2).migrationAccessCutoff, undefined)
    assert.ok(!plan.warnings.some(w => w.includes('departure unknown')))
    exact.memberships['2:stam-default'].periods.push({ joinedAt: null, endedAt: '2026-01-01', provenance: 'legacy-import' })
    assert.ok(planMembershipMigration(source, { resolutions: exact }).errors.some(e => e.includes('invalid lifecycle')))
    assert.ok(planMembershipMigration(source, { cutoff: 'invalid' }).errors.some(e => e.includes('cutoff')))
  })
  it('blocks incompatible already-started or already-applied lifecycle data instead of overwriting it', async () => {
    const db = createMemoryDb({ ...fixture(), schemaMigrations: [{ id: 'multi-group-v2', state: 'applying', cutoff: '2026-10-09T00:00:00Z' }] })
    assert.ok((await migrateMemberships(db)).errors.some(e => e.includes('older lifecycle')))
    assert.deepEqual(db.writes, [])
    db.data.schemaMigrations[0].state = 'complete'
    db.data.groupMemberships = [{ id: 'old-schema', userId: 2, groupId: 'stam-default', role: 'user', state: 'current', status: 'legacy', periods: [] }]
    assert.ok((await migrateMemberships(db)).errors.some(e => e.includes('invalid lifecycle')))
    assert.deepEqual(db.writes, [])
  })
  it('preserves existing declarations and receipts and reserves identities referenced only by private history', async () => {
    const source = fixture()
    source.paymentRequests = [{ id: 'saved', userId: 25, groupId: 'stam-default', form: { amount: 5, expenseTitle: 'Previously saved' }, submittedAt: '2025-01-01', attachments: [{ id: 'file', name: 'receipt.pdf' }], status: 'smtp-accepted' }]
    source.paymentRequestFiles = [{ requestId: 'saved', id: 'file', content: 'UNCHANGED' }]
    const db = createMemoryDb(source); db.databaseName = 'stamjer_groups_test_private_history'
    const result = await migrateMemberships(db, { apply: true, confirmedDatabase: db.databaseName, resolutions })
    assert.equal(result.applied, true)
    assert.equal(db.data.counters[0].value, 25)
    assert.equal(db.data.groupMemberships.find(m => m.userId === 25).state, 'historical')
    assert.deepEqual(db.data.paymentRequests, source.paymentRequests)
    assert.deepEqual(db.data.paymentRequestFiles, source.paymentRequestFiles)
  })
  it('reports unrecognized persistent declaration collections without writes or fabricated history', async () => {
    const db = createMemoryDb({ ...fixture(), declaraties: [{ privateLegacyRecord: true }] })
    const result = await migrateMemberships(db, { resolutions })
    assert.ok(result.errors.some(error => error.includes('explicit schema/retrieval review')))
    assert.deepEqual(db.writes, [])
    assert.equal(db.data.paymentRequests.length, 0)
  })
  it('preflight and dry-run grandfather unknown starts and convert legacy users without any writes', async () => {
    const db = createMemoryDb(fixture())
    const plan = await migrateMemberships(db)
    assert.deepEqual(plan.errors, [])
    const alumni = plan.memberships.find(m => m.userId === 2)
    assert.equal(alumni.state, 'ended')
    assert.equal(alumni.status, 'inactive')
    assert.equal(alumni.periods[0].joinedAt, null)
    assert.equal(alumni.periods[0].provenance, 'legacy-import')
    assert.equal(alumni.periods[0].endedAt, plan.cutoff)
    assert.equal(alumni.periods[0].endProvenance, 'migration-access-cutoff')
    assert.equal(alumni.migrationAccessCutoff, plan.cutoff)
    assert.ok(plan.warnings.some(w => w.includes('not a departure date')))
    assert.ok(!plan.warnings.some(w => w.includes('publication')))
    assert.ok(!Object.hasOwn(plan.eventUpdates[0].patch, 'publishedAt'))
    assert.deepEqual(db.writes, [])
    const ready = await migrateMemberships(db, { resolutions })
    assert.deepEqual(ready.errors, [])
    assert.ok(!ready.warnings.some(w => w.includes('publication')))
    assert.deepEqual(db.writes, [])
  })
  it('requires an explicit matching target, preserves every old value and frozen scores, and reruns idempotently', async () => {
    const initial = fixture(), db = createMemoryDb(initial)
    db.databaseName = 'stamjer_groups_test_memberships'
    await assert.rejects(migrateMemberships(db, { apply: true, resolutions }), /target/)
    assert.deepEqual(db.writes, [])
    const result = await migrateMemberships(db, { apply: true, resolutions, confirmedDatabase: db.databaseName })
    assert.equal(result.applied, true)
    assert.deepEqual(result.verification.errors, [])
    assert.equal(db.data.users[0].password, 'UNCHANGED')
    assert.equal(db.data.groupMemberships.find(m => m.userId === 2).status, 'inactive')
    assert.equal(db.data.groupMemberships.find(m => m.userId === 11).state, 'historical')
    assert.equal(db.data.counters[0].value, 11)
    assert.deepEqual(db.data.events[0].participants, initial.events[0].participants)
    assert.deepEqual(db.data.events[0].attendance, initial.events[0].attendance)
    assert.equal(db.data.events[0].attendanceMeta[2].streepjes, 1)
    assert.equal(db.data.events[0].attendanceMeta[11].streepjes, 1)
    for (const name of ['sessions', 'pushSubscriptions', 'groups']) assert.deepEqual(db.data[name], initial[name])
    const writes = db.writes.length
    assert.equal((await migrateMemberships(db, { apply: true, resolutions, confirmedDatabase: db.databaseName })).alreadyComplete, true)
    assert.equal(db.writes.length, writes)
    assert.deepEqual((await verifyMembershipMigration(db)).errors, [])
  })
  it('recovers an interrupted apply with stable IDs and preserves original publication fields', async () => {
    const db = createMemoryDb(fixture()); db.databaseName = 'stamjer_groups_test_resume'
    db.data.events[0].publishedAt = '2025-02-01T00:00:00Z'
    db.data.events.push({ id: 'future', groupId: 'stam-default', start: '2099-01-01', participants: [2], opkomstmakerIds: [2], isOpkomst: true, attendance: { 2: false } })
    const original = db.collection.bind(db)
    let failOnce = true
    db.collection = name => {
      const collection = original(name)
      if (name === 'counters') { const update = collection.updateOne.bind(collection); collection.updateOne = async (...args) => { if (failOnce) { failOnce = false; throw new Error('interrupted') } return update(...args) } }
      return collection
    }
    await assert.rejects(migrateMemberships(db, { apply: true, resolutions, confirmedDatabase: db.databaseName }), /interrupted/)
    const ids = db.data.groupMemberships.map(m => m.id)
    const writes = db.writes.length
    db.data.events[1].participants = [999]
    assert.ok((await migrateMemberships(db, { resolutions })).errors.some(e => e.includes('plans changed')))
    assert.equal(db.writes.length, writes)
    db.data.events[1].participants = []
    db.data.users[0].globalRole = 'developer'
    assert.ok((await migrateMemberships(db, { resolutions })).errors.some(e => e.includes('identity fields changed')))
    assert.equal(db.writes.length, writes)
    db.data.users[0].globalRole = 'user'
    const resumed = await migrateMemberships(db, { apply: true, resolutions, confirmedDatabase: db.databaseName })
    assert.deepEqual(resumed.errors, [])
    assert.equal(resumed.applied, true)
    assert.deepEqual(db.data.groupMemberships.map(m => m.id), ids)
    assert.equal(db.data.events[0].publishedAt, '2025-02-01T00:00:00Z')
    assert.deepEqual(db.data.events[1].participants, [])
    assert.equal(db.data.events[1].attendanceMeta[2].streepjes, 1)
  })
  it('imports recorded departure boundaries without publication evidence and still blocks reused IDs and inconsistent archives', () => {
    const source = fixture()
    source.users[0].groupId = 'b'; source.groups.push({ id: 'b' })
    source.userGroupHistory.push({ id: 'move', userId: 2, groupId: 'stam-default', destinationGroupId: 'b', movedAt: '2025-07-01T00:00:00Z', previousRole: 'admin', status: 'active', streepjes: 0, events: [] })
    const closed = { memberships: { '2:stam-default': { evidence: 'Membership register', periods: [{ joinedAt: '2024-01-01', endedAt: '2025-07-01T00:00:00Z' }] } } }
    assert.deepEqual(planMembershipMigration(source, { resolutions: closed }).errors, [])
    assert.deepEqual(planMembershipMigration(source).errors, [])
    source.users[0].createdAt = '2026-01-01'
    source.userGroupHistory[0].streepjes = 1
    const errors = planMembershipMigration(source, { resolutions: closed }).errors
    assert.ok(errors.some(e => e.includes('reused historical ID')))
    assert.ok(errors.some(e => e.includes('inconsistent score')))
  })
})

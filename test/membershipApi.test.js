import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcrypt'
import nodemailer from 'nodemailer'
import { createMemoryDb, createMemoryClient } from '../test-support/memoryDb.js'
import { newMembership, MEMBERSHIP_SCHEMA } from '../server/memberships.js'
import { freezeLegacyAttendance } from '../server/attendanceScoring.js'
import { storePaymentRequest } from '../server/paymentHistory.js'

let db, server, origin, failMail = false, rejectMail = false
const cookies = {}, mail = []
const memberA = newMembership(1, 'a', { role: 'admin', now: new Date('2020-01-01') })
const memberB = newMembership(1, 'b', { status: 'inactive', now: new Date('2020-01-01') })
before(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://unused.invalid', VERCEL: '1', NODE_ENV: 'test', TOKEN_SECRET: 'membership-api-test-only', SMTP_HOST: 'unused.invalid' })
  const password = await bcrypt.hash('test-password', 4)
  db = createMemoryDb({ schemaMigrations: [{ id: MEMBERSHIP_SCHEMA, state: 'complete' }], counters: [{ id: 'global-user-id', value: 20 }],
    users: [1, 2, 3, 4].map(id => ({ id, firstName: `User${id}`, lastName: 'Test', email: `user${id}@example.test`, normalizedEmail: `user${id}@example.test`, password, globalRole: id === 4 ? 'developer' : 'user', role: id === 4 ? 'developer' : 'user', groupId: 'old-untrusted' })),
    groups: ['a', 'b'].map(id => ({ id, slug: id, name: id.toUpperCase(), status: 'active', settings: { paymentRequestEmail: `${id}@example.test` } })),
    groupMemberships: [memberA, memberB, newMembership(2, 'a', { now: new Date('2020-01-01') }), newMembership(3, 'b', { role: 'admin', now: new Date('2020-01-01') })],
    events: [{ id: 'past', groupId: 'a', title: 'Past, not attended', start: '2025-01-01', publishedAt: '2024-12-01T00:00:00Z', isOpkomst: true, participants: [1], attendance: { 1: false } },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `future-${i}`, groupId: 'a', title: `Future ${i}`, start: '2099-01-01', publishedAt: '2025-01-01T00:00:00Z', isOpkomst: true, participants: [1, 2], opkomstmakerIds: [1] })),
      { id: 'b-event', groupId: 'b', title: 'Other group', start: '2099-01-01', publishedAt: '2025-01-01T00:00:00Z', isOpkomst: true, participants: [3] }] })
  for (const event of db.data.events) event.attendanceMeta = freezeLegacyAttendance(event, db.data.groupMemberships)
  global._mongoClientPromise = Promise.resolve(createMemoryClient(db))
  const original = nodemailer.createTransport
  nodemailer.createTransport = () => ({ async verify() { return true }, async sendMail(message) { if (failMail) throw new Error('Transient SMTP failure'); mail.push(message); return { messageId: 'test', accepted: rejectMail ? [] : [message.to], rejected: rejectMail ? [message.to] : [] } } })
  try { server = (await import('../api/index.js')).default.listen(0, '127.0.0.1') } finally { nodemailer.createTransport = original }
  await new Promise(resolve => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`
  for (let id = 1; id <= 4; id++) {
    const result = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `user${id}@example.test`, password: 'test-password' }) })
    assert.equal(result.status, 200)
    cookies[id] = result.headers.get('set-cookie').split(';')[0]
  }
})
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); delete global._mongoClientPromise })
async function api(id, path, method = 'GET', body, groupId) {
  const response = await fetch(`${origin}/api${path}`, { method, headers: { ...(id ? { Cookie: cookies[id] } : {}), ...(groupId ? { 'X-Group-Id': groupId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text() }
}
const payment = { requesterName: 'Member', requesterEmail: 'user1@example.test', expenseTitle: 'Supplies', paidTo: 'Shop', expenseDate: '2025-01-01', amount: 12.5, description: 'Camp', paymentMethod: 'paymentLink', paymentLink: 'https://example.com/pay', attachments: [{ name: 'receipt.pdf', type: 'application/pdf', content: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') }] }

describe('multi-group HTTP authorization, subscriptions and declarations', () => {
  it('uses independent live roles/statuses, rejects ambiguous and foreign contexts, and preserves global sessions', async () => {
    const a = await api(1, '/session', 'GET', null, 'a'), b = await api(1, '/session', 'GET', null, 'b')
    assert.equal(a.data.user.role, 'admin'); assert.equal(b.data.user.role, 'user'); assert.equal(b.data.user.status, 'inactive')
    assert.equal(a.data.user.memberships.length, 2); assert.equal(a.data.user.password, undefined)
    assert.equal((await api(1, '/events')).status, 400)
    assert.equal((await api(2, '/events?groupId=b')).status, 403)
    assert.equal((await api(1, '/users/3/status', 'PATCH', { status: 'active' }, 'b')).status, 404)
    assert.equal((await api(1, '/users/2', 'PATCH', { firstName: 'Unauthorized identity' }, 'a')).status, 403)
    assert.equal((await api(4, '/users/1/group/preview', 'POST', { groupId: 'b' })).status, 410)
    assert.equal((await api(4, '/groups')).status, 200)
  })
  it('keeps group memberships available for participant validation after session refreshes', async () => {
    await api(2, '/session', 'GET', null, 'a')
    await api(1, '/session', 'GET', null, 'b')
    const created = await api(1, '/events', 'POST', { title: 'Membership cache regression', start: '2099-09-01', isOpkomst: true, participants: [1, 2], guestOpkomstmakers: ['External helper'] }, 'a')
    assert.equal(created.status, 201, JSON.stringify(created.data))
    try {
      assert.deepEqual(created.data.participants, [1, 2])
      assert.deepEqual(created.data.guestOpkomstmakers, ['External helper'])
      const invalid = await api(1, `/events/${created.data.id}`, 'PUT', { participants: [1, 2, 3] }, 'a')
      assert.equal(invalid.status, 400)
      const updated = await api(1, `/events/${created.data.id}`, 'PUT', { title: 'Guest planning', opkomstmakerIds: [2] }, 'a')
      assert.equal(updated.status, 200, JSON.stringify(updated.data))
      assert.deepEqual(updated.data.participants, [1, 2])
      assert.deepEqual(updated.data.guestOpkomstmakers, ['External helper'])
    } finally { assert.equal((await api(1, `/events/${created.data.id}`, 'DELETE', null, 'a')).status, 200) }
  })
  it('onboards atomic global identities using the historical counter and developers attach existing accounts', async () => {
    const created = await api(4, '/users', 'POST', { firstName: 'New', lastName: 'Member', email: 'new@example.test', groupId: 'a' })
    assert.equal(created.status, 201); assert.equal(created.data.user.id, 21)
    assert.equal(db.data.groupMemberships.find(m => m.userId === 21).groupId, 'a')
    const added = await api(4, '/users/21/memberships', 'POST', { groupId: 'b' })
    assert.equal(added.status, 201)
    assert.equal(db.data.users.filter(u => u.id === 21).length, 1)
    assert.equal((await api(1, '/users/2/memberships', 'POST', { groupId: 'b' }, 'b')).status, 403)
    assert.equal((await api(4, '/users/21/memberships', 'POST', { groupId: 'b' })).status, 409)
  })
  it('records private durable declarations and receipts, distinguishes SMTP acceptance, and deduplicates retries', async () => {
    const submitted = await api(1, '/payment-requests', 'POST', { ...payment, requestKey: 'declaration-first' }, 'a')
    assert.equal(submitted.status, 201); assert.equal(submitted.data.declaration.status, 'smtp-accepted')
    const record = submitted.data.declaration
    const count = mail.length
    const retry = await api(1, '/payment-requests', 'POST', { ...payment, requestKey: 'declaration-first' }, 'a')
    assert.equal(retry.status, 200); assert.equal(mail.length, count)
    assert.equal((await api(1, '/payment-requests', 'GET', null, 'b')).data.declarations.length, 0)
    assert.equal((await api(2, `/payment-requests/${record.id}`, 'GET', null, 'a')).status, 404)
    assert.equal((await api(2, `/payment-requests/${record.id}/files/${record.attachments[0].id}`, 'GET', null, 'a')).status, 404)
    assert.equal((await api(1, `/payment-requests/${record.id}/files/${record.attachments[0].id}`, 'GET', null, 'a')).status, 200)
    assert.equal((await api(1, '/payment-requests', 'POST', { ...payment, amount: 99, requestKey: 'declaration-first' }, 'a')).status, 409)
    failMail = true
    const failure = await api(1, '/payment-requests', 'POST', { ...payment, requestKey: 'declaration-failure' }, 'a')
    failMail = false
    assert.equal(failure.status, 500)
    assert.equal(db.data.paymentRequests.find(r => r.requestKey === 'declaration-failure').status, 'delivery-unknown')
    const retryUnknown = await api(1, '/payment-requests', 'POST', { ...payment, requestKey: 'declaration-failure' }, 'a')
    assert.equal(retryUnknown.status, 200); assert.equal(mail.length, count)
    const saved = await storePaymentRequest(createMemoryClient(db), db, { actor: { id: 1, membershipId: memberA.id }, groupId: 'a', requestKey: 'saved-without-send',
      form: { ...record.form, expenseTitle: 'Stored retry' }, attachments: [{ name: 'receipt.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') }] })
    assert.equal(saved.record.status, 'stored')
    assert.equal((await api(1, `/payment-requests/${saved.record.id}/retry`, 'POST', {}, 'a')).status, 201)
    assert.equal(db.data.paymentRequests.find(r => r.id === saved.record.id).status, 'smtp-accepted')
    assert.equal(mail.length, count + 1)
  })
  it('allows scoped admins to attach known emails and manage lifecycle without exposing another group or restoring admin roles', async () => {
    const beforeB = structuredClone(db.data.groupMemberships.filter(m => m.groupId === 'b'))
    assert.equal((await api(1, '/developer/users', 'GET', null, 'a')).status, 403)
    assert.equal((await api(1, '/users/3/memberships', 'GET', null, 'a')).data.memberships.length, 0)
    assert.equal((await api(1, '/memberships/join-existing', 'POST', { email: 'unknown@example.test', groupId: 'a' }, 'a')).status, 404)
    const added = await api(1, '/memberships/join-existing', 'POST', { email: 'user3@example.test', groupId: 'a' }, 'a')
    assert.equal(added.status, 201); assert.equal(added.data.membership.role, 'user')
    assert.equal(db.data.users.filter(u => u.id === 3).length, 1)
    assert.equal((await api(1, '/users/3/memberships', 'GET', null, 'a')).data.memberships.length, 1)
    const m = db.data.groupMemberships.find(m => m.userId === 2 && m.groupId === 'a')
    assert.equal((await api(1, `/memberships/${m.id}`, 'PATCH', { status: 'legacy' }, 'a')).status, 400)
    assert.equal((await api(1, `/memberships/${m.id}`, 'PATCH', { status: 'inactive' }, 'a')).status, 200)
    assert.equal(db.data.groupMemberships.find(item => item.id === m.id).state, 'current')
    const preview = await api(1, `/memberships/${m.id}/end/preview`, 'POST', {}, 'a')
    assert.equal(preview.status, 200)
    assert.equal((await api(1, `/memberships/${m.id}/end`, 'POST', { previewToken: preview.data.previewToken }, 'a')).status, 200)
    assert.equal((await api(2, '/session', 'GET', null, 'a')).data.user.status, 'alumni')
    assert.equal((await api(1, `/memberships/${m.id}/rejoin`, 'POST', { role: 'admin' }, 'a')).status, 403)
    assert.equal((await api(1, `/memberships/${m.id}/rejoin`, 'POST', {}, 'a')).data.membership.role, 'user')
    const foreign = beforeB.find(m => m.userId === 3)
    assert.equal((await api(1, `/memberships/${foreign.id}/end/preview`, 'POST', {}, 'a')).status, 403)
    assert.equal((await api(1, `/memberships/${foreign.id}/rejoin`, 'POST', {}, 'a')).status, 403)
    assert.deepEqual(db.data.groupMemberships.filter(m => m.groupId === 'b'), beforeB)
    const mine = db.data.groupMemberships.find(m => m.id === memberA.id)
    const selfPreview = await api(1, `/memberships/${mine.id}/end/preview`, 'POST', {}, 'a')
    assert.equal((await api(1, `/memberships/${mine.id}/end`, 'POST', { previewToken: selfPreview.data.previewToken }, 'a')).status, 403)
  })
  it('ends a membership without touching history, removes ten upcoming events from the same URL and retains Alumni history', async () => {
    const subscription = (await api(1, '/calendar/subscription', 'GET', null, 'a')).data.url
    const other = (await api(1, '/calendar/subscription', 'GET', null, 'b')).data.url
    assert.notEqual(subscription, other)
    const preview = await api(4, `/memberships/${memberA.id}/end/preview`, 'POST', {})
    assert.equal(preview.status, 200); assert.equal(preview.data.summary.futureEvents, 10)
    const ended = await api(4, `/memberships/${memberA.id}/end`, 'POST', { previewToken: preview.data.previewToken, revision: memberA._revision })
    assert.equal(ended.status, 200)
    const visible = await api(1, '/events', 'GET', null, 'a')
    assert.deepEqual(visible.data.events.map(e => e.id), ['past'])
    const feed = await api(null, subscription.replace('/api', ''))
    assert.ok(feed.data.includes('UID:past@stamjer.nl')); assert.ok(!feed.data.includes('UID:future-'))
    assert.equal((await api(1, '/calendar/subscription', 'GET', null, 'a')).data.url, subscription)
    assert.equal((await api(1, '/events/opkomsten', 'GET', null, 'a')).status, 403)
    assert.equal((await api(1, '/events/past', 'GET', null, 'a')).status, 200)
    assert.equal((await api(1, '/events/future-0', 'GET', null, 'a')).status, 404)
    assert.equal((await api(1, '/users', 'GET', null, 'a')).status, 403)
    assert.equal((await api(1, '/payment-requests', 'GET', null, 'a')).data.declarations.length, 3)
    const ownRecord = db.data.paymentRequests.find(r => r.userId === 1 && r.groupId === 'a')
    assert.equal((await api(1, `/payment-requests/${ownRecord.id}/retry`, 'POST', {}, 'a')).status, 403)
    const count = mail.length
    assert.equal((await api(1, '/payment-requests', 'POST', { ...payment, attachments: [{ content: 'invalid' }], requestKey: 'alumni-denied' }, 'a')).status, 403)
    assert.equal(mail.length, count)
    assert.equal((await api(1, '/events/past/attendance', 'PUT', { attending: true }, 'a')).status, 403)
    assert.equal((await api(1, '/events/past', 'PUT', { title: 'Denied' }, 'a')).status, 403)
    assert.equal((await api(1, '/users/full', 'GET', null, 'a')).data.users[0].streepjes, 1)
    assert.equal((await api(1, '/session', 'GET', null, 'b')).data.user.membershipState, 'current')
    assert.equal((await api(null, '/calendar.ics?groupId=a&token=' + 'a'.repeat(43))).status, 401)
  })
  it('shows period events regardless of publication and hides gap events, resumes the same subscription after rejoining, and revokes only one URL', async () => {
    const subscription = (await api(1, '/calendar/subscription', 'GET', null, 'a')).data.url
    const bSubscription = (await api(1, '/calendar/subscription', 'GET', null, 'b')).data.url
    db.data.events.push({ id: 'backdated', groupId: 'a', title: 'Late publication', start: '2025-05-01', publishedAt: '2090-01-01T00:00:00Z', participants: [], attendanceMeta: {} })
    const m = db.data.groupMemberships.find(m => m.id === memberA.id)
    m.periods.at(-1).endedAt = '2026-01-01T00:00:00Z'
    db.data.events.push({ id: 'gap', groupId: 'a', title: 'Gap', start: '2026-05-01', publishedAt: '2025-01-01T00:00:00Z', participants: [], attendanceMeta: {} })
    const rejoin = await api(4, `/memberships/${memberA.id}/rejoin`, 'POST', { revision: m._revision })
    assert.equal(rejoin.status, 200)
    const session = (await api(1, '/session', 'GET', null, 'a')).data.user
    assert.equal(session.role, 'user'); assert.equal(session.memberships.find(m => m.id === memberA.id).periods.length, 2)
    const visible = (await api(1, '/events', 'GET', null, 'a')).data.events.map(e => e.id)
    assert.ok(visible.includes('past') && visible.includes('future-0')); assert.ok(!visible.includes('gap') && visible.includes('backdated'))
    const feed = (await api(null, subscription.replace('/api', ''))).data
    for (const id of visible) assert.ok(feed.includes(`UID:${id}@stamjer.nl`))
    assert.ok(!feed.includes('UID:gap@') && feed.includes('UID:backdated@'))
    assert.equal((await api(1, '/calendar/subscription', 'GET', null, 'a')).data.url, subscription)
    assert.equal((await api(1, `/memberships/${memberA.id}/calendar-token/rotate`, 'POST', {}, 'a')).status, 200)
    assert.equal((await api(null, subscription.replace('/api', ''))).status, 401)
    assert.equal((await api(null, bSubscription.replace('/api', ''))).status, 200)
    assert.equal((await api(1, '/payment-requests', 'POST', { ...payment, requestKey: 'rejoined-declaration' }, 'a')).status, 201)
  })
  it('captures immutable publication times, enforces new attendance start time and sees demotions on the next request', async () => {
    const created = await api(4, '/events', 'POST', { title: 'New event', start: '2099-04-01', groupId: 'a', isOpkomst: true })
    assert.equal(created.status, 201)
    const stored = db.data.events.find(e => e.id === created.data.id)
    assert.ok(stored.publishedAt)
    assert.equal((await api(4, `/events/${stored.id}`, 'PUT', { attendance: { 1: false } })).status, 400)
    assert.equal((await api(4, `/events/${stored.id}`, 'PUT', { publishedAt: '2020-01-01' })).status, 400)
    const b = db.data.groupMemberships.find(m => m.userId === 3)
    assert.equal((await api(4, `/memberships/${b.id}`, 'PATCH', { role: 'user', revision: b._revision })).status, 200)
    assert.equal((await api(3, '/events/b-event', 'PUT', { title: 'No longer admin' }, 'b')).status, 403)
  })
  it('keeps curated database identity edits global and membership documents read-only', async () => {
    const records = await api(4, '/developer/database/users?groupId=b')
    assert.equal(records.status, 200)
    assert.ok(records.data.records.some(item => item.record.id === 1))
    assert.ok(records.data.records.every(item => !Object.hasOwn(item.editable || {}, 'role')))
    const preview = await api(4, '/developer/database/users/2/preview', 'POST', { firstName: 'Reviewed global identity' })
    assert.equal(preview.status, 200)
    const applied = await api(4, '/developer/database/users/2', 'PATCH', { patch: { firstName: 'Reviewed global identity' }, previewToken: preview.data.previewToken })
    assert.equal(applied.status, 200)
    assert.equal(db.data.users.find(u => u.id === 2).firstName, 'Reviewed global identity')
    assert.equal(db.data.groupMemberships.find(m => m.userId === 2).status, 'active')
    assert.equal((await api(4, '/developer/database/users/2/preview', 'POST', { role: 'admin' })).status, 400)
    const memberships = await api(4, '/developer/database/groupMemberships?groupId=a')
    assert.equal(memberships.status, 200)
    assert.ok(memberships.data.records.every(item => item.editable === null && item.record.calendarTokenVersion === undefined))
  })
})

describe('event guests, declaration validation and retained group features', () => {
  it('saves guest names without accounts, preserves them on edits and protects historical assignments', async () => {
    const identities = db.data.users.length
    const created = await api(4, '/events', 'POST', { groupId: 'a', title: 'Outdoor cooking', start: '2099-05-01T20:00', isOpkomst: true, guestOpkomstmakers: [' Guest, Jr. ', 'Zoë'] })
    assert.equal(created.status, 201)
    assert.deepEqual(created.data.guestOpkomstmakers, ['Guest, Jr.', 'Zoë'])
    assert.deepEqual(created.data.opkomstmakerNames, ['Guest, Jr.', 'Zoë'])
    assert.deepEqual(created.data.opkomstmakerIds, [])
    assert.equal(db.data.users.length, identities)
    const updated = await api(4, `/events/${created.data.id}`, 'PUT', { title: 'Outdoor cooking and games' })
    assert.equal(updated.status, 200)
    assert.deepEqual(updated.data.guestOpkomstmakers, ['Guest, Jr.', 'Zoë'])
    const visible = await api(1, `/events/${created.data.id}`, 'GET', null, 'a')
    assert.deepEqual(visible.data.event.guestOpkomstmakers, ['Guest, Jr.', 'Zoë'])
    const calendar = await api(1, '/events', 'GET', null, 'a')
    assert.deepEqual(calendar.data.events.find(event => event.id === created.data.id).opkomstmakerNames, ['Guest, Jr.', 'Zoë'])
    assert.equal((await api(4, '/events/past', 'PUT', { guestOpkomstmakers: ['New historical guest'] })).status, 403)
    assert.equal((await api(4, '/events/past', 'PUT', { title: 'Past title remains editable', guestOpkomstmakers: [] })).status, 200)
    assert.equal((await api(4, `/events/${created.data.id}`, 'PUT', { guestOpkomstmakers: [] })).status, 200)
  })

  it('rejects malformed declarations before saving or mailing them', async () => {
    const before = db.data.paymentRequests.length
    const sent = mail.length
    const invalid = ['12abc', '12,50abc', '1.234,56', '1,234.56', '12.345', '1e3', '-1', 0, null, {}].map(amount => ({ amount }))
    invalid.push({ paymentMethod: 'cash' }, { paymentLink: 'ftp://example.com/pay' }, { attachments: 'invalid' },
      { attachments: [{ name: 'fake.pdf', type: 'application/pdf', content: Buffer.from('This is not a PDF').toString('base64') }] })
    for (const [index, patch] of invalid.entries()) {
      const result = await api(1, '/payment-requests', 'POST', { ...payment, ...patch, requestKey: `invalid-payment-${index}` }, 'a')
      assert.equal(result.status, 400, JSON.stringify(patch))
    }
    assert.equal(db.data.paymentRequests.length, before)
    assert.equal(mail.length, sent)
  })

  it('stores exact cents for both separators, deduplicates equivalent retries and accepts Unicode text', async () => {
    const request = { ...payment, amount: '12,50', requestKey: 'comma-amount-test', description: 'Supplies 🧭. ' + 'Long description. '.repeat(250),
      attachments: [{ ...payment.attachments[0], name: 'bon 🧾.pdf' }] }
    const created = await api(1, '/payment-requests', 'POST', request, 'a')
    assert.equal(created.status, 201)
    assert.equal(created.data.declaration.form.amount, 12.5)
    assert.equal(created.data.declaration.form.description, request.description.trim())
    assert.ok(mail.at(-1).html.includes('Supplies 🧭.'))
    const count = mail.length
    const retry = await api(1, '/payment-requests', 'POST', { ...request, amount: '12.50' }, 'a')
    assert.equal(retry.status, 200)
    assert.equal(retry.data.declaration.id, created.data.declaration.id)
    assert.equal(mail.length, count)
  })

  it('reports mailserver rejection without claiming the declaration was sent', async () => {
    rejectMail = true
    let result
    try { result = await api(1, '/payment-requests', 'POST', { ...payment, requestKey: 'smtp-rejected-test' }, 'a') }
    finally { rejectMail = false }
    assert.equal(result.status, 502)
    assert.equal(result.data.declaration.status, 'delivery-failed')
    assert.match(result.data.msg, /geweigerd/)
    const sent = mail.length
    assert.equal((await api(1, '/payment-requests', 'POST', { ...payment, requestKey: 'smtp-rejected-test' }, 'a')).status, 200)
    assert.equal(mail.length, sent)
  })

  it('hides declarations and streepjes per group and restores all records, receipts and totals', async () => {
    const events = structuredClone(db.data.events)
    const declarations = structuredClone(db.data.paymentRequests)
    const files = structuredClone(db.data.paymentRequestFiles)
    const total = (await api(1, '/users/full', 'GET', null, 'a')).data.users[0].streepjes
    const record = db.data.paymentRequests.find(record => record.userId === 1 && record.groupId === 'a')
    assert.equal((await api(1, '/groups/a', 'PATCH', { settings: { enableStreepjes: false } }, 'a')).status, 403)
    assert.equal((await api(4, '/groups/a', 'PATCH', { settings: { enableStreepjes: false, enablePaymentRequests: false } })).status, 200)
    try {
      const session = (await api(1, '/session', 'GET', null, 'a')).data.user
      assert.equal(session.permissions.canUseStreepjes, false)
      assert.equal(session.permissions.canUsePaymentRequests, false)
      assert.equal(session.memberships.find(m => m.groupId === 'a').permissions.canUseStreepjes, false)
      assert.equal(session.memberships.find(m => m.groupId === 'b').permissions.canUseStreepjes, true)
      assert.equal(Object.hasOwn((await api(1, '/users/full', 'GET', null, 'a')).data.users[0], 'streepjes'), false)
      assert.equal((await api(1, '/payment-requests', 'GET', null, 'a')).status, 403)
      assert.equal((await api(1, `/payment-requests/${record.id}/files/${record.attachments[0].id}`, 'GET', null, 'a')).status, 403)
      assert.equal((await api(1, '/payment-requests', 'POST', { ...payment, requestKey: 'feature-disabled' }, 'a')).status, 403)
      assert.deepEqual(db.data.events, events)
      assert.deepEqual(db.data.paymentRequests, declarations)
      assert.deepEqual(db.data.paymentRequestFiles, files)
    } finally {
      assert.equal((await api(4, '/groups/a', 'PATCH', { settings: { enableStreepjes: true, enablePaymentRequests: true } })).status, 200)
    }
    assert.equal((await api(1, '/session', 'GET', null, 'a')).data.user.permissions.canUseStreepjes, true)
    assert.equal((await api(1, '/users/full', 'GET', null, 'a')).data.users[0].streepjes, total)
    assert.equal((await api(1, '/payment-requests', 'GET', null, 'a')).data.declarations.length, declarations.filter(record => record.userId === 1 && record.groupId === 'a').length)
    assert.equal((await api(1, `/payment-requests/${record.id}/files/${record.attachments[0].id}`, 'GET', null, 'a')).status, 200)
    assert.deepEqual(db.data.events, events)
    assert.deepEqual(db.data.paymentRequests, declarations)
    assert.deepEqual(db.data.paymentRequestFiles, files)
  })
})

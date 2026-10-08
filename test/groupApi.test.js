import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import bcrypt from 'bcrypt'
import nodemailer from 'nodemailer'
import { createMemoryClient, createMemoryDb } from '../test-support/memoryDb.js'

let db
let server
let origin
const cookies = {}
const sentMail = []

before(async () => {
  // Prevent dotenv from selecting a real DB. The existing client injection and
  // stub mail transport keep this HTTP test entirely local.
  Object.assign(process.env, {
    MONGODB_URI: 'mongodb://unused.invalid', VERCEL: '1', NODE_ENV: 'test',
    TOKEN_SECRET: 'group-isolation-test-only', SESSION_COOKIE_NAME: 'stamjer_session',
    SMTP_HOST: 'unused.invalid'
  })
  const password = await bcrypt.hash('test-password', 4)
  db = createMemoryDb({
    groups: [
      { id: 'stam-default', slug: 'stam-default', status: 'active', settings: { dailyChangeEmail: 'stam@example.test', paymentRequestEmail: 'stam-pay@example.test' } },
      { id: 'explorers', slug: 'explorers', status: 'active', settings: { dailyChangeEmail: 'explorers@example.test', paymentRequestEmail: 'explorers-pay@example.test' } },
      { id: 'archived', slug: 'archived', status: 'archived', settings: {} }
    ],
    users: [
      { id: 1, firstName: 'Member', lastName: 'Stam', email: 'member@example.test', password, status: 'active' },
      { id: 2, firstName: 'Admin', lastName: 'Stam', email: 'admin@example.test', password, isAdmin: true, status: 'active' },
      { id: 3, firstName: 'Foreign', lastName: 'Admin', email: 'foreign@example.test', password, role: 'admin', groupId: 'explorers', status: 'active' },
      { id: 4, firstName: 'Developer', lastName: 'Account', email: 'developer@example.test', password, role: 'developer', groupId: null },
      { id: 5, firstName: 'Alumni', lastName: 'Stam', email: 'alumni@example.test', password, status: 'legacy' }
    ],
    events: [
      { id: 'stam-event', title: 'Stam calendar', start: '2099-10-01T20:00:00', isOpkomst: true, participants: [1, 2], attendance: { 1: false } },
      { id: 'foreign-event', groupId: 'explorers', title: 'Explorer calendar', start: '2099-10-01T20:00:00', isOpkomst: true, participants: [3], attendance: { 3: false } },
      { id: 'archived-event', groupId: 'archived', title: 'Archived calendar', start: '2099-10-01T20:00:00', isOpkomst: true, participants: [] }
    ]
  })
  global._mongoClientPromise = Promise.resolve(createMemoryClient(db))
  const originalCreateTransport = nodemailer.createTransport
  nodemailer.createTransport = () => ({
    async verify() { return true },
    async sendMail(message) { sentMail.push(message); return { messageId: 'test-only' } }
  })
  let app
  try {
    app = (await import('../api/index.js')).default
  } finally {
    nodemailer.createTransport = originalCreateTransport
  }
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  for (const name of ['member', 'admin', 'foreign', 'developer', 'alumni']) {
    const response = await fetch(`${origin}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${name}@example.test`, password: 'test-password' })
    })
    assert.equal(response.status, 200)
    cookies[name] = response.headers.get('set-cookie').split(';')[0]
  }
})

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  delete global._mongoClientPromise
})

async function api(actor, path, method = 'GET', body) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: { ...(actor ? { Cookie: cookies[actor] } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text()
  return { status: response.status, data }
}

describe('group API over real HTTP with local DB/mail substitutes', () => {
  it('returns canonical role/group in session responses and keeps developers outside groups', async () => {
    const admin = await api('admin', '/session')
    assert.equal(admin.data.user.role, 'admin')
    assert.equal(admin.data.user.groupId, 'stam-default')
    assert.equal(admin.data.user.permissions.canManageUsers, true)
    assert.equal(admin.data.user.permissions.canUsePaymentRequests, true)
    assert.equal(admin.data.user.password, undefined)
    const developer = await api('developer', '/session')
    assert.equal(developer.data.user.role, 'developer')
    assert.equal(developer.data.user.groupId, null)
    assert.equal(developer.data.user.isAdmin, false)
    assert.equal(developer.data.user.permissions.canUseAttendance, false)
    assert.equal(developer.data.user.permissions.canUsePaymentRequests, false)
  })

  it('filters user lists and keeps full profiles private for ordinary members', async () => {
    assert.deepEqual((await api('admin', '/users')).data.map(({ id }) => id), [1, 2, 5])
    assert.deepEqual((await api('foreign', '/users')).data.map(({ id }) => id), [3])
    const self = await api('member', '/users/full')
    assert.deepEqual(self.data.users.map(({ id }) => id), [1])
    assert.equal(self.data.users[0].streepjes, 1)
    assert.equal((await api('admin', '/users?groupId=explorers')).status, 403)
    assert.equal((await api('member', '/users?allGroups=true')).status, 403)
    assert.equal((await api('developer', '/users')).status, 400)
    assert.deepEqual((await api('developer', '/users?groupId=explorers')).data.map(({ id }) => id), [3])
    assert.deepEqual((await api('developer', '/users?allGroups=true')).data.map(({ id }) => id), [1, 2, 3, 5])
    assert.equal((await api(null, '/users?userId=2')).status, 401)
  })

  it('filters calendar/opkomsten and ignores spoofed profile user IDs', async () => {
    for (const path of ['/events', '/events/opkomsten']) {
      assert.deepEqual((await api('member', path)).data.events.map(({ id }) => id), ['stam-event'])
      assert.equal((await api('admin', `${path}?groupId=explorers`)).status, 403)
      assert.deepEqual((await api('developer', `${path}?groupId=explorers`)).data.events.map(({ id }) => id), ['foreign-event'])
    }
    assert.equal((await api('member', '/user/profile?userId=3')).data.user.id, 1)
  })

  it('blocks foreign event/status mutations and member admin actions', async () => {
    const before = structuredClone(db.data.events.find(({ id }) => id === 'foreign-event'))
    assert.equal((await api('admin', '/events/foreign-event', 'PUT', { title: 'Forbidden' })).status, 404)
    assert.equal((await api('admin', '/events/foreign-event', 'DELETE')).status, 404)
    assert.equal((await api('admin', '/users/3/status', 'PATCH', { status: 'inactive' })).status, 404)
    assert.equal((await api('member', '/events/stam-event', 'PUT', { title: 'Forbidden' })).status, 403)
    assert.deepEqual(db.data.events.find(({ id }) => id === 'foreign-event'), before)
  })

  it('validates every event membership field including streepjes attendance', async () => {
    for (const field of ['participants', 'opkomstmakerIds', 'schoonmakerIds']) {
      assert.equal((await api('admin', '/events/stam-event', 'PUT', { [field]: [3] })).status, 400)
      assert.equal((await api('admin', '/events/stam-event', 'PUT', { [field]: [4] })).status, 400)
    }
    assert.equal((await api('admin', '/events/stam-event', 'PUT', { attendance: { 3: true } })).status, 400)
    assert.equal((await api('member', '/events/foreign-event/attendance', 'PUT', { userId: 1, attending: true })).status, 404)
    assert.equal((await api('admin', '/events/stam-event/attendance', 'PUT', { userId: 3, attending: true })).status, 403)
    assert.equal((await api('developer', '/events/foreign-event/attendance', 'PUT', { userId: 1, attending: true })).status, 403)
    assert.equal((await api('developer', '/events/stam-event/attendance', 'PUT', { userId: 4, attending: true })).status, 403)
  })

  it('auto-adds only active members of the selected group when creating an opkomst', async () => {
    const own = await api('admin', '/events', 'POST', { title: 'New stam event', start: '2099-11-01T20:00:00', isOpkomst: true })
    assert.equal(own.status, 201)
    assert.equal(own.data.groupId, 'stam-default')
    assert.deepEqual(own.data.participants, [1, 2])
    const foreign = await api('developer', '/events', 'POST', { groupId: 'explorers', title: 'New explorer event', start: '2099-11-01T20:00:00', isOpkomst: true })
    assert.equal(foreign.status, 201)
    assert.deepEqual(foreign.data.participants, [3])
    assert.equal((await api('admin', '/events', 'POST', { groupId: 'explorers', title: 'Forbidden', start: '2099-01-01' })).status, 403)
  })

  it('lets developers manage other groups, with archived groups kept read-only', async () => {
    assert.equal((await api('developer', '/events/foreign-event', 'PUT', { title: 'Developer updated' })).status, 200)
    assert.equal((await api('developer', '/events/foreign-event?groupId=stam-default', 'PUT', { title: 'Mismatch' })).status, 400)
    assert.equal((await api('developer', '/events/archived-event', 'PUT', { title: 'Forbidden' })).status, 403)
    assert.equal((await api('developer', '/user/profile', 'PUT', { status: 'inactive' })).status, 403)
  })

  it('syncs user status within a group and emails only that group', async () => {
    const foreignBefore = structuredClone(db.data.events.find(({ id }) => id === 'foreign-event'))
    assert.equal((await api('member', '/user/profile', 'PUT', { status: 'inactive' })).status, 200)
    assert.equal(db.data.events.find(({ id }) => id === 'stam-event').participants.includes(1), false)
    assert.deepEqual(db.data.events.find(({ id }) => id === 'foreign-event'), foreignBefore)
    assert.equal(sentMail.at(-1).to, 'stam@example.test')
    assert.equal((await api('developer', '/users/3/status', 'PATCH', { status: 'inactive' })).status, 200)
    assert.equal(sentMail.at(-1).to, 'explorers@example.test')
  })

  it('creates regular users in the admin group and reserves admin creation for developers', async () => {
    const result = await api('admin', '/users', 'POST', { firstName: 'New', lastName: 'Member', email: 'new@example.test' })
    assert.equal(result.status, 201)
    assert.equal(result.data.user.groupId, 'stam-default')
    assert.equal(result.data.user.role, 'user')
    assert.equal(result.data.user.password, undefined)
    assert.equal(db.data.events.find(({ id }) => id === 'stam-event').participants.includes(result.data.user.id), true)
    assert.equal(db.data.events.find(({ id }) => id === 'foreign-event').participants.includes(result.data.user.id), false)
    assert.equal((await api('admin', '/users', 'POST', { firstName: 'New', lastName: 'Admin', email: 'newadmin@example.test', isAdmin: true })).status, 403)
    assert.equal((await api('admin', '/users', 'POST', { firstName: 'New', lastName: 'Other', email: 'newother@example.test', groupId: 'explorers' })).status, 403)
    const newAdmin = await api('developer', '/users', 'POST', { firstName: 'New', lastName: 'Admin', email: 'newadmin@example.test', groupId: 'explorers', role: 'admin' })
    assert.equal(newAdmin.status, 201)
    assert.equal(newAdmin.data.user.role, 'admin')
  })

  it('disables declarations per group for existing sessions and restores them without changing recipients', async () => {
    const path = '/groups/stam-default'
    const patch = { settings: { enablePaymentRequests: false } }
    for (const actor of [null, 'member', 'admin']) {
      assert.equal((await api(actor, path, 'PATCH', patch)).status, actor ? 403 : 401)
    }
    assert.equal((await api('developer', path, 'PATCH', { settings: { enablePaymentRequests: 'false' } })).status, 400)
    const disabled = await api('developer', path, 'PATCH', patch)
    assert.equal(disabled.status, 200)
    assert.equal(disabled.data.group.settings.enablePaymentRequests, false)
    assert.equal(disabled.data.group.settings.paymentRequestEmail, 'stam-pay@example.test')
    assert.equal((await api('developer', path)).data.group.settings.enablePaymentRequests, false)
    assert.equal(db.data.groups.find(group => group.id === 'stam-default').settings.enablePaymentRequests, false)
    const audit = db.data.auditLogs.at(-1)
    assert.equal(audit.action, 'group-updated')
    assert.equal(audit.groupId, 'stam-default')
    assert.ok(audit.changedFields.includes('settings'))
    try {
      for (const actor of ['member', 'admin', 'alumni']) {
        assert.equal((await api(actor, '/session')).data.user.permissions.canUsePaymentRequests, false)
      }
      const login = await api(null, '/login', 'POST', { email: 'member@example.test', password: 'test-password' })
      assert.equal(login.status, 200)
      assert.equal(login.data.user.permissions.canUsePaymentRequests, false)
      assert.equal((await api('foreign', '/session')).data.user.permissions.canUsePaymentRequests, true)
      const count = sentMail.length
      for (const actor of ['member', 'admin', 'alumni', 'developer']) {
        const result = await api(actor, '/payment-requests', 'POST', { groupId: 'stam-default', attachments: 'invalid' })
        assert.equal(result.status, 403)
        assert.equal(result.data.error, 'Declaraties zijn uitgeschakeld voor deze groep.')
      }
      assert.equal(sentMail.length, count)
      const request = {
        requesterName: 'Stam Member', requesterEmail: 'member@example.test',
        expenseTitle: 'Groepskosten', paidTo: 'Winkel', expenseDate: '2026-10-01', amount: '12.50',
        paymentMethod: 'paymentLink', paymentLink: 'https://example.com/payment', attachments: []
      }
      assert.equal((await api('foreign', '/payment-requests', 'POST', request)).status, 201)
      assert.equal(sentMail.at(-1).to, 'explorers-pay@example.test')
      const enabled = await api('developer', path, 'PATCH', { settings: { enablePaymentRequests: true } })
      assert.equal(enabled.status, 200)
      assert.equal(enabled.data.group.settings.paymentRequestEmail, 'stam-pay@example.test')
      assert.equal((await api('member', '/session')).data.user.permissions.canUsePaymentRequests, true)
      const enabledLogin = await api(null, '/login', 'POST', { email: 'member@example.test', password: 'test-password' })
      assert.equal(enabledLogin.data.user.permissions.canUsePaymentRequests, true)
      assert.equal((await api('member', '/payment-requests', 'POST', request)).status, 201)
      assert.equal(sentMail.at(-1).to, 'stam-pay@example.test')
    } finally {
      await api('developer', path, 'PATCH', { settings: { enablePaymentRequests: true } })
    }
  })

  it('routes payment requests to the actor group and rejects unconfigured recipients', async () => {
    const request = {
      requesterName: 'Foreign Admin', requesterEmail: 'foreign@example.test',
      expenseTitle: 'Groepskosten', paidTo: 'Winkel', expenseDate: '2026-10-01', amount: '12.50',
      paymentMethod: 'paymentLink', paymentLink: 'https://example.com/payment', attachments: []
    }
    assert.equal((await api('foreign', '/payment-requests', 'POST', request)).status, 201)
    assert.equal(sentMail.at(-1).to, 'explorers-pay@example.test')
    assert.equal((await api('foreign', '/payment-requests', 'POST', { ...request, groupId: 'stam-default' })).status, 403)
    const group = db.data.groups.find(({ id }) => id === 'explorers')
    delete group.settings.paymentRequestEmail
    const count = sentMail.length
    assert.equal((await api('foreign', '/payment-requests', 'POST', request)).status, 503)
    assert.equal(sentMail.length, count)
  })

  it('issues stable secret group calendar feeds without exposing other groups or internal fields', async () => {
    assert.equal((await api(null, '/calendar.ics')).status, 401)
    const stam = await api('member', '/calendar/subscription')
    const foreign = await api('foreign', '/calendar/subscription')
    assert.equal(stam.status, 200)
    assert.equal((await api('admin', '/calendar/subscription')).data.url, stam.data.url)
    const stamFeed = await api(null, stam.data.url.replace('/api', ''))
    assert.equal(stamFeed.status, 200)
    assert.match(stamFeed.data, /SUMMARY:Stam calendar/)
    assert.doesNotMatch(stamFeed.data, /Developer updated|Explorer calendar|ATTENDEE|DESCRIPTION/)
    const foreignFeed = await api(null, foreign.data.url.replace('/api', ''))
    assert.match(foreignFeed.data, /SUMMARY:Developer updated/)
    assert.doesNotMatch(foreignFeed.data, /SUMMARY:Stam calendar/)
    const swapped = stam.data.url.replace('groupId=stam-default', 'groupId=explorers').replace('/api', '')
    assert.equal((await api(null, swapped)).status, 401)
    assert.equal((await api('admin', '/calendar/subscription?groupId=explorers')).status, 403)
    assert.equal((await api('developer', '/calendar.ics?allGroups=true')).status, 400)
  })

  it('restricts group management to developers and never returns feed credentials', async () => {
    assert.equal((await api(null, '/groups')).status, 401)
    assert.equal((await api('admin', '/groups')).status, 403)
    assert.equal((await api('member', '/groups/explorers')).status, 403)
    const result = await api('developer', '/groups')
    assert.equal(result.status, 200)
    assert.equal(result.data.groups.length, 3)
    assert.doesNotMatch(JSON.stringify(result.data), /calendarFeedToken|password/)
    const summary = await api('developer', '/groups/explorers/summary')
    assert.ok(summary.data.summary.users > 0)
    assert.equal((await api('developer', '/groups/explorers/users')).data.users.every(user => user.groupId === 'explorers'), true)
    assert.equal((await api('developer', '/groups/explorers/events')).data.events.every(event => event.groupId === 'explorers'), true)
  })

  it('creates and edits group settings, rejects invalid fields and archives without deleting data', async () => {
    const created = await api('developer', '/groups', 'POST', { id: 'rovers', name: 'Rovers', settings: { paymentRequestEmail: 'rovers@example.test', enablePaymentRequests: false } })
    assert.equal(created.status, 201)
    assert.equal(created.data.group.settings.enablePaymentRequests, false)
    assert.equal((await api('developer', '/groups/rovers')).data.group.settings.enablePaymentRequests, false)
    assert.equal((await api('developer', '/groups', 'POST', { id: 'rovers', name: 'Duplicate' })).status, 409)
    assert.equal((await api('developer', '/groups/rovers', 'PATCH', { id: 'other' })).status, 400)
    assert.equal((await api('developer', '/groups/rovers', 'PATCH', { settings: { paymentRequestEmail: 'invalid' } })).status, 400)
    const updated = await api('developer', '/groups/rovers', 'PATCH', { settings: { calendarName: 'Rovers agenda' }, status: 'archived' })
    assert.equal(updated.status, 200)
    assert.equal(updated.data.group.settings.paymentRequestEmail, 'rovers@example.test')
    assert.equal(updated.data.group.settings.calendarName, 'Rovers agenda')
    assert.equal(updated.data.group.settings.enablePaymentRequests, false)
    assert.equal((await api('developer', '/events', 'POST', { groupId: 'rovers', title: 'Archived', start: '2099-01-01' })).status, 403)
    assert.equal((await api('developer', '/groups/rovers', 'PATCH', { status: 'active' })).status, 200)
    assert.equal((await api('developer', '/groups/rovers', 'PATCH', { slug: 'explorers' })).status, 409)
  })

  it('enforces self-attendance settings server-side while keeping admin management available', async () => {
    assert.equal((await api('developer', '/groups/stam-default', 'PATCH', { settings: { allowUserSelfAttendance: false, calendarName: 'Stam groep' } })).status, 200)
    assert.equal((await api('member', '/session')).data.user.permissions.canUseAttendance, false)
    assert.equal((await api('member', '/user/profile', 'PUT', { status: 'active' })).status, 403)
    assert.equal((await api('member', '/events/stam-event/attendance', 'PUT', { attending: true })).status, 403)
    assert.equal((await api('admin', '/events/stam-event/attendance', 'PUT', { userId: 1, attending: true })).status, 200)
    assert.match((await api('member', '/calendar.ics')).data, /X-WR-CALNAME:Stam groep/)
    await api('developer', '/groups/stam-default', 'PATCH', { settings: { allowUserSelfAttendance: true } })
  })

  it('rotates group calendar credentials and invalidates only the previous feed', async () => {
    const old = (await api('member', '/calendar/subscription')).data.url.replace('/api', '')
    const foreign = (await api('foreign', '/calendar/subscription')).data.url.replace('/api', '')
    assert.equal((await api('admin', '/groups/stam-default/calendar-token/rotate', 'POST')).status, 403)
    const result = await api('developer', '/groups/stam-default/calendar-token/rotate', 'POST')
    assert.equal(result.status, 200)
    assert.doesNotMatch(JSON.stringify(result.data), /calendarFeedToken/)
    assert.equal((await api(null, old)).status, 401)
    assert.equal((await api(null, foreign)).status, 200)
    const current = (await api('member', '/calendar/subscription')).data.url.replace('/api', '')
    assert.notEqual(current, old)
    assert.equal((await api(null, current)).status, 200)
  })

  it('refreshes archive permissions on existing sessions and preserves read access and history', async () => {
    const before = structuredClone({ users: db.data.users, events: db.data.events })
    assert.equal((await api('developer', '/groups/stam-default', 'PATCH', { status: 'archived' })).status, 200)
    const admin = (await api('admin', '/session')).data.user
    assert.equal(admin.permissions.canManageUsers, false)
    assert.equal(admin.permissions.canUseAttendance, false)
    assert.equal((await api('admin', '/users/full')).status, 200)
    assert.equal((await api('member', '/events')).status, 200)
    assert.equal((await api('admin', '/users/1', 'PATCH', { firstName: 'Forbidden' })).status, 403)
    assert.equal((await api('developer', '/users/1', 'PATCH', { status: 'active' })).status, 403)
    assert.equal((await api('admin', '/users/1/status', 'PATCH', { status: 'active' })).status, 403)
    assert.equal((await api('member', '/events/stam-event/attendance', 'PUT', { attending: true })).status, 403)
    assert.deepEqual({ users: db.data.users, events: db.data.events }, before)
    assert.equal((await api('developer', '/groups/stam-default', 'PATCH', { status: 'active' })).status, 200)
    assert.equal((await api('admin', '/session')).data.user.permissions.canManageUsers, true)
  })

  it('supports same-group user edits and developer-only role changes without allowing moves', async () => {
    assert.equal((await api('member', '/users/2', 'PATCH', { firstName: 'Forbidden' })).status, 403)
    assert.equal((await api('admin', '/users/3', 'PATCH', { firstName: 'Foreign' })).status, 404)
    assert.equal((await api('admin', '/users/1', 'PATCH', { role: 'admin' })).status, 403)
    assert.equal((await api('developer', '/users/1', 'PATCH', { groupId: 'explorers' })).status, 400)
    assert.equal((await api('developer', '/users/1/role', 'PATCH', { role: 'developer' })).status, 400)
    const beforeForeign = structuredClone(db.data.events.find(event => event.id === 'foreign-event'))
    const edited = await api('admin', '/users/1', 'PATCH', { firstName: 'Edited member', status: 'inactive' })
    assert.equal(edited.status, 200)
    assert.equal(edited.data.user.firstName, 'Edited member')
    assert.equal(edited.data.user.password, undefined)
    assert.deepEqual(db.data.events.find(event => event.id === 'foreign-event'), beforeForeign)
    assert.equal((await api('admin', '/users/1', 'PATCH', { email: 'ADMIN@example.test' })).status, 409)
    const promoted = await api('developer', '/users/1/role', 'PATCH', { role: 'admin' })
    assert.equal(promoted.status, 200)
    assert.equal(promoted.data.user.isAdmin, true)
    assert.equal((await api('member', '/session')).status, 401)
    assert.equal((await api('developer', '/users/4', 'PATCH', { status: 'active' })).status, 400)
  })

  it('retires transfer endpoints without changing either group or revoking sessions', async () => {
    const before = structuredClone(db.data)
    for (const actor of ['admin', 'developer', 'foreign']) {
      assert.equal((await api(actor, '/users/1/group/preview', 'POST', { groupId: 'explorers' })).status, 410)
      assert.equal((await api(actor, '/users/1/group', 'PATCH', { groupId: 'explorers', previewToken: 'old' })).status, 410)
    }
    assert.deepEqual(db.data, before)
  })

  it('authorizes with current database roles even when another process changes a freshly cached account', async () => {
    assert.equal((await api('foreign', '/users/group-history')).status, 200)
    const foreign = db.data.users.find(user => user.id === 3)
    foreign.role = 'user'
    assert.equal((await api('foreign', '/users/group-history')).status, 403)
    assert.equal((await api('foreign', '/session')).data.user.role, 'user')
    assert.deepEqual((await api('foreign', '/users/full')).data.users.map(user => user.id), [3])
    foreign.role = 'admin'
    assert.equal((await api('foreign', '/session')).data.user.role, 'admin')
  })

  it('preserves historical inactive assignments and validates new selections and event dates', async () => {
    const created = await api('developer', '/events', 'POST', { groupId: 'stam-default', title: 'Historical makers', start: '2020-01-01T20:00:00', opkomstmakerIds: [2] })
    assert.equal(created.status, 201)
    const admin = db.data.users.find(user => user.id === 2)
    admin.status = 'inactive'
    assert.equal((await api('developer', `/events/${created.data.id}`, 'PUT', { title: 'Preserved', opkomstmakerIds: [2] })).status, 200)
    assert.deepEqual(db.data.events.find(event => event.id === created.data.id).opkomstmakerIds, [2])
    assert.ok([400, 409].includes((await api('developer', '/events', 'POST', { groupId: 'stam-default', title: 'New assignment', start: '2099-01-01', opkomstmakerIds: [2] })).status))
    admin.status = 'active'
    for (const patch of [{ start: 'invalid' }, { start: '2099-01-02', end: '2099-01-01' }, { allDay: 'true' }, { password: 'secret' }]) {
      assert.equal((await api('developer', `/events/${created.data.id}`, 'PUT', patch)).status, 400)
    }
    assert.equal((await api('developer', `/events/${created.data.id}`, 'PUT', { participants: [2], attendance: { 2: false } })).status, 200)
  })

  it('provides developer-only scoped and paginated database views without secrets', async () => {
    const base = '/developer/database'
    assert.equal((await api(null, `${base}/users?allGroups=true`)).status, 401)
    assert.equal((await api('admin', `${base}/users?allGroups=true`)).status, 403)
    assert.equal((await api('developer', `${base}/users`)).status, 400)
    assert.equal((await api('developer', `${base}/unknown?allGroups=true`)).status, 400)
    assert.equal((await api('developer', `${base}/users?allGroups=true&page=-1`)).status, 400)
    const users = await api('developer', `${base}/users?groupId=explorers`)
    assert.equal(users.status, 200)
    assert.ok(users.data.records.every(item => item.record.groupId === 'explorers'))
    for (const collection of ['users', 'groups', 'events', 'sessions', 'resetCodes', 'userGroupHistory', 'auditLogs']) {
      const response = await api('developer', `${base}/${collection}?allGroups=true`)
      assert.equal(response.status, 200)
      const serialized = JSON.stringify(response.data)
      assert.doesNotMatch(serialized, /"tokenHash"\s*:|"sessionVersion"\s*:|"password"\s*:|"code"\s*:|"calendarFeedToken"\s*:/)
    }
    for (let index = 0; index < 35; index++) db.data.auditLogs.push({ id: `paging-${index}`, groupId: 'explorers', action: 'paging-test', timestamp: new Date(), actorId: 4 })
    const page = await api('developer', `${base}/auditLogs?groupId=explorers&action=paging-test&actorId=4&page=2`)
    assert.equal(page.data.total, 35)
    assert.equal(page.data.records.length, 5)
    assert.equal(page.data.pages, 2)
  })

  it('requires signed unchanged JSON previews and reuses normal validation for users, events and groups', async () => {
    const base = '/developer/database'
    const created = await api('developer', '/users', 'POST', { groupId: 'explorers', firstName: 'Raw', lastName: 'Editor', email: 'raw@example.test' })
    const id = created.data.user.id
    const path = `${base}/users/${id}`
    const patch = { firstName: 'Reviewed' }
    const before = structuredClone(db.data.users.find(user => user.id === id))
    const preview = await api('developer', `${path}/preview`, 'POST', patch)
    assert.equal(preview.status, 200)
    assert.deepEqual(db.data.users.find(user => user.id === id), before)
    assert.equal((await api('developer', path, 'PATCH', { patch })).status, 400)
    assert.equal((await api('developer', path, 'PATCH', { patch: { firstName: 'Tampered' }, previewToken: preview.data.previewToken })).status, 400)
    assert.equal((await api('developer', path, 'PATCH', { patch, previewToken: preview.data.previewToken })).status, 200)
    assert.equal((await api('developer', path, 'PATCH', { patch, previewToken: preview.data.previewToken })).status, 409)
    assert.equal((await api('developer', `${path}/preview`, 'POST', { groupId: 'stam-default' })).status, 400)
    assert.equal((await api('developer', `${path}/preview`, 'POST', { password: 'secret' })).status, 400)
    assert.equal((await api('developer', `${base}/users/4/preview`, 'POST', { firstName: 'Other' })).status, 400)
    assert.equal((await api('developer', `${base}/sessions/unknown/preview`, 'POST', {})).status, 400)
    const stale = await api('developer', `${path}/preview`, 'POST', { lastName: 'Stale' })
    assert.equal((await api('developer', `/users/${id}`, 'PATCH', { lastName: 'Concurrent' })).status, 200)
    assert.equal((await api('developer', path, 'PATCH', { patch: { lastName: 'Stale' }, previewToken: stale.data.previewToken })).status, 409)
    for (const [collection, recordId, edit] of [['events', 'foreign-event', { description: 'Reviewed event' }], ['groups', 'explorers', { settings: { calendarName: 'Reviewed calendar' } }]]) {
      const recordPath = `${base}/${collection}/${recordId}`
      const reviewed = await api('developer', `${recordPath}/preview`, 'POST', edit)
      assert.equal(reviewed.status, 200)
      assert.equal((await api('developer', recordPath, 'PATCH', { patch: edit, previewToken: reviewed.data.previewToken })).status, 200)
    }
    const archived = await api('developer', `${base}/events/archived-event/preview`, 'POST', { title: 'Forbidden' })
    assert.equal(archived.status, 403)
  })

  it('records successful business writes with group/actor/field metadata and filters audit scope', async () => {
    const response = await api('developer', '/developer/database/auditLogs?groupId=explorers&action=user-updated')
    assert.equal(response.status, 200)
    assert.ok(response.data.records.length > 0)
    assert.ok(response.data.records.every(item => item.record.action === 'user-updated' && item.record.groupId === 'explorers'))
    const edit = response.data.records.find(item => item.record.actorId === 4 && item.record.changedFields.includes('firstName')).record
    assert.equal(edit.actorId, 4)
    assert.equal(edit.groupId, 'explorers')
    assert.ok(edit.changedFields.includes('firstName'))
    const groups = (await api('developer', '/groups')).data.groups
    assert.ok(groups.find(group => group.id === 'explorers').summary.latestActivity)
    const count = db.data.auditLogs.length
    assert.equal((await api('admin', '/events/foreign-event', 'PUT', { title: 'Forbidden' })).status, 404)
    assert.equal(db.data.auditLogs.length, count)
  })

  it('sends managed onboarding/reset emails only within permissions and consumes codes once', async () => {
    const created = await api('admin', '/users', 'POST', { firstName: 'Invited', lastName: 'Member', email: 'invited@example.test' })
    assert.equal(created.status, 201)
    const id = created.data.user.id
    const path = `/users/${id}/password-email`
    assert.equal((await api('alumni', path, 'POST', { purpose: 'invite' })).status, 403)
    assert.equal((await api('foreign', path, 'POST', { purpose: 'invite' })).status, 404)
    assert.equal((await api('developer', '/users/4/password-email', 'POST', { purpose: 'reset' })).status, 404)
    assert.equal((await api('admin', path, 'POST', { purpose: 'bad' })).status, 400)
    const sent = await api('admin', path, 'POST', { purpose: 'invite' })
    assert.equal(sent.status, 200)
    assert.doesNotMatch(JSON.stringify(sent.data), /"code"|password|token/)
    assert.equal(sentMail.at(-1).to, 'invited@example.test')
    assert.equal(sentMail.at(-1).subject, 'Welkom bij Stamjer')
    const pending = db.data.resetCodes.find(record => record.email === 'invited@example.test')
    assert.match(pending.code, /^\d{6}$/)
    assert.equal((await api('admin', path, 'POST', { purpose: 'reset' })).status, 429)
    const reset = { email: pending.email, code: pending.code, newPassword: 'invitation-password' }
    assert.equal((await api(null, '/reset-password', 'POST', { ...reset, newPassword: 'short' })).status, 400)
    assert.equal((await api(null, '/reset-password', 'POST', reset)).status, 200)
    assert.equal((await api(null, '/reset-password', 'POST', reset)).status, 400)
    assert.equal(db.data.resetCodes.some(record => record.email === pending.email), false)
    assert.equal((await api('developer', '/groups/stam-default', 'PATCH', { status: 'archived' })).status, 200)
    assert.equal((await api('admin', path, 'POST', { purpose: 'reset' })).status, 403)
    assert.equal((await api('developer', '/groups/stam-default', 'PATCH', { status: 'active' })).status, 200)
  })

  it('limits password code guessing and permits a fresh code after the resend cooldown', async () => {
    const created = await api('admin', '/users', 'POST', { firstName: 'Code', lastName: 'Attempts', email: 'attempts@example.test' })
    const id = created.data.user.id
    assert.equal((await api('admin', `/users/${id}/password-email`, 'POST', { purpose: 'reset' })).status, 200)
    const record = db.data.resetCodes.find(item => item.email === 'attempts@example.test')
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await api(null, '/reset-password', 'POST', { email: record.email, code: '000000', newPassword: 'code-attempts-password' })).status, 400)
    }
    assert.equal((await api(null, '/reset-password', 'POST', { email: record.email, code: record.code, newPassword: 'code-attempts-password' })).status, 429)
    record.createdAt = new Date(Date.now() - 61000)
    assert.equal((await api('admin', `/users/${id}/password-email`, 'POST', { purpose: 'reset' })).status, 200)
    assert.equal(record.failedAttempts, 0)
    assert.equal((await api(null, '/reset-password', 'POST', { email: record.email, code: record.code, newPassword: 'code-attempts-password' })).status, 200)
  })
})

// Optional real-browser checks against the production build, a local in-memory
// database, and a stub mail transport. Requires Node >=22 and a Chromium binary.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import bcrypt from 'bcrypt'
import nodemailer from 'nodemailer'
import { createMemoryClient, createMemoryDb } from './memoryDb.js'
import { newMembership, MEMBERSHIP_SCHEMA } from '../server/memberships.js'

const output = console.info.bind(console)
const browserPath = process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
await access(browserPath)
await access('dist/index.html')
if (typeof WebSocket === 'undefined') throw new Error('Browser checks require Node 22 or newer')
await mkdir('.tmp', { recursive: true })
const artifacts = await mkdtemp(path.resolve('.tmp/groups-browser-'))
Object.assign(process.env, {
  MONGODB_URI: 'mongodb://unused.invalid', VERCEL: '1', NODE_ENV: 'test',
  TOKEN_SECRET: 'local-browser-test-only', SESSION_COOKIE_NAME: 'stamjer_session',
  SMTP_HOST: 'unused.invalid', CLIENT_ORIGIN: '', ADDITIONAL_CORS_ORIGINS: ''
})
const password = await bcrypt.hash('browser-test-only', 4)
const db = createMemoryDb({
  groups: [
    { id: 'stam-default', name: 'Stam', slug: 'stam-default', status: 'active', settings: {} },
    { id: 'explorers', name: 'Explorers', slug: 'explorers', status: 'active', settings: {} }
  ],
  users: [
    { id: 1, firstName: 'Stam', lastName: 'Member', email: 'member@example.test', password, role: 'user', groupId: 'stam-default', status: 'active' },
    { id: 2, firstName: 'Stam', lastName: 'Admin', email: 'admin@example.test', password, role: 'admin', groupId: 'stam-default', status: 'active' },
    { id: 3, firstName: 'Explorer', lastName: 'Member', email: 'explorer@example.test', password, role: 'user', groupId: 'explorers', status: 'active' },
    { id: 4, firstName: 'Developer', lastName: 'Account', email: 'developer@example.test', password, role: 'developer', groupId: null, status: 'inactive' }
  ],
  events: [
    { id: 'stam-event', groupId: 'stam-default', title: 'Stam opkomst', start: '2099-10-01T20:00:00', isOpkomst: true, participants: [1, 2] },
    { id: 'explorer-event', groupId: 'explorers', title: 'Explorer opkomst', start: '2099-10-01T20:00:00', isOpkomst: true, participants: [3] }
  ]
})
global._mongoClientPromise = Promise.resolve(createMemoryClient(db))
const originalTransport = nodemailer.createTransport
nodemailer.createTransport = () => ({ async verify() { return true }, async sendMail() { return { messageId: 'browser-test' } } })
console.info = () => {}
let browser
let socket
let server
const pending = new Map()
let nextId = 0
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const checks = []
try {
  const apiApp = (await import('../api/index.js')).default
  nodemailer.createTransport = originalTransport
  const app = express()
  let origin
  app.get('/__test/login/:actor', async (req, res) => {
    const response = await fetch(`${origin}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${req.params.actor}@example.test`, password: 'browser-test-only' })
    })
    assert.equal(response.status, 200)
    res.setHeader('Set-Cookie', response.headers.get('set-cookie'))
    res.redirect(req.params.actor === 'developer' ? '/developer' : '/account')
  })
  app.use(apiApp)
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  browser = spawn(browserPath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-extensions', '--disable-sync',
    '--remote-debugging-port=0', `--user-data-dir=${path.join(artifacts, 'profile')}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true })
  let port
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = Number((await readFile(path.join(artifacts, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break } catch { await sleep(100) }
  }
  assert.ok(port, 'Chromium debugging endpoint must start')
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      clearTimeout(request.timeout)
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result)
    }
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)) }, 15_000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
    return response.result.value
  }
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`Browser condition failed: ${expression}`)
  }
  const click = async text => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.checkVisibility() && !item.disabled && item.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw Error('Visible enabled button missing'); button.click(); return true })()`)
  const fill = async (selector, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const screenshot = async name => {
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    await writeFile(path.join(artifacts, name), Buffer.from(result.data, 'base64'))
  }
  await call('Page.enable')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await call('Page.navigate', { url: `${origin}/__test/login/developer` })
  await waitFor(`document.querySelectorAll('.developer-group-card').length === 2`)
  assert.equal(await evaluate(`document.querySelector('.nav-user-role')?.textContent`), 'Developer')
  assert.equal(await evaluate(`!!document.querySelector('.account-status-toggle')`), false)
  await screenshot('developer-desktop.png')
  await click('Groep toevoegen')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`document.querySelector('dialog input[name=enablePaymentRequests]').checked`), true)
  await fill('dialog input', 'browser-group')
  await fill('dialog label:nth-of-type(2) input', 'Browser group')
  await evaluate(`document.querySelector('dialog input[name=enablePaymentRequests]').click()`)
  await click('Opslaan')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelectorAll('.developer-group-card').length === 3`)
  assert.equal(db.data.groups.find(group => group.id === 'browser-group').settings.enablePaymentRequests, false)
  await click('Instellingen')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`document.querySelector('dialog input[name=enablePaymentRequests]').checked`), true)
  await fill('dialog input', 'Updated Stam')
  await fill('dialog input[type=email]', 'stam-pay@example.test')
  await evaluate(`document.querySelector('dialog input[name=enablePaymentRequests]').click()`)
  await click('Opslaan')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelector('.developer-groups').textContent.includes('Updated Stam')`)
  assert.equal(db.data.groups.find(group => group.id === 'stam-default').settings.enablePaymentRequests, false)
  await click('Instellingen')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`document.querySelector('dialog input[name=enablePaymentRequests]').checked`), false)
  assert.equal(await evaluate(`document.querySelector('dialog input[type=email]').value`), 'stam-pay@example.test')
  await click('Annuleren')
  checks.push('group creation and group settings editing')
  checks.push('declarations checkbox defaults on and persists disabled group settings')
  await click('Gebruikers')
  await waitFor(`document.querySelectorAll('.management-user').length === 3`)
  await fill('.developer-heading select', 'explorers')
  await waitFor(`document.querySelectorAll('.management-user').length === 1 && document.querySelector('.management-user').textContent.includes('Explorer Member')`)
  assert.equal(await evaluate(`document.querySelector('.management-users').textContent.includes('Stam Admin')`), false)
  checks.push('developer navigation and group query isolation')
  await click('Gebruiker toevoegen')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  await fill('dialog input', 'New')
  await fill('dialog label:nth-of-type(2) input', 'Explorer')
  await fill('dialog input[type=email]', 'new-explorer@example.test')
  await click('Opslaan')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelectorAll('.management-user').length === 2`)
  assert.equal(db.data.users.find(user => user.email === 'new-explorer@example.test').groupId, 'explorers')
  checks.push('developer user creation in selected group')
  await click('Evenementen')
  await waitFor(`!!document.querySelector('.developer-event-list')`)
  await click('Evenement toevoegen')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  await fill('dialog input', 'Browser event')
  await fill('dialog input[type=datetime-local]', '2099-11-01T20:00')
  await evaluate(`(() => { const label = [...document.querySelectorAll('dialog form > label')].find(item => item.textContent.trim() === 'Opkomst'); label.querySelector('input').click(); return true })()`)
  await waitFor(`document.querySelectorAll('.developer-event-members fieldset:nth-of-type(2) input').length === 2`)
  assert.equal(await evaluate(`document.querySelector('.developer-event-members').textContent.includes('Stam Admin')`), false)
  await evaluate(`document.querySelector('.developer-event-members fieldset:nth-of-type(2) input').click()`)
  await fill('.developer-event-members select', 'false')
  assert.equal(await evaluate(`document.querySelector('.developer-event-members fieldset:nth-of-type(4)').textContent.includes('1 streepje')`), true)
  await click('Opslaan')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelector('.developer-event-list').textContent.includes('Browser event')`)
  assert.equal(db.data.events.find(event => event.title === 'Browser event').groupId, 'explorers')
  assert.deepEqual(db.data.events.find(event => event.title === 'Browser event').opkomstmakerIds, [3])
  assert.equal(db.data.events.find(event => event.title === 'Browser event').attendance[3], false)
  await click('Bewerken')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  await fill('dialog input', 'Edited browser event')
  await click('Opslaan')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelector('.developer-event-list').textContent.includes('Edited browser event')`)
  checks.push('scoped event creation/editing, member assignments and attendance/streepje controls')
  await click('Database')
  await waitFor(`document.querySelectorAll('.developer-records > details').length === 2`)
  await evaluate(`document.querySelector('.developer-records > details').open = true`)
  await click('JSON bewerken')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`document.querySelector('dialog textarea').value.includes('password')`), false)
  await fill('dialog textarea', JSON.stringify({ firstName: 'Reviewed Explorer' }))
  await click('Wijziging bekijken')
  await waitFor(`document.querySelector('dialog').textContent.includes('Wijziging bevestigen')`)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('dialog pre')).color`), 'rgb(15, 23, 42)')
  assert.equal(db.data.users.find(user => user.id === 3).firstName, 'Explorer')
  await screenshot('database-preview.png')
  await click('Wijziging bevestigen')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelector('.developer-records').textContent.includes('Reviewed Explorer')`)
  assert.equal(db.data.users.find(user => user.id === 3).firstName, 'Reviewed Explorer')
  checks.push('curated database JSON preview and explicit confirmation')
  await click('Audit')
  await waitFor(`!!document.querySelector('.developer-database .management-toolbar input')`)
  await fill('.developer-database .management-toolbar input', 'user-updated')
  await waitFor(`document.querySelector('.developer-records')?.textContent.includes('user-updated')`)
  assert.equal(await evaluate(`document.querySelector('.developer-records').textContent.includes('event-created')`), false)
  await screenshot('audit-desktop.png')
  checks.push('persistent scoped audit filtering')
  await click('Gebruikers')
  await waitFor(`document.querySelectorAll('.management-user').length === 2`)
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await screenshot('developer-mobile.png')
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true)
  checks.push('mobile layout has no horizontal overflow')
  assert.equal(await evaluate(`document.querySelector('.management-users').textContent.includes('Verplaatsen')`), false)
  checks.push('desktop and mobile management expose no group transfer operation')
  await call('Page.navigate', { url: `${origin}/__test/login/admin` })
  await waitFor(`location.pathname === '/account' && document.querySelectorAll('.management-user').length === 2 && document.querySelector('.management-users').textContent.includes('Stam Admin')`)
  assert.equal(await evaluate(`document.querySelector('.management-users').textContent.includes('Verplaatsen')`), false)
  assert.equal(await evaluate(`document.querySelector('.management-users').textContent.includes('Explorer Member')`), false)
  await fill('.management-toolbar input[type=search]', 'member@example.test')
  await waitFor(`document.querySelectorAll('.management-user').length === 1`)
  await evaluate(`document.querySelector('.management-actions').open = true`)
  await click('Bewerken')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`document.querySelector('dialog').textContent.includes('Rol')`), false)
  await fill('dialog input', 'Updated')
  await click('Opslaan')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelector('.management-user').textContent.includes('Updated Member')`)
  await screenshot('admin-mobile.png')
  checks.push('admin email search and same-group editing without role controls')
  await evaluate(`document.querySelector('.management-actions').open = true`)
  await click('Wachtwoord-e-mail')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`document.querySelector('dialog').textContent.includes('member@example.test')`), true)
  await fill('dialog select', 'invite')
  await screenshot('invitation-mobile.png')
  await click('E-mail versturen')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelector('.management-success').textContent.includes('E-mail verstuurd')`)
  assert.ok(db.data.resetCodes.find(record => record.email === 'member@example.test'))
  checks.push('admin invitation confirmation with stubbed email delivery')
  await call('Page.navigate', { url: `${origin}/developer` })
  await waitFor(`location.pathname === '/kalender'`)
  checks.push('non-developer route rejection')
  await call('Page.navigate', { url: `${origin}/__test/login/member` })
  await waitFor(`location.pathname === '/account' && !!document.querySelector('.account-page-container')`)
  assert.equal(await evaluate(`!!document.querySelector('.user-management')`), false)
  for (const [route, selector] of [['/kalender', '.calendar-page-wrapper'], ['/opkomsten', '.opkomsten-page-wrapper']]) {
    await call('Page.navigate', { url: `${origin}${route}` })
    await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
    await waitFor(`!document.querySelector('.loading-state')`)
    assert.equal(await evaluate(`!!document.querySelector('.error-state')`), false)
    assert.equal(await evaluate(`document.body.textContent.includes('Explorer opkomst')`), false)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true)
    await screenshot(route === '/kalender' ? 'member-calendar-mobile.png' : 'member-opkomsten-mobile.png')
  }
  await call('Page.navigate', { url: `${origin}/strepen` })
  await waitFor(`document.body.textContent.includes('Alleen toegankelijk voor admins.')`)
  checks.push('member calendar/opkomsten group isolation and admin-only strepen restriction')
  await call('Page.navigate', { url: `${origin}/__test/login/admin` })
  await waitFor(`location.pathname === '/account' && !!document.querySelector('.user-management')`)
  await call('Page.navigate', { url: `${origin}/strepen` })
  await waitFor(`!!document.querySelector('.strepen-page') && !document.querySelector('.loading-state')`)
  assert.equal(await evaluate(`document.body.textContent.includes('Explorer opkomst')`), false)
  await screenshot('admin-strepen-mobile.png')
  checks.push('admin strepen page group isolation')

  await call('Page.navigate', { url: `${origin}/__test/login/member` })
  await waitFor(`location.pathname === '/account' && !!document.querySelector('.account-page-container')`)
  for (const width of [1280, 390]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 })
    assert.equal(await evaluate(`!!document.querySelector('.nav-menu a[href="/declaraties"]')`), false)
    assert.equal(await evaluate(`!!document.querySelector('.bottom-nav-link[href="/declaraties"]')`), false)
    await call('Page.navigate', { url: `${origin}/declaraties` })
    await waitFor(`location.pathname === '/kalender' && !!document.querySelector('.calendar-page-wrapper')`)
    assert.equal(await evaluate(`!!document.querySelector('.payment-request-page')`), false)
  }
  checks.push('disabled declarations hidden on desktop/mobile and direct member route redirected')

  await call('Page.navigate', { url: `${origin}/__test/login/explorer` })
  await waitFor(`location.pathname === '/account' && !!document.querySelector('.bottom-nav-link[href="/declaraties"]')`)
  await call('Page.navigate', { url: `${origin}/declaraties` })
  await waitFor(`!!document.querySelector('.payment-request-page')`)
  checks.push('declarations remain available for another group')

  const developerLogin = await fetch(`${origin}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'developer@example.test', password: 'browser-test-only' })
  })
  assert.equal(developerLogin.status, 200)
  const developerCookie = developerLogin.headers.get('set-cookie').split(';')[0]
  const setPaymentRequestsEnabled = async enabled => {
    const response = await fetch(`${origin}/api/groups/stam-default`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: developerCookie },
      body: JSON.stringify({ settings: { enablePaymentRequests: enabled } })
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).group.settings.paymentRequestEmail, 'stam-pay@example.test')
    await evaluate(`window.dispatchEvent(new Event('focus'))`)
  }
  await call('Page.navigate', { url: `${origin}/__test/login/member` })
  await waitFor(`location.pathname === '/account' && !!document.querySelector('.account-page-container')`)
  await setPaymentRequestsEnabled(true)
  await waitFor(`!!document.querySelector('.nav-menu a[href="/declaraties"]') && !!document.querySelector('.bottom-nav-link[href="/declaraties"]')`)
  await call('Page.navigate', { url: `${origin}/declaraties` })
  await waitFor(`!!document.querySelector('.payment-request-page')`)
  await setPaymentRequestsEnabled(false)
  await waitFor(`location.pathname === '/kalender' && !document.querySelector('a[href="/declaraties"]') && !document.querySelector('.payment-request-page')`)
  checks.push('existing member session refreshes feature settings and exits a disabled declarations page')

  db.data.users.push({ id: Math.max(...db.data.users.map(user => user.id)) + 1,
    firstName: 'Alumni', lastName: 'Stam', email: 'alumni@example.test', password,
    role: 'user', groupId: 'stam-default', status: 'legacy' })
  await call('Page.navigate', { url: `${origin}/__test/login/alumni` })
  await waitFor(`location.pathname === '/account' && document.body.textContent.includes('Declaraties zijn uitgeschakeld voor deze groep.')`)
  for (const route of ['/login', '/declaraties', '/kalender', '/opkomsten']) {
    await call('Page.navigate', { url: `${origin}${route}` })
    await waitFor(`location.pathname === '/account' && !!document.querySelector('.account-page-container')`)
  }
  assert.equal(await evaluate(`!!document.querySelector('a[href="/declaraties"]')`), false)
  await setPaymentRequestsEnabled(true)
  await waitFor(`!!document.querySelector('.bottom-nav-link[href="/declaraties"]')`)
  await call('Page.navigate', { url: `${origin}/login` })
  await waitFor(`location.pathname === '/declaraties' && !!document.querySelector('.payment-request-page')`)
  checks.push('alumni land on Account when disabled and return to Declaraties after re-enabling')
  // Activate only isolated in-memory fixtures. No real migration or DB URI.
  db.data.schemaMigrations = [{ id: MEMBERSHIP_SCHEMA, state: 'complete' }]
  db.data.counters = [{ id: 'global-user-id', value: 100 }]
  for (const identity of db.data.users) {
    identity.normalizedEmail = identity.email.trim().toLowerCase()
    identity.globalRole = identity.role === 'developer' ? 'developer' : 'user'
  }
  db.data.groupMemberships = db.data.users.filter(u => u.role !== 'developer').map(u => {
    const m = newMembership(u.id, u.groupId, { role: u.role, status: u.status === 'legacy' ? 'inactive' : u.status, now: new Date('2020-01-01') })
    m.periods[0].joinedAt = null
    m.periods[0].provenance = 'legacy-import'
    if (u.status === 'legacy') { m.state = 'ended'; m.periods[0].endedAt = new Date().toISOString() }
    return m
  })
  const extra = newMembership(1, 'explorers', { role: 'admin', status: 'inactive', now: new Date('2020-01-01') })
  db.data.groupMemberships.push(extra)
  db.data.events.push({ id: 'historical-calendar', groupId: 'stam-default', title: 'Historical full group calendar', start: '2025-05-14T20:00:00', publishedAt: '2025-04-01T00:00:00Z', participants: [], isOpkomst: false, attendanceMeta: {} })
  for (const event of db.data.events) { event.publishedAt ||= '2020-01-01T00:00:00Z'; event.attendanceMeta ||= {} }
  db.data.groups.find(g => g.id === 'explorers').settings.paymentRequestEmail = 'explorers-pay@example.test'
  const developerApi = async (route, method = 'GET', body) => {
    const response = await fetch(`${origin}/api${route}`, { method, headers: { Cookie: developerCookie, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    assert.ok(response.ok, `${method} ${route}: ${response.status} ${await response.clone().text()}`)
    return response.json()
  }
  await call('Page.navigate', { url: `${origin}/__test/login/member` })
  await waitFor(`!!document.querySelector('select[aria-label="Groep selecteren"]')`)
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('user')).role`), 'user')
  assert.equal(await evaluate(`document.querySelector('select[aria-label="Groep selecteren"] option[value="stam-default"]').textContent.includes('Actief') && document.querySelector('select[aria-label="Groep selecteren"] option[value="explorers"]').textContent.includes('Inactief')`), true)
  const beforeSelection = structuredClone(db.data.groupMemberships)
  await call('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
  // Automatically accept only the explicit group-switch confirmation in tests.
  await evaluate(`window.confirm = () => true`)
  await fill('select[aria-label="Groep selecteren"]', 'explorers')
  await waitFor(`!!document.querySelector('.user-management') && JSON.parse(localStorage.getItem('user')).role === 'admin'`)
  assert.equal(await evaluate(`!!document.querySelector('.nav-menu a[href="/strepen"]')`), true)
  await call('Page.navigate', { url: `${origin}/opkomsten` })
  await waitFor(`!!document.querySelector('.opkomsten-page-wrapper') && !document.querySelector('.loading-state')`)
  assert.equal(await evaluate(`localStorage.getItem('selected-group:1')`), 'explorers')
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('user')).status`), 'inactive')
  assert.equal(await evaluate(`!!document.querySelector('a[href="/opkomsten"]') && !!document.querySelector('a[href="/strepen"]')`), true)
  assert.equal(await evaluate(`document.body.textContent.includes('Stam opkomst')`), false)
  await evaluate(`window.confirm = () => true`)
  await fill('select[aria-label="Groep selecteren"]', 'stam-default')
  await waitFor(`JSON.parse(localStorage.getItem('user')).groupId === 'stam-default' && !document.querySelector('a[href="/strepen"]')`)
  assert.deepEqual(db.data.groupMemberships, beforeSelection)
  checks.push('multi-group selector updates role, desktop/mobile navigation and isolated page data without logout')
  await call('Page.navigate', { url: `${origin}/declaraties` })
  await waitFor(`!!document.querySelector('section[aria-label="Declaratiehistorie"]')`)
  const declaration = { requesterName: 'Member', requesterEmail: 'member@example.test', paidTo: 'Shop', expenseTitle: 'Browser historical receipt', expenseDate: '2025-05-01', amount: 19.5, paymentMethod: 'paymentLink', paymentLink: 'https://example.com/pay', groupId: 'stam-default', requestKey: 'browser-membership-declaration', attachments: [] }
  const submitted = await evaluate(`(async () => { const result = await fetch('/api/payment-requests', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(${JSON.stringify(declaration)}) }); return { status: result.status, data: await result.json() } })()`)
  assert.equal(submitted.status, 201)
  const originalSubscription = await evaluate(`fetch('/api/calendar/subscription?groupId=stam-default', { credentials: 'include' }).then(r => r.json()).then(r => r.url)`)
  const memberMembership = db.data.groupMemberships.find(m => m.userId === 1 && m.groupId === 'stam-default')
  const endPreview = await developerApi(`/memberships/${memberMembership.id}/end/preview`, 'POST', {})
  await developerApi(`/memberships/${memberMembership.id}/end`, 'POST', { previewToken: endPreview.previewToken, revision: memberMembership._revision })
  await evaluate(`window.dispatchEvent(new Event('focus'))`)
  await waitFor(`!!document.querySelector('section[aria-label="Declaratiehistorie"]') && !document.querySelector('.payment-request-form') && document.body.textContent.includes('Browser historical receipt')`)
  assert.equal(await evaluate(`document.querySelector('select[aria-label="Groep selecteren"] option[value="stam-default"]').textContent.includes('Alumni')`), true)
  assert.equal(await evaluate(`!!document.querySelector('a[href="/opkomsten"]') || !!document.querySelector('a[href="/strepen"]')`), false)
  assert.equal(await evaluate(`!!document.querySelector('.bottom-nav-link[href="/kalender"]')`), true)
  await screenshot('membership-alumni-declarations-mobile.png')
  await call('Page.navigate', { url: `${origin}/kalender` })
  await waitFor(`!!document.querySelector('input[aria-label="Kalendermaand"]') && !document.querySelector('.loading-state')`)
  await fill('input[aria-label="Kalendermaand"]', '2025-05')
  await waitFor(`document.body.textContent.includes('Historical full group calendar')`)
  assert.equal(await evaluate(`!!document.querySelector('.mobile-create-event-btn')`), false)
  assert.equal(await evaluate(`document.body.textContent.includes('Stam opkomst')`), false)
  await screenshot('membership-alumni-calendar-mobile.png')
  for (const route of ['/opkomsten', '/strepen']) {
    await call('Page.navigate', { url: `${origin}${route}` })
    await waitFor(`location.pathname === '/kalender' && !!document.querySelector('.calendar-page-wrapper')`)
  }
  const alumniSubscription = await evaluate(`fetch('/api/calendar/subscription?groupId=stam-default', { credentials: 'include' }).then(r => r.json()).then(r => r.url)`)
  assert.equal(alumniSubscription, originalSubscription)
  const alumniFeed = await (await fetch(`${origin}${originalSubscription}`)).text()
  assert.ok(alumniFeed.includes('UID:historical-calendar@') && !alumniFeed.includes('UID:stam-event@'))
  checks.push('existing session becomes Alumni with read-only declaration history, period calendar and persistent historical subscription')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await fill('input[aria-label="Kalendermaand"]', '2025-05')
  await waitFor(`document.body.textContent.includes('Historical full group calendar')`)
  assert.equal(await evaluate(`!!document.querySelector('.fc-nieuwBtn-button')`), false)
  assert.equal(await evaluate(`!!document.querySelector('.nav-menu a[href="/kalender"]') && !document.querySelector('.nav-menu a[href="/opkomsten"]')`), true)
  checks.push('desktop Alumni calendar navigation and historical year/month selection')
  await developerApi(`/memberships/${memberMembership.id}/rejoin`, 'POST', { revision: memberMembership._revision })
  await evaluate(`window.dispatchEvent(new Event('focus'))`)
  await waitFor(`!!document.querySelector('.nav-menu a[href="/opkomsten"]') && JSON.parse(localStorage.getItem('user')).membershipState === 'current'`)
  assert.equal(await evaluate(`fetch('/api/calendar/subscription?groupId=stam-default', { credentials: 'include' }).then(r => r.json()).then(r => r.url)`), originalSubscription)
  await call('Page.navigate', { url: `${origin}/declaraties` })
  await waitFor(`!!document.querySelector('.payment-request-form') && document.body.textContent.includes('Browser historical receipt')`)
  checks.push('rejoining restores current features, retains declaration history and reuses the calendar URL')
  await call('Page.navigate', { url: `${origin}/__test/login/developer` })
  await waitFor(`!!document.querySelector('.developer-groups')`)
  await click('Gebruikers')
  await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent === 'Bestaand account toevoegen')`)
  await click('Bestaand account toevoegen')
  await waitFor(`!!document.querySelector('select[aria-label="Bestaand account"] option[value="1"]')`)
  await fill('select[aria-label="Bestaand account"]', '1')
  await waitFor(`document.querySelector('dialog').textContent.includes('Opnieuw') === false && document.querySelector('dialog').textContent.includes('Groepsrol')`)
  await click('Historie bekijken')
  await waitFor(`document.querySelector('dialog').textContent.includes('Lidmaatschapshistorie')`)
  assert.equal(await evaluate(`document.querySelector('dialog').textContent.includes('migration-import') || document.querySelector('dialog').textContent.includes('rejoin')`), true)
  checks.push('developer dashboard exposes existing identities, permanent membership periods and lifecycle history')
  await evaluate(`document.querySelector('dialog button[aria-label="Sluiten"]').click()`)
  await call('Page.navigate', { url: `${origin}/__test/login/admin` })
  await waitFor(`!!document.querySelector('.user-management') && !![...document.querySelectorAll('.management-user')].find(row => row.textContent.includes('member@example.test'))`)
  assert.equal(await evaluate(`!!document.querySelector('select[aria-label="Groep selecteren"]')`), false)
  await evaluate(`(() => { const row = [...document.querySelectorAll('.management-user')].find(row => row.textContent.includes('member@example.test')); row.querySelector('details').open = true; [...row.querySelectorAll('button')].find(button => button.textContent === 'Lidmaatschappen').click() })()`)
  await waitFor(`!!document.querySelector('dialog section select')`)
  assert.equal(await evaluate(`document.querySelector('dialog').textContent.includes('Groepsrol')`), false)
  assert.equal(await evaluate(`[...document.querySelectorAll('dialog section select option')].some(option => ['legacy', 'alumni'].includes(option.value))`), false)
  assert.equal(await evaluate(`document.querySelector('dialog').textContent.includes('Oorspronkelijke start onbekend')`), true)
  await fill('dialog section select', 'inactive')
  await waitFor(`document.querySelector('dialog section select').value === 'inactive' && !document.querySelector('dialog section select').disabled`)
  assert.equal(db.data.groupMemberships.find(m => m.id === memberMembership.id).state, 'current')
  await click('Vertrek bekijken')
  await waitFor(`!![...document.querySelectorAll('dialog button')].find(button => button.textContent === 'Vertrek bevestigen')`)
  await click('Vertrek bevestigen')
  await waitFor(`document.querySelector('dialog h3').textContent.includes('Alumni') && !![...document.querySelectorAll('dialog button')].find(button => button.textContent === 'Opnieuw aansluiten als gebruiker')`)
  await click('Opnieuw aansluiten als gebruiker')
  await waitFor(`!!document.querySelector('dialog section select') && document.querySelector('dialog section select').value === 'active' && !document.querySelector('dialog section select').disabled`)
  assert.equal(db.data.groupMemberships.find(m => m.id === memberMembership.id).role, 'user')
  assert.equal(db.data.groupMemberships.find(m => m.id === memberMembership.id).periods.length, 3)
  await screenshot('group-admin-lifecycle-desktop.png')
  checks.push('group administrator edits Active/Inactive status, ends and rejoins with default member role and grandfathered history')
  await evaluate(`document.querySelector('dialog button[aria-label="Sluiten"]').click()`)
  const otherMemberships = structuredClone(db.data.groupMemberships.filter(m => m.groupId === 'explorers'))
  await click('Bestaand account toevoegen')
  await waitFor(`!!document.querySelector('dialog input[type="email"]')`)
  assert.equal(await evaluate(`!!document.querySelector('select[aria-label="Bestaand account"]')`), false)
  await fill('dialog input[type="email"]', 'explorer@example.test')
  await click('Aan deze groep toevoegen')
  await waitFor(`document.querySelector('dialog').textContent.includes('Groepsstatus')`)
  assert.deepEqual(db.data.groupMemberships.filter(m => m.groupId === 'explorers'), otherMemberships)
  assert.equal(db.data.users.filter(u => u.id === 3).length, 1)
  checks.push('group administrator attaches an existing account by exact email without another group directory or membership changes')
  await call('Browser.close')
  output(JSON.stringify({ checks, artifacts }, null, 2))
} catch (error) {
  // The API installs an uncaughtException logger; browser assertions must still
  // fail the command even when that logger handles the rethrown error.
  process.exitCode = 1
  throw error
} finally {
  nodemailer.createTransport = originalTransport
  socket?.close()
  browser?.kill()
  for (const request of pending.values()) clearTimeout(request.timeout)
  if (server) await new Promise(resolve => server.close(resolve))
  console.info = output
  delete global._mongoClientPromise
}

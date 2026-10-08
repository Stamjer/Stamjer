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
  await fill('dialog input', 'browser-group')
  await fill('dialog label:nth-of-type(2) input', 'Browser group')
  await click('Opslaan')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelectorAll('.developer-group-card').length === 3`)
  await click('Instellingen')
  await waitFor(`!!document.querySelector('dialog[open]')`)
  await fill('dialog input', 'Updated Stam')
  await click('Opslaan')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelector('.developer-groups').textContent.includes('Updated Stam')`)
  checks.push('group creation and group settings editing')
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
  await evaluate(`(() => { const row = [...document.querySelectorAll('.management-user')].find(item => item.textContent.includes('new-explorer@example.test')); row.querySelector('details').open = true; [...row.querySelectorAll('button')].find(button => button.textContent === 'Verplaatsen').click(); return true })()`)
  await waitFor(`!!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`document.querySelector('dialog').textContent.includes('New Explorer')`), true)
  await fill('dialog select', 'stam-default')
  await click('Gevolgen bekijken')
  await waitFor(`!!document.querySelector('.management-move-preview')`)
  assert.equal(await evaluate(`document.querySelector('.management-move-preview').textContent.includes('2 gekoppelde evenementen')`), true)
  await screenshot('move-preview-mobile.png')
  const dialogLayout = await evaluate(`(() => { const dialog = document.querySelector('dialog'); const rect = dialog.getBoundingClientRect(); return { scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, left: rect.left, right: rect.right, viewport: innerWidth } })()`)
  assert.ok(dialogLayout.scrollWidth <= dialogLayout.clientWidth && dialogLayout.left >= 0 && dialogLayout.right <= dialogLayout.viewport, `Mobile dialog overflow: ${JSON.stringify(dialogLayout)}; artifacts: ${artifacts}`)
  await evaluate(`document.querySelector('dialog .management-form-actions').scrollIntoView({ block: 'nearest' })`)
  await screenshot('move-confirm-mobile.png')
  await click('Verplaatsing bevestigen')
  await waitFor(`!document.querySelector('dialog[open]') && document.querySelectorAll('.management-user').length === 1 && !!document.querySelector('.management-history')`)
  assert.equal(db.data.users.find(user => user.email === 'new-explorer@example.test').groupId, 'stam-default')
  assert.equal(db.data.userGroupHistory[0].groupId, 'explorers')
  await evaluate(`(() => { document.querySelector('.management-history').open = true; document.querySelector('.management-history details').open = true; return true })()`)
  assert.equal(await evaluate(`document.querySelector('.management-history').textContent.includes('Explorer opkomst')`), true)
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true)
  checks.push('mobile move preview/confirmation, scoped refresh and preserved source-group history')
  await call('Page.navigate', { url: `${origin}/__test/login/admin` })
  await waitFor(`location.pathname === '/account' && document.querySelectorAll('.management-user').length === 3 && document.querySelector('.management-users').textContent.includes('Stam Admin')`)
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

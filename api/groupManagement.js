import express from 'express'
import { randomBytes } from 'node:crypto'
import validator from 'validator'
import { GroupAccessError } from './authorization.js'
import { calculateGroupStreepjes, getGroupMembers, isDeveloper, normalizeUserRole } from './groups.js'
import { mapManagedUser } from './userManagement.js'
import { logEvent } from './logger.js'
import { lockGroups, runGroupTransaction } from './groupTransactions.js'
import { recordFingerprint, writeAudit } from './audit.js'

const GROUP_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const SETTINGS = ['defaultLocation', 'calendarName', 'paymentRequestEmail', 'dailyChangeEmail', 'allowUserSelfAttendance']

function invalid(message) { throw new GroupAccessError(message, 400) }

export function validateGroupInput(input, { creating = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Groepsgegevens ontbreken')
  const fields = creating ? ['id', 'name', 'slug', 'status', 'settings'] : ['name', 'slug', 'status', 'settings']
  for (const field of Object.keys(input)) if (!fields.includes(field)) invalid(`Onbekend groepsveld: ${field}`)
  const patch = {}
  for (const field of ['id', 'name', 'slug', 'status']) {
    if (!Object.hasOwn(input, field)) continue
    if (typeof input[field] !== 'string' || CONTROL_CHARACTERS.test(input[field])) invalid(`Ongeldig veld: ${field}`)
    patch[field] = input[field].trim()
  }
  if (creating) {
    patch.slug ??= patch.id
    patch.status ??= 'active'
    if (!patch.id || !patch.name) invalid('Groeps-ID en naam zijn verplicht')
  }
  if (Object.hasOwn(patch, 'name') && (!patch.name || patch.name.length > 120)) invalid('Groepsnaam moet 1 tot 120 tekens bevatten')
  for (const field of ['id', 'slug']) {
    if (Object.hasOwn(patch, field) && !GROUP_KEY.test(patch[field])) invalid('Gebruik kleine letters, cijfers en streepjes voor ID en slug')
  }
  if (patch.status !== undefined && !['active', 'archived'].includes(patch.status)) invalid('Ongeldige groepsstatus')
  if (Object.hasOwn(input, 'settings')) {
    if (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) invalid('Instellingen moeten een object zijn')
    patch.settings = {}
    for (const [field, value] of Object.entries(input.settings)) {
      if (!SETTINGS.includes(field)) invalid(`Onbekende groepsinstelling: ${field}`)
      if (field === 'allowUserSelfAttendance') {
        if (typeof value !== 'boolean') invalid('Zelf aanwezigheid wijzigen moet true of false zijn')
        patch.settings[field] = value
      } else {
        if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value) || value.length > (field.endsWith('Email') ? 254 : 300)) invalid(`Ongeldige instelling: ${field}`)
        const trimmed = value.trim()
        if (field.endsWith('Email') && trimmed && !validator.isEmail(trimmed)) invalid('Gebruik een geldig e-mailadres')
        patch.settings[field] = field.endsWith('Email') ? trimmed.toLowerCase() : trimmed
      }
    }
  }
  return patch
}

export function mapGroupForClient(group) {
  return {
    id: group.id, name: group.name, slug: group.slug, status: group.status,
    settings: Object.fromEntries(SETTINGS.filter((key) => Object.hasOwn(group.settings || {}, key))
      .map((key) => [key, group.settings[key]])),
    createdAt: group.createdAt, updatedAt: group.updatedAt,
    hasCalendarSubscription: Boolean(group.calendarFeedToken)
  }
}

export function summarizeGroup(group, users, events, now = new Date()) {
  const members = getGroupMembers(users, group.id)
  const groupEvents = events.filter((event) => event.groupId === group.id)
  return {
    users: members.length,
    admins: members.filter((user) => normalizeUserRole(user) === 'admin').length,
    activeUsers: members.filter((user) => user.status === 'active').length,
    events: groupEvents.length,
    futureOpkomsten: groupEvents.filter((event) => event.isOpkomst && new Date(event.start) > now).length
  }
}

export async function persistGroupSettings(client, db, id, input, actor, { expectedFingerprint, creating = false, rotate = false } = {}) {
  const patch = rotate ? {} : validateGroupInput(input, { creating })
  return runGroupTransaction(client, async session => {
    const liveActor = await db.collection('users').findOne({ id: actor.id }, { session })
    if (!isDeveloper(liveActor)) throw new GroupAccessError('Alleen toegankelijk voor developers')
    const current = await db.collection('groups').findOne({ id }, { session })
    if (creating ? current : !current) throw new GroupAccessError('Groep ontbreekt of bestaat al', 409)
    if (expectedFingerprint && recordFingerprint(current) !== expectedFingerprint) throw new GroupAccessError('Gegevens gewijzigd sinds de preview', 409)
    if (!creating) await lockGroups(db, session, [id], { requireActive: false })
    if (patch.slug) {
      const duplicate = await db.collection('groups').findOne({ slug: patch.slug }, { session })
      if (duplicate && duplicate.id !== id) throw new GroupAccessError('Deze slug bestaat al', 409)
    }
    const group = { ...current, ...patch, id, settings: { ...current?.settings, ...patch.settings }, updatedAt: new Date() }
    delete group._id
    if (!creating) group.mutationVersion = (current.mutationVersion || 0) + 1
    if (creating) group.createdAt = group.updatedAt
    if (rotate) group.calendarFeedToken = randomBytes(32).toString('base64url')
    try {
      if (creating) await db.collection('groups').insertOne(group, { session })
      else await db.collection('groups').updateOne({ id }, { $set: group }, { session })
    } catch (error) {
      if (error.code === 11000) throw new GroupAccessError('Groeps-ID of slug bestaat al', 409)
      throw error
    }
    await writeAudit(db, { action: rotate ? 'calendar-token-rotated' : `group-${creating ? 'created' : 'updated'}`, actor: liveActor,
      groupId: id, collection: 'groups', targetId: id, changedFields: rotate ? ['calendarFeedToken'] : Object.keys(patch) }, session)
    return group
  })
}

export function createGroupManagementRouter({ requireAuthenticatedUser, getDb, getClient, getData, mapEventForClient }) {
  const router = express.Router()
  router.use(async (req, res, next) => {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return
    if (!isDeveloper(auth.user)) return res.status(403).json({ error: 'Alleen toegankelijk voor developers' })
    req.groupActor = auth.user
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  const audit = (req, action, groupId, fields = []) => logEvent({
    action, actor: req.groupActor.id,
    metadata: { groupId, role: 'developer', changedFields: fields.join(',') }
  })
  router.get('/', async (req, res) => {
    const db = await getDb()
    const groups = await db.collection('groups').find({}).toArray()
    const { users, events } = await getData()
    const activity = await Promise.all(groups.map(group => db.collection('auditLogs').find({ $or: [{ groupId: group.id }, { destinationGroupId: group.id }] }).sort({ timestamp: -1 }).limit(1).toArray()))
    res.json({ groups: groups.map((group, index) => ({ ...mapGroupForClient(group), summary: { ...summarizeGroup(group, users, events), latestActivity: activity[index][0]?.timestamp || null } })) })
  })
  router.post('/', async (req, res) => {
    const patch = validateGroupInput(req.body, { creating: true })
    const db = await getDb()
    if (await db.collection('groups').findOne({ $or: [{ id: patch.id }, { slug: patch.slug }] })) {
      throw new GroupAccessError('Dit groeps-ID of deze slug bestaat al', 409)
    }
    const group = await persistGroupSettings(await getClient(), db, patch.id, req.body, req.groupActor, { creating: true })
    audit(req, 'group-created', group.id, Object.keys(patch))
    res.status(201).json({ group: mapGroupForClient(group) })
  })
  router.use('/:id', async (req, res, next) => {
    if (!GROUP_KEY.test(req.params.id)) invalid('Ongeldig groeps-ID')
    const db = await getDb()
    const group = await db.collection('groups').findOne({ id: req.params.id })
    if (!group) throw new GroupAccessError('Groep niet gevonden', 404)
    req.managedGroup = group
    next()
  })
  router.get('/:id', (req, res) => res.json({ group: mapGroupForClient(req.managedGroup) }))
  router.get('/:id/summary', async (req, res) => {
    const { users, events } = await getData()
    res.json({ summary: summarizeGroup(req.managedGroup, users, events) })
  })
  router.get('/:id/users', async (req, res) => {
    const { users, events } = await getData()
    const streepjes = calculateGroupStreepjes(users, events, req.managedGroup.id)
    res.json({ users: getGroupMembers(users, req.managedGroup.id).map((user) => mapManagedUser(user, streepjes[user.id] || 0)) })
  })
  router.get('/:id/events', async (req, res) => {
    const { events } = await getData()
    res.json({ events: events.filter((event) => event.groupId === req.managedGroup.id).map(mapEventForClient) })
  })
  router.patch('/:id', async (req, res) => {
    const patch = validateGroupInput(req.body)
    const current = req.managedGroup
    const db = await getDb()
    const group = await persistGroupSettings(await getClient(), db, current.id, patch, req.groupActor)
    audit(req, 'group-updated', current.id, Object.keys(patch))
    res.json({ group: mapGroupForClient(group) })
  })
  router.post('/:id/calendar-token/rotate', async (req, res) => {
    const db = await getDb()
    await persistGroupSettings(await getClient(), db, req.managedGroup.id, {}, req.groupActor, { rotate: true })
    audit(req, 'calendar-token-rotated', req.managedGroup.id, ['calendarFeedToken'])
    res.json({ msg: 'Agenda-link vervangen. Bestaande abonnementen moeten opnieuw worden ingesteld.' })
  })
  return router
}

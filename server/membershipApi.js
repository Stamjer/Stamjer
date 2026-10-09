import express from 'express'
import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import { GroupAccessError, canManageGroup } from './authorization.js'
import validator from 'validator'
import { isDeveloper } from '../shared/roles.js'
import { membershipMode, mapMembership, changeMembership, previewMembershipEnd, scopedUser, membershipFor, subscriptionToken, validSubscriptionToken, canSeeCalendarEvent, newMembership, updateFuturePlans, liveGroupActor } from './memberships.js'
import { durableGroupTotals } from './attendanceScoring.js'
import { lockGroups, runGroupTransaction } from './groupTransactions.js'
import { buildUserUpdate, mapManagedUser } from './userManagement.js'
import { writeAudit, recordFingerprint } from './audit.js'
import { sanitizeUserId } from './dataModel.js'
import { createICalendarHandler } from './icalendar.js'
import { sendPasswordInvitation } from './passwordInvitations.js'

function inputFields(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) throw new GroupAccessError('Ongeldige velden', 400)
}

export function createMembershipRouter({ getDb, getClient, requireAuthenticatedUser, resolveGroup, secret, refresh, saveUser, getMailer, sendStatusChangeEmail }) {
  const router = express.Router()
  router.use(async (req, res, next) => {
    req.membershipMode = await membershipMode(await getDb())
    if (!req.membershipMode) return next('router')
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  const auth = async (req, res, developer = false) => {
    const context = await requireAuthenticatedUser(req, res)
    if (context && developer && !isDeveloper(context.user)) throw new GroupAccessError('Alleen developers')
    return context
  }
  async function roster(groupId) {
    const db = await getDb()
    const memberships = await db.collection('groupMemberships').find(groupId ? { groupId } : {}).toArray()
    const identities = await db.collection('users').find({}).toArray()
    const events = await db.collection('events').find({}).toArray()
    const archives = await db.collection('userGroupHistory').find({}).toArray()
    return memberships.map(m => {
      const identity = identities.find(u => u.id === m.userId) || { id: m.userId, firstName: 'Historisch lid', lastName: '', globalRole: 'user' }
      const total = durableGroupTotals(events, m.groupId, archives, memberships)[m.userId] || 0
      return mapManagedUser(scopedUser(identity, m), total)
    })
  }
  router.get('/me/memberships', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    res.json({ memberships: a.user.memberships || [] })
  })
  router.get('/developer/users', async (req, res) => {
    const a = await auth(req, res, true); if (!a) return
    const identities = await (await getDb()).collection('users').find({}).toArray()
    res.json({ users: identities.filter(u => !isDeveloper(u)).map(({ id, firstName, lastName, email }) => ({ id, firstName, lastName, email })) })
  })
  router.get('/users/:id/memberships', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    const group = isDeveloper(a.user) ? null : await resolveGroup(req, a.user)
    if (group && !canManageGroup(a.user, group.id)) throw new GroupAccessError('Alleen beheerders')
    const memberships = await (await getDb()).collection('groupMemberships').find({ userId: sanitizeUserId(req.params.id), ...(group ? { groupId: group.id } : {}) }).toArray()
    res.json({ memberships: memberships.map(mapMembership) })
  })
  router.post('/users/:id/memberships', async (req, res) => {
    const a = await auth(req, res, true); if (!a) return
    inputFields(req.body, ['groupId', 'role', 'status'])
    const group = await resolveGroup(req, a.user, { requireActive: true })
    const result = await changeMembership(await getClient(), await getDb(), { actor: a.user, userId: sanitizeUserId(req.params.id), groupId: group.id, action: 'join', patch: { role: req.body.role ?? 'user', status: req.body.status ?? 'active' } })
    await refresh()
    res.status(201).json(result)
  })
  router.post('/memberships/join-existing', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    inputFields(req.body, ['email', 'groupId'])
    const group = await resolveGroup(req, a.user, { requireActive: true })
    if (!canManageGroup(a.user, group.id)) throw new GroupAccessError('Alleen beheerders')
    if (typeof req.body.email !== 'string' || req.body.email.length > 254 || !validator.isEmail(req.body.email.trim())) throw new GroupAccessError('Gebruik een geldig e-mailadres', 400)
    const result = await changeMembership(await getClient(), await getDb(), { actor: a.user, email: req.body.email.trim().toLowerCase(), groupId: group.id, action: 'join' })
    await refresh()
    res.status(201).json(result)
  })
  router.get('/memberships/:id/history', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    const db = await getDb()
    const membership = await db.collection('groupMemberships').findOne({ id: req.params.id })
    if (!membership || !canManageGroup(a.user, membership.groupId)) throw new GroupAccessError('Lidmaatschap niet gevonden', 404)
    res.json({ membership: mapMembership(membership), history: await db.collection('groupMembershipHistory').find({ membershipId: membership.id }).sort({ timestamp: 1 }).toArray() })
  })
  router.post('/memberships/:id/end/preview', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    const db = await getDb()
    const membership = await db.collection('groupMemberships').findOne({ id: req.params.id })
    if (!membership) throw new GroupAccessError('Lidmaatschap niet gevonden', 404)
    res.json(previewMembershipEnd(membership, await db.collection('events').find({ groupId: membership.groupId }).toArray(), a.user, secret))
  })
  for (const action of ['end', 'rejoin', 'update', 'rotate']) {
    const url = action === 'update' ? '/memberships/:id' : `/memberships/:id/${action === 'rotate' ? 'calendar-token/rotate' : action}`
    router[action === 'update' ? 'patch' : 'post'](url, async (req, res) => {
      const a = await auth(req, res); if (!a) return
      inputFields(req.body, action === 'end' ? ['previewToken', 'revision'] : action === 'rotate' ? ['revision'] : ['role', 'status', 'revision'])
      const patch = Object.fromEntries(['role', 'status'].filter(key => Object.hasOwn(req.body, key)).map(key => [key, req.body[key]]))
      const result = await changeMembership(await getClient(), await getDb(), { actor: a.user, membershipId: req.params.id, action, patch,
        expectedRevision: req.body.revision, previewToken: req.body.previewToken, secret })
      await refresh()
      res.json(result)
    })
  }
  router.all('/users/:id/group{/:action}', async (req, res) => {
    const a = await auth(req, res, true); if (!a) return
    res.status(410).json({ error: 'Verplaatsen is vervangen door lidmaatschappen. Voeg een lidmaatschap toe of beëindig het afzonderlijk.' })
  })
  router.get('/users', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    const group = await resolveGroup(req, a.user, { allowAllGroups: true })
    if (!isDeveloper(a.user) && membershipFor(a.user, group.id)?.state !== 'current') throw new GroupAccessError('Alumni hebben geen toegang tot de ledenlijst')
    res.json((await roster(group?.id)).map(({ id, firstName, lastName, role, groupId, status, membershipId, membershipState }) => ({ id, firstName, lastName, role, groupId, status, membershipId, membershipState })))
  })
  router.get('/users/full', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    const group = await resolveGroup(req, a.user, { allowAllGroups: true })
    const users = await roster(group?.id)
    res.json({ users: users.filter(u => isDeveloper(a.user) || canManageGroup(a.user, group.id) || u.id === a.userId).map(user => {
      if (!isDeveloper(a.user) && group?.settings?.enableStreepjes === false) delete user.streepjes
      return user
    }) })
  })
  router.post('/users', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    inputFields(req.body, ['firstName', 'lastName', 'email', 'groupId', 'role', 'isAdmin'])
    const group = await resolveGroup(req, a.user, { requireActive: true })
    if (!canManageGroup(a.user, group.id)) throw new GroupAccessError('Alleen beheerders')
    const validated = buildUserUpdate({ role: 'developer' }, { id: 0, role: 'user' }, { firstName: req.body.firstName, lastName: req.body.lastName, email: req.body.email })
    const role = req.body.role ?? (req.body.isAdmin ? 'admin' : 'user')
    if (role !== 'user' && !isDeveloper(a.user)) throw new GroupAccessError('Alleen developers kunnen rollen toekennen')
    const db = await getDb()
    const password = await bcrypt.hash(randomBytes(32).toString('base64url'), 10)
    const result = await runGroupTransaction(await getClient(), async session => {
      await lockGroups(db, session, [group.id])
      const live = await liveGroupActor(db, a.user, group.id, session)
      if (!canManageGroup(live, group.id)) throw new GroupAccessError('Alleen beheerders')
      if (role !== 'user' && !isDeveloper(live)) throw new GroupAccessError('Alleen developers kunnen rollen toekennen')
      if (await db.collection('users').findOne({ normalizedEmail: validated.email }, { session })) throw new GroupAccessError('Dit e-mailadres bestaat al; een developer kan een bestaand account toevoegen.', 409)
      const increment = await db.collection('counters').updateOne({ id: 'global-user-id' }, { $inc: { value: 1 } }, { session })
      if (!increment.matchedCount) throw new GroupAccessError('Gebruikers-ID teller ontbreekt; controleer de migratie', 503)
      const counter = await db.collection('counters').findOne({ id: 'global-user-id' }, { session })
      const user = { id: counter.value, firstName: validated.firstName, lastName: validated.lastName, email: validated.email, normalizedEmail: validated.email, globalRole: 'user', role: 'user', password, createdAt: new Date(), sessionVersion: 0, _revision: 1 }
      const membership = newMembership(user.id, group.id, { role })
      await db.collection('users').insertOne(user, { session })
      await db.collection('groupMemberships').insertOne(membership, { session })
      await db.collection('groupMembershipHistory').insertOne({ id: membership.id, membershipId: membership.id, userId: user.id, groupId: group.id, action: 'join', actorId: live.id, timestamp: membership.createdAt, periods: membership.periods, role, status: 'active' }, { session })
      const attendanceUpdates = await updateFuturePlans(db, session, membership)
      await writeAudit(db, { actor: live, action: 'user-created', groupId: group.id, collection: 'users', targetId: user.id, changedFields: ['identity', 'membership'] }, session)
      return { user: mapManagedUser(scopedUser(user, membership)), attendanceUpdates }
    })
    await refresh()
    res.status(201).json(result)
  })
  async function updateUser(req, res, self = false) {
    const a = await auth(req, res); if (!a) return
    inputFields(req.body, self ? ['status'] : ['firstName', 'lastName', 'email', 'role', 'status'])
    const personalOnly = !self && isDeveloper(a.user) && !['role', 'status'].some(key => Object.hasOwn(req.body, key))
    const group = personalOnly ? null : await resolveGroup(req, a.user, { requireActive: true })
    const id = self ? a.userId : sanitizeUserId(req.params.id)
    const db = await getDb()
    const identity = await db.collection('users').findOne({ id })
    const membership = group && await db.collection('groupMemberships').findOne({ userId: id, groupId: group.id })
    if (!identity || (!personalOnly && (!membership || (!self && !canManageGroup(a.user, group.id))))) throw new GroupAccessError('Gebruiker niet gevonden', 404)
    const personal = Object.fromEntries(['firstName', 'lastName', 'email'].filter(key => Object.hasOwn(req.body, key)).map(key => [key, req.body[key]]))
    if (Object.keys(personal).length) {
      if (!isDeveloper(a.user)) throw new GroupAccessError('Alleen developers kunnen gedeelde accountgegevens wijzigen')
      const next = buildUserUpdate(a.user, identity, personal)
      if (req.expectedFingerprint && recordFingerprint(identity) !== req.expectedFingerprint) throw new GroupAccessError('Gegevens gewijzigd sinds de preview', 409)
      try { await saveUser(next, { actor: a.user, expectedFingerprint: req.expectedFingerprint, currentSessionId: a.session?.sessionId }) } catch (error) {
        if (error.code === 11000) throw new GroupAccessError('Dit e-mailadres bestaat al', 409)
        throw error
      }
    }
    const patch = Object.fromEntries(['role', 'status'].filter(key => Object.hasOwn(req.body, key)).map(key => [key, req.body[key]]))
    let result = { membership: membership ? mapMembership(membership) : null, attendanceUpdates: 0 }
    if (Object.keys(patch).length) result = await changeMembership(await getClient(), db, { actor: a.user, membershipId: membership.id, action: 'update', patch, self, expectedRevision: membership._revision })
    if (patch.status && patch.status !== membership.status) await sendStatusChangeEmail(scopedUser(identity, { ...membership, status: patch.status }), patch.status)
    await refresh()
    const user = scopedUser(await db.collection('users').findOne({ id }), result.membership)
    // The next session refresh supplies settings permissions and all memberships.
    res.json({ user: mapManagedUser(user), attendanceUpdates: result.attendanceUpdates, msg: 'Gebruiker bijgewerkt' })
  }
  router.updateUser = updateUser
  router.patch('/users/:id', (req, res) => updateUser(req, res))
  router.patch('/users/:id/role', (req, res) => updateUser(req, res))
  router.patch('/users/:id/status', (req, res) => updateUser(req, res))
  router.put('/user/profile', (req, res) => updateUser(req, res, true))
  router.post('/users/:id/password-email', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    const group = await resolveGroup(req, a.user, { requireActive: true })
    const db = await getDb()
    if (!canManageGroup(a.user, group.id) || !await db.collection('groupMemberships').findOne({ userId: sanitizeUserId(req.params.id), groupId: group.id, state: 'current' })) throw new GroupAccessError('Gebruiker niet gevonden', 404)
    inputFields(req.body, ['purpose'])
    await sendPasswordInvitation(await getClient(), db, { userId: sanitizeUserId(req.params.id), actor: a.user, groupId: group.id, purpose: req.body.purpose, mailer: await getMailer(), from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com' })
    res.json({ msg: 'E-mail verstuurd.' })
  })
  router.get('/calendar/subscription', async (req, res) => {
    const a = await auth(req, res); if (!a) return
    const group = await resolveGroup(req, a.user)
    const membership = await (await getDb()).collection('groupMemberships').findOne({ userId: a.userId, groupId: group.id })
    if (!membership || membership.state === 'historical') throw new GroupAccessError('Geen persoonlijk lidmaatschap', 403)
    res.json({ url: `/api/calendar.ics?membershipId=${encodeURIComponent(membership.id)}&token=${subscriptionToken(membership, secret)}` })
  })
  router.get('/events/:id', async (req, res, next) => {
    if (req.params.id === 'opkomsten') return next('route')
    const a = await auth(req, res); if (!a) return
    const group = await resolveGroup(req, a.user)
    const event = await (await getDb()).collection('events').findOne({ id: req.params.id, groupId: group.id })
    if (!event || (!isDeveloper(a.user) && !canSeeCalendarEvent(membershipFor(a.user, group.id), event))) throw new GroupAccessError('Evenement niet gevonden', 404)
    const { _id: _mongoId, membershipOriginalPlans: _originalPlans, ...safeEvent } = event
    res.json({ event: safeEvent })
  })
  router.get('/calendar.ics', async (req, res, next) => {
    const db = await getDb()
    let membership, group
    if (req.query.token !== undefined) {
      if (typeof req.query.membershipId !== 'string') throw new GroupAccessError('Oud of ongeldig agenda-abonnement. Stel je persoonlijke abonnement opnieuw in.', 401)
      membership = await db.collection('groupMemberships').findOne({ id: req.query.membershipId })
      if (!membership || membership.state === 'historical' || !validSubscriptionToken(membership, req.query.token, secret)) throw new GroupAccessError('Ongeldig agenda-abonnement', 401)
      group = await db.collection('groups').findOne({ id: membership.groupId })
    } else {
      const a = await auth(req, res); if (!a) return
      group = await resolveGroup(req, a.user)
      membership = isDeveloper(a.user) ? null : membershipFor(a.user, group.id)
    }
    if (!group) throw new GroupAccessError('Groep niet gevonden', 404)
    req.calendarName = group.settings?.calendarName
    req.authorizedCalendarEvents = (await db.collection('events').find({ groupId: group.id }).toArray()).filter(e => !membership || canSeeCalendarEvent(membership, e))
    next()
  }, createICalendarHandler(req => req.authorizedCalendarEvents))
  return router
}

/* eslint-env node */
/**
 * ================================================================
 * STAMJER AGENDA-API - BACKEND SERVER
 * ================================================================
 *
 * Hoofdbestand voor de Stamjer-agenda.
 * Biedt REST-API endpoints voor:
 * - Gebruikersauthenticatie, admin-gebruikersbeheer en wachtwoordherstel
 * - Evenementbeheer (CRUD-bewerkingen)
 *
 * Gemaakt met Express.js en MongoDB Atlas, inclusief:
 * - Wachtwoordherstel met beveiligde codes
 * - Opslag van gebruikers en evenementen in MongoDB
 * - E-mails verstuurd via Nodemailer
 *
 * @author R.S. Kort
 *
 */

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import nodemailer from 'nodemailer'
import validator from 'validator'
import bcrypt from 'bcrypt'
import path from 'path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import expressStaticGzip from 'express-static-gzip'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { randomUUID, randomBytes, createHmac } from 'crypto'
import { MongoClient } from 'mongodb'
import { createRequestLogger, logError as logSystemError, logEvent } from './logger.js'
import { createICalendarHandler } from './icalendar.js'
import {
  getAssignmentDisplayNames,
  normalizeUserStatus,
  sanitizeIdArray,
  sanitizeUserId,
  USER_STATUSES
} from './dataModel.js'
import {
  canManageGroup, canManageUser, canReadGroup, getAttendanceAuthorizationError,
  GroupAccessError, resolveRequestGroupId
} from './authorization.js'
import {
  calculateGroupStreepjes, createDefaultGroup, DEFAULT_GROUP_ID, getEventGroupId,
  getGroupMembers, GROUP_INDEXES, isDeveloper,
  normalizeGroupUser, normalizeUserRole
} from './groups.js'
import { createSessionCookieOptions, createSessionPolicy } from './sessionPolicy.js'
import { createGroupManagementRouter } from './groupManagement.js'
import { buildUserUpdate, mapManagedUser } from './userManagement.js'
import { lockGroups, persistGroupRecord, revisionFilter, runGroupTransaction } from './groupTransactions.js'
import { applyUserGroupMove, previewUserGroupMove } from './userGroupMoves.js'
import { writeAudit } from './audit.js'
import { validateEventInput } from './eventManagement.js'
import { createDatabaseManagementRouter, mapDatabaseRecord } from './databaseManagement.js'
import { sendPasswordInvitation } from './passwordInvitations.js'

// MongoDB setup
const uri = process.env.MONGODB_URI
if (!uri) throw new Error('Ontbrekende MONGODB_URI in omgeving')

let clientPromise
if (!global._mongoClientPromise) {
  const client = new MongoClient(uri)
  global._mongoClientPromise = client.connect()
}
clientPromise = global._mongoClientPromise

const isProduction = process.env.NODE_ENV === 'production'
const debugLog = (...args) => {
  if (!isProduction) {
    console.debug('[debug]', ...args)
  }
}
const infoLog = (...args) => console.info(...args)
const warnLog = (...args) => console.warn(...args)
const DAILY_CHANGE_EMAIL = process.env.DAILY_CHANGE_EMAIL || 'stamjer.mpd@gmail.com'
const PAYMENT_REQUEST_EMAIL = process.env.PAYMENT_REQUEST_EMAIL || 'stamjer.mpd@gmail.com'
const PAYMENT_REQUEST_ATTACHMENT_LIMIT = Math.max(parseInt(process.env.PAYMENT_REQUEST_ATTACHMENT_LIMIT, 10) || 3, 0)
const PAYMENT_REQUEST_ATTACHMENT_SIZE_LIMIT = Math.max(parseInt(process.env.PAYMENT_REQUEST_ATTACHMENT_SIZE_LIMIT, 10) || 5, 1) * 1024 * 1024
const PAYMENT_REQUEST_TOTAL_SIZE_LIMIT = Math.max(parseInt(process.env.PAYMENT_REQUEST_TOTAL_SIZE_LIMIT, 10) || 15, 1) * 1024 * 1024

const DEFAULT_TOKEN_SECRET = 'dev-token-secret-change-me'
const TOKEN_SECRET = process.env.TOKEN_SECRET || DEFAULT_TOKEN_SECRET
if (isProduction && TOKEN_SECRET === DEFAULT_TOKEN_SECRET) {
  throw new Error('TOKEN_SECRET moet in productie expliciet en stabiel worden ingesteld')
}
const sessionPolicy = createSessionPolicy(process.env)
const SESSION_COOKIE_NAME = sessionPolicy.cookieName
const SESSION_MAX_AGE_DAYS = sessionPolicy.maxAgeDays
const SESSION_MAX_AGE_MS = sessionPolicy.maxAgeMs
const SESSION_TOUCH_INTERVAL_MS = sessionPolicy.touchIntervalMs
const SESSION_COOKIE_DOMAIN = sessionPolicy.cookieDomain
function maskEmail(email = '') {
  if (typeof email !== 'string') return ''
  const trimmed = email.trim()
  if (!trimmed) return ''
  if (!trimmed.includes('@')) {
    if (trimmed.length <= 2) {
      return `${trimmed.charAt(0) || '*'}***`
    }
    return `${trimmed.charAt(0)}***${trimmed.charAt(trimmed.length - 1)}`
  }
  const [local, domain] = trimmed.split('@')
  if (!local) {
    return `***@${domain}`
  }
  const start = local.charAt(0)
  const end = local.length > 1 ? local.charAt(local.length - 1) : ''
  return `${start}***${end}@${domain}`
}

let databaseSetupPromise

async function getDb() {
  const client = await clientPromise
  const db = client.db('Stamjer')

  if (!databaseSetupPromise) {
    databaseSetupPromise = (async () => {
      await ensureIndexes(db)
      await db.collection('groups').updateOne(
        { id: DEFAULT_GROUP_ID },
        { $setOnInsert: createDefaultGroup({ dailyChangeEmail: DAILY_CHANGE_EMAIL, paymentRequestEmail: PAYMENT_REQUEST_EMAIL }) },
        { upsert: true }
      )
    })().catch((error) => {
      databaseSetupPromise = null
      throw error
    })
  }
  await databaseSetupPromise

  return db
}

/**
 * Create database indexes for optimal query performance.
 * This function only runs once per process to limit overhead.
 */
async function ensureIndexes(db) {
  for (const [name, definitions] of Object.entries(GROUP_INDEXES)) {
    if (name === 'groups') {
      // Group identity constraints must exist before concurrent default-group
      // upserts, and failures must prevent serving a misleading group model.
      for (const { keys, options } of definitions) await db.collection(name).createIndex(keys, options)
      continue
    }
    await ensureCollectionIndexes(db.collection(name), definitions)
  }
  const eventsCreated = await ensureCollectionIndexes(db.collection('events'), [
    { keys: { start: 1 }, options: { background: true, name: 'events_start_idx' }, description: 'events.start' },
    { keys: { isOpkomst: 1 }, options: { background: true, name: 'events_isOpkomst_idx' }, description: 'events.isOpkomst' },
    { keys: { isSchoonmaak: 1 }, options: { background: true, name: 'events_isSchoonmaak_idx' }, description: 'events.isSchoonmaak' },
    { keys: { start: 1, isOpkomst: 1 }, options: { background: true, name: 'events_start_isOpkomst_idx' }, description: 'events start + isOpkomst' },
    { keys: { start: 1, isSchoonmaak: 1 }, options: { background: true, name: 'events_start_isSchoonmaak_idx' }, description: 'events start + isSchoonmaak' }
  ])

  const usersCreated = await ensureCollectionIndexes(db.collection('users'), [
    { keys: { email: 1 }, options: { unique: true, background: true, name: 'users_email_unique_idx' }, description: 'users.email unique' },
    { keys: { id: 1 }, options: { unique: true, background: true, name: 'users_id_unique_idx' }, description: 'users.id unique' },
    { keys: { status: 1 }, options: { background: true, name: 'users_status_idx' }, description: 'users.status' }
  ])

  const resetCodesCreated = await ensureCollectionIndexes(db.collection('resetCodes'), [
    { keys: { email: 1 }, options: { unique: true, background: true, name: 'resetCodes_email_unique_idx' }, description: 'resetCodes.email unique' },
    { keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0, background: true, name: 'resetCodes_ttl_idx' }, description: 'resetCodes TTL' }
  ])

  const sessionsCreated = await ensureCollectionIndexes(db.collection('sessions'), [
    { keys: { sessionId: 1 }, options: { unique: true, background: true, name: 'sessions_id_unique_idx' }, description: 'sessions.sessionId unique' },
    { keys: { userId: 1, revokedAt: 1 }, options: { background: true, name: 'sessions_user_revoked_idx' }, description: 'sessions per user' },
    { keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0, background: true, name: 'sessions_expiresAt_ttl_idx' }, description: `sessions TTL (${SESSION_MAX_AGE_DAYS} dagen)` }
  ])

  if (eventsCreated || usersCreated || resetCodesCreated || sessionsCreated) {
    infoLog('[indexes] Created or verified MongoDB indexes')
  }
}

async function ensureCollectionIndexes(collection, definitions) {
  let existingIndexes = []
  
  try {
    // Try to get existing indexes, but handle the case where collection doesn't exist yet
    existingIndexes = await collection.indexes()
  } catch (error) {
    // If collection doesn't exist, we'll create it when we create the first index
    if (error.codeName === 'NamespaceNotFound' || error.code === 26) {
      debugLog(`[indexes] Collection ${collection.collectionName} doesn't exist yet, will be created with first index`)
      existingIndexes = []
    } else {
      warnLog(`[indexes] Error getting indexes for ${collection.collectionName}: ${error.message}`)
      return false
    }
  }
  
  let createdAny = false

  for (const { keys, options = {}, description } of definitions) {
    const existing = existingIndexes.find((idx) => isSameIndexKey(idx.key, keys))

    if (existing) {
      const expectedTtl = options.expireAfterSeconds
      if (typeof expectedTtl === 'number' && existing.expireAfterSeconds !== expectedTtl) {
        const currentTtl = typeof existing.expireAfterSeconds === 'number' ? existing.expireAfterSeconds : 'none'
        warnLog(`[indexes] TTL mismatch on ${collection.collectionName}.${existing.name || 'unknown'} (expected ${expectedTtl}, found ${currentTtl})`)
      }

      if (options.unique && !existing.unique) {
        warnLog(`[indexes] Unique index expected on ${collection.collectionName} for keys ${JSON.stringify(keys)} but existing index is not unique`)
      }

      continue
    }

    try {
      await collection.createIndex(keys, options)
      createdAny = true
      if (description) {
        infoLog(`[indexes] Created ${collection.collectionName} index for ${description}`)
      } else {
        infoLog(`[indexes] Created index on ${collection.collectionName}`)
      }
    } catch (error) {
      const message = error && error.message ? error.message : ''
      if (message.includes('already exists')) {
        infoLog(`[indexes] Index already exists on ${collection.collectionName}, skipping (${JSON.stringify(keys)})`)
      } else {
        warnLog(`[indexes] Failed to create index on ${collection.collectionName}: ${message}`)
      }
    }
  }

  return createdAny
}

function isSameIndexKey(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', 'y', 't'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off', 'n', 'f'].includes(normalized)) return false
  return defaultValue
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function sanitizeClientString(input = '', maxLength = 120) {
  return input
    .toString()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .slice(0, maxLength)
}

function ensureDeviceId() {
  try {
    return randomUUID()
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function parseCookieHeader(header = '') {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=')
      if (index <= 0) return cookies
      const key = decodeURIComponent(part.slice(0, index).trim())
      const value = decodeURIComponent(part.slice(index + 1).trim())
      cookies[key] = value
      return cookies
    }, {})
}

function getCookieSessionToken(req) {
  const cookies = parseCookieHeader(req.headers?.cookie || '')
  return typeof cookies[SESSION_COOKIE_NAME] === 'string' ? cookies[SESSION_COOKIE_NAME].trim() : ''
}

function getSessionCookieOptions({ maxAge = SESSION_MAX_AGE_MS } = {}) {
  return createSessionCookieOptions({
    isProduction,
    maxAgeMs: SESSION_MAX_AGE_MS,
    cookieDomain: SESSION_COOKIE_DOMAIN,
    maxAge
  })
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions())
}

function clearSessionCookie(res) {
  const options = getSessionCookieOptions({ maxAge: 0 })
  delete options.maxAge
  res.clearCookie(SESSION_COOKIE_NAME, options)
}

function hashSessionToken(token) {
  return createHmac('sha256', TOKEN_SECRET).update(token).digest('hex')
}

function createOpaqueSessionToken() {
  return `${randomUUID()}.${base64UrlEncode(randomBytes(32))}`
}

function parseOpaqueSessionToken(token = '') {
  const [sessionId, secret, extra] = token.split('.')
  if (extra || !sessionId || !secret) return null
  if (sessionId.length > 80 || secret.length > 120) return null
  return { sessionId, tokenHash: hashSessionToken(token) }
}

function normalizeSessionRecord(session) {
  if (!session) return null
  return {
    ...session,
    expiresAt: session.expiresAt instanceof Date ? session.expiresAt : new Date(session.expiresAt),
    createdAt: session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt),
    lastSeenAt: session.lastSeenAt instanceof Date ? session.lastSeenAt : new Date(session.lastSeenAt),
    revokedAt: session.revokedAt ? (session.revokedAt instanceof Date ? session.revokedAt : new Date(session.revokedAt)) : null
  }
}

function isSessionUsable(session) {
  if (!session || session.revokedAt) return false
  const expiresAt = session.expiresAt instanceof Date ? session.expiresAt : new Date(session.expiresAt)
  return expiresAt.getTime() > Date.now()
}

async function findSessionByToken(token) {
  const parsed = parseOpaqueSessionToken(token)
  if (!parsed) return null

  const db = await getDb()
  const session = normalizeSessionRecord(await db.collection('sessions').findOne(
    {
      sessionId: parsed.sessionId,
      tokenHash: parsed.tokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    },
    { projection: { _id: 0 } }
  ))

  return isSessionUsable(session) ? session : null
}

function mapUserForClient(user, session = null) {
  if (!user) return null
  const safeUser = { ...user }
  delete safeUser.password
  delete safeUser._id
  delete safeUser._revision
  safeUser.session = session
    ? {
        deviceId: session.deviceId,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt
      }
    : undefined
  return safeUser
}

async function withUserPermissions(user) {
  if (isDeveloper(user)) return { ...user, permissions: { canUseAttendance: false, canManageUsers: true } }
  const db = await getDb()
  const group = await db.collection('groups').findOne({ id: user.groupId })
  return { ...user, permissions: {
    canManageUsers: group?.status === 'active' && normalizeUserRole(user) === 'admin',
    canUseAttendance: group?.status === 'active' && user.status !== 'legacy'
      && (normalizeUserRole(user) === 'admin' || group.settings?.allowUserSelfAttendance !== false)
  } }
}

async function createUserSession(user, req) {
  const token = createOpaqueSessionToken()
  const parsed = parseOpaqueSessionToken(token)
  const now = new Date()
  const session = {
    sessionId: parsed.sessionId,
    tokenHash: parsed.tokenHash,
    userId: user.id,
    deviceId: ensureDeviceId(),
    userAgent: sanitizeClientString(req.headers?.['user-agent'] || '', 300),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS),
    revokedAt: null
  }

  const db = await getDb()
  await db.collection('sessions').insertOne(session)
  const safeSession = { ...session }
  delete safeSession._id
  return { token, session: safeSession }
}

async function touchSession(session) {
  if (!session?.sessionId) return
  const lastSeenAt = session.lastSeenAt instanceof Date ? session.lastSeenAt : new Date(session.lastSeenAt)
  if (Date.now() - lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) return

  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS)
  session.lastSeenAt = now
  session.expiresAt = expiresAt

  const db = await getDb()
  await db.collection('sessions').updateOne(
    { sessionId: session.sessionId, revokedAt: null },
    { $set: { lastSeenAt: now, expiresAt } }
  )
}

async function revokeSession(sessionId) {
  if (!sessionId) return
  const revokedAt = new Date()
  const db = await getDb()
  await db.collection('sessions').updateOne(
    { sessionId },
    { $set: { revokedAt } }
  )
}

async function revokeUserSessions(userId, { exceptSessionId = null } = {}) {
  const uid = sanitizeUserId(userId)
  if (uid === null) return

  const revokedAt = new Date()
  const filter = {
    userId: uid,
    revokedAt: null
  }
  if (exceptSessionId) {
    filter.sessionId = { $ne: exceptSessionId }
  }

  const db = await getDb()
  await db.collection('sessions').updateMany(filter, { $set: { revokedAt } })
}

async function getAuthenticatedUser(req, { requireAdmin = false } = {}) {
  await ensureUsersFresh()
  const cookieToken = getCookieSessionToken(req)
  let session = null
  let user = null

  if (cookieToken) {
    session = await findSessionByToken(cookieToken)
    if (session) {
      // Session authorization must see moves/role changes made by another API
      // process immediately, even while the shared list cache is still fresh.
      const db = await getDb()
      const storedUser = await db.collection('users').findOne({ id: session.userId }, { projection: { _id: 0 } })
      user = storedUser ? normalizeGroupUser(storedUser) : null
      if (user) {
        const index = users.findIndex(candidate => candidate.id === user.id)
        if (index >= 0) users[index] = user
        else users.push(user)
        await touchSession(session)
      }
    }
  }

  if (!user) {
    return { error: 'AUTH_INVALID' }
  }

  if (requireAdmin && !['admin', 'developer'].includes(normalizeUserRole(user))) {
    return { error: 'AUTH_FORBIDDEN' }
  }

  return { user: await withUserPermissions(user), userId: user.id, token: cookieToken, session }
}

async function requireAuthenticatedUser(req, res, { requireAdmin = false } = {}) {
  const ctx = await getAuthenticatedUser(req, { requireAdmin })
  if (ctx.error === 'AUTH_REQUIRED') {
    res.status(401).json({ error: 'Authenticatie vereist' })
    return null
  }
  if (ctx.error === 'AUTH_INVALID') {
    clearSessionCookie(res)
    res.status(401).json({ error: 'Ongeldige sessie' })
    return null
  }
  if (ctx.error === 'AUTH_FORBIDDEN') {
    res.status(403).json({ error: 'Alleen beheerders' })
    return null
  }
  return ctx
}

async function resolveGroup(req, actor, options = {}) {
  const groupId = resolveRequestGroupId(req, actor, options)
  if (groupId === null) return null
  const db = await getDb()
  const group = await db.collection('groups').findOne({ id: groupId }, { projection: { _id: 0 } })
  if (!group) throw new GroupAccessError('Groep niet gevonden', 404)
  if (options.requireActive && group.status !== 'active') throw new GroupAccessError('Deze groep is gearchiveerd')
  return group
}

async function requireEventAccess(req, actor, event, { manage = false } = {}) {
  const groupId = getEventGroupId(event)
  if (!(manage ? canManageGroup(actor, groupId) : canReadGroup(actor, groupId))) {
    throw new GroupAccessError('Evenement niet gevonden', 404)
  }
  if (req.query?.groupId !== undefined && req.query.groupId !== groupId) {
    throw new GroupAccessError('De geselecteerde groep hoort niet bij dit evenement', 400)
  }
  // Existing records supply the group for developers; groupId cannot be used to move an event.
  await resolveGroup({ ...req, query: { ...req.query, groupId: req.query?.groupId ?? groupId } }, actor, { requireActive: true })
}

async function getGroupEmail(groupId, setting) {
  const db = await getDb()
  const group = await db.collection('groups').findOne({ id: groupId })
  const email = group?.settings?.[setting]
  return typeof email === 'string' && validator.isEmail(email) ? email : null
}

// Tussenopslag gebruikers en evenementen
let users = []
let events = []
let lastEventsLoadedAt = 0
let lastUsersLoadedAt = 0
// Remove in-memory pendingReset as we'll use MongoDB
// const pendingReset = {}

// Gegevens inladen
async function loadUsers() {
  const db = await getDb()
  users = await db.collection('users')
    .find({})
    .project({ _id: 0 })
    .toArray()
    .then((list) =>
      list.map((user) => {
        const normalizedUser = {
          ...normalizeGroupUser(user),
          sessionVersion: Number.isFinite(user.sessionVersion) ? user.sessionVersion : 0,
          status: normalizeUserStatus(user)
        }
        return normalizedUser
      })
    )
  infoLog(`Loaded ${users.length} users from MongoDB`)
  lastUsersLoadedAt = Date.now()
}

async function ensureUsersFresh(maxAgeMs = 2000) {
  if (Date.now() - lastUsersLoadedAt > maxAgeMs || users.length === 0) {
    await loadUsers()
  }
}

async function loadEvents() {
  const db = await getDb()
  events = (await db.collection('events')
    .find({})
    .project({ _id: 0 })
    .toArray())
    .map((event) => ({
      ...event,
      groupId: getEventGroupId(event),
      opkomstmakerIds: sanitizeIdArray(event.opkomstmakerIds),
      schoonmakerIds: sanitizeIdArray(event.schoonmakerIds),
      legacyOpkomstmakerNames: Array.isArray(event.legacyOpkomstmakerNames) ? event.legacyOpkomstmakerNames : [],
      legacySchoonmakerNames: Array.isArray(event.legacySchoonmakerNames) ? event.legacySchoonmakerNames : [],
      participants: sanitizeIdArray(event.participants)
    }))
  infoLog(`Loaded ${events.length} events from MongoDB`)
  lastEventsLoadedAt = Date.now()
}

function mapEventForClient(event) {
  const safeEvent = mapDatabaseRecord('events', event)
  const groupUsers = getGroupMembers(users, event.groupId)
  const opkomstmakerNames = getAssignmentDisplayNames(
    event.opkomstmakerIds,
    event.legacyOpkomstmakerNames,
    groupUsers
  )
  const schoonmakerNames = getAssignmentDisplayNames(
    event.schoonmakerIds,
    event.legacySchoonmakerNames,
    groupUsers
  )
  return {
    ...safeEvent,
    opkomstmakers: opkomstmakerNames.join(', '),
    schoonmakers: schoonmakerNames.join(', ')
  }
}

function applyEventInput(event, input = {}) {
  const updated = { ...event }
  const stringFields = ['title', 'start', 'end', 'location', 'description']
  const booleanFields = ['allDay', 'isOpkomst', 'isSchoonmaak']

  for (const field of stringFields) {
    if (Object.hasOwn(input, field)) updated[field] = typeof input[field] === 'string' ? input[field].trim() : ''
  }
  for (const field of booleanFields) {
    if (Object.hasOwn(input, field)) updated[field] = input[field] === true
  }
  if (Object.hasOwn(input, 'opkomstmakerIds')) {
    updated.opkomstmakerIds = sanitizeIdArray(input.opkomstmakerIds)
  }
  if (Object.hasOwn(input, 'schoonmakerIds')) {
    updated.schoonmakerIds = sanitizeIdArray(input.schoonmakerIds)
  }
  if (Object.hasOwn(input, 'participants')) {
    updated.participants = sanitizeIdArray(input.participants)
  }
  if (Object.hasOwn(input, 'schoonmaakOptions')) {
    updated.schoonmaakOptions = Array.isArray(input.schoonmaakOptions) ? input.schoonmaakOptions : []
  }
  if (Object.hasOwn(input, 'attendance') && input.attendance && typeof input.attendance === 'object') {
    updated.attendance = Object.fromEntries(Object.entries(input.attendance)
      .filter(([userId]) => sanitizeUserId(userId) !== null)
      .map(([userId, value]) => [String(sanitizeUserId(userId)), Boolean(value?.present ?? value)]))
  }

  if (!updated.end) updated.end = updated.start
  return updated
}

async function ensureEventsFresh(maxAgeMs = 2000) {
  const now = Date.now()
  if (now - lastEventsLoadedAt > maxAgeMs || events.length === 0) {
    await loadEvents()
  }
}

async function syncUserAttendanceForFutureOpkomsten(userId, shouldBePresent) {
  const uid = parseInt(userId, 10)
  if (!Number.isInteger(uid)) {
    return { updatedEvents: 0 }
  }
  const user = users.find((candidate) => candidate.id === uid)
  if (!user || isDeveloper(user)) return { updatedEvents: 0 }
  await ensureEventsFresh()

  const now = new Date()
  let updatedEvents = 0
  const saveOperations = []

  events.forEach(cachedEvent => {
    const event = { ...cachedEvent }
    if (!event || !event.isOpkomst || event.groupId !== user.groupId) return
    if (!event.start) return

    const eventStart = new Date(event.start)
    if (Number.isNaN(eventStart.getTime())) return
    if (eventStart <= now) return

    const existingParticipants = Array.isArray(event.participants)
      ? event.participants
          .map(participantId => parseInt(participantId, 10))
          .filter(Number.isFinite)
      : []

    const uniqueParticipants = Array.from(new Set(existingParticipants)).sort((a, b) => a - b)
    const hasUser = uniqueParticipants.includes(uid)

    if (shouldBePresent && !hasUser) {
      uniqueParticipants.push(uid)
      uniqueParticipants.sort((a, b) => a - b)
      event.participants = uniqueParticipants
      saveOperations.push(saveEvent(event, { action: 'attendance-auto-sync' }))
      updatedEvents++
      return
    }

    if (!shouldBePresent && hasUser) {
      event.participants = uniqueParticipants.filter(id => id !== uid)
      saveOperations.push(saveEvent(event, { action: 'attendance-auto-sync' }))
      updatedEvents++
      return
    }

    // Ensure participants array is normalized even when no changes are required
    event.participants = uniqueParticipants
  })

  if (saveOperations.length > 0) {
    await Promise.all(saveOperations)
    await loadEvents()
    logEvent({
      action: 'attendance-auto-sync',
      metadata: { userId: uid, groupId: user.groupId, shouldBePresent, updatedEvents }
    })
  }

  return { updatedEvents }
}

async function saveUser(user, options = {}) {
  const db = await getDb()
  try {
    const saved = await persistGroupRecord(await clientPromise, db, 'users', normalizeGroupUser(user), options)
    user._revision = saved._revision
  } catch (error) { lastUsersLoadedAt = 0; throw error }
}

// Helper functions for reset codes in MongoDB
async function getResetCode(email) {
  const db = await getDb()
  return await db.collection('resetCodes').findOne({ email })
}

async function deleteResetCode(email) {
  const db = await getDb()
  await db.collection('resetCodes').deleteOne({ email })
}

// Clean up expired reset codes
async function cleanupExpiredResetCodes() {
  try {
    const db = await getDb()
    
    // Manual cleanup of expired codes (TTL index should handle this automatically)
    const result = await db.collection('resetCodes').deleteMany({
      expiresAt: { $lt: new Date() }
    })

    if (result.deletedCount > 0) {
      infoLog(`Cleaned up ${result.deletedCount} expired reset codes`)
    }
  } catch (error) {
    warnLog('Warning: Could not clean up expired reset codes:', error.message)
  }
}

async function cleanupExpiredSessions() {
  try {
    const db = await getDb()
    const now = new Date()
    const result = await db.collection('sessions').deleteMany({
      $or: [
        { expiresAt: { $lte: now } },
        { revokedAt: { $exists: true, $ne: null } }
      ]
    })

    if (result.deletedCount > 0) {
      infoLog(`Cleaned up ${result.deletedCount} inactive sessions`)
    }
  } catch (error) {
    warnLog('Warning: Could not clean up inactive sessions:', error.message)
  }
}

async function saveEvent(event, options = {}) {
  const db = await getDb()
  const storedEvent = { ...event }
  delete storedEvent.opkomstmakers
  delete storedEvent.schoonmakers
  const normalizedEvent = {
    ...storedEvent,
    opkomstmakerIds: sanitizeIdArray(event.opkomstmakerIds),
    schoonmakerIds: sanitizeIdArray(event.schoonmakerIds),
    participants: sanitizeIdArray(event.participants)
  }

  try {
    const saved = await persistGroupRecord(await clientPromise, db, 'events', normalizedEvent, options)
    Object.assign(event, saved)
  } catch (error) { lastEventsLoadedAt = 0; lastUsersLoadedAt = 0; throw error }
}

async function deleteEventById(event, actor) {
  const db = await getDb()
  try {
    await runGroupTransaction(await clientPromise, async session => {
      await lockGroups(db, session, [event.groupId])
      const liveActor = await db.collection('users').findOne({ id: actor.id }, { session })
      if (!canManageGroup(liveActor, event.groupId)) throw new GroupAccessError('Geen toegang tot deze groep', 403)
      const result = await db.collection('events').deleteOne(revisionFilter(event), { session })
      if (!result.deletedCount) throw new GroupAccessError('Evenement is ondertussen gewijzigd. Vernieuw de pagina.', 409)
      await writeAudit(db, { action: 'event-deleted', actor: liveActor, groupId: event.groupId, collection: 'events', targetId: event.id }, session)
    })
  } catch (error) { lastEventsLoadedAt = 0; throw error }
}

// E-mail setup
let transporter
let transporterInitPromise = null

async function createMailerTransport() {
  const host = process.env.SMTP_HOST
  const service = process.env.SMTP_SERVICE
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (host) {
    const portEnv = parseInt(process.env.SMTP_PORT, 10)
    const port = Number.isFinite(portEnv) ? portEnv : 587
    const secure = parseBoolean(process.env.SMTP_SECURE, port === 465)
    const rejectUnauthorized = parseBoolean(process.env.SMTP_REJECT_UNAUTHORIZED, true)

    const transportOptions = {
      host,
      port,
      secure
    }

    if (user && pass) {
      transportOptions.auth = { user, pass }
    } else {
      warnLog('[mail] SMTP_HOST is ingesteld maar ontbrekende SMTP_USER/SMTP_PASS; probeer verbinding zonder authenticatie')
    }

    if (!rejectUnauthorized) {
      transportOptions.tls = { rejectUnauthorized: false }
    }

    return nodemailer.createTransport(transportOptions)
  }

  if (service) {
    const transportOptions = {
      service,
      auth: user && pass ? { user, pass } : undefined,
      tls: { rejectUnauthorized: parseBoolean(process.env.SMTP_REJECT_UNAUTHORIZED, true) }
    }

    if (!transportOptions.auth) {
      warnLog(`[mail] SMTP_SERVICE=${service} geconfigureerd zonder inloggegevens; e-mails kunnen mogelijk niet verstuurd worden`)
    }

    return nodemailer.createTransport(transportOptions)
  }

  if (isProduction) {
    warnLog('[mail] Configureer SMTP_HOST of SMTP_SERVICE voor e-mail in productie')
    return null
  }
  const testAccount = await nodemailer.createTestAccount()
  infoLog(`[mail] Gebruik Ethereal test inbox ${testAccount.user} voor uitgaande e-mail`)

  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass
    }
  })
}

async function ensureMailerTransport() {
  if (transporter) {
    return transporter
  }

  if (!transporterInitPromise) {
    transporterInitPromise = (async () => {
      try {
        const mailer = await createMailerTransport()
        transporter = mailer

        if (transporter) {
          try {
            await transporter.verify()
          } catch (verifyError) {
            warnLog(`[mail] Verificatie van mailtransporter gaf waarschuwing: ${verifyError.message}`)
          }
          infoLog('[mail] Mail transporter initialised')
        }

        return transporter
      } catch (error) {
        transporter = null
        console.error('âŒ Initialisatie mailer mislukt:', error)
        logSystemError(error, { action: 'initMailer', status: 500 })
        return null
      } finally {
        transporterInitPromise = null
      }
    })()
  }

  return transporterInitPromise
}

// Hulpfuncties
function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeIban(iban = '') {
  return safeTrimmedString(iban, 64).replace(/\s+/g, '').toUpperCase()
}

function formatIban(iban = '') {
  const sanitized = sanitizeIban(iban)
  return sanitized.replace(/(.{4})/g, '$1 ').trim()
}

function maskIban(iban = '') {
  const sanitized = sanitizeIban(iban)
  if (sanitized.length <= 8) {
    return sanitized.replace(/.(?=.{4})/g, '*')
  }
  const head = sanitized.slice(0, 4)
  const tail = sanitized.slice(-4)
  return `${head}${'*'.repeat(Math.max(sanitized.length - 8, 4))}${tail}`
}

function formatCurrency(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value)) {
    return 'â‚¬Â 0,00'
  }

  try {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR'
    }).format(value)
  } catch {
    return `â‚¬ ${value.toFixed(2)}`
  }
}

function formatDateDisplay(value) {
  if (!value) {
    return 'Onbekend'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'Onbekend'
  }

  try {
    return new Intl.DateTimeFormat('nl-NL', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(parsed)
  } catch {
    return parsed.toISOString().split('T')[0]
  }
}

function sanitizeFileName(value = '') {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 60) || 'stamjer'
}

function safeTrimmedString(value, maxLength = 5000) {
  if (value === null || value === undefined) {
    return ''
  }

  const raw = typeof value === 'string' ? value : String(value)
  return raw.trim().slice(0, maxLength)
}

const PAYMENT_ATTACHMENT_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])

function detectAttachmentTypeFromBuffer(buffer) {
  if (!buffer || buffer.length < 4) {
    return ''
  }

  const isPdf =
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d

  if (isPdf) {
    return 'application/pdf'
  }

  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a

  if (isPng) {
    return 'image/png'
  }

  const isJpg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff

  if (isJpg) {
    return 'image/jpeg'
  }

  return ''
}

function resolveAttachmentType(declaredType, fileName, buffer) {
  const normalizedDeclaredType = safeTrimmedString(declaredType, 120).toLowerCase()
  if (normalizedDeclaredType === 'image/jpg') {
    return 'image/jpeg'
  }
  if (PAYMENT_ATTACHMENT_TYPES.has(normalizedDeclaredType)) {
    return normalizedDeclaredType
  }

  const detectedType = detectAttachmentTypeFromBuffer(buffer)
  if (PAYMENT_ATTACHMENT_TYPES.has(detectedType)) {
    return detectedType
  }

  const extension = safeTrimmedString(fileName, 120).toLowerCase().split('.').pop() || ''
  if (extension === 'jpg' || extension === 'jpeg') {
    return 'image/jpeg'
  }
  if (extension === 'png') {
    return 'image/png'
  }
  if (extension === 'pdf') {
    return 'application/pdf'
  }

  return ''
}

function buildReplyTo(name, email) {
  const safeEmail = safeTrimmedString(email, 254).toLowerCase()
  if (!safeEmail || !validator.isEmail(safeEmail)) {
    return undefined
  }

  const safeName = safeTrimmedString(name, 120).replace(/[\r\n]+/g, ' ')
  return safeName ? `${safeName} <${safeEmail}>` : safeEmail
}

async function buildPaymentRequestPdf(request, attachments = []) {
  const pdfDoc = await PDFDocument.create()
  pdfDoc.setCreator('Stamjer Declaratiesysteem')
  pdfDoc.setProducer('Stamjer Declaratiesysteem')
  if (request?.expenseTitle) {
    pdfDoc.setTitle(`Declaratie - ${request.expenseTitle}`)
    pdfDoc.setSubject(request.expenseTitle)
  }

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const pageSize = [595.28, 841.89] // A4 portrait in points
  const headingColor = rgb(0.12, 0.23, 0.45)
  const textColor = rgb(0.16, 0.18, 0.22)
  const leftMargin = 48
  const rightMargin = 48
  const topMargin = 72
  const bottomMargin = 72
  const lineHeight = 18
  const labelWidth = 130
  const submittedAt = request?.submittedAt ? new Date(request.submittedAt) : new Date()

  let page = pdfDoc.addPage(pageSize)
  let { width, height } = page.getSize()
  let cursorY = height - topMargin
  const maxLineWidth = width - leftMargin - rightMargin

  const ensureSpace = (lines = 1) => {
    if (cursorY - lineHeight * lines < bottomMargin) {
      page = pdfDoc.addPage(pageSize)
      ;({ width, height } = page.getSize())
      cursorY = height - topMargin
    }
  }

  const wrapText = (text = '', font = fontRegular, size = 11, maxWidth = maxLineWidth) => {
    const value = String(text || '').trim()
    if (!value) {
      return ['-']
    }

    const words = value.split(/\s+/).filter(Boolean)
    const lines = []
    let currentLine = ''

    const flushLine = () => {
      if (currentLine) {
        lines.push(currentLine)
        currentLine = ''
      }
    }

    const appendLongWord = (word) => {
      let buffer = ''
      for (const char of word) {
        const candidate = buffer + char
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          buffer = candidate
        } else {
          if (buffer) {
            if (font.widthOfTextAtSize(buffer, size) > maxWidth && buffer.length > 1) {
              const midpoint = Math.floor(buffer.length / 2)
              lines.push(buffer.slice(0, midpoint))
              buffer = buffer.slice(midpoint)
            } else {
              lines.push(buffer)
              buffer = ''
            }
          }
          buffer = char
        }
      }
      if (buffer) {
        lines.push(buffer)
      }
    }

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        currentLine = candidate
      } else {
        flushLine()
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          appendLongWord(word)
        } else {
          currentLine = word
        }
      }
    }

    flushLine()
    return lines.length > 0 ? lines : ['-']
  }

  const drawHeading = (text, size = 14) => {
    ensureSpace(2)
    page.drawText(text, {
      x: leftMargin,
      y: cursorY,
      size,
      font: fontBold,
      color: headingColor
    })
    cursorY -= size >= 16 ? 28 : 24
  }

  const drawRow = (label, value) => {
    const lines = wrapText(value, fontRegular, 11, maxLineWidth - labelWidth)
    ensureSpace(lines.length)

    page.drawText(label, {
      x: leftMargin,
      y: cursorY,
      size: 11,
      font: fontBold,
      color: headingColor
    })

    lines.forEach((line, index) => {
      page.drawText(line, {
        x: leftMargin + labelWidth,
        y: cursorY - index * lineHeight,
        size: 11,
        font: fontRegular,
        color: textColor
      })
    })

    cursorY -= lineHeight * lines.length
    cursorY -= 4
  }

  const drawParagraph = (text) => {
    const lines = wrapText(text, fontRegular, 11)
    ensureSpace(lines.length)

    lines.forEach((line, index) => {
      page.drawText(line, {
        x: leftMargin,
        y: cursorY - index * lineHeight,
        size: 11,
        font: fontRegular,
        color: textColor
      })
    })

    cursorY -= lineHeight * lines.length
    cursorY -= 8
  }

  page.drawText('Declaratieaanvraag', {
    x: leftMargin,
    y: cursorY,
    size: 22,
    font: fontBold,
    color: headingColor
  })
  cursorY -= 26

  const submittedText = new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'long',
    timeStyle: 'short'
  }).format(submittedAt)

  page.drawText(`Ingediend op ${submittedText}`, {
    x: leftMargin,
    y: cursorY,
    size: 11,
    font: fontRegular,
    color: textColor
  })
  cursorY -= 24

  drawHeading('Samenvatting', 16)

  const summaryRows = [
    ['Naam', request.requesterName || 'Onbekend'],
    ['E-mailadres', request.requesterEmail || '-'],
    ['Betaald aan', request.paidTo || '-'],
    ['Datum uitgave', formatDateDisplay(request.expenseDate)],
    ['Onderwerp', request.expenseTitle || '-'],
    ['Bedrag', formatCurrency(request.amount)],
    ['Betaalmethode', request.paymentMethod === 'paymentLink' ? 'Betaallink' : 'IBAN (bankoverschrijving)']
  ]

  if (request.paymentMethod === 'iban' && request.iban) {
    summaryRows.push(['IBAN', formatIban(request.iban)])
  }

  if (request.paymentMethod === 'paymentLink' && request.paymentLink) {
    summaryRows.push(['Betaallink', request.paymentLink])
  }

  summaryRows.forEach(([label, value]) => drawRow(label, value))

  drawHeading('Beschrijving')
  drawParagraph(request.description || 'Geen aanvullende omschrijving opgegeven.')

  if (request.notes) {
    drawHeading('Opmerking voor admins')
    drawParagraph(request.notes)
  }

  drawHeading('Bijlagen')
  if (!attachments.length) {
    drawParagraph('Geen bijlagen toegevoegd.')
  } else {
    drawParagraph('De originele bestanden vind je op de vervolgpaginaâ€™s van dit document.')
    attachments.forEach((attachment, index) => {
      ensureSpace(1)
      page.drawText(`${index + 1}. ${attachment.name} (${attachment.type})`, {
        x: leftMargin,
        y: cursorY,
        size: 11,
        font: fontRegular,
        color: textColor
      })
      cursorY -= lineHeight
    })
    cursorY -= 8
  }

  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i]

    if (attachment.type === 'application/pdf') {
      try {
        const externalPdf = await PDFDocument.load(attachment.buffer)
        const copiedPages = await pdfDoc.copyPages(externalPdf, externalPdf.getPageIndices())
        copiedPages.forEach((copiedPage) => pdfDoc.addPage(copiedPage))
      } catch {
        const attachmentPage = pdfDoc.addPage(pageSize)
        attachmentPage.drawText(`Bijlage ${i + 1}: ${attachment.name}`, {
          x: leftMargin,
          y: attachmentPage.getHeight() - topMargin,
          size: 14,
          font: fontBold,
          color: headingColor
        })
        attachmentPage.drawText('Deze PDF-bijlage kon niet worden toegevoegd.', {
          x: leftMargin,
          y: attachmentPage.getHeight() - topMargin - 24,
          size: 11,
          font: fontRegular,
          color: textColor
        })
      }
      continue
    }

    const attachmentPage = pdfDoc.addPage(pageSize)
    const { width: pageWidth, height: pageHeight } = attachmentPage.getSize()

    let embeddedImage
    try {
      if (attachment.type === 'image/png') {
        embeddedImage = await pdfDoc.embedPng(attachment.buffer)
      } else {
        embeddedImage = await pdfDoc.embedJpg(attachment.buffer)
      }
    } catch {
      attachmentPage.drawText(`Bijlage ${i + 1}: ${attachment.name}`, {
        x: leftMargin,
        y: pageHeight - topMargin,
        size: 14,
        font: fontBold,
        color: headingColor
      })
      attachmentPage.drawText('Deze afbeelding kon niet als preview in de PDF worden opgenomen.', {
        x: leftMargin,
        y: pageHeight - topMargin - 24,
        size: 11,
        font: fontRegular,
        color: textColor
      })
      continue
    }

    const maxImageWidth = pageWidth - 2 * leftMargin
    const maxImageHeight = pageHeight - 2 * topMargin - 40
    const scale = Math.min(
      maxImageWidth / embeddedImage.width,
      maxImageHeight / embeddedImage.height,
      1
    )
    const imageWidth = embeddedImage.width * scale
    const imageHeight = embeddedImage.height * scale

    attachmentPage.drawText(`Bijlage ${i + 1}: ${attachment.name}`, {
      x: leftMargin,
      y: pageHeight - topMargin + 10,
      size: 14,
      font: fontBold,
      color: headingColor
    })

    attachmentPage.drawImage(embeddedImage, {
      x: (pageWidth - imageWidth) / 2,
      y: (pageHeight - imageHeight) / 2 - 20,
      width: imageWidth,
      height: imageHeight
    })
  }

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// Cold start
await loadUsers()
await loadEvents()
await ensureMailerTransport()
await cleanupExpiredResetCodes() // Clean up old reset codes on startup
await cleanupExpiredSessions() // Clean up old sessions on startup

logEvent({ action: 'server-start', metadata: { environment: process.env.NODE_ENV || 'development' } })

// Express-app
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()

function parseOrigins(value = '') {
  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
}

const defaultProductionOrigins = ['https://stamjer.nl', 'https://www.stamjer.nl']
const envConfiguredOrigins = Array.from(new Set([
  ...parseOrigins(process.env.CLIENT_ORIGIN || ''),
  ...parseOrigins(process.env.ADDITIONAL_CORS_ORIGINS || '')
]))
const fallbackOrigins = ['http://localhost:5173', 'http://localhost:4173']

defaultProductionOrigins.forEach((origin) => {
  if (!fallbackOrigins.includes(origin)) {
    fallbackOrigins.push(origin)
  }
})

const configuredOrigins = envConfiguredOrigins.length > 0
  ? Array.from(new Set([...envConfiguredOrigins, ...defaultProductionOrigins]))
  : []

// Add Vercel URLs to fallback origins
if (process.env.VERCEL_URL) {
  fallbackOrigins.push(`https://${process.env.VERCEL_URL}`)
}
// Also add common Vercel domain patterns
if (process.env.VERCEL) {
  // If we're running on Vercel, allow all .vercel.app domains
  fallbackOrigins.push('https://stamjer.vercel.app')
  fallbackOrigins.push('https://stamjer-git-main-stamjer.vercel.app')
  // Add any other deployment URLs that might be used
}

const corsAllowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : fallbackOrigins
const allowAllLocalOrigins = !isProduction && configuredOrigins.length === 0

const corsOptions = {
  origin(origin, callback) {
    // Always allow requests without origin (e.g., mobile apps, Postman)
    if (!origin) {
      return callback(null, true)
    }
    
    // Allow configured origins
    if (corsAllowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    
    // Allow all local origins in development
    if (allowAllLocalOrigins) {
      return callback(null, true)
    }
    
    // For Vercel deployments, be more flexible with .vercel.app domains
    if (process.env.VERCEL && origin.includes('.vercel.app')) {
      return callback(null, true)
    }
    
    debugLog('Blocked request from origin', origin)
    return callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  allowedHeaders: ['Content-Type'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}

app.use((req, res, next) => {
  cors(corsOptions)(req, res, (err) => {
    if (err) {
      warnLog(`Blocked CORS request from ${req.headers.origin || 'unknown origin'}`)
      return res.status(403).json({ msg: 'Origin not allowed' })
    }
    return next()
  })
})

app.use(express.json({ limit: '25mb' }))
app.use(createRequestLogger())

// API-router
const apiRouter = express.Router()
apiRouter.use('/developer/database', createDatabaseManagementRouter({ requireAuthenticatedUser, getDb,
  getClient: () => clientPromise, secret: TOKEN_SECRET, updateUser: updateManagedUser, updateEvent: updateManagedEvent }))
apiRouter.use('/groups', createGroupManagementRouter({
  requireAuthenticatedUser, getDb, getClient: () => clientPromise, mapEventForClient,
  getData: async () => {
    await Promise.all([ensureUsersFresh(), ensureEventsFresh()])
    return { users, events }
  }
}))

// Eenvoudige test
apiRouter.get('/test', (req, res) => {
  res.json({ msg: 'API is in orde' })
})

// Gebruikers ophalen
apiRouter.get('/users', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return

    const group = await resolveGroup(req, auth.user, { allowAllGroups: true })
    const visibleUsers = users.filter((user) => !isDeveloper(user) && (!group || user.groupId === group.id))
    const safeUsers = visibleUsers.map(u => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      groupId: u.groupId,
      status: u.status
    }))
    res.json(safeUsers)
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error('Fout bij ophalen gebruikers:', err)
    logSystemError(err, { action: 'GET /api/users', status: 500 })
    res.status(500).json({ error: 'Opvragen gebruikers mislukt', message: err.message })
  }
})

apiRouter.get('/users/full', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return

    const group = await resolveGroup(req, auth.user, { allowAllGroups: true })
    await ensureEventsFresh()
    const visibleUsers = users.filter((user) => !isDeveloper(user)
      && (!group || user.groupId === group.id)
      && (normalizeUserRole(auth.user) !== 'user' || user.id === auth.userId))
    const streepjes = Object.assign({}, ...Array.from(new Set(visibleUsers.map((user) => user.groupId)))
      .map((groupId) => calculateGroupStreepjes(users, events, groupId)))
    res.json({
      users: visibleUsers.map(u => mapManagedUser(u, streepjes[u.id] || 0))
    })
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error('Fout bij ophalen volledige gebruikerslijst:', err)
    logSystemError(err, { action: 'GET /api/users/full', status: 500 })
    res.status(500).json({ error: 'Opvragen volledige gebruikerslijst mislukt', message: err.message })
  }
})

async function updateManagedUser(req, res, { roleOnly = false, expectedFingerprint } = {}) {
  const auth = await requireAuthenticatedUser(req, res, { requireAdmin: true })
  if (!auth) return
  const id = sanitizeUserId(req.params.id)
  if (id === null) throw new GroupAccessError('Ongeldig gebruikers-ID', 400)
  const index = users.findIndex((user) => user.id === id)
  const current = users[index]
  if (!current || !canManageUser(auth.user, current)) throw new GroupAccessError('Gebruiker niet gevonden', 404)
  if (!isDeveloper(current)) {
    if (req.query?.groupId !== undefined && req.query.groupId !== current.groupId) throw new GroupAccessError('Deze gebruiker hoort niet bij de geselecteerde groep', 400)
    await resolveGroup({ query: { groupId: current.groupId }, body: {} }, auth.user, { requireActive: true })
  }
  if (roleOnly && (!req.body || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'role'))) {
    throw new GroupAccessError('Alleen role kan via dit endpoint worden gewijzigd', 400)
  }
  const updated = buildUserUpdate(auth.user, current, req.body)
  const changedFields = Object.keys(req.body).filter((key) => updated[key] !== current[key])
  if (changedFields.includes('email')) {
    await loadUsers()
    if (users.some((user) => user.id !== id && user.email?.toLowerCase() === updated.email)) {
      throw new GroupAccessError('Dit e-mailadres bestaat al', 409)
    }
  }
  try { await saveUser(updated, { actor: auth.user, expectedFingerprint }) } catch (error) {
    if (error.code === 11000) throw new GroupAccessError('Dit e-mailadres bestaat al', 409)
    throw error
  }
  // A refresh above may have replaced the shared users array.
  users[users.findIndex((user) => user.id === id)] = updated
  let attendanceUpdates = 0
  if (changedFields.includes('status')) {
    attendanceUpdates = (await syncUserAttendanceForFutureOpkomsten(id, updated.status === 'active')).updatedEvents
    await sendStatusChangeEmail(updated, updated.status)
  }
  if (changedFields.includes('role') || changedFields.includes('email')) {
    await revokeUserSessions(id, { exceptSessionId: id === auth.userId ? auth.session?.sessionId : null })
  }
  logEvent({ action: 'user-updated', actor: auth.userId, metadata: { groupId: updated.groupId, targetUserId: id, role: updated.role, changedFields: changedFields.join(',') } })
  res.json({ user: mapManagedUser(updated), attendanceUpdates, msg: 'Gebruiker bijgewerkt' })
}

apiRouter.patch('/users/:id', (req, res) => updateManagedUser(req, res))
apiRouter.patch('/users/:id/role', (req, res) => updateManagedUser(req, res, { roleOnly: true }))
apiRouter.post('/users/:id/password-email', async (req, res) => {
  const auth = await requireAuthenticatedUser(req, res, { requireAdmin: true })
  if (!auth) return
  const id = sanitizeUserId(req.params.id)
  const target = users.find(user => user.id === id)
  if (!target || !canManageUser(auth.user, target) || isDeveloper(target)) throw new GroupAccessError('Gebruiker niet gevonden', 404)
  await resolveGroup({ query: { groupId: target.groupId }, body: {} }, auth.user, { requireActive: true })
  if (!req.body || Object.keys(req.body).some(key => key !== 'purpose')) throw new GroupAccessError('Ongeldige e-mailactie', 400)
  await sendPasswordInvitation(await clientPromise, await getDb(), { userId: id, actor: auth.user, purpose: req.body.purpose,
    mailer: await ensureMailerTransport(), from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com' })
  res.json({ msg: 'E-mail verstuurd. De herstelcode is 15 minuten geldig.' })
})

apiRouter.post('/users/:id/group/preview', async (req, res) => {
  const auth = await requireAuthenticatedUser(req, res)
  if (!auth) return
  if (!isDeveloper(auth.user)) throw new GroupAccessError('Alleen developers kunnen gebruikers verplaatsen', 403)
  const userId = sanitizeUserId(req.params.id)
  if (userId === null) throw new GroupAccessError('Ongeldig gebruikers-ID', 400)
  if (!req.body || Object.keys(req.body).some(key => key !== 'groupId')) throw new GroupAccessError('Gebruik alleen groupId', 400)
  res.setHeader('Cache-Control', 'no-store')
  res.json(await previewUserGroupMove(await clientPromise, await getDb(), {
    userId, destinationGroupId: req.body.groupId, actorId: auth.userId, secret: TOKEN_SECRET
  }))
})

apiRouter.patch('/users/:id/group', async (req, res) => {
  const auth = await requireAuthenticatedUser(req, res)
  if (!auth) return
  if (!isDeveloper(auth.user)) throw new GroupAccessError('Alleen developers kunnen gebruikers verplaatsen', 403)
  const userId = sanitizeUserId(req.params.id)
  if (userId === null) throw new GroupAccessError('Ongeldig gebruikers-ID', 400)
  if (!req.body || Object.keys(req.body).some(key => !['groupId', 'previewToken'].includes(key))) throw new GroupAccessError('Ongeldige verplaatsingsgegevens', 400)
  const result = await applyUserGroupMove(await clientPromise, await getDb(), {
    userId, destinationGroupId: req.body.groupId, previewToken: req.body.previewToken,
    actorId: auth.userId, secret: TOKEN_SECRET
  })
  // Refresh both shared caches only after the atomic move committed.
  lastUsersLoadedAt = 0
  lastEventsLoadedAt = 0
  await loadUsers()
  await loadEvents()
  logEvent({ action: 'user-group-moved', actor: auth.userId, metadata: {
    targetUserId: userId, groupId: result.summary.sourceGroupId, destinationGroupId: result.summary.destinationGroupId,
    role: 'developer', changedFields: 'groupId,role,sessions,eventReferences', moveId: result.moveId
  } })
  res.json({ user: mapManagedUser(result.user), summary: result.summary, msg: 'Gebruiker verplaatst. Opnieuw inloggen is vereist.' })
})

apiRouter.get('/users/group-history', async (req, res) => {
  const auth = await requireAuthenticatedUser(req, res, { requireAdmin: true })
  if (!auth) return
  const group = await resolveGroup(req, auth.user, { allowAllGroups: true })
  const db = await getDb()
  const history = await db.collection('userGroupHistory').find(group ? { groupId: group.id } : {}).toArray()
  res.setHeader('Cache-Control', 'no-store')
  res.json({ history: history.sort((a, b) => new Date(b.movedAt) - new Date(a.movedAt)).map(record => ({
    id: record.id, userId: record.userId, groupId: record.groupId, name: record.name,
    movedAt: record.movedAt, previousRole: record.previousRole, status: record.status,
    streepjes: record.streepjes, events: record.events.map(event => ({
      eventId: event.eventId, title: event.title, start: event.start, future: event.future,
      participant: sanitizeIdArray(event.references.participants).includes(record.userId),
      opkomstmaker: sanitizeIdArray(event.references.opkomstmakerIds).includes(record.userId),
      schoonmaker: sanitizeIdArray(event.references.schoonmakerIds).includes(record.userId),
      attendance: Object.hasOwn(event.references.attendance || {}, record.userId)
        ? Boolean(event.references.attendance[record.userId]?.present ?? event.references.attendance[record.userId]) : null,
      streepjes: event.streepjes
    }))
  })) })
})

apiRouter.post('/users', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return

    const firstName = safeTrimmedString(req.body?.firstName, 80)
    const lastName = safeTrimmedString(req.body?.lastName, 120)
    const email = safeTrimmedString(req.body?.email, 254).toLowerCase()
    const group = await resolveGroup(req, auth.user, { requireActive: true })
    const role = req.body?.role ?? (req.body?.isAdmin === true ? 'admin' : 'user')
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Kies de rol user of admin' })
    }
    if (role === 'admin' && !isDeveloper(auth.user)) {
      return res.status(403).json({ error: 'Alleen developers kunnen beheerders aanmaken' })
    }

    if (!firstName || !lastName || !validator.isEmail(email)) {
      return res.status(400).json({ error: 'Voornaam, achternaam en een geldig e-mailadres zijn verplicht' })
    }

    await loadUsers()
    if (users.some((user) => user.email?.toLowerCase() === email)) {
      return res.status(409).json({ error: 'Er bestaat al een gebruiker met dit e-mailadres' })
    }

    const nextId = users.reduce((highestId, user) => {
      const id = sanitizeUserId(user.id)
      return id === null ? highestId : Math.max(highestId, id)
    }, 0) + 1

    const newUser = {
      id: nextId,
      firstName,
      lastName,
      email,
      password: await bcrypt.hash(randomBytes(32).toString('base64url'), 10),
      role,
      groupId: group.id,
      isAdmin: role === 'admin',
      isDeveloper: false,
      status: 'active',
      sessionVersion: 0,
      createdAt: new Date()
    }

    await saveUser(newUser, { creating: true, actor: auth.user })
    users.push(newUser)
    const attendanceSync = await syncUserAttendanceForFutureOpkomsten(newUser.id, true)

    logEvent({
      action: 'user-created',
      actor: auth.userId,
      metadata: {
        targetUserId: newUser.id,
        createdBy: auth.userId,
        groupId: group.id,
        role,
        changedFields: 'firstName,lastName,email,role,groupId,status'
      }
    })

    res.status(201).json({
      user: mapUserForClient(newUser),
      attendanceUpdates: attendanceSync.updatedEvents,
      msg: 'Gebruiker toegevoegd'
    })
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Dit e-mailadres of gebruikers-ID bestaat al' })
    }
    logSystemError(err, { action: 'POST /api/users', status: 500 })
    res.status(500).json({ error: 'Gebruiker toevoegen mislukt' })
  }
})

// Helper function to send active status change notification email
async function sendStatusChangeEmail(user, newStatus) {
  try {
    const recipient = await getGroupEmail(user.groupId, 'dailyChangeEmail')
    if (!recipient) return
    const statusText = newStatus === 'active' ? 'actief' : newStatus === 'inactive' ? 'inactief' : 'alumni'

    const mailer = await ensureMailerTransport()
    if (!mailer) {
      warnLog('Status change notification skipped: transporter niet beschikbaar')
      return
    }

    await mailer.sendMail({
      from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com',
      to: recipient,
      subject: `Stamjer - Status wijziging: ${user.firstName} ${user.lastName}`,
      html: `
        <h2>Status wijziging</h2>
        <p><strong>${user.firstName} ${user.lastName}</strong> heeft zijn/haar status gewijzigd.</p>
        
        <table style="border-collapse: collapse; width: 100%; max-width: 400px;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Naam:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${user.firstName} ${user.lastName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">E-mail:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${user.email}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Nieuwe status:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${statusText}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Datum/tijd:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${new Date().toLocaleString('nl-NL')}</td>
          </tr>
        </table>
        
        <p><em>Deze e-mail is automatisch gegenereerd door het Stamjer systeem.</em></p>
      `
    })
    debugLog('Status change email sent', { userId: user.id, status: newStatus })
  } catch (error) {
    console.error('Error sending status change email:', error)
    logSystemError(error, { action: 'notify-user-status', status: 500, metadata: { userId: user?.id, newStatus } })
  }
}

async function applyUserStatusChange(user, status, changedBy, actor) {
  const previousStatus = user.status
  if (previousStatus === status) return { updatedEvents: 0, changed: false }

  const updated = { ...user, status }
  await saveUser(updated, { actor })
  Object.assign(user, updated)
  const attendanceSync = await syncUserAttendanceForFutureOpkomsten(user.id, status === 'active')
  await sendStatusChangeEmail(user, status)
  logEvent({
    action: 'user-status-changed',
    actor: changedBy,
    metadata: { targetUserId: user.id, groupId: user.groupId, previousStatus, newStatus: status, changedFields: 'status' }
  })
  return { ...attendanceSync, changed: true }
}

// Profiel bijwerken
apiRouter.put('/user/profile', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return

    if (isDeveloper(auth.user)) return res.status(403).json({ error: 'Developers hebben geen aanwezigheidsstatus' })
    await resolveGroup(req, auth.user, { requireActive: true })
    if (normalizeUserRole(auth.user) === 'user' && auth.user.permissions?.canUseAttendance === false) {
      return res.status(403).json({ error: 'Zelf aanwezigheid wijzigen is voor deze groep uitgeschakeld' })
    }

    const { status } = req.body
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Kies de status active of inactive' })
    }
    const uid = auth.userId
    const idx = users.findIndex(u => u.id === uid)
    if (idx < 0) return res.status(404).json({ error: 'Gebruiker niet gevonden' })
    if (users[idx].status === 'legacy') {
      return res.status(403).json({ error: 'Een alumni-status kan alleen door een beheerder worden gewijzigd' })
    }

    const attendanceSync = await applyUserStatusChange(users[idx], status, auth.userId, auth.user)
    res.json({ 
      user: mapUserForClient(await withUserPermissions(users[idx])),
      msg: 'Profiel succesvol bijgewerkt',
      attendanceUpdates: attendanceSync.updatedEvents
    })
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error(err)
    logSystemError(err, { action: 'PUT /api/user/profile', status: 500, metadata: req.body })
    res.status(500).json({ error: 'Profiel bijwerken mislukt' })
  }
})

// Status bijwerken (alleen admin)
apiRouter.patch('/users/:id/status', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return

    const { status } = req.body

    if (!USER_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Ongeldige status. Kies uit: active, inactive, legacy' })
    }

    const targetId = sanitizeUserId(req.params.id)
    if (targetId === null) return res.status(400).json({ error: 'Ongeldig gebruikers-ID' })

    const idx = users.findIndex(u => u.id === targetId)
    if (idx < 0) return res.status(404).json({ error: 'Gebruiker niet gevonden' })
    if (!canManageUser(auth.user, users[idx]) || isDeveloper(users[idx])) {
      return res.status(404).json({ error: 'Gebruiker niet gevonden' })
    }
    if (req.query?.groupId !== undefined && req.query.groupId !== users[idx].groupId) {
      throw new GroupAccessError('De geselecteerde groep hoort niet bij deze gebruiker', 400)
    }
    await resolveGroup({ ...req, query: { ...req.query, groupId: req.query?.groupId ?? users[idx].groupId } }, auth.user, { requireActive: true })

    if (users[idx].status === status) {
      return res.json({ user: { id: targetId, status }, msg: 'Status ongewijzigd' })
    }

    await applyUserStatusChange(users[idx], status, auth.userId, auth.user)

    res.json({
      user: { id: targetId, status },
      msg: `Status bijgewerkt naar ${status}`
    })
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    logSystemError(err, { action: 'PATCH /api/users/:id/status', status: 500 })
    res.status(500).json({ error: 'Status bijwerken mislukt' })
  }
})

// Profiel ophalen
apiRouter.get('/user/profile', async (req, res) => {
  const auth = await requireAuthenticatedUser(req, res)
  if (!auth) return

  const uid = auth.userId

  const user = users.find((u) => u.id === uid)
  if (!user) {
    return res.status(404).json({ error: 'Gebruiker niet gevonden' })
  }

  res.json({ user: mapUserForClient(auth.user, auth.session) })
})

// Evenementen ophalen
apiRouter.get('/events', async (req, res) => {
  const auth = await requireAuthenticatedUser(req, res)
  if (!auth) return
  const group = await resolveGroup(req, auth.user, { allowAllGroups: true })
  await ensureEventsFresh()
  res.json({ events: events.filter((event) => !group || event.groupId === group.id).map(mapEventForClient) })
})

apiRouter.get('/events/opkomsten', async (req, res) => {
  const auth = await requireAuthenticatedUser(req, res)
  if (!auth) return
  const group = await resolveGroup(req, auth.user, { allowAllGroups: true })
  await ensureEventsFresh()
  res.json({ events: events.filter(e => e.isOpkomst && (!group || e.groupId === group.id)).map(mapEventForClient) })
})

// Evenement aanmaken
apiRouter.post('/events', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return
    await ensureEventsFresh()
    const group = await resolveGroup(req, auth.user, { requireActive: true })
    validateEventInput({ groupId: group.id }, req.body, users, { creating: true })
    const id = randomUUID()
    const newEv = applyEventInput({
      id,
      groupId: group.id,
      title: '', start: '', end: '', allDay: false, location: '', description: '',
      isOpkomst: false, opkomstmakerIds: [], legacyOpkomstmakerNames: [],
      isSchoonmaak: false, schoonmakerIds: [], legacySchoonmakerNames: [],
      schoonmaakOptions: [], participants: []
    }, req.body)
    if (!newEv.title || !newEv.start) return res.status(400).json({ msg: 'Titel en startdatum zijn vereist' })

    await saveEvent(newEv, { creating: true, actor: auth.user })
    await ensureEventsFresh(0)
    logEvent({ action: 'event-created', actor: auth.userId, metadata: { eventId: id, groupId: group.id, changedFields: Object.keys(req.body).join(',') } })
    res.status(201).json(mapEventForClient(newEv))
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error(err)
    logSystemError(err, { action: 'POST /api/events', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Aanmaken evenement mislukt' })
  }
})

// Evenement bijwerken
async function updateManagedEvent(req, res, { expectedFingerprint } = {}) {
  try {
    const auth = await requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return
    await ensureEventsFresh()
    const { id } = req.params
    const idx = events.findIndex(e => e.id === id)
    if (idx < 0) return res.status(404).json({ msg: 'Niet gevonden' })
    await requireEventAccess(req, auth.user, events[idx], { manage: true })
    validateEventInput(events[idx], req.body, users)
    const updated = applyEventInput(events[idx], req.body)
    if (!updated.title || !updated.start) return res.status(400).json({ msg: 'Titel en startdatum zijn vereist' })

    await saveEvent(updated, { actor: auth.user, expectedFingerprint })
    await ensureEventsFresh(0)
    logEvent({ action: 'event-updated', actor: auth.userId, metadata: { eventId: id, groupId: updated.groupId, changedFields: Object.keys(req.body).join(',') } })
    res.json(mapEventForClient(updated))
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error(err)
    logSystemError(err, { action: 'PUT /api/events/:id', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Bijwerken evenement mislukt' })
  }
}
apiRouter.put('/events/:id', (req, res) => updateManagedEvent(req, res))

// Evenement verwijderen
apiRouter.delete('/events/:id', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return
    await ensureEventsFresh()
    const { id } = req.params
    const idx = events.findIndex(e => e.id === id)
    if (idx < 0) return res.status(404).json({ msg: 'Niet gevonden' })
    await requireEventAccess(req, auth.user, events[idx], { manage: true })
    const removed = events[idx]
    await deleteEventById(removed, auth.user)
    await ensureEventsFresh(0)
    logEvent({ action: 'event-deleted', actor: auth.userId, metadata: { eventId: id, groupId: removed.groupId } })
    res.json({ msg: 'Evenement verwijderd', event: mapEventForClient(removed) })
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error(err)
    logSystemError(err, { action: 'DELETE /api/events/:id', status: 500, metadata: req.params })
    res.status(500).json({ msg: 'Verwijderen mislukt' })
  }
})

// Aanwezigheid bijwerken
apiRouter.put('/events/:id/attendance', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return
    await ensureEventsFresh()
    const { id } = req.params
    const { attending } = req.body
    if (typeof attending !== 'boolean') return res.status(400).json({ msg: 'Aanwezigheid moet true of false zijn' })
    const requestedUserId = req.body.userId === undefined ? auth.userId : sanitizeUserId(req.body.userId)
    if (requestedUserId === null) return res.status(400).json({ msg: 'Ongeldig gebruikers-ID' })
    const targetUser = users.find((user) => user.id === requestedUserId)
    if (!targetUser) return res.status(404).json({ msg: 'Gebruiker niet gevonden' })
    const cachedEvent = events.find(e => e.id === id)
    if (!cachedEvent) return res.status(404).json({ msg: 'Niet gevonden' })
    const ev = { ...cachedEvent, attendance: { ...cachedEvent.attendance } }
    await requireEventAccess(req, auth.user, ev)
    if (normalizeUserRole(auth.user) === 'user' && auth.user.permissions?.canUseAttendance === false) {
      return res.status(403).json({ msg: 'Zelf aanwezigheid wijzigen is voor deze groep uitgeschakeld' })
    }
    const attendanceAuthorizationError = getAttendanceAuthorizationError(auth.user, targetUser, attending, ev)
    if (attendanceAuthorizationError === 'FORBIDDEN') {
      return res.status(403).json({ msg: 'Je kunt alleen je eigen aanwezigheid wijzigen' })
    }
    if (attendanceAuthorizationError === 'ALUMNI_ATTENDANCE') {
      return res.status(400).json({ msg: 'Alumni kunnen niet aan een opkomst worden toegevoegd' })
    }
    
    // Only opkomst events have participants/attendance
    if (!ev.isOpkomst) {
      return res.status(400).json({ msg: 'Aanwezigheid kan alleen bijgewerkt worden voor opkomst evenementen' })
    }
    
    if (!ev.participants) ev.participants = []
    const uid = requestedUserId
    const idx = ev.participants.indexOf(uid)
    
    // Track the change for logging
    const changeDetails = {
      groupId: ev.groupId,
      title: ev.title,
      start: ev.start,
      participantId: uid,
      action: attending ? 'joined' : 'left'
    }
    
    if (attending && idx < 0) {
      ev.participants.push(uid)
      // Find user for logging
      const user = users.find(u => u.id === uid)
      if (user) {
        changeDetails.participantName = `${user.firstName} ${user.lastName}`
      }
    }
    if (!attending && idx >= 0) {
      ev.participants.splice(idx, 1)
      // Find user for logging
      const user = users.find(u => u.id === uid)
      if (user) {
        changeDetails.participantName = `${user.firstName} ${user.lastName}`
      }
    }
    
    await saveEvent(ev, { actor: auth.user, attendance: { targetId: requestedUserId, attending } })
    await loadEvents()
    
    logEvent({ action: 'attendance-updated', actor: auth.userId, metadata: changeDetails })
    res.json({ msg: 'Aanwezigheid bijgewerkt', event: mapEventForClient(ev) })
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error(err)
    logSystemError(err, { action: 'PUT /api/events/:id/attendance', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Bijwerken aanwezigheid mislukt' })
  }
})

// AUTHENTICATIE
apiRouter.get('/session', async (req, res) => {
  try {
    const auth = await getAuthenticatedUser(req)
    if (auth.error) {
      clearSessionCookie(res)
      return res.status(401).json({ error: 'Geen geldige sessie' })
    }

    let session = auth.session
    if (!session) {
      const issued = await createUserSession(auth.user, req)
      setSessionCookie(res, issued.token)
      session = issued.session
    } else if (auth.token) {
      // Refresh the persistent cookie whenever the app validates this device session.
      setSessionCookie(res, auth.token)
    }

    res.json({ user: mapUserForClient(auth.user, session) })
  } catch (error) {
    console.error('Session lookup error details:', error)
    logSystemError(error, { action: 'GET /api/session', status: 500 })
    res.status(500).json({ msg: 'Sessie ophalen mislukt' })
  }
})

apiRouter.post('/login', async (req, res) => {
  try {
    await loadUsers()
    const { email, password } = req.body
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) return res.status(400).json({ msg: 'Inloggegevens ontbreken' })
    
    // Normalize email to lowercase for consistent comparison
    const normalizedEmail = email.trim().toLowerCase()
    const u = users.find(u => u.email.toLowerCase() === normalizedEmail)
    if (!u) return res.status(400).json({ msg: 'Gebruiker niet gevonden' })

    const match = await bcrypt.compare(password, u.password)

    if (!match) return res.status(400).json({ msg: 'Onjuist wachtwoord' })

    const { token, session } = await createUserSession(u, req)
    setSessionCookie(res, token)

    res.json({ user: mapUserForClient(await withUserPermissions(u), session) })
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error('Login error details:', err)
    logSystemError(err, { action: 'POST /api/login', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Inloggen mislukt' })
  }
})

apiRouter.post('/logout', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return

    if (auth.session?.sessionId) {
      await revokeSession(auth.session.sessionId)
    }

    const idx = users.findIndex((u) => u.id === auth.userId)
    if (idx >= 0) {
      users[idx].sessionVersion = (users[idx].sessionVersion || 0) + 1
      await saveUser(users[idx], { actor: auth.user, allowArchived: true })
    }

    clearSessionCookie(res)
    res.json({ ok: true })
  } catch (error) {
    console.error('Logout error details:', error)
    logSystemError(error, { action: 'POST /api/logout', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Uitloggen mislukt' })
  }
})

// Wachtwoord vergeten
apiRouter.post('/forgot-password', async (req, res) => {
  try {
    // Normalize email the same way as reset-password
    const rawEmail = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    
    debugLog('Forgot password request received', { email: maskEmail(rawEmail) })
    
    if (!rawEmail || !validator.isEmail(rawEmail))
      return res.status(400).json({ msg: 'Ongeldig e-mailadres' })

    await loadUsers()
    const u = users.find(u => u.email.toLowerCase() === rawEmail)
    debugLog('Forgot password lookup result', { email: maskEmail(rawEmail), userFound: Boolean(u) })
    debugLog('Known user accounts for debugging', { count: users.length })
    
    const generic = 'Als het e-mailadres bestaat, ontvang je een herstelcode via e-mail.'
    if (u) {
      try {
        await sendPasswordInvitation(await clientPromise, await getDb(), { userId: u.id,
          mailer: await ensureMailerTransport(), from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com' })
      } catch (error) {
        // Keep the public response generic, including delivery/rate-limit failure.
        if (!(error instanceof GroupAccessError) || ![429, 503].includes(error.status)) throw error
      }
    }
    res.json({ msg: generic })
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error(err)
    logSystemError(err, { action: 'POST /api/forgot-password', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Verzoek wachtwoordherstel mislukt' })
  }
})

// Wachtwoord herstellen
apiRouter.post('/reset-password', async (req, res) => {
  try {
    // 1) Normalize & trim email
    const rawEmail = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''

    // 2) Grab the code (trim whitespace), support both `code` and `verificationCode`
    const code = (req.body.code ?? req.body.verificationCode ?? '')
                   .toString()
                   .trim()

    // 3) Grab the new password, support `password` or `newPassword`
    const newPassword = (req.body.password ?? req.body.newPassword) || ''

    // 4) Basic validations
    if (!rawEmail || !code || typeof newPassword !== 'string' || newPassword.length < 12) {
      return res
        .status(400)
        .json({ msg: 'E-mail, code en minimaal 12-karakter wachtwoord zijn vereist' })
    }

    // 5) Lookup pending code & validate expiry
    debugLog('Reset password request received', { email: maskEmail(rawEmail) })
    
    const rec = await getResetCode(rawEmail)
    debugLog('Reset code lookup result', { email: maskEmail(rawEmail), recordFound: Boolean(rec) })
    
    if (!rec) {
      return res.status(400).json({ msg: 'Geen actieve herstelcode gevonden voor dit e-mailadres' })
    }
    
    if ((rec.failedAttempts || 0) >= 5) return res.status(429).json({ msg: 'Te veel onjuiste pogingen. Vraag een nieuwe herstelcode aan.' })
    if (rec.code !== code) {
      const db = await getDb()
      await db.collection('resetCodes').updateOne({ email: rawEmail, code: rec.code }, { $inc: { failedAttempts: 1 } })
      return res.status(400).json({ msg: 'Ongeldige herstelcode' })
    }
    
    if (Date.now() > rec.expiresAt) {
      await deleteResetCode(rawEmail) // Clean up expired code
      return res.status(400).json({ msg: 'Herstelcode is verlopen. Vraag een nieuwe aan.' })
    }

    // 6) Find user and hash the new password
    await loadUsers()
    const idx = users.findIndex(u => u.email.toLowerCase() === rawEmail)
    if (idx < 0) {
      return res.status(400).json({ msg: 'Gebruiker niet gevonden' })
    }

    const updated = { ...users[idx], password: await bcrypt.hash(newPassword, 10), sessionVersion: (users[idx].sessionVersion || 0) + 1 }
    await saveUser(updated, { allowArchived: true, resetCode: code, action: 'password-reset-completed' })
    await loadUsers()

    // 7) Success response
    res.json({ msg: 'Wachtwoord succesvol gereset' })

  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error('Reset-password error:', err)
    logSystemError(err, { action: 'POST /api/reset-password', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Wachtwoordherstel mislukt' })
  }
})


// Wachtwoord wijzigen
apiRouter.post('/change-password', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return

    const { email, currentPassword, newPassword } = req.body
    if (typeof email !== 'string' || typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 12) return res.status(400).json({ msg: 'Gebruik een nieuw wachtwoord van minimaal 12 tekens' })

    // Normalize email to lowercase for consistent comparison
    const normalizedEmail = email.trim().toLowerCase()
    const u = users.find(u => u.email.toLowerCase() === normalizedEmail)
    if (!u) return res.status(404).json({ msg: 'Gebruiker niet gevonden' })
    if (u.id !== auth.userId) return res.status(403).json({ msg: 'Je kunt alleen je eigen wachtwoord wijzigen' })

    const valid = await bcrypt.compare(currentPassword, u.password)
    if (!valid) return res.status(400).json({ msg: 'Huidig wachtwoord onjuist' })

    const updated = { ...u, password: await bcrypt.hash(newPassword, 10), sessionVersion: (u.sessionVersion || 0) + 1 }
    await saveUser(updated, { actor: auth.user, allowArchived: true, action: 'password-changed' })
    await loadUsers()
    await revokeUserSessions(u.id, { exceptSessionId: auth.session?.sessionId || null })
    res.json({ msg: 'Wachtwoord gewijzigd' })
  } catch (err) {
    if (err instanceof GroupAccessError) throw err
    console.error(err)
    logSystemError(err, { action: 'POST /api/change-password', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Wijzigen mislukt' })
  }
})

// Declaratie indienen
apiRouter.post('/payment-requests', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return
    const group = await resolveGroup(req, auth.user, { requireActive: true })
    const recipient = await getGroupEmail(group.id, 'paymentRequestEmail')
    if (!recipient) return res.status(503).json({ msg: 'Voor deze groep is geen declaratieadres ingesteld.' })

    const {
      requesterName = '',
      requesterEmail = '',
      expenseTitle = '',
      paidTo = '',
      expenseDate,
      amount,
      description = '',
      notes = '',
      paymentMethod = 'iban',
      iban = '',
      paymentLink = '',
      attachments = []
    } = req.body || {}

    const errors = []
    const trimmedName = safeTrimmedString(requesterName, 120)
    const trimmedEmail = safeTrimmedString(requesterEmail, 254).toLowerCase()
    const normalizedPaymentMethod = paymentMethod === 'paymentLink' ? 'paymentLink' : 'iban'
    const trimmedExpenseTitle = safeTrimmedString(expenseTitle, 200)
    const trimmedPaidTo = safeTrimmedString(paidTo, 200)
    const trimmedDescription = safeTrimmedString(description, 6000)
    const trimmedNotes = safeTrimmedString(notes, 3000)
    const sanitizedIban = normalizedPaymentMethod === 'iban' ? sanitizeIban(iban) : ''
    const trimmedPaymentLink = normalizedPaymentMethod === 'paymentLink' ? safeTrimmedString(paymentLink, 1024) : ''
    const submittedAt = new Date()
    const normalizedAmount = typeof amount === 'string'
      ? amount.replace(',', '.').trim()
      : amount
    const amountNumber = Number.parseFloat(normalizedAmount)
    const expenseDateValue = expenseDate ? new Date(expenseDate) : null

    if (!trimmedName) {
      errors.push('Naam is verplicht.')
    }

    if (!trimmedEmail || !validator.isEmail(trimmedEmail)) {
      errors.push('Gebruik een geldig e-mailadres.')
    }

    if (!trimmedExpenseTitle) {
      errors.push('Omschrijf kort waarvoor je hebt betaald.')
    }

    if (!trimmedPaidTo) {
      errors.push('Vul in aan wie je hebt betaald.')
    }

    if (!expenseDateValue || Number.isNaN(expenseDateValue.getTime())) {
      errors.push('Kies een geldige datum waarop je hebt betaald.')
    }

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      errors.push('Voer een geldig bedrag groter dan 0 in.')
    }

    if (normalizedPaymentMethod === 'iban') {
      if (!sanitizedIban) {
        errors.push('IBAN is verplicht wanneer je kiest voor overschrijven.')
      } else if (!validator.isIBAN(sanitizedIban)) {
        errors.push(`Dit IBAN-nummer is ongeldig (${sanitizedIban.substring(0, 6)}...${sanitizedIban.substring(sanitizedIban.length - 2)}). Het heeft het juiste formaat, maar de controle-cijfers kloppen niet. Controleer of je het correct hebt overgetypt.`)
      }
    } else if (normalizedPaymentMethod === 'paymentLink') {
      if (!trimmedPaymentLink) {
        errors.push('Voeg een betaallink toe of kies voor IBAN.')
      } else if (!validator.isURL(trimmedPaymentLink, { require_protocol: true })) {
        errors.push('De betaallink moet beginnen met http(s)://')
      }
    }

    const attachmentPayload = Array.isArray(attachments) ? attachments : []
    if (attachmentPayload.length > PAYMENT_REQUEST_ATTACHMENT_LIMIT) {
      const maxText = PAYMENT_REQUEST_ATTACHMENT_LIMIT === 1
        ? '1 bestand'
        : `${PAYMENT_REQUEST_ATTACHMENT_LIMIT} bestanden`
      errors.push(`Je kunt maximaal ${maxText} meesturen.`)
    }

    const sanitizedAttachments = []
    let totalAttachmentSize = 0

    for (let i = 0; i < attachmentPayload.length; i++) {
      const attachment = attachmentPayload[i] || {}
      const base64Content = safeTrimmedString(attachment.content, PAYMENT_REQUEST_TOTAL_SIZE_LIMIT * 3)
      const declaredType = safeTrimmedString(attachment.type, 120).toLowerCase()
      const originalName = safeTrimmedString(attachment.name || `bijlage-${i + 1}`, 180)
      const safeName = originalName || `bijlage-${i + 1}.dat`

      if (!base64Content) {
        errors.push(`Bijlage ${i + 1} bevat geen gegevens.`)
        continue
      }

      const compactBase64 = base64Content.replace(/\s+/g, '')
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compactBase64)) {
        errors.push(`Bijlage ${safeName} bevat geen geldige bestandsdata.`)
        continue
      }

      let buffer
      try {
        buffer = Buffer.from(compactBase64, 'base64')
      } catch {
        errors.push(`Bijlage ${safeName} kon niet worden gelezen.`)
        continue
      }

      if (!buffer || !buffer.length) {
        errors.push(`Bijlage ${safeName} bevat een leeg bestand.`)
        continue
      }

      const normalizedType = resolveAttachmentType(declaredType, safeName, buffer)
      if (!normalizedType) {
        errors.push(`Bestandstype van bijlage ${safeName} wordt niet ondersteund.`)
        continue
      }

      if (buffer.length > PAYMENT_REQUEST_ATTACHMENT_SIZE_LIMIT) {
        const maxMb = Math.round(PAYMENT_REQUEST_ATTACHMENT_SIZE_LIMIT / 1024 / 1024)
        errors.push(`Bijlage ${safeName} is groter dan ${maxMb}MB.`)
        continue
      }

      totalAttachmentSize += buffer.length

      sanitizedAttachments.push({
        name: safeName,
        type: normalizedType,
        buffer
      })
    }

    if (totalAttachmentSize > PAYMENT_REQUEST_TOTAL_SIZE_LIMIT) {
      const maxMb = Math.round(PAYMENT_REQUEST_TOTAL_SIZE_LIMIT / 1024 / 1024)
      errors.push(`De totale grootte van de bijlagen is groter dan ${maxMb}MB.`)
    }

    if (errors.length > 0) {
      return res.status(400).json({ msg: errors[0], errors })
    }

    const matchedUser = users.find((user) => user.id === auth.userId) || null

    const mailer = await ensureMailerTransport()
    if (!mailer) {
      return res.status(503).json({ msg: 'E-mailservice is tijdelijk niet beschikbaar.' })
    }

    const pdfBuffer = await buildPaymentRequestPdf({
      requesterName: trimmedName,
      requesterEmail: trimmedEmail,
      paidTo: trimmedPaidTo,
      expenseTitle: trimmedExpenseTitle,
      expenseDate: expenseDateValue,
      amount: amountNumber,
      description: trimmedDescription,
      notes: trimmedNotes,
      paymentMethod: normalizedPaymentMethod,
      iban: sanitizedIban,
      paymentLink: trimmedPaymentLink,
      submittedAt,
      attachments: sanitizedAttachments.map(({ name, type }) => ({ name, type }))
    }, sanitizedAttachments)

    const pdfFileName = `Declaratie-${sanitizeFileName(trimmedExpenseTitle || trimmedName)}-${submittedAt.toISOString().split('T')[0]}.pdf`
    const formattedAmount = formatCurrency(amountNumber)
    const formattedDate = formatDateDisplay(expenseDateValue)
    const subject = `Declaratie: ${trimmedName} - ${formattedAmount}`
    const replyTo = buildReplyTo(trimmedName, trimmedEmail)

    const descriptionHtml = escapeHtml(trimmedDescription || 'Geen aanvullende omschrijving.').replace(/\r?\n/g, '<br />')
    const notesHtml = escapeHtml(trimmedNotes).replace(/\r?\n/g, '<br />')
    const attachmentsHtml = sanitizedAttachments.length
      ? `<ul>${sanitizedAttachments.map((att) => `<li>${escapeHtml(att.name)} (${escapeHtml(att.type)})</li>`).join('')}</ul>`
      : '<p>Geen bijlagen toegevoegd.</p>'

    const htmlBody = `
      <h2>Nieuwe declaratie ontvangen</h2>
      <p>Er is een nieuwe declaratie ingediend via het Stamjer portaal.</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 520px;">
        <tbody>
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Naam</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${escapeHtml(trimmedName)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">E-mailadres</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;"><a href="mailto:${escapeHtml(trimmedEmail)}">${escapeHtml(trimmedEmail)}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Betaald aan</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${escapeHtml(trimmedPaidTo)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Datum uitgave</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${escapeHtml(formattedDate)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Onderwerp</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${escapeHtml(trimmedExpenseTitle)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Bedrag</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">${escapeHtml(formattedAmount)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Betaalmethode</td>
            <td style="padding: 8px; border: 1px solid #e2e8f0;">
              ${normalizedPaymentMethod === 'paymentLink'
                ? `Betaallink${trimmedPaymentLink ? ` - <a href="${escapeHtml(trimmedPaymentLink)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ''}`
                : `IBAN - ${escapeHtml(formatIban(sanitizedIban))}`}
            </td>
          </tr>
        </tbody>
      </table>
      <h3>Beschrijving</h3>
      <p>${descriptionHtml}</p>
      ${trimmedNotes ? `<h3>Opmerking voor admins</h3><p>${notesHtml}</p>` : ''}
      <h3>Bijlagen</h3>
      ${attachmentsHtml}
      <p>Alle details en bewijsstukken zijn samengevoegd in de bijgevoegde pdf (${escapeHtml(pdfFileName)}).</p>
    `

    const textBodyLines = [
      'Nieuwe declaratie via Stamjer:',
      '',
      `Naam: ${trimmedName}`,
      `E-mail: ${trimmedEmail}`,
      `Betaald aan: ${trimmedPaidTo}`,
      `Datum uitgave: ${formattedDate}`,
      `Onderwerp: ${trimmedExpenseTitle}`,
      `Bedrag: ${formattedAmount}`,
      `Betaalmethode: ${normalizedPaymentMethod === 'paymentLink' ? 'Betaallink' : `IBAN ${formatIban(sanitizedIban)}`}`,
      normalizedPaymentMethod === 'paymentLink' && trimmedPaymentLink ? `Betaallink: ${trimmedPaymentLink}` : null,
      '',
      `Beschrijving: ${trimmedDescription || 'Geen aanvullende omschrijving.'}`,
      trimmedNotes ? `Opmerking voor admins: ${trimmedNotes}` : null,
      '',
      `Bijlagen: ${sanitizedAttachments.length}`,
      'De volledige aanvraag vind je in de meegestuurde pdf.'
    ].filter(Boolean).join('\n')

    const sendResult = await mailer.sendMail({
      from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com',
      to: recipient,
      replyTo,
      subject,
      html: htmlBody,
      text: textBodyLines,
      attachments: [
        {
          filename: pdfFileName,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    })

    logEvent({
      action: 'payment-request-submitted',
      actor: auth.userId,
      metadata: {
        userId: matchedUser?.id || null,
        requesterEmail: trimmedEmail,
        amount: amountNumber,
        expenseTitle: trimmedExpenseTitle,
        paidTo: trimmedPaidTo,
        paymentMethod: normalizedPaymentMethod,
        groupId: group.id,
        attachments: sanitizedAttachments.length,
        ibanMasked: normalizedPaymentMethod === 'iban' ? maskIban(sanitizedIban) : null
      }
    })

    const responsePayload = { msg: 'Declaratie succesvol verstuurd.' }
    const previewUrl = nodemailer.getTestMessageUrl(sendResult)
    if (previewUrl) {
      responsePayload.previewUrl = previewUrl
    }

    res.status(201).json(responsePayload)
  } catch (error) {
    if (error instanceof GroupAccessError) throw error
    console.error('Payment request error:', error)
    logSystemError(error, { action: 'POST /api/payment-requests', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Declaratie versturen mislukt.' })
  }
})

// External calendar applications cannot send the browser's session cookie.
// Give members a secret group feed URL; never fall back to a global public feed.
apiRouter.get('/calendar/subscription', async (req, res) => {
  const auth = await requireAuthenticatedUser(req, res)
  if (!auth) return
  const group = await resolveGroup(req, auth.user)
  const db = await getDb()
  if (!group.calendarFeedToken) await runGroupTransaction(await clientPromise, async session => {
    const current = await db.collection('groups').findOne({ id: group.id }, { session })
    if (current.calendarFeedToken) return
    await lockGroups(db, session, [group.id], { requireActive: false })
    const actor = await db.collection('users').findOne({ id: auth.userId }, { session })
    if (!canReadGroup(actor, group.id)) throw new GroupAccessError('Geen toegang tot deze groep')
    await db.collection('groups').updateOne({ id: group.id }, { $set: { calendarFeedToken: randomBytes(32).toString('base64url') } }, { session })
    await writeAudit(db, { action: 'calendar-token-created', actor, groupId: group.id, collection: 'groups', targetId: group.id, changedFields: ['calendarFeedToken'] }, session)
  })
  const currentGroup = await db.collection('groups').findOne({ id: group.id })
  res.setHeader('Cache-Control', 'no-store')
  res.json({ url: `/api/calendar.ics?groupId=${encodeURIComponent(group.id)}&token=${encodeURIComponent(currentGroup.calendarFeedToken)}` })
})

apiRouter.get('/calendar.ics', async (req, res, next) => {
  if (req.query.token !== undefined) {
    const { groupId, token } = req.query
    if (typeof groupId !== 'string' || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return res.status(401).json({ error: 'Ongeldig agenda-abonnement' })
    }
    const db = await getDb()
    const group = await db.collection('groups').findOne({ id: groupId, calendarFeedToken: token })
    if (!group) return res.status(401).json({ error: 'Ongeldig agenda-abonnement' })
    req.calendarGroupId = group.id
    req.calendarName = group.settings?.calendarName
  } else {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return
    const group = await resolveGroup(req, auth.user)
    req.calendarGroupId = group.id
    req.calendarName = group.settings?.calendarName
  }
  next()
}, createICalendarHandler(async (req) => {
  await ensureEventsFresh()
  return events.filter((event) => event.groupId === req.calendarGroupId)
}))

apiRouter.use((error, req, res, next) => {
  if (error instanceof GroupAccessError) return res.status(error.status).json({ error: error.message })
  next(error)
})

// API-mounting
app.use('/api', apiRouter)

// Statische assets (React build)
app.use(
  expressStaticGzip(
    path.join(__dirname, '..', 'dist'),
    { enableBrotli: true, orderPreference: ['br','gz'] }
  )
)

// SPA fallback voor niet-API, niet-statische routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'))
})

// Laatste 404 voor API
app.use('/api', (req, res) => {
  res.status(404).json({ msg: 'API-route niet gevonden' })
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
  logSystemError(reason, { action: 'unhandled-rejection', status: 500 })
})

process.on('uncaughtException', (error) => {
  console.error('Ongehandelde uitzondering:', error)
  logSystemError(error, { action: 'uncaught-exception', status: 500 })
})

const port = Number(process.env.PORT) || 3002

if (!process.env.VERCEL) {
  app.listen(port, () => {
    infoLog(`API server listening on port ${port}`)
    logEvent({ action: 'server-listen', metadata: { port } })
  })
}

export default app

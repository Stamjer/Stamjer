/* eslint-env node */
/**
 * ================================================================
 * STAMJER AGENDA-API - BACKEND SERVER
 * ================================================================
 *
 * Hoofdbestand voor de Stamjer-agenda.
 * Biedt REST-API endpoints voor:
 * - Gebruikersauthenticatie (inloggen, registratie, wachtwoordherstel)
 * - Evenementbeheer (CRUD-bewerkingen)
 * - E-mailverificatie
 *
 * Gemaakt met Express.js en MongoDB Atlas, inclusief:
 * - E-mailverificatie bij registratie
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
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'crypto'
import { MongoClient } from 'mongodb'
import { createRequestLogger, configureDailyReport, logError as logSystemError, logEvent } from './logger.js'
import { createICalendarHandler } from './icalendar.js'

// MongoDB setup
const uri = process.env.MONGODB_URI
if (!uri) throw new Error('Ontbrekende MONGODB_URI in omgeving')

let clientPromise
if (!global._mongoClientPromise) {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
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
const DAILY_LOG_EMAIL = process.env.DAILY_LOG_EMAIL || 'stamjer.mpd@gmail.com'
const DAILY_CHANGE_EMAIL = process.env.DAILY_CHANGE_EMAIL || DAILY_LOG_EMAIL
const PAYMENT_REQUEST_EMAIL = process.env.PAYMENT_REQUEST_EMAIL || 'stamjer.mpd@gmail.com'
const PAYMENT_REQUEST_ATTACHMENT_LIMIT = Math.max(parseInt(process.env.PAYMENT_REQUEST_ATTACHMENT_LIMIT, 10) || 3, 0)
const PAYMENT_REQUEST_ATTACHMENT_SIZE_LIMIT = Math.max(parseInt(process.env.PAYMENT_REQUEST_ATTACHMENT_SIZE_LIMIT, 10) || 5, 1) * 1024 * 1024
const PAYMENT_REQUEST_TOTAL_SIZE_LIMIT = Math.max(parseInt(process.env.PAYMENT_REQUEST_TOTAL_SIZE_LIMIT, 10) || 15, 1) * 1024 * 1024

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-token-secret-change-me'
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'stamjer_session'
const SESSION_MAX_AGE_DAYS = Math.max(parseInt(process.env.SESSION_MAX_AGE_DAYS, 10) || 365, 1)
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
const SESSION_TOUCH_INTERVAL_MS = Math.max(parseInt(process.env.SESSION_TOUCH_INTERVAL_HOURS, 10) || 24, 1) * 60 * 60 * 1000
const SESSION_COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || ''
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

let indexesEnsured = false

async function getDb() {
  const client = await clientPromise
  const db = client.db('Stamjer')

  if (!indexesEnsured) {
    await ensureIndexes(db)
    indexesEnsured = true
  }

  return db
}

/**
 * Create database indexes for optimal query performance.
 * This function only runs once per process to limit overhead.
 */
async function ensureIndexes(db) {
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
    { keys: { active: 1 }, options: { background: true, name: 'users_active_idx' }, description: 'users.active flag' }
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

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64')
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [header, body, signature] = token.split('.')
  const data = `${header}.${body}`
  const expectedSig = base64UrlEncode(createHmac('sha256', TOKEN_SECRET).update(data).digest())

  const sigBuf = Buffer.from(signature || '', 'utf8')
  const expectedBuf = Buffer.from(expectedSig, 'utf8')
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null
  }

  try {
    const payload = JSON.parse(base64UrlDecode(body).toString('utf8'))
    if (!payload || typeof payload !== 'object') return null
    return payload
  } catch {
    return null
  }
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
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge
  }

  if (SESSION_COOKIE_DOMAIN) {
    options.domain = SESSION_COOKIE_DOMAIN
  }

  return options
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions())
}

function clearSessionCookie(res) {
  const options = getSessionCookieOptions({ maxAge: 0 })
  delete options.maxAge
  res.clearCookie(SESSION_COOKIE_NAME, options)
}

function extractLegacyAuthToken(req) {
  const bearer = typeof req.headers?.authorization === 'string' ? req.headers.authorization.trim() : ''
  if (bearer && bearer.toLowerCase().startsWith('bearer ')) {
    return bearer.slice(7).trim()
  }
  return (
    (req.headers?.['x-session-token'] ?? req.body?.sessionToken ?? req.query?.sessionToken ?? '').toString().trim()
  )
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

  let session = sessions.find((candidate) =>
    candidate.sessionId === parsed.sessionId &&
    candidate.tokenHash === parsed.tokenHash
  )

  if (!session) {
    const db = await getDb()
    session = await db.collection('sessions').findOne(
      { sessionId: parsed.sessionId, tokenHash: parsed.tokenHash },
      { projection: { _id: 0 } }
    )
    session = normalizeSessionRecord(session)
    if (session) {
      sessions = [
        session,
        ...sessions.filter((candidate) => candidate.sessionId !== session.sessionId)
      ]
    }
  }

  return isSessionUsable(session) ? session : null
}

function mapUserForClient(user, session = null) {
  if (!user) return null
  const safeUser = { ...user }
  delete safeUser.password
  delete safeUser.sessionToken
  delete safeUser.notificationPreferences
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
  sessions = [safeSession, ...sessions.filter((candidate) => candidate.sessionId !== safeSession.sessionId)]
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
    { sessionId: session.sessionId },
    { $set: { lastSeenAt: now, expiresAt } }
  )
}

async function revokeSession(sessionId) {
  if (!sessionId) return
  const revokedAt = new Date()
  sessions = sessions.map((session) =>
    session.sessionId === sessionId ? { ...session, revokedAt } : session
  )
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
  sessions = sessions.map((session) => {
    if (session.userId !== uid || session.sessionId === exceptSessionId) return session
    return { ...session, revokedAt }
  })

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
  const cookieToken = getCookieSessionToken(req)
  let session = null
  let user = null

  if (cookieToken) {
    session = await findSessionByToken(cookieToken)
    if (session) {
      user = users.find((u) => u.id === session.userId)
      if (user) {
        await touchSession(session)
      }
    }
  }

  const sessionToken = extractLegacyAuthToken(req)
  let payload = null

  if (!user && sessionToken) {
    payload = verifySessionToken(sessionToken)
    if (payload && Number.isFinite(payload.userId)) {
      user = users.find((u) =>
        u.id === payload.userId &&
        (!Number.isFinite(payload.v) || payload.v === (u.sessionVersion || 0))
      )
    }
  }

  if (!user) {
    return { error: 'AUTH_INVALID' }
  }

  if (requireAdmin && !isUserAdmin(user.id)) {
    return { error: 'AUTH_FORBIDDEN' }
  }

  return { user, userId: user.id, token: cookieToken || sessionToken, session }
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

// Tussenopslag gebruikers en evenementen
let users = []
let events = []
let sessions = []
let lastEventsLoadedAt = 0
// Remove in-memory pendingReset as we'll use MongoDB
// const pendingReset = {}

function normalizeUserStatus(status) {
  if (status === 'legacy' || status === 'inactive' || status === 'active') return status
  return 'active'
}

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
          ...user,
          sessionVersion: Number.isFinite(user.sessionVersion) ? user.sessionVersion : 0,
          status: normalizeUserStatus(user.status)
        }
        delete normalizedUser.notificationPreferences
        return normalizedUser
      })
    )
  infoLog(`Loaded ${users.length} users from MongoDB`)
}

async function loadSessions() {
  const db = await getDb()
  const now = new Date()
  sessions = (await db.collection('sessions')
    .find({
      revokedAt: null,
      expiresAt: { $gt: now }
    })
    .project({ _id: 0 })
    .toArray())
    .map(normalizeSessionRecord)
    .filter(Boolean)
  infoLog(`Loaded ${sessions.length} active sessions from MongoDB`)
}

async function loadEvents() {
  const db = await getDb()
  events = (await db.collection('events')
    .find({})
    .project({ _id: 0 })
    .toArray())
    .map((event) => ({
      ...event,
      opkomstmakerIds: sanitizeIdArray(event.opkomstmakerIds),
      schoonmakerIds: sanitizeIdArray(event.schoonmakerIds),
      participants: sanitizeIdArray(event.participants)
    }))
  infoLog(`Loaded ${events.length} events from MongoDB`)
  lastEventsLoadedAt = Date.now()
}

async function ensureEventsFresh(maxAgeMs = 2000) {
  const now = Date.now()
  if (now - lastEventsLoadedAt > maxAgeMs || events.length === 0) {
    await loadEvents()
  }
}

function sanitizeUserId(userId) {
  const parsed = Number.parseInt(userId, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function sanitizeIdArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  const unique = new Set()
  value.forEach((item) => {
    const parsed = sanitizeUserId(item)
    if (parsed !== null) {
      unique.add(parsed)
    }
  })
  return Array.from(unique)
}

async function syncUserAttendanceForFutureOpkomsten(userId, shouldBePresent) {
  const uid = parseInt(userId, 10)
  if (!Number.isInteger(uid)) {
    return { updatedEvents: 0 }
  }

  const now = new Date()
  let updatedEvents = 0
  const saveOperations = []

  events.forEach(event => {
    if (!event || !event.isOpkomst) return
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
      saveOperations.push(saveEvent(event))
      updatedEvents++
      return
    }

    if (!shouldBePresent && hasUser) {
      event.participants = uniqueParticipants.filter(id => id !== uid)
      saveOperations.push(saveEvent(event))
      updatedEvents++
      return
    }

    // Ensure participants array is normalized even when no changes are required
    event.participants = uniqueParticipants
  })

  if (saveOperations.length > 0) {
    await Promise.all(saveOperations)
    logEvent('attendance-auto-sync', {
      userId: uid,
      active: shouldBePresent,
      updatedEvents
    })
  }

  return { updatedEvents }
}

async function saveUser(user) {
  const db = await getDb()

  await db.collection('users').updateOne(
    { id: user.id },
    { $set: user },
    { upsert: true }
  )
}

// Helper functions for reset codes in MongoDB
async function saveResetCode(email, code, expiresAt) {
  const db = await getDb()
  await db.collection('resetCodes').updateOne(
    { email },
    {
      $set: {
        email,
        code,
        expiresAt,
        createdAt: new Date()
      }
    },
    { upsert: true }
  )
}

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
      expiresAt: { $lt: Date.now() }
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

async function saveEvent(event) {
  const db = await getDb()
  const normalizedEvent = {
    ...event,
    opkomstmakerIds: sanitizeIdArray(event.opkomstmakerIds),
    schoonmakerIds: sanitizeIdArray(event.schoonmakerIds),
    participants: sanitizeIdArray(event.participants)
  }

  await db.collection('events').updateOne(
    { id: event.id },
    { $set: normalizedEvent },
    { upsert: true }
  )
}

async function deleteEventById(id) {
  const db = await getDb()
  await db.collection('events').deleteOne({ id })
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
    const rejectUnauthorized = parseBoolean(process.env.SMTP_REJECT_UNAUTHORIZED, false)

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
      tls: { rejectUnauthorized: parseBoolean(process.env.SMTP_REJECT_UNAUTHORIZED, false) }
    }

    if (!transportOptions.auth) {
      warnLog(`[mail] SMTP_SERVICE=${service} geconfigureerd zonder inloggegevens; e-mails kunnen mogelijk niet verstuurd worden`)
    }

    return nodemailer.createTransport(transportOptions)
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
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function isUserAdmin(userId) {
  const u = users.find(u => u.id === parseInt(userId, 10))
  return u && u.isAdmin
}

// Replace your old calculateStreepjes with:
function calculateStreepjes() {
  const counts = {}
  users.forEach(u => { counts[u.id] = 0 })

  events.forEach(ev => {
    if (!ev.isOpkomst || !ev.attendance) return

    Object.entries(ev.attendance).forEach(([uid, a]) => {
      const idNum = parseInt(uid, 10)
      // normalize to boolean present/absent
      const present = (typeof a === 'object' && 'present' in a)
        ? Boolean(a.present)
        : Boolean(a)

      const isPart = ev.participants?.includes(idNum)
      // wrong attendance = signed-up but absent OR not-signed-up but present
      if ((isPart && !present) || (!isPart && present)) {
        counts[idNum]++
      }
    })
  })

  return counts
}

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
await loadSessions()
await loadEvents()
await ensureMailerTransport()
configureDailyReport({
  sendEmail: async ({ subject, text, html }) => {
    const mailer = await ensureMailerTransport()
    if (!mailer) {
      warnLog('Daily report overgeslagen: transporter niet beschikbaar')
      return
    }
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com',
        to: DAILY_LOG_EMAIL,
        subject,
        text,
        html
      })
    } catch (error) {
      console.error('Dagrapport versturen mislukt:', error)
      logSystemError(error, { action: 'daily-report-email', status: 500 })
    }
  }
})
await cleanupExpiredResetCodes() // Clean up old reset codes on startup
await cleanupExpiredSessions() // Clean up old sessions on startup

// One-time cleanup: Remove old changeLog collection if it exists
try {
  const db = await getDb()
  const collections = await db.listCollections({ name: 'changeLog' }).toArray()
  if (collections.length > 0) {
    await db.collection('changeLog').drop()
    infoLog('Removed old changeLog collection as it is no longer needed')
  }
} catch (error) {
  // Ignore errors if collection doesn't exist
  if (error.codeName !== 'NamespaceNotFound') {
    warnLog('Failed to remove old changeLog collection:', error.message)
  }
}

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
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

// Request logging (no sensitive payloads)
app.use((req, res, next) => {
  infoLog(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`)
  return next()
})

// API-router
const apiRouter = express.Router()

// Eenvoudige test
apiRouter.get('/test', (req, res) => {
  res.json({ msg: 'API is in orde' })
})

// Gebruikers ophalen
apiRouter.get('/users', async (req, res) => {
  try {
    await loadUsers()
    if (users.length === 0) await loadUsers()
    const safeUsers = users.map(u => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      active: Boolean(u.active),
      status: u.status || 'active'
    }))
    res.json(safeUsers)
  } catch (err) {
    console.error('Fout bij ophalen gebruikers:', err)
    logSystemError(err, { action: 'GET /api/users', status: 500 })
    res.status(500).json({ error: 'Opvragen gebruikers mislukt', message: err.message })
  }
})

apiRouter.get('/users/full', async (req, res) => {
  try {
    await loadUsers()
    if (users.length === 0) await loadUsers()

    const streepjes = calculateStreepjes()
    res.json({
      users: users.map(u => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        active: u.active,
        isAdmin: u.isAdmin || false,
        streepjes: streepjes[u.id] || 0,
        status: u.status || 'active'
      }))
    })
  } catch (err) {
    console.error('Fout bij ophalen volledige gebruikerslijst:', err)
    logSystemError(err, { action: 'GET /api/users/full', status: 500 })
    res.status(500).json({ error: 'Opvragen volledige gebruikerslijst mislukt', message: err.message })
  }
})

apiRouter.post('/users', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return

    const firstName = safeTrimmedString(req.body?.firstName, 80)
    const lastName = safeTrimmedString(req.body?.lastName, 120)
    const email = safeTrimmedString(req.body?.email, 254).toLowerCase()
    const isAdmin = req.body?.isAdmin === true

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
      isAdmin,
      active: true,
      status: 'active',
      sessionVersion: 0,
      createdAt: new Date()
    }

    const db = await getDb()
    await db.collection('users').insertOne(newUser)
    users.push(newUser)
    const attendanceSync = await syncUserAttendanceForFutureOpkomsten(newUser.id, true)

    logEvent({
      action: 'user-created',
      metadata: {
        targetUserId: newUser.id,
        createdBy: auth.userId,
        isAdmin
      }
    })

    res.status(201).json({
      user: mapUserForClient(newUser),
      attendanceUpdates: attendanceSync.updatedEvents,
      msg: 'Gebruiker toegevoegd'
    })
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Dit e-mailadres of gebruikers-ID bestaat al' })
    }
    logSystemError(err, { action: 'POST /api/users', status: 500 })
    res.status(500).json({ error: 'Gebruiker toevoegen mislukt' })
  }
})

// Helper function to send active status change notification email
async function sendActiveStatusChangeEmail(user, newActiveStatus) {
  try {
    const statusText = newActiveStatus ? 'actief' : 'inactief'

    const mailer = await ensureMailerTransport()
    if (!mailer) {
      warnLog('Status change notification skipped: transporter niet beschikbaar')
      return
    }

    await mailer.sendMail({
      from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com',
      to: DAILY_CHANGE_EMAIL,
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
    debugLog('Status change notification email sent', { userId: user.id, active: newActiveStatus })
  } catch (error) {
    console.error('Error sending status change email:', error)
    logSystemError(error, { action: 'notify-active-status', status: 500, metadata: { userId: user?.id, active: newActiveStatus } })
  }
}

// Profiel bijwerken
apiRouter.put('/user/profile', async (req, res) => {
  try {
    const auth = await requireAuthenticatedUser(req, res)
    if (!auth) return

    const { userId, active } = req.body
    if (!userId) return res.status(400).json({ error: 'Gebruikers-ID is vereist' })
    const uid = parseInt(userId, 10)
    if (uid !== auth.userId) return res.status(403).json({ error: 'Je kunt alleen je eigen profiel bijwerken' })
    const idx = users.findIndex(u => u.id === uid)
    if (idx < 0) return res.status(404).json({ error: 'Gebruiker niet gevonden' })
    
    const previousActiveStatus = users[idx].active
    
    let attendanceSync = { updatedEvents: 0 }

    if (typeof active === 'boolean') {
      users[idx].active = active
      
      // Send email notification if active status changed
      if (previousActiveStatus !== active) {
        attendanceSync = await syncUserAttendanceForFutureOpkomsten(uid, active)
        await sendActiveStatusChangeEmail(users[idx], active)
      }
    }

    await saveUser(users[idx])
    res.json({ 
      user: users[idx], 
      msg: 'Profiel succesvol bijgewerkt',
      attendanceUpdates: attendanceSync.updatedEvents
    })
  } catch (err) {
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

    const { userId, status } = req.body
    if (!userId || sanitizeUserId(userId) !== auth.userId) return res.status(403).json({ error: 'Alleen beheerders' })

    const validStatuses = ['active', 'inactive', 'legacy']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Ongeldige status. Kies uit: active, inactive, legacy' })
    }

    const targetId = sanitizeUserId(req.params.id)
    if (targetId === null) return res.status(400).json({ error: 'Ongeldig gebruikers-ID' })

    const idx = users.findIndex(u => u.id === targetId)
    if (idx < 0) return res.status(404).json({ error: 'Gebruiker niet gevonden' })

    const previousStatus = users[idx].status || 'active'
    const previousEffectiveStatus =
      previousStatus === 'legacy'
        ? 'legacy'
        : previousStatus === 'inactive' || users[idx].active === false
        ? 'inactive'
        : 'active'
    const nextActive = status === 'active'

    if (previousStatus === status && Boolean(users[idx].active) === nextActive) {
      return res.json({ user: { id: targetId, status, active: nextActive }, msg: 'Status ongewijzigd' })
    }

    users[idx].status = status
    users[idx].active = nextActive

    // Sync opkomst attendance based on status change
    if (previousEffectiveStatus === 'active' && status !== 'active') {
      await syncUserAttendanceForFutureOpkomsten(targetId, false)
    } else if (previousEffectiveStatus !== 'active' && status === 'active') {
      await syncUserAttendanceForFutureOpkomsten(targetId, true)
    }

    await saveUser(users[idx])
    logEvent('user-status-changed', {
      targetUserId: targetId,
      changedBy: sanitizeUserId(userId),
      previousStatus,
      newStatus: status
    })

    res.json({
      user: { id: targetId, status, active: users[idx].active },
      msg: `Status bijgewerkt naar ${status}`
    })
  } catch (err) {
    logSystemError(err, { action: 'PATCH /api/users/:id/status', status: 500 })
    res.status(500).json({ error: 'Status bijwerken mislukt' })
  }
})

// Profiel ophalen
apiRouter.get('/user/profile', async (req, res) => {
  const auth = await requireAuthenticatedUser(req, res)
  if (!auth) return

  const { userId } = req.query
  const uid = sanitizeUserId(userId)
  if (uid === null) {
    return res.status(400).json({ error: 'Ongeldig gebruikers-ID' })
  }
  if (uid !== auth.userId) {
    return res.status(403).json({ error: 'Je kunt alleen je eigen profiel bekijken' })
  }

  const user = users.find((u) => u.id === uid)
  if (!user) {
    return res.status(404).json({ error: 'Gebruiker niet gevonden' })
  }

  const safeUser = { ...user }
  delete safeUser.password
  delete safeUser.notificationPreferences
  res.json({ user: safeUser })
})

// Evenementen ophalen
apiRouter.get('/events', async (req, res) => {
  await ensureEventsFresh()
  res.json({ events })
})

apiRouter.get('/events/opkomsten', async (req, res) => {
  await ensureEventsFresh()
  res.json({ events: events.filter(e => e.isOpkomst) })
})

// Evenement aanmaken
apiRouter.post('/events', async (req, res) => {
  try {
    const {
      title, start, end, allDay,
      location, description,
      isOpkomst, opkomstmakers, opkomstmakerIds,
      isSchoonmaak, schoonmakers, schoonmakerIds,
      schoonmaakOptions,
      userId,
      participants: requestedParticipants = []
    } = req.body
    if (!userId) return res.status(401).json({ msg: 'Authenticatie vereist' })
    if (!isUserAdmin(userId)) return res.status(403).json({ msg: 'Alleen beheerders' })
    if (!title || !start) return res.status(400).json({ msg: 'Titel en startdatum zijn vereist' })

    const sanitizedParticipants = Array.isArray(requestedParticipants)
      ? requestedParticipants
          .map(pid => parseInt(pid, 10))
          .filter(Number.isFinite)
      : []

    const id = Math.random().toString(36).substr(2, 6)
    const isOpkomstFlag = !!isOpkomst
    const isSchoonmaakFlag = !!isSchoonmaak
    const opkomstMakerIdList = sanitizeIdArray(opkomstmakerIds)
    const schoonmakerIdList = sanitizeIdArray(schoonmakerIds)

    const newEv = {
      id,
      title,
      start,
      end: end || start,
      allDay: !!allDay,
      location: location || '',
      description: description || '',
      isOpkomst: isOpkomstFlag,
      opkomstmakers: opkomstmakers || '',
      opkomstmakerIds: opkomstMakerIdList,
      isSchoonmaak: isSchoonmaakFlag,
      schoonmakers: schoonmakers || '',
      schoonmakerIds: schoonmakerIdList,
      schoonmaakOptions: schoonmaakOptions || [],
      participants: sanitizedParticipants
    }

    if (isOpkomstFlag) {
      if (!users || users.length === 0) {
        await loadUsers()
      }
      const activeUserIds = users
        .filter(u => u.active && (u.status || 'active') === 'active')
        .map(u => u.id)
        .filter(Number.isFinite)

      const combinedParticipants = Array.from(
        new Set([...sanitizedParticipants, ...activeUserIds])
      ).sort((a, b) => a - b)

      newEv.participants = combinedParticipants
    }

    events.push(newEv)
    await saveEvent(newEv)
    await ensureEventsFresh(0)
    res.json(newEv)
  } catch (err) {
    console.error(err)
    logSystemError(err, { action: 'POST /api/events', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Aanmaken evenement mislukt' })
  }
})

// Evenement bijwerken
apiRouter.put('/events/:id', async (req, res) => {
  try {
    const { id } = req.params
    const idx = events.findIndex(e => e.id === id)
    if (idx < 0) return res.status(404).json({ msg: 'Niet gevonden' })
    const updated = { ...events[idx], ...req.body }

    if (req.body?.opkomstmakerIds !== undefined) {
      updated.opkomstmakerIds = sanitizeIdArray(req.body.opkomstmakerIds)
    } else if (!Array.isArray(updated.opkomstmakerIds)) {
      updated.opkomstmakerIds = sanitizeIdArray(updated.opkomstmakerIds)
    }

    if (req.body?.schoonmakerIds !== undefined) {
      updated.schoonmakerIds = sanitizeIdArray(req.body.schoonmakerIds)
    } else if (!Array.isArray(updated.schoonmakerIds)) {
      updated.schoonmakerIds = sanitizeIdArray(updated.schoonmakerIds)
    }

    if (req.body?.participants !== undefined) {
      updated.participants = sanitizeIdArray(req.body.participants)
    } else if (!Array.isArray(updated.participants)) {
      updated.participants = sanitizeIdArray(updated.participants)
    }

    events[idx] = updated
    await saveEvent(updated)
    await ensureEventsFresh(0)
    res.json(updated)
  } catch (err) {
    console.error(err)
    logSystemError(err, { action: 'PUT /api/events/:id', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Bijwerken evenement mislukt' })
  }
})

// Evenement verwijderen
apiRouter.delete('/events/:id', async (req, res) => {
  try {
    const { id } = req.params
    const idx = events.findIndex(e => e.id === id)
    if (idx < 0) return res.status(404).json({ msg: 'Niet gevonden' })
    const [removed] = events.splice(idx, 1)
    await deleteEventById(id)
    await ensureEventsFresh(0)
    res.json({ msg: 'Evenement verwijderd', event: removed })
  } catch (err) {
    console.error(err)
    logSystemError(err, { action: 'DELETE /api/events/:id', status: 500, metadata: req.params })
    res.status(500).json({ msg: 'Verwijderen mislukt' })
  }
})

// Aanwezigheid bijwerken
apiRouter.put('/events/:id/attendance', async (req, res) => {
  try {
    const { id, userId, attending } = { ...req.params, ...req.body }
    const ev = events.find(e => e.id === id)
    if (!ev) return res.status(404).json({ msg: 'Niet gevonden' })
    
    // Only opkomst events have participants/attendance
    if (!ev.isOpkomst) {
      return res.status(400).json({ msg: 'Aanwezigheid kan alleen bijgewerkt worden voor opkomst evenementen' })
    }
    
    if (!ev.participants) ev.participants = []
    const uid = parseInt(userId, 10)
    const idx = ev.participants.indexOf(uid)
    
    // Track the change for logging
    let changeDetails = {
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
    
    await saveEvent(ev)
    
    res.json({ msg: 'Aanwezigheid bijgewerkt', event: ev })
  } catch (err) {
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
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ msg: 'Inloggegevens ontbreken' })
    
    // Normalize email to lowercase for consistent comparison
    const normalizedEmail = email.trim().toLowerCase()
    const u = users.find(u => u.email.toLowerCase() === normalizedEmail)
    if (!u) return res.status(400).json({ msg: 'Gebruiker niet gevonden' })

    const match = u.password.startsWith('$2b$')
      ? await bcrypt.compare(password, u.password)
      : (u.password === password && await (async () => {
          u.password = await bcrypt.hash(password, 10)
          await saveUser(u)
        })())

    if (!match) return res.status(400).json({ msg: 'Onjuist wachtwoord' })

    const { token, session } = await createUserSession(u, req)
    setSessionCookie(res, token)
    await saveUser(u)

    res.json({ user: mapUserForClient(u, session) })
  } catch (err) {
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
      await saveUser(users[idx])
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
    const rawEmail = (req.body.email || '').trim().toLowerCase()
    
    debugLog('Forgot password request received', { email: maskEmail(rawEmail) })
    
    if (!rawEmail || !validator.isEmail(rawEmail))
      return res.status(400).json({ msg: 'Ongeldig e-mailadres' })

    const u = users.find(u => u.email.toLowerCase() === rawEmail)
    debugLog('Forgot password lookup result', { email: maskEmail(rawEmail), userFound: Boolean(u) })
    debugLog('Known user accounts for debugging', { count: users.length })
    
    const generic = 'Als het e-mailadres bestaat, ontvang je een herstelcode via e-mail.'
    if (u) {
      const code = generateCode()
      const expiresAt = Date.now() + 15 * 60 * 1000 // 15 minutes
      
      // Store in MongoDB instead of memory
      await saveResetCode(rawEmail, code, expiresAt)
      
      debugLog('Issued password reset code', { email: maskEmail(rawEmail) })
      debugLog('Stored password reset code with expiry', { email: maskEmail(rawEmail), expiresAt })
      
      const mailer = await ensureMailerTransport()
      if (!mailer) {
        warnLog('Herstelcode e-mail overgeslagen: transporter niet beschikbaar')
      } else {
        await mailer.sendMail({
        from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com',
        to: u.email,
        subject: 'Herstel je Stamjer-wachtwoord',
        html: `
          <div style="font-family: Arial, sans-serif; color: #222; background-color: #f9f9f9; padding: 20px; border-radius: 8px; max-width: 500px;">
            <h2 style="color: #1e40af; text-align: center;">Wachtwoordherstel Stamjer</h2>
            <p>Hallo,</p>
            <p>Je hebt aangegeven je Stamjer-wachtwoord te willen herstellen. Gebruik onderstaande code om verder te gaan:</p>
            <p style="font-size: 20px; font-weight: bold; text-align: center; color: #2563eb; background: #eef2ff; padding: 10px; border-radius: 6px;">${code}</p>
            <p>De code is geldig gedurende <strong>10 minuten</strong>. Vul deze in op de herstelpagina om een nieuw wachtwoord in te stellen.</p>
            <p>Heb je dit verzoek niet zelf gedaan? Dan kun je deze e-mail negeren.</p>
            <hr style="margin: 20px 0;">
            <p style="font-size: 12px; color: #666; text-align: center;">
              Dit bericht is automatisch verzonden door Stamjer. Reageren op deze e-mail is niet nodig.
            </p>
          </div>
        `
        })
      }

    }
    res.json({ msg: generic })
  } catch (err) {
    console.error(err)
    logSystemError(err, { action: 'POST /api/forgot-password', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Verzoek wachtwoordherstel mislukt' })
  }
})

// Wachtwoord herstellen
apiRouter.post('/reset-password', async (req, res) => {
  try {
    // 1) Normalize & trim email
    const rawEmail = (req.body.email || '').trim().toLowerCase()

    // 2) Grab the code (trim whitespace), support both `code` and `verificationCode`
    const code = (req.body.code ?? req.body.verificationCode ?? '')
                   .toString()
                   .trim()

    // 3) Grab the new password, support `password` or `newPassword`
    const newPassword = (req.body.password ?? req.body.newPassword) || ''

    // 4) Basic validations
    if (!rawEmail || !code || newPassword.length < 6) {
      return res
        .status(400)
        .json({ msg: 'E-mail, code en minimaal 6-karakter wachtwoord zijn vereist' })
    }

    // 5) Lookup pending code & validate expiry
    debugLog('Reset password request received', { email: maskEmail(rawEmail) })
    
    const rec = await getResetCode(rawEmail)
    debugLog('Reset code lookup result', { email: maskEmail(rawEmail), recordFound: Boolean(rec) })
    
    if (!rec) {
      return res.status(400).json({ msg: 'Geen actieve herstelcode gevonden voor dit e-mailadres' })
    }
    
    if (rec.code !== code) {
      return res.status(400).json({ msg: 'Ongeldige herstelcode' })
    }
    
    if (Date.now() > rec.expiresAt) {
      await deleteResetCode(rawEmail) // Clean up expired code
      return res.status(400).json({ msg: 'Herstelcode is verlopen. Vraag een nieuwe aan.' })
    }

    // 6) Find user and hash the new password
    const idx = users.findIndex(u => u.email.toLowerCase() === rawEmail)
    if (idx < 0) {
      return res.status(400).json({ msg: 'Gebruiker niet gevonden' })
    }

    users[idx].password = await bcrypt.hash(newPassword, 10)
    users[idx].sessionVersion = (users[idx].sessionVersion || 0) + 1
    await saveUser(users[idx])
    await revokeUserSessions(users[idx].id)
    await deleteResetCode(rawEmail) // Clean up used reset code

    // 7) Success response
    res.json({ msg: 'Wachtwoord succesvol gereset' })

  } catch (err) {
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

    // Normalize email to lowercase for consistent comparison
    const normalizedEmail = email.trim().toLowerCase()
    const u = users.find(u => u.email.toLowerCase() === normalizedEmail)
    if (!u) return res.status(404).json({ msg: 'Gebruiker niet gevonden' })
    if (u.id !== auth.userId) return res.status(403).json({ msg: 'Je kunt alleen je eigen wachtwoord wijzigen' })

    const valid = await bcrypt.compare(currentPassword, u.password)
    if (!valid) return res.status(400).json({ msg: 'Huidig wachtwoord onjuist' })

    u.password = await bcrypt.hash(newPassword, 10)
    u.sessionVersion = (u.sessionVersion || 0) + 1
    await saveUser(u)
    await revokeUserSessions(u.id, { exceptSessionId: auth.session?.sessionId || null })
    res.json({ msg: 'Wachtwoord gewijzigd' })
  } catch (err) {
    console.error(err)
    logSystemError(err, { action: 'POST /api/change-password', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Wijzigen mislukt' })
  }
})

// Declaratie indienen
apiRouter.post('/payment-requests', async (req, res) => {
  try {
    const {
      userId,
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

    const matchedUserId = sanitizeUserId(userId)
    const matchedUser = matchedUserId !== null
      ? users.find((u) => u.id === matchedUserId)
      : null

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
      to: PAYMENT_REQUEST_EMAIL,
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
      metadata: {
        userId: matchedUser?.id || null,
        requesterEmail: trimmedEmail,
        amount: amountNumber,
        expenseTitle: trimmedExpenseTitle,
        paidTo: trimmedPaidTo,
        paymentMethod: normalizedPaymentMethod,
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
    console.error('Payment request error:', error)
    logSystemError(error, { action: 'POST /api/payment-requests', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Declaratie versturen mislukt.' })
  }
})

// iCalendar feed endpoint
apiRouter.get('/calendar.ics', createICalendarHandler(async () => {
  // Return events from in-memory cache (kept in sync with database)
  return events
}))

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

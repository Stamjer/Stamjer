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
import { randomUUID, createHmac, timingSafeEqual } from 'crypto'
import webpush from 'web-push'
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
const SNAPSHOT_RETENTION_DAYS = Math.max(parseInt(process.env.DAILY_SNAPSHOT_RETENTION_DAYS, 10) || 7, 1)
const SNAPSHOT_TTL_SECONDS = SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60
const PAYMENT_REQUEST_EMAIL = process.env.PAYMENT_REQUEST_EMAIL || 'stamjer.mpd@gmail.com'
const PAYMENT_REQUEST_ATTACHMENT_LIMIT = Math.max(parseInt(process.env.PAYMENT_REQUEST_ATTACHMENT_LIMIT, 10) || 3, 0)
const PAYMENT_REQUEST_ATTACHMENT_SIZE_LIMIT = Math.max(parseInt(process.env.PAYMENT_REQUEST_ATTACHMENT_SIZE_LIMIT, 10) || 5, 1) * 1024 * 1024
const PAYMENT_REQUEST_TOTAL_SIZE_LIMIT = Math.max(parseInt(process.env.PAYMENT_REQUEST_TOTAL_SIZE_LIMIT, 10) || 15, 1) * 1024 * 1024

const NOTIFICATION_TTL_DAYS = Math.max(parseInt(process.env.NOTIFICATION_TTL_DAYS, 10) || 90, 7)
const NOTIFICATION_TTL_MS = NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-token-secret-change-me'
const MAX_PUSH_SUBSCRIPTIONS_PER_USER = Math.max(parseInt(process.env.MAX_PUSH_SUBSCRIPTIONS_PER_USER, 10) || 5, 1)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''
const WEB_PUSH_CONTACT = process.env.SMTP_FROM || 'stamjer.mpd@gmail.com'
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT ||
  process.env.CLIENT_ORIGIN ||
  process.env.VITE_CLIENT_ORIGIN ||
  `mailto:${WEB_PUSH_CONTACT}`
const PUSH_TOPIC =
  process.env.PUSH_TOPIC ||
  (() => {
    try {
      if (VAPID_SUBJECT && VAPID_SUBJECT.startsWith('http')) {
        return new URL(VAPID_SUBJECT).host
      }
      if (process.env.CLIENT_ORIGIN) {
        return new URL(process.env.CLIENT_ORIGIN).host
      }
    } catch {}
    return 'stamjer.nl'
  })()
let isWebPushConfigured = false
const MAX_NOTIFICATIONS_PER_USER = 100
const DEFAULT_NOTIFICATION_URL = ''
const DEFAULT_NOTIFICATION_ICON = '/icons/192x192.png'
const DEFAULT_NOTIFICATION_BADGE = '/stam_H.png'
const SCHEDULED_NOTIFICATION_INTERVAL_MS = Math.max(
  parseInt(process.env.SCHEDULED_NOTIFICATION_INTERVAL_MS, 10) || 30000,
  5000
)

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    if (!/^https?:\/\//i.test(VAPID_SUBJECT) && !/^mailto:/i.test(VAPID_SUBJECT)) {
      warnLog(`VAPID_SUBJECT (${VAPID_SUBJECT}) is niet een geldige https/mailto waarde; Apple Web Push kan weigeren. Overweeg een https-origin.`)
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    isWebPushConfigured = true
    infoLog('Web Push notificaties geconfigureerd')
  } catch (error) {
    isWebPushConfigured = false
    warnLog(`Web Push configuratie mislukt: ${error.message}`)
  }
} else {
  warnLog('Web Push notificaties zijn uitgeschakeld: VAPID keys ontbreken')
}

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

  // Add indexes for the daily snapshots collection
  const dailySnapshotsCollection = db.collection('dailySnapshots')
  await dropObsoleteSnapshotIndexes(dailySnapshotsCollection)

  const snapshotsCreated = await ensureCollectionIndexes(dailySnapshotsCollection, [
    { keys: { date: 1 }, options: { unique: true, background: true, name: 'snapshots_date_unique_idx' }, description: 'dailySnapshots.date unique' },
    { keys: { createdAt: 1 }, options: { expireAfterSeconds: SNAPSHOT_TTL_SECONDS, background: true, name: 'snapshots_createdAt_ttl_idx' }, description: `dailySnapshots TTL (${SNAPSHOT_RETENTION_DAYS} dagen)` }
  ])

  const pushSubscriptionsCreated = await ensureCollectionIndexes(db.collection('pushSubscriptions'), [
    { keys: { endpoint: 1 }, options: { unique: true, background: true, name: 'pushSubscriptions_endpoint_unique_idx' }, description: 'pushSubscriptions.endpoint unique' },
    { keys: { userId: 1 }, options: { background: true, name: 'pushSubscriptions_user_idx' }, description: 'pushSubscriptions.userId' },
    { keys: { lastActiveAt: -1 }, options: { background: true, name: 'pushSubscriptions_lastActive_idx' }, description: 'pushSubscriptions.lastActiveAt' }
  ])

  const notificationsCreated = await ensureCollectionIndexes(db.collection('notifications'), [
    { keys: { userId: 1, createdAt: -1 }, options: { background: true, name: 'notifications_user_created_idx' }, description: 'notifications per user' },
    { keys: { eventId: 1, type: 1, userId: 1 }, options: { background: true, name: 'notifications_event_type_user_idx' }, description: 'notifications dedupe lookup' },
    { keys: { readBy: 1, userId: 1 }, options: { background: true, name: 'notifications_read_user_idx' }, description: 'notifications read filter' },
    { keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0, background: true, name: 'notifications_expiresAt_ttl_idx' }, description: `notifications TTL (${NOTIFICATION_TTL_DAYS} dagen)` }
  ])

  if (eventsCreated || usersCreated || resetCodesCreated || snapshotsCreated || pushSubscriptionsCreated || notificationsCreated) {
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

async function dropObsoleteSnapshotIndexes(collection) {
  try {
    const existingIndexes = await collection.indexes()
    const obsoleteIndexes = existingIndexes.filter((idx) => idx.name === 'snapshots_ttl_idx' && isSameIndexKey(idx.key, { date: 1 }))

    for (const index of obsoleteIndexes) {
      try {
        await collection.dropIndex(index.name)
        infoLog('[indexes] Dropped obsolete dailySnapshots TTL index on date field')
      } catch (dropError) {
        warnLog(`[indexes] Failed to drop obsolete dailySnapshots TTL index: ${dropError.message}`)
      }
    }
  } catch (error) {
    if (error.codeName === 'NamespaceNotFound' || error.code === 26) {
      return
    }
    warnLog(`[indexes] Error while inspecting dailySnapshots indexes: ${error.message}`)
  }
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

function signSessionToken(payload) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64UrlEncode(JSON.stringify(payload))
  const data = `${header}.${body}`
  const signature = base64UrlEncode(createHmac('sha256', TOKEN_SECRET).update(data).digest())
  return `${data}.${signature}`
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
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .slice(0, maxLength)
}

function isValidBase64UrlKey(value = '', minLength = 10, maxLength = 256) {
  const str = value.toString()
  if (str.length < minLength || str.length > maxLength) return false
  return /^[A-Za-z0-9_-]+$/.test(str)
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function ensureDeviceId() {
  try {
    return randomUUID()
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function issueSessionToken(user, deviceId = ensureDeviceId()) {
  user.sessionVersion = user.sessionVersion || 0
  const payload = {
    userId: user.id,
    v: user.sessionVersion,
    deviceId
  }
  return { token: signSessionToken(payload), deviceId }
}

function extractAuthToken(req) {
  const bearer = typeof req.headers?.authorization === 'string' ? req.headers.authorization.trim() : ''
  if (bearer && bearer.toLowerCase().startsWith('bearer ')) {
    return bearer.slice(7).trim()
  }
  return (
    (req.headers?.['x-session-token'] ?? req.body?.sessionToken ?? req.query?.sessionToken ?? '').toString().trim()
  )
}

function getAuthenticatedUser(req, { requireAdmin = false } = {}) {
  const sessionToken = extractAuthToken(req)
  let payload = null

  if (sessionToken) {
    payload = verifySessionToken(sessionToken)
  }

  let user = payload && Number.isFinite(payload.userId)
    ? users.find((u) => u.id === payload.userId)
    : null

  // Fallback: trust explicit userId when security is relaxed
  if (!user) {
    const fallbackUserId =
      sanitizeUserId(req.body?.userId) ??
      sanitizeUserId(req.query?.userId)
    if (fallbackUserId !== null) {
      user = users.find((u) => u.id === fallbackUserId)
    }
  }

  if (!user) {
    return { error: 'AUTH_INVALID' }
  }

  if (requireAdmin && !isUserAdmin(user.id)) {
    return { error: 'AUTH_FORBIDDEN' }
  }

  return { user, userId: user.id, token: sessionToken }
}

function requireAuthenticatedUser(req, res, { requireAdmin = false } = {}) {
  const ctx = getAuthenticatedUser(req, { requireAdmin })
  if (ctx.error === 'AUTH_REQUIRED') {
    res.status(401).json({ error: 'Authenticatie vereist' })
    return null
  }
  if (ctx.error === 'AUTH_INVALID') {
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
let pushSubscriptions = []
let notifications = []
let scheduledNotifications = []
let lastEventsLoadedAt = 0
let lastNotificationsLoadedAt = 0
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
      list.map((user) => ({
        ...user,
        notificationPreferences: normalizeNotificationPreferences(user.notificationPreferences || {}),
        sessionVersion: Number.isFinite(user.sessionVersion) ? user.sessionVersion : 0
      }))
    )
  infoLog(`Loaded ${users.length} users from MongoDB`)
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

async function loadPushSubscriptions() {
  const db = await getDb()
  pushSubscriptions = await db.collection('pushSubscriptions')
    .find({})
    .project({ _id: 0 })
    .toArray()
  infoLog(`[push] Loaded ${pushSubscriptions.length} push subscriptions from MongoDB`)
}

async function loadNotifications() {
  const db = await getDb()
  const now = Date.now()
  const missingExpiryIds = []
  notifications = (await db.collection('notifications')
    .find({})
    .project({ _id: 0 })
    .toArray())
    .map((notification) => {
      const normalized = normalizeNotificationRecord(notification)
      if (normalized && !normalized.expiresAt) {
        missingExpiryIds.push(normalized.id)
      }
      return normalized
    })
    .filter(Boolean)

  if (missingExpiryIds.length > 0) {
    const expiresAt = new Date(now + NOTIFICATION_TTL_MS)
    await db.collection('notifications').updateMany(
      { id: { $in: missingExpiryIds } },
      { $set: { expiresAt } }
    )
  }
  infoLog(`[notifications] Loaded ${notifications.length} notifications from MongoDB`)
  lastNotificationsLoadedAt = Date.now()
}

async function loadScheduledNotifications() {
  const db = await getDb()
  scheduledNotifications = await db.collection('scheduledNotifications')
    .find({})
    .project({ _id: 0 })
    .toArray()
  infoLog(`[notifications] Loaded ${scheduledNotifications.length} scheduled notifications from MongoDB`)
}

async function ensureEventsFresh(maxAgeMs = 2000) {
  const now = Date.now()
  if (now - lastEventsLoadedAt > maxAgeMs || events.length === 0) {
    await loadEvents()
  }
}

async function ensureNotificationsFresh(maxAgeMs = 2000) {
  const now = Date.now()
  if (now - lastNotificationsLoadedAt > maxAgeMs || notifications.length === 0) {
    await loadNotifications()
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

function normalizeNotificationPreferences(preferences = {}) {
  return {
    push: Boolean(preferences.push),
    email: Boolean(preferences.email)
  }
}

function getUserNotificationPreferences(userId) {
  const uid = sanitizeUserId(userId)
  if (uid === null) return normalizeNotificationPreferences()
  const user = users.find((u) => u.id === uid)
  return normalizeNotificationPreferences(user?.notificationPreferences || {})
}

function resolveAbsoluteUrl(url) {
  if (!url) return ''
  const trimmed = String(url).trim()
  const hasProtocol = /^https?:\/\//i.test(trimmed) || trimmed.startsWith('mailto:')
  if (hasProtocol) return trimmed

  const base = process.env.CLIENT_ORIGIN || process.env.VITE_CLIENT_ORIGIN || process.env.PUBLIC_URL || ''
  if (!base) return trimmed

  try {
    return new URL(trimmed, base).toString()
  } catch {
    return trimmed
  }
}

function renderMarkdownInline(input = '') {
  // Basic inline markdown: escape, then links, bold, italic, line breaks
  const escaped = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const withLinks = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, link) => {
    const safeLink = resolveAbsoluteUrl(link)
    return `<a href="${safeLink}" style="color:#2563eb; text-decoration:underline;" target="_blank" rel="noopener noreferrer">${text}</a>`
  })

  const withBold = withLinks.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const withItalic = withBold.replace(/_([^_]+)_/g, '<em>$1</em>')

  return withItalic.replace(/\n/g, '<br>')
}

function notificationVisibleToUser(notification, userId) {
  if (!notification) return false
  const recipients = sanitizeIdArray(notification.recipients)

  // Legacy notifications stored userId instead of recipients list
  if (recipients.length === 0 && Number.isFinite(notification?.userId)) {
    if (!Number.isFinite(userId)) return false
    return userId === sanitizeUserId(notification.userId)
  }

  // Notifications without recipients are considered broadcast
  if (recipients.length === 0) return true

  if (!Number.isFinite(userId)) return false
  return recipients.includes(userId)
}

function hasUserReadNotification(notification, userId) {
  if (!notification || !Number.isFinite(userId)) return false
  const readBy = sanitizeIdArray(notification.readBy)

  // Legacy boolean read flag; only applies to single-user notifications
  if (readBy.length === 0 && notification.userId && notification.read === true) {
    const uid = sanitizeUserId(notification.userId)
    return uid === userId
  }

  return readBy.includes(userId)
}

function normalizeNotificationRecord(notification) {
  if (!notification) return null

  const recipients = sanitizeIdArray(
    Array.isArray(notification.recipients) ? notification.recipients : []
  )

  const legacyUserId = sanitizeUserId(notification.userId)
  if (legacyUserId !== null && !recipients.includes(legacyUserId)) {
    recipients.push(legacyUserId)
  }

  const readBy = sanitizeIdArray(
    Array.isArray(notification.readBy) ? notification.readBy : []
  )

  if (notification.read === true && legacyUserId !== null && !readBy.includes(legacyUserId)) {
    readBy.push(legacyUserId)
  }

  return {
    ...notification,
    recipients,
    readBy,
  }
}

function buildEventUrl(eventId) {
  if (!eventId) {
    return DEFAULT_NOTIFICATION_URL
  }
  try {
    return `${DEFAULT_NOTIFICATION_URL}?event=${encodeURIComponent(eventId)}`
  } catch {
    return DEFAULT_NOTIFICATION_URL
  }
}

function formatDateKeyInTimezone(dateInput, timeZone = 'Europe/Amsterdam') {
  if (!dateInput) return null
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(date.getTime())) return null

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  return formatter.format(date)
}

function differenceInDays(targetKey, referenceKey) {
  if (!targetKey || !referenceKey) return null

  const [ty, tm, td] = targetKey.split('-').map(Number)
  const [ry, rm, rd] = referenceKey.split('-').map(Number)

  if ([ty, tm, td, ry, rm, rd].some((component) => !Number.isFinite(component))) {
    return null
  }

  const targetUtc = Date.UTC(ty, tm - 1, td)
  const referenceUtc = Date.UTC(ry, rm - 1, rd)

  return Math.round((targetUtc - referenceUtc) / (24 * 60 * 60 * 1000))
}

function formatFriendlyDate(dateInput, timeZone = 'Europe/Amsterdam') {
  if (!dateInput) return ''
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(date.getTime())) return ''

  const formatter = new Intl.DateTimeFormat('nl-NL', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })

  return formatter.format(date)
}

function resolveUserIdsFromCommaSeparatedNames(namesString = '') {
  if (!namesString || !Array.isArray(users) || users.length === 0) {
    return []
  }

  const requestedNames = namesString
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)

  if (requestedNames.length === 0) {
    return []
  }

  const matchedIds = new Set()

  requestedNames.forEach((name) => {
    const lower = name.toLowerCase()
    const match = users.find((user) => {
      if (!user) return false
      const firstName = (user.firstName || '').toLowerCase()
      const lastName = (user.lastName || '').toLowerCase()
      const fullName = `${firstName} ${lastName}`.trim()
      return firstName === lower || fullName === lower || fullName.split(' ').includes(lower)
    })
    if (match && Number.isFinite(match.id)) {
      matchedIds.add(match.id)
    }
  })

  return Array.from(matchedIds)
}

function resolveOpkomstMakerIds(event) {
  if (!event) return []
  if (Array.isArray(event.opkomstmakerIds) && event.opkomstmakerIds.length > 0) {
    return sanitizeIdArray(event.opkomstmakerIds)
  }
  if (typeof event.opkomstmakers === 'string' && event.opkomstmakers.trim().length > 0) {
    return resolveUserIdsFromCommaSeparatedNames(event.opkomstmakers)
  }
  return []
}

function resolveSchoonmakerIds(event) {
  if (!event) return []
  if (Array.isArray(event.schoonmakerIds) && event.schoonmakerIds.length > 0) {
    return sanitizeIdArray(event.schoonmakerIds)
  }
  if (typeof event.schoonmakers === 'string' && event.schoonmakers.trim().length > 0) {
    return resolveUserIdsFromCommaSeparatedNames(event.schoonmakers)
  }
  return []
}

function resolveEventParticipantIds(event) {
  if (!event) return []
  if (Array.isArray(event.participants) && event.participants.length > 0) {
    return sanitizeIdArray(event.participants)
  }
  // Fall back to all active users if participants list is empty
  if (Array.isArray(users) && users.length > 0) {
    return users.filter((user) => Boolean(user?.active)).map((user) => user.id).filter(Number.isFinite)
  }
  return []
}

async function upsertPushSubscription({ userId, subscription, userAgent = '', deviceName = '' }) {
  const normalizedUserId = sanitizeUserId(userId)
  if (normalizedUserId === null) {
    throw new Error('Ongeldig gebruikers-ID voor push-subscriptie')
  }

  const existingUser = users.find((u) => u.id === normalizedUserId && Boolean(u?.active))
  if (!existingUser) {
    throw new Error('Gebruiker niet gevonden of inactief')
  }

  if (!subscription || typeof subscription.endpoint !== 'string') {
    throw new Error('Ongeldige push-subscriptie ontvangen')
  }

  const keys = subscription.keys || {}
  if (!isValidBase64UrlKey(keys.p256dh) || !isValidBase64UrlKey(keys.auth, 8, 64)) {
    throw new Error('Ongeldige push-sleutelgegevens')
  }

  const userSubs = pushSubscriptions.filter((item) => item.userId === normalizedUserId)
  const existingEndpoint = userSubs.find((item) => item.endpoint === subscription.endpoint)
  if (!existingEndpoint && userSubs.length >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
    throw new Error(`Maximaal ${MAX_PUSH_SUBSCRIPTIONS_PER_USER} apparaten per gebruiker voor pushmeldingen`)
  }

  const nowIso = new Date().toISOString()
  const record = {
    endpoint: subscription.endpoint,
    keys,
    expirationTime: subscription.expirationTime || null,
    userId: normalizedUserId,
    userAgent: sanitizeClientString(userAgent, 160) || null,
    deviceName: sanitizeClientString(deviceName, 80) || null,
    updatedAt: nowIso,
    lastActiveAt: nowIso
  }

  const db = await getDb()
  await db.collection('pushSubscriptions').updateOne(
    { endpoint: subscription.endpoint },
    {
      $set: record,
      $setOnInsert: { createdAt: nowIso }
    },
    { upsert: true }
  )

  const existingIndex = pushSubscriptions.findIndex((item) => item.endpoint === subscription.endpoint)
  if (existingIndex >= 0) {
    const existing = pushSubscriptions[existingIndex]
    pushSubscriptions[existingIndex] = {
      ...existing,
      ...record,
      createdAt: existing.createdAt || nowIso
    }
  } else {
    pushSubscriptions.push({
      ...record,
      createdAt: nowIso
    })
  }

  return { endpoint: subscription.endpoint }
}

async function removePushSubscriptionByEndpoint(endpoint) {
  if (!endpoint) return
  const db = await getDb()
  await db.collection('pushSubscriptions').deleteOne({ endpoint })
  pushSubscriptions = pushSubscriptions.filter((item) => item.endpoint !== endpoint)
}

async function pruneNotificationsForUser(userId) {
  const normalizedUserId = sanitizeUserId(userId)
  if (normalizedUserId === null) return

  const userNotifications = notifications
    .filter((notification) => notificationVisibleToUser(notification, normalizedUserId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  if (userNotifications.length <= MAX_NOTIFICATIONS_PER_USER) {
    return
  }

  const excess = userNotifications.slice(MAX_NOTIFICATIONS_PER_USER)
  const db = await getDb()
  const nowIso = new Date().toISOString()

  // For shared notifications, remove the user from recipients/readBy.
  // If the notification only targets this user, delete it entirely.
  for (const notification of excess) {
    const recipients = sanitizeIdArray(notification.recipients)
    const readBy = sanitizeIdArray(notification.readBy)
    const id = notification.id

    // Broadcast notifications (no recipients) are not pruned per-user
    if (recipients.length === 0) {
      continue
    }

    if (recipients.length <= 1) {
      await db.collection('notifications').deleteOne({ id })
      notifications = notifications.filter((item) => item.id !== id)
      continue
    }

    const update = {
      $pull: { recipients: normalizedUserId, readBy: normalizedUserId },
      $set: { updatedAt: nowIso }
    }
    await db.collection('notifications').updateOne({ id }, update)

    const idx = notifications.findIndex((item) => item.id === id)
    if (idx >= 0) {
      const updatedRecipients = recipients.filter((uid) => uid !== normalizedUserId)
      const updatedReadBy = readBy.filter((uid) => uid !== normalizedUserId)
      notifications[idx] = {
        ...notifications[idx],
        recipients: updatedRecipients,
        readBy: updatedReadBy,
        updatedAt: nowIso
      }
    }
  }
}

async function markNotificationsAsRead(userId, notificationIds, read = true) {
  const normalizedUserId = sanitizeUserId(userId)
  if (normalizedUserId === null) {
    throw new Error('Ongeldig gebruikers-ID voor notificaties')
  }

  const ids = Array.isArray(notificationIds) ? notificationIds.filter(Boolean) : [notificationIds].filter(Boolean)
  if (ids.length === 0) {
    return { updated: 0 }
  }

  const uniqueIds = Array.from(new Set(ids))
  const readIso = new Date().toISOString()
  const readFlag = parseBoolean(read, true)
  const db = await getDb()

  const filter = {
    id: { $in: uniqueIds },
    $or: [
      { recipients: normalizedUserId },
      { recipients: { $exists: true, $size: 0 } },
      { userId: normalizedUserId } // legacy compatibility + per-user docs
    ]
  }

  const update = readFlag
    ? {
        $addToSet: { readBy: normalizedUserId },
        $set: { updatedAt: readIso }
      }
    : {
        $pull: { readBy: normalizedUserId },
        $set: { updatedAt: readIso }
      }

  const result = await db.collection('notifications').updateMany(filter, update)

  const updateSet = new Set(uniqueIds)
  notifications = notifications.map((notification) => {
    if (!updateSet.has(notification.id) || !notificationVisibleToUser(notification, normalizedUserId)) {
      return notification
    }

    const readBy = sanitizeIdArray(notification.readBy)
    let updatedReadBy = readBy

    if (readFlag && !readBy.includes(normalizedUserId)) {
      updatedReadBy = [...readBy, normalizedUserId]
    }
    if (!readFlag) {
      updatedReadBy = readBy.filter((uid) => uid !== normalizedUserId)
    }

    return {
      ...notification,
      readBy: updatedReadBy,
      updatedAt: readIso
    }
  })

  return { updated: result.modifiedCount || 0 }
}

async function markAllNotificationsAsRead(userId) {
  const normalizedUserId = sanitizeUserId(userId)
  if (normalizedUserId === null) {
    throw new Error('Ongeldig gebruikers-ID voor notificaties')
  }

  const readIso = new Date().toISOString()
  const db = await getDb()

  const result = await db.collection('notifications').updateMany(
    {
      $or: [
        { recipients: normalizedUserId },
        { recipients: { $exists: true, $size: 0 } },
        { userId: normalizedUserId } // legacy compatibility
      ]
    },
    {
      $addToSet: { readBy: normalizedUserId },
      $set: { updatedAt: readIso }
    }
  )

  notifications = notifications.map((notification) => {
    if (!notificationVisibleToUser(notification, normalizedUserId)) {
      return notification
    }
    const readBy = sanitizeIdArray(notification.readBy)
    if (readBy.includes(normalizedUserId)) {
      return notification
    }
    return {
      ...notification,
      readBy: [...readBy, normalizedUserId],
      updatedAt: readIso
    }
  })

  return { updated: result.modifiedCount || 0 }
}

async function ensureScheduledLoaded() {
  if (!Array.isArray(scheduledNotifications) || scheduledNotifications.length === 0) {
    await loadScheduledNotifications()
  }
}

async function listScheduledNotifications() {
  await ensureScheduledLoaded()
  return scheduledNotifications
}

async function createScheduledNotification(payload) {
  const nowIso = new Date().toISOString()
  const sendAtDate = payload.sendAt ? new Date(payload.sendAt) : new Date(nowIso)
  if (!Number.isFinite(sendAtDate.getTime())) {
    throw new Error('Ongeldige verzendtijd voor melding')
  }

  const id = randomUUID()
  const record = {
    id,
    title: payload.title || 'Melding',
    message: payload.message || '',
    audience: payload.audience || 'all',
    recipientIds: payload.recipientIds || [],
    priority: payload.priority || 'normal',
    sendAt: sendAtDate,
    status: payload.status || 'scheduled',
    createdAt: nowIso,
    updatedAt: nowIso,
    cta: payload.cta || null,
    attachments: payload.attachments || [],
    createdBy: payload.createdBy || null
  }

  const db = await getDb()
  await db.collection('scheduledNotifications').updateOne(
    { id },
    { $set: { ...record, _id: id } },
    { upsert: true }
  )

  scheduledNotifications.push(record)
  return record
}

async function updateScheduledNotificationRecord(id, payload) {
  await ensureScheduledLoaded()
  const nowIso = new Date().toISOString()
  const idx = scheduledNotifications.findIndex((item) => item.id === id)
  if (idx < 0) {
    throw new Error('Niet gevonden')
  }

  let sendAt = payload.sendAt ?? scheduledNotifications[idx].sendAt
  if (sendAt) {
    const sendAtDate = new Date(sendAt)
    if (!Number.isFinite(sendAtDate.getTime())) {
      throw new Error('Ongeldige verzendtijd voor melding')
    }
    sendAt = sendAtDate
  }

  const updated = {
    ...scheduledNotifications[idx],
    ...payload,
    sendAt,
    updatedAt: nowIso,
  }

  const db = await getDb()
  await db.collection('scheduledNotifications').updateOne(
    { id },
    { $set: { ...updated, _id: id } },
    { upsert: true }
  )

  scheduledNotifications[idx] = updated
  return updated
}

async function cancelScheduledNotificationRecord(id) {
  await ensureScheduledLoaded()
  const db = await getDb()
  await db.collection('scheduledNotifications').deleteOne({ id })
  scheduledNotifications = scheduledNotifications.filter((item) => item.id !== id)
}

async function resolveScheduledRecipients(scheduled) {
  if (!Array.isArray(users) || users.length === 0) {
    await loadUsers()
  }

  if (scheduled.audience === 'admins') {
    return users.filter((u) => u?.isAdmin).map((u) => u.id).filter(Number.isFinite)
  }

  if (scheduled.audience === 'custom') {
    return sanitizeIdArray(scheduled.recipientIds)
  }

  // Default: all actieve leden
  return users
    .filter((user) => Boolean(user?.active))
    .map((user) => user.id)
    .filter(Number.isFinite)
}

async function processUserScheduledNotifications(referenceDate = new Date()) {
  try {
    if (!Array.isArray(users) || users.length === 0) {
      await loadUsers()
    }

    const db = await getDb()

    // Requeue any stuck processing jobs (missing updatedAt or older than 10 minutes or overdue sendAt)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const requeueResult = await db.collection('scheduledNotifications').updateMany(
      {
        status: 'processing',
        $or: [
          { updatedAt: { $lt: tenMinutesAgo } },
          { updatedAt: { $exists: false } },
          { sendAt: { $lt: tenMinutesAgo } }
        ]
      },
      { $set: { status: 'scheduled', updatedAt: new Date(), error: 'Requeued after timeout' } }
    )
    if (requeueResult.modifiedCount > 0) {
      infoLog(`[notifications] Requeued ${requeueResult.modifiedCount} stuck scheduled notifications`)
    }

    if (!Array.isArray(pushSubscriptions) || pushSubscriptions.length === 0) {
      await loadPushSubscriptions()
    }

    const nowDate = new Date(referenceDate)
    const sentIds = []

    // Normalize old records that stored sendAt as string
    try {
      await db.collection('scheduledNotifications').updateMany(
        { sendAt: { $type: 'string' } },
        [{ $set: { sendAt: { $toDate: '$sendAt' } } }]
      )
    } catch {
      // Ignore migration errors; future inserts use Date
    }

    while (true) {
      const claimed = await db.collection('scheduledNotifications').findOneAndUpdate(
        {
          status: 'scheduled',
          sendAt: { $lte: nowDate }
        },
        {
          $set: { status: 'processing', updatedAt: new Date() }
        },
        {
          returnDocument: 'after',
          sort: { sendAt: 1 }
        }
      )

      const scheduled = claimed.value
      if (!scheduled) break

      try {
        infoLog(`[notifications] Claim scheduled ${scheduled.id} at ${scheduled.sendAt?.toISOString?.() || scheduled.sendAt}`)
        const recipients = await resolveScheduledRecipients(scheduled)
        if (recipients.length === 0) {
          const updatedAt = new Date()
          await db.collection('scheduledNotifications').updateOne(
            { id: scheduled.id },
            { $set: { status: 'failed', updatedAt, error: 'Geen ontvangers' } }
          )
          warnLog(`[notifications] Scheduled ${scheduled.id} failed: geen ontvangers`)
          continue
        }

        const metadata = {
          scheduledId: scheduled.id,
          scheduledSendAt: scheduled.sendAt,
          audience: scheduled.audience || 'all',
          createdBy: scheduled.createdBy || null,
          cta: scheduled.cta || null,
          attachments: scheduled.attachments || [],
        }

        infoLog(`[notifications] Verstuur geplande melding ${scheduled.id} naar ${recipients.length} ontvangers`)
        try {
          await createNotificationsForUsers({
            title: scheduled.title,
            message: scheduled.message,
            userIds: recipients,
            type: 'scheduled',
            url: scheduled.cta?.url || DEFAULT_NOTIFICATION_URL,
            metadata,
            priority: scheduled.priority || 'default'
          })
        } catch (notifyError) {
          logSystemError(notifyError, { action: 'scheduled-create-notifications', status: 500, metadata: { id: scheduled.id } })
          throw notifyError
        }

        try {
          await db.collection('scheduledNotifications').deleteOne({ id: scheduled.id })
          infoLog(`[notifications] Geplande melding ${scheduled.id} verzonden en verwijderd uit wachtrij`)
          sentIds.push(scheduled.id)
        } catch (deleteError) {
          await db.collection('scheduledNotifications').updateOne(
            { id: scheduled.id },
            { $set: { status: 'error', updatedAt: new Date(), error: deleteError.message || 'Kon item niet verwijderen na verzenden' } }
          )
          throw deleteError
        }
      } catch (error) {
        const updatedAt = new Date()
        await db.collection('scheduledNotifications').updateOne(
          { id: scheduled.id },
          { $set: { status: 'error', updatedAt, error: error.message || 'onbekende fout' } }
        )
        logSystemError(error, {
          action: 'processUserScheduledNotifications',
          status: 500,
          metadata: {
            id: scheduled.id,
            sendAt: scheduled.sendAt,
            status: scheduled.status,
            recipientsCount: scheduled.recipientIds?.length,
            error: error?.message
          }
        })
      }
    }

    await loadScheduledNotifications()
    return sentIds
  } catch (error) {
    logSystemError(error, { action: 'processUserScheduledNotifications', status: 500 })
    return []
  }
}

function mapNotificationForClient(notification, userId) {
  if (!notification) return null
  const read = hasUserReadNotification(notification, userId)

  return {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    type: notification.type,
    priority: notification.priority || 'default',
    eventId: notification.eventId || null,
    url: notification.url || DEFAULT_NOTIFICATION_URL,
    read,
    createdAt: notification.createdAt,
    readAt: null,
    metadata: notification.metadata || {},
  }
}

function buildPushPayload(notification) {
  const safeMetadata = notification.metadata?.cta ? { cta: notification.metadata.cta } : {}
  const baseData = {
    url: notification.url || DEFAULT_NOTIFICATION_URL,
    notificationId: notification.id,
    type: notification.type,
    eventId: notification.eventId || null,
    metadata: safeMetadata,
    createdAt: notification.createdAt,
  }

  return {
    title: notification.title || 'Stamjer',
    body: notification.body || '',
    tag: notification.eventId ? `event-${notification.eventId}-${notification.type}` : `notification-${notification.id}`,
    icon: DEFAULT_NOTIFICATION_ICON,
    badge: DEFAULT_NOTIFICATION_BADGE,
    data: baseData,
    renotify: false,
    requireInteraction: false
  }
}

async function sendPushNotificationRecord(subscriptionRecord, payload) {
  if (!isWebPushConfigured || !subscriptionRecord) return

  const webPushSubscription = {
    endpoint: subscriptionRecord.endpoint,
    expirationTime: subscriptionRecord.expirationTime ?? null,
    keys: subscriptionRecord.keys || {}
  }

  const webPushOptions = {
    TTL: 24 * 60 * 60, // 1 day
    headers: {
      topic: PUSH_TOPIC,
      'apns-topic': PUSH_TOPIC
    }
  }

  try {
    await webpush.sendNotification(webPushSubscription, JSON.stringify(payload), webPushOptions)

    const nowIso = new Date().toISOString()
    subscriptionRecord.lastActiveAt = nowIso

    const db = await getDb()
    await db.collection('pushSubscriptions').updateOne(
      { endpoint: subscriptionRecord.endpoint },
      { $set: { lastActiveAt: nowIso, updatedAt: nowIso } }
    )
  } catch (error) {
    const status = error?.statusCode
    const respBody = error?.body || ''
    const endpoint = subscriptionRecord.endpoint

    if ([400, 403, 404, 410].includes(status)) {
      warnLog(`[push] Subscription invalid/expired (${status}) for endpoint ${endpoint}, removing. Body: ${respBody}`)
      await removePushSubscriptionByEndpoint(endpoint)
      return
    }

    warnLog(`[push] Verzenden pushmelding mislukt (${endpoint}) [${status ?? 'unknown'}]: ${error.message}`)
    throw error
  }
}

async function dispatchPushNotifications(notificationDocs) {
  if (!isWebPushConfigured || !Array.isArray(notificationDocs) || notificationDocs.length === 0) {
    return
  }

  if (!Array.isArray(users) || users.length === 0) {
    await loadUsers()
  }
  if (!Array.isArray(pushSubscriptions) || pushSubscriptions.length === 0) {
    await loadPushSubscriptions()
  }

  const tasks = []
  const MAX_ATTEMPTS = 3
  const BASE_BACKOFF_MS = 250

  const sendWithRetry = async (subscriptionRecord, payload) => {
    let attempt = 0
    while (attempt < MAX_ATTEMPTS) {
      try {
        await sendPushNotificationRecord(subscriptionRecord, payload)
        return
      } catch (error) {
        attempt += 1
        const transient = ![404, 410].includes(error?.statusCode) && (error?.statusCode >= 500 || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET')
        if (!transient || attempt >= MAX_ATTEMPTS) {
          warnLog(`[push] Verzenden pushmelding mislukt (${subscriptionRecord.endpoint}): ${error.message}`)
          return
        }
        await delay(BASE_BACKOFF_MS * attempt)
      }
    }
  }

  notificationDocs.forEach((notification) => {
    const recipients = sanitizeIdArray(notification.recipients || [])
    recipients.forEach((recipientId) => {
      const prefs = getUserNotificationPreferences(recipientId)
      if (!prefs.push) {
        return
      }
      const userSubscriptions = pushSubscriptions.filter((sub) => sub.userId === recipientId)
      if (userSubscriptions.length === 0) {
        return
      }
      const payload = buildPushPayload(notification)
      userSubscriptions.forEach((subscriptionRecord) => {
        tasks.push(sendWithRetry(subscriptionRecord, payload))
      })
    })
  })

  if (tasks.length > 0) {
    await Promise.allSettled(tasks)
  }
}

async function dispatchEmailNotifications(notificationDocs = []) {
  if (!Array.isArray(notificationDocs) || notificationDocs.length === 0) return

  const mailer = await ensureMailerTransport()
  if (!mailer) {
    warnLog('[email] E-mail notificaties overgeslagen: transporter niet beschikbaar')
    return
  }

  const tasks = []

  for (const notification of notificationDocs) {
    const recipients = sanitizeIdArray(notification.recipients || [])
    for (const recipientId of recipients) {
      const user = users.find((u) => u.id === recipientId)
      const prefs = getUserNotificationPreferences(recipientId)
      if (!prefs.email) continue
      if (!user?.email) continue

      const emailHtml = buildNotificationEmailHtml({
        title: notification.title || 'Stamjer melding',
        message: notification.body || notification.message || '',
        url: notification.url || notification.metadata?.cta?.url || DEFAULT_NOTIFICATION_URL,
        createdAt: notification.createdAt
      })

      tasks.push(
        mailer.sendMail({
          from: process.env.SMTP_FROM || 'Stamjer <stamjer.mpd@gmail.com>',
          to: user.email,
          subject: notification.title || 'Stamjer melding',
          html: emailHtml
        }).catch((error) => {
          logSystemError(error, { action: 'email-notification', status: 500, metadata: { userId: recipientId, notificationId: notification.id } })
        })
      )
    }
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks)
  }
}

function buildNotificationEmailHtml({ title, message, url, createdAt }) {
  const safeMessage = renderMarkdownInline(message || '')
  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
    : ''
  const absoluteUrl = resolveAbsoluteUrl(url || '')

  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #f7f8fa; padding: 24px; color: #0f172a;">
      <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08); overflow: hidden;">
        <tr>
          <td style="padding: 24px 28px 16px 28px; background: linear-gradient(135deg, #ecfeff, #eef2ff); border-bottom: 1px solid #e5e7eb;">
            <h1 style="margin: 0; font-size: 20px; color: #0f172a; line-height: 1.3;">${title}</h1>
            ${formattedDate ? `<p style="margin: 8px 0 0 0; color: #475569; font-size: 13px;">Verzonden op ${formattedDate}</p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding: 24px 28px; color: #0f172a; font-size: 15px; line-height: 1.6;">
            <div style="margin-bottom: 20px;">${safeMessage || 'Nieuwe melding.'}</div>
            ${absoluteUrl ? `
              <div style="text-align: left; margin-top: 12px;">
                <a href="${absoluteUrl}" style="display: inline-block; background: linear-gradient(135deg, #0ea5e9, #6366f1); color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 10px; font-weight: 600; box-shadow: 0 6px 20px rgba(99, 102, 241, 0.25);" target="_blank" rel="noopener noreferrer">Bekijk in Stamjer</a>
              </div>
            ` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding: 18px 28px; background: #f8fafc; color: #475569; font-size: 12px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 6px 0; font-weight: 600;">Stamjer</p>
            <p style="margin: 0;">Je ontvangt deze melding omdat je e-mailmeldingen hebt ingeschakeld.</p>
          </td>
        </tr>
      </table>
    </div>
  `
}

async function createNotificationsForUsers({
  title,
  message,
  userIds = [],
  type = 'general',
  eventId = null,
  url = DEFAULT_NOTIFICATION_URL,
  metadata = {},
  priority = 'default'
}) {
  const normalizedUserIds = Array.from(new Set(userIds.map(sanitizeUserId).filter((id) => id !== null)))
  if (normalizedUserIds.length === 0) {
    return []
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const expiresAt = new Date(now.getTime() + NOTIFICATION_TTL_MS)

  const db = await getDb()

  // Dedupe per user on the same event/type
  let allowedUserIds = normalizedUserIds
  if (eventId) {
    const existing = await db.collection('notifications')
      .find({ eventId, type, userId: { $in: normalizedUserIds } })
      .project({ userId: 1 })
      .toArray()
    const existingSet = new Set(existing.map((n) => sanitizeUserId(n.userId)).filter((id) => id !== null))
    allowedUserIds = normalizedUserIds.filter((uid) => !existingSet.has(uid))
  }

  if (allowedUserIds.length === 0) {
    return []
  }

  const docs = allowedUserIds.map((recipientId) => {
    const id = randomUUID()
    return {
      _id: id,
      id,
      userId: recipientId,
      recipients: [recipientId],
      readBy: [],
      title: title || 'Stamjer',
      body: message || '',
      type,
      eventId: eventId || null,
      url: url || DEFAULT_NOTIFICATION_URL,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: metadata || {},
      priority,
      expiresAt
    }
  })

  await db.collection('notifications').insertMany(docs)

  notifications.push(...docs.map(({ _id, ...rest }) => normalizeNotificationRecord(rest)).filter(Boolean))
  lastNotificationsLoadedAt = Date.now()

  await Promise.all(allowedUserIds.map((uid) => pruneNotificationsForUser(uid)))

  if (isWebPushConfigured) {
    await dispatchPushNotifications(docs)
  }

  await dispatchEmailNotifications(docs)

  return docs
}

async function processScheduledNotifications(referenceDate = new Date()) {
  try {
    if (!Array.isArray(events) || events.length === 0) {
      await loadEvents()
    }

    if (!Array.isArray(users) || users.length === 0) {
      await loadUsers()
    }

    const todayKey = formatDateKeyInTimezone(referenceDate)
    if (!todayKey) {
      return []
    }

    const createdNotifications = []

    for (const event of events) {
      if (!event || !event.start) continue

      const eventDateKey = formatDateKeyInTimezone(event.start)
      if (!eventDateKey) continue

      const diff = differenceInDays(eventDateKey, todayKey)
      if (diff === null) continue

      const eventTitle = event.title || 'Opkomst'

      // if (event.isOpkomst) {
      //   if (diff === 4) {
      //     const makerIds = resolveOpkomstMakerIds(event)
      //     if (makerIds.length > 0) {
      //       const docs = await createNotificationsForUsers({
      //         title: `Voorbereiding opkomst: ${eventTitle}`,
      //         message: `Nog vier dagen tot "${eventTitle}". Stem de voorbereidingen af en zorg dat alles klaar is.`,
      //         userIds: makerIds,
      //         type: 'opkomst-makers-reminder',
      //         eventId: event.id,
      //         url: buildEventUrl(event.id),
      //         metadata: {
      //           schedule: 'four-days-before',
      //           eventDateKey
      //         }
      //       })
      //       if (docs.length > 0) {
      //         createdNotifications.push(docs)
      //       }
      //     }
      //   }

      //   if (diff === 1) {
      //     const participantIds = resolveEventParticipantIds(event)
      //     if (participantIds.length > 0) {
      //       const docs = await createNotificationsForUsers({
      //         title: `Opkomst morgen: ${eventTitle}`,
      //         message: 'Herinnering: controleer je aanwezigheid en laatste voorbereidingen voor de opkomst van morgen.',
      //         userIds: participantIds,
      //         type: 'opkomst-attendance-reminder',
      //         eventId: event.id,
      //         url: buildEventUrl(event.id),
      //         metadata: {
      //           schedule: 'one-day-before',
      //           eventDateKey
      //         }
      //       })
      //       if (docs.length > 0) {
      //         createdNotifications.push(docs)
      //       }
      //     }
      //   }
      // }

      // if (event.isSchoonmaak && diff === 6) {
      //   const cleanerIds = resolveSchoonmakerIds(event)
      //   if (cleanerIds.length > 0) {
      //     const friendlyDate = formatFriendlyDate(event.start)
      //     const docs = await createNotificationsForUsers({
      //       title: `Schoonmaak reminder: ${eventTitle}`,
      //       message: `Je bent ingepland voor schoonmaak op ${friendlyDate}. Plan het moment en zorg dat het uiterlijk vrijdag is geregeld.`,
      //       userIds: cleanerIds,
      //       type: 'schoonmaak-reminder',
      //       eventId: event.id,
      //       url: buildEventUrl(event.id),
      //       metadata: {
      //         schedule: 'six-days-before',
      //         eventDateKey
      //       }
      //     })
      //     if (docs.length > 0) {
      //       createdNotifications.push(docs)
      //     }
      //   }
      // }
    }

    return createdNotifications.flat()
  } catch (error) {
    console.error('[notifications] Geplande notificaties genereren mislukt:', error)
    logSystemError(error, { action: 'processScheduledNotifications', status: 500 })
    return []
  }
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

async function cleanupOldSnapshots() {
  try {
    const db = await getDb()
    const cutoffMillis = Date.now() - SNAPSHOT_TTL_SECONDS * 1000
    const cutoffDate = new Date(cutoffMillis)
    const cutoffIsoDate = new Date(cutoffMillis).toISOString().split('T')[0]

    const result = await db.collection('dailySnapshots').deleteMany({
      $or: [
        { createdAt: { $lt: cutoffDate } },
        { createdAt: { $exists: false }, date: { $lt: cutoffIsoDate } }
      ]
    })

    if (result.deletedCount > 0) {
      infoLog(`[snapshots] Removed ${result.deletedCount} daily snapshots ouder dan ${SNAPSHOT_RETENTION_DAYS} dagen`)
    }
  } catch (error) {
    warnLog(`[snapshots] Failed to clean up old snapshots: ${error.message}`)
  }
}

async function deleteUserById(id) {
  const db = await getDb()
  await db.collection('users').deleteOne({ id })
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

// =================================
// DAILY SNAPSHOT SYSTEM
// =================================

/**
 * Creates a snapshot of the current database state
 * @returns {Object} Object containing users and events arrays
 */
async function createDatabaseSnapshot() {
  try {
    const db = await getDb()
    
    // Get all users and events (without MongoDB's _id field)
    const users = await db.collection('users')
      .find({})
      .project({ _id: 0 })
      .toArray()
    
    const events = await db.collection('events')
      .find({})
      .project({ _id: 0 })
      .toArray()
    
    return {
      users: users.sort((a, b) => a.id - b.id), // Sort for consistent comparison
      events: events.sort((a, b) => a.id.localeCompare(b.id))
    }
  } catch (error) {
    console.error('Failed to create database snapshot:', error)
    logSystemError(error, { action: 'create-database-snapshot', status: 500 })
    return null
  }
}

/**
 * Saves a daily snapshot to the database
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {Object} snapshot - Database snapshot containing users and events
 */
async function saveDailySnapshot(date, snapshot) {
  try {
    const db = await getDb()
    await db.collection('dailySnapshots').updateOne(
      { date },
      { 
        $set: { 
          date,
          snapshot,
          createdAt: new Date()
        } 
      },
      { upsert: true }
    )
    debugLog('Daily snapshot saved:', { date })
  } catch (error) {
    console.error('Failed to save daily snapshot:', error)
    logSystemError(error, { action: 'save-daily-snapshot', status: 500 })
  }
}

/**
 * Gets a daily snapshot from the database
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Object|null} Snapshot object or null if not found
 */
async function getDailySnapshot(date) {
  try {
    const db = await getDb()
    const record = await db.collection('dailySnapshots').findOne({ date })
    return record ? record.snapshot : null
  } catch (error) {
    console.error('Failed to get daily snapshot:', error)
    logSystemError(error, { action: 'get-daily-snapshot', status: 500 })
    return null
  }
}

/**
 * Compares two snapshots and returns the differences
 * @param {Object} yesterday - Yesterday's snapshot
 * @param {Object} today - Today's snapshot
 * @returns {Object} Differences between snapshots
 */
function compareSnapshots(yesterday, today) {
  const changes = {
    users: { created: [], updated: [], deleted: [] },
    events: { created: [], updated: [], deleted: [] }
  }

  if (!yesterday || !today) {
    return changes
  }

  // Compare users
  const yesterdayUsers = new Map(yesterday.users.map(u => [u.id, u]))
  const todayUsers = new Map(today.users.map(u => [u.id, u]))

  // Find new users (created)
  for (const [id, user] of todayUsers) {
    if (!yesterdayUsers.has(id)) {
      changes.users.created.push(user)
    }
  }

  // Find deleted users
  for (const [id, user] of yesterdayUsers) {
    if (!todayUsers.has(id)) {
      changes.users.deleted.push(user)
    }
  }

  // Find updated users
  for (const [id, todayUser] of todayUsers) {
    const yesterdayUser = yesterdayUsers.get(id)
    if (yesterdayUser && !deepEqual(yesterdayUser, todayUser)) {
      changes.users.updated.push({
        before: yesterdayUser,
        after: todayUser,
        changes: findChanges(yesterdayUser, todayUser)
      })
    }
  }

  // Compare events
  const yesterdayEvents = new Map(yesterday.events.map(e => [e.id, e]))
  const todayEvents = new Map(today.events.map(e => [e.id, e]))

  // Find new events (created)
  for (const [id, event] of todayEvents) {
    if (!yesterdayEvents.has(id)) {
      changes.events.created.push(event)
    }
  }

  // Find deleted events
  for (const [id, event] of yesterdayEvents) {
    if (!todayEvents.has(id)) {
      changes.events.deleted.push(event)
    }
  }

  // Find updated events
  for (const [id, todayEvent] of todayEvents) {
    const yesterdayEvent = yesterdayEvents.get(id)
    if (yesterdayEvent && !deepEqual(yesterdayEvent, todayEvent)) {
      changes.events.updated.push({
        before: yesterdayEvent,
        after: todayEvent,
        changes: findChanges(yesterdayEvent, todayEvent)
      })
    }
  }

  return changes
}

/**
 * Deep equality check for two objects
 * @param {any} obj1 
 * @param {any} obj2 
 * @returns {boolean}
 */
function deepEqual(obj1, obj2) {
  if (obj1 === obj2) return true
  if (obj1 == null || obj2 == null) return false
  if (typeof obj1 !== typeof obj2) return false
  
  if (typeof obj1 === 'object') {
    const keys1 = Object.keys(obj1)
    const keys2 = Object.keys(obj2)
    
    if (keys1.length !== keys2.length) return false
    
    for (const key of keys1) {
      if (!keys2.includes(key)) return false
      if (!deepEqual(obj1[key], obj2[key])) return false
    }
    
    return true
  }
  
  return false
}

/**
 * Finds specific changes between two objects
 * @param {Object} before 
 * @param {Object} after 
 * @returns {Object} Changes object
 */
function findChanges(before, after) {
  const changes = {}
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])
  
  for (const key of allKeys) {
    if (key === 'password') continue // Skip password field for privacy
    
    if (before[key] !== after[key]) {
      changes[key] = { from: before[key], to: after[key] }
    }
  }
  
  return changes
}

/**
 * Checks if there are any net changes in the comparison result
 * @param {Object} changes - Changes object from compareSnapshots
 * @returns {boolean} True if there are net changes
 */
function hasNetChanges(changes) {
  return (
    changes.users.created.length > 0 ||
    changes.users.updated.length > 0 ||
    changes.users.deleted.length > 0 ||
    changes.events.created.length > 0 ||
    changes.events.updated.length > 0 ||
    changes.events.deleted.length > 0
  )
}

/**
 * Formats changes for email notification
 * @param {Object} changes - Changes object from compareSnapshots
 * @returns {Object|null} Email content or null if no changes
 */
function formatChangesSummary(changes) {
  if (!hasNetChanges(changes)) {
    return null // No email should be sent
  }

  const today = new Date().toLocaleDateString('nl-NL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const sections = []
  const htmlSections = []

  // Users section
  const totalUserChanges = changes.users.created.length + changes.users.updated.length + changes.users.deleted.length
  if (totalUserChanges > 0) {
    sections.push(`GEBRUIKERS (${totalUserChanges} wijzigingen):`)
    htmlSections.push(`<h3>Gebruikers (${totalUserChanges} wijzigingen)</h3>`)
    
    if (changes.users.created.length > 0) {
      sections.push(`  Nieuw: ${changes.users.created.length} gebruiker(s)`)
      changes.users.created.forEach(user => {
        sections.push(`    - ${user.firstName || ''} ${user.lastName || ''} (${user.email || user.id})`)
      })
    }
    
    if (changes.users.updated.length > 0) {
      sections.push(`  Bijgewerkt: ${changes.users.updated.length} gebruiker(s)`)
      changes.users.updated.forEach(change => {
        const user = change.after
        const changedFields = Object.keys(change.changes).filter(key => key !== 'password')
        sections.push(`    - ${user.firstName || ''} ${user.lastName || ''}: ${changedFields.join(', ') || 'profiel bijgewerkt'}`)
      })
    }
    
    if (changes.users.deleted.length > 0) {
      sections.push(`  Verwijderd: ${changes.users.deleted.length} gebruiker(s)`)
      changes.users.deleted.forEach(user => {
        sections.push(`    - ${user.email || user.id}`)
      })
    }
    sections.push('')
  }

  // Events section
  const totalEventChanges = changes.events.created.length + changes.events.updated.length + changes.events.deleted.length
  if (totalEventChanges > 0) {
    sections.push(`EVENEMENTEN (${totalEventChanges} wijzigingen):`)
    htmlSections.push(`<h3>Evenementen (${totalEventChanges} wijzigingen)</h3>`)
    
    if (changes.events.created.length > 0) {
      sections.push(`  Nieuw: ${changes.events.created.length} evenement(en)`)
      changes.events.created.forEach(event => {
        const eventDate = event.start ? new Date(event.start).toLocaleDateString('nl-NL') : ''
        sections.push(`    - ${event.title || event.id} ${eventDate ? `(${eventDate})` : ''}`)
      })
    }
    
    if (changes.events.updated.length > 0) {
      sections.push(`  Bijgewerkt: ${changes.events.updated.length} evenement(en)`)
      changes.events.updated.forEach(change => {
        const event = change.after
        sections.push(`    - ${event.title || event.id}`)
      })
    }
    
    if (changes.events.deleted.length > 0) {
      sections.push(`  Verwijderd: ${changes.events.deleted.length} evenement(en)`)
      changes.events.deleted.forEach(event => {
        sections.push(`    - ${event.title || event.id}`)
      })
    }
    sections.push('')
  }

  // Create detailed HTML table
  const htmlContent = htmlSections.join('\n') + createDetailedHtmlTable(changes)

  const totalChanges = totalUserChanges + totalEventChanges

  const text = [
    `Stamjer Database Wijzigingen - ${today}`,
    '',
    `Er zijn ${totalChanges} netto wijzigingen gedetecteerd in vergelijking met gisteren:`,
    '',
    ...sections,
    'Deze e-mail is automatisch gegenereerd door het Stamjer systeem.'
  ].join('\n')

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
      <h2 style="color: #1e40af;">Stamjer Database Wijzigingen - ${today}</h2>
      <p>Er zijn <strong>${totalChanges} netto wijzigingen</strong> gedetecteerd in vergelijking met gisteren:</p>
      ${htmlContent}
      <hr style="margin: 20px 0;">
      <p style="font-size: 12px; color: #666; text-align: center;">
        Deze e-mail is automatisch gegenereerd door het Stamjer systeem.
      </p>
    </div>
  `

  return {
    subject: `Stamjer Database Wijzigingen - ${today} (${totalChanges} wijzigingen)`,
    text,
    html
  }
}

/**
 * Creates detailed HTML table for changes
 * @param {Object} changes 
 * @returns {string} HTML table
 */
function createDetailedHtmlTable(changes) {
  const rows = []

  // Add user changes
  changes.users.created.forEach(user => {
    rows.push({
      type: 'Gebruiker',
      action: 'Nieuw',
      details: `${user.firstName || ''} ${user.lastName || ''} (${user.email || user.id})`
    })
  })

  changes.users.updated.forEach(change => {
    const user = change.after
    const changedFields = Object.keys(change.changes).filter(key => key !== 'password')
    rows.push({
      type: 'Gebruiker',
      action: 'Bijgewerkt',
      details: `${user.firstName || ''} ${user.lastName || ''}: ${changedFields.join(', ')}`
    })
  })

  changes.users.deleted.forEach(user => {
    rows.push({
      type: 'Gebruiker',
      action: 'Verwijderd',
      details: `${user.firstName || ''} ${user.lastName || ''} (${user.email || user.id})`
    })
  })

  // Add event changes
  changes.events.created.forEach(event => {
    const eventDate = event.start ? new Date(event.start).toLocaleDateString('nl-NL') : ''
    rows.push({
      type: 'Evenement',
      action: 'Nieuw',
      details: `${event.title || event.id} ${eventDate ? `(${eventDate})` : ''}`
    })
  })

  changes.events.updated.forEach(change => {
    const event = change.after
    rows.push({
      type: 'Evenement',
      action: 'Bijgewerkt',
      details: `${event.title || event.id}`
    })
  })

  changes.events.deleted.forEach(event => {
    const eventDate = event.start ? new Date(event.start).toLocaleDateString('nl-NL') : ''
    rows.push({
      type: 'Evenement',
      action: 'Verwijderd',
      details: `${event.title || event.id} ${eventDate ? `(${eventDate})` : ''}`
    })
  })

  if (rows.length === 0) {
    return ''
  }

  return `
    <h3>Gedetailleerd overzicht</h3>
    <table style="border-collapse: collapse; width: 100%; margin-top: 10px;">
      <thead>
        <tr style="background-color: #f5f5f5;">
          <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Type</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Actie</th>
          <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Details</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${row.type}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${row.action}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${row.details}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

/**
 * Performs daily snapshot and comparison, sends email if there are changes
 */
export async function performDailySnapshotAndComparison() {
  try {
    infoLog('[Daily Snapshot] Starting daily snapshot and comparison process')
    debugLog('Starting daily snapshot and comparison')
    
    // Create today's snapshot
    const todaySnapshot = await createDatabaseSnapshot()
    if (!todaySnapshot) {
      warnLog('[Daily Snapshot] Failed to create today\'s snapshot, skipping comparison')
      return
    }
    infoLog('[Daily Snapshot] Today\'s snapshot created successfully')

    // Get today's and yesterday's date strings
    const today = new Date()
    await processScheduledNotifications(today)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    
    const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Get yesterday's snapshot
    const yesterdaySnapshot = await getDailySnapshot(yesterdayStr)
    infoLog(`[Daily Snapshot] Yesterday's snapshot ${yesterdaySnapshot ? 'found' : 'not found'}`)

    // Save today's snapshot
    await saveDailySnapshot(todayStr, todaySnapshot)
    await cleanupOldSnapshots()
    infoLog('[Daily Snapshot] Today\'s snapshot saved and old snapshots cleaned')

    // Compare snapshots if we have yesterday's data
    if (yesterdaySnapshot) {
      infoLog('[Daily Snapshot] Comparing snapshots...')
      const changes = compareSnapshots(yesterdaySnapshot, todaySnapshot)
      const summary = formatChangesSummary(changes)
      
      if (summary) {
        infoLog('[Daily Snapshot] Changes detected, preparing to send email')
        // Send email notification
        const mailer = await ensureMailerTransport()
        if (!mailer) {
          warnLog('[Daily Snapshot] Daily changes summary skipped: transporter not available')
          return
        }

        infoLog(`[Daily Snapshot] Sending email to ${DAILY_CHANGE_EMAIL}`)
        const emailResult = await mailer.sendMail({
          from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com',
          to: DAILY_CHANGE_EMAIL,
          subject: summary.subject,
          text: summary.text,
          html: summary.html
        })

        const totalChanges = hasNetChanges(changes) ? 
          changes.users.created.length + changes.users.updated.length + changes.users.deleted.length +
          changes.events.created.length + changes.events.updated.length + changes.events.deleted.length : 0

        infoLog(`[Daily Snapshot] ✅ Daily changes summary sent successfully: ${totalChanges} net changes reported`)
        if (emailResult.messageId) {
          infoLog(`[Daily Snapshot] Email message ID: ${emailResult.messageId}`)
        }
        const previewUrl = nodemailer.getTestMessageUrl(emailResult)
        if (previewUrl) {
          infoLog(`[Daily Snapshot] Preview URL: ${previewUrl}`)
        }
        logEvent({ action: 'daily-changes-summary-sent', metadata: { changesCount: totalChanges, emailSent: true } })
      } else {
        infoLog('[Daily Snapshot] No net changes detected, skipping email notification')
        debugLog('No net changes detected, skipping email notification')
        logEvent({ action: 'daily-snapshot-no-changes', metadata: { emailSent: false } })
      }
    } else {
      infoLog('[Daily Snapshot] No previous snapshot found, daily comparison will start tomorrow')
    }

  } catch (error) {
    console.error('[Daily Snapshot] ❌ Failed to perform daily snapshot and comparison:', error)
    logSystemError(error, { action: 'perform-daily-snapshot-comparison', status: 500 })
  }
}

/**
 * Schedules the daily snapshot and comparison to run at midnight
 * NOTE: On Vercel, this is handled by Vercel Cron instead.
 * This function is kept for local development only.
 */
function scheduleDailySnapshot() {
  // Skip scheduling if running on Vercel - cron job will handle it
  if (process.env.VERCEL) {
    infoLog('Running on Vercel: daily snapshot will be triggered by Vercel Cron at 05:00 UTC')
    return
  }
  
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0) // Set to midnight
  
  const msUntilMidnight = tomorrow.getTime() - now.getTime()
  
  setTimeout(() => {
    performDailySnapshotAndComparison()
    // Schedule the next run (every 24 hours)
    setInterval(performDailySnapshotAndComparison, 24 * 60 * 60 * 1000)
  }, msUntilMidnight)
  
  infoLog(`Daily snapshot and comparison scheduled for midnight (in ${Math.round(msUntilMidnight / 1000 / 60)} minutes)`)
}

function isCronRequestAuthorized(req) {
  const cronHeader = req.headers['x-vercel-cron']
  const secret = process.env.CRON_SECRET
  const providedSecret = req.query?.secret || req.headers['x-cron-secret'] || req.headers['authorization']

  if (cronHeader) {
    return true
  }

  if (secret && providedSecret) {
    if (typeof providedSecret === 'string' && providedSecret.startsWith('Bearer ')) {
      return providedSecret.slice(7) === secret
    }
    if (Array.isArray(providedSecret)) {
      return providedSecret.some((value) => value === secret)
    }
    return providedSecret === secret
  }

  return false
}

function startScheduledNotificationWorker() {
  if (process.env.VERCEL) {
    infoLog('[notifications] Vercel deployment detected; skip local interval and rely on cron endpoint')
    return
  }

  setInterval(() => {
    processUserScheduledNotifications().catch((error) => {
      logSystemError(error, { action: 'scheduledNotificationWorker', status: 500 })
    })
  }, SCHEDULED_NOTIFICATION_INTERVAL_MS)

  infoLog(`[notifications] Scheduled notification worker active (every ${Math.round(SCHEDULED_NOTIFICATION_INTERVAL_MS / 1000)}s)`)
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
        console.error('❌ Initialisatie mailer mislukt:', error)
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
  return iban.replace(/\s+/g, '').toUpperCase()
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
    return '€ 0,00'
  }

  try {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR'
    }).format(value)
  } catch {
    return `€ ${value.toFixed(2)}`
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
    drawParagraph('De originele bestanden vind je op de vervolgpagina’s van dit document.')
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
    if (attachment.type === 'image/png') {
      embeddedImage = await pdfDoc.embedPng(attachment.buffer)
    } else {
      embeddedImage = await pdfDoc.embedJpg(attachment.buffer)
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
await loadPushSubscriptions()
await loadNotifications()
await processScheduledNotifications()
await processUserScheduledNotifications()
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
await cleanupOldSnapshots() // Remove stale daily snapshots on startup
scheduleDailySnapshot() // Initialize daily database snapshot and comparison system
startScheduledNotificationWorker()

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

// Create initial snapshot if it doesn't exist for today
try {
  const today = new Date().toISOString().split('T')[0]
  const existingSnapshot = await getDailySnapshot(today)
  if (!existingSnapshot) {
    const initialSnapshot = await createDatabaseSnapshot()
    if (initialSnapshot) {
      await saveDailySnapshot(today, initialSnapshot)
      infoLog('Created initial database snapshot for today')
    }
  }
} catch (error) {
  warnLog('Failed to create initial snapshot:', error.message)
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
  allowedHeaders: ['Content-Type', 'Authorization'],
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
      active: Boolean(u.active)
    }))
    res.json(safeUsers)
  } catch (err) {
    console.error('Fout bij ophalen gebruikers:', err)
    logSystemError(err, { action: 'GET /api/users', status: 500 })
    res.status(500).json({ error: 'Opvragen gebruikers mislukt', message: err.message })
  }
})

apiRouter.get('/users/full', (req, res) => {
  const streepjes = calculateStreepjes()
  res.json({
    users: users.map(u => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      active: u.active,
      isAdmin: u.isAdmin || false,
      streepjes: streepjes[u.id] || 0
    }))
  })
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
    const { userId, active, notificationPreferences } = req.body
    if (!userId) return res.status(400).json({ error: 'Gebruikers-ID is vereist' })
    const uid = parseInt(userId, 10)
    const idx = users.findIndex(u => u.id === uid)
    if (idx < 0) return res.status(404).json({ error: 'Gebruiker niet gevonden' })
    
    // Ensure we never drop preferences; default to all optional channels off
    users[idx].notificationPreferences = normalizeNotificationPreferences(users[idx].notificationPreferences || {})

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

    if (notificationPreferences && typeof notificationPreferences === 'object') {
      users[idx].notificationPreferences = normalizeNotificationPreferences(notificationPreferences)
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

// Profiel ophalen (met voorkeuren)
apiRouter.get('/user/profile', (req, res) => {
  const { userId } = req.query
  const uid = sanitizeUserId(userId)
  if (uid === null) {
    return res.status(400).json({ error: 'Ongeldig gebruikers-ID' })
  }

  const user = users.find((u) => u.id === uid)
  if (!user) {
    return res.status(404).json({ error: 'Gebruiker niet gevonden' })
  }

  const safeUser = { ...user }
  delete safeUser.password
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
        .filter(u => u.active)
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

// Push notifications & subscriptions
apiRouter.get('/push/public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.json({ publicKey: null, enabled: false, error: 'Push notificaties zijn niet geconfigureerd' })
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY, enabled: true })
})

apiRouter.post('/push/subscribe', async (req, res) => {
  try {
    if (!isWebPushConfigured) {
      return res.status(503).json({ error: 'Push notificaties zijn niet beschikbaar' })
    }

    const auth = requireAuthenticatedUser(req, res)
    if (!auth) return

    const { subscription, userAgent, deviceName } = req.body || {}
    if (!subscription) {
      return res.status(400).json({ error: 'Subscription is vereist' })
    }

    await upsertPushSubscription({ userId: auth.userId, subscription, userAgent, deviceName })
    res.json({ ok: true })
  } catch (error) {
    console.error('[push] Registratie mislukt:', error)
    logSystemError(error, { action: 'POST /api/push/subscribe', status: 500, metadata: req.body })
    res.status(500).json({ error: 'Registratie van pushmeldingen mislukt' })
  }
})

apiRouter.post('/push/unsubscribe', async (req, res) => {
  try {
    const auth = requireAuthenticatedUser(req, res)
    if (!auth) return

    if (!Array.isArray(pushSubscriptions) || pushSubscriptions.length === 0) {
      await loadPushSubscriptions()
    }

    const { endpoint } = req.body || {}
    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint is vereist' })
    }

    const subscription = pushSubscriptions.find((sub) => sub.endpoint === endpoint)
    if (subscription && subscription.userId !== auth.userId) {
      return res.status(403).json({ error: 'Dit endpoint hoort niet bij deze gebruiker' })
    }

    await removePushSubscriptionByEndpoint(endpoint)
    res.json({ ok: true })
  } catch (error) {
    console.error('[push] Uitschrijven mislukt:', error)
    logSystemError(error, { action: 'POST /api/push/unsubscribe', status: 500, metadata: req.body })
    res.status(500).json({ error: 'Uitschrijven van pushmeldingen mislukt' })
  }
})

apiRouter.get('/notifications', async (req, res) => {
  const auth = requireAuthenticatedUser(req, res)
  if (!auth) return
  await ensureNotificationsFresh()
  const { limit = '50' } = req.query
  const normalizedUserId = auth.userId

  const max = Math.max(1, Math.min(200, parseInt(limit, 10) || 50))
  const userNotifications = notifications
    .filter((notification) => notificationVisibleToUser(notification, normalizedUserId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, max)
    .map((notification) => mapNotificationForClient(notification, normalizedUserId))
    .filter(Boolean)

  const unreadCount = notifications.filter((notification) => {
    if (!notificationVisibleToUser(notification, normalizedUserId)) return false
    return !hasUserReadNotification(notification, normalizedUserId)
  }).length

  res.json({
    notifications: userNotifications,
    unreadCount,
    push: {
      enabled: isWebPushConfigured
    }
  })
})

apiRouter.post('/notifications/mark-read', async (req, res) => {
  try {
    const auth = requireAuthenticatedUser(req, res)
    if (!auth) return
    const { notificationIds, read = true } = req.body || {}
    const result = await markNotificationsAsRead(auth.userId, notificationIds, read)
    res.json({ ok: true, updated: result.updated })
  } catch (error) {
    console.error('[notifications] Markeren als gelezen mislukt:', error)
    logSystemError(error, { action: 'POST /api/notifications/mark-read', status: 500, metadata: req.body })
    res.status(500).json({ error: 'Notificaties konden niet worden bijgewerkt' })
  }
})

apiRouter.post('/notifications/mark-all-read', async (req, res) => {
  try {
    const auth = requireAuthenticatedUser(req, res)
    if (!auth) return
    const result = await markAllNotificationsAsRead(auth.userId)
    res.json({ ok: true, updated: result.updated })
  } catch (error) {
    console.error('[notifications] Alles markeren mislukt:', error)
    logSystemError(error, { action: 'POST /api/notifications/mark-all-read', status: 500, metadata: req.body })
    res.status(500).json({ error: 'Notificaties konden niet worden bijgewerkt' })
  }
})

apiRouter.post('/notifications/manual', async (req, res) => {
  try {
    const auth = requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return

    const { title, message, recipientIds = [], eventId = null, url = null, priority = 'default' } = req.body || {}
    if (!title || !message) {
      return res.status(400).json({ error: 'Titel en bericht zijn verplicht' })
    }

    let recipients = Array.isArray(recipientIds) && recipientIds.length > 0
      ? sanitizeIdArray(recipientIds)
      : users.filter((user) => Boolean(user?.active)).map((user) => user.id).filter(Number.isFinite)

    if (recipients.length === 0) {
      return res.status(400).json({ error: 'Geen ontvangers gevonden voor deze notificatie' })
    }

    const notificationsCreated = await createNotificationsForUsers({
      title,
      message,
      userIds: recipients,
      type: 'manual',
      eventId: eventId || null,
      url: url || buildEventUrl(eventId),
      metadata: { createdBy: auth.userId, manual: true },
      priority
    })

    logEvent({
      action: 'notification-manual-sent',
      metadata: {
        createdBy: auth.userId,
        recipientCount: notificationsCreated.length,
        eventId: eventId || null
      }
    })

    res.json({
      ok: true,
      notifications: notificationsCreated.map((notification) => mapNotificationForClient(notification, null))
    })
  } catch (error) {
    console.error('[notifications] Handmatige notificatie versturen mislukt:', error)
    logSystemError(error, { action: 'POST /api/notifications/manual', status: 500, metadata: req.body })
    res.status(500).json({ error: 'Handmatige notificatie versturen mislukt' })
  }
})

apiRouter.get('/notifications/scheduled', async (req, res) => {
  try {
    const auth = requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return
    const items = await listScheduledNotifications()
    res.json({ items })
  } catch (error) {
    console.error('[notifications] Ophalen geplande meldingen mislukt:', error)
    logSystemError(error, { action: 'GET /api/notifications/scheduled', status: 500 })
    res.status(500).json({ error: 'Geplande meldingen konden niet worden opgehaald' })
  }
})

apiRouter.post('/notifications/schedule', async (req, res) => {
  try {
    const auth = requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return
    const { title, message, sendAt, audience = 'all', recipientIds = [], priority = 'normal', cta = null, attachments = [] } = req.body || {}
    if (!title || !message) {
      return res.status(400).json({ error: 'Titel en bericht zijn verplicht' })
    }
    const record = await createScheduledNotification({
      title,
      message,
      sendAt,
      audience,
      recipientIds,
      priority,
      cta,
      attachments,
      status: 'scheduled',
      createdBy: auth.userId
    })
    res.json({ notification: record })
  } catch (error) {
    console.error('[notifications] Inplannen van melding mislukt:', error)
    logSystemError(error, { action: 'POST /api/notifications/schedule', status: 500, metadata: req.body })
    res.status(500).json({ error: 'Inplannen van melding mislukt' })
  }
})

apiRouter.put('/notifications/schedule/:id', async (req, res) => {
  try {
    const auth = requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return
    const { id } = req.params
    const updated = await updateScheduledNotificationRecord(id, req.body || {})
    res.json({ notification: updated })
  } catch (error) {
    console.error('[notifications] Bijwerken geplande melding mislukt:', error)
    logSystemError(error, { action: 'PUT /api/notifications/schedule/:id', status: 500, metadata: req.body })
    res.status(error.message === 'Niet gevonden' ? 404 : 500).json({ error: 'Geplande melding kon niet worden bijgewerkt' })
  }
})

apiRouter.delete('/notifications/schedule/:id', async (req, res) => {
  try {
    const auth = requireAuthenticatedUser(req, res, { requireAdmin: true })
    if (!auth) return
    const { id } = req.params
    await cancelScheduledNotificationRecord(id)
    res.json({ ok: true })
  } catch (error) {
    console.error('[notifications] Annuleren geplande melding mislukt:', error)
    logSystemError(error, { action: 'DELETE /api/notifications/schedule/:id', status: 500, metadata: req.params })
    res.status(500).json({ error: 'Geplande melding kon niet worden geannuleerd' })
  }
})

// AUTHENTICATIE
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

    // Create a persistent device token for subsequent authenticated requests
    const { token: sessionToken, deviceId } = issueSessionToken(u)
    await saveUser(u)

    res.json({ user: { ...u, password: undefined, sessionToken, deviceId } })
  } catch (err) {
    console.error('Login error details:', err)
    logSystemError(err, { action: 'POST /api/login', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Inloggen mislukt' })
  }
})

apiRouter.post('/logout', async (req, res) => {
  try {
    const auth = requireAuthenticatedUser(req, res)
    if (!auth) return

    const idx = users.findIndex((u) => u.id === auth.userId)
    if (idx >= 0) {
      users[idx].sessionVersion = (users[idx].sessionVersion || 0) + 1
      await saveUser(users[idx])
    }

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
    await saveUser(users[idx])
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
    const { email, currentPassword, newPassword } = req.body
    
    // Normalize email to lowercase for consistent comparison
    const normalizedEmail = email.trim().toLowerCase()
    const u = users.find(u => u.email.toLowerCase() === normalizedEmail)
    if (!u) return res.status(404).json({ msg: 'Gebruiker niet gevonden' })

    const valid = await bcrypt.compare(currentPassword, u.password)
    if (!valid) return res.status(400).json({ msg: 'Huidig wachtwoord onjuist' })

    u.password = await bcrypt.hash(newPassword, 10)
    await saveUser(u)
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
    const trimmedName = requesterName.trim()
    const trimmedEmail = requesterEmail.trim().toLowerCase()
    const normalizedPaymentMethod = paymentMethod === 'paymentLink' ? 'paymentLink' : 'iban'
    const trimmedExpenseTitle = expenseTitle.trim()
    const trimmedDescription = description.toString().trim()
    const trimmedNotes = notes.toString().trim()
    const sanitizedIban = normalizedPaymentMethod === 'iban' ? sanitizeIban(iban) : ''
    const trimmedPaymentLink = normalizedPaymentMethod === 'paymentLink' ? paymentLink.trim() : ''
    const submittedAt = new Date()
    const amountNumber = Number.parseFloat(amount)
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
      const base64Content = String(attachment.content || '').trim()
      const declaredType = String(attachment.type || '').toLowerCase()
      const originalName = (attachment.name || `bijlage-${i + 1}`).toString()
      const safeName = originalName.trim() || `bijlage-${i + 1}.dat`

      if (!base64Content) {
        errors.push(`Bijlage ${i + 1} bevat geen gegevens.`)
        continue
      }

      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(declaredType)) {
        errors.push(`Bestandstype van bijlage ${safeName} wordt niet ondersteund.`)
        continue
      }

      let buffer
      try {
        buffer = Buffer.from(base64Content, 'base64')
      } catch {
        errors.push(`Bijlage ${safeName} kon niet worden gelezen.`)
        continue
      }

      if (!buffer || !buffer.length) {
        errors.push(`Bijlage ${safeName} bevat een leeg bestand.`)
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
        type: declaredType,
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

    const matchedUser = Number.isInteger(Number.parseInt(userId, 10))
      ? users.find((u) => u.id === Number.parseInt(userId, 10))
      : null

    const mailer = await ensureMailerTransport()
    if (!mailer) {
      return res.status(503).json({ msg: 'E-mailservice is tijdelijk niet beschikbaar.' })
    }

    const pdfBuffer = await buildPaymentRequestPdf({
      requesterName: trimmedName,
      requesterEmail: trimmedEmail,
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
    const subject = `Declaratie: ${trimmedName} – ${formattedAmount}`

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
                ? `Betaallink${trimmedPaymentLink ? ` – <a href="${escapeHtml(trimmedPaymentLink)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ''}`
                : `IBAN – ${escapeHtml(formatIban(sanitizedIban))}`}
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
      replyTo: `${trimmedName} <${trimmedEmail}>`,
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

// Manual trigger for daily snapshot comparison (admin only, for testing)
apiRouter.post('/admin/trigger-daily-snapshot', async (req, res) => {
  try {
    const { userId } = req.body
    if (!userId) return res.status(401).json({ msg: 'Authenticatie vereist' })
    if (!isUserAdmin(userId)) return res.status(403).json({ msg: 'Alleen beheerders' })
    
    await performDailySnapshotAndComparison()
    res.json({ msg: 'Daily snapshot comparison triggered successfully' })
  } catch (err) {
    console.error(err)
    logSystemError(err, { action: 'POST /api/admin/trigger-daily-snapshot', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Failed to trigger daily snapshot comparison' })
  }
})

// Public endpoint for Vercel Cron to process scheduled notifications
const handleCronNotifications = async (req, res) => {
  try {
    if (!isCronRequestAuthorized(req)) {
      warnLog('Unauthorized cron-notifications request attempt')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const sentIds = await processUserScheduledNotifications()
    res.status(200).json({ ok: true, sent: sentIds.length, sentIds })
  } catch (err) {
    console.error('Scheduled notifications cron failed:', err)
    logSystemError(err, { action: `${req.method} /api/cron-notifications`, status: 500 })
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: 'Failed to process scheduled notifications', message })
  }
}

apiRouter.get('/cron-notifications', handleCronNotifications)
apiRouter.post('/cron-notifications', handleCronNotifications)

// Public endpoint for Vercel Cron to trigger daily snapshot
const handleCronDaily = async (req, res) => {
  try {
    if (!isCronRequestAuthorized(req)) {
      warnLog('Unauthorized cron-daily request attempt')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    infoLog(`Daily snapshot cron triggered (${req.method})`)
    await performDailySnapshotAndComparison()
    res.status(200).json({ ok: true, message: 'Daily snapshot and comparison completed successfully' })
  } catch (err) {
    console.error('Daily snapshot cron failed:', err)
    logSystemError(err, { action: `${req.method} /api/cron-daily`, status: 500 })
    const message = err && err.message ? err.message : 'Unknown error'
    res.status(500).json({ error: 'Failed to run daily snapshot', message })
  }
}

apiRouter.get('/cron-daily', handleCronDaily)
apiRouter.post('/cron-daily', handleCronDaily)

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

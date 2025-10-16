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
import expressStaticGzip from 'express-static-gzip'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { MongoClient } from 'mongodb'
import { createRequestLogger, configureDailyReport, logError as logSystemError, logEvent } from './logger.js'

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
    { keys: { start: 1, isOpkomst: 1 }, options: { background: true, name: 'events_start_isOpkomst_idx' }, description: 'events start + isOpkomst' }
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
  const snapshotsCreated = await ensureCollectionIndexes(db.collection('dailySnapshots'), [
    { keys: { date: 1 }, options: { unique: true, background: true, name: 'snapshots_date_unique_idx' }, description: 'dailySnapshots.date unique' },
    { keys: { date: 1 }, options: { expireAfterSeconds: 30 * 24 * 60 * 60, background: true, name: 'snapshots_ttl_idx' }, description: 'dailySnapshots TTL (30 days)' }
  ])

  if (eventsCreated || usersCreated || resetCodesCreated || snapshotsCreated) {
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

// Tussenopslag gebruikers en evenementen
let users = []
let events = []
// Remove in-memory pendingReset as we'll use MongoDB
// const pendingReset = {}

// Gegevens inladen
async function loadUsers() {
  const db = await getDb()
  users = await db.collection('users')
    .find({})
    .project({ _id: 0 })
    .toArray()
  infoLog(`Loaded ${users.length} users from MongoDB`)
}

async function loadEvents() {
  const db = await getDb()
  events = await db.collection('events')
    .find({})
    .project({ _id: 0 })
    .toArray()
  infoLog(`Loaded ${events.length} events from MongoDB`)
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

async function deleteUserById(id) {
  const db = await getDb()
  await db.collection('users').deleteOne({ id })
}

async function saveEvent(event) {
  const db = await getDb()
  
  await db.collection('events').updateOne(
    { id: event.id },
    { $set: event },
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
    debugLog('Starting daily snapshot and comparison')
    
    // Create today's snapshot
    const todaySnapshot = await createDatabaseSnapshot()
    if (!todaySnapshot) {
      warnLog('Failed to create today\'s snapshot, skipping comparison')
      return
    }

    // Get today's and yesterday's date strings
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    
    const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Get yesterday's snapshot
    const yesterdaySnapshot = await getDailySnapshot(yesterdayStr)

    // Save today's snapshot
    await saveDailySnapshot(todayStr, todaySnapshot)

    // Compare snapshots if we have yesterday's data
    if (yesterdaySnapshot) {
      const changes = compareSnapshots(yesterdaySnapshot, todaySnapshot)
      const summary = formatChangesSummary(changes)
      
      if (summary) {
        // Send email notification
        if (!transporter) {
          warnLog('Daily changes summary skipped: transporter not available')
          return
        }

        await transporter.sendMail({
          from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.com',
          to: 'stamjer.mpd@gmail.com',
          subject: summary.subject,
          text: summary.text,
          html: summary.html
        })

        const totalChanges = hasNetChanges(changes) ? 
          changes.users.created.length + changes.users.updated.length + changes.users.deleted.length +
          changes.events.created.length + changes.events.updated.length + changes.events.deleted.length : 0

        infoLog(`Daily changes summary sent: ${totalChanges} net changes reported`)
        logEvent({ action: 'daily-changes-summary-sent', metadata: { changesCount: totalChanges } })
      } else {
        debugLog('No net changes detected, skipping email notification')
      }
    } else {
      infoLog('No previous snapshot found, daily comparison will start tomorrow')
    }

  } catch (error) {
    console.error('Failed to perform daily snapshot and comparison:', error)
    logSystemError(error, { action: 'perform-daily-snapshot-comparison', status: 500 })
  }
}

/**
 * Schedules the daily snapshot and comparison to run at midnight
 */
function scheduleDailySnapshot() {
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

// E-mail setup
let transporter
async function initMailer() {
  try {
    if (process.env.SMTP_SERVICE) {
      transporter = nodemailer.createTransport({
        service: process.env.SMTP_SERVICE,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        },
        tls: { rejectUnauthorized: false }
      })
    } else {
      const testAccount = await nodemailer.createTestAccount()
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      })
    }
    infoLog('Mail transporter initialised')
  } catch (err) {
    console.error('❌ Initialisatie mailer mislukt:', err)
    logSystemError(err, { action: 'initMailer', status: 500 })
  }
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

// Cold start
await loadUsers()
await loadEvents()
await initMailer()
configureDailyReport({
  sendEmail: async ({ subject, text, html }) => {
    if (!transporter) {
      warnLog('Daily report overgeslagen: transporter niet beschikbaar')
      return
    }
    try {
      await transporter.sendMail({
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
scheduleDailySnapshot() // Initialize daily database snapshot and comparison system

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

const allowedOriginEnv = process.env.CLIENT_ORIGIN || ''
const configuredOrigins = allowedOriginEnv.split(',').map(origin => origin.trim()).filter(Boolean)
const fallbackOrigins = ['http://localhost:5173', 'http://localhost:4173']

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

app.use(express.json({ limit: '1mb' }))
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
    
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'stamjer.mpd@gmail.coml',
      to: 'stamjer.mpd@gmail.com',
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
    const { userId, active } = req.body
    if (!userId) return res.status(400).json({ error: 'Gebruikers-ID is vereist' })
    const uid = parseInt(userId, 10)
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

// Evenementen ophalen
apiRouter.get('/events', (req, res) => {
  res.json({ events })
})

apiRouter.get('/events/opkomsten', (req, res) => {
  res.json({ events: events.filter(e => e.isOpkomst) })
})

// Evenement aanmaken
apiRouter.post('/events', async (req, res) => {
  try {
    const {
      title, start, end, allDay,
      location, description,
      isOpkomst, opkomstmakers,
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
    events[idx] = updated
    await saveEvent(updated)
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
    res.json({ user: { ...u, password: undefined } })
  } catch (err) {
    console.error('Login error details:', err)
    logSystemError(err, { action: 'POST /api/login', status: 500, metadata: req.body })
    res.status(500).json({ msg: 'Inloggen mislukt' })
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
      
      await transporter.sendMail({
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

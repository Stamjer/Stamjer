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
 * @author Stamjer Development Team
 * @version 1.1.0
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

  if (eventsCreated || usersCreated || resetCodesCreated) {
    infoLog('[indexes] Created or verified MongoDB indexes')
  }
}

async function ensureCollectionIndexes(collection, definitions) {
  const existingIndexes = await collection.indexes()
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
      infoLog(`🧹 Cleaned up ${result.deletedCount} expired reset codes`)
    }
  } catch (error) {
    warnLog('⚠️  Warning: Could not clean up expired reset codes:', error.message)
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
await cleanupExpiredResetCodes() // Clean up old reset codes on startup

// Express-app
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()

const allowedOriginEnv = process.env.CLIENT_ORIGIN || ''
const configuredOrigins = allowedOriginEnv.split(',').map(origin => origin.trim()).filter(Boolean)
const fallbackOrigins = ['http://localhost:5173', 'http://localhost:4173']
if (process.env.VERCEL_URL) {
  fallbackOrigins.push(`https://${process.env.VERCEL_URL}`)
}
const corsAllowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : fallbackOrigins
const allowAllLocalOrigins = !isProduction && configuredOrigins.length === 0

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true)
    }
    if (corsAllowedOrigins.includes(origin) || allowAllLocalOrigins) {
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
      role: u.role
    }))
    res.json(safeUsers)
  } catch (err) {
    console.error('Fout bij ophalen gebruikers:', err)
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
    const statusEmoji = newActiveStatus ? '✅' : '❌'
    
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@stamjer.nl',
      to: 'stamjer.mpd@gmail.com',
      subject: `Stamjer - Status wijziging: ${user.firstName} ${user.lastName}`,
      html: `
        <h2>${statusEmoji} Status wijziging</h2>
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
            <td style="padding: 8px; border: 1px solid #ddd;">${statusEmoji} ${statusText}</td>
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
    
    // Store previous active status to check if it changed
    const previousActiveStatus = users[idx].active
    
    if (typeof active === 'boolean') {
      users[idx].active = active
      
      // Send email notification if active status changed
      if (previousActiveStatus !== active) {
        await sendActiveStatusChangeEmail(users[idx], active)
      }
    }
    
    await saveUser(users[idx])
    res.json({ user: users[idx], msg: 'Profiel succesvol bijgewerkt' })
  } catch (err) {
    console.error(err)
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
      userId
    } = req.body
    if (!userId) return res.status(401).json({ msg: 'Authenticatie vereist' })
    if (!isUserAdmin(userId)) return res.status(403).json({ msg: 'Alleen beheerders' })
    if (!title || !start) return res.status(400).json({ msg: 'Titel en startdatum zijn vereist' })

    const id = Math.random().toString(36).substr(2, 6)
    const newEv = {
      id,
      title,
      start,
      end: end || start,
      allDay: !!allDay,
      location: location || '',
      description: description || '',
      isOpkomst: !!isOpkomst,
      opkomstmakers: opkomstmakers || '',
      participants: []
    }
    if (isOpkomst && title === 'Stam opkomst') {
      newEv.participants = users.filter(u => u.active).map(u => u.id)
    }
    events.push(newEv)
    await saveEvent(newEv)
    res.json(newEv)
  } catch (err) {
    console.error(err)
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
    if (attending && idx < 0) ev.participants.push(uid)
    if (!attending && idx >= 0) ev.participants.splice(idx, 1)
    await saveEvent(ev)
    res.json({ msg: 'Aanwezigheid bijgewerkt', event: ev })
  } catch (err) {
    console.error(err)
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
        from: process.env.SMTP_FROM || 'noreply@stamjer.nl',
        to: u.email, // Use original email for sending
        subject: 'Stamjer wachtwoordherstelcode',
        html: `<p>Je Stamjer-wachtwoordherstelcode: <strong>${code}</strong></p>`
      })
    }
    res.json({ msg: generic })
  } catch (err) {
    console.error(err)
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
    res.status(500).json({ msg: 'Wijzigen mislukt' })
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

const port = Number(process.env.PORT) || 3002

if (!process.env.VERCEL) {
  app.listen(port, () => {
    infoLog(`API server listening on port ${port}`)
  })
}

export default app

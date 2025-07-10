/**
 * ================================================================
 * STAMJER CALENDAR APPLICATION - BACKEND SERVER
 * ================================================================
 * 
 * This is the main backend server for the Stamjer calendar application.
 * It provides REST API endpoints for:
 * - User authentication (login, registration, password reset)
 * - Event management (CRUD operations)
 * - Email verification system
 * 
 * Built with Express.js and includes:
 * - Email verification for registration
 * - Password reset with secure codes
 * - File-based data storage (JSON files)
 * - Email sending via Nodemailer
 * 
 * @author Stamjer Development Team
 * @version 1.0.0
 */

// ================================================================
// IMPORTS AND DEPENDENCIES
// ================================================================

// Load environment variables from .env file
import 'dotenv/config'

// Core Express.js framework for building the REST API
import express from 'express'

// CORS middleware to allow cross-origin requests from frontend
import cors from 'cors'

// Nodemailer for sending emails (registration, password reset)
import nodemailer from 'nodemailer'

// Validator library for email validation and other input validation
import validator from 'validator'

// bcrypt for password hashing and comparison
import bcrypt from 'bcrypt'

// File system operations for reading/writing JSON data files
import fs from 'fs/promises'

// Path utilities for working with file paths in ES modules
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Static file serving with gzip compression for performance
import path from 'path'
import expressStaticGzip from 'express-static-gzip'

// ================================================================
// CONFIGURATION AND CONSTANTS
// ================================================================

/**
 * Setup __dirname for ES modules (ESM)
 */
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// File paths for data storage
const USERS_FILE  = join(__dirname, 'data', 'users.json')
const EVENTS_FILE = join(__dirname, 'data', 'events.json')

// ================================================================
// IN-MEMORY DATA STORAGE
// ================================================================

let users  = []  // Array to store user accounts
let events = []  // Array to store calendar events
const pendingReset = {}  // email -> { code, expiresAt }

// ================================================================
// DATA PERSISTENCE FUNCTIONS
// ================================================================

async function loadUsers() {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    users = Array.isArray(parsed.users) ? parsed.users : []
    console.log(`📂 Loaded ${users.length} users from file`)
  } catch (err) {
    if (err.code === 'ENOENT') {
      users = []
      console.log('📂 Users file not found, starting with empty array')
    } else {
      console.error('❌ Error loading users:', err)
    }
  }
}

async function saveUsers() {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2))
    console.log(`💾 Saved ${users.length} users to file`)
  } catch (err) {
    console.error('❌ Error saving users:', err)
  }
}

async function loadEvents() {
  try {
    const raw = await fs.readFile(EVENTS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    events = Array.isArray(parsed.events) ? parsed.events : []
    console.log(`📂 Loaded ${events.length} events from file`)
  } catch (err) {
    if (err.code === 'ENOENT') {
      events = []
      console.log('📂 Events file not found, starting with empty array')
    } else {
      console.error('❌ Error loading events:', err)
    }
  }
}

async function saveEvents() {
  try {
    await fs.writeFile(EVENTS_FILE, JSON.stringify({ events }, null, 2))
    console.log(`💾 Saved ${events.length} events to file`)
  } catch (err) {
    console.error('❌ Error saving events:', err)
  }
}

// ================================================================
// EMAIL CONFIGURATION AND SETUP
// ================================================================

let transporter

async function initMailer() {
  try {
    if (process.env.SMTP_SERVICE) {
      console.log('📧 Setting up production SMTP...')
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
    console.log('✅ Email transporter initialized successfully')
  } catch (err) {
    console.error('❌ Failed to initialize email transporter:', err)
  }
}

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// ================================================================
// AUTHENTICATION MIDDLEWARE
// ================================================================

function isUserAdmin(userId) {
  const user = users.find(u => u.id === parseInt(userId))
  return user && user.isAdmin
}

function calculateStreepjes() {
  const streepjesCount = {}
  users.forEach(user => {
    streepjesCount[user.id] = 0
  })
  events.forEach(event => {
    if (event.isOpkomst && event.attendance) {
      Object.entries(event.attendance).forEach(([uid, attendance]) => {
        const userIdNumber = parseInt(uid)
        const isParticipant = event.participants.includes(userIdNumber)
        const shouldGetStreepje = (isParticipant && attendance.absent)
                             || (!isParticipant && attendance.present)
        if (shouldGetStreepje) {
          streepjesCount[userIdNumber] = (streepjesCount[userIdNumber] || 0) + 1
        }
      })
    }
  })
  return streepjesCount
}

// ─────────────────────────────────────────────────────────────────
// Serverless cold-start: load data & init mailer once per instance
// ─────────────────────────────────────────────────────────────────

await loadUsers()
await loadEvents()
await initMailer()

// Create Express app (all setup follows)
const app = express()

// ================================================================
// EXPRESS APP SETUP
// ================================================================
app.use(cors())
app.use(express.json())

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  if (req.body && Object.keys(req.body).length) {
    console.log('Body:', req.body)
  }
  next()
})

// CORS headers for password endpoints
app.use('/forgot-password', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})
app.use('/reset-password', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

// ================================================================
// STATIC FILE SERVING
// ================================================================
app.use(
  '/',
  expressStaticGzip(path.join(__dirname, 'dist'), {
    enableBrotli: true,
    orderPreference: ['br', 'gz']
  })
)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// ================================================================
// API ROUTES
// ================================================================

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ msg: 'API proxy works!' })
})

// Debug reset codes (dev only)
app.get('/debug/reset-codes', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ msg: 'Niet gevonden' })
  }
  const activeCodes = Object.entries(pendingReset).map(([email, data]) => ({
    email,
    code: data.code,
    expiresAt: new Date(data.expiresAt).toLocaleString(),
    isExpired: Date.now() > data.expiresAt
  }))
  res.json({ msg: 'Active reset codes', codes: activeCodes, totalUsers: users.length })
})

// Users endpoints
app.get('/users', (req, res) => {
  const usersForDropdown = users.map(u => ({ id: u.id, firstName: u.firstName }))
  res.json({ users: usersForDropdown })
})
app.get('/users/full', (req, res) => {
  const streepjesCount = calculateStreepjes()
  const usersFullInfo = users.map(u => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    active: u.active,
    isAdmin: u.isAdmin || false,
    streepjes: streepjesCount[u.id] || 0
  }))
  res.json({ users: usersFullInfo })
})
app.put('/user/profile', async (req, res) => {
  try {
    const { userId, active } = req.body
    if (!userId) return res.status(400).json({ error: 'User ID is required' })
    const uid = parseInt(userId, 10)
    if (isNaN(uid)) return res.status(400).json({ error: 'Invalid user ID format' })
    const idx = users.findIndex(u => u.id === uid)
    if (idx === -1) return res.status(404).json({ error: 'Gebruiker niet gevonden' })
    if (typeof active === 'boolean') users[idx].active = active
    await saveUsers()
    const u = users[idx]
    res.json({ msg: 'Profile updated successfully', user: { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, active: u.active, isAdmin: u.isAdmin || false } })
  } catch (err) {
    console.error('❌ Error updating user profile:', err)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})
app.put('/events/:id/attendance/bulk', async (req, res) => {
  try {
    const eventId = req.params.id
    const { attendance } = req.body
    if (!eventId) return res.status(400).json({ error: 'Event ID is required' })
    if (!attendance || typeof attendance !== 'object') return res.status(400).json({ error: 'Valid attendance data is required' })
    const idx = events.findIndex(e => e.id === eventId)
    if (idx === -1) return res.status(404).json({ error: 'Event not found' })
    events[idx].attendance = attendance
    await saveEvents()
    res.json({ msg: 'Attendance updated successfully', event: events[idx] })
  } catch (err) {
    console.error('❌ Error updating event attendance:', err)
    res.status(500).json({ error: 'Failed to update attendance' })
  }
})

// Events endpoints
app.get('/events', (req, res) => {
  res.json({ events })
})
app.get('/events/opkomsten', (req, res) => {
  const opkomsten = events.filter(e => e.isOpkomst)
  res.json({ events: opkomsten })
})
app.post('/events', async (req, res) => {
  try {
    const { title, start, end, allDay, location, description, isOpkomst, opkomstmakers, userId } = req.body
    if (!userId) return res.status(401).json({ msg: 'Authenticatie vereist. Gebruiker ID ontbreekt.' })
    if (!isUserAdmin(userId)) return res.status(403).json({ msg: 'Alleen admins kunnen evenementen aanmaken.' })
    if (!title || !start) return res.status(400).json({ msg: 'Titel en startdatum zijn verplicht.' })
    const newEvent = {
      id: Math.random().toString(36).substr(2, 4),
      title,
      start,
      end: end || start,
      allDay: allDay || false,
      location: location || '',
      description: description|| '',
      isOpkomst: isOpkomst || false,
      opkomstmakers: opkomstmakers || ''
    }
    if (isOpkomst && title === 'Stam opkomst') {
      const activeUsers = users.filter(u => u.active)
      newEvent.participants = activeUsers.map(u => u.id)
    }
    events.push(newEvent)
    await saveEvents()
    res.json(newEvent)
  } catch (err) {
    console.error('❌ Error creating event:', err)
    res.status(500).json({ msg: 'Er is een fout opgetreden bij het aanmaken van het event.' })
  }
})
app.put('/events/:id', async (req, res) => {
  try {
    const id = req.params.id
    const { title, start, end, allDay, location, description, isOpkomst, opkomstmakers, userId } = req.body
    if (!userId) return res.status(401).json({ msg: 'Authenticatie vereist. Gebruiker ID ontbreekt.' })
    if (!isUserAdmin(userId)) return res.status(403).json({ msg: 'Alleen admins kunnen evenementen bewerken.' })
    const idx = events.findIndex(e => e.id === id)
    if (idx === -1) return res.status(404).json({ msg: 'Event niet gevonden.' })
    if (!title || !start) return res.status(400).json({ msg: 'Titel en startdatum zijn verplicht.' })
    events[idx] = {
      ...events[idx],
      title,
      start,
      end: end || start,
      allDay: allDay || false,
      location: location || '',
      description: description || '',
      isOpkomst: isOpkomst || false,
      opkomstmakers: opkomstmakers || ''
    }
    await saveEvents()
    res.json(events[idx])
  } catch (err) {
    console.error('❌ Error updating event:', err)
    res.status(500).json({ msg: 'Er is een fout opgetreden bij het bewerken van het event.' })
  }
})
app.delete('/events/:id', async (req, res) => {
  try {
    const id = req.params.id
    const { userId } = req.body
    if (!userId) return res.status(401).json({ msg: 'Authenticatie vereist. Gebruiker ID ontbreekt.' })
    if (!isUserAdmin(userId)) return res.status(403).json({ msg: 'Alleen admins kunnen evenementen verwijderen.' })
    const idx = events.findIndex(e => e.id === id)
    if (idx === -1) return res.status(404).json({ msg: 'Event niet gevonden.' })
    const deleted = events.splice(idx, 1)[0]
    await saveEvents()
    res.json({ msg: 'Event succesvol verwijderd.' })
  } catch (err) {
    console.error('❌ Error deleting event:', err)
    res.status(500).json({ msg: 'Er is een fout opgetreden bij het verwijderen van het event.' })
  }
})
app.put('/events/:id/attendance', async (req, res) => {
  try {
    const id = req.params.id
    const { userId, attending } = req.body
    if (!userId) return res.status(400).json({ msg: 'User ID is required' })
    if (typeof attending !== 'boolean') return res.status(400).json({ msg: 'Attending must be a boolean value' })
    const idx = events.findIndex(e => e.id === id)
    if (idx === -1) return res.status(404).json({ msg: 'Event niet gevonden.' })
    const event = events[idx]
    if (!event.isOpkomst) return res.status(400).json({ msg: 'Dit is geen opkomst event.' })
    if (!event.participants) event.participants = []
    const pi = event.participants.indexOf(userId)
    if (attending && pi === -1) {
      event.participants.push(userId)
    } else if (!attending && pi > -1) {
      event.participants.splice(pi, 1)
    }
    await saveEvents()
    res.json({ msg: 'Aanwezigheid bijgewerkt.', event })
  } catch (err) {
    console.error('❌ Error updating attendance:', err)
    res.status(500).json({ msg: 'Er is een fout opgetreden bij het bijwerken van de aanwezigheid.' })
  }
})

// Authentication
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ msg: 'E-mailadres en wachtwoord zijn verplicht.' })
    const u = users.find(u => u.email === email)
    if (!u) return res.status(400).json({ msg: 'E-mailadres niet gevonden.' })
    let match = false
    if (u.password.startsWith('$2b$')) {
      match = await bcrypt.compare(password, u.password)
    } else {
      match = u.password === password
      if (match) {
        u.password = await bcrypt.hash(password, 10)
        await saveUsers()
      }
    }
    if (!match) return res.status(400).json({ msg: 'Wachtwoord is onjuist.' })
    res.json({ msg: 'Ingelogd.', user: { id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, active: u.active, isAdmin: u.isAdmin || false } })
  } catch (err) {
    console.error('❌ Login error:', err)
    res.status(500).json({ msg: 'Er is een interne fout opgetreden bij het inloggen.' })
  }
})

app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ msg: 'E-mailadres is verplicht.' })
    if (!validator.isEmail(email)) return res.status(400).json({ msg: 'Ongeldig e-mailadres.' })
    const genericMsg = 'Als dit e-mailadres bekend is, ontvang je binnen enkele minuten een resetcode.'
    const u = users.find(u => u.email === email)
    if (u) {
      const code = generateCode()
      const expiresAt = Date.now() + 15 * 60 * 1000
      pendingReset[email] = { code, expiresAt }
      try {
        const info = await transporter.sendMail({
          from: process.env.SMTP_FROM || 'noreply@stamjer.nl',
          to: email,
          subject: 'Stamjer - Wachtwoord Reset Code',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2c3e50;">Wachtwoord Reset Aanvraag</h2>
              <p>Hallo ${u.firstName},</p>
              <p>Je hebt een wachtwoord reset aangevraagd voor je Stamjer account.</p>
              <div style="background-color: #f8f9fa; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="letter-spacing: 0.3em; color: #007bff; margin: 0;">${code}</h1>
              </div>
              <p><strong>Deze code is 15 minuten geldig.</strong></p>
              <p>Als je deze aanvraag niet hebt gedaan, kun je deze e-mail negeren.</p>
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
              <p style="color: #6c757d; font-size: 14px;">
                Met vriendelijke groet,<br/>
                Het Stamjer Team
              </p>
            </div>
          `
        })
        const preview = nodemailer.getTestMessageUrl(info)
        if (preview) console.log('📧 Reset Preview mail:', preview)
      } catch (err) {
        console.error('⛔ Reset Mail-error:', err)
        return res.status(500).json({ msg: 'Er is een fout opgetreden bij het versturen van de e-mail.' })
      }
    }
    res.json({ msg: genericMsg })
  } catch (err) {
    console.error('❌ Forgot password error:', err)
    res.status(500).json({ msg: 'Er is een interne fout opgetreden.' })
  }
})

app.post('/reset-password', async (req, res) => {
  try {
    const { email, code, password } = req.body
    if (!email || !code || !password) return res.status(400).json({ msg: 'Alle velden zijn verplicht.' })
    if (!validator.isEmail(email)) return res.status(400).json({ msg: 'Ongeldig e-mailadres.' })
    if (password.length < 6) return res.status(400).json({ msg: 'Wachtwoord moet minimaal 6 karakters bevatten.' })
    const record = pendingReset[email]
    if (!record) return res.status(400).json({ msg: 'Geen geldig resetverzoek gevonden voor dit e-mailadres.' })
    if (Date.now() > record.expiresAt) {
      delete pendingReset[email]
      return res.status(400).json({ msg: 'De resetcode is verlopen. Vraag een nieuwe code aan.' })
    }
    if (record.code !== code) return res.status(400).json({ msg: 'Onjuiste resetcode. Controleer de code en probeer opnieuw.' })
    const idx = users.findIndex(u => u.email === email)
    if (idx === -1) {
      delete pendingReset[email]
      return res.status(400).json({ msg: 'Gebruiker niet gevonden.' })
    }
    users[idx].password = await bcrypt.hash(password, 10)
    delete pendingReset[email]
    await saveUsers()
    res.json({ msg: 'Wachtwoord succesvol gewijzigd. Je kunt nu inloggen met je nieuwe wachtwoord.' })
  } catch (err) {
    console.error('❌ Reset password error:', err)
    res.status(500).json({ msg: 'Er is een interne fout opgetreden bij het resetten van het wachtwoord.' })
  }
})

app.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword, email } = req.body
    if (!currentPassword || !newPassword) return res.status(400).json({ msg: 'Huidig wachtwoord en nieuw wachtwoord zijn verplicht.' })
    if (newPassword.length < 6) return res.status(400).json({ msg: 'Nieuw wachtwoord moet minimaal 6 karakters bevatten.' })
    if (!email) return res.status(400).json({ msg: 'E-mailadres is verplicht.' })
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase())
    if (!user) return res.status(404).json({ msg: 'Gebruiker niet gevonden.' })
    let valid = false
    if (user.password.startsWith('$2b$')) {
      valid = await bcrypt.compare(currentPassword, user.password)
    } else {
      valid = user.password === currentPassword
      if (valid) {
        user.password = await bcrypt.hash(currentPassword, 10)
        await saveUsers()
      }
    }
    if (!valid) return res.status(400).json({ msg: 'Huidig wachtwoord is onjuist.' })
    user.password = await bcrypt.hash(newPassword, 10)
    await saveUsers()
    res.json({ msg: 'Wachtwoord succesvol gewijzigd.' })
  } catch (err) {
    console.error('❌ Change password error:', err)
    res.status(500).json({ msg: 'Er is een interne fout opgetreden bij het wijzigen van het wachtwoord.' })
  }
})

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Stamjer Calendar API Server',
    status: 'Running',
    version: '1.0.0',
    frontend_url: 'http://localhost:5173',
    api_endpoints: {
      authentication: ['POST /login','POST /forgot-password','POST /reset-password','POST /change-password'],
      events: ['GET /events','POST /events','PUT /events/:id','DELETE /events/:id'],
      debug: ['GET /test','GET /debug/reset-codes']
    }
  })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ msg: `Route niet gevonden: ${req.method} ${req.originalUrl}` })
})

export default app

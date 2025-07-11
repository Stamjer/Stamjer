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

async function getDb() {
  const client = await clientPromise
  return client.db('Stamjer')
}

// Tussenopslag gebruikers en evenementen
let users = []
let events = []
const pendingReset = {}

// Gegevens inladen
async function loadUsers() {
  const db = await getDb()
  users = await db.collection('users')
    .find({})
    .project({ _id: 0 })
    .toArray()
  console.log(`📂 ${users.length} gebruikers geladen vanuit MongoDB`)
}

async function loadEvents() {
  const db = await getDb()
  events = await db.collection('events')
    .find({})
    .project({ _id: 0 })
    .toArray()
  console.log(`📂 ${events.length} evenementen geladen vanuit MongoDB`)
}

async function saveUser(user) {
  const db = await getDb()
  await db.collection('users').updateOne(
    { id: user.id },
    { $set: user },
    { upsert: true }
  )
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
    console.log('✅ E-mailtransporter is gestart')
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

function calculateStreepjes() {
  const counts = {}
  users.forEach(u => { counts[u.id] = 0 })
  events.forEach(ev => {
    if (ev.isOpkomst && ev.attendance) {
      Object.entries(ev.attendance).forEach(([uid, a]) => {
        const idNum = parseInt(uid, 10)
        const isPart = ev.participants?.includes(idNum)
        const wrong = (isPart && a.absent) || (!isPart && a.present)
        if (wrong) counts[idNum]++
      })
    }
  })
  return counts
}

// Cold start
await loadUsers()
await loadEvents()
await initMailer()

// Express-app
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json())

// Request-logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`)
  if (req.body && Object.keys(req.body).length) {
    console.log('Body:', req.body)
  }
  next()
})

// CORS voor reset-endpoints
;['/forgot-password', '/reset-password'].forEach(route => {
  app.use(route, (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'POST,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })
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

// Profiel bijwerken
apiRouter.put('/user/profile', async (req, res) => {
  try {
    const { userId, active } = req.body
    if (!userId) return res.status(400).json({ error: 'Gebruikers-ID is vereist' })
    const uid = parseInt(userId, 10)
    const idx = users.findIndex(u => u.id === uid)
    if (idx < 0) return res.status(404).json({ error: 'Gebruiker niet gevonden' })
    if (typeof active === 'boolean') users[idx].active = active
    await saveUser(users[idx])
    res.json({ user: users[idx] })
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
    const u = users.find(u => u.email === email)
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
    const { email } = req.body
    if (!email || !validator.isEmail(email))
      return res.status(400).json({ msg: 'Ongeldig e-mailadres' })

    const u = users.find(u => u.email === email)
    const generic = 'Als het e-mailadres bestaat, ontvang je een herstelcode via e-mail.'
    if (u) {
      const code = generateCode()
      pendingReset[email] = { code, expiresAt: Date.now() + 15 * 60 * 1000 }
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@stamjer.nl',
        to: email,
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
    const { email, code, password } = req.body
    const rec = pendingReset[email]
    if (!rec || rec.code !== code || Date.now() > rec.expiresAt)
      return res.status(400).json({ msg: 'Ongeldige of verlopen herstelcode' })

    const idx = users.findIndex(u => u.email === email)
    if (idx < 0) return res.status(400).json({ msg: 'Gebruiker niet gevonden' })

    users[idx].password = await bcrypt.hash(password, 10)
    await saveUser(users[idx])
    delete pendingReset[email]
    res.json({ msg: 'Wachtwoord succesvol gereset' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ msg: 'Wachtwoordherstel mislukt' })  
  }
})

// Wachtwoord wijzigen
apiRouter.post('/change-password', async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body
    const u = users.find(u => u.email === email)
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

export default app

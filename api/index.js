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
 * Built with Express.js and MongoDB Atlas, includes:
 * - Email verification for registration
 * - Password reset with secure codes
 * - MongoDB storage for users and events
 * - Email sending via Nodemailer
 * 
 * @author Stamjer Development Team
 * @version 1.0.0
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

// mongodb setup
const uri = process.env.MONGODB_URI
if (!uri) throw new Error('Missing MONGODB_URI in environment')

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

// in-memory data and temp storage
let users = []
let events = []
const pendingReset = {}

// data loaders
async function loadUsers() {
  const db = await getDb()
  users = await db.collection('users')
    .find({})
    .project({ _id: 0 })
    .toArray()
  console.log(`📂 Loaded ${users.length} users from MongoDB`)
}

async function loadEvents() {
  const db = await getDb()
  events = await db.collection('events')
    .find({})
    .project({ _id: 0 })
    .toArray()
  console.log(`📂 Loaded ${events.length} events from MongoDB`)
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

// email setup
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
    console.log('✅ Email transporter initialized')
  } catch (err) {
    console.error('❌ Mailer init failed:', err)
  }
}

// utility
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

// cold start
await loadUsers()
await loadEvents()
await initMailer()

// express app
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json())

// request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`)
  if (req.body && Object.keys(req.body).length) {
    console.log('Body:', req.body)
  }
  next()
})

// cors for reset endpoints
;['/forgot-password', '/reset-password'].forEach(route => {
  app.use(route, (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'POST,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })
})

// create api router
const apiRouter = express.Router()

// simple test
apiRouter.get('/test', (req, res) => {
  res.json({ msg: 'API ok' })
})

// debug reset codes (dev only)
apiRouter.get('/debug/reset-codes', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).end()
  const codes = Object.entries(pendingReset).map(([email, d]) => ({
    email,
    code: d.code,
    expiresAt: new Date(d.expiresAt).toLocaleString(),
    expired: Date.now() > d.expiresAt
  }))
  res.json({ codes, totalUsers: users.length })
})

// USERS
apiRouter.get('/users', async (req, res) => {
  try {
    if (users.length === 0) await loadUsers()
    const safeUsers = users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role
    }))
    res.json(safeUsers)
  } catch (err) {
    console.error('Error fetching users:', err)
    res.status(500).json({ error: 'Failed to fetch users', message: err.message })
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

apiRouter.put('/user/profile', async (req, res) => {
  try {
    const { userId, active } = req.body
    if (!userId) return res.status(400).json({ error: 'User ID required' })
    const uid = parseInt(userId, 10)
    const idx = users.findIndex(u => u.id === uid)
    if (idx < 0) return res.status(404).json({ error: 'User not found' })
    if (typeof active === 'boolean') users[idx].active = active
    await saveUser(users[idx])
    res.json({ user: users[idx] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Profile update failed' })
  }
})

// EVENTS
apiRouter.get('/events', (req, res) => {
  res.json({ events })
})

apiRouter.get('/events/opkomsten', (req, res) => {
  res.json({ events: events.filter(e => e.isOpkomst) })
})

apiRouter.post('/events', async (req, res) => {
  try {
    const {
      title, start, end, allDay,
      location, description,
      isOpkomst, opkomstmakers,
      userId
    } = req.body
    if (!userId) return res.status(401).json({ msg: 'Auth required' })
    if (!isUserAdmin(userId)) return res.status(403).json({ msg: 'Admins only' })
    if (!title || !start) return res.status(400).json({ msg: 'Title+start required' })

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
    res.status(500).json({ msg: 'Create event failed' })
  }
})

apiRouter.put('/events/:id', async (req, res) => {
  try {
    const { id } = req.params
    const idx = events.findIndex(e => e.id === id)
    if (idx < 0) return res.status(404).json({ msg: 'Not found' })
    const updated = { ...events[idx], ...req.body }
    events[idx] = updated
    await saveEvent(updated)
    res.json(updated)
  } catch (err) {
    console.error(err)
    res.status(500).json({ msg: 'Update failed' })
  }
})

apiRouter.delete('/events/:id', async (req, res) => {
  try {
    const { id } = req.params
    const idx = events.findIndex(e => e.id === id)
    if (idx < 0) return res.status(404).json({ msg: 'Not found' })
    const [removed] = events.splice(idx, 1)
    await deleteEventById(id)
    res.json({ msg: 'Deleted', event: removed })
  } catch (err) {
    console.error(err)
    res.status(500).json({ msg: 'Delete failed' })
  }
})

apiRouter.put('/events/:id/attendance', async (req, res) => {
  try {
    const { id, userId, attending } = { ...req.params, ...req.body }
    const ev = events.find(e => e.id === id)
    if (!ev) return res.status(404).json({ msg: 'Not found' })
    if (!ev.participants) ev.participants = []
    const uid = parseInt(userId, 10)
    const idx = ev.participants.indexOf(uid)
    if (attending && idx < 0) ev.participants.push(uid)
    if (!attending && idx >= 0) ev.participants.splice(idx, 1)
    await saveEvent(ev)
    res.json({ msg: 'Attendance updated', event: ev })
  } catch (err) {
    console.error(err)
    res.status(500).json({ msg: 'Attendance failed' })
  }
})

// AUTH
apiRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ msg: 'Missing creds' })
    const u = users.find(u => u.email === email)
    if (!u) return res.status(400).json({ msg: 'Not found' })

    const match = u.password.startsWith('$2b$')
      ? await bcrypt.compare(password, u.password)
      : (u.password === password && await (async () => {
          u.password = await bcrypt.hash(password, 10)
          await saveUser(u)
        })())

    if (!match) return res.status(400).json({ msg: 'Wrong pwd' })
    res.json({ user: { ...u, password: undefined } })
  } catch (err) {
    console.error('Login error details:', err)
    res.status(500).json({ msg: 'Login failed' })
  }
})

apiRouter.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body
    if (!email || !validator.isEmail(email))
      return res.status(400).json({ msg: 'Invalid email' })

    const u = users.find(u => u.email === email)
    const generic = 'Als het email bestaat ontvang je een code.'
    if (u) {
      const code = generateCode()
      pendingReset[email] = { code, expiresAt: Date.now() + 15 * 60 * 1000 }
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@stamjer.nl',
        to: email,
        subject: 'Stamjer reset code',
        html: `<p>Code: <strong>${code}</strong></p>`
      })
    }
    res.json({ msg: generic })
  } catch (err) {
    console.error(err)
    res.status(500).json({ msg: 'Forgot failed' })
  }
})

apiRouter.post('/reset-password', async (req, res) => {
  try {
    const { email, code, password } = req.body
    const rec = pendingReset[email]
    if (!rec || rec.code !== code || Date.now() > rec.expiresAt)
      return res.status(400).json({ msg: 'Invalid or expired code' })

    const idx = users.findIndex(u => u.email === email)
    if (idx < 0) return res.status(400).json({ msg: 'User not found' })

    users[idx].password = await bcrypt.hash(password, 10)
    await saveUser(users[idx])
    delete pendingReset[email]
    res.json({ msg: 'Password reset' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ msg: 'Reset failed' })  
  }
})

apiRouter.post('/change-password', async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body
    const u = users.find(u => u.email === email)
    if (!u) return res.status(404).json({ msg: 'User not found' })

    const valid = await bcrypt.compare(currentPassword, u.password)
    if (!valid) return res.status(400).json({ msg: 'Wrong current password' })

    u.password = await bcrypt.hash(newPassword, 10)
    await saveUser(u)
    res.json({ msg: 'Password changed' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ msg: 'Change failed' })
  }
})

// mount the API routes
app.use('/api', apiRouter)

// serve static assets
app.use(
  '/',
  expressStaticGzip(
    path.join(__dirname, '..', 'dist'),
    {
      enableBrotli: true,
      orderPreference: ['br', 'gz']
    }
  )
)

// catch-all for SPA routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'))
})

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ msg: 'Not found' })
})

export default app

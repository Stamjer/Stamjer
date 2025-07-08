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

// DNS lookup for email domain verification
import dns from 'dns/promises'

// File system operations for reading/writing JSON data files
import fs from 'fs/promises'

// Path utilities for working with file paths in ES modules
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// ================================================================
// CONFIGURATION AND CONSTANTS
// ================================================================

/**
 * Setup __dirname for ES modules (ESM)
 * In ES modules, __dirname is not available by default,
 * so we need to recreate it using import.meta.url
 */
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// File paths for data storage
const USERS_FILE = join(__dirname, 'data', 'users.json')
const EVENTS_FILE = join(__dirname, 'data', 'events.json')

// ================================================================
// IN-MEMORY DATA STORAGE
// ================================================================

/**
 * In-memory storage for application data
 * These arrays hold the current state of users and events
 * Data is loaded from JSON files on startup and saved back when modified
 */
let users = []  // Array to store user accounts
let events = [] // Array to store calendar events

/**
 * Temporary storage for pending operations
 * These objects store verification codes and expiration times
 * Keys are email addresses, values contain verification data
 */
const pendingReset = {}     // email → { code, expiresAt }

// ================================================================
// DATA PERSISTENCE FUNCTIONS
// ================================================================

/**
 * Load users from the JSON file
 * This function reads the users.json file and populates the users array
 * If the file doesn't exist, it initializes an empty array
 */
async function loadUsers() {
  try {
    // Read the raw JSON data from file
    const raw = await fs.readFile(USERS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    
    // Ensure we have a valid users array
    users = Array.isArray(parsed.users) ? parsed.users : []
    console.log(`📂 Loaded ${users.length} users from file`)
  } catch (err) {
    // If file doesn't exist, start with empty array
    if (err.code === 'ENOENT') {
      users = []
      console.log('📂 Users file not found, starting with empty array')
    } else {
      console.error('❌ Error loading users:', err)
    }
  }
}

/**
 * Save users to the JSON file
 * This function writes the current users array back to the JSON file
 */
async function saveUsers() {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2))
    console.log(`💾 Saved ${users.length} users to file`)
  } catch (err) {
    console.error('❌ Error saving users:', err)
  }
}

/**
 * Load events from the JSON file
 * This function reads the events.json file and populates the events array
 * If the file doesn't exist, it initializes an empty array
 */
async function loadEvents() {
  try {
    // Read the raw JSON data from file
    const raw = await fs.readFile(EVENTS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    
    // Ensure we have a valid events array
    events = Array.isArray(parsed.events) ? parsed.events : []
    console.log(`📂 Loaded ${events.length} events from file`)
  } catch (err) {
    // If file doesn't exist, start with empty array
    if (err.code === 'ENOENT') {
      events = []
      console.log('📂 Events file not found, starting with empty array')
    } else {
      console.error('❌ Error loading events:', err)
    }
  }
}

/**
 * Save events to the JSON file
 * This function writes the current events array back to the JSON file
 */
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

/**
 * Global variable to store the configured email transporter
 * This will be initialized based on environment variables
 */
let transporter

/**
 * Initialize the email transporter
 * This function sets up Nodemailer with either:
 * 1. Production SMTP settings (if SMTP_SERVICE is configured)
 * 2. Ethereal test account (for development/testing)
 */
async function initMailer() {
  try {
    // Check if production SMTP is configured
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

/**
 * Generate a 6-digit verification code
 * Used for email verification and password reset
 * @returns {string} A 6-digit numeric code as a string
 */
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// ================================================================
// AUTHENTICATION MIDDLEWARE
// ================================================================

/**
 * Middleware to check if user is authenticated and has admin privileges
 * For now, this is simplified - in a real app you'd use JWT tokens
 */
function requireAdmin(req, res, next) {
  const { userId } = req.body
  
  if (!userId) {
    return res.status(401).json({ msg: 'Authenticatie vereist. Gebruiker ID ontbreekt.' })
  }
  
  // Find user by ID
  const user = users.find(u => u.id === parseInt(userId))
  
  if (!user) {
    return res.status(401).json({ msg: 'Gebruiker niet gevonden.' })
  }
  
  if (!user.isAdmin) {
    return res.status(403).json({ msg: 'Admin rechten vereist voor deze actie.' })
  }
  
  // Add user to request for use in route handlers
  req.user = user
  next()
}

/**
 * Helper function to check if user is admin by ID
 */
function isUserAdmin(userId) {
  const user = users.find(u => u.id === parseInt(userId))
  return user && user.isAdmin
}

// ================================================================
// MAIN SERVER INITIALIZATION
// ================================================================

/**
 * Main function to initialize and start the Express server
 * This function:
 * 1. Loads data from JSON files
 * 2. Initializes email transporter
 * 3. Sets up Express app with middleware and routes
 * 4. Starts the server
 */
async function startServer() {
  try {
    // ============================================================
    // STARTUP SEQUENCE
    // ============================================================
    console.log('🚀 Starting Stamjer Calendar Server...')
    
    // Load persistent data from JSON files
    await loadUsers()
    await loadEvents()
    await initMailer()

    // ============================================================
    // EXPRESS APP SETUP
    // ============================================================
    console.log('⚙️ Setting up Express application...')
    
    // Create Express application instance
    const app = express()
    
    // Enable CORS (Cross-Origin Resource Sharing) for frontend communication
    app.use(cors())
    
    // Parse JSON request bodies (important for API endpoints)
    app.use(express.json())

    // ============================================================
    // MIDDLEWARE FOR LOGGING AND DEBUGGING
    // ============================================================
    
    /**
     * Request logging middleware
     * Logs all incoming requests for debugging purposes
     * This helps track API usage and troubleshoot issues
     */
    app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
      console.log('Headers:', req.headers)
      if (req.body && Object.keys(req.body).length > 0) {
        console.log('Body:', req.body)
      }
      next()
    })

    // ============================================================
    // CORS HEADERS FOR SPECIFIC ENDPOINTS
    // ============================================================
    
    /**
     * Additional CORS middleware for forgot password endpoints
     * These endpoints need explicit CORS headers for cross-origin requests
     */
    app.use('/forgot-password', (req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      // Handle preflight OPTIONS requests
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200)
      }
      next()
    })

    /**
     * Additional CORS middleware for reset password endpoints
     */
    app.use('/reset-password', (req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      // Handle preflight OPTIONS requests
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200)
      }
      next()
    })

    // ============================================================
    // API ROUTES AND ENDPOINTS
    // ============================================================

    // ────────────────────────────────────────────────────────────
    // TEST AND DEBUG ENDPOINTS
    // ────────────────────────────────────────────────────────────
    
    /**
     * Simple test endpoint to verify API connectivity
     * GET /test
     */
    app.get('/test', (req, res) => {
      res.json({ msg: 'API proxy works!' })
    })

    /**
     * Debug endpoint for development - shows active reset codes
     * GET /debug/reset-codes
     * Only available in non-production environments for security
     */
    app.get('/debug/reset-codes', (req, res) => {
      // Security: Only allow in development mode
      if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ msg: 'Niet gevonden' })
      }
      
      // Create summary of all active reset codes
      const activeCodes = Object.entries(pendingReset).map(([email, data]) => ({
        email,
        code: data.code,
        expiresAt: new Date(data.expiresAt).toLocaleString(),
        isExpired: Date.now() > data.expiresAt
      }))
      
      res.json({ 
        msg: 'Active reset codes (development only)',
        codes: activeCodes,
        totalUsers: users.length
      })
    })

    // ────────────────────────────────────────────────────────────
    // USERS MANAGEMENT ENDPOINTS
    // ────────────────────────────────────────────────────────────
    
    /**
     * Get all users (for opkomstmakers dropdown)
     * GET /users
     * Returns all users with only firstName and id
     */
    app.get('/users', (req, res) => {
      console.log('👥 Fetching all users for opkomstmakers, count:', users.length)
      // Return only firstName and id for privacy and simplicity
      const usersForDropdown = users.map(user => ({
        id: user.id,
        firstName: user.firstName
      }))
      res.json({ users: usersForDropdown })
    })

    /**
     * Get all users with full information
     * GET /users/full
     * Returns full user data including active status
     */
    app.get('/users/full', (req, res) => {
      console.log('👥 Fetching all users with full info, count:', users.length)
      // Return full user data (excluding passwords for security)
      const usersFullInfo = users.map(user => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        active: user.active,
        isAdmin: user.isAdmin || false
      }))
      res.json({ users: usersFullInfo })
    })

    /**
     * Update user profile
     * PUT /user/profile
     * Updates user profile information including active status
     */
    app.put('/user/profile', async (req, res) => {
      try {
        console.log('👤 Updating user profile...')
        console.log('👤 Request body:', req.body)
        const { userId, active } = req.body
        
        if (!userId) {
          console.log('❌ User ID is missing')
          return res.status(400).json({ error: 'User ID is required' })
        }
        
        // Convert userId to number for comparison (in case it's sent as string)
        const userIdNumber = parseInt(userId, 10)
        if (isNaN(userIdNumber)) {
          console.log('❌ Invalid user ID format:', userId)
          return res.status(400).json({ error: 'Invalid user ID format' })
        }
        
        console.log('👤 Looking for user with ID:', userId)
        console.log('👤 Total users:', users.length)
        console.log('👤 Converted user ID to number:', userIdNumber)
        
        // Find user by ID
        const userIndex = users.findIndex(user => user.id === userIdNumber)
        console.log('👤 User index found:', userIndex)
        
        if (userIndex === -1) {
          console.log('❌ Gebruiker niet gevonden')
          return res.status(404).json({ error: 'Gebruiker niet gevonden' })
        }
        
        console.log('👤 Current user:', users[userIndex])
        
        // Update the user's active status
        if (typeof active === 'boolean') {
          users[userIndex].active = active
          console.log(`✅ Updated user ${userIdNumber} active status to:`, active)
        } else {
          console.log('⚠️ Active status is not boolean:', typeof active, active)
        }
        
        // Save updated users to file
        await saveUsers()
        
        // Return the updated user (excluding password)
        const updatedUser = {
          id: users[userIndex].id,
          firstName: users[userIndex].firstName,
          lastName: users[userIndex].lastName,
          email: users[userIndex].email,
          active: users[userIndex].active,
          isAdmin: users[userIndex].isAdmin || false
        }
        
        console.log('👤 Returning updated user:', updatedUser)
        
        res.json({ 
          msg: 'Profile updated successfully',
          user: updatedUser
        })
      } catch (error) {
        console.error('❌ Error updating user profile:', error)
        res.status(500).json({ error: 'Failed to update profile' })
      }
    })

    // ────────────────────────────────────────────────────────────
    // EVENTS MANAGEMENT ENDPOINTS
    // ────────────────────────────────────────────────────────────
    
    /**
     * Get all calendar events
     * GET /events
     * Returns all events stored in the system
     */
    app.get('/events', (req, res) => {
      console.log('📅 Fetching all events, count:', events.length)
      res.json({ events })
    })

    /**
     * Get all opkomsten (filtered events)
     * GET /events/opkomsten
     * Returns only events where isOpkomst is true
     */
    app.get('/events/opkomsten', (req, res) => {
      const opkomsten = events.filter(event => event.isOpkomst === true)
      console.log('🏕️ Fetching opkomsten, count:', opkomsten.length)
      res.json({ events: opkomsten })
    })

    /**
     * Create a new calendar event
     * POST /events
     * Body: { title, start, end?, allDay?, location?, description?, isOpkomst?, opkomstmakers?, userId }
     * Requires admin privileges
     */
    app.post('/events', async (req, res) => {
      try {
        // Extract event data from request body
        const { title, start, end, allDay, location, description, isOpkomst, opkomstmakers, userId } = req.body
        
        // Check admin privileges
        if (!userId) {
          return res.status(401).json({ msg: 'Authenticatie vereist. Gebruiker ID ontbreekt.' })
        }
        
        if (!isUserAdmin(userId)) {
          return res.status(403).json({ msg: 'Alleen admins kunnen evenementen aanmaken.' })
        }
        
        // Validate required fields
        if (!title || !start) {
          return res.status(400).json({ msg: 'Titel en startdatum zijn verplicht.' })
        }

        // Create new event object with generated ID
        const newEvent = {
          id: Math.random().toString(36).substr(2, 4), // Generate random ID
          title,
          start,
          end: end || start, // Use start date if no end date provided
          allDay: allDay || false,
          location: location || '',
          description: description || '',
          isOpkomst: isOpkomst || false,
          opkomstmakers: opkomstmakers || ''
        }

        // If this is a "Stam opkomst" event, automatically add all active users as participants
        if (isOpkomst && title === 'Stam opkomst') {
          const activeUsers = users.filter(user => user.active === true)
          newEvent.participants = activeUsers.map(user => user.id)
        }

        // Add event to array and save to file
        events.push(newEvent)
        await saveEvents()
        
        console.log('📅 New event created:', newEvent.id, newEvent.title)
        res.json(newEvent)
      } catch (error) {
        console.error('❌ Error creating event:', error)
        res.status(500).json({ msg: 'Er is een fout opgetreden bij het aanmaken van het event.' })
      }
    })

    /**
     * Update an existing calendar event
     * PUT /events/:id
     * Body: { title, start, end?, allDay?, location?, description?, isOpkomst?, opkomstmakers?, userId }
     * Requires admin privileges
     */
    app.put('/events/:id', async (req, res) => {
      try {
        const { id } = req.params
        const { title, start, end, allDay, location, description, isOpkomst, opkomstmakers, userId } = req.body
        
        // Check admin privileges
        if (!userId) {
          return res.status(401).json({ msg: 'Authenticatie vereist. Gebruiker ID ontbreekt.' })
        }
        
        if (!isUserAdmin(userId)) {
          return res.status(403).json({ msg: 'Alleen admins kunnen evenementen bewerken.' })
        }
        
        const eventIndex = events.findIndex(e => e.id === id)
        if (eventIndex === -1) {
          return res.status(404).json({ msg: 'Event niet gevonden.' })
        }

        if (!title || !start) {
          return res.status(400).json({ msg: 'Titel en startdatum zijn verplicht.' })
        }

        events[eventIndex] = {
          ...events[eventIndex],
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
        
        console.log('📅 Event updated:', id, title)
        res.json(events[eventIndex])
      } catch (error) {
        console.error('Error updating event:', error)
        res.status(500).json({ msg: 'Er is een fout opgetreden bij het bewerken van het event.' })
      }
    })

    /**
     * Delete an existing calendar event
     * DELETE /events/:id
     * Body: { userId }
     * Requires admin privileges
     */
    app.delete('/events/:id', async (req, res) => {
      try {
        const { id } = req.params
        const { userId } = req.body
        
        // Check admin privileges
        if (!userId) {
          return res.status(401).json({ msg: 'Authenticatie vereist. Gebruiker ID ontbreekt.' })
        }
        
        if (!isUserAdmin(userId)) {
          return res.status(403).json({ msg: 'Alleen admins kunnen evenementen verwijderen.' })
        }
        
        const eventIndex = events.findIndex(e => e.id === id)
        if (eventIndex === -1) {
          return res.status(404).json({ msg: 'Event niet gevonden.' })
        }

        const deletedEvent = events.splice(eventIndex, 1)[0]
        await saveEvents()
        
        console.log('📅 Event deleted:', id, deletedEvent.title)
        res.json({ msg: 'Event succesvol verwijderd.' })
      } catch (error) {
        console.error('Error deleting event:', error)
        res.status(500).json({ msg: 'Er is een fout opgetreden bij het verwijderen van het event.' })
      }
    })

    /**
     * Update attendance for an opkomst event
     * PUT /events/:id/attendance
     * Body: { userId, attending }
     */
    app.put('/events/:id/attendance', async (req, res) => {
      try {
        const { id } = req.params
        const { userId, attending } = req.body
        
        const eventIndex = events.findIndex(e => e.id === id)
        if (eventIndex === -1) {
          return res.status(404).json({ msg: 'Event niet gevonden.' })
        }

        const event = events[eventIndex]
        if (!event.isOpkomst) {
          return res.status(400).json({ msg: 'Dit is geen opkomst event.' })
        }

        // Initialize participants array if it doesn't exist
        if (!event.participants) {
          event.participants = []
        }

        const participantIndex = event.participants.indexOf(userId)
        
        if (attending && participantIndex === -1) {
          // Add user to participants list
          event.participants.push(userId)
        } else if (!attending && participantIndex > -1) {
          // Remove user from participants list
          event.participants.splice(participantIndex, 1)
        }

        await saveEvents()
        
        console.log(`📅 Attendance updated for event ${id}, user ${userId}: ${attending}`)
        res.json({ msg: 'Aanwezigheid bijgewerkt.', event })
      } catch (error) {
        console.error('Error updating attendance:', error)
        res.status(500).json({ msg: 'Er is een fout opgetreden bij het bijwerken van de aanwezigheid.' })
      }
    })

    // ─── LOGIN ─────────────────────────────────────────────────────
    app.post('/login', async (req, res) => {
      try {
        const { email, password } = req.body
        
        // Check if email and password are provided
        if (!email || !password) {
          return res.status(400).json({ msg: 'E-mailadres en wachtwoord zijn verplicht.' })
        }
        
        const u = users.find(u => u.email === email)
        if (!u) return res.status(400).json({ msg: 'E-mailadres niet gevonden.' })
        
        // Check if password is hashed (starts with $2b$ for bcrypt) or plain text
        let passwordMatch = false
        if (u.password.startsWith('$2b$')) {
          // Password is already hashed, use bcrypt compare
          passwordMatch = await bcrypt.compare(password, u.password)
        } else {
          // Password is plain text, compare directly and hash it for future use
          passwordMatch = (u.password === password)
          if (passwordMatch) {
            // Hash the password for future use
            u.password = await bcrypt.hash(password, 10)
            await saveUsers()
          }
        }
        
        if (!passwordMatch) return res.status(400).json({ msg: 'Wachtwoord is onjuist.' })
        
        // Return user data without password for security
        const userResponse = {
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          active: u.active,
          isAdmin: u.isAdmin || false
        }
        
        res.json({ msg: 'Ingelogd.', user: userResponse })
      } catch (error) {
        console.error('Login error:', error)
        res.status(500).json({ msg: 'Er is een interne fout opgetreden bij het inloggen.' })
      }
    })

    // ─── FORGOT PASSWORD: vraag resetcode aan ─────────────────────
    app.post('/forgot-password', async (req, res) => {
      try {
        const { email } = req.body
        
        // Validatie
        if (!email) {
          return res.status(400).json({ msg: 'E-mailadres is verplicht.' })
        }
        if (!validator.isEmail(email)) {
          return res.status(400).json({ msg: 'Ongeldig e-mailadres.' })
        }
        
        // Generiek bericht om enumeration te voorkomen
        const genericMsg = 'Als dit e-mailadres bekend is, ontvang je binnen enkele minuten een resetcode.'
        
        // Alleen als user bestaat: genereer code en mail
        const u = users.find(u => u.email === email)
        if (u) {
          const code      = generateCode()
          const expiresAt = Date.now() + 15*60*1000 // Verlengd naar 15 minuten
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
                  <p>Gebruik deze code om je wachtwoord te resetten:</p>
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
              `,
            })
            
            // Preview bij Ethereal
            const preview = nodemailer.getTestMessageUrl(info)
            if (preview) {
              console.log('📧 Reset Preview mail:', preview)
              console.log(`✅ Reset code voor ${email}: ${code} (geldig tot ${new Date(expiresAt).toLocaleString()})`)
            }
          } catch (err) {
            console.error('⛔ Reset Mail-error:', err.code || err, err.response || err.message)
            return res.status(500).json({ msg: 'Er is een fout opgetreden bij het versturen van de e-mail.' })
          }
        }
        res.json({ msg: genericMsg })
      } catch (error) {
        console.error('Forgot password error:', error)
        res.status(500).json({ msg: 'Er is een interne fout opgetreden.' })
      }
    })

    // ─── RESET PASSWORD: code + nieuw wachtwoord ───────────────────
    app.post('/reset-password', async (req, res) => {
      try {
        const { email, code, password } = req.body
        
        // Validatie
        if (!email || !code || !password) {
          return res.status(400).json({ msg: 'Alle velden zijn verplicht.' })
        }
        if (!validator.isEmail(email)) {
          return res.status(400).json({ msg: 'Ongeldig e-mailadres.' })
        }
        if (password.length < 6) {
          return res.status(400).json({ msg: 'Wachtwoord moet minimaal 6 karakters bevatten.' })
        }
        
        const record = pendingReset[email]
        if (!record) {
          return res.status(400).json({ msg: 'Geen geldig resetverzoek gevonden voor dit e-mailadres.' })
        }
        if (Date.now() > record.expiresAt) {
          delete pendingReset[email]
          return res.status(400).json({ msg: 'De resetcode is verlopen. Vraag een nieuwe code aan.' })
        }
        if (record.code !== code) {
          return res.status(400).json({ msg: 'Onjuiste resetcode. Controleer de code en probeer opnieuw.' })
        }
        
        // Zoek de gebruiker
        const userIndex = users.findIndex(u => u.email === email)
        if (userIndex === -1) {
          delete pendingReset[email]
          return res.status(400).json({ msg: 'Gebruiker niet gevonden.' })
        }
        
        // Werk wachtwoord bij en sla op
        const hashedPassword = await bcrypt.hash(password, 10)
        users[userIndex].password = hashedPassword
        delete pendingReset[email]
        await saveUsers()
        
        console.log(`✅ Wachtwoord succesvol gereset voor ${email}`)
        res.json({ msg: 'Wachtwoord succesvol gewijzigd. Je kunt nu inloggen met je nieuwe wachtwoord.' })
      } catch (error) {
        console.error('Reset password error:', error)
        res.status(500).json({ msg: 'Er is een interne fout opgetreden bij het resetten van het wachtwoord.' })
      }
    })

    // ─── CHANGE PASSWORD: current + new password ──────────────────
    app.post('/change-password', async (req, res) => {
      try {
        console.log('🔍 Change password request received')
        console.log('Request body:', req.body)
        
        const { currentPassword, newPassword, email } = req.body
        
        // Validatie
        if (!currentPassword || !newPassword) {
          console.log('❌ Missing currentPassword or newPassword')
          return res.status(400).json({ msg: 'Huidig wachtwoord en nieuw wachtwoord zijn verplicht.' })
        }
        
        if (newPassword.length < 6) {
          console.log('❌ New password too short')
          return res.status(400).json({ msg: 'Nieuw wachtwoord moet minimaal 6 karakters bevatten.' })
        }
        
        // For now, we'll get email from the body since we don't have JWT auth
        // In a real app, you'd decode the JWT token to get the user email
        if (!email) {
          console.log('❌ No email provided')
          return res.status(400).json({ msg: 'E-mailadres is verplicht.' })
        }
        
        console.log(`🔑 Wachtwoord wijziging aangevraagd voor: ${email}`)
        
        // Vind de user
        const user = users.find(u => u.email.toLowerCase() === email.toLowerCase())
        if (!user) {
          return res.status(404).json({ msg: 'Gebruiker niet gevonden.' })
        }
        
        // Controleer huidig wachtwoord
        let isCurrentPasswordValid = false
        if (user.password.startsWith('$2b$')) {
          // Password is already hashed, use bcrypt compare
          isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password)
        } else {
          // Password is plain text, compare directly
          isCurrentPasswordValid = (user.password === currentPassword)
          if (isCurrentPasswordValid) {
            // Hash the current password for consistency
            user.password = await bcrypt.hash(currentPassword, 10)
            await saveUsers()
          }
        }
        if (!isCurrentPasswordValid) {
          console.log(`❌ Ongeldig huidig wachtwoord voor ${email}`)
          return res.status(400).json({ msg: 'Huidig wachtwoord is onjuist.' })
        }
        
        console.log(`✅ Current password validated for ${email}`)
        
        // Hash nieuw wachtwoord
        const hashedPassword = await bcrypt.hash(newPassword, 10)
        user.password = hashedPassword
        
        // Sla wijzigingen op
        await saveUsers()
        
        console.log(`✅ Wachtwoord succesvol gewijzigd voor ${email}`)
        res.json({ msg: 'Wachtwoord succesvol gewijzigd.' })
      } catch (error) {
        console.error('Change password error:', error)
        res.status(500).json({ msg: 'Er is een interne fout opgetreden bij het wijzigen van het wachtwoord.' })
      }
    })

    // Root route - helpful message for direct backend access
    app.get('/', (req, res) => {
      res.json({
        message: 'Stamjer Calendar API Server',
        status: 'Running',
        version: '1.0.0',
        frontend_url: 'http://localhost:5173',
        api_endpoints: {
          authentication: [
            'POST /login',
            'POST /forgot-password',
            'POST /reset-password',
            'POST /change-password'
          ],
          events: [
            'GET /events',
            'POST /events',
            'PUT /events/:id',
            'DELETE /events/:id'
          ],
          debug: [
            'GET /test',
            'GET /debug/reset-codes'
          ]
        },
        note: 'Dit is de API server. Open de webapplicatie op http://localhost:5173'
      })
    })

    // 404 handler - add this before app.listen
    app.use((req, res) => {
      console.log(`404 - Route niet gevonden: ${req.method} ${req.originalUrl}`)
      res.status(404).json({ msg: `Route niet gevonden: ${req.method} ${req.originalUrl}` })
    })

    const PORT = process.env.PORT || 3002
    app.listen(PORT, () => {
      console.log(`Server draait op http://localhost:${PORT}`)
    })
  } catch (error) {
    console.error('Server opstarten mislukt:', error)
    process.exit(1)
  }
}

// Start the server
startServer()
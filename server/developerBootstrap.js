import { randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import validator from 'validator'
import { isDeveloper } from './groups.js'
import { logEvent } from './logger.js'
import { writeAudit } from './audit.js'

export async function bootstrapDeveloper(db, { email, firstName = 'Developer', lastName = 'Stamjer', apply = false }) {
  if (await db.collection('schemaMigrations').findOne({ id: 'multi-group-v2' })) throw new Error('Initial bootstrap is retired after membership migration; retain the existing global developer identity.')
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!validator.isEmail(normalizedEmail)) throw new Error('Een geldig developer-e-mailadres is verplicht')
  if (typeof firstName !== 'string' || !firstName.trim() || firstName.length > 80
    || typeof lastName !== 'string' || !lastName.trim() || lastName.length > 120) throw new Error('Ongeldige naam')
  const users = await db.collection('users').find({}).toArray()
  if (users.some(isDeveloper)) throw new Error('Er bestaat al een developer. Gebruik de bestaande account.')
  if (users.some((user) => user.email?.trim().toLowerCase() === normalizedEmail)) {
    throw new Error('Dit e-mailadres bestaat al. Bootstrap maakt alleen een nieuwe account.')
  }
  const id = Math.max(0, ...users.map((user) => Number.isSafeInteger(user.id) ? user.id : 0)) + 1
  if (!Number.isSafeInteger(id)) throw new Error('Geen geldig gebruikers-ID beschikbaar')
  const report = { mode: apply ? 'apply' : 'dry-run', id, role: 'developer', groupId: null, applied: false }
  if (!apply) return report
  // Run with API writes stopped. Never promote an existing participant and never
  // put a bootstrap password in arguments, logs or source files. Password reset
  // via the account email establishes the initial usable password.
  await db.collection('users').createIndex({ id: 1 }, { name: 'users_id_unique_idx', unique: true })
  await db.collection('users').createIndex({ email: 1 }, { name: 'users_email_unique_idx', unique: true })
  await db.collection('users').insertOne({
    id, email: normalizedEmail, firstName: firstName.trim(), lastName: lastName.trim(),
    password: await bcrypt.hash(randomBytes(32).toString('base64url'), 10),
    role: 'developer', groupId: null, isAdmin: false, isDeveloper: true,
    status: 'inactive', sessionVersion: 0, createdAt: new Date()
  })
  logEvent({ action: 'developer-bootstrapped', actor: 'bootstrap-cli', metadata: { targetUserId: id, role: 'developer', groupId: null } })
  await writeAudit(db, { action: 'developer-bootstrapped', collection: 'users', targetId: id, changedFields: ['role', 'groupId', 'email', 'password'] })
  return { ...report, applied: true }
}

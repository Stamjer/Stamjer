import { randomUUID, createHash } from 'node:crypto'
import { normalizeUserRole } from '../shared/roles.js'

// Store identities and field names, never record values, credentials or tokens.
export async function writeAudit(db, { action, actor, groupId = null, collection, targetId, changedFields = [], destinationGroupId }, session) {
  const record = { id: randomUUID(), timestamp: new Date(), action, actorId: actor?.id ?? null,
    actorRole: actor ? normalizeUserRole(actor) : null, groupId, collection, targetId, changedFields: [...new Set(changedFields)] }
  if (destinationGroupId) record.destinationGroupId = destinationGroupId
  await db.collection('auditLogs').insertOne(record, { session })
  return record
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => key !== '_id').map(key => [key, canonical(value[key])]))
  return value
}
export function recordFingerprint(record) { return createHash('sha256').update(JSON.stringify(canonical(record))).digest('hex') }

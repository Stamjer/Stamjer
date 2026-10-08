import { randomUUID } from 'node:crypto'
import { recordFingerprint, writeAudit } from './audit.js'
import { GroupAccessError } from './authorization.js'
import { lockGroups, runGroupTransaction } from './groupTransactions.js'
import { membershipMode, liveGroupActor } from './memberships.js'
import { isDeveloper } from '../shared/roles.js'

export function mapPaymentRecord(record) {
  const { id, userId, groupId, membershipId, submittedAt, form, status, attachments, smtpAcceptedAt } = record
  return { id, userId, groupId, membershipId, submittedAt, form, status, attachments, smtpAcceptedAt }
}

// Receipts are separate, bounded MongoDB documents; no ephemeral disk and no
// bearer download URLs. Each download is authenticated against the owning user.
export async function storePaymentRequest(client, db, { actor, groupId, requestKey, form, attachments, now = new Date() }) {
  if (typeof requestKey !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestKey)) throw new GroupAccessError('Gebruik een geldig aanvraag-ID voor veilig opnieuw proberen', 400)
  const fingerprint = recordFingerprint({ form, attachments: attachments.map(file => ({ name: file.name, type: file.type, content: file.buffer.toString('base64') })) })
  return runGroupTransaction(client, async session => {
    await lockGroups(db, session, [groupId])
    if (await membershipMode(db, session)) {
      const live = await liveGroupActor(db, actor, groupId, session)
      if (!isDeveloper(live) && live.membershipState !== 'current') throw new GroupAccessError('Alumni kunnen geen declaraties indienen')
    }
    const group = await db.collection('groups').findOne({ id: groupId }, { session })
    if (group.settings?.enablePaymentRequests === false) throw new GroupAccessError('Declaraties zijn uitgeschakeld voor deze groep.')
    const existing = await db.collection('paymentRequests').findOne({ userId: actor.id, groupId, requestKey }, { session })
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new GroupAccessError('Aanvraag-ID hoort bij een andere declaratie', 409)
      return { record: existing, created: false }
    }
    const record = { id: randomUUID(), userId: actor.id, groupId, membershipId: actor.membershipId || null, requestKey, fingerprint, submittedAt: now, form,
      status: 'stored', attachments: attachments.map(file => ({ id: randomUUID(), name: file.name, type: file.type, size: file.buffer.length })) }
    await db.collection('paymentRequests').insertOne(record, { session })
    for (let i = 0; i < attachments.length; i++) await db.collection('paymentRequestFiles').insertOne({ requestId: record.id, id: record.attachments[i].id,
      // Base64 keeps the storage representation portable across MongoDB/test adapters.
      content: attachments[i].buffer.toString('base64') }, { session })
    await writeAudit(db, { actor, action: 'payment-request-stored', groupId, collection: 'paymentRequests', targetId: record.id, changedFields: ['submission'] }, session)
    return { record, created: true }
  })
}

export async function claimPaymentDelivery(db, id) {
  const result = await db.collection('paymentRequests').updateOne({ id, status: 'stored' }, { $set: { status: 'sending', deliveryStartedAt: new Date() } })
  return result.matchedCount === 1
}
export async function finishPaymentDelivery(db, id, { accepted = false, rejected = false } = {}) {
  await db.collection('paymentRequests').updateOne({ id, status: 'sending' }, { $set: {
    status: accepted ? 'smtp-accepted' : rejected ? 'delivery-failed' : 'delivery-unknown', ...(accepted ? { smtpAcceptedAt: new Date() } : {})
  } })
}

import { randomInt } from 'node:crypto'
import { canManageUser, GroupAccessError } from './authorization.js'
import { getUserGroupId, isDeveloper, normalizeGroupUser } from './groups.js'
import { lockGroups, runGroupTransaction } from './groupTransactions.js'
import { writeAudit } from './audit.js'
import { membershipMode, liveGroupActor, scopedUser } from './memberships.js'

export async function sendPasswordInvitation(client, db, { userId, actor, groupId: selectedGroupId, purpose = 'reset', mailer, from, now = new Date() }) {
  if (!['reset', 'invite'].includes(purpose)) throw new GroupAccessError('Ongeldige e-mailactie', 400)
  if (!mailer) throw new GroupAccessError('E-mail is niet beschikbaar. Probeer later opnieuw.', 503)
  const code = String(randomInt(100000, 1000000))
  const user = await runGroupTransaction(client, async session => {
    let current = await db.collection('users').findOne({ id: userId }, { session })
    const migrated = await membershipMode(db, session)
    const liveActor = actor && (migrated ? await liveGroupActor(db, actor, selectedGroupId || actor.groupId, session) : await db.collection('users').findOne({ id: actor.id }, { session }))
    if (current && migrated && actor) {
      const membership = await db.collection('groupMemberships').findOne({ userId, groupId: selectedGroupId || actor.groupId, state: 'current' }, { session })
      if (!membership) throw new GroupAccessError('Gebruiker niet gevonden', 404)
      current = scopedUser(current, membership)
    }
    if (!current || (actor && (!canManageUser(liveActor, current) || isDeveloper(current)))) throw new GroupAccessError('Gebruiker niet gevonden', 404)
    const groupId = migrated ? selectedGroupId || (actor ? actor.groupId : null) : getUserGroupId(current)
    await lockGroups(db, session, [groupId], { requireActive: Boolean(actor) })
    const pending = await db.collection('resetCodes').findOne({ email: current.email }, { session })
    if (pending && new Date(pending.createdAt).getTime() > now.getTime() - 60000) throw new GroupAccessError('Er is zojuist een code verstuurd. Wacht een minuut.', 429)
    await db.collection('resetCodes').updateOne({ email: current.email }, { $set: { email: current.email, code, failedAttempts: 0, createdAt: now, expiresAt: new Date(now.getTime() + 15 * 60000) } }, { upsert: true, session })
    await writeAudit(db, { action: `password-${purpose}-requested`, actor: liveActor && normalizeGroupUser(liveActor), groupId, collection: 'users', targetId: userId, changedFields: ['resetCode'] }, session)
    return current
  })
  try {
    await mailer.sendMail({ from, to: user.email, subject: purpose === 'invite' ? 'Welkom bij Stamjer' : 'Herstel je Stamjer-wachtwoord',
      html: `<div style="font-family:Arial,sans-serif"><h2>${purpose === 'invite' ? 'Welkom bij Stamjer' : 'Wachtwoordherstel Stamjer'}</h2><p>${purpose === 'invite' ? 'Er is een account voor je aangemaakt.' : 'Er is een wachtwoordherstel aangevraagd.'} Open Stamjer, kies Wachtwoord vergeten, vul je e-mailadres in en kies Ik heb al een code. Gebruik deze code om een wachtwoord in te stellen:</p><p style="font-size:24px;font-weight:bold">${code}</p><p>De code is 15 minuten geldig.</p><p>Verwacht je dit bericht niet? Je kunt het negeren; je huidige wachtwoord blijft geldig.</p></div>` })
  } catch {
    // Remove only our failed delivery, preserving a concurrently issued code.
    await db.collection('resetCodes').deleteOne({ email: user.email, code })
    await writeAudit(db, { action: `password-${purpose}-delivery-failed`, actor, groupId: getUserGroupId(user), collection: 'users', targetId: userId })
    throw new GroupAccessError('E-mail versturen mislukt. Probeer later opnieuw.', 503)
  }
  await writeAudit(db, { action: `password-${purpose}-sent`, actor, groupId: getUserGroupId(user), collection: 'users', targetId: userId })
}

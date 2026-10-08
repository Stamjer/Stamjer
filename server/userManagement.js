import validator from 'validator'
import { GroupAccessError } from './authorization.js'
import { isDeveloper, normalizeGroupUser } from './groups.js'
import { USER_STATUSES } from './dataModel.js'

export function mapManagedUser(user, streepjes = 0) {
  const normalized = normalizeGroupUser(user)
  return {
    id: normalized.id, firstName: normalized.firstName, lastName: normalized.lastName,
    email: normalized.email, role: normalized.role, groupId: normalized.groupId,
    isAdmin: normalized.isAdmin, isDeveloper: normalized.isDeveloper,
    status: normalized.status, streepjes, ...(user.membershipId ? { membershipId: user.membershipId, membershipState: user.membershipState } : {})
  }
}

export function buildUserUpdate(actor, current, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GroupAccessError('Gebruikersgegevens ontbreken', 400)
  const next = { ...current }
  const allowed = ['firstName', 'lastName', 'email', 'status', 'role']
  for (const field of Object.keys(input)) {
    if (!allowed.includes(field)) throw new GroupAccessError(`Veld kan niet worden gewijzigd: ${field}`, 400)
    const value = input[field]
    if (field === 'role') {
      if (!isDeveloper(actor)) throw new GroupAccessError('Alleen developers kunnen rollen wijzigen')
      if (isDeveloper(current) || !['user', 'admin'].includes(value)) {
        throw new GroupAccessError('Gebruik een aparte developer-account; bestaande leden kunnen user of admin zijn', 400)
      }
      next.role = value
    } else if (field === 'status') {
      if (isDeveloper(current) || !USER_STATUSES.includes(value)) throw new GroupAccessError('Ongeldige gebruikersstatus', 400)
      next.status = value
    } else {
      const limit = field === 'firstName' ? 80 : field === 'lastName' ? 120 : 254
      if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new GroupAccessError(`Ongeldig veld: ${field}`, 400)
      next[field] = field === 'email' ? value.trim().toLowerCase() : value.trim()
      if (field === 'email' && !validator.isEmail(next.email)) throw new GroupAccessError('Gebruik een geldig e-mailadres', 400)
    }
  }
  return normalizeGroupUser(next)
}

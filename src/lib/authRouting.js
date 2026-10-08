import { isAdmin, isDeveloper } from '../../shared/roles.js'

export function isNonAdminAlumni(user) {
  if (user?.memberships) return user.membershipState === 'ended'
  if (user?.membershipState === 'ended') return true
  return Boolean(user && !isDeveloper(user) && !isAdmin(user) && user.status === 'legacy')
}

export function canUsePaymentRequests(user) {
  return Boolean(user && !isDeveloper(user) && user.permissions?.canUsePaymentRequests !== false)
}

export function getAuthenticatedLandingPath(user) {
  if (!user) return null
  if (isDeveloper(user)) return '/developer'
  if (user.memberships) return user.groupId ? '/kalender' : '/account'
  return isNonAdminAlumni(user) ? (canUsePaymentRequests(user) ? '/declaraties' : '/account') : '/kalender'
}

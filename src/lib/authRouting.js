import { isAdmin, isDeveloper } from '../../shared/roles.js'

export function isNonAdminAlumni(user) {
  return Boolean(user && !isDeveloper(user) && !isAdmin(user) && user.status === 'legacy')
}

export function getAuthenticatedLandingPath(user) {
  if (!user) return null
  if (isDeveloper(user)) return '/developer'
  return isNonAdminAlumni(user) ? '/declaraties' : '/kalender'
}

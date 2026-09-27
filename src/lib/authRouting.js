export function isNonAdminAlumni(user) {
  return Boolean(user && !user.isAdmin && user.status === 'legacy')
}

export function getAuthenticatedLandingPath(user) {
  if (!user) return null
  return isNonAdminAlumni(user) ? '/declaraties' : '/kalender'
}

export function getAttendanceAuthorizationError(actor, targetUser, attending) {
  if (!actor || !targetUser) return 'AUTH_REQUIRED'
  if (actor.id !== targetUser.id && !actor.isAdmin) return 'FORBIDDEN'
  if (attending && targetUser.status === 'legacy') return 'ALUMNI_ATTENDANCE'
  return null
}

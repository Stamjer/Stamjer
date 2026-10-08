export function normalizeUserRole(user = {}) {
  if (!user) return 'user'
  if (Object.hasOwn(user, 'role')) return ['user', 'admin', 'developer'].includes(user.role) ? user.role : 'user'
  return user.isAdmin === true ? 'admin' : 'user'
}

export function isDeveloper(user) { return Boolean(user) && normalizeUserRole(user) === 'developer' }
export function isAdmin(user) { return Boolean(user) && normalizeUserRole(user) === 'admin' }
export function isGroupMember(user) { return Boolean(user) && !isDeveloper(user) }

export const USER_STATUSES = Object.freeze(['active', 'inactive', 'legacy'])

export function normalizeUserStatus(user = {}) {
  if (USER_STATUSES.includes(user.status)) return user.status
  return 'active'
}

export function sanitizeIdArray(value) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map((item) => Number.parseInt(item, 10))
    .filter(Number.isFinite)))
}

export function parseLegacyNames(value) {
  if (Array.isArray(value)) {
    return value.map((name) => String(name).trim()).filter(Boolean)
  }
  if (typeof value !== 'string') return []
  return value.split(',').map((name) => name.trim()).filter(Boolean)
}


export function getAssignmentDisplayNames(ids, legacyNames, users) {
  const usersById = new Map(users.map((user) => [user.id, user]))
  const resolvedNames = sanitizeIdArray(ids).map((id) => {
    const user = usersById.get(id)
    return user ? user.firstName : null
  }).filter(Boolean)
  return Array.from(new Set([...resolvedNames, ...parseLegacyNames(legacyNames)]))
}

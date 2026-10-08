export const USER_STATUSES = Object.freeze(['active', 'inactive', 'legacy'])

export function normalizeUserStatus(user = {}) {
  if (USER_STATUSES.includes(user.status)) return user.status
  return 'active'
}

export function sanitizeIdArray(value) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map(sanitizeUserId)
    .filter((id) => id !== null)))
}

export function sanitizeUserId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
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

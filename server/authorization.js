import { getEventGroupId, getUserGroupId, isDeveloper, normalizeUserRole } from './groups.js'

export function canReadGroup(actor, groupId) {
  if (actor?.memberships) return isDeveloper(actor) || actor.memberships.some(m => m.groupId === groupId && m.state !== 'historical')
  return Boolean(actor && groupId) && (isDeveloper(actor) || getUserGroupId(actor) === groupId)
}

export function canManageGroup(actor, groupId) {
  if (actor?.memberships && !isDeveloper(actor)) return actor.memberships.some(m => m.groupId === groupId && m.state === 'current' && m.role === 'admin')
  return canReadGroup(actor, groupId) && (isDeveloper(actor) || normalizeUserRole(actor) === 'admin')
}

export function canManageUser(actor, targetUser) {
  if (!actor || !targetUser) return false
  if (isDeveloper(actor)) return true
  return !isDeveloper(targetUser) && canManageGroup(actor, getUserGroupId(targetUser))
}

export class GroupAccessError extends Error {
  constructor(message, status = 403) {
    super(message)
    this.status = status
  }
}

export function resolveRequestGroupId(req, actor, { allowAllGroups = false } = {}) {
  if (!actor) throw new GroupAccessError('Authenticatie vereist', 401)
  const queryGroup = req.query?.groupId
  const bodyGroup = req.body?.groupId
  const allGroups = req.query?.allGroups
  if (allGroups !== undefined && allGroups !== 'true' && allGroups !== 'false') {
    throw new GroupAccessError('allGroups moet true of false zijn', 400)
  }
  if (queryGroup !== undefined && bodyGroup !== undefined && queryGroup !== bodyGroup) {
    throw new GroupAccessError('Tegenstrijdige groepen in aanvraag', 400)
  }
  const headerGroup = req.headers?.['x-group-id']
  if (headerGroup !== undefined && (queryGroup ?? bodyGroup) !== undefined && headerGroup !== (queryGroup ?? bodyGroup)) throw new GroupAccessError('Tegenstrijdige groepen in aanvraag', 400)
  const requestedGroup = queryGroup ?? bodyGroup ?? headerGroup
  if (requestedGroup !== undefined && (typeof requestedGroup !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(requestedGroup))) {
    throw new GroupAccessError('Ongeldige groep', 400)
  }
  if (allGroups === 'true') {
    if (!isDeveloper(actor)) throw new GroupAccessError('Alleen developers kunnen alle groepen opvragen')
    if (!allowAllGroups || requestedGroup !== undefined) throw new GroupAccessError('Kies één groep of alle groepen', 400)
    return null
  }
  if (isDeveloper(actor)) {
    if (!requestedGroup) throw new GroupAccessError('Selecteer een groep', 400)
    return requestedGroup
  }
  if (actor.memberships) {
    const accessible = actor.memberships.filter(m => m.state !== 'historical')
    const id = requestedGroup || (accessible.length === 1 ? accessible[0].groupId : null)
    if (!id) throw new GroupAccessError('Selecteer een groep', 400)
    if (!canReadGroup(actor, id)) throw new GroupAccessError('Geen toegang tot deze groep')
    return id
  }
  const groupId = getUserGroupId(actor)
  if (requestedGroup && requestedGroup !== groupId) throw new GroupAccessError('Geen toegang tot deze groep')
  return groupId
}

export function getAttendanceAuthorizationError(actor, targetUser, attending, event = null) {
  if (!actor || !targetUser) return 'AUTH_REQUIRED'
  if (isDeveloper(targetUser)) return 'FORBIDDEN'
  const groupId = event ? getEventGroupId(event) : getUserGroupId(targetUser)
  if (!targetUser.memberships && getUserGroupId(targetUser) !== groupId) return 'FORBIDDEN'
  if (actor.memberships && !isDeveloper(actor) && !actor.memberships.some(m => m.groupId === groupId && m.state === 'current')) return 'FORBIDDEN'
  if (targetUser.memberships && !targetUser.memberships.some(m => m.groupId === groupId && m.state === 'current')) return 'ALUMNI_ATTENDANCE'
  if (!canReadGroup(actor, groupId)) return 'FORBIDDEN'
  if (event && getEventGroupId(event) !== groupId) return 'FORBIDDEN'
  if (actor.id !== targetUser.id && !canManageUser(actor, targetUser)) return 'FORBIDDEN'
  if (attending && targetUser.status === 'legacy') return 'ALUMNI_ATTENDANCE'
  return null
}

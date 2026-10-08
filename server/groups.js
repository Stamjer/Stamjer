import { normalizeUserStatus, sanitizeIdArray, sanitizeUserId } from './dataModel.js'
import { isDeveloper, normalizeUserRole } from '../shared/roles.js'
export { isDeveloper, normalizeUserRole } from '../shared/roles.js'

export const DEFAULT_GROUP_ID = 'stam-default'
export const USER_ROLES = Object.freeze(['user', 'admin', 'developer'])

export function getUserGroupId(user) {
  if (!user || isDeveloper(user)) return null
  return user.groupId || DEFAULT_GROUP_ID
}

export function getEventGroupId(event) {
  return event.groupId || DEFAULT_GROUP_ID
}

export function normalizeGroupUser(user) {
  const role = normalizeUserRole(user)
  return {
    ...user,
    role,
    groupId: getUserGroupId(user),
    isAdmin: role === 'admin',
    isDeveloper: role === 'developer',
    status: normalizeUserStatus(user)
  }
}

export function getGroupMembers(users, groupId) {
  return users.flatMap(user => {
    if (isDeveloper(user)) return []
    if (!user.memberships) return getUserGroupId(user) === groupId ? [user] : []
    const membership = user.memberships.find(m => m.groupId === groupId)
    return membership ? [{ ...user, groupId, role: membership.state === 'current' ? membership.role : 'user', status: membership.state === 'ended' ? 'alumni' : membership.status,
      membershipId: membership.id, membershipState: membership.state, membership }] : []
  })
}

export function createDefaultGroup(settings = {}, now = new Date()) {
  return {
    id: DEFAULT_GROUP_ID,
    name: 'Stam',
    slug: DEFAULT_GROUP_ID,
    status: 'active',
    settings,
    createdAt: now,
    updatedAt: now
  }
}

export const GROUP_INDEXES = Object.freeze({
  groups: [
    { keys: { id: 1 }, options: { unique: true, name: 'groups_id_unique_idx' } },
    { keys: { slug: 1 }, options: { unique: true, name: 'groups_slug_unique_idx' } }
  ],
  users: [
    { keys: { groupId: 1 }, options: { name: 'users_group_idx' } },
    { keys: { groupId: 1, status: 1 }, options: { name: 'users_group_status_idx' } }
  ],
  events: [
    { keys: { groupId: 1, start: 1 }, options: { name: 'events_group_start_idx' } },
    { keys: { groupId: 1, isOpkomst: 1, start: 1 }, options: { name: 'events_group_opkomst_start_idx' } },
    { keys: { groupId: 1, isSchoonmaak: 1, start: 1 }, options: { name: 'events_group_schoonmaak_start_idx' } }
  ],
  userGroupHistory: [
    { keys: { id: 1 }, options: { unique: true, name: 'user_group_history_id_idx' } },
    { keys: { groupId: 1, movedAt: -1 }, options: { name: 'user_group_history_group_idx' } },
    { keys: { userId: 1, movedAt: -1 }, options: { name: 'user_group_history_user_idx' } }
  ],
  auditLogs: [
    { keys: { id: 1 }, options: { unique: true, name: 'audit_id_unique_idx' } },
    { keys: { groupId: 1, timestamp: -1 }, options: { name: 'audit_group_time_idx' } },
    { keys: { destinationGroupId: 1, timestamp: -1 }, options: { name: 'audit_destination_time_idx' } },
    { keys: { timestamp: -1 }, options: { name: 'audit_time_idx' } }
  ]
})

export function calculateGroupStreepjes(users, events, groupId) {
  const counts = Object.fromEntries(getGroupMembers(users, groupId).map((user) => [user.id, 0]))
  for (const event of events) {
    if (getEventGroupId(event) !== groupId || (!event.isOpkomst && !event.attendanceMeta) || !event.attendance) continue
    const participants = sanitizeIdArray(event.participants)
    for (const [id, value] of Object.entries(event.attendance)) {
      if (event.attendanceMeta?.[id]) {
        counts[id] = (counts[id] || 0) + event.attendanceMeta[id].streepjes
        continue
      }
      if (users.some(user => user.memberships)) continue
      if (!Object.hasOwn(counts, id)) continue
      const present = Boolean(value && typeof value === 'object' ? value.present : value)
      if (participants.includes(Number(id)) !== present) counts[id]++
    }
  }
  return counts
}

export function getEventMembershipError(event, input, users) {
  const groupId = getEventGroupId(event)
  const members = new Map(getGroupMembers(users, groupId).map((user) => [user.id, normalizeGroupUser(user)]))
  for (const field of ['participants', 'opkomstmakerIds', 'schoonmakerIds']) {
    if (!Object.hasOwn(input, field)) continue
    if (!Array.isArray(input[field])) return `${field} moet een lijst zijn`
    for (const value of input[field]) {
      const id = sanitizeUserId(value)
      const user = members.get(id)
      if ((event.attendanceMeta || users.some(u => u.memberships)) && id !== null && sanitizeIdArray(event[field]).includes(id)) continue
      if (id === null || !user || (user.membershipState && user.membershipState !== 'current')) return `${field} bevat een gebruiker buiten deze groep`
      if (!sanitizeIdArray(event[field]).includes(id) && (field === 'participants' ? user.status === 'legacy' : user.status !== 'active')) {
        return `${field} bevat een gebruiker met een ongeldige status`
      }
    }
  }
  if (Object.hasOwn(input, 'attendance')) {
    if (!input.attendance || typeof input.attendance !== 'object' || Array.isArray(input.attendance)) {
      return 'attendance moet een object zijn'
    }
    for (const [id, value] of Object.entries(input.attendance)) {
      if ((!members.has(Number(id)) && !Object.hasOwn(event.attendance || {}, id) && !sanitizeIdArray(event.participants).includes(Number(id))) || String(Number(id)) !== id) return 'attendance bevat een gebruiker buiten deze groep'
      if (typeof value !== 'boolean' && !(value && typeof value === 'object' && typeof value.present === 'boolean')) {
        return 'Aanwezigheid moet true of false zijn'
      }
    }
  }
  return null
}

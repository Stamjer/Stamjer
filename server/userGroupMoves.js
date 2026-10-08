import { createHash } from 'node:crypto'
import { GroupAccessError } from './authorization.js'
import { getEventGroupId, isDeveloper, normalizeGroupUser } from './groups.js'
import { sanitizeIdArray } from './dataModel.js'

const GROUP_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/
const ID_FIELDS = ['participants', 'opkomstmakerIds', 'schoonmakerIds']
function invalid(message, status = 400) { throw new GroupAccessError(message, status) }
function hasUser(event, id) {
  return ID_FIELDS.some(field => sanitizeIdArray(event[field]).includes(id)) || Object.hasOwn(event.attendance || {}, id)
}
function streepje(event, id) {
  if (!event.isOpkomst || !Object.hasOwn(event.attendance || {}, id)) return 0
  const value = event.attendance[id]
  return Number(sanitizeIdArray(event.participants).includes(id) !== Boolean(value && typeof value === 'object' ? value.present : value))
}
function canonical(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

export function planUserGroupMove({ user, groups, events, destinationGroupId, now = new Date() }) {
  if (!user) invalid('Gebruiker niet gevonden', 404)
  if (isDeveloper(user)) invalid('Developer-accounts horen niet bij een groep')
  if (typeof destinationGroupId !== 'string' || !GROUP_KEY.test(destinationGroupId)) invalid('Ongeldige bestemmingsgroep')
  const normalized = normalizeGroupUser(user)
  const source = groups.find(group => group.id === normalized.groupId)
  const destination = groups.find(group => group.id === destinationGroupId)
  if (!source || !destination) invalid('Groep niet gevonden', 404)
  if (source.id === destination.id) invalid('Kies een andere groep')
  if (source.status !== 'active' || destination.status !== 'active') invalid('Heractiveer de bron- en bestemmingsgroep voordat je verplaatst', 403)
  const changes = []
  const history = []
  let destinationOpkomsten = 0
  let futureAssignments = 0
  for (const event of events) {
    const groupId = getEventGroupId(event)
    const containsUser = hasUser(event, user.id)
    if (containsUser && groupId !== source.id) invalid('Er bestaan verwijzingen buiten de huidige groep. Herstel deze eerst.', 409)
    const startsAt = new Date(event.start)
    if (groupId === source.id && containsUser) {
      if (Number.isNaN(startsAt.getTime())) invalid('Een gekoppeld evenement heeft een ongeldige startdatum', 409)
      const future = startsAt > now
      const before = Object.fromEntries(ID_FIELDS.map(field => [field, sanitizeIdArray(event[field]).includes(user.id) ? [user.id] : []]))
      if (Object.hasOwn(event.attendance || {}, user.id)) before.attendance = { [user.id]: event.attendance[user.id] }
      // Archive this user's original references/attendance only; other members'
      // data remains on the event and does not need duplication in the archive.
      history.push({ eventId: event.id, title: event.title, start: event.start, end: event.end, allDay: Boolean(event.allDay),
        isOpkomst: Boolean(event.isOpkomst), future, references: before, streepjes: streepje(event, user.id) })
      const fields = Object.fromEntries(ID_FIELDS.filter(field => Object.hasOwn(event, field))
        .map(field => [field, sanitizeIdArray(event[field]).filter(id => id !== user.id)]))
      if (Object.hasOwn(event, 'attendance')) fields.attendance = Object.fromEntries(Object.entries(event.attendance || {}).filter(([id]) => Number(id) !== user.id))
      // Preserve past maker display without reintroducing account references.
      if (!future) for (const [ids, names] of [['opkomstmakerIds', 'legacyOpkomstmakerNames'], ['schoonmakerIds', 'legacySchoonmakerNames']]) {
        if (sanitizeIdArray(event[ids]).includes(user.id)) fields[names] = [...new Set([...(event[names] || []), normalized.firstName])]
      }
      if (future && (sanitizeIdArray(event.opkomstmakerIds).includes(user.id) || sanitizeIdArray(event.schoonmakerIds).includes(user.id))) futureAssignments++
      changes.push({ event, fields })
    } else if (groupId === destination.id && event.isOpkomst && startsAt > now && normalized.status === 'active') {
      changes.push({ event, fields: { participants: [...sanitizeIdArray(event.participants), user.id].sort((a, b) => a - b) } })
      destinationOpkomsten++
    }
  }
  const summary = { sourceGroupId: source.id, destinationGroupId: destination.id, status: normalized.status,
    previousRole: normalized.role, role: 'user', archivedEvents: history.length,
    archivedStreepjes: history.reduce((total, item) => total + item.streepjes, 0), futureAssignments, destinationOpkomsten }
  // Full record snapshots detect password/status/attendance/title changes too;
  // neither the digest nor preview response includes credentials.
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ user, source, destination,
    events: events.filter(event => [source.id, destination.id].includes(getEventGroupId(event))).sort((a, b) => String(a.id).localeCompare(String(b.id))) }))).digest('hex')
  return { user: normalized, source, destination, changes, history, summary, fingerprint }
}

// Retained pure archive interpretation above; new transfers are retired.
export async function previewUserGroupMove() { invalid('Verplaatsen is vervangen door onafhankelijke lidmaatschappen', 410) }
export async function applyUserGroupMove() { invalid('Verplaatsen is vervangen door onafhankelijke lidmaatschappen', 410) }

import { GroupAccessError } from './authorization.js'
import { getEventMembershipError } from './groups.js'

export const EVENT_EDIT_FIELDS = ['title', 'start', 'end', 'location', 'description', 'allDay', 'isOpkomst', 'isSchoonmaak', 'participants', 'opkomstmakerIds', 'schoonmakerIds', 'attendance', 'schoonmaakOptions']
export function validateEventInput(event, input, users, { creating = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GroupAccessError('Evenementgegevens ontbreken', 400)
  for (const key of Object.keys(input)) {
    if (!EVENT_EDIT_FIELDS.includes(key) && !(creating && key === 'groupId')) throw new GroupAccessError(`Onbekend evenementveld: ${key}`, 400)
    if (['title', 'start', 'end', 'location', 'description'].includes(key) && (typeof input[key] !== 'string' || input[key].length > (key === 'description' ? 10000 : 500))) throw new GroupAccessError(`Ongeldig veld: ${key}`, 400)
    if (['allDay', 'isOpkomst', 'isSchoonmaak'].includes(key) && typeof input[key] !== 'boolean') throw new GroupAccessError(`Ongeldig veld: ${key}`, 400)
  }
  const membershipError = getEventMembershipError(event, input, users)
  if (membershipError) throw new GroupAccessError(membershipError, 400)
  if (Object.hasOwn(input, 'schoonmaakOptions') && (!Array.isArray(input.schoonmaakOptions) || input.schoonmaakOptions.some(value => typeof value !== 'string' || value.length > 300))) throw new GroupAccessError('Schoonmaakopties moeten een lijst met teksten zijn', 400)
  const next = { ...event, ...input }
  const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
  if (!next.title?.trim() || !datePattern.test(next.start || '') || Number.isNaN(new Date(next.start).getTime())) throw new GroupAccessError('Titel en geldige startdatum zijn vereist', 400)
  if (next.end && (!datePattern.test(next.end) || Number.isNaN(new Date(next.end).getTime()) || new Date(next.end) < new Date(next.start))) throw new GroupAccessError('Einddatum moet op of na de startdatum liggen', 400)
}

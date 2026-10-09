export const MAX_EVENT_GUESTS = 5
export const MAX_GUEST_NAME_LENGTH = 120

export function validEventGuests(names) {
  return Array.isArray(names) && names.length <= MAX_EVENT_GUESTS && names.every(name =>
    // eslint-disable-next-line no-control-regex
    typeof name === 'string' && name.trim().length > 0 && name.length <= MAX_GUEST_NAME_LENGTH && !/[\u0000-\u001f\u007f]/.test(name))
}

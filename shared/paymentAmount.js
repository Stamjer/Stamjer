// One decimal separator, at most two cents digits, and no thousands grouping.
// Build integer cents first so malformed input is never partially accepted.
export function parsePaymentAmount(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null
  const text = String(input).trim()
  if (text.length > 30 || !/^(?:\d+(?:[.,]\d{1,2})?|[.,]\d{1,2})$/.test(text)) return null
  const [whole = '', fraction = ''] = text.replace(',', '.').split('.')
  const cents = Number(`${whole || '0'}${fraction.padEnd(2, '0')}`)
  if (!Number.isSafeInteger(cents) || cents <= 0) return null
  const amount = cents / 100
  return Number(amount.toFixed(2).replace('.', '')) === cents ? amount : null
}

export const PAYMENT_AMOUNT_ERROR = 'Voer een bedrag groter dan 0 in met maximaal 2 decimalen. Gebruik een punt of komma, zonder duizendtalscheiding.'

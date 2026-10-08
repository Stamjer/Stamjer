const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export const DEFAULT_SESSION_MAX_AGE_DAYS = 365
export const DEFAULT_SESSION_TOUCH_INTERVAL_HOURS = 24

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Math.max(parsed || fallback, 1)
}

export function createSessionPolicy(env = {}) {
  const maxAgeDays = positiveInteger(env.SESSION_MAX_AGE_DAYS, DEFAULT_SESSION_MAX_AGE_DAYS)
  const touchIntervalHours = positiveInteger(
    env.SESSION_TOUCH_INTERVAL_HOURS,
    DEFAULT_SESSION_TOUCH_INTERVAL_HOURS
  )

  return {
    cookieName: env.SESSION_COOKIE_NAME || 'stamjer_session',
    cookieDomain: env.SESSION_COOKIE_DOMAIN || '',
    maxAgeDays,
    maxAgeMs: maxAgeDays * DAY_MS,
    touchIntervalMs: touchIntervalHours * HOUR_MS
  }
}

export function createSessionCookieOptions({
  isProduction = false,
  maxAgeMs = DEFAULT_SESSION_MAX_AGE_DAYS * DAY_MS,
  cookieDomain = '',
  maxAge = maxAgeMs
} = {}) {
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge
  }

  if (cookieDomain) options.domain = cookieDomain
  return options
}

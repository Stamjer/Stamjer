import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createSessionCookieOptions,
  createSessionPolicy,
  DEFAULT_SESSION_MAX_AGE_DAYS,
  DEFAULT_SESSION_TOUCH_INTERVAL_HOURS
} from '../server/sessionPolicy.js'

const DAY_MS = 24 * 60 * 60 * 1000

describe('persistent session policy', () => {
  it('defaults to a rolling one-year session checked daily', () => {
    const policy = createSessionPolicy()

    assert.equal(policy.maxAgeDays, DEFAULT_SESSION_MAX_AGE_DAYS)
    assert.equal(policy.maxAgeMs, 365 * DAY_MS)
    assert.equal(policy.touchIntervalMs, DEFAULT_SESSION_TOUCH_INTERVAL_HOURS * 60 * 60 * 1000)
  })

  it('creates a persistent and secure production cookie', () => {
    const maxAgeMs = 365 * DAY_MS
    assert.deepEqual(createSessionCookieOptions({ isProduction: true, maxAgeMs }), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: maxAgeMs
    })
  })

  it('supports a configured shared cookie domain', () => {
    assert.equal(
      createSessionCookieOptions({ cookieDomain: '.stamjer.nl' }).domain,
      '.stamjer.nl'
    )
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getAuthenticatedLandingPath } from '../src/lib/authRouting.js'

describe('authenticated landing routes', () => {
  it('keeps unauthenticated visitors on the login entry', () => {
    assert.equal(getAuthenticatedLandingPath(null), null)
  })

  it('sends active and inactive members to the calendar', () => {
    assert.equal(getAuthenticatedLandingPath({ status: 'active', isAdmin: false }), '/kalender')
    assert.equal(getAuthenticatedLandingPath({ status: 'inactive', isAdmin: false }), '/kalender')
  })

  it('sends non-admin alumni to declarations', () => {
    assert.equal(getAuthenticatedLandingPath({ status: 'legacy', isAdmin: false }), '/declaraties')
  })

  it('keeps alumni admins in the full application', () => {
    assert.equal(getAuthenticatedLandingPath({ status: 'legacy', isAdmin: true }), '/kalender')
  })
  it('gives developers a separate landing page regardless of member status', () => {
    assert.equal(getAuthenticatedLandingPath({ role: 'developer', status: 'legacy', isAdmin: false }), '/developer')
    assert.equal(getAuthenticatedLandingPath({ role: 'developer', status: 'active' }), '/developer')
    assert.equal(getAuthenticatedLandingPath({ role: 'user', isAdmin: true, status: 'legacy' }), '/declaraties')
  })
})

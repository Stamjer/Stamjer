import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canUsePaymentRequests, getAuthenticatedLandingPath, isNonAdminAlumni } from '../src/lib/authRouting.js'

describe('authenticated landing routes', () => {
  it('retains the historical calendar landing for ended memberships and handles accounts without groups', () => {
    assert.equal(getAuthenticatedLandingPath({ role: 'user', groupId: 'a', membershipState: 'ended', memberships: [{ id: 'm', state: 'ended' }], permissions: { canUsePaymentRequests: false } }), '/kalender')
    assert.equal(getAuthenticatedLandingPath({ role: 'user', groupId: null, memberships: [] }), '/account')
    assert.equal(isNonAdminAlumni({ role: 'admin', membershipState: 'ended', status: 'active' }), true)
    assert.equal(isNonAdminAlumni({ role: 'admin', membershipState: 'current', status: 'legacy' }), false)
  })
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

  it('sends alumni to their account when declarations are disabled', () => {
    const permissions = { canUsePaymentRequests: false }
    assert.equal(getAuthenticatedLandingPath({ role: 'user', status: 'legacy', permissions }), '/account')
    assert.equal(getAuthenticatedLandingPath({ role: 'admin', status: 'legacy', permissions }), '/kalender')
    assert.equal(getAuthenticatedLandingPath({ role: 'user', status: 'active', permissions }), '/kalender')
    assert.equal(getAuthenticatedLandingPath({ role: 'developer', permissions }), '/developer')
  })

  it('allows declarations by default and respects explicit feature restrictions', () => {
    assert.equal(canUsePaymentRequests(null), false)
    assert.equal(canUsePaymentRequests({ role: 'developer' }), false)
    for (const role of ['user', 'admin']) {
      assert.equal(canUsePaymentRequests({ role }), true)
      assert.equal(canUsePaymentRequests({ role, permissions: { canUsePaymentRequests: true } }), true)
      assert.equal(canUsePaymentRequests({ role, permissions: { canUsePaymentRequests: false } }), false)
    }
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

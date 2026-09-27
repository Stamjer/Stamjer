import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getAttendanceAuthorizationError } from '../api/authorization.js'

const member = { id: 1, status: 'active', isAdmin: false }
const otherMember = { id: 2, status: 'inactive', isAdmin: false }
const alumniAdmin = { id: 3, status: 'legacy', isAdmin: true }

describe('attendance authorization', () => {
  it('allows a member to update their own attendance', () => {
    assert.equal(getAttendanceAuthorizationError(member, member, true), null)
  })

  it('blocks a non-admin from updating another member', () => {
    assert.equal(getAttendanceAuthorizationError(member, otherMember, true), 'FORBIDDEN')
  })

  it('allows an alumni admin to manage another member', () => {
    assert.equal(getAttendanceAuthorizationError(alumniAdmin, otherMember, true), null)
  })

  it('never adds alumni themselves as participants', () => {
    assert.equal(getAttendanceAuthorizationError(alumniAdmin, alumniAdmin, true), 'ALUMNI_ATTENDANCE')
    assert.equal(getAttendanceAuthorizationError(alumniAdmin, alumniAdmin, false), null)
  })
})

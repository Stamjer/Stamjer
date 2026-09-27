import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getAssignmentDisplayNames,
  normalizeUserStatus
} from '../api/dataModel.js'

describe('user status', () => {
  it('accepts canonical statuses and defaults missing values to active', () => {
    assert.equal(normalizeUserStatus({ status: 'legacy' }), 'legacy')
    assert.equal(normalizeUserStatus({ status: 'inactive' }), 'inactive')
    assert.equal(normalizeUserStatus({ status: 'active' }), 'active')
    assert.equal(normalizeUserStatus({}), 'active')
  })
})

describe('event assignment display', () => {
  const users = [
    { id: 1, firstName: 'Ada', lastName: 'Lovelace' },
    { id: 2, firstName: 'Grace', lastName: 'Hopper' }
  ]

  it('combines assigned users with preserved unmatched historical names', () => {
    assert.deepEqual(getAssignmentDisplayNames([1], ['Oud-lid'], users), ['Ada', 'Oud-lid'])
  })
})

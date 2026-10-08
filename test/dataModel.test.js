import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getAssignmentDisplayNames,
  normalizeUserStatus,
  sanitizeIdArray,
  sanitizeUserId
} from '../api/dataModel.js'

describe('user status', () => {
  it('accepts canonical statuses and defaults missing values to active', () => {
    assert.equal(normalizeUserStatus({ status: 'legacy' }), 'legacy')
    assert.equal(normalizeUserStatus({ status: 'inactive' }), 'inactive')
    assert.equal(normalizeUserStatus({ status: 'active' }), 'active')
    assert.equal(normalizeUserStatus({}), 'active')
  })
})

describe('numeric user IDs', () => {
  it('accepts canonical IDs and rejects prefixes, scientific notation and unsafe values', () => {
    assert.equal(sanitizeUserId('12'), 12)
    assert.equal(sanitizeUserId(12), 12)
    for (const value of ['12junk', '1e2', '01', true, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(sanitizeUserId(value), null)
    }
    assert.deepEqual(sanitizeIdArray([1, '1', '2', '1e2', '3junk', null]), [1, 2])
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

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePaymentAmount } from '../shared/paymentAmount.js'

describe('declaration amounts', () => {
  it('preserves cents with either decimal separator', () => {
    for (const input of ['12.50', '12,50', ' 12,50 ', 12.5, '0012,5']) assert.equal(parsePaymentAmount(input), 12.5)
    for (const input of ['.50', ',50', '0.50', '0,50']) assert.equal(parsePaymentAmount(input), 0.5)
    assert.equal(parsePaymentAmount('0,01'), 0.01)
    assert.equal(parsePaymentAmount(1), 1)
  })
  it('rejects partial, ambiguous, nonpositive and unrepresentable values', () => {
    for (const input of ['', ' ', '12abc', '12,50abc', '1,234', '1.234', '1.234,56', '1,234.56', '12,50,00', '12.50.00', '1e3', '0x10', '-1', '+1', '0', '0.00', '12.', 'Infinity', Infinity, NaN, null, {}, [], true, 0.001, '9007199254740992']) {
      assert.equal(parsePaymentAmount(input), null, String(input))
    }
  })
})

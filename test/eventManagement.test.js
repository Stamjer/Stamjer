import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateEventInput } from '../server/eventManagement.js'

describe('event guest validation', () => {
  const event = { groupId: 'stam', title: 'Game night', start: '2099-01-01', isOpkomst: true }
  it('accepts freely named opkomsten and external names without user IDs', () => {
    validateEventInput(event, { title: 'Campfire with friends', guestOpkomstmakers: ['Guest, Jr.', 'Zoë 🧭'] }, [])
    validateEventInput(event, { title: 'Cleaning', isOpkomst: false, isSchoonmaak: true }, [])
    validateEventInput(event, { guestOpkomstmakers: Array(5).fill('Guest') }, [])
  })
  it('rejects malformed names, control characters and unbounded lists', () => {
    for (const guestOpkomstmakers of ['Guest', null, [1], [{}], [''], ['  '], ['Guest\nInjected'], ['Guest\0'], ['x'.repeat(121)], Array(6).fill('Guest')]) {
      assert.throws(() => validateEventInput(event, { guestOpkomstmakers }, []), { status: 400 })
    }
  })
})

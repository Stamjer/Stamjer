import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildEventPayload, nextDay, defaultEventTitle } from '../src/lib/eventPayload.js'

describe('event payloads', () => {
  it('uses exclusive end dates for all-day events', () => {
    assert.equal(nextDay('2026-12-31'), '2027-01-01')
  })

  it('keeps maker IDs canonical', () => {
    const payload = buildEventPayload({
      title: ' Opkomst ', startDate: '2026-09-30', startTime: '20:30',
      endDate: '2026-09-30', endTime: '22:30', isAllDay: false,
      location: ' Clubhuis ', description: '', isOpkomst: true,
      opkomstmakers: [2, 4], isSchoonmaak: false, schoonmakers: [], schoonmaakOptions: [],
      guestOpkomstmakers: [' External guest ']
    })
    assert.deepEqual(payload.opkomstmakerIds, [2, 4])
    assert.deepEqual(payload.guestOpkomstmakers, ['External guest'])
    assert.equal(Object.hasOwn(payload, 'opkomstmakers'), false)
    assert.equal(payload.start, '2026-09-30T20:30')
  })
  it('uses the selected group name for default event titles', () => {
    assert.equal(defaultEventTitle('isOpkomst', 'Stam'), 'Opkomst Stam')
    assert.equal(defaultEventTitle('isOpkomst', 'Stam+'), 'Opkomst Stam+')
    assert.equal(defaultEventTitle('isSchoonmaak', 'Stam+'), 'Schoonmaak Stam+')
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateICalendar } from '../server/icalendar.js'

describe('public calendar privacy', () => {
  it('includes public event details without exposing internal fields', () => {
    const calendar = generateICalendar([{
      id: 'event-1',
      title: 'Open avond',
      start: '2026-10-02T20:00:00',
      end: '2026-10-02T22:00:00',
      location: 'Scoutinggebouw',
      description: 'Vertrouwelijke voorbereiding',
      participants: [1, 2],
      opkomstmakers: 'Ada, Grace',
      attendeeEmail: 'private@example.com'
    }])

    assert.match(calendar, /SUMMARY:Open avond/)
    assert.match(calendar, /LOCATION:Scoutinggebouw/)
    assert.doesNotMatch(calendar, /Vertrouwelijke voorbereiding/)
    assert.doesNotMatch(calendar, /Ada|Grace|private@example\.com/)
    assert.doesNotMatch(calendar, /^ATTENDEE:/m)
    assert.doesNotMatch(calendar, /^DESCRIPTION:/m)
  })
})

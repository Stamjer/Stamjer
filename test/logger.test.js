import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRequestLogger, logEvent } from '../server/logger.js'

describe('group audit logging', () => {
  it('records group and actor metadata and excludes feed credentials from request logs', () => {
    const entries = []
    const previous = console.info
    console.info = (value) => entries.push(JSON.parse(value))
    try {
      let finish
      createRequestLogger()(
        { method: 'GET', originalUrl: '/api/calendar.ics?groupId=stam&token=private-secret' },
        { statusCode: 200, on(name, callback) { assert.equal(name, 'finish'); finish = callback } },
        () => {}
      )
      finish()
      logEvent({
        action: 'event-updated', actor: 4,
        metadata: { groupId: 'stam', eventId: 'one', role: 'developer', changedFields: 'title', token: 'private-secret' }
      })
    } finally {
      console.info = previous
    }
    assert.equal(entries[0].action, 'GET /api/calendar.ics')
    assert.equal(entries[1].actor, 4)
    assert.equal(entries[1].metadata.groupId, 'stam')
    assert.equal(entries[1].metadata.changedFields, 'title')
    assert.doesNotMatch(JSON.stringify(entries), /private-secret/)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bootstrapDeveloper } from '../api/developerBootstrap.js'
import { createMemoryDb } from '../test-support/memoryDb.js'

describe('developer bootstrap', () => {
  it('defaults to a read-only preview and creates a separate non-member when applied', async () => {
    const db = createMemoryDb({ users: [{ id: 5, role: 'admin', email: 'admin@example.com', password: 'unchanged' }] })
    const report = await bootstrapDeveloper(db, { email: 'developer@example.com' })
    assert.equal(report.id, 6)
    assert.equal(report.applied, false)
    assert.deepEqual(db.writes, [])
    assert.equal((await bootstrapDeveloper(db, { email: 'developer@example.com', apply: true })).applied, true)
    const developer = db.data.users[1]
    assert.equal(developer.groupId, null)
    assert.equal(developer.role, 'developer')
    assert.equal(developer.isAdmin, false)
    assert.match(developer.password, /^\$2/)
    assert.equal(db.data.users[0].password, 'unchanged')
  })
  it('refuses to promote an existing member or create a second bootstrap developer', async () => {
    for (const users of [
      [{ id: 1, email: 'DEVELOPER@example.com', role: 'admin' }],
      [{ id: 1, email: 'existing@example.com', role: 'developer' }]
    ]) {
      const db = createMemoryDb({ users })
      await assert.rejects(bootstrapDeveloper(db, { email: 'developer@example.com', apply: true }))
      assert.deepEqual(db.writes, [])
    }
  })
})

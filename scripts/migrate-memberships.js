import 'dotenv/config'
import { MongoClient } from 'mongodb'
import { readFile } from 'node:fs/promises'
import { migrateMemberships, verifyMembershipMigration } from '../server/membershipMigration.js'

// Never infer a target DB from the URI or silently use Stamjer.
const args = process.argv.slice(2)
const allowed = ['--preflight', '--dry-run', '--apply', '--verify', '--database', '--confirm-database', '--resolutions']
const valueFlags = new Set(['--database', '--confirm-database', '--resolutions'])
const options = {}
for (let i = 0; i < args.length; i++) {
  if (!allowed.includes(args[i])) throw new Error('Unknown option. Use --dry-run|--preflight|--apply|--verify --database NAME [--confirm-database NAME] [--resolutions FILE]')
  const flag = args[i]
  options[flag] = valueFlags.has(flag) ? args[++i] : true
  if (valueFlags.has(flag) && (!options[flag] || options[flag].startsWith('--'))) throw new Error(`Missing value: ${flag}`)
}
if (['--preflight', '--dry-run', '--apply', '--verify'].filter(f => options[f]).length > 1) throw new Error('Choose one operation')
const targetDatabase = options['--database']
if (!targetDatabase || !/^[A-Za-z0-9_-]+$/.test(targetDatabase)) throw new Error('Explicit --database NAME required')
if (options['--apply'] && options['--confirm-database'] !== targetDatabase) throw new Error('--apply requires matching --confirm-database NAME')
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required; no connection fallback')
const resolutions = options['--resolutions'] ? JSON.parse(await readFile(options['--resolutions'], 'utf8')) : {}
const client = new MongoClient(process.env.MONGODB_URI)
try {
  await client.connect()
  const db = client.db(targetDatabase)
  // Read-only topology check; this migration relies on transactional runtime.
  const topology = await client.db('admin').command({ hello: 1 })
  if (!topology.setName && topology.msg !== 'isdbgrid') throw new Error('Replica set/Atlas transaction support required')
  const report = options['--verify'] ? await verifyMembershipMigration(db) : await migrateMemberships(db, { apply: Boolean(options['--apply']), resolutions, confirmedDatabase: options['--confirm-database'] })
  console.info(JSON.stringify({ database: targetDatabase, ...report }, null, 2))
  if (report.errors?.length) process.exitCode = 1
} catch (error) {
  // MongoDB errors can contain connection details; only expose our safe errors.
  console.error(error.name === 'Error' ? error.message : `Migration failed (${error.codeName || error.name})`)
  process.exitCode = 1
} finally { await client.close() }

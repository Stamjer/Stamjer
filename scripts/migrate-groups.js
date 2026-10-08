import 'dotenv/config'
import { MongoClient } from 'mongodb'
import { migrateGroups } from '../server/groupMigration.js'

const flags = process.argv.slice(2)
if (flags.some((flag) => !['--apply', '--dry-run'].includes(flag)) || (flags.includes('--apply') && flags.includes('--dry-run'))) {
  console.error('Usage: node scripts/migrate-groups.js [--dry-run | --apply]')
  process.exitCode = 1
} else if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is required')
  process.exitCode = 1
} else {
  const client = new MongoClient(process.env.MONGODB_URI)
  try {
    await client.connect()
    const report = await migrateGroups(client.db('Stamjer'), {
      apply: flags.includes('--apply'),
      defaultSettings: {
        dailyChangeEmail: process.env.DAILY_CHANGE_EMAIL || 'stamjer.mpd@gmail.com',
        paymentRequestEmail: process.env.PAYMENT_REQUEST_EMAIL || 'stamjer.mpd@gmail.com'
      }
    })
    console.info(JSON.stringify(report, null, 2))
    if (report.errors.length) process.exitCode = 1
  } catch (error) {
    console.error(`Group migration failed (${error.codeName || error.name})`)
    process.exitCode = 1
  } finally {
    await client.close()
  }
}

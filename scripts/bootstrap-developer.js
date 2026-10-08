import 'dotenv/config'
import { MongoClient } from 'mongodb'
import { bootstrapDeveloper } from '../api/developerBootstrap.js'

const flags = process.argv.slice(2)
if (flags.some((flag) => !['--apply', '--dry-run'].includes(flag)) || (flags.includes('--apply') && flags.includes('--dry-run'))) {
  console.error('Usage: node scripts/bootstrap-developer.js [--dry-run | --apply] (set BOOTSTRAP_DEVELOPER_EMAIL)')
  process.exitCode = 1
} else if (!process.env.MONGODB_URI || !process.env.BOOTSTRAP_DEVELOPER_EMAIL) {
  console.error('MONGODB_URI and BOOTSTRAP_DEVELOPER_EMAIL are required')
  process.exitCode = 1
} else {
  const client = new MongoClient(process.env.MONGODB_URI)
  try {
    await client.connect()
    const result = await bootstrapDeveloper(client.db('Stamjer'), {
      email: process.env.BOOTSTRAP_DEVELOPER_EMAIL,
      firstName: process.env.BOOTSTRAP_DEVELOPER_FIRST_NAME || 'Developer',
      lastName: process.env.BOOTSTRAP_DEVELOPER_LAST_NAME || 'Stamjer',
      apply: flags.includes('--apply')
    })
    console.info(JSON.stringify(result, null, 2))
    if (result.applied) console.info('Account created. Use Wachtwoord vergeten with this email to set your password.')
  } catch (error) {
    console.error(error.code ? `Bootstrap failed (${error.codeName || error.code})` : error.message)
    process.exitCode = 1
  } finally { await client.close() }
}

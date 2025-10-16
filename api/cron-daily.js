import { performDailySnapshotAndComparison } from './index.js'

function isAuthorized(req) {
  const cronHeader = req.headers['x-vercel-cron']
  if (cronHeader) {
    return true
  }

  const secret = process.env.CRON_SECRET
  if (!secret) {
    return false
  }

  const providedSecret = req.query?.secret || req.headers['x-cron-secret'] || req.headers['authorization']
  if (!providedSecret) {
    return false
  }

  if (typeof providedSecret === 'string' && providedSecret.startsWith('Bearer ')) {
    return providedSecret.slice(7) === secret
  }

  if (Array.isArray(providedSecret)) {
    return providedSecret.some((value) => value === secret)
  }

  return providedSecret === secret
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    await performDailySnapshotAndComparison()
    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Daily snapshot cron failed:', error)
    const message = error && error.message ? error.message : 'Unknown error'
    res.status(500).json({ error: 'Failed to run daily snapshot', message })
  }
}

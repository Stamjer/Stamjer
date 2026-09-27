function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return undefined
  const safe = {}
  const allowedKeys = new Set([
    'environment', 'eventId', 'userId', 'targetUserId', 'participantId',
    'createdBy', 'changedBy', 'isAdmin', 'previousStatus', 'newStatus',
    'shouldBePresent', 'updatedEvents', 'action'
  ])
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowedKeys.has(key)) continue
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      safe[key] = value
    } else if (Array.isArray(value)) {
      safe[key] = `array(${value.length})`
    }
  }
  return Object.keys(safe).length ? safe : undefined
}

export function createRequestLogger() {
  return (req, res, next) => {
    const startedAt = Date.now()
    res.on('finish', () => {
      console.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        action: `${req.method} ${req.originalUrl}`,
        status: res.statusCode,
        durationMs: Date.now() - startedAt
      }))
    })
    next()
  }
}

export function logError(error, context = {}) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    action: context.action || context.path || 'server-error',
    status: context.status || 500,
    metadata: safeMetadata(context.metadata),
    errorMessage: error?.message || String(error)
  }))
}

export function logEvent(entry) {
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: entry.level || 'info',
    action: entry.action,
    actor: entry.actor,
    metadata: safeMetadata(entry.metadata)
  }))
}

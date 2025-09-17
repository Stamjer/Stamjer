/**
 * Simple audit logging helper that stores application actions in memory
 * and can send a daily digest via e-mail. Designed to run within the
 * single API process of the Stamjer application.
 */

const dailyLogs = []
let sendEmailImpl = null
let dailyTimer = null
let nextId = 1

const OMIT_BODY_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'code',
  'verificationCode',
  'resetCode'
])

function pushLog(entry) {
  dailyLogs.push({
    id: nextId++,
    timestamp: new Date().toISOString(),
    level: entry.level || 'info',
    action: entry.action,
    actor: entry.actor,
    status: entry.status,
    durationMs: entry.durationMs,
    metadata: entry.metadata,
    errorMessage: entry.errorMessage,
    errorStack: entry.errorStack
  })
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') {
    return null
  }

  const sanitized = {}
  for (const [key, value] of Object.entries(body)) {
    if (OMIT_BODY_KEYS.has(key)) continue
    if (value === undefined || value === null) continue

    if (Array.isArray(value)) {
      sanitized[key] = `array(${value.length})`
      continue
    }

    if (typeof value === 'object') {
      // Avoid dumping nested objects, just mention their keys
      const keys = Object.keys(value)
      if (keys.length > 0) {
        sanitized[key] = `object(${keys.join(',')})`
      }
      continue
    }

    sanitized[key] = value
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null
}

function extractActor(req) {
  if (!req) return undefined
  const { body, params, query, headers } = req

  if (body) {
    if (typeof body.email === 'string' && body.email.trim()) {
      return body.email.trim().toLowerCase()
    }
    if (body.userId) {
      return `userId=${body.userId}`
    }
    if (body.id) {
      return `id=${body.id}`
    }
  }

  if (params?.userId) {
    return `userId=${params.userId}`
  }
  if (params?.id) {
    return `id=${params.id}`
  }

  if (query) {
    if (typeof query.email === 'string' && query.email.trim()) {
      return query.email.trim().toLowerCase()
    }
    if (query.userId) {
      return `userId=${query.userId}`
    }
  }

  const headerUser = headers?.['x-user-email'] || headers?.['x-user-id']
  if (headerUser) {
    return Array.isArray(headerUser) ? headerUser[0] : headerUser
  }
  return undefined
}

export function createRequestLogger() {
  return (req, res, next) => {
    const start = Date.now()
    const actor = extractActor(req)
    const safeBody = sanitizeBody(req.body)

    const originalJson = res.json.bind(res)
    res.json = (body) => {
      res.locals.__responseBody = body
      return originalJson(body)
    }

    const originalSend = res.send.bind(res)
    res.send = (body) => {
      res.locals.__responseBody = body
      return originalSend(body)
    }

    res.on('finish', () => {
      const durationMs = Date.now() - start
      const status = res.statusCode
      const level = status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info'
      const responseBody = res.locals.__responseBody
      let errorMessage
      if (status >= 400) {
        if (responseBody && typeof responseBody === 'object') {
          errorMessage = responseBody.error || responseBody.message || responseBody.msg
        } else if (typeof responseBody === 'string') {
          errorMessage = responseBody.slice(0, 200)
        }
      }

      pushLog({
        level,
        action: `${req.method} ${req.originalUrl}`,
        actor,
        status,
        durationMs,
        metadata: safeBody,
        errorMessage
      })
    })

    next()
  }
}

export function logError(error, context = {}) {
  const message = error && error.message ? error.message : String(error)
  const stack = error && error.stack ? error.stack : undefined
  pushLog({
    level: 'error',
    action: context.action || context.path || 'server-error',
    actor: context.actor,
    status: context.status || 500,
    metadata: context.metadata ? sanitizeBody(context.metadata) : null,
    errorMessage: message,
    errorStack: stack
  })
}

function msUntilNextMidnight() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return next.getTime() - now.getTime()
}

function splitLogsByLevel(logs) {
  const grouped = { info: [], warning: [], error: [] }
  logs.forEach((log) => {
    const level = log.level || 'info'
    if (level === 'warning') {
      grouped.warning.push(log)
    } else if (level === 'error') {
      grouped.error.push(log)
    } else {
      grouped.info.push(log)
    }
  })
  return grouped
}

function formatLogLine(log) {
  const time = new Date(log.timestamp).toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const parts = [`[${time}] ${log.action}`]
  if (typeof log.status === 'number') {
    parts.push(`status: ${log.status}`)
  }
  if (log.actor) {
    parts.push(`door ${log.actor}`)
  }
  if (log.metadata) {
    try {
      parts.push(`details: ${JSON.stringify(log.metadata)}`)
    } catch {
      // ignore serialization errors
    }
  }
  if (log.errorMessage) {
    parts.push(`fout: ${log.errorMessage}`)
  }
  return parts.join(' | ')
}

function buildReportContent(logs, reportDate) {
  const grouped = splitLogsByLevel(logs)
  const dateLabel = reportDate.toLocaleDateString('nl-NL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const textSections = []
  const htmlSections = []

  const sections = [
    { label: 'Succesvolle acties', entries: grouped.info },
    { label: 'Waarschuwingen', entries: grouped.warning },
    { label: 'Fouten', entries: grouped.error }
  ]

  sections.forEach(({ label, entries }) => {
    textSections.push(`${label}:`)
    if (entries.length === 0) {
      textSections.push('  - Geen geregistreerde gebeurtenissen')
      htmlSections.push(`<h3>${label}</h3><p>Geen geregistreerde gebeurtenissen.</p>`)
    } else {
      entries.forEach((log) => {
        textSections.push(`  - ${formatLogLine(log)}`)
      })
      const listItems = entries.map((log) => `<li>${formatLogLine(log)}</li>`).join('\n')
      htmlSections.push(`<h3>${label}</h3><ul>${listItems}</ul>`)
    }
    textSections.push('')
  })

  const text = [`Dagrapport voor ${dateLabel}`, '', ...textSections].join('\n')
  const html = `
    <div>
      <h2>Dagrapport voor ${dateLabel}</h2>
      ${htmlSections.join('\n')}
    </div>
  `

  return { text, html }
}

async function sendDailyReport() {
  if (!sendEmailImpl) {
    return
  }

  const logsToSend = dailyLogs.splice(0, dailyLogs.length)
  const reportInstant = new Date(Date.now() - 1000) // just before midnight
  const { text, html } = buildReportContent(logsToSend, reportInstant)
  const subjectDate = reportInstant.toLocaleDateString('nl-NL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const subject = `Stamjer dagrapport - ${subjectDate}`

  try {
    await sendEmailImpl({ subject, text, html })
  } catch (error) {
    // Restore entries so they are not lost and log the failure
    logsToSend.forEach((entry) => dailyLogs.push(entry))
    pushLog({
      level: 'error',
      action: 'daily-report',
      status: 500,
      errorMessage: `Kon dagrapport niet versturen: ${error && error.message ? error.message : error}`
    })
  }
}

function scheduleNextReport() {
  if (dailyTimer) {
    clearTimeout(dailyTimer)
  }
  const timeout = msUntilNextMidnight()
  dailyTimer = setTimeout(async () => {
    await sendDailyReport()
    scheduleNextReport()
  }, timeout)
}

export function configureDailyReport({ sendEmail }) {
  sendEmailImpl = sendEmail
  scheduleNextReport()
}

export function logEvent(entry) {
  pushLog({ ...entry, level: entry.level || 'info' })
}

export function getCurrentLogSnapshot() {
  return dailyLogs.slice()
}

/* eslint-env node */
/**
 * ================================================================
 * ICALENDAR GENERATION - RFC 5545 COMPLIANT
 * ================================================================
 * 
 * Lightweight iCalendar feed generator without heavy dependencies.
 * Generates RFC 5545 compliant .ics files from event database.
 * 
 * Features:
 * - Clean, standards-compliant iCalendar format
 * - Database as single source of truth
 * - Extensible for future enhancements
 * - Proper line folding per RFC 5545
 * 
 * Included fields:
 * - UID: Unique event identifier
 * - DTSTART: Event start date/time
 * - DTEND: Event end date/time
 * - SUMMARY: Event title
 * - DESCRIPTION: Event description
 * - SEQUENCE: Event version number
 * 
 * @author R.S. Kort
 * @version 1.0.0
 */

/**
 * Escape special characters in iCalendar text values
 * Per RFC 5545, we need to escape: \ ; , newline
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeText(text) {
  if (!text) return ''
  return String(text)
    .replace(/\\/g, '\\\\')  // Backslash must be escaped first
    .replace(/;/g, '\\;')     // Semicolon
    .replace(/,/g, '\\,')     // Comma
    .replace(/\n/g, '\\n')    // Newline
}

/**
 * Fold long lines per RFC 5545 (max 75 octets per line)
 * Continuation lines start with a space
 * @param {string} line - Line to fold
 * @returns {string} Folded line
 */
function foldLine(line) {
  if (line.length <= 75) return line
  
  const lines = []
  let remaining = line
  
  // First line can be 75 chars
  lines.push(remaining.substring(0, 75))
  remaining = remaining.substring(75)
  
  // Subsequent lines are 74 chars (to account for leading space)
  while (remaining.length > 0) {
    lines.push(' ' + remaining.substring(0, 74))
    remaining = remaining.substring(74)
  }
  
  return lines.join('\r\n')
}

const DEFAULT_TIMEZONE = 'Europe/Amsterdam'
const ISO_NAIVE_DATETIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?(?:\.\d+)?$/
const ISO_OFFSET_DATETIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?(?:\.\d+)?([+-]\d{2}:?\d{2}|Z)$/

/**
 * Format a date for iCalendar (UTC)
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date in YYYYMMDDTHHMMSSZ format
 */
function formatICalDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date provided to formatICalDate')
  }
  
  // Format as UTC: YYYYMMDDTHHMMSSZ
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hours = String(d.getUTCHours()).padStart(2, '0')
  const minutes = String(d.getUTCMinutes()).padStart(2, '0')
  const seconds = String(d.getUTCSeconds()).padStart(2, '0')
  
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`
}

/**
 * Extract YYYYMMDDTHHMMSS parts for the configured timezone.
 * When the source date string omits an offset, it is treated as local
 * Europe/Amsterdam time to ensure Dutch schedules remain correct.
 * @param {string|Date} date - Source date value
 * @param {string} timeZone - IANA timezone identifier
 * @returns {string} Local datetime string formatted as YYYYMMDDTHHMMSS
 */
function formatICalDateInTimeZone(date, timeZone = DEFAULT_TIMEZONE) {
  if (!date) {
    throw new Error('Missing date provided to formatICalDateInTimeZone')
  }

  if (typeof date === 'string') {
    const trimmed = date.trim()

    // Treat ISO strings without explicit timezone as local Dutch time.
    const naiveMatch = ISO_NAIVE_DATETIME_REGEX.exec(trimmed)
    if (naiveMatch && !ISO_OFFSET_DATETIME_REGEX.test(trimmed)) {
      const [, year, month, day, hour = '00', minute = '00', second = '00'] = naiveMatch
      return `${year}${month}${day}T${hour}${minute}${second}`
    }

    // Date strings containing offsets or 'Z' are interpreted as instant.
  }

  const parsed = date instanceof Date ? date : new Date(date)

  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date provided to formatICalDateInTimeZone')
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  const parts = formatter.formatToParts(parsed).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value
    }
    return acc
  }, {})

  const { year, month, day, hour, minute, second } = parts

  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error('Failed to derive timezone-aware datetime parts')
  }

  return `${year}${month}${day}T${hour}${minute}${second}`
}

/**
 * Format a date-only value for iCalendar (for all-day events)
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date in YYYYMMDD format
 */
function formatICalDateOnly(date) {
  const d = date instanceof Date ? date : new Date(date)
  
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date provided to formatICalDateOnly')
  }
  
  // For all-day events, use local date (not UTC)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  
  return `${year}${month}${day}`
}

/**
 * Generate a single VEVENT component
 * @param {Object} event - Event object from database
 * @returns {string} VEVENT component
 */
function generateVEvent(event) {
  const lines = []
  
  lines.push('BEGIN:VEVENT')
  
  // UID (required) - Use the event ID as unique identifier
  const uid = `${event.id}@stamjer.nl`
  lines.push(foldLine(`UID:${uid}`))
  
  // DTSTART (required)
  if (event.allDay) {
    // All-day events use VALUE=DATE
    const startDate = formatICalDateOnly(event.start)
    lines.push(foldLine(`DTSTART;VALUE=DATE:${startDate}`))
  } else {
    // Timed events assume Dutch timezone
    const startDate = formatICalDateInTimeZone(event.start, DEFAULT_TIMEZONE)
    lines.push(foldLine(`DTSTART;TZID=${DEFAULT_TIMEZONE}:${startDate}`))
  }
  
  // DTEND (required)
  if (event.end) {
    if (event.allDay) {
      const endDate = formatICalDateOnly(event.end)
      lines.push(foldLine(`DTEND;VALUE=DATE:${endDate}`))
    } else {
      const endDate = formatICalDateInTimeZone(event.end, DEFAULT_TIMEZONE)
      lines.push(foldLine(`DTEND;TZID=${DEFAULT_TIMEZONE}:${endDate}`))
    }
  } else {
    // If no end date, use start date
    if (event.allDay) {
      // For all-day events without end, add one day
      const start = new Date(event.start)
      start.setDate(start.getDate() + 1)
      const endDate = formatICalDateOnly(start)
      lines.push(foldLine(`DTEND;VALUE=DATE:${endDate}`))
    } else {
      const endDate = formatICalDateInTimeZone(event.start, DEFAULT_TIMEZONE)
      lines.push(foldLine(`DTEND;TZID=${DEFAULT_TIMEZONE}:${endDate}`))
    }
  }
  
  // SUMMARY (title)
  if (event.title) {
    const summary = escapeText(event.title)
    lines.push(foldLine(`SUMMARY:${summary}`))
  }
  
  // LOCATION (separate field, not in description)
  if (event.location) {
    const location = escapeText(event.location)
    lines.push(foldLine(`LOCATION:${location}`))
  }
  
  // DESCRIPTION (build from description and opkomstmakers only)
  let description = ''
  
  if (event.description) {
    description = event.description
  }
  
  // Add opkomstmakers to description if it's an opkomst
  if (event.isOpkomst && event.opkomstmakers) {
    if (description) {
      description += '\n\nOpkomstmakers: ' + event.opkomstmakers
    } else {
      description = 'Opkomstmakers: ' + event.opkomstmakers
    }
  }
  
  if (description) {
    const escapedDescription = escapeText(description)
    lines.push(foldLine(`DESCRIPTION:${escapedDescription}`))
  }
  
  // SEQUENCE (version number for updates)
  // Start at 0, can be incremented for event updates
  const sequence = event.sequence || 0
  lines.push(foldLine(`SEQUENCE:${sequence}`))
  
  // DTSTAMP (when this entry was created/modified)
  const now = formatICalDate(new Date())
  lines.push(foldLine(`DTSTAMP:${now}`))
  
  lines.push('END:VEVENT')
  
  return lines.join('\r\n')
}

/**
 * Generate complete iCalendar feed from events array
 * @param {Array} events - Array of event objects
 * @returns {string} Complete iCalendar file content
 */
export function generateICalendar(events) {
  const lines = []
  
  // VCALENDAR header
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//Stamjer//Stamjer Agenda//NL')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')
  lines.push('X-WR-CALNAME:Stamjer Agenda')
  lines.push('X-WR-TIMEZONE:Europe/Amsterdam')
  lines.push('X-WR-CALDESC:Stamjer evenementen en opkomsten')
  
  // Add timezone information
  lines.push('BEGIN:VTIMEZONE')
  lines.push('TZID:Europe/Amsterdam')
  lines.push('BEGIN:DAYLIGHT')
  lines.push('TZOFFSETFROM:+0100')
  lines.push('TZOFFSETTO:+0200')
  lines.push('TZNAME:CEST')
  lines.push('DTSTART:19700329T020000')
  lines.push('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU')
  lines.push('END:DAYLIGHT')
  lines.push('BEGIN:STANDARD')
  lines.push('TZOFFSETFROM:+0200')
  lines.push('TZOFFSETTO:+0100')
  lines.push('TZNAME:CET')
  lines.push('DTSTART:19701025T030000')
  lines.push('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU')
  lines.push('END:STANDARD')
  lines.push('END:VTIMEZONE')
  
  // Generate VEVENT for each event
  if (events && Array.isArray(events)) {
    for (const event of events) {
      try {
        const vevent = generateVEvent(event)
        lines.push(vevent)
      } catch (error) {
        // Log error but continue with other events
        console.error(`Error generating VEVENT for event ${event?.id}:`, error)
      }
    }
  }
  
  // VCALENDAR footer
  lines.push('END:VCALENDAR')
  
  return lines.join('\r\n')
}

/**
 * Create iCalendar response middleware
 * Fetches events from database and returns iCalendar format
 * @param {Function} getEventsFromDb - Function to fetch events from database
 * @returns {Function} Express middleware
 */
export function createICalendarHandler(getEventsFromDb) {
  return async (req, res) => {
    try {
      // Fetch events from database
      const events = await getEventsFromDb()
      
      // Generate iCalendar
      const icalContent = generateICalendar(events)
      
      // Set appropriate headers for .ics file
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
      res.setHeader('Content-Disposition', 'inline; filename="stamjer.ics"')
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      res.setHeader('Pragma', 'no-cache')
      res.setHeader('Expires', '0')
      
      // Send the iCalendar content
      res.send(icalContent)
    } catch (error) {
      console.error('Error generating iCalendar feed:', error)
      res.status(500).json({ 
        error: 'Failed to generate calendar feed',
        message: error.message 
      })
    }
  }
}

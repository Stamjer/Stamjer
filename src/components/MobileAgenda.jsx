import React, { useMemo } from 'react'
import './MobileAgenda.css'

function startOfMonth(date) {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0,0,0,0)
  return d
}

function endOfMonth(date) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  d.setHours(23,59,59,999)
  return d
}

function formatMonthTitle(date) {
  return date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
}

function capitalize(word) {
  if (!word) return word
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function formatDayHeader(date) {
  const weekdayFull = date.toLocaleDateString('nl-NL', { weekday: 'long' }) // vrijdag
  const day = date.getDate() // 12
  const month = date.toLocaleDateString('nl-NL', { month: 'long' }) // september (lowercase)
  // Capitalize weekday only, keep month lowercase
  return `${capitalize(weekdayFull)} ${day} ${month}`
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function expandAllDaySpan(event, monthStart, monthEnd) {
  // If not all-day or no end, just return start date if within range
  if (!event.allDay || !event.end) {
    const s = new Date(event.start)
    if (s >= monthStart && s <= monthEnd) return [s]
    return []
  }
  // For all-day with end (exclusive in many APIs), include each day in the span
  const s = new Date(event.start)
  const e = new Date(event.end)
  // Clamp to month boundaries
  const from = new Date(Math.max(s.getTime(), monthStart.getTime()))
  const to = new Date(Math.min(e.getTime() - (event.allDay ? 1 : 0), monthEnd.getTime()))
  const days = []
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d))
  }
  return days
}

export default function MobileAgenda({
  events = [],
  viewDate,
  onPrev,
  onToday,
  onNext,
  onEventClick,
}) {
  const monthStart = useMemo(() => startOfMonth(viewDate), [viewDate])
  const monthEnd = useMemo(() => endOfMonth(viewDate), [viewDate])

  // Group events by day within the month
  const eventsByDay = useMemo(() => {
    const map = new Map()
    const add = (d, ev) => {
      const key = d.toISOString().slice(0, 10)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(ev)
    }
    events.forEach(ev => {
      if (ev.allDay) {
        const days = expandAllDaySpan(ev, monthStart, monthEnd)
        days.forEach(day => add(day, ev))
      } else {
        const s = new Date(ev.start)
        if (s >= monthStart && s <= monthEnd) add(s, ev)
      }
    })
    // Sort each day's events by start time
    for (const [k, list] of map.entries()) {
      list.sort((a, b) => new Date(a.start) - new Date(b.start))
    }
    return map
  }, [events, monthStart, monthEnd])

  const dayKeysSorted = useMemo(() => Array.from(eventsByDay.keys()).sort(), [eventsByDay])

  // Collapsible state per day (default collapsed for past days)
  const today = new Date()
  today.setHours(0,0,0,0)
  const initialCollapsed = useMemo(() => {
    const map = new Map()
    dayKeysSorted.forEach(key => {
      const d = new Date(key)
      d.setHours(0,0,0,0)
      map.set(key, d < today)
    })
    return map
  }, [dayKeysSorted])

  const [collapsedMap, setCollapsedMap] = React.useState(initialCollapsed)

  const toggleDay = (key) => {
    setCollapsedMap(prev => {
      const next = new Map(prev)
      next.set(key, !prev.get(key))
      return next
    })
  }

  return (
    <div className="mobile-agenda">
      <div className="mobile-agenda-header">
        <div className="title" aria-live="polite">{formatMonthTitle(monthStart)}</div>
        <div className="controls">
          <button type="button" className="ctrl-btn" onClick={onPrev} aria-label="Vorige maand">«</button>
          <button type="button" className="ctrl-btn today" onClick={onToday}>Vandaag</button>
          <button type="button" className="ctrl-btn" onClick={onNext} aria-label="Volgende maand">»</button>
        </div>
      </div>

      {dayKeysSorted.length === 0 && (
        <div className="empty">Geen evenementen deze maand</div>
      )}

      <div className="days">
        {dayKeysSorted.map(key => {
          const date = new Date(key)
          const list = eventsByDay.get(key) || []
          const isToday = isSameDay(date, new Date())
          const isCollapsed = collapsedMap.get(key)
          return (
            <section key={key} className={`day-section ${isCollapsed ? 'collapsed' : ''}`} aria-label={date.toLocaleDateString('nl-NL')}>
              <button type="button" className={`day-header ${isToday ? 'today' : ''}`} onClick={() => toggleDay(key)} aria-expanded={!isCollapsed}>
                <div className="dot" aria-hidden="true"></div>
                <div className="label">{formatDayHeader(date)}</div>
                <div className={`chevron ${isCollapsed ? '' : 'open'}`} aria-hidden="true">▾</div>
              </button>
              {!isCollapsed && (
              <ul className="event-list">
                {list.map(ev => {
                  const isOpkomst = !!ev.extendedProps?.isOpkomst
                  const isSchoonmaak = !!ev.extendedProps?.isSchoonmaak
                  const timed = !ev.allDay && ev.start
                  const start = timed ? new Date(ev.start) : null
                  const end = timed && ev.end ? new Date(ev.end) : null
                  const timeText = timed ? `${start.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false})}${end ? ` – ${end.toLocaleTimeString('nl-NL', {hour:'2-digit', minute:'2-digit', hour12:false})}` : ''}` : 'Hele dag'
                  return (
                    <li key={ev.id} className={`event-card ${isOpkomst ? 'opkomst' : ''} ${isSchoonmaak ? 'schoonmaak' : ''}`}>
                      <button type="button" className="event-button" onClick={() => onEventClick && onEventClick({ event: ev })}>
                        <div className="event-main">
                          <div className="event-header">
                            <div className="event-title" title={ev.title}>{ev.title}</div>
                            <div className="event-time" aria-hidden={!timed}>{timeText}</div>
                          </div>
                          {ev.extendedProps?.location && (
                            <div className="event-meta">{ev.extendedProps.location}</div>
                          )}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

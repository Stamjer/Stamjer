import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { withSupportContact } from '../config/appInfo'
import { useIsMobile } from '../hooks/useDeviceDetection'
import LocationLink from '../components/LocationLink'
import './StrepenPage.css'

function capitalizeWeekday(dateStr) {
  const date = new Date(dateStr)
  const formatted = date.toLocaleDateString('nl-NL', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric'
  })
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

// ================================================================
// TOAST NOTIFICATION COMPONENT
// ================================================================

function Toast({ message, type = 'info', onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000)
    return () => clearTimeout(timer)
  }, [onClose])

  const icons = {
    success: '✅',
    error:   '❌',
    warning: '⚠️',
    info:    'ℹ️'
  }

  return (
    <div className={`toast toast-${type}`} role="alert">
      <span className="toast-icon">{icons[type]}</span>
      <span className="toast-message">{message}</span>
      <button
        className="toast-close"
        onClick={onClose}
        aria-label="Notificatie sluiten"
      >
        ×
      </button>
    </div>
  )
}

export default function StrepenPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [events, setEvents] = useState([])
  const [users, setUsers] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [attendance, setAttendance] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const isMobile = useIsMobile()
  const [query, setQuery] = useState('')
  const [showOnlyParticipants, setShowOnlyParticipants] = useState(false)
  const [showOnlyChanged, setShowOnlyChanged] = useState(false)
  const [liveMsg, setLiveMsg] = useState('')

  // Toast functions
  const showToast = useCallback((message, type = 'info') => {
    const normalizedMessage = typeof message === 'string' ? message.trim() : ''
    const finalMessage = type === 'error'
      ? withSupportContact(normalizedMessage)
      : (normalizedMessage || 'Er is een melding beschikbaar')
    setToast({ message: finalMessage, type })
  }, [])

  const hideToast = useCallback(() => {
    setToast(null)
  }, [])

  // Get user from localStorage
  useEffect(() => {
    try {
      const userData = JSON.parse(localStorage.getItem('user'))
      if (!userData || !userData.isAdmin) {
        navigate('/login')
        return
      }
      setUser(userData)
    } catch {
      navigate('/login')
    }
  }, [navigate])

  // Track mobile viewport
  // Load events and users
  useEffect(() => {
    const loadData = async () => {
      try {
        const eventsRes = await fetch('/api/events')
        if (!eventsRes.ok) throw new Error('Kon opkomsten niet laden')
        const { events: all } = await eventsRes.json()

        const opkomsten = all
          .filter(ev => ev.isOpkomst)
          .sort((a, b) => new Date(a.start) - new Date(b.start))
        setEvents(opkomsten)

        const usersRes = await fetch('/api/users/full')
        if (!usersRes.ok) throw new Error('Kon gebruikers niet laden')
        const { users: fullUsers } = await usersRes.json()
        setUsers(fullUsers)

        if (opkomsten.length > 0) {
          const today = new Date()
          today.setHours(0, 0, 0, 0)

          let def = opkomsten.find(ev => {
            const d = new Date(ev.start)
            d.setHours(0, 0, 0, 0)
            return d.getTime() === today.getTime()
          })
          if (!def) def = opkomsten.find(ev => new Date(ev.start) >= today)
          if (!def) def = opkomsten[opkomsten.length - 1]
          setSelectedEvent(def)
        }
      } catch (err) {
        console.error(err)
        setError(withSupportContact('Kon gegevens niet laden'))
      } finally {
        setIsLoading(false)
      }
    }

    if (user) loadData()
  }, [user])

  // Initialize attendance state when event changes
  useEffect(() => {
    if (!selectedEvent || users.length === 0) return

    const existing = selectedEvent.attendance || {}
    const next = {}

    users.forEach(u => {
      const uid = u.id.toString()
      const isPart = selectedEvent.participants.includes(u.id)

      if (Object.prototype.hasOwnProperty.call(existing, uid)) {
        const val = existing[uid]
        if (typeof val === 'object' && 'present' in val) {
          next[u.id] = Boolean(val.present)
        } else {
          next[u.id] = Boolean(val)
        }
      } else {
        next[u.id] = isPart
      }
    })

    setAttendance(next)
  }, [selectedEvent, users])

  // Toggle updates local state and saves automatically
  const handleAttendanceToggle = async (u) => {
    if (isSaving) return // Prevent multiple simultaneous saves
    
    setIsSaving(true)
    
    // Update local state first for immediate UI feedback
    const newAttendance = { ...attendance, [u.id]: !attendance[u.id] }
    setAttendance(newAttendance)
    
    // aria-live message for accessibility
    const status = newAttendance[u.id] ? 'aanwezig' : 'afwezig'
    setLiveMsg(`${u.firstName} gemarkeerd als ${status}`)
    
    try {
      const res = await fetch(`/api/events/${selectedEvent.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ attendance: newAttendance })
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || 'Save failed')
      }
      await res.json()
      setSelectedEvent(ev => ({ ...ev, attendance: newAttendance }))
      
      // reload streepjes
      const usersRes = await fetch('/api/users/full')
      if (usersRes.ok) {
        const { users: fresh } = await usersRes.json()
        setUsers(fresh)
      }
      showToast(`${u.firstName} ${status} - opgeslagen!`, 'success')
    } catch (err) {
      console.error(err)
      // Revert the local state on error
      setAttendance(attendance)
      const baseMessage = err?.message ? `Opslaan van aanwezigheid is mislukt: ${err.message}` : 'Opslaan van aanwezigheid is mislukt'
      showToast(baseMessage, 'error')
    } finally {
      setIsSaving(false)
    }
  }
  if (isLoading) {
    return (
      <div className="strepen-page-wrapper">
        <div className="strepen-page">
          <div className="loading-state">
            <div className="loading-content">
              <div className="loading-spinner"></div>
              <h2>Streeplijst laden...</h2>
              <p>Even geduld terwijl we de streeplijst ophalen.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }
  if (error) {
    return <div className="strepen-page-wrapper"><div className="strepen-page"><div className="error">Fout: {error}</div></div></div>
  }
  if (!selectedEvent) {
    return <div className="strepen-page-wrapper"><div className="strepen-page"><div className="no-events">Geen opkomsten gevonden</div></div></div>
  }

  const sortedUsers = [...users].sort((a, b) => {
    const aP = selectedEvent.participants.includes(a.id)
    const bP = selectedEvent.participants.includes(b.id)
    if (aP && !bP) return -1
    if (!aP && bP) return 1
    return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
  })

  const filteredUsers = sortedUsers.filter(u => {
    const name = `${u.firstName} ${u.lastName || ''}`.toLowerCase()
    const matchesQuery = !query.trim() || name.includes(query.trim().toLowerCase())
    const isPart = selectedEvent.participants.includes(u.id)
    const satisfiesPart = showOnlyParticipants ? isPart : true
    const isChanged = attendance[u.id] !== isPart
    const satisfiesChanged = showOnlyChanged ? isChanged : true
    return matchesQuery && satisfiesPart && satisfiesChanged
  })

  return (
    <div className="strepen-page-wrapper">
      <div className="strepen-page">
        {/* aria-live region for toggle feedback */}
        <div className="visually-hidden" aria-live="polite">{liveMsg}</div>

        {/* Mobile header with selector + filters */}
        {isMobile ? (
          <div className="strepen-mobile-header">
            <div className="mobile-controls">
              <label htmlFor="event-select" className="sr-only">Selecteer opkomst</label>
              <select
                id="event-select"
                value={selectedEvent.id}
                onChange={e => {
                  const ev = events.find(x => x.id === e.target.value)
                  setSelectedEvent(ev)
                }}
                className="mobile-select"
                aria-label="Selecteer opkomst"
              >
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {capitalizeWeekday(ev.start)}
                  </option>
                ))}
              </select>

              <div className="mobile-search">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Zoek op naam..."
                  aria-label="Zoek op naam"
                />
              </div>

              <div className="filter-chips" role="group" aria-label="Filters">
                <button
                  type="button"
                  className={`chip ${showOnlyParticipants ? 'active' : ''}`}
                  onClick={() => setShowOnlyParticipants(v => !v)}
                >
                  Aangemeld
                </button>
                <button
                  type="button"
                  className={`chip ${showOnlyChanged ? 'active' : ''}`}
                  onClick={() => setShowOnlyChanged(v => !v)}
                >
                  Gewijzigd
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <section className="event-selector">
              <label htmlFor="event-select">Selecteer opkomst:</label>
              <select
                id="event-select"
                value={selectedEvent.id}
                onChange={e => {
                  const ev = events.find(x => x.id === e.target.value)
                  setSelectedEvent(ev)
                }}
              >
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {capitalizeWeekday(ev.start)}
                  </option>
                ))}
              </select>
            </section>

            <section className="event-info">
              <h2>{selectedEvent.title}</h2>
              <p>📅 {capitalizeWeekday(selectedEvent.start)}</p>
              {selectedEvent.location && (
                <p><LocationLink location={selectedEvent.location} showIcon={false} /></p>
              )}
              <p>👥 Opkomstmakers: {selectedEvent.opkomstmakers}</p>
            </section>
          </>
        )}

        {/* Mobile user list */}
        {isMobile ? (
          <div className="mobile-user-list">
            {filteredUsers.map(u => {
              const isPart = selectedEvent.participants.includes(u.id)
              const present = Boolean(attendance[u.id])
              const isChanged = present !== isPart
              return (
                <div key={u.id} className={`user-card ${isPart ? 'participant' : 'non-participant'} ${isChanged ? 'modified' : ''}`}>
                  <div className="user-card-main">
                    <div className="user-name">
                      {u.firstName} {u.lastName}
                      {isChanged && <span className="changed-dot" aria-hidden="true"></span>}
                    </div>
                    <div className="user-meta">
                      <span className={`pill ${isPart ? 'pill-yes' : 'pill-no'}`}>{isPart ? 'Aangemeld' : 'Afgemeld'}</span>
                      <span className="pill pill-streepjes">{u.streepjes || 0} streepjes</span>
                    </div>
                  </div>
                  <div className="user-card-action">
                    <input
                      type="checkbox"
                      id={`toggle-${u.id}`}
                      checked={present}
                      onChange={() => handleAttendanceToggle(u)}
                      disabled={isSaving}
                      className="toggle-input"
                    />
                    <label htmlFor={`toggle-${u.id}`} className="toggle-switch">
                      <div className="switch-ball"></div>
                    </label>
                    <div className="toggle-label" aria-hidden="true">
                      {isSaving ? 'Opslaan...' : (present ? 'Aanwezig' : 'Afwezig')}
                    </div>
                  </div>
                </div>
              )
            })}
            {filteredUsers.length === 0 && (
              <div className="empty-state">Geen resultaten voor je filters</div>
            )}
          </div>
        ) : (
          // Desktop table stays intact
          <div className="attendance-table">
            <div className="table-header">
              <div className="header-cell name">Naam</div>
              <div className="header-cell status">Aangemeld</div>
              <div className="header-cell toggle">Aanwezigheid</div>
              <div className="header-cell streepjes">Streepjes</div>
            </div>
            {sortedUsers.map(u => {
              const isPart = selectedEvent.participants.includes(u.id)
              const present = Boolean(attendance[u.id])
              const defaultState = present === isPart

              return (
                <div
                  key={u.id}
                  className={`table-row ${isPart ? 'participant' : 'non-participant'} ${
                    defaultState ? 'default-state' : 'modified-state'
                  }`}
                >
                  <div className="cell name">
                    {u.firstName}{!defaultState && <span className="modified-indicator"> *</span>}
                    {isSaving && <span className="saving-indicator"> (opslaan...)</span>}
                  </div>
                  <div className="cell status">{isPart ? '✅' : '❌'}</div>
                  <div className="cell toggle">
                    <input
                      type="checkbox"
                      id={`toggle-${u.id}`}
                      checked={present}
                      onChange={() => handleAttendanceToggle(u)}
                      disabled={isSaving}
                      className="toggle-input"
                    />
                    <label htmlFor={`toggle-${u.id}`} className="toggle-switch">
                      <div className="switch-ball"></div>
                    </label>
                  </div>
                  <div className="cell streepjes">{u.streepjes || 0}</div>
                </div>
              )
            })}
          </div>
        )}

        {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
      </div>
    </div>
  )
}

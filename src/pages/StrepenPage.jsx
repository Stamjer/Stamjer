import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
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

  // Toast functions
  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type })
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

  // Load events and users
  useEffect(() => {
    const loadData = async () => {
      try {
        const eventsRes = await fetch('/api/events')
        if (!eventsRes.ok) throw new Error('Failed to load events')
        const { events: all } = await eventsRes.json()

        const opkomsten = all
          .filter(ev => ev.isOpkomst)
          .sort((a, b) => new Date(a.start) - new Date(b.start))
        setEvents(opkomsten)

        const usersRes = await fetch('/api/users/full')
        if (!usersRes.ok) throw new Error('Failed to load users')
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
        setError('Failed to load data')
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

  // Toggle only updates local state
  const handleAttendanceToggle = (userId) => {
    setAttendance(prev => ({
      ...prev,
      [userId]: !prev[userId]
    }))
  }

  // Explicit save via button
  const handleSaveAttendance = async () => {
    if (!selectedEvent) return

    setIsSaving(true)
    try {
      const res = await fetch(`/api/events/${selectedEvent.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ attendance })
      })
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || 'Save failed')
      }
      const updated = await res.json()
      setSelectedEvent(ev => ({ ...ev, attendance }))
      // reload streepjes
      const usersRes = await fetch('/api/users/full')
      if (usersRes.ok) {
        const { users: fresh } = await usersRes.json()
        setUsers(fresh)
      }
      showToast('Aanwezigheid succesvol opgeslagen!', 'success')
    } catch (err) {
      console.error(err)
      showToast(`Fout bij opslaan: ${err.message}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <div className="strepen-page"><div className="loading">Laden...</div></div>
  }
  if (error) {
    return <div className="strepen-page"><div className="error">Fout: {error}</div></div>
  }
  if (!selectedEvent) {
    return <div className="strepen-page"><div className="no-events">Geen opkomsten gevonden</div></div>
  }

  const sortedUsers = [...users].sort((a, b) => {
    const aP = selectedEvent.participants.includes(a.id)
    const bP = selectedEvent.participants.includes(b.id)
    if (aP && !bP) return -1
    if (!aP && bP) return 1
    return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
  })

  return (
    <div className="strepen-page">
      <header className="strepen-header">
        <h1>Strepen</h1>
      </header>

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
              {capitalizeWeekday(ev.start)} - {ev.title}
            </option>
          ))}
        </select>
      </section>

      <section className="event-info">
        <h2>{selectedEvent.title}</h2>
        <p>📅 {capitalizeWeekday(selectedEvent.start)}</p>
        <p>👥 Opkomstmakers: {selectedEvent.opkomstmakers}</p>
      </section>

      <div className="attendance-table">
        <div className="table-header">
          <div className="header-cell name">Naam</div>
          <div className="header-cell status">Aangemeld</div>
          <div className="header-cell toggle">Aanwezigheid</div>
          <div className="header-cell streepjes">Streepjes</div>
        </div>
        {sortedUsers.map(u => {
          const isPart = selectedEvent.participants.includes(u.id)
          const present = attendance[u.id]
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
              </div>
              <div className="cell status">{isPart ? '✅' : '❌'}</div>
              <div className="cell toggle">
                <input
                  type="checkbox"
                  id={`toggle-${u.id}`}
                  checked={present}
                  onChange={() => handleAttendanceToggle(u.id)}
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

      <div className="save-section">
        <button
          className="save-button"
          onClick={handleSaveAttendance}
          disabled={isSaving}
        >
          {isSaving ? 'Opslaan...' : 'Opslaan'}
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}
    </div>
  )
}

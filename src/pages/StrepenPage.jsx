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
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
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
    console.log('Showing toast:', message, type)
    setToast({ message, type })
  }, [])

  const hideToast = useCallback(() => {
    console.log('Hiding toast')
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
        // Load events
        const eventsResponse = await fetch('/api/events')
        if (!eventsResponse.ok) throw new Error('Failed to load events')
        const eventsData = await eventsResponse.json()
        
        // Filter only opkomsten and sort by date
        const opkomsten = eventsData.events
          .filter(event => event.isOpkomst)
          .sort((a, b) => new Date(a.start) - new Date(b.start))
        
        setEvents(opkomsten)

        // Load users
        const usersResponse = await fetch('/api/users/full')
        if (!usersResponse.ok) throw new Error('Failed to load users')
        const usersData = await usersResponse.json()
        setUsers(usersData.users)

        // Select default event (first upcoming or today's opkomst)
        if (opkomsten.length > 0) {
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          
          // Find today's opkomst first
          let defaultEvent = opkomsten.find(event => {
            const eventDate = new Date(event.start)
            eventDate.setHours(0, 0, 0, 0)
            return eventDate.getTime() === today.getTime()
          })
          
          // If no opkomst today, find the next upcoming one
          if (!defaultEvent) {
            defaultEvent = opkomsten.find(event => {
              const eventDate = new Date(event.start)
              return eventDate >= today
            })
          }
          
          // If no upcoming opkomst, take the most recent one
          if (!defaultEvent) {
            defaultEvent = opkomsten[opkomsten.length - 1]
          }
          
          setSelectedEvent(defaultEvent)
        }
      } catch (err) {
        console.error('Error loading data:', err)
        setError('Failed to load data')
      } finally {
        setIsLoading(false)
      }
    }

    if (user) {
      loadData()
    }
  }, [user])

  // Initialize attendance state when event changes
  useEffect(() => {
    if (selectedEvent && users.length > 0) {
      // Load existing attendance from the event, or initialize with defaults
      const existingAttendance = selectedEvent.attendance || {}
      const newAttendance = {}
      
      users.forEach(user => {
        const isParticipant = selectedEvent.participants.includes(user.id)
        
        // Use existing attendance if available, otherwise use defaults
        if (existingAttendance[user.id]) {
          newAttendance[user.id] = existingAttendance[user.id]
        } else {
          newAttendance[user.id] = {
            present: isParticipant, // Pre-select 'present' if they're a participant
            absent: !isParticipant  // Pre-select 'absent' if they're not a participant
          }
        }
      })
      
      setAttendance(newAttendance)
    }
  }, [selectedEvent, users]) // Add users back since we need to check for existing attendance

  const handleAttendanceChange = (userId, type) => {
    setAttendance(prev => {
      const currentStatus = prev[userId] || { present: false, absent: false }
      
      if (type === 'present') {
        // If clicking present and it's already selected, deselect it
        // If clicking present and it's not selected, select it and deselect absent
        const newPresent = !currentStatus.present
        return {
          ...prev,
          [userId]: {
            present: newPresent,
            absent: newPresent ? false : currentStatus.absent
          }
        }
      } else if (type === 'absent') {
        // If clicking absent and it's already selected, deselect it
        // If clicking absent and it's not selected, select it and deselect present
        const newAbsent = !currentStatus.absent
        return {
          ...prev,
          [userId]: {
            present: newAbsent ? false : currentStatus.present,
            absent: newAbsent
          }
        }
      }
      
      return prev
    })
  }

  const handleSaveAttendance = async () => {
    if (!selectedEvent) return
    
    setIsSaving(true)
    try {
      console.log('📊 Saving attendance for event:', selectedEvent.id)
      console.log('📊 Attendance data:', attendance)
      
      // Save attendance to the event
      const response = await fetch(`/api/events/${selectedEvent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attendance
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ Failed to save attendance:', errorText)
        throw new Error(`Failed to save attendance: ${errorText}`)
      }
      
      const result = await response.json()
      console.log('✅ Successfully saved attendance:', result)
      
      // Update the local selected event with the new attendance
      setSelectedEvent(prev => ({
        ...prev,
        attendance
      }))
      
      // Reload users to get updated streepjes count
      const usersResponse = await fetch('/api/users/full')
      if (usersResponse.ok) {
        const usersData = await usersResponse.json()
        setUsers(usersData.users)
      }

      // Show success toast
      showToast('Aanwezigheid succesvol opgeslagen!', 'success')
    } catch (err) {
      console.error('Error saving attendance:', err)
      // Show error toast
      showToast(`Fout bij het opslaan van aanwezigheid: ${err.message}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="strepen-page">
        <div className="loading">Laden...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="strepen-page">
        <div className="error">Fout: {error}</div>
      </div>
    )
  }

  if (!selectedEvent) {
    return (
      <div className="strepen-page">
        <div className="no-events">Geen opkomsten gevonden</div>
      </div>
    )
  }

  // Sort users: participants first, then non-participants
  const sortedUsers = [...users].sort((a, b) => {
    const aIsParticipant = selectedEvent.participants.includes(a.id)
    const bIsParticipant = selectedEvent.participants.includes(b.id)
    
    if (aIsParticipant && !bIsParticipant) return -1
    if (!aIsParticipant && bIsParticipant) return 1
    
    // If both are participants or both are not, sort by name
    return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
  })

  return (
    <div className="strepen-page">
      <div className="strepen-header">
        <h1>Strepen</h1>
      </div>

      <div className="event-selector">
        <label htmlFor="event-select">Selecteer opkomst:</label>
        <select 
          id="event-select"
          value={selectedEvent?.id || ''}
          onChange={(e) => {
            const event = events.find(ev => ev.id === e.target.value)
            setSelectedEvent(event)
          }}
        >
          {events.map(event => (
            <option key={event.id} value={event.id}>
              {capitalizeWeekday(event.start)} - {event.title}
            </option>
          ))}
        </select>
      </div>

      <div className="event-info">
        <h2>{selectedEvent.title}</h2>
        <p>
          📅 {capitalizeWeekday(selectedEvent.start)}
        </p>
        <p>👥 Opkomstmakers: {selectedEvent.opkomstmakers}</p>
      </div>

      <div className="attendance-table">
        <div className="table-header">
          <div className="header-cell name">Naam</div>
          <div className="header-cell status">Aangemeld</div>
          <div className="header-cell present">Aanwezig</div>
          <div className="header-cell absent">Afwezig</div>
          <div className="header-cell streepjes">Streepjes</div>
        </div>

        {sortedUsers.map(user => {
          const isParticipant = selectedEvent.participants.includes(user.id)
          const userAttendance = attendance[user.id] || { present: false, absent: false }
          
          // Check if current state matches expected default
          const expectedPresent = isParticipant
          const expectedAbsent = !isParticipant
          const isDefaultState = (userAttendance.present === expectedPresent && userAttendance.absent === expectedAbsent)
          
          return (
            <div key={user.id} className={`table-row ${isParticipant ? 'participant' : 'non-participant'} ${isDefaultState ? 'default-state' : 'modified-state'}`}>
              <div className="cell name">
                {user.firstName} {user.lastName}
                {!isDefaultState && <span className="modified-indicator"> *</span>}
              </div>
              <div className="cell status">
                {isParticipant ? '✅ Ja' : '❌ Nee'}
              </div>
              <div className="cell present">
                <input
                  type="checkbox"
                  checked={userAttendance.present}
                  onChange={() => handleAttendanceChange(user.id, 'present')}
                />
              </div>
              <div className="cell absent">
                <input
                  type="checkbox"
                  checked={userAttendance.absent}
                  onChange={() => handleAttendanceChange(user.id, 'absent')}
                />
              </div>
              <div className="cell streepjes">
                {user.streepjes || 0}
              </div>
            </div>
          )
        })}
      </div>

      <div className="strepen-info">
        <h3>ℹ️ Informatie</h3>
        <p>
          <strong>Een streepje wordt toegekend wanneer het af- of aanmelden niet correct gebeurt:</strong>
        </p>
        <ul>
          <li>Iemand die zich heeft aangemeld (✅) maar niet aanwezig is (afwezig aanvinken)</li>
          <li>Iemand die zich niet heeft aangemeld (❌) maar wel aanwezig is (aanwezig aanvinken)</li>
        </ul>
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

      {/* Toast notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={hideToast}
        />
      )}
    </div>
  )
}

/**
 * ================================================================
 * OPKOMSTEN PAGE COMPONENT
 * ================================================================
 * 
 * This page displays all opkomst events in a table format with:
 * - Date column
 * - Attendance checkbox
 * - Opkomstmakers column
 * - Description column
 * 
 * @author R.S. Kort
 *
 */

// React core imports
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { withSupportContact } from '../config/appInfo'
import { useToast } from '../hooks/useToast'
import { buildEventPayload } from '../lib/eventPayload'
import {
  useOpkomstEvents,
  useUpdateAttendance,
  useUpdateEvent,
  useUsers
} from '../hooks/useQueries'

// Location input with autocomplete
import LocationInput from '../components/LocationInput'

// Component styling
import './OpkomstenPage.css'

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

/**
 * Format date for display
 */
function formatDate(dateString) {
  const date = new Date(dateString)
  // get full localized date, e.g. "maandag 8 juli 2025"
  const formatted = date.toLocaleDateString('nl-NL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  // capitalize the very first letter (the weekday)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}


/**
 * Sort opkomst events by date
 */
function sortOpkomstByDate(events) {
  return events.sort((a, b) => new Date(a.start) - new Date(b.start))
}

/**
 * Filter opkomst events to only show future events
 */
function filterFutureOpkomstEvents(events) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  
  return events.filter(event => {
    const eventDate = new Date(event.start)
    const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())
    
    // Show events that are today or in the future
    return eventDay >= today
  })
}

function hasSameAttendance(current, next) {
  const currentIds = Object.keys(current)
  const nextIds = Object.keys(next)
  return currentIds.length === nextIds.length &&
    nextIds.every((eventId) => current[eventId] === next[eventId])
}

/**
 * Check if attendance can be changed for an event
 */
function canChangeAttendance(eventStart) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const eventDate = new Date(eventStart)
  const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())
  
  // Can only change attendance before the event date
  return eventDay > today
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
    success: 'OK',
    error: 'X',
    warning: 'Let op',
    info: 'Info'
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
        X
      </button>
    </div>
  )
}

// ================================================================
// CUSTOM 24-HOUR TIME INPUT COMPONENT
// ================================================================

function TimeInput24({ value, onChange, disabled, error }) {
  const [hours, minutes] = (value || '00:00').split(':')
  
  const handleHourChange = (e) => {
    const newHours = e.target.value.padStart(2, '0')
    onChange(`${newHours}:${minutes}`)
  }
  
  const handleMinuteChange = (e) => {
    const newMinutes = e.target.value.padStart(2, '0')
    onChange(`${hours}:${newMinutes}`)
  }
  
  return (
    <div className={`time-input-24 ${error ? 'error' : ''}`}>
      <select
        value={hours}
        onChange={handleHourChange}
        disabled={disabled}
        className="time-select hours"
        aria-label="Uren"
      >
        {Array.from({ length: 24 }, (_, i) => {
          const hour = i.toString().padStart(2, '0')
          return (
            <option key={hour} value={hour}>
              {hour}
            </option>
          )
        })}
      </select>
      <span className="time-separator">:</span>
      <select
        value={minutes}
        onChange={handleMinuteChange}
        disabled={disabled}
        className="time-select minutes"
        aria-label="Minuten"
      >
        {Array.from({ length: 60 }, (_, i) => {
          const minute = i.toString().padStart(2, '0')
          return (
            <option key={minute} value={minute}>
              {minute}
            </option>
          )
        })}
      </select>
    </div>
  )
}

// ================================================================
// OPKOMST EDIT FORM COMPONENT
// ================================================================

function OpkomstEditForm({ event, onClose, onSave, users = [], currentUser = null }) {
  // Initialize opkomstmakers as an array of selected user IDs
  const initializeOpkomstmakers = () => {
    if (Array.isArray(event?.opkomstmakerIds)) return event.opkomstmakerIds
    if (event?.opkomstmakers) {
      if (Array.isArray(event.opkomstmakers)) {
        return event.opkomstmakers
      }
      const storedNames = event.opkomstmakers.split(',').map(name => name.trim()).filter(name => name)
      return storedNames.map(name => {
        const user = users.find(u => u.firstName === name)
        return user ? user.id : null
      }).filter(id => id !== null)
    }
    return []
  }

  const [formData, setFormData] = useState({
    title: event?.title || 'Stam opkomst',
    startDate: event?.start || new Date().toISOString().slice(0, 10),
    startTime: event?.startTime || '20:30',
    endDate: event?.end || new Date().toISOString().slice(0, 10),
    endTime: event?.endTime || '22:30',
    isAllDay: event?.allDay || false,
    location: event?.location || 'Clubhuis Scouting MPD',
    description: event?.description || '',
    isOpkomst: true, // Always true for opkomst events
    opkomstmakers: initializeOpkomstmakers()
  })

  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInputChange = (field, value) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value }
      
      // If all-day is toggled, handle end date logic
      if (field === 'isAllDay') {
        if (value) {
          // When switching to all-day, ensure end date is set
          if (!newData.endDate || newData.endDate === newData.startDate) {
            newData.endDate = newData.startDate
          }
        } else {
          // When switching to timed, set end date to start date
          newData.endDate = newData.startDate
        }
      }
      
      // If start date changes, handle automatic adjustments
      if (field === 'startDate') {
        if (newData.isAllDay) {
          // For all-day events: when start date changes, set end date to same date
          newData.endDate = value
        } else {
          // For timed events: update end date to match
          newData.endDate = value
        }
      }
      
      // If start time changes for timed events, set end time to 2 hours later
      if (field === 'startTime' && !newData.isAllDay) {
        const startTime = value
        if (startTime) {
          // Parse the time and add 2 hours
          const [hours, minutes] = startTime.split(':').map(Number)
          const endHours = (hours + 2) % 24
          const endTime = `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
          newData.endTime = endTime
        }
      }
      
      return newData
    })
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }))
    }
  }

  // Handle opkomstmaker selection
  const handleOpkomstmakerChange = (userId) => {
    setFormData(prev => {
      const currentIds = prev.opkomstmakers || []
      const isSelected = currentIds.includes(userId)
      
      if (isSelected) {
        return {
          ...prev,
          opkomstmakers: currentIds.filter(id => id !== userId)
        }
      } else {
        return {
          ...prev,
          opkomstmakers: [...currentIds, userId]
        }
      }
    })
  }

  const validateForm = () => {
    const newErrors = {}

    if (!formData.title.trim()) {
      newErrors.title = 'Titel is verplicht'
    }

    if (!formData.startDate) {
      newErrors.startDate = formData.isAllDay ? 'Startdatum is verplicht' : 'Datum is verplicht'
    }

    // For all-day events, validate end date
    if (formData.isAllDay) {
      if (!formData.endDate) {
        newErrors.endDate = 'Einddatum is verplicht'
      }
      if (formData.startDate && formData.endDate && formData.startDate > formData.endDate) {
        newErrors.endDate = 'Einddatum moet na startdatum liggen'
      }
    }

    // For timed events, validate times
    if (!formData.isAllDay) {
      if (!formData.startTime) {
        newErrors.startTime = 'Starttijd is verplicht'
      }
      if (!formData.endTime) {
        newErrors.endTime = 'Eindtijd is verplicht'
      }
      if (formData.startTime && formData.endTime && formData.startTime >= formData.endTime) {
        newErrors.endTime = 'Eindtijd moet na starttijd liggen'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      const payload = buildEventPayload(formData, { forceOpkomst: true })

      if (!currentUser?.isAdmin) throw new Error('Alleen beheerders kunnen opkomsten opslaan')
      await onSave(event.id, payload)

      onClose()
    } catch (err) {
      console.error('Error saving opkomst:', err)
      setErrors({ submit: withSupportContact(`Opslaan mislukt: ${err.message}`) })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal-content modal-content-large" onClick={e => e.stopPropagation()}>
        <button 
          className="close-btn" 
          onClick={onClose}
          aria-label="Formulier sluiten"
        >
          X
        </button>

        <div className="modal-header">
          <h2 className="modal-title">
             Opkomst aanpassen
          </h2>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-grid">
            {/* Title */}
            <div className="form-group">
              <label className="form-label" htmlFor="event-title">
                 Titel *
              </label>
              <input
                id="event-title"
                type="text"
                className={`form-input ${errors.title ? 'error' : ''}`}
                value={formData.title}
                onChange={e => handleInputChange('title', e.target.value)}
                placeholder="Opkomst titel"
                disabled={isSubmitting}
                aria-describedby={errors.title ? "title-error" : undefined}
              />
              {errors.title && (
                <div id="title-error" className="field-error" role="alert">
                  {errors.title}
                </div>
              )}
            </div>

            {/* Opkomstmakers */}
            <div className="form-group form-group-full">
              <label className="form-label">
                 Opkomstmakers selecteren
              </label>
              <div className="opkomstmakers-checkboxes">
                {users.map(user => (
                  <label key={user.id} className="checkbox-label opkomstmaker-checkbox">
                    <input
                      type="checkbox"
                      checked={formData.opkomstmakers.includes(user.id)}
                      onChange={() => handleOpkomstmakerChange(user.id)}
                      disabled={isSubmitting}
                      className="checkbox-input"
                    />
                    <span className="checkbox-custom"></span>
                    {user.firstName}
                  </label>
                ))}
              </div>
            </div>

            {/* All day toggle */}
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.isAllDay}
                  onChange={e => handleInputChange('isAllDay', e.target.checked)}
                  disabled={isSubmitting}
                  className="checkbox-input"
                />
                <span className="checkbox-custom"></span>
                Tijd Hele dag evenement
              </label>
            </div>

            {/* Start date */}
            <div className="form-group">
              <label className="form-label" htmlFor="start-date">
                Datum {formData.isAllDay ? 'Startdatum' : 'Datum'} *
              </label>
              <input
                id="start-date"
                type="date"
                className={`form-input ${errors.startDate ? 'error' : ''}`}
                value={formData.startDate}
                onChange={e => handleInputChange('startDate', e.target.value)}
                disabled={isSubmitting}
                aria-describedby={errors.startDate ? "start-date-error" : undefined}
              />
              {errors.startDate && (
                <div id="start-date-error" className="field-error" role="alert">
                  {errors.startDate}
                </div>
              )}
            </div>

            {/* Start time */}
            {!formData.isAllDay && (
              <div className="form-group">
                <label className="form-label" htmlFor="start-time">
                  Tijd Starttijd *
                </label>
                <TimeInput24
                  id="start-time"
                  value={formData.startTime}
                  onChange={value => handleInputChange('startTime', value)}
                  disabled={isSubmitting}
                  error={errors.startTime}
                  aria-describedby={errors.startTime ? "start-time-error" : undefined}
                />
                {errors.startTime && (
                  <div id="start-time-error" className="field-error" role="alert">
                    {errors.startTime}
                  </div>
                )}
              </div>
            )}

            {/* End date - only show for all-day events */}
            {formData.isAllDay && (
              <div className="form-group">
                <label className="form-label" htmlFor="end-date">
                  Datum Einddatum *
                </label>
                <input
                  id="end-date"
                  type="date"
                  className={`form-input ${errors.endDate ? 'error' : ''}`}
                  value={formData.endDate}
                  onChange={e => handleInputChange('endDate', e.target.value)}
                  disabled={isSubmitting}
                  aria-describedby={errors.endDate ? "end-date-error" : undefined}
                />
                {errors.endDate && (
                  <div id="end-date-error" className="field-error" role="alert">
                    {errors.endDate}
                  </div>
                )}
              </div>
            )}

            {/* End time */}
            {!formData.isAllDay && (
              <div className="form-group">
                <label className="form-label" htmlFor="end-time">
                  Tijd Eindtijd *
                </label>
                <TimeInput24
                  id="end-time"
                  value={formData.endTime}
                  onChange={value => handleInputChange('endTime', value)}
                  disabled={isSubmitting}
                  error={errors.endTime}
                  aria-describedby={errors.endTime ? "end-time-error" : undefined}
                />
                {errors.endTime && (
                  <div id="end-time-error" className="field-error" role="alert">
                    {errors.endTime}
                  </div>
                )}
              </div>
            )}

            {/* Location */}
            <div className="form-group form-group-full">
              <label className="form-label" htmlFor="location">
                Locatie Locatie
              </label>
              <LocationInput
                value={formData.location}
                onChange={(value) => handleInputChange('location', value)}
                placeholder="bijv. Clubhuis Scouting MPD"
                disabled={isSubmitting}
                error={errors.location}
              />
            </div>

            {/* Description */}
            <div className="form-group form-group-full">
              <label className="form-label" htmlFor="description">
                Document Beschrijving
              </label>
              <textarea
                id="description"
                className="form-textarea"
                value={formData.description}
                onChange={e => handleInputChange('description', e.target.value)}
                rows={4}
                placeholder="Extra details over de opkomst"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Submit error */}
          {errors.submit && (
            <div className="error-message" role="alert">
              {errors.submit}
            </div>
          )}
        </form>

        <div className="modal-footer">
          <button 
            type="button" 
            className="modal-btn modal-btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Annuleren
          </button>
          <button 
            type="submit" 
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <div className="loading-spinner"></div>
                Opslaan...
              </>
            ) : (
              <>
                Opslaan
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ================================================================
// MAIN OPKOMSTEN PAGE COMPONENT
// ================================================================

export default function OpkomstenPage() {
  const [currentUser, setCurrentUser] = useState(null)
  const [attendance, setAttendance] = useState({}) // Track attendance for each event
  const { addToast } = useToast();
  const [editingEvent, setEditingEvent] = useState(null) // For editing events
  const {
    data: queriedEvents = [],
    isLoading: eventsLoading,
    error: eventsError
  } = useOpkomstEvents()
  const {
    data: users = [],
    isLoading: usersLoading,
    error: usersError
  } = useUsers()
  const updateEventMutation = useUpdateEvent()
  const updateAttendanceMutation = useUpdateAttendance()
  const opkomstEvents = useMemo(
    () => sortOpkomstByDate(filterFutureOpkomstEvents(queriedEvents)),
    [queriedEvents]
  )
  const isLoading = eventsLoading || usersLoading
  const error = eventsError || usersError

    // ================================================================
    // EVENT HANDLERS
    // ================================================================

    const showToast = useCallback((message, type = 'info') => {
      const appearance = type === 'info' ? 'info' : type;
      addToast(message, { appearance });
    }, [addToast]);


    // Handle edit event
    const handleEditEvent = useCallback((event) => {
      if (!currentUser || !currentUser.isAdmin) {
        showToast('Alleen admins kunnen opkomsten bewerken', 'error')
        return
      }

      const opkomstmakersArray = event.opkomstmakerIds || []

      // Get dates from event start/end
      const startDate = event.start ? new Date(event.start).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
      const endDate = event.allDay && event.end ? 
        new Date(new Date(event.end).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : // Subtract 1 day for display
        startDate

      // Get times from event start/end
      const startTime = event.start && !event.allDay ? 
        new Date(event.start).toTimeString().slice(0, 5) : 
        '20:30'
      const endTime = event.end && !event.allDay ? 
        new Date(event.end).toTimeString().slice(0, 5) : 
        '22:30'

      setEditingEvent({
        id: event.id,
        title: event.title,
        start: startDate,
        startTime: startTime,
        end: endDate,
        endTime: endTime,
        allDay: event.allDay,
        location: event.location || '',
        description: event.description || '',
        isOpkomst: event.isOpkomst || false,
        opkomstmakers: opkomstmakersArray,
        opkomstmakerIds: opkomstmakersArray,
      })
    }, [currentUser, showToast])

    // Handle event addition/update
    const handleAdd = useCallback(async (eventId, eventData) => {
      const saved = await updateEventMutation.mutateAsync({ eventId, eventData })
      showToast('Opkomst succesvol bijgewerkt', 'success')
      setEditingEvent(null)
      return saved
    }, [showToast, updateEventMutation])

  // Load the current session snapshot; server data comes from TanStack Query.
  useEffect(() => {
    try {
      const userData = localStorage.getItem('user')
      if (userData) setCurrentUser(JSON.parse(userData))
    } catch (userError) {
      console.error('Error loading user from localStorage:', userError)
    }
  }, [])
  // Sync attendance state with event participants whenever events or currentUser changes
  useEffect(() => {
    if (!currentUser) return

    const nextAttendance = Object.fromEntries(
      opkomstEvents.map((event) => [
        event.id,
        Boolean(event.participants?.includes(currentUser.id))
      ])
    )

    setAttendance((currentAttendance) =>
      hasSameAttendance(currentAttendance, nextAttendance)
        ? currentAttendance
        : nextAttendance
    )
  }, [currentUser, opkomstEvents])

  // Handle attendance checkbox change
  const handleAttendanceChange = useCallback(async (eventId, isAttending) => {
    if (!currentUser) {
      showToast('Je moet ingelogd zijn om aanwezigheid te registreren', 'error')
      return
    }

    // Find the event to check if attendance can be changed
    const event = opkomstEvents.find(e => e.id === eventId)
    if (!event) {
      showToast('Evenement niet gevonden', 'error')
      return
    }

    if (!canChangeAttendance(event.start)) {
      showToast('Je kunt alleen aanwezigheid wijzigen voor de datum van de opkomst', 'warning')
      return
    }

    try {
      await updateAttendanceMutation.mutateAsync({ eventId, attending: isAttending })

      // Always update local attendance state
      setAttendance(prev => ({
        ...prev,
        [eventId]: isAttending
      }))

      showToast(
        isAttending ? 'Je hebt je aangemeld!' : 'Je hebt je afgemeld!',
        'success'
      )
    } catch (err) {
      console.error('Error updating attendance:', err)
      showToast('Kon aanwezigheid niet bijwerken', 'error')
    }
  }, [currentUser, showToast, opkomstEvents, updateAttendanceMutation])

  // Get names of participants for an event
  const getParticipantNames = useCallback((participants) => {
    if (!participants || participants.length === 0) return []
    
    return participants
      .map(userId => {
        const user = users.find(u => u.id === userId)
        return user ? `${user.firstName}` : 'Onbekende gebruiker'
      })
      .sort((a, b) => a.localeCompare(b, 'nl-NL'))
  }, [users])

  // Handle admin clicking on a user name to toggle their participation
  const handleAdminToggleParticipation = useCallback(async (eventId, userId) => {
    if (!currentUser || !currentUser.isAdmin) {
      showToast('Alleen admins kunnen deelname van anderen wijzigen', 'error')
      return
    }

    // Find the event
    const event = opkomstEvents.find(e => e.id === eventId)
    if (!event) {
      showToast('Evenement niet gevonden', 'error')
      return
    }

    // Admins can always change participation, regardless of date
    const participants = event.participants || []
    const isCurrentlyAttending = participants.includes(userId)
    const newAttendanceState = !isCurrentlyAttending

    try {
      await updateAttendanceMutation.mutateAsync({ eventId, userId, attending: newAttendanceState })

      const userName = users.find(u => u.id === userId)?.firstName || 'Gebruiker'
      showToast(
        newAttendanceState ? `${userName} is aangemeld` : `${userName} is afgemeld`,
        'success'
      )
    } catch (err) {
      console.error('Error updating attendance:', err)
      showToast('Kon aanwezigheid niet bijwerken', 'error')
    }
  }, [currentUser, showToast, opkomstEvents, users, updateAttendanceMutation])

  // ================================================================
  // RENDER
  // ================================================================

  if (isLoading) {
    return (
      <div className="opkomsten-page-wrapper">
        <div className="opkomsten-container">
          <div className="loading-state">
            <div className="loading-content">
              <div className="loading-spinner"></div>
              <h2>Opkomsten laden...</h2>
              <p>Even geduld terwijl we de opkomsten ophalen.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="opkomsten-page-wrapper">
        <div className="opkomsten-container">
          <div className="error-state">
            <div className="error-content">
              <h2>Er is iets misgegaan</h2>
              <p>{withSupportContact(error?.message || 'De gegevens konden niet worden geladen.')}</p>
              <button 
                onClick={() => window.location.reload()} 
                className="btn btn-primary"
              >
                Probeer opnieuw
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="opkomsten-page-wrapper">
      <div className="opkomsten-container">
        <div className="opkomsten-header">
          <h1 className="opkomsten-title">Opkomsten</h1>
        </div>

      {opkomstEvents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-content">
            <h2>Geen opkomsten gepland</h2>
            <p>Er zijn momenteel geen opkomsten ingepland.</p>
            <p>Nieuwe opkomsten kunnen worden toegevoegd via de kalender.</p>
          </div>
        </div>
      ) : (
        <div className="opkomsten-cards-grid">
          {opkomstEvents.map((event) => (
            <div key={event.id} className="opkomst-card">
              {/* Card Header with Date and Actions */}
              <div className="card-header">
                <div className="date-section">
                  <div className="date-content">
                    {formatDate(event.start)}
                    {!event.allDay && event.start && (
                      <div className="time-info">
                        {new Date(event.start).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
                        {event.end && (
                          <span>
                            {' - '}
                            {new Date(event.end).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', hour12: false })}
                          </span>
                        )}
                        {event.location && (
                        <p className="location-info">
                          {event.location}
                        </p>
                      )}
                      </div>
                    )}
                  </div>
                </div>
                {/* Add check to see if there are makers */}
                {event.opkomstmakers && (
                  <div className="opkomsten-card__makers">
                    <div className="opkomsten-card__makers-title">
                      Opkomstmakers:
                    </div>

                    <div className="opkomsten-card__makers-badges">
                      {event.opkomstmakers.split(',').map((maker, index) => (
                        <span
                          key={index}
                          className="opkomsten-card__maker-pill"
                        >
                          {maker.trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="card-actions">
                  <label className="attendance-toggle">
                    <input
                      type="checkbox"
                      checked={
                        attendance[event.id] || 
                        (currentUser && event.participants && event.participants.includes(currentUser.id))
                      }
                      onChange={(e) => handleAttendanceChange(event.id, e.target.checked)}
                      className="attendance-checkbox-input"
                      disabled={!canChangeAttendance(event.start)}
                      title={!canChangeAttendance(event.start) ? 'Aanwezigheid kan alleen worden gewijzigd voor de datum van de opkomst' : ''}
                    />
                    <span className="attendance-checkbox-custom"></span>
                    <span className="attendance-label">
                      {(attendance[event.id] || (currentUser && event.participants && event.participants.includes(currentUser.id))) ? 'Aanwezig' : 'Afwezig'}
                    </span>
                  </label>
                  
                  {currentUser && currentUser.isAdmin && (
                    <button
                      onClick={() => handleEditEvent(event)}
                      className="edit-btn"
                      title="Opkomst bewerken"
                      type="button"
                    >
                      ✏️ Bewerken
                    </button>
                  )}
                </div>
              </div>

              {/* Card Body with Main Content */}
              <div className="card-body">
                {/* Participants Section */}
                <div className="content-section">
                  <div className="section-title">
                    Aanwezigen ({event.participants ? event.participants.length : 0})
                  </div>
                  <div className="participants-content">
                    {currentUser && currentUser.isAdmin ? (
                      // Admin view: Show all non-legacy users with toggleable states
                      <div className="admin-participants-grid">
                        {users.length > 0 ? (
                          users
                            .filter(u => u.status !== 'legacy')
                            .sort((a, b) => a.firstName.localeCompare(b.firstName, 'nl-NL'))
                            .map(user => {
                              const isParticipating = event.participants && event.participants.includes(user.id)
                              const isInactive = user.status === 'inactive'
                              return (
                                <button
                                  key={user.id}
                                  type="button"
                                  className={`participant-toggle ${isParticipating ? 'participating' : 'not-participating'}${isInactive ? ' participant-toggle-inactive' : ''}`}
                                  onClick={() => handleAdminToggleParticipation(event.id, user.id)}
                                  title={`${isInactive ? '[Inactief] ' : ''}Klik om ${isParticipating ? 'af te melden' : 'aan te melden'}: ${user.firstName}`}
                                >
                                  {user.firstName}{isInactive ? ' •' : ''}
                                </button>
                              )
                            })
                        ) : (
                          <span className="loading-users">Gebruikers laden...</span>
                        )}
                      </div>
                    ) : (
                      // Regular user view: Show only participants
                      event.participants && event.participants.length > 0 ? (
                        <div className="participants-list">
                          {getParticipantNames(event.participants).map((name, index) => (
                            <span key={index} className="participant-badge">
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="no-content">Geen aanwezigen</span>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit event form - modal */}
      {editingEvent && (
        <OpkomstEditForm
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={handleAdd}
          users={users.filter(u => u.status === 'active')}
          currentUser={currentUser}
        />
      )}
      </div>
    </div>
  )
}



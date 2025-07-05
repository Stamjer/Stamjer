/**
 * ================================================================
 * CALENDAR PAGE COMPONENT - ENHANCED
 * ================================================================
 * 
 * Enhanced calendar interface with improved features:
 * - Better error handling and loading states
 * - Improved accessibility
 * - Enhanced user experience
 * - Better form validation
 * - Toast notifications
 * - Performance optimizations
 * 
 * @author Stamjer Development Team
 * @version 1.1.0
 */

// React core imports
import React, { useState, useEffect, useCallback, useMemo } from 'react'

// FullCalendar imports for calendar functionality
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import nlLocale from '@fullcalendar/core/locales/nl'

// Component styling
import './CalendarPage.css'

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

/**
 * Helper function to increment a date by one day
 */
function nextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + 1)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * Format date for display
 */
function formatDate(date, options = {}) {
  return date.toLocaleDateString('nl-NL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...options
  })
}

/**
 * Format time for display
 */
function formatTime(date) {
  return date.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
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

// ================================================================
// EVENT MODAL COMPONENT
// ================================================================

function EventModal({ event, onClose, onDelete, onEdit }) {
  const [isDeleting, setIsDeleting] = useState(false)

  if (!event) return null

  const { title, start, end, allDay, extendedProps } = event

  const handleDelete = async () => {
    if (!window.confirm('Weet je zeker dat je dit evenement wilt verwijderen?')) {
      return
    }

    setIsDeleting(true)
    try {
      await onDelete(event)
    } catch (error) {
      console.error('Error deleting event:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button 
          className="close-btn" 
          onClick={onClose}
          aria-label="Evenement details sluiten"
        >
          ×
        </button>

        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
        </div>

        <div className="modal-body">
          <div className="event-details">
            {/* Event date/time display */}
            {allDay ? (
              <div className="detail-item">
                <div className="detail-content">
                  <strong>📅 {(() => {
                    const startDate = new Date(start)
                    const endDate = new Date(end)
                    const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
                    
                    if (daysDiff <= 1) {
                      return 'Datum:'
                    } else if (daysDiff === 2) {
                      return 'Periode (2 dagen):'
                    } else {
                      return `Periode (${daysDiff} dagen):`
                    }
                  })()}</strong><br />
                  {(() => {
                    const startDate = new Date(start)
                    const endDate = new Date(end)
                    const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
                    
                    if (daysDiff <= 1) {
                      return formatDate(startDate)
                    } else {
                      const endDisplayDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000) // Subtract 1 day for display
                      return (
                        <>
                          Van {formatDate(startDate)}
                          <br />
                          Tot {formatDate(endDisplayDate)}
                        </>
                      )
                    }
                  })()}
                </div>
              </div>
            ) : (
              <>
                <div className="detail-item">
                  <div className="detail-content">
                    <strong>📅 Datum:</strong><br />
                    {formatDate(start)}
                  </div>
                </div>
                {end && (
                  <div className="detail-item">
                    <div className="detail-content">
                      <strong>🕐 {(() => {
                        const startTime = new Date(start)
                        const endTime = new Date(end)
                        const durationMs = endTime - startTime
                        const hours = Math.floor(durationMs / (1000 * 60 * 60))
                        const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60))
                        
                        if (hours === 0) {
                          return `Tijd (${minutes} min):`
                        } else if (minutes === 0) {
                          return `Tijd (${hours} ${hours === 1 ? 'uur' : 'uur'}):`
                        } else {
                          return `Tijd (${hours}u ${minutes}m):`
                        }
                      })()}</strong><br />
                      {formatTime(start)} - {formatTime(end)}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Location */}
            {extendedProps?.location && (
              <div className="detail-item">
                <div className="detail-content">
                  <strong>📍 Locatie:</strong><br />
                  {extendedProps.location}
                </div>
              </div>
            )}

            {/* Opkomstmakers - only show for opkomst events */}
            {extendedProps?.isOpkomst && extendedProps?.opkomstmakers && (
              <div className="detail-item">
                <div className="detail-content">
                  <strong>👥 Opkomstmakers:</strong><br />
                  {extendedProps.opkomstmakers.split(',').map((maker, index) => (
                    <React.Fragment key={index}>
                      {maker.trim()}
                      {index < extendedProps.opkomstmakers.split(',').length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            {extendedProps?.description && (
              <div className="detail-item">
                <div className="detail-content">
                  <strong>📄 Beschrijving:</strong><br />
                  {extendedProps.description}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button 
            type="button" 
            className="modal-btn modal-btn-secondary"
            onClick={() => onEdit(event)}
            disabled={isDeleting}
          >
            ✏️ Aanpassen
          </button>
          <button 
            type="button" 
            className="modal-btn modal-btn-danger"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <div className="loading-spinner"></div>
                Verwijderen...
              </>
            ) : (
              <>🗑️ Verwijderen</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ================================================================
// NEW/EDIT EVENT FORM COMPONENT
// ================================================================

function NewEventForm({ event = null, isEdit = false, onClose, onAdd, users = [] }) {
  // Initialize opkomstmakers as an array of selected user IDs
  const initializeOpkomstmakers = () => {
    if (event?.opkomstmakers) {
      // If editing and opkomstmakers is already an array (from handleEdit)
      if (Array.isArray(event.opkomstmakers)) {
        return event.opkomstmakers
      }
      // If editing from original event data, parse the string
      const storedNames = event.opkomstmakers.split(',').map(name => name.trim()).filter(name => name)
      return storedNames.map(name => {
        const user = users.find(u => u.firstName === name)
        return user ? user.id : null
      }).filter(id => id !== null)
    }
    return []
  }

  const [formData, setFormData] = useState({
    title: event?.title || '',
    startDate: event?.start || new Date().toISOString().slice(0, 10),
    startTime: event?.startTime || '09:00',
    endDate: event?.end || new Date().toISOString().slice(0, 10),
    endTime: event?.endTime || '10:00',
    isAllDay: event?.allDay || false,
    location: event?.location || '',
    description: event?.description || '',
    isOpkomst: event?.isOpkomst || false,
    opkomstmakers: initializeOpkomstmakers()
  })

  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInputChange = (field, value) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value }
      
      // If opkomst is toggled, update title accordingly
      if (field === 'isOpkomst') {
        if (value) {
          newData.title = 'Stam opkomst'
        } else {
          newData.title = ''
          newData.opkomstmakers = []
        }
      }
      
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
      
      // If start date changes for timed events, update end date to match
      if (field === 'startDate' && !newData.isAllDay) {
        newData.endDate = value
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
        // Remove user from selection
        return {
          ...prev,
          opkomstmakers: currentIds.filter(id => id !== userId)
        }
      } else {
        // Add user to selection
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
      const { title, startDate, startTime, endDate, endTime, isAllDay, location, description } = formData

      // For timed events, use the same date for start and end
      const actualEndDate = isAllDay ? endDate : startDate
      const start = isAllDay ? startDate : `${startDate}T${startTime}`
      const end = isAllDay ? nextDay(actualEndDate) : `${actualEndDate}T${endTime}`

      // Convert opkomstmakers user IDs to first names
      const opkomstmakersString = formData.opkomstmakers
        .map(userId => {
          const user = users.find(u => u.id === userId)
          return user ? user.firstName : null
        })
        .filter(name => name !== null)
        .join(', ')

      const payload = {
        title: title.trim(),
        start,
        end,
        allDay: isAllDay,
        location: location.trim(),
        description: description.trim(),
        isOpkomst: formData.isOpkomst,
        opkomstmakers: opkomstmakersString,
      }

      const url = isEdit ? `/api/events/${event.id}` : '/api/events'
      const method = isEdit ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`Server reageerde met ${response.status}: ${response.statusText}`)
      }

      const saved = await response.json()

      const fcEvt = {
        id: saved.id,
        title: saved.title,
        start: saved.start,
        end: saved.end,
        allDay: saved.allDay,
        extendedProps: {
          location: saved.location,
          description: saved.description,
          isOpkomst: saved.isOpkomst,
          opkomstmakers: saved.opkomstmakers,
        },
      }

      onAdd(fcEvt)
      onClose()
    } catch (err) {
      console.error('Error saving event:', err)
      setErrors({ submit: `${isEdit ? 'Bijwerken' : 'Opslaan'} mislukt: ${err.message}` })
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
          ×
        </button>

        <div className="modal-header">
          <h2 className="modal-title">
            {isEdit ? '✏️ Evenement aanpassen' : 'Nieuw evenement'}
          </h2>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-grid">
            {/* Title */}
            <div className="form-group">
              <label className="form-label" htmlFor="event-title">
                📝 Titel *
              </label>
              <input
                id="event-title"
                type="text"
                className={`form-input ${errors.title ? 'error' : ''}`}
                value={formData.title}
                onChange={e => handleInputChange('title', e.target.value)}
                placeholder="Evenement titel"
                disabled={isSubmitting || formData.isOpkomst}
                aria-describedby={errors.title ? "title-error" : undefined}
              />
              {errors.title && (
                <div id="title-error" className="field-error" role="alert">
                  {errors.title}
                </div>
              )}
            </div>

            {/* Opkomst toggle */}
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.isOpkomst}
                  onChange={e => handleInputChange('isOpkomst', e.target.checked)}
                  disabled={isSubmitting}
                  className="checkbox-input"
                />
                <span className="checkbox-custom"></span>
                🏕️ Stam opkomst
              </label>
            </div>

            {/* Opkomstmakers - only show when it's an opkomst */}
            {formData.isOpkomst && (
              <div className="form-group form-group-full">
                <label className="form-label">
                  👥 Opkomstmakers selecteren
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
            )}

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
                🕐 Hele dag evenement
              </label>
            </div>

            {/* Start date */}
            <div className="form-group">
              <label className="form-label" htmlFor="start-date">
                📅 {formData.isAllDay ? 'Startdatum' : 'Datum'} *
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
                  🕐 Starttijd *
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
                  📅 Einddatum *
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
                  🕑 Eindtijd *
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
                📍 Locatie
              </label>
              <input
                id="location"
                type="text"
                className="form-input"
                value={formData.location}
                onChange={e => handleInputChange('location', e.target.value)}
                placeholder="Waar vindt het plaats?"
                disabled={isSubmitting}
              />
            </div>

            {/* Description */}
            <div className="form-group form-group-full">
              <label className="form-label" htmlFor="description">
                📄 Beschrijving
              </label>
              <textarea
                id="description"
                className="form-textarea"
                value={formData.description}
                onChange={e => handleInputChange('description', e.target.value)}
                rows={4}
                placeholder="Extra details over het evenement"
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
            ❌ Annuleren
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
                {isEdit ? 'Opslaan...' : 'Aanmaken...'}
              </>
            ) : (
              <>
                {isEdit ? '💾 Bewaar wijzigingen' : '✨ Evenement aanmaken'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ================================================================
// CUSTOM 24-HOUR TIME INPUT COMPONENT
// ================================================================

function TimeInput24({ id, value, onChange, disabled, className, error, ...props }) {
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
// MAIN CALENDAR PAGE COMPONENT
// ================================================================

export default function CalendarPage() {
  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [users, setUsers] = useState([]) // Store available users for dropdown

  // ================================================================
  // EVENT HANDLERS
  // ================================================================

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type })
  }, [])

  const hideToast = useCallback(() => {
    setToast(null)
  }, [])

  // Load events on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true)
        
        // Load users and events in parallel
        const [eventsResponse, usersResponse] = await Promise.all([
          fetch('/api/events'),
          fetch('/api/users')
        ])
        
        if (!eventsResponse.ok) {
          throw new Error(`Server fout bij laden events: ${eventsResponse.status}`)
        }
        
        if (!usersResponse.ok) {
          throw new Error(`Server fout bij laden users: ${usersResponse.status}`)
        }

        const eventsData = await eventsResponse.json()
        const usersData = await usersResponse.json()
        
        // Process events
        const raw = Array.isArray(eventsData) ? eventsData : eventsData.events || []
        const fcEvents = raw.map(evt => ({
          id: evt.id,
          title: evt.title,
          start: evt.start,
          end: evt.end,
          allDay: evt.allDay,
          extendedProps: {
            location: evt.location,
            description: evt.description,
            isOpkomst: evt.isOpkomst,
            opkomstmakers: evt.opkomstmakers,
          },
        }))
        
        // Process users
        const usersList = Array.isArray(usersData) ? usersData : usersData.users || []
        
        setEvents(fcEvents)
        setUsers(usersList)
        setError(null)
      } catch (err) {
        console.error('Error loading data:', err)
        setError('Kon de kalender niet laden. Probeer de pagina te vernieuwen.')
        showToast('Kon gegevens niet laden', 'error')
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [showToast])

  // Handle event click
  const handleEventClick = useCallback((info) => {
    setSelectedEvent(info.event)
  }, [])

  // Handle event deletion
  const handleDelete = useCallback(async (ev) => {
    try {
      const response = await fetch(`/api/events/${ev.id}`, { method: 'DELETE' })
      
      if (!response.ok) {
        throw new Error(`Server fout: ${response.status}`)
      }

      setEvents(prev => prev.filter(e => e.id !== ev.id))
      setSelectedEvent(null)
      showToast('Evenement succesvol verwijderd', 'success')
    } catch (error) {
      console.error('Error deleting event:', error)
      showToast('Kon evenement niet verwijderen', 'error')
      throw error
    }
  }, [showToast])

  // Handle event addition/update
  const handleAdd = useCallback((evt) => {
    setEvents(prev => {
      const exists = prev.find(e => e.id === evt.id)
      if (exists) {
        showToast('Evenement succesvol bijgewerkt', 'success')
        return prev.map(e => (e.id === evt.id ? evt : e))
      } else {
        showToast('Evenement succesvol toegevoegd', 'success')
        return [...prev, evt]
      }
    })
  }, [showToast])

  // Handle edit button click
  const handleEdit = useCallback((ev) => {
    // Convert opkomstmakers string to array of user IDs for editing
    const opkomstmakersArray = []
    if (ev.extendedProps.opkomstmakers) {
      const storedNames = ev.extendedProps.opkomstmakers.split(',').map(name => name.trim()).filter(name => name)
      storedNames.forEach(name => {
        const user = users.find(u => u.firstName === name)
        if (user) {
          opkomstmakersArray.push(user.id)
        }
      })
    }

    // Get dates from Date objects
    const startDate = ev.start ? ev.start.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
    const endDate = ev.allDay && ev.end ? 
      new Date(ev.end.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : // Subtract 1 day for display
      startDate

    // Get times from Date objects
    const startTime = ev.start && !ev.allDay ? 
      ev.start.toTimeString().slice(0, 5) : 
      '09:00'
    const endTime = ev.end && !ev.allDay ? 
      ev.end.toTimeString().slice(0, 5) : 
      '10:00'

    setEditingEvent({
      id: ev.id,
      title: ev.title,
      start: startDate,
      startTime: startTime,
      end: endDate,
      endTime: endTime,
      allDay: ev.allDay,
      location: ev.extendedProps.location || '',
      description: ev.extendedProps.description || '',
      isOpkomst: ev.extendedProps.isOpkomst || false,
      opkomstmakers: opkomstmakersArray,
    })
    setSelectedEvent(null)
  }, [users])

  // Memoized calendar configuration
  const calendarConfig = useMemo(() => ({
    plugins: [dayGridPlugin, interactionPlugin],
    locale: nlLocale,
    firstDay: 1,
    initialView: 'dayGridMonth',
    fixedWeekCount: false,
    showNonCurrentDates: true,
    headerToolbar: {
      left: 'prev today next',
      center: 'title',
      right: 'nieuwBtn',
    },
    buttonText: { 
      today: 'Vandaag',
      prev: '‹ Vorige',
      next: 'Volgende ›'
    },
    dayHeaderFormat: { weekday: 'long' },
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    },
    customButtons: {
      nieuwBtn: {
        text: 'Nieuw evenement',
        click: () => setShowNewForm(true),
      },
    },
    events,
    eventClick: handleEventClick,
    height: 'auto',
    dayMaxEvents: 3,
    moreLinkText: 'meer',
    eventDidMount: (info) => {
      // Add accessibility attributes
      info.el.setAttribute('role', 'button')
      info.el.setAttribute('aria-label', `Evenement: ${info.event.title}`)
      
      // Show time more clearly for timed events
      if (!info.event.allDay && info.event.start) {
        const timeEl = info.el.querySelector('.fc-event-time')
        if (timeEl) {
          const startTime = formatTime(info.event.start)
          timeEl.textContent = startTime
        }
      }
    }
  }), [events, handleEventClick])

  // ================================================================
  // RENDER
  // ================================================================

  if (isLoading) {
    return (
      <div className="calendar-container">
        <div className="loading-state">
          <div className="loading-content">
            <div className="loading-spinner"></div>
            <h2>Kalender laden...</h2>
            <p>Even geduld terwijl we je evenementen ophalen.</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="calendar-container">
        <div className="error-state">
          <div className="error-content">
            <h2>⚠️ Er is iets misgegaan</h2>
            <p>{error}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="btn btn-primary"
            >
              🔄 Probeer opnieuw
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <h1 className="calendar-title">Kalender</h1>
        {/*<p className="calendar-subtitle">Beheer je evenementen en afspraken</p>*/}
      </div>

      <div className="calendar-wrapper">
        <FullCalendar {...calendarConfig} />
      </div>

      {/* Modals */}
      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onDelete={handleDelete}
          onEdit={handleEdit}
        />
      )}

      {showNewForm && (
        <NewEventForm
          onClose={() => setShowNewForm(false)}
          onAdd={handleAdd}
          users={users}
        />
      )}

      {editingEvent && (
        <NewEventForm
          event={editingEvent}
          isEdit
          onClose={() => setEditingEvent(null)}
          onAdd={handleAdd}
          users={users}
        />
      )}

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

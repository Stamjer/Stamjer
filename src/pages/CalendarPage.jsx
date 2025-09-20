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
 * @author R.S. Kort
 *
 */

// React core imports
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'

// FullCalendar imports for calendar functionality
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin from '@fullcalendar/interaction'
import nlLocale from '@fullcalendar/core/locales/nl'

// Mobile-first custom agenda
import MobileAgenda from '../components/MobileAgenda'

// TanStack Query hooks
import { 
  useEvents, 
  useUsers, 
  useCreateEvent, 
  useUpdateEvent, 
  useDeleteEvent,
  useUpdateAttendance,
} from '../hooks/useQueries'

// Error boundaries
import { CalendarErrorBoundary, FormErrorBoundary, ComponentErrorBoundary } from '../components/ErrorBoundary'

// Toast hook
import { useToast } from '../hooks/useToast'
import { withSupportContact } from '../config/appInfo'

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
 * Format time for display
 */
function formatTime(input) {
  const d = input instanceof Date ? input : new Date(input)
  if (!(d instanceof Date) || isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

/**
 * Whether attendance can be changed for an event based on start date
 */
function canChangeAttendance(eventStart) {
  if (!eventStart) return false
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(eventStart)
  const eventDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  return eventDay > today
}

// ================================================================
// EVENT MODAL COMPONENT
// ================================================================

function EventModal({ event, onClose, onDelete, onEdit, isAdmin = false, currentUser = null, onToggleAttendance }) {
  const [isDeleting, setIsDeleting] = useState(false)
  const dialogRef = useRef(null)
  const focusableElementsRef = useRef([])
  const previouslyFocusedElementRef = useRef(null)

  useEffect(() => {
    if (!event) {
      return
    }

    previouslyFocusedElementRef.current = (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    )

    const dialogNode = dialogRef.current
    if (!dialogNode) {
      return
    }

    const focusableSelectors = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(', ')

    const focusableElements = Array.from(
      dialogNode.querySelectorAll(focusableSelectors)
    ).filter((el) => el instanceof HTMLElement && el.tabIndex !== -1)

    focusableElementsRef.current = focusableElements

    const focusTarget = focusableElements[0] || dialogNode
    focusTarget.focus()

    const handleFocusIn = (focusEvent) => {
      if (!dialogNode.contains(focusEvent.target)) {
        focusEvent.stopPropagation()
        const firstFocusable = focusableElementsRef.current[0] || dialogNode
        firstFocusable.focus()
      }
    }

    document.addEventListener('focusin', handleFocusIn)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      focusableElementsRef.current = []
      const previouslyFocused = previouslyFocusedElementRef.current
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [event])

  if (!event) return null

  const { title, start, end, allDay, extendedProps } = event

  // Attendance state derived from event participants
  const participants = extendedProps?.participants || []
  const initialAttending = !!(currentUser && participants.includes(Number(currentUser.id)))
  const [attending, setAttending] = useState(initialAttending)
  useEffect(() => { setAttending(initialAttending) }, [initialAttending])
  const attendanceDisabled = !currentUser || !canChangeAttendance(start)

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
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }

    if (e.key === 'Tab') {
      const focusable = focusableElementsRef.current
      if (!focusable || focusable.length === 0) {
        e.preventDefault()
        if (dialogRef.current) {
          dialogRef.current.focus()
        }
        return
      }

      const currentIndex = focusable.indexOf(document.activeElement)

      if (e.shiftKey) {
        const targetIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
        focusable[targetIndex].focus()
      } else {
        const targetIndex = currentIndex === -1 || currentIndex === focusable.length - 1
          ? 0
          : currentIndex + 1
        focusable[targetIndex].focus()
      }

      e.preventDefault()
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button 
          type="button"
          className="close-btn" 
          onClick={onClose}
          aria-label="Evenement details sluiten"
        >
          x
        </button>

        <div className="modal-header">
          <h2 id="event-modal-title" className="modal-title">{title}</h2>
        </div>

        <div className="modal-body">
          <div className="event-details">
            {/* Event date/time display */}
            {allDay ? (
              <div className="detail-item">
                <div className="detail-content">
                  <strong>{(() => {
                    const startDate = new Date(start)
                    const endDate = end ? new Date(end) : null
                    const hasValidEnd = endDate && !isNaN(endDate.getTime())
                    if (!hasValidEnd) return 'Datum:'

                    const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
                    if (daysDiff <= 1) return 'Datum:'
                    if (daysDiff === 2) return 'Periode (2 dagen):'
                    return `Periode (${daysDiff} dagen):`
                  })()}</strong>
                  {(() => {
                    const startDate = new Date(start)
                    const endDate = end ? new Date(end) : null
                    const hasValidEnd = endDate && !isNaN(endDate.getTime())
                    if (!hasValidEnd) {
                      return formatDate(startDate)
                    }
                    const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
                    if (daysDiff <= 1) {
                      return formatDate(startDate)
                    }
                    const endDisplayDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000) // Subtract 1 day for display
                    return (
                      <>
                        Van {formatDate(startDate)}
                        <br />
                        Tot {formatDate(endDisplayDate)}
                      </>
                    )
                  })()}
                </div>
              </div>
            ) : (
              <>
                <div className="detail-item">
                  <div className="detail-content">
                    <strong>Datum:</strong>
                    {formatDate(start)}
                  </div>
                </div>
                {end && (
                  <div className="detail-item">
                    <div className="detail-content">
                      <strong>{(() => {
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
                      })()}</strong>
                      {formatTime(start)} - {formatTime(end)}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Attendance toggle for opkomst events */}
            {extendedProps?.isOpkomst && (
              <div className="detail-item">
                <div className="detail-content">
                  <label className={`checkbox-label${attendanceDisabled ? ' disabled' : ''}`} aria-live="polite">
                    <input
                      type="checkbox"
                      className="checkbox-input"
                      checked={attending}
                      onChange={(e) => {
                        const next = e.target.checked
                        setAttending(next) // optimistic UI
                        onToggleAttendance && onToggleAttendance(event.id, next)
                      }}
                      disabled={attendanceDisabled}
                    />
                    <span className="checkbox-custom"></span>
                    {attending ? 'Aangemeld' : 'Afgemeld'}
                  </label>
                  {attendanceDisabled && (
                    <div className="muted-text">Je kan je aanwezigheid niet meer aanpassen</div>
                  )}
                </div>
              </div>
            )}

            {/* Location */}
            {extendedProps?.location && (
              <div className="detail-item">
                <div className="detail-content">
                  <strong>Locatie:</strong>
                  {extendedProps.location}
                </div>
              </div>
            )}

            {/* Opkomstmakers - only show for opkomst events */}
            {extendedProps?.isOpkomst && extendedProps?.opkomstmakers && (
              <div className="detail-item">
                <div className="detail-content">
                  <strong>Team Opkomstmakers:</strong>
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
                  <strong>Beschrijving:</strong>
                  <span className="description-text">{extendedProps.description}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          {isAdmin && (
            <>
              <button 
                type="button" 
                className="modal-btn modal-btn-secondary"
                onClick={() => onEdit(event)}
                disabled={isDeleting}
              >
                 Aanpassen
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
                  <> Verwijderen</>
                )}
              </button>
            </>
          )}
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
          newData.startTime = '20:30'
          newData.endTime = '22:30'
          newData.location = 'Clubhuis Scouting Marco Polo Delft'
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

      const eventData = {
        title: title.trim(),
        start,
        end,
        allDay: isAllDay,
        location: location.trim(),
        description: description.trim(),
        isOpkomst: formData.isOpkomst,
        opkomstmakers: opkomstmakersString,
      }

      if (isEdit) {
        eventData.id = event.id
      }

      // Call the parent handler - this will use TanStack Query mutations
      onAdd(eventData)
      onClose()
    } catch (err) {
      console.error('Error preparing event data:', err)
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
    <div className="modal-overlay" onKeyDown={handleKeyDown}>
      <div className="modal-content modal-content-large" onClick={e => e.stopPropagation()}>
        <button 
          className="close-btn" 
          onClick={onClose}
          aria-label="Formulier sluiten"
        >
          x
        </button>

        <div className="modal-header">
          <h2 id="event-modal-title" className="modal-title">
            {isEdit ? ' Evenement aanpassen' : 'Nieuw evenement'}
          </h2>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-grid">
            {/* Title */}
            <div className="form-group form-group-full">
              <label className="form-label" htmlFor="event-title">
                Titel *
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
           Stam opkomst
              </label>
            </div>

            {/* Opkomstmakers - only show when it's an opkomst */}
            {formData.isOpkomst && (
              <div className="form-group form-group-full">
                <label className="form-label">
                  Team Opkomstmakers selecteren
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
                Tijd Hele dag evenement
              </label>
            </div>

            {/* Start date */}
            <div className="form-group form-group-full">
              <label className="form-label" htmlFor="start-date">
                {formData.isAllDay ? 'Startdatum *' : 'Datum *'}
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
                  Starttijd *
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
              <div className="form-group form-group-full">
                <label className="form-label" htmlFor="end-date">
                  Einddatum *
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
                  Eindtijd *
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
                Locatie
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
                Beschrijving
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
                {isEdit ? 'Opslaan...' : 'Aanmaken...'}
              </>
            ) : (
              <>
                {isEdit ? 'Bewaar wijzigingen' : 'Evenement aanmaken'}
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
// MAIN CALENDAR PAGE COMPONENT
// ================================================================

export default function CalendarPage() {
  // ================================================================
  // STATE MANAGEMENT
  // ================================================================
  
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 600px)').matches
      : false
  )
  const [viewDate, setViewDate] = useState(new Date())

  // Ref for calendar wrapper to handle scroll detection
  const calendarWrapperRef = useRef(null)

  // ================================================================
  // QUERY HOOKS - TANSTACK QUERY
  // ================================================================
  
  // Fetch events with automatic caching and background refetching
  const { 
    data: events = [], 
    isLoading: eventsLoading, 
    error: eventsError,
    refetch: refetchEvents 
  } = useEvents({
    refetchOnWindowFocus: true,
    staleTime: 2 * 60 * 1000, // 2 minutes
  })

  // Fetch users for dropdown selections
  const { 
    data: users = [], 
    isLoading: usersLoading 
  } = useUsers()

  // ================================================================
  // MUTATION HOOKS - OPTIMISTIC UPDATES
  // ================================================================
  
  const createEventMutation = useCreateEvent({
    onSuccess: () => {
      showSuccess('Evenement succesvol toegevoegd')
    },
    onError: (error) => {
      showError(`Kon evenement niet aanmaken: ${error.message}`)
    }
  })

  const updateEventMutation = useUpdateEvent({
    onSuccess: () => {
      showSuccess('Evenement succesvol bijgewerkt')
    },
    onError: (error) => {
      showError(`Kon evenement niet bijwerken: ${error.message}`)
    }
  })

  const deleteEventMutation = useDeleteEvent({
    onSuccess: () => {
      showSuccess('Evenement succesvol verwijderd')
    },
    onError: (error) => {
      showError(`Kon evenement niet verwijderen: ${error.message}`)
    }
  })

  const updateAttendanceMutation = useUpdateAttendance({
    onSuccess: () => {
      showSuccess('Aanwezigheid bijgewerkt')
    },
    onError: (error) => {
      showError(`Kon aanwezigheid niet bijwerken: ${error.message}`)
    }
  })

  // ================================================================
  // TOAST NOTIFICATIONS
  // ================================================================
  
  const { success: showSuccess, error: showError } = useToast()

  // ================================================================
  // USER AUTHENTICATION
  // ================================================================

  // Load current user from localStorage
  React.useEffect(() => {
    try {
      const userData = localStorage.getItem('user')
      if (userData) {
        const user = JSON.parse(userData)
        setCurrentUser(user)
      }
    } catch (error) {
      console.error('Error loading user from localStorage:', error)
    }
  }, [])

  // Track mobile viewport to adjust day header format
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 600px)')
    const handler = (e) => setIsMobile(e.matches)
    // Some browsers use addEventListener, others use addListener
    if (mq.addEventListener) mq.addEventListener('change', handler)
    else mq.addListener(handler)
    setIsMobile(mq.matches)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler)
      else mq.removeListener(handler)
    }
  }, [])

  // Check if current user is admin
  const isAdmin = currentUser && currentUser.isAdmin === true

  // ================================================================
  // EVENT HANDLERS
  // ================================================================

  // Handle event click
  const handleEventClick = useCallback((info) => {
    setSelectedEvent(info.event)
  }, [])

  // Handle event deletion with optimistic updates
  const handleDelete = useCallback(async (ev) => {
    if (!currentUser || !currentUser.isAdmin) {
      showError('Alleen admins kunnen evenementen verwijderen')
      return
    }

    deleteEventMutation.mutate({
      eventId: ev.id,
      userId: currentUser.id
    })
    
    setSelectedEvent(null)
  }, [deleteEventMutation, currentUser, showError])

  // Handle event addition/update with optimistic updates
  const handleAdd = useCallback((eventData, isEdit = false) => {
    if (!currentUser) {
      showError('Je moet ingelogd zijn om evenementen aan te maken')
      return
    }

    if (isEdit) {
      updateEventMutation.mutate({
        eventId: eventData.id,
        eventData: eventData,
        userId: currentUser.id
      })
    } else {
      createEventMutation.mutate({
        eventData: eventData,
        userId: currentUser.id
      })
    }
  }, [createEventMutation, updateEventMutation, currentUser, showError])

  // Toggle attendance for current user
  const handleToggleAttendance = useCallback((eventId, attending) => {
    if (!currentUser) {
      showError('Je moet ingelogd zijn om aanwezigheid te registreren')
      return
    }
    updateAttendanceMutation.mutate({ eventId, userId: currentUser.id, attending })
  }, [currentUser, updateAttendanceMutation, showError])

  // Handle edit button click
  const handleEdit = useCallback((ev) => {
    if (!currentUser || !currentUser.isAdmin) {
      showError('Alleen admins kunnen evenementen bewerken')
      return
    }

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
    const startObj = ev.start instanceof Date ? ev.start : new Date(ev.start)
    const endObjRaw = ev.end instanceof Date || !ev.end ? ev.end : new Date(ev.end)
    const startDate = startObj ? startObj.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
    const endDate = ev.allDay && endObjRaw ? 
      new Date((endObjRaw instanceof Date ? endObjRaw : new Date(endObjRaw)).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10) :
      startDate

    // Get times from Date objects
    const startTime = startObj && !ev.allDay ? 
      (startObj.toTimeString ? startObj.toTimeString().slice(0, 5) : new Date(ev.start).toTimeString().slice(0, 5)) : 
      '09:00'
    const endObj = endObjRaw instanceof Date ? endObjRaw : (endObjRaw ? new Date(endObjRaw) : null)
    const endTime = endObj && !ev.allDay ? 
      endObj.toTimeString().slice(0, 5) : 
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
  }, [users, currentUser, showError])

  // ================================================================
  // CALENDAR CONFIGURATION (OPTIMIZED)
  // ================================================================
  
  // Static calendar configuration (doesn't change often)
  const staticCalendarConfig = useMemo(() => ({
    plugins: [dayGridPlugin, listPlugin, interactionPlugin],
    locale: nlLocale,
    firstDay: 1,
  initialView: isMobile ? 'listMonth' : 'dayGridMonth',
    fixedWeekCount: false,
    showNonCurrentDates: true,
    // Mobile-specific display tweaks for better readability
    eventDisplay: isMobile ? 'block' : 'auto',
    displayEventTime: isMobile ? false : true,
    headerToolbar: {
      left: 'prev today next',
      center: 'title',
  // Show view toggles on the right (month <-> listMonth), and admin action when applicable
  right: `${'dayGridMonth,listMonth'}${isAdmin ? ' nieuwBtn' : ''}`,
    },
    buttonText: { 
      today: 'Vandaag',
      month: 'Maand',
      list: 'Lijst',
      prev: '< Vorige',
      next: 'Volgende >'
    },
    dayHeaderFormat: isMobile ? { weekday: 'short' } : { weekday: 'long' },
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    },
    eventClassNames: (arg) => {
      return arg.event?.extendedProps?.isOpkomst ? ['event-opkomst'] : []
    },
    customButtons: isAdmin ? {
      nieuwBtn: {
        text: 'Nieuw evenement',
        click: () => setShowNewForm(true),
      },
    } : {},
    height: 'auto',
    dayMaxEvents: 3,
    moreLinkText: 'meer',
    eventDidMount: (info) => {
      // Accessibility attributes:
      info.el.setAttribute('role', 'button')
      info.el.setAttribute('aria-label', `Evenement: ${info.event.title}`)
    }
  }), [isAdmin, isMobile])

  // Dynamic calendar configuration (changes with data)
  const dynamicCalendarConfig = useMemo(() => ({
    events,
    eventClick: handleEventClick,
  }), [events, handleEventClick])

  // Final calendar configuration
  const calendarConfig = { ...staticCalendarConfig, ...dynamicCalendarConfig }

  // MobileAgenda navigation handlers
  const handlePrevMonth = useCallback(() => {
    setViewDate(prev => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() - 1)
      return d
    })
  }, [])

  const handleNextMonth = useCallback(() => {
    setViewDate(prev => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() + 1)
      return d
    })
  }, [])

  const handleToday = useCallback(() => {
    setViewDate(new Date())
  }, [])

  // ================================================================
  // LOADING AND ERROR STATES
  // ================================================================

  if (eventsLoading || usersLoading) {
    return (
      <div className="calendar-page-wrapper">
        <div className="calendar-container">
          <div className="loading-state">
            <div className="loading-content">
              <div className="loading-spinner"></div>
              <h2>Kalender laden...</h2>
              <p>Even geduld terwijl we je evenementen ophalen.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (eventsError) {
    return (
      <div className="calendar-page-wrapper">
        <div className="calendar-container">
          <div className="error-state">
            <div className="error-content">
              <h2>Let op Er is iets misgegaan</h2>
              <p>{withSupportContact(`Kon de kalender niet laden: ${eventsError.message}`)}</p>
              <button 
                onClick={() => refetchEvents()} 
                className="btn btn-primary"
              >
                Vernieuwen Probeer opnieuw
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ================================================================
  // RENDER
  // ================================================================

  return (
    <div className="calendar-page-wrapper">
      <div className="calendar-container">
        <div className="calendar-header">
          <h1 className="calendar-title">Kalender</h1>
          {(createEventMutation.isPending || updateEventMutation.isPending || deleteEventMutation.isPending) && (
            <div className="calendar-loading-indicator">
              <div className="loading-spinner small"></div>
              <span>Bezig met opslaan...</span>
            </div>
          )}
        </div>

        {/* Removed duplicate mobile helpers to avoid double controls */}

        <div className="calendar-wrapper" ref={calendarWrapperRef}>
          {isMobile ? (
            <MobileAgenda
              events={events}
              viewDate={viewDate}
              onPrev={handlePrevMonth}
              onToday={handleToday}
              onNext={handleNextMonth}
              onEventClick={(info) => handleEventClick(info)}
            />
          ) : (
            <CalendarErrorBoundary 
              onError={(errorReport) => {
                console.error('Calendar Error:', errorReport)
                showError('Er is een fout opgetreden in de kalender')
              }}
            >
              <FullCalendar {...calendarConfig} />
            </CalendarErrorBoundary>
          )}
        </div>

        {/* Modals */}
        {selectedEvent && (
          <ComponentErrorBoundary componentName="EventModal" onError={() => showError('Er ging iets mis bij het tonen van het evenement')}>
            <EventModal
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
              onDelete={handleDelete}
              onEdit={handleEdit}
              isAdmin={isAdmin}
              currentUser={currentUser}
              onToggleAttendance={handleToggleAttendance}
            />
          </ComponentErrorBoundary>
        )}

        {showNewForm && isAdmin && (
          <FormErrorBoundary formName="Nieuw Evenement">
            <NewEventForm
              onClose={() => setShowNewForm(false)}
              onAdd={(eventData) => handleAdd(eventData, false)}
              users={users}
            />
          </FormErrorBoundary>
        )}

        {editingEvent && isAdmin && (
          <FormErrorBoundary formName="Evenement Bewerken">
            <NewEventForm
              event={editingEvent}
              isEdit
              onClose={() => setEditingEvent(null)}
              onAdd={(eventData) => handleAdd(eventData, true)}
              users={users}
            />
          </FormErrorBoundary>
        )}

      </div>
    </div>
  )
}










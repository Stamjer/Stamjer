/**
 * ================================================================
 * TOAST NOTIFICATION HOOK
 * ================================================================
 * 
 * Custom React hook for managing toast notifications across the application.
 * Provides a simple API for showing success, error, warning, and info messages.
 * 
 * Features:
 * - Auto-dismissal after configurable timeout
 * - Queue management for multiple toasts
 * - Accessibility support with ARIA attributes
 * - Configurable positioning and styling
 * 
 * @author Stamjer Development Team
 * @version 1.3.0
 */

import { useState, useCallback, useEffect } from 'react'
import { withSupportContact } from '../config/appInfo'

let toastId = 0

/**
 * Toast notification hook
 * @param {Object} options - Configuration options
 * @param {number} options.duration - Default duration in milliseconds (default: 5000)
 * @param {number} options.maxToasts - Maximum number of toasts to show at once (default: 5)
 * @returns {Object} Toast management functions and state
 */
export function useToast(options = {}) {
  const { 
    duration = 5000, 
    maxToasts = 5,
    position = 'top-right'
  } = options

  const [toasts, setToasts] = useState([])

  /**
   * Remove a specific toast by ID
   * @param {string} id - Toast ID to remove
   */
  const removeToast = useCallback((id) => {
    setToasts(current => current.filter(toast => toast.id !== id))
  }, [])

  /**
   * Add a new toast notification
   * @param {string} message - The message to display
   * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
   * @param {Object} options - Additional options
   * @returns {string} Toast ID for manual dismissal
   */
  const addToast = useCallback((message, type = 'info', toastOptions = {}) => {
    const id = ++toastId
    const normalizedMessage = typeof message === 'string' ? message.trim() : ''
    const fallbackMessage = type === 'error' ? withSupportContact() : 'Er is een melding beschikbaar'
    const finalMessage = normalizedMessage || fallbackMessage
    const newToast = {
      id,
      message: finalMessage,
      type,
      timestamp: Date.now(),
      duration: toastOptions.duration ?? duration,
      persistent: toastOptions.persistent ?? false,
      action: toastOptions.action,
      ...toastOptions
    }

    setToasts(current => {
      const updated = [newToast, ...current].slice(0, maxToasts)
      return updated
    })

    // Auto-dismiss non-persistent toasts
    if (!newToast.persistent && newToast.duration > 0) {
      setTimeout(() => {
        removeToast(id)
      }, newToast.duration)
    }

    return id
  }, [duration, maxToasts, removeToast])

  /**
   * Remove all toasts
   */
  const clearToasts = useCallback(() => {
    setToasts([])
  }, [])

  /**
   * Show success toast
   * @param {string} message - Success message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID
   */
  const success = useCallback((message, options = {}) => {
    return addToast(message, 'success', options)
  }, [addToast])

  /**
   * Show error toast
   * @param {string} message - Error message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID
   */
  const error = useCallback((message, options = {}) => {
    const messageWithSupport = withSupportContact(message)
    return addToast(messageWithSupport, 'error', { 
      duration: 8000, // Fouten moeten langer zichtbaar blijven
      ...options 
    })
  }, [addToast])

  /**
   * Show warning toast
   * @param {string} message - Warning message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID
   */
  const warning = useCallback((message, options = {}) => {
    return addToast(message, 'warning', options)
  }, [addToast])

  /**
   * Show info toast
   * @param {string} message - Info message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID
   */
  const info = useCallback((message, options = {}) => {
    return addToast(message, 'info', options)
  }, [addToast])

  /**
   * Show loading toast with spinner
   * @param {string} message - Loading message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID
   */
  const loading = useCallback((message, options = {}) => {
    return addToast(message, 'loading', {
      persistent: true,
      ...options
    })
  }, [addToast])

  /**
   * Update an existing toast
   * @param {string} id - Toast ID to update
   * @param {Object} updates - Properties to update
   */
  const updateToast = useCallback((id, updates) => {
    setToasts(current => 
      current.map(toast => 
        toast.id === id ? { ...toast, ...updates } : toast
      )
    )
  }, [])

  /**
   * Promise-based toast for async operations
   * @param {Promise} promise - Promise to track
   * @param {Object} messages - Messages for different states
   * @returns {Promise} Original promise
   */
  const promise = useCallback((promise, messages = {}) => {
    const loadingId = loading(messages.loading || 'Laden...', { persistent: true })

    return promise
      .then((result) => {
        removeToast(loadingId)
        if (messages.success) {
          success(messages.success)
        }
        return result
      })
      .catch((error) => {
        removeToast(loadingId)
        if (messages.error) {
          error(messages.error)
        } else {
          error(error.message || 'Er is een fout opgetreden')
        }
        throw error
      })
  }, [loading, removeToast, success])

  return {
    toasts,
    addToast,
    removeToast,
    clearToasts,
    success,
    error,
    warning,
    info,
    loading,
    updateToast,
    promise,
    position
  }
}

/**
 * Toast context for sharing toast state across components
 */
import React, { createContext, useContext } from 'react'

const ToastContext = createContext()

export function ToastProvider({ children, ...options }) {
  const toast = useToast(options)
  
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  )
}

export function useToastContext() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToastContext must be used within a ToastProvider')
  }
  return context
}

/**
 * Toast container component
 */
function ToastContainer() {
  const { toasts, removeToast, position } = useToastContext()

  if (toasts.length === 0) return null

  const positionClasses = {
    'top-right': 'toast-container-top-right',
    'top-left': 'toast-container-top-left',
    'bottom-right': 'toast-container-bottom-right',
    'bottom-left': 'toast-container-bottom-left',
    'top-center': 'toast-container-top-center',
    'bottom-center': 'toast-container-bottom-center'
  }

  return (
    <div 
      className={`toast-container ${positionClasses[position] || positionClasses['top-right']}`}
      role="region" 
      aria-label="Notificaties"
    >
      {toasts.map((toast) => (
        <ToastItem 
          key={toast.id} 
          toast={toast} 
          onRemove={() => removeToast(toast.id)}
        />
      ))}
    </div>
  )
}

/**
 * Individual toast item component
 */
function ToastItem({ toast, onRemove }) {
  const { message, type, action } = toast

  useEffect(() => {
    // Announce to screen readers
    const announcement = `${type === 'error' ? 'Fout' : type === 'success' ? 'Succesvol' : 'Notificatie'}: ${message}`
    
    // Create a temporary element for screen reader announcement
    const announcer = document.createElement('div')
    announcer.setAttribute('aria-live', 'polite')
    announcer.setAttribute('aria-atomic', 'true')
    announcer.className = 'sr-only'
    announcer.textContent = announcement
    
    document.body.appendChild(announcer)
    
    return () => {
      document.body.removeChild(announcer)
    }
  }, [message, type])

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onRemove()
    }
  }

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    loading: '⏳'
  }

  return (
    <div 
      className={`toast toast-${type}`}
      role="alert"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="toast-content">
        <span className="toast-icon" aria-hidden="true">
          {type === 'loading' ? (
            <div className="loading-spinner toast-spinner"></div>
          ) : (
            icons[type]
          )}
        </span>
        <span className="toast-message">{message}</span>
      </div>
      
      {action && (
        <button
          className="toast-action"
          onClick={action.onClick}
          aria-label={action.label}
        >
          {action.label}
        </button>
      )}
      
      <button 
        className="toast-close" 
        onClick={onRemove}
        aria-label={`${message} sluiten`}
      >
        ×
      </button>
    </div>
  )
}

export default useToast

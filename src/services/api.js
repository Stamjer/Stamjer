/**
 * ================================================================
 * SIMPLIFIED API SERVICE MODULE
 * ================================================================
 * 
 * Clean, simple API service without complex caching logic.
 * TanStack Query handles caching, retries, and optimization.
 * This module focuses only on making HTTP requests.
 * 
 * Features:
 * - Simple, clean request functions
 * - Proper error handling with user-friendly messages
 * - TypeScript-ready structure
 * - Consistent response formatting
 * 
 * @author R.S. Kort
 * @version 2.0.0
 */

// ================================================================
// CONFIGURATION
// ================================================================

/**
 * Base URL for all API requests
 */
const BASE_URL = '/api'

/**
 * Default request timeout (30 seconds)
 */
const DEFAULT_TIMEOUT = 30000

/**
 * Default headers for JSON requests
 */
const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

/**
 * Create timeout promise for request cancellation
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise}
 */
function createTimeoutPromise(timeout) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Aanvraag verlopen na ${timeout}ms`))
    }, timeout)
  })
}

/**
 * Enhanced error handling with user-friendly messages
 * @param {Response} response - Fetch response
 * @param {string} url - Request URL
 * @returns {Promise<Object>} Parsed response data
 * @throws {Error} Enhanced error with user-friendly message
 */
async function handleResponse(response, url) {
  console.log(`API Response: ${response.status} ${response.statusText} for ${url}`)
  
  if (!response.ok) {
    let errorMessage = 'Er is een onbekende fout opgetreden'
    let errorData = null
    
    try {
      // Try to parse error response
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        errorData = await response.json()
        errorMessage = errorData.msg || errorData.message || errorData.error || errorMessage
      } else {
        const text = await response.text()
        if (text) errorMessage = text
      }
    } catch (parseError) {
      console.warn('Could not parse error response:', parseError)
    }
    
    // Provide user-friendly error messages based on status code
    switch (response.status) {
      case 400:
        errorMessage = errorData?.msg || errorData?.message || 'Ongeldige aanvraag. Controleer je invoer.'
        break
      case 401:
        errorMessage = 'Je bent niet ingelogd. Log opnieuw in.'
        break
      case 403:
        errorMessage = 'Je hebt geen toegang tot deze actie.'
        break
      case 404:
        errorMessage = 'De gevraagde informatie werd niet gevonden.'
        break
      case 408:
        errorMessage = 'De aanvraag duurde te lang. Probeer het opnieuw.'
        break
      case 409:
        errorMessage = 'Er is een conflict opgetreden. Probeer het opnieuw.'
        break
      case 422:
        errorMessage = errorData?.message || 'De invoer is ongeldig.'
        break
      case 429:
        errorMessage = 'Te veel aanvragen. Wacht even en probeer opnieuw.'
        break
      case 500:
        errorMessage = 'Er is een serverfout opgetreden. Probeer het later opnieuw.'
        break
      case 502:
      case 503:
      case 504:
        errorMessage = 'De server is tijdelijk niet beschikbaar. Probeer het later opnieuw.'
        break
      default:
        if (response.status >= 500) {
          errorMessage = 'Er is een serverfout opgetreden. Probeer het later opnieuw.'
        } else if (response.status >= 400) {
          errorMessage = errorData?.message || 'Er is een fout opgetreden bij je aanvraag.'
        }
    }
    
    const error = new Error(errorMessage)
    error.status = response.status
    error.statusText = response.statusText
    error.data = errorData
    error.url = url
    throw error
  }
  
  // Parse successful response
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const data = await response.json()
      console.log('API Success:', data)
      return data
    } catch (parseError) {
      console.error('JSON parse error:', parseError)
      throw new Error('Server response was not valid JSON')
    }
  } else if (contentType.includes('text/')) {
    return await response.text()
  } else {
    // For other content types, return the response object
    return response
  }
}

/**
 * Simple fetch wrapper with timeout and error handling
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @param {number} timeout - Request timeout
 * @returns {Promise<Object>} Response data
 */
async function request(url, options = {}, timeout = DEFAULT_TIMEOUT) {
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`
  
  console.log(`API Request: ${options.method || 'GET'} ${fullUrl}`)
  
  // Create abort controller for request cancellation
  const controller = new AbortController()
  const requestOptions = {
    ...options,
    signal: controller.signal,
  }
  
  // Add default headers if body is an object
  if (requestOptions.body && typeof requestOptions.body === 'object') {
    requestOptions.headers = {
      ...JSON_HEADERS,
      ...requestOptions.headers,
    }
    requestOptions.body = JSON.stringify(requestOptions.body)
  }
  
  try {
    // Race between fetch and timeout
    const fetchPromise = fetch(fullUrl, requestOptions)
    const timeoutPromise = createTimeoutPromise(timeout)
    
    const response = await Promise.race([fetchPromise, timeoutPromise])
    return await handleResponse(response, fullUrl)
  } catch (error) {
    // Handle abort errors
    if (error.name === 'AbortError') {
      throw new Error('Request was cancelled')
    }
    
    // Handle network errors
    if (error.message.includes('fetch')) {
      throw new Error('Netwerkfout. Controleer je internetverbinding.')
    }
    
    // Re-throw other errors
    throw error
  }
}

// ================================================================
// AUTHENTICATION API
// ================================================================

/**
 * User login
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} User data
 */
export async function login(email, password) {
  if (!email || !password) {
    throw new Error('E-mail en wachtwoord zijn verplicht')
  }
  
  // Normalize email to lowercase
  const normalizedEmail = email.trim().toLowerCase()
  
  return request('/login', {
    method: 'POST',
    body: { email: normalizedEmail, password }
  })
}

/**
 * Password reset request
 * @param {string} email - User email
 * @returns {Promise<Object>} Reset result
 */
export async function forgotPassword(email) {
  if (!email) {
    throw new Error('E-mail is verplicht')
  }
  
  const normalizedEmail = email.trim().toLowerCase()
  
  return request('/forgot-password', {
    method: 'POST',
    body: { email: normalizedEmail }
  })
}

/**
 * Reset password with verification code
 * @param {string} email - User email
 * @param {string} code - Reset code
 * @param {string} newPassword - New password
 * @returns {Promise<Object>} Reset result
 */
export async function resetPassword(email, code, newPassword) {
  if (!email || !code || !newPassword) {
    throw new Error('E-mail, code en nieuw wachtwoord zijn verplicht')
  }

  const normalizedEmail = email.trim().toLowerCase()

  return request('/reset-password', {
    method: 'POST',
    body: { 
      email: normalizedEmail, 
      code, 
      newPassword 
    }
  })
}

/**
 * Change user password
 * @param {string} email - User email
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 * @returns {Promise<Object>} Change result
 */
export async function changePassword(email, currentPassword, newPassword) {
  if (!email || !currentPassword || !newPassword) {
    throw new Error('E-mail, huidig wachtwoord en nieuw wachtwoord zijn verplicht')
  }
  
  const normalizedEmail = email.trim().toLowerCase()
  
  return request('/change-password', {
    method: 'POST',
    body: { email: normalizedEmail, currentPassword, newPassword }
  })
}

// ================================================================
// EVENTS API
// ================================================================

/**
 * Get all events
 * @returns {Promise<Array>} Events array
 */
export async function getEvents() {
  return request('/events')
}

/**
 * Create new event
 * @param {Object} eventData - Event data
 * @param {number} userId - User ID for admin validation
 * @returns {Promise<Object>} Created event
 */
export async function createEvent(eventData, userId) {
  if (!eventData.title || !eventData.start) {
    throw new Error('Titel en startdatum zijn verplicht')
  }
  
  if (!userId) {
    throw new Error('Gebruiker ID is verplicht voor het aanmaken van evenementen')
  }
  
  return request('/events', {
    method: 'POST',
    body: { ...eventData, userId }
  })
}

/**
 * Update existing event
 * @param {string} eventId - Event ID
 * @param {Object} eventData - Updated event data
 * @param {number} userId - User ID for admin validation
 * @returns {Promise<Object>} Updated event
 */
export async function updateEvent(eventId, eventData, userId) {
  if (!eventId) {
    throw new Error('Event ID is verplicht')
  }
  
  if (!userId) {
    throw new Error('Gebruiker ID is verplicht voor het bewerken van evenementen')
  }
  
  return request(`/events/${eventId}`, {
    method: 'PUT',
    body: { ...eventData, userId }
  })
}

/**
 * Delete event
 * @param {string} eventId - Event ID
 * @param {number} userId - User ID for admin validation
 * @returns {Promise<Object>} Deletion result
 */
export async function deleteEvent(eventId, userId) {
  if (!eventId) {
    throw new Error('Event ID is verplicht')
  }
  
  if (!userId) {
    throw new Error('Gebruiker ID is verplicht voor het verwijderen van evenementen')
  }
  
  return request(`/events/${eventId}`, {
    method: 'DELETE',
    body: { userId }
  })
}

/**
 * Update event attendance
 * @param {string} eventId - Event ID
 * @param {number} userId - User ID
 * @param {boolean} attending - Whether user is attending
 * @returns {Promise<Object>} Updated event data
 */
export async function updateAttendance(eventId, userId, attending) {
  return request(`/events/${eventId}/attendance`, {
    method: 'PUT',
    body: { userId, attending }
  })
}

// ================================================================
// USERS API
// ================================================================

/**
 * Get all users with basic information
 * @returns {Promise<Array>} Users array
 */
export async function getUsers() {
  return request('/users')
}

/**
 * Get all users with full information including streepjes
 * @returns {Promise<Array>} Users array with full info
 */
export async function getUsersFull() {
  return request('/users/full')
}

/**
 * Get user profile
 * @returns {Promise<Object>} User profile data
 */
export async function getUserProfile() {
  return request('/user/profile')
}

/**
 * Update user profile
 * @param {Object} profileData - Updated profile data
 * @returns {Promise<Object>} Updated profile
 */
export async function updateUserProfile(profileData) {
  return request('/user/profile', {
    method: 'PUT',
    body: profileData
  })
}

// ================================================================
// UTILITY EXPORTS
// ================================================================

/**
 * Check if the user is online
 * @returns {boolean} Online status
 */
export function isOnline() {
  return navigator.onLine
}

/**
 * Add network status event listeners
 * @param {Function} onOnline - Callback for online event
 * @param {Function} onOffline - Callback for offline event
 * @returns {Function} Cleanup function
 */
export function addNetworkListeners(onOnline, onOffline) {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}

// ================================================================
// DEFAULT EXPORT
// ================================================================

export default {
  // Authentication
  login,
  forgotPassword,
  resetPassword,
  changePassword,
  
  // Events
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  updateAttendance,
  
  // Users
  getUsers,
  getUsersFull,
  getUserProfile,
  updateUserProfile,
  
  // Utilities
  isOnline,
  addNetworkListeners
}
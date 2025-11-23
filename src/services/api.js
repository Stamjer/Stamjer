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

function getStoredUser() {
  try {
    const rawLocal = typeof localStorage !== 'undefined' ? localStorage.getItem('user') : null
    const rawSession = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('user') : null
    const raw = rawLocal || rawSession
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

/**
 * Enhanced error handling with user-friendly messages
 * @param {Response} response - Fetch response
 * @param {string} url - Request URL
 * @returns {Promise<Object>} Parsed response data
 * @throws {Error} Enhanced error with user-friendly message
 */
async function handleResponse(response, url) {
  if (import.meta.env.DEV) {
    console.log(`API Response: ${response.status} ${response.statusText} for ${url}`)
  }
  
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
      if (import.meta.env.DEV) {
        console.log('API Success:', data)
      }
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

  if (import.meta.env.DEV) {
    console.log(`API Request: ${options.method || 'GET'} ${fullUrl}`)
  }

  const controller = new AbortController()
  const requestOptions = {
    ...options,
    signal: controller.signal,
  }

  const shouldSerializeBody =
    requestOptions.body &&
    typeof requestOptions.body === 'object' &&
    !(requestOptions.body instanceof FormData) &&
    !(typeof Blob !== 'undefined' && requestOptions.body instanceof Blob)

  if (shouldSerializeBody) {
    requestOptions.headers = {
      ...JSON_HEADERS,
      ...requestOptions.headers,
    }
    requestOptions.body = JSON.stringify(requestOptions.body)
  }

  // Attach bearer token when available
  const storedUser = getStoredUser()
  const token = storedUser?.sessionToken
  if (token) {
    requestOptions.headers = {
      ...requestOptions.headers,
      Authorization: `Bearer ${token}`,
    }
  }

  let timeoutId

  try {
    timeoutId = setTimeout(() => controller.abort(), timeout)
    const response = await fetch(fullUrl, requestOptions)
    return await handleResponse(response, fullUrl)
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('De aanvraag duurde te lang en is afgebroken.')
    }

    if (error.message && error.message.includes('fetch')) {
      throw new Error('Netwerkfout. Controleer je internetverbinding.')
    }

    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
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
// NOTIFICATIONS API
// ================================================================

export async function getPushPublicKey() {
  return request('/push/public-key')
}

export async function subscribePush(userId, subscription, metadata = {}) {
  if (!userId || !subscription) {
    throw new Error('Gebruikers-ID en subscription zijn verplicht voor pushmeldingen')
  }

  return request('/push/subscribe', {
    method: 'POST',
    body: {
      userId,
      subscription,
      ...metadata
    }
  })
}

export async function unsubscribePush(endpoint) {
  if (!endpoint) {
    throw new Error('Endpoint is vereist om pushmeldingen uit te schrijven')
  }

  return request('/push/unsubscribe', {
    method: 'POST',
    body: { endpoint }
  })
}

export async function getNotifications(userId) {
  if (!userId) {
    throw new Error('Gebruikers-ID is verplicht voor notificaties')
  }

  const params = new URLSearchParams({ userId: String(userId) })
  return request(`/notifications?${params.toString()}`)
}

export async function markNotificationsRead(userId, notificationIds, read = true) {
  if (!userId) {
    throw new Error('Gebruikers-ID is verplicht om notificaties bij te werken')
  }

  return request('/notifications/mark-read', {
    method: 'POST',
    body: {
      userId,
      notificationIds,
      read
    }
  })
}

export async function markAllNotificationsRead(userId) {
  if (!userId) {
    throw new Error('Gebruikers-ID is verplicht om notificaties bij te werken')
  }

  return request('/notifications/mark-all-read', {
    method: 'POST',
    body: { userId }
  })
}

export async function sendManualNotification(userId, payload) {
  if (!userId) {
    throw new Error('Gebruikers-ID (admin) is verplicht om handmatige notificaties te versturen')
  }
  if (!payload || !payload.title || !payload.message) {
    throw new Error('Titel en bericht zijn verplicht voor een handmatige notificatie')
  }

  return request('/notifications/manual', {
    method: 'POST',
    body: {
      userId,
      ...payload
    }
  })
}

export async function getScheduledNotifications() {
  try {
    return await request('/notifications/scheduled')
  } catch (error) {
    const message = error?.message || ''
    const normalized = message.toLowerCase()
    if (message.includes('404') || normalized.includes('niet gevonden') || normalized.includes('informatie werd niet gevonden')) {
      console.warn('[notifications] Geen endpoint gevonden voor geplande meldingen, leeg resultaat teruggegeven.')
      return { items: [] }
    }
    throw error
  }
}

export async function scheduleNotification(payload) {
  if (!payload || !payload.title || !payload.message) {
    throw new Error('Titel en bericht zijn verplicht om een melding in te plannen')
  }

  return request('/notifications/schedule', {
    method: 'POST',
    body: payload
  })
}

export async function updateScheduledNotification(notificationId, payload) {
  if (!notificationId) {
    throw new Error('Notificatie-ID is verplicht om een geplande melding bij te werken')
  }

  return request(`/notifications/schedule/${notificationId}`, {
    method: 'PUT',
    body: payload
  })
}

export async function cancelScheduledNotification(notificationId) {
  if (!notificationId) {
    throw new Error('Notificatie-ID is verplicht om een geplande melding te annuleren')
  }

  return request(`/notifications/schedule/${notificationId}`, {
    method: 'DELETE'
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
export async function getUserProfile(userId) {
  if (!userId) {
    throw new Error('Gebruikers-ID is verplicht om profiel op te halen')
  }
  return request(`/user/profile?userId=${encodeURIComponent(userId)}`)
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
// PAYMENT REQUESTS API
// ================================================================

/**
 * Submit an expense reimbursement request
 * @param {Object} requestData - Payment request payload
 * @returns {Promise<Object>} Submission result
 */
export async function submitPaymentRequest(requestData) {
  if (!requestData) {
    throw new Error('Aanvraaggegevens ontbreken')
  }

  return request('/payment-requests', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(requestData)
  }, 60000)
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
  getPushPublicKey,
  subscribePush,
  unsubscribePush,
  getNotifications,
  markNotificationsRead,
  markAllNotificationsRead,
  sendManualNotification,
  getScheduledNotifications,
  scheduleNotification,
  updateScheduledNotification,
  cancelScheduledNotification,
  
  // Users
  getUsers,
  getUsersFull,
  getUserProfile,
  updateUserProfile,

  // Payment requests
  submitPaymentRequest,
  
  // Utilities
  isOnline,
  addNetworkListeners
}



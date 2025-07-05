/**
 * ================================================================
 * API SERVICE MODULE - ENHANCED
 * ================================================================
 * 
 * Enhanced API service with improved error handling, retries, caching,
 * and better user experience features.
 * 
 * Features:
 * - Automatic retry logic for failed requests
 * - Request deduplication
 * - Better error messages and handling
 * - Request cancellation support
 * - Response caching for GET requests
 * - Loading state management
 * - Network status detection
 * 
 * @author Stamjer Development Team
 * @version 1.1.0
 */

// ================================================================
// CONFIGURATION
// ================================================================

/**
 * Base URL for all API requests
 */
const BASE = '/api'
console.log('API BASE configured as:', BASE)

/**
 * Default request configuration
 */
const DEFAULT_CONFIG = {
  timeout: 30000, // 30 seconds
  retries: 3,
  retryDelay: 1000, // 1 second
  retryOn: [408, 429, 500, 502, 503, 504], // HTTP status codes to retry
}

/**
 * Cache for GET requests (simple in-memory cache)
 */
const cache = new Map()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/**
 * Pending requests map for deduplication
 */
const pendingRequests = new Map()

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

/**
 * Sleep function for delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generate cache key for requests
 * @param {string} url - Request URL
 * @param {Object} options - Request options
 * @returns {string} Cache key
 */
function getCacheKey(url, options = {}) {
  const method = options.method || 'GET'
  const body = options.body || ''
  return `${method}:${url}:${body}`
}

/**
 * Check if response should be cached
 * @param {string} method - HTTP method
 * @param {Response} response - Fetch response
 * @returns {boolean}
 */
function shouldCache(method, response) {
  return method === 'GET' && response.ok && response.status === 200
}

/**
 * Get cached response if available and not expired
 * @param {string} cacheKey - Cache key
 * @returns {Object|null} Cached data or null
 */
function getCachedResponse(cacheKey) {
  const cached = cache.get(cacheKey)
  if (!cached) return null
  
  const isExpired = Date.now() - cached.timestamp > CACHE_DURATION
  if (isExpired) {
    cache.delete(cacheKey)
    return null
  }
  
  return cached.data
}

/**
 * Cache response data
 * @param {string} cacheKey - Cache key
 * @param {Object} data - Response data
 */
function setCachedResponse(cacheKey, data) {
  cache.set(cacheKey, {
    data,
    timestamp: Date.now()
  })
  
  // Cleanup old entries (keep cache size reasonable)
  if (cache.size > 100) {
    const oldestKey = cache.keys().next().value
    cache.delete(oldestKey)
  }
}

/**
 * Create timeout promise
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise}
 */
function createTimeoutPromise(timeout) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Verzoek timeout na ${timeout}ms`))
    }, timeout)
  })
}

/**
 * Enhanced error handling with better user messages
 * @param {Response} res - Fetch response
 * @param {string} url - Request URL
 * @returns {Promise<Object>} Parsed response data
 * @throws {Error} Enhanced error with user-friendly message
 */
async function handleResponse(res, url) {
  const ct = res.headers.get('content-type') || ''
  console.log(`API Response: ${res.status} ${res.statusText} for ${url}`)
  console.log('Content-Type:', ct)
  
  if (!res.ok) {
    let errorMessage = 'Er is een onbekende fout opgetreden'
    let errorData = null
    
    try {
      // Try to parse error response
      if (ct.includes('application/json')) {
        errorData = await res.json()
        errorMessage = errorData.msg || errorData.message || errorData.error || errorMessage
      } else {
        const text = await res.text()
        if (text) errorMessage = text
      }
    } catch (parseError) {
      console.warn('Kon foutrespons niet verwerken:', parseError)
    }
    
    // Provide user-friendly error messages based on status code
    switch (res.status) {
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
        if (res.status >= 500) {
          errorMessage = 'Er is een serverfout opgetreden. Probeer het later opnieuw.'
        } else if (res.status >= 400) {
          errorMessage = errorData?.message || 'Er is een fout opgetreden bij je aanvraag.'
        }
    }
    
    const error = new Error(errorMessage)
    error.status = res.status
    error.statusText = res.statusText
    error.data = errorData
    error.url = url
    throw error
  }
  
  // Parse successful response
  if (ct.includes('application/json')) {
    try {
      const data = await res.json()
      console.log('API Success:', data)
      return data
    } catch (parseError) {
      console.error('JSON parse error:', parseError)
      throw new Error('Server response was not valid JSON')
    }
  } else if (ct.includes('text/')) {
    return await res.text()
  } else {
    // For other content types, return the response object
    return res
  }
}

/**
 * Enhanced fetch with retry logic, caching, and deduplication
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @param {Object} config - Additional configuration
 * @returns {Promise<Object>} Response data
 */
async function enhancedFetch(url, options = {}, config = {}) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  const fullUrl = url.startsWith('http') ? url : `${BASE}${url}`
  const method = options.method || 'GET'
  const cacheKey = getCacheKey(fullUrl, options)
  
  // Check cache for GET requests
  if (method === 'GET') {
    const cached = getCachedResponse(cacheKey)
    if (cached) {
      console.log('Cache hit for:', fullUrl)
      return cached
    }
  }
  
  // Check for pending identical requests (deduplication)
  if (pendingRequests.has(cacheKey)) {
    console.log('Deduplicating request for:', fullUrl)
    return pendingRequests.get(cacheKey)
  }
  
  // Create abort controller for request cancellation
  const controller = new AbortController()
  const requestOptions = {
    ...options,
    signal: controller.signal,
  }
  
  // Add default headers
  if (!requestOptions.headers) {
    requestOptions.headers = {}
  }
  
  if (requestOptions.body && typeof requestOptions.body === 'object') {
    requestOptions.headers['Content-Type'] = 'application/json'
    requestOptions.body = JSON.stringify(requestOptions.body)
  }
  
  // Retry logic
  let lastError
  let attempt = 0
  
  const executeRequest = async () => {
    attempt++
    console.log(`API Request attempt ${attempt}:`, method, fullUrl)
    
    try {
      // Race between fetch and timeout
      const fetchPromise = fetch(fullUrl, requestOptions)
      const timeoutPromise = createTimeoutPromise(fullConfig.timeout)
      
      const response = await Promise.race([fetchPromise, timeoutPromise])
      const result = await handleResponse(response, fullUrl)
      
      // Cache successful GET responses
      if (shouldCache(method, response)) {
        setCachedResponse(cacheKey, result)
      }
      
      return result
    } catch (error) {
      lastError = error
      
      // Don't retry on abort or certain error types
      if (error.name === 'AbortError') {
        throw error
      }
      
      // Check if we should retry
      const shouldRetry = attempt < fullConfig.retries && 
        (fullConfig.retryOn.includes(error.status) || 
         error.message.includes('timeout') ||
         error.message.includes('Network'))
      
      if (!shouldRetry) {
        throw error
      }
      
      console.log(`Retrying request in ${fullConfig.retryDelay}ms (attempt ${attempt}/${fullConfig.retries})`)
      await sleep(fullConfig.retryDelay * attempt) // Exponential backoff
      
      return executeRequest() // Recursive retry
    }
  }
  
  // Store pending request for deduplication
  const requestPromise = executeRequest()
    .finally(() => {
      pendingRequests.delete(cacheKey)
    })
  
  pendingRequests.set(cacheKey, requestPromise)
  
  return requestPromise
}

// ================================================================
// PUBLIC API FUNCTIONS
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
  
  return enhancedFetch('/login', {
    method: 'POST',
    body: { email, password }
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
  
  return enhancedFetch('/forgot-password', {
    method: 'POST',
    body: { email }
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
  
  return enhancedFetch('/reset-password', {
    method: 'POST',
    body: { email, code, password: newPassword }
  })
}

/**
 * Get all events
 * @returns {Promise<Array>} Events array
 */
export async function getEvents() {
  return enhancedFetch('/events', {
    method: 'GET'
  })
}

/**
 * Create new event
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Created event
 */
export async function createEvent(eventData) {
  if (!eventData.title || !eventData.start) {
    throw new Error('Titel en startdatum zijn verplicht')
  }
  
  return enhancedFetch('/events', {
    method: 'POST',
    body: eventData
  })
}

/**
 * Update existing event
 * @param {string} eventId - Event ID
 * @param {Object} eventData - Updated event data
 * @returns {Promise<Object>} Updated event
 */
export async function updateEvent(eventId, eventData) {
  if (!eventId) {
    throw new Error('Event ID is verplicht')
  }
  
  return enhancedFetch(`/events/${eventId}`, {
    method: 'PUT',
    body: eventData
  })
}

/**
 * Delete event
 * @param {string} eventId - Event ID
 * @returns {Promise<Object>} Deletion result
 */
export async function deleteEvent(eventId) {
  if (!eventId) {
    throw new Error('Event ID is verplicht')
  }
  
  return enhancedFetch(`/events/${eventId}`, {
    method: 'DELETE'
  })
}

/**
 * Get user profile
 * @returns {Promise<Object>} User profile data
 */
export async function getUserProfile() {
  return enhancedFetch('/user/profile', {
    method: 'GET'
  })
}

/**
 * Update user profile
 * @param {Object} profileData - Updated profile data
 * @returns {Promise<Object>} Updated profile
 */
export async function updateUserProfile(profileData) {
  return enhancedFetch('/user/profile', {
    method: 'PUT',
    body: profileData
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
  
  return enhancedFetch('/change-password', {
    method: 'POST',
    body: { email, currentPassword, newPassword }
  })
}

/**
 * Get all users with full information
 * @returns {Promise<Array>} Users array with full info
 */
export async function getUsersFull() {
  return enhancedFetch('/users/full', {
    method: 'GET',
    useCache: true,
    description: 'Loading users with full information'
  })
}

/**
 * Update attendance for an event
 * @param {string} eventId - Event ID
 * @param {number} userId - User ID
 * @param {boolean} attending - Whether user is attending
 * @returns {Promise<Object>} Updated event data
 */
export async function updateAttendance(eventId, userId, attending) {
  return enhancedFetch(`/events/${eventId}/attendance`, {
    method: 'PUT',
    body: JSON.stringify({ userId, attending }),
    headers: {
      'Content-Type': 'application/json'
    },
    description: `Updating attendance for event ${eventId}`
  })
}

// ================================================================
// UTILITY EXPORTS
// ================================================================

/**
 * Clear all cached responses
 */
export function clearCache() {
  cache.clear()
  console.log('API cache cleared')
}

/**
 * Cancel all pending requests
 */
export function cancelAllRequests() {
  pendingRequests.clear()
  console.log('All pending requests cancelled')
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
export function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys())
  }
}

/**
 * Network status checker
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
  login,
  forgotPassword,
  resetPassword,
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getUserProfile,
  updateUserProfile,
  changePassword,
  clearCache,
  cancelAllRequests,
  getCacheStats,
  isOnline,
  addNetworkListeners,
  getUsersFull,
  updateAttendance
}

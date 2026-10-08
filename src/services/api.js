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
import { getGroupContext, trackGroupRequest } from '../lib/groupContext'
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
 * Enhanced error handling with user-friendly messages
 * @param {Response} response - Fetch response
 * @param {string} url - Request URL
 * @returns {Promise<Object>} Parsed response data
 * @throws {Error} Enhanced error with user-friendly message
 */
async function handleResponse(response, url) {
  if (import.meta.env.DEV && !url.includes('/calendar/subscription')) {
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
        errorMessage = errorData?.msg || errorData?.message || errorData?.error || 'Ongeldige aanvraag. Controleer je invoer.'
        break
      case 401:
        errorMessage = 'Je bent niet ingelogd. Log opnieuw in.'
        break
      case 403:
        errorMessage = errorData?.msg || errorData?.message || errorData?.error || 'Je hebt geen toegang tot deze actie.'
        break
      case 404:
        errorMessage = 'De gevraagde informatie werd niet gevonden.'
        break
      case 408:
        errorMessage = 'De aanvraag duurde te lang. Probeer het opnieuw.'
        break
      case 409:
        errorMessage = errorData?.msg || errorData?.message || errorData?.error || 'Er is een conflict opgetreden. Probeer het opnieuw.'
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
      if (import.meta.env.DEV && !url.includes('/calendar/subscription')) {
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
  const requestScope = getGroupContext()
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`

  if (import.meta.env.DEV) {
    console.log(`API Request: ${options.method || 'GET'} ${fullUrl}`)
  }

  const controller = new AbortController()
  const untrack = trackGroupRequest(controller, options.method || 'GET')
  const requestOptions = {
    ...options,
    signal: controller.signal,
    credentials: 'include',
    headers: { ...(requestScope.groupId && !options.skipGroup && !/[?&](?:groupId|allGroups)=/.test(url) && !options.body?.groupId ? { 'X-Group-Id': requestScope.groupId } : {}), ...options.headers },
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

  let timeoutId

  try {
    timeoutId = setTimeout(() => controller.abort(), timeout)
    const response = await fetch(fullUrl, requestOptions)
    const data = await handleResponse(response, fullUrl)
    if (requestScope.generation !== getGroupContext().generation) throw new Error('Groep is gewijzigd; de oude aanvraag is genegeerd.')
    return data
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('De aanvraag duurde te lang en is afgebroken.')
    }

    if (error.message && error.message.includes('fetch')) {
      throw new Error('Netwerkfout. Controleer je internetverbinding.')
    }

    throw error
  } finally {
    untrack()
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export const getMemberships = (userId, groupId) => request(`/users/${userId}/memberships${groupScopeQuery(groupId)}`)
export const getGlobalUsers = () => request('/developer/users')
export const addMembership = (userId, data) => request(`/users/${userId}/memberships`, { method: 'POST', body: data })
export const changeMembership = (id, data) => request(`/memberships/${id}`, { method: 'PATCH', body: data })
export const previewMembershipEnd = id => request(`/memberships/${id}/end/preview`, { method: 'POST', body: {} })
export const endMembership = (id, previewToken, revision) => request(`/memberships/${id}/end`, { method: 'POST', body: { previewToken, revision } })
export const rejoinMembership = (id, revision) => request(`/memberships/${id}/rejoin`, { method: 'POST', body: { revision } })
export const getMembershipHistory = id => request(`/memberships/${id}/history`)
export const rotateMembershipSubscription = id => request(`/memberships/${id}/calendar-token/rotate`, { method: 'POST', body: {} })
export const getPaymentHistory = () => request('/payment-requests')
export const retryPaymentRequest = id => request(`/payment-requests/${id}/retry`, { method: 'POST', body: {} })
export const downloadPaymentReceipt = async (id, file) => {
  const response = await request(`/payment-requests/${id}/files/${file.id}`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = file.name; link.click()
  URL.revokeObjectURL(url)
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
 * Get the currently authenticated user from the secure session cookie.
 * @returns {Promise<Object>} Current session data
 */
export async function getCurrentSession() {
  try { return await request('/session', { method: 'GET' }) } catch (error) {
    if (error.status === 403) return request('/session', { method: 'GET', skipGroup: true })
    throw error
  }
}

/**
 * Logout the current device session.
 * @returns {Promise<Object>} Logout result
 */
export async function logout() {
  return request('/logout', {
    method: 'POST',
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
export async function getEvents(scope) {
  return request(`/events${groupScopeQuery(scope)}`)
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
  
  return request('/events', {
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
  
  return request(`/events/${eventId}`, {
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
  
  return request(`/events/${eventId}`, {
    method: 'DELETE'
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
export async function getUsersFull(scope) {
  return request(`/users/full${groupScopeQuery(scope)}`)
}

export async function createUser(userData) {
  return request('/users', {
    method: 'POST',
    body: userData
  })
}

/**
 * Get user profile
 * @returns {Promise<Object>} User profile data
 */
export async function getUserProfile() {
  return request('/user/profile')
}

export async function getCalendarSubscription() {
  return request('/calendar/subscription')
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

export async function updateUserStatus(targetUserId, status) {
  return request(`/users/${encodeURIComponent(targetUserId)}/status`, {
    method: 'PATCH',
    body: { status }
  })
}

export function groupScopeQuery(scope) {
  if (!scope) return ''
  return scope === '__all__' ? '?allGroups=true' : `?groupId=${encodeURIComponent(scope)}`
}

export async function getGroups() { return request('/groups') }
export async function addExistingMembership(email, groupId) { return request('/memberships/join-existing', { method: 'POST', body: { email, groupId } }) }
export async function createGroup(data) { return request('/groups', { method: 'POST', body: data }) }
export async function updateGroup(id, data) { return request(`/groups/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }) }
export async function rotateCalendarToken(id) { return request(`/groups/${encodeURIComponent(id)}/calendar-token/rotate`, { method: 'POST' }) }
export async function updateManagedUser(id, data, groupId) { return request(`/users/${encodeURIComponent(id)}${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''}`, { method: 'PATCH', body: data }) }
export async function previewUserGroupMove(id, groupId) { return request(`/users/${encodeURIComponent(id)}/group/preview`, { method: 'POST', body: { groupId } }) }
export async function moveUserGroup(id, groupId, previewToken) { return request(`/users/${encodeURIComponent(id)}/group`, { method: 'PATCH', body: { groupId, previewToken } }) }
export async function getUserGroupHistory(scope) { return request(`/users/group-history${groupScopeQuery(scope)}`) }
export async function sendUserPasswordEmail(id, purpose, groupId) { return request(`/users/${encodeURIComponent(id)}/password-email${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''}`, { method: 'POST', body: { purpose } }) }
export async function getDatabaseRecords(collection, scope = '__all__', { page = 1, action = '', actorId = '' } = {}) {
  return request(`/developer/database/${encodeURIComponent(collection)}${groupScopeQuery(scope)}&page=${page}&action=${encodeURIComponent(action)}&actorId=${encodeURIComponent(actorId)}`)
}
export async function previewDatabaseEdit(collection, id, patch) { return request(`/developer/database/${collection}/${encodeURIComponent(id)}/preview`, { method: 'POST', body: patch }) }
export async function applyDatabaseEdit(collection, id, patch, previewToken) { return request(`/developer/database/${collection}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { patch, previewToken } }) }

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


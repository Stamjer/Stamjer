/**
 * ================================================================
 * APPLICATION INFORMATION
 * ================================================================
 *
 * Central place for shared application constants such as support
 * contact details. This module can also expose the application
 * version so UI components stay in sync automatically.
 */

/* global __APP_VERSION__ */

/** Application name for display purposes */
export const APP_NAME = 'Stamjer'

/** Central support contact that should be shown to end users */
export const SUPPORT_EMAIL = 'stamjer.mpd@gmail.com'


const resolvedVersion = (() => {
  try {
    const env = typeof import.meta !== 'undefined' ? import.meta.env : {}
    const envVersion = env?.VITE_APP_VERSION || env?.APP_VERSION
    if (typeof envVersion === 'string' && envVersion.trim().length > 0) {
      return envVersion.trim()
    }
  } catch {
    // Ignore access issues and fall back to global version
  }
  if (typeof __APP_VERSION__ !== 'undefined') {
    return __APP_VERSION__
  }
  return '0.0.0'
})()

/** Application version shared across the UI */
export const APP_VERSION = resolvedVersion

/**
 * Ensure that a user-facing error message clearly mentions the
 * support contact address. Adds punctuation when necessary.
 *
 * @param {string} message - Base error message shown to the user
 * @returns {string} Error message that includes the support email
 */
export function withSupportContact(message = 'Er is een onbekende fout opgetreden') {
  const trimmed = (message || '').trim()
  const base = trimmed || 'Er is een onbekende fout opgetreden'

  const alreadyContainsEmail = base.toLowerCase().includes(SUPPORT_EMAIL.toLowerCase())
  if (alreadyContainsEmail) {
    return base
  }

  const hasEndingPunctuation = ['.', '!', '?'].some((punctuation) => base.endsWith(punctuation))
  const suffix = ` Stuur een e-mail naar ${SUPPORT_EMAIL}.`
  return `${base}${hasEndingPunctuation ? '' : '.'}${suffix}`
}

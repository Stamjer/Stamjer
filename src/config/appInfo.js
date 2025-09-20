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
  // 1) Prefer the build-time version injected by Vite from package.json
  if (typeof __APP_VERSION__ !== 'undefined' && String(__APP_VERSION__).trim().length > 0) {
    const pkgVer = String(__APP_VERSION__).trim()
    try {
      const env = typeof import.meta !== 'undefined' ? import.meta.env : {}
      const envVersion = env?.VITE_APP_VERSION || env?.APP_VERSION
      if (envVersion && String(envVersion).trim() !== pkgVer) {
        // Helpful notice in dev if there's an override mismatch
        if (typeof window !== 'undefined' && import.meta?.env?.DEV) {
          console.warn('[Stamjer] VITE_APP_VERSION differs from package.json version:', envVersion, '!=', pkgVer)
        }
      }
    } catch {
      // ignore
    }
    return pkgVer
  }

  // 2) Fallback to env-based version if provided (e.g., explicit override)
  try {
    const env = typeof import.meta !== 'undefined' ? import.meta.env : {}
    const envVersion = env?.VITE_APP_VERSION || env?.APP_VERSION
    if (typeof envVersion === 'string' && envVersion.trim().length > 0) {
      return envVersion.trim()
    }
  } catch {
    // Ignore access issues
  }

  // 3) Final fallback
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

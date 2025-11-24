import { queryClient } from './queryClient'

async function clearServiceWorkerCaches() {
  try {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
    const registration = await navigator.serviceWorker.ready.catch(() => null)
    const controller = navigator.serviceWorker.controller || registration?.active
    if (controller && typeof controller.postMessage === 'function') {
      controller.postMessage({ type: 'CLEAR_CACHES' })
    }
  } catch (error) {
    console.warn('Failed to request cache clear from service worker:', error)
  }
}

/**
 * Perform a full application reset:
 * - Cancel any in-flight queries
 * - Clear cached query data
 * - Trigger a window reload to fetch fresh data
 */
export async function performHardReset() {
  try {
    await queryClient.cancelQueries()
    queryClient.clear()
    await clearServiceWorkerCaches()
  } catch (error) {
    console.error('Hard reset failed:', error)
  } finally {
    window.location.reload()
  }
}

export default performHardReset

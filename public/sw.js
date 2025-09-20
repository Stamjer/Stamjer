/**
 * Service Worker for Stamjer Application
 * Provides offline functionality and caching for mobile users
 */

const CACHE_NAME = 'stamjer-v1.4.0'
const STATIC_CACHE_NAME = 'stamjer-static'
const DYNAMIC_CACHE_NAME = 'stamjer-dynamic'

// Assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/stam_H.png'
]

// API endpoints to cache dynamically
const API_CACHE_PATTERNS = [
  /\/api\//,
  /\/data\//
]

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...')
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching static assets')
        return cache.addAll(STATIC_ASSETS)
      })
      .then(() => {
        console.log('Service Worker: Static assets cached')
        return self.skipWaiting()
      })
      .catch((error) => {
        console.error('Service Worker: Error caching static assets', error)
      })
  )
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...')
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE_NAME && 
                cacheName !== DYNAMIC_CACHE_NAME &&
                cacheName !== CACHE_NAME) {
              console.log('Service Worker: Deleting old cache', cacheName)
              return caches.delete(cacheName)
            }
          })
        )
      })
      .then(() => {
        console.log('Service Worker: Activated')
        return self.clients.claim()
      })
  )
})

// Fetch event - serve cached content when offline
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return
  }

  // Handle navigation requests (pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => {
          // If network fails, serve cached index.html
          return caches.match('/index.html')
        })
    )
    return
  }

  // Handle API requests
  if (API_CACHE_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    event.respondWith(
      caches.open(DYNAMIC_CACHE_NAME)
        .then((cache) => {
          return fetch(request)
            .then((response) => {
              // Cache successful responses
              if (response.status === 200) {
                cache.put(request, response.clone())
              }
              return response
            })
            .catch(() => {
              // If network fails, serve from cache
              return caches.match(request)
            })
        })
    )
    return
  }

  // Handle static assets
  event.respondWith(
    caches.match(request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(request)
          .then((fetchResponse) => {
            // Cache new assets for future use
            if (fetchResponse.status === 200) {
              const responseClone = fetchResponse.clone()
              caches.open(DYNAMIC_CACHE_NAME)
                .then((cache) => {
                  cache.put(request, responseClone)
                })
            }
            return fetchResponse
          })
      })
      .catch(() => {
        // If all fails and it's an image, return placeholder
        if (request.destination === 'image') {
          return new Response('', {
            status: 200,
            statusText: 'OK',
            headers: {
              'Content-Type': 'image/svg+xml'
            }
          })
        }
      })
  )
})

// Background sync for form submissions
self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync triggered', event.tag)
  
  if (event.tag === 'background-sync-form') {
    event.waitUntil(
      // Handle any pending form submissions
      handleBackgroundSync()
    )
  }
})

// Push notifications (for future use)
self.addEventListener('push', (event) => {
  console.log('Service Worker: Push message received', event)
  
  const options = {
    body: event.data ? event.data.text() : 'Nieuwe update beschikbaar',
    icon: '/stam_H.png',
    badge: '/stam_H.png',
    data: {
      url: '/'
    },
    actions: [
      {
        action: 'open',
        title: 'Openen',
        icon: '/stam_H.png'
      }
    ]
  }

  event.waitUntil(
    self.registration.showNotification('Stamjer', options)
  )
})

// Notification click handling
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked', event)
  
  event.notification.close()

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      self.clients.openWindow(event.notification.data.url || '/')
    )
  }
})

// Handle background sync
async function handleBackgroundSync() {
  try {
    // Get any stored form data from IndexedDB
    const pendingData = await getPendingFormData()
    
    if (pendingData.length > 0) {
      for (const data of pendingData) {
        try {
          await submitFormData(data)
          await removePendingFormData(data.id)
        } catch (error) {
          console.error('Service Worker: Failed to submit form data', error)
        }
      }
    }
  } catch (error) {
    console.error('Service Worker: Background sync error', error)
  }
}

// Placeholder functions for background sync (to be implemented)
async function getPendingFormData() {
  // Implementation would read from IndexedDB
  return []
}

async function submitFormData(data) {
  // Implementation would submit to API
  return fetch(data.url, {
    method: data.method,
    headers: data.headers,
    body: data.body
  })
}

async function removePendingFormData() {
  // Implementation would remove from IndexedDB
  return Promise.resolve()
}

console.log('Service Worker: Script loaded')





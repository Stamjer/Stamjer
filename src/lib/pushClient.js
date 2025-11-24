import { getPushPublicKey, subscribePush, unsubscribePush } from '../services/api'

const DEVICE_ID_KEY = 'pushDeviceId'

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `dev-${Math.random().toString(16).slice(2)}-${Date.now()}`
}

export function getDeviceId() {
  if (typeof localStorage === 'undefined') return null
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const fresh = randomId()
  try {
    localStorage.setItem(DEVICE_ID_KEY, fresh)
  } catch {}
  return fresh
}

export function getPushCapability() {
  const supported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

  return {
    supported,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  }
}

async function ensureServiceWorkerReady() {
  if (!navigator?.serviceWorker) {
    throw new Error('Service worker niet beschikbaar in deze browser.')
  }

  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) {
    return existing.active ? existing : navigator.serviceWorker.ready
  }

  const devEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_PWA_DEV === 'true'
  if (import.meta.env.DEV && !devEnabled) {
    throw new Error('Service worker staat uit in ontwikkelmodus. Zet VITE_ENABLE_PWA_DEV=true en vernieuw de pagina om push te testen.')
  }

  throw new Error('Service worker is nog niet actief. Vernieuw de pagina en probeer opnieuw.')
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }

  return outputArray
}

function buildMetadata(deviceId) {
  if (typeof window === 'undefined') return {}
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    deviceId,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'unknown',
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    timeZone: tz,
    href: window.location.href,
  }
}

export async function getPushSubscriptionStatus() {
  const capability = getPushCapability()
  if (!capability.supported) {
    return { status: 'unsupported', capability }
  }

  try {
    const registration = await navigator.serviceWorker.ready
    const activeSubscription = await registration.pushManager.getSubscription()
    if (activeSubscription) {
      return { status: 'subscribed', capability, subscription: activeSubscription }
    }

    if (capability.permission === 'denied') {
      return { status: 'blocked', capability }
    }

    if (capability.permission === 'granted') {
      return { status: 'granted', capability }
    }

    return { status: 'default', capability }
  } catch (error) {
    console.warn('[push] Kon push-status niet bepalen:', error)
    return { status: capability.permission === 'denied' ? 'blocked' : 'unknown', capability }
  }
}

export async function enablePushForUser(userId) {
  const capability = getPushCapability()

  if (!capability.supported) {
    return { status: 'unsupported', message: 'Pushmeldingen worden niet ondersteund op dit apparaat.' }
  }

  if (!capability.online) {
    throw new Error('Geen internet. Pushmeldingen worden geactiveerd zodra je online bent.')
  }

  let permission = capability.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }

  if (permission !== 'granted') {
    return {
      status: 'blocked',
      message: 'Pushmeldingen zijn geblokkeerd door je browser. Sta meldingen toe via de site-instellingen.',
    }
  }

  const registration = await ensureServiceWorkerReady()
  const { vapidPublicKey, publicKey, enabled = true } = await getPushPublicKey()
  const key = vapidPublicKey || publicKey

  if (!enabled || !key) {
    throw new Error('Pushmeldingen zijn niet geconfigureerd. Probeer het later opnieuw of neem contact op met een admin.')
  }

  const deviceId = getDeviceId()
  const existingSubscription = await registration.pushManager.getSubscription()
  if (existingSubscription) {
    try {
      await unsubscribePush({ endpoint: existingSubscription.endpoint, deviceId })
    } catch (unsubscribeError) {
      console.warn('[push] Bestaande subscription kon niet worden afgemeld:', unsubscribeError)
    }

    try {
      await existingSubscription.unsubscribe()
    } catch (unsubscribeError) {
      console.warn('[push] Lokale subscription kon niet worden verwijderd:', unsubscribeError)
    }
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  })

  await subscribePush(userId, subscription.toJSON(), buildMetadata(deviceId))

  return {
    status: 'subscribed',
    subscription,
    deviceId,
    message: 'Pushmeldingen zijn ingeschakeld.',
  }
}

export async function disablePushForUser() {
  const capability = getPushCapability()
  const deviceId = getDeviceId()

  if (!capability.online) {
    throw new Error('Geen internet. Pushmeldingen uitschakelen lukt niet terwijl je offline bent.')
  }

  if (!capability.supported) {
    try {
      if (deviceId) {
        await unsubscribePush({ deviceId })
      }
    } catch (error) {
      console.warn('[push] Server afmelden zonder support mislukt:', error)
    }
    return { status: 'disabled', message: 'Pushmeldingen uitgeschakeld.' }
  }

  const registration = await ensureServiceWorkerReady()
  const existingSubscription = await registration.pushManager.getSubscription()

  if (existingSubscription) {
    try {
      await unsubscribePush({ endpoint: existingSubscription.endpoint, deviceId })
    } catch (unsubscribeError) {
      console.warn('[push] Afmelden op server mislukt:', unsubscribeError)
    }

    try {
      await existingSubscription.unsubscribe()
    } catch (unsubscribeError) {
      console.warn('[push] Lokale afmelding mislukt:', unsubscribeError)
    }
  } else {
    if (deviceId) {
      try {
        await unsubscribePush({ deviceId })
      } catch (error) {
        console.warn('[push] Geen lokale subscription, server afmelding mislukt:', error)
      }
    }
  }

  return { status: 'disabled', message: 'Pushmeldingen uitgeschakeld.' }
}

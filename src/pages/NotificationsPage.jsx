import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  useNotifications,
  useMarkNotificationsRead,
  useMarkAllNotificationsRead
} from '../hooks/useQueries'
import { subscribePush, getPushPublicKey } from '../services/api'
import { formatNotificationMessageMarkup } from '../lib/formatNotificationMessage'
import './NotificationPage.css'

const NOTIFICATION_TYPE_LABELS = {
  'opkomst-makers-reminder': 'Opkomstmakers',
  'opkomst-attendance-reminder': 'Opkomst',
  'schoonmaak-reminder': 'Schoonmaak',
  manual: 'Handmatig',
  general: 'Melding'
}

const PRIORITY_LABELS = {
  info: 'Info',
  normal: 'Bericht',
  high: 'Belangrijk'
}

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('nl', { numeric: 'auto' })

const TIME_INTERVALS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000
}

function formatRelativeTime(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''

  const now = Date.now()
  const delta = date.getTime() - now
  const absDelta = Math.abs(delta)

  let unit = 'year'
  let divisor = TIME_INTERVALS.year

  if (absDelta < TIME_INTERVALS.minute) {
    unit = 'second'
    divisor = TIME_INTERVALS.second
  } else if (absDelta < TIME_INTERVALS.hour) {
    unit = 'minute'
    divisor = TIME_INTERVALS.minute
  } else if (absDelta < TIME_INTERVALS.day) {
    unit = 'hour'
    divisor = TIME_INTERVALS.hour
  } else if (absDelta < TIME_INTERVALS.week) {
    unit = 'day'
    divisor = TIME_INTERVALS.day
  } else if (absDelta < TIME_INTERVALS.month) {
    unit = 'week'
    divisor = TIME_INTERVALS.week
  } else if (absDelta < TIME_INTERVALS.year) {
    unit = 'month'
    divisor = TIME_INTERVALS.month
  }

  const value = Math.round(delta / divisor)
  return RELATIVE_TIME_FORMATTER.format(value, unit)
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

function coerceClientUrl(target) {
  try {
    const normalized = new URL(target, window.location.origin)
    return {
      href: normalized.href,
      path: `${normalized.pathname}${normalized.search}${normalized.hash}`
    }
  } catch (error) {
    console.warn('[notifications] Kan URL niet parseren:', error)
    return { href: target, path: target }
  }
}

function NotificationsPage({ user }) {
  const navigate = useNavigate()
  const [isSubscribing, setIsSubscribing] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [subscriptionStatus, setSubscriptionStatus] = useState('unknown')
  const [selectedNotification, setSelectedNotification] = useState(null)
  const isAdmin = Boolean(user?.isAdmin)

  const hasUser = Boolean(user?.id)

  const {
    data: notificationsData = { notifications: [], unreadCount: 0, push: { enabled: false } },
    refetch,
    isFetching
  } = useNotifications(hasUser ? user.id : undefined, {
    enabled: hasUser
  })

  const markReadMutation = useMarkNotificationsRead()
  const markAllReadMutation = useMarkAllNotificationsRead()

  const notifications = notificationsData.notifications ?? []
  const unreadCount = notificationsData.unreadCount ?? 0
  const pushServerEnabled = Boolean(notificationsData.push?.enabled)
  const accountPushPreferred = Boolean(user?.notificationPreferences?.push)

  const pushSupported = useMemo(() => (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  ), [])

  const canEnablePush = pushSupported && pushServerEnabled && subscriptionStatus !== 'subscribed'

  useEffect(() => {
    if (!hasUser || !pushSupported) {
      setSubscriptionStatus(pushSupported ? 'disabled' : 'unsupported')
      return
    }

    let isMounted = true

    const detectSubscription = async () => {
      try {
        const registration = await navigator.serviceWorker.ready
        const activeSubscription = await registration.pushManager.getSubscription()
        if (!isMounted) return

        if (activeSubscription) {
          setSubscriptionStatus('subscribed')
        } else if (Notification.permission === 'denied') {
          setSubscriptionStatus('denied')
        } else if (Notification.permission === 'granted') {
          setSubscriptionStatus('granted')
        } else {
          setSubscriptionStatus('default')
        }
      } catch (error) {
        console.warn('[notifications] Kan push-status niet bepalen:', error)
        if (isMounted) {
          setSubscriptionStatus(Notification.permission === 'denied' ? 'denied' : 'unknown')
        }
      }
    }

    detectSubscription()
    return () => {
      isMounted = false
    }
  }, [hasUser, pushSupported])

  useEffect(() => {
    if (!navigator?.serviceWorker) return undefined

    const handleMessage = (event) => {
      const messageType = event?.data?.type
      if (!messageType) return

      if (messageType === 'notification-received' || messageType === 'notification-clicked') {
        refetch()
      }
    }

    navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
  }, [refetch])

  const formattedNotifications = useMemo(() => (
    notifications.map((notification) => {
      const bodyText = notification.body || notification.message || ''
      return {
        ...notification,
        body: bodyText,
        label: PRIORITY_LABELS[notification.priority] ?? PRIORITY_LABELS.normal,
        priority: notification.priority || 'normal',
        relativeTime: formatRelativeTime(notification.createdAt),
        target: notification.url || notification.href ? coerceClientUrl(notification.url || notification.href) : null,
        formattedBody: formatNotificationMessageMarkup(bodyText)
      }
    })
  ), [notifications])

  useEffect(() => {
    if (!selectedNotification) return
    const updated = formattedNotifications.find((item) => item.id === selectedNotification.id)
    setSelectedNotification(updated || null)
  }, [formattedNotifications, selectedNotification])

  const handleMarkAllRead = () => {
    if (!hasUser || unreadCount === 0) return

    markAllReadMutation.mutate({ userId: user.id }, {
      onSuccess: () => {
        refetch()
      },
      onError: () => {
        setStatusMessage('Kon meldingen niet als gelezen markeren. Probeer het later opnieuw.')
      }
    })
  }

  const handleToggleRead = (event, notification) => {
    event.stopPropagation()
    if (!hasUser || markReadMutation.isLoading) return

    const markAsRead = !notification.read
    markReadMutation.mutate({ userId: user.id, notificationIds: [notification.id], read: markAsRead }, {
      onSuccess: () => {
        refetch()
        if (selectedNotification?.id === notification.id) {
          setSelectedNotification((prev) => (prev ? { ...prev, read: markAsRead } : prev))
        }
      },
      onError: () => {
        setStatusMessage('Bijwerken van de leesstatus is mislukt.')
      }
    })
  }

  const handleSelectNotification = (notification) => {
    setSelectedNotification(notification)
    if (hasUser && notification && !notification.read && !markReadMutation.isLoading) {
      markReadMutation.mutate({ userId: user.id, notificationIds: [notification.id], read: true })
    }
  }

  const handleOpenTarget = (event, notification) => {
    event?.stopPropagation()
    if (!notification?.target) return
    if (notification.target.path?.startsWith('/')) {
      navigate(notification.target.path)
    } else if (notification.target.href) {
      window.open(notification.target.href, '_blank', 'noopener,noreferrer')
    }
  }

  const handleEnablePush = async () => {
    if (!pushSupported || !hasUser) return

    const ensureServiceWorkerRegistration = async () => {
      if (!navigator?.serviceWorker) {
        throw new Error('Service worker niet beschikbaar in deze browser.')
      }

      const existing = await navigator.serviceWorker.getRegistration()
      if (existing) return existing

      const devEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_PWA_DEV === 'true'
      if (import.meta.env.DEV && !devEnabled) {
        throw new Error('Service worker staat uit in ontwikkelmodus. Zet VITE_ENABLE_PWA_DEV=true en ververs de pagina om push te testen.')
      }

      throw new Error('Service worker nog niet actief. Vernieuw de pagina nadat je VITE_ENABLE_PWA_DEV=true hebt gezet.')
    }

    try {
      setIsSubscribing(true)
      setStatusMessage('Pushmeldingen worden ingeschakeld...')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setSubscriptionStatus(permission)
        setStatusMessage('Je moet toestemming geven om pushmeldingen te ontvangen.')
        return
      }

      const registration = await ensureServiceWorkerRegistration()
      const readyRegistration = registration.active ? registration : await navigator.serviceWorker.ready
      const { vapidPublicKey, publicKey, enabled = true } = await getPushPublicKey()
      const key = vapidPublicKey || publicKey

      if (!enabled || !key) {
        throw new Error('Pushmeldingen zijn niet geconfigureerd. Probeer het later opnieuw of neem contact op met een admin.')
      }

      const subscription = await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      })

      await subscribePush(user.id, subscription.toJSON())

      setStatusMessage('Pushmeldingen zijn geactiveerd.')
      setSubscriptionStatus('subscribed')
      refetch()
    } catch (error) {
      console.error('[notifications] Push instellen mislukt:', error)
      setStatusMessage(error?.message || 'Pushmeldingen inschakelen is mislukt. Probeer het later opnieuw.')
    } finally {
      setIsSubscribing(false)
    }
  }

  const renderStatus = () => {
    if (!pushSupported) {
      return <p className="notification-status error">Deze browser ondersteunt geen pushmeldingen.</p>
    }

    if (!pushServerEnabled) {
      return (
        <p className="notification-status">
          Pushmeldingen zijn nog niet ingeschakeld. Zet ze aan via{' '}
          <Link to="/account">Account &gt; Meldingen</Link>.
        </p>
      )
    }

    if (accountPushPreferred && subscriptionStatus !== 'subscribed') {
      return (
        <p className="notification-status">
          Pushmeldingen staan aan voor je account. Activeer ze op dit toestel met de knop hieronder.
        </p>
      )
    }

    if (subscriptionStatus === 'denied') {
      return <p className="notification-status error">Pushmeldingen zijn door de browser geblokkeerd. Pas de instellingen aan om ze te activeren.</p>
    }

    if (subscriptionStatus === 'subscribed') {
      return <p className="notification-status success"></p>
    }

    return null
  }

  return (
    <section className="notification-page" aria-labelledby="notification-page-title">
      <div className="notification-panel card-elevated" role="region" aria-live="polite">
        <div className="notification-panel__header">
          <div className="notification-page__title">
            <div>
              <p className="notification-page__meta">
                {`${notifications.length} totaal - ${unreadCount} ongelezen`}
              </p>
            </div>
          </div>

          <div className="notification-panel__actions">
            {isAdmin && (
              <button
                type="button"
                className="btn btn-secondary notification-manage-btn"
                onClick={() => navigate('/meldingen/beheer')}
              >
                Meldingbeheer
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary notification-mark-all"
              onClick={handleMarkAllRead}
              disabled={!hasUser || unreadCount === 0 || markAllReadMutation.isLoading}
            >
              {isAdmin
                ? <>Markeer alles <br /> als gelezen</>
                : <>Markeer alles als gelezen</>}

            </button>
          </div>
        </div>

        {renderStatus()}

        {subscriptionStatus !== 'subscribed' && canEnablePush && (
          <div className="notification-panel__cta">
            <p>Ontvang meteen een melding wanneer er een nieuwe update voor je klaarstaat.</p>
            <button
              type="button"
              className="btn btn-primary notification-enable-btn"
              onClick={handleEnablePush}
              disabled={isSubscribing}
            >
              {isSubscribing ? 'Bezig...' : 'Pushmeldingen inschakelen'}
            </button>
          </div>
        )}

        {statusMessage && (
          <p className="notification-status message">{statusMessage}</p>
        )}

        <div className="notification-list" role="list">
          {formattedNotifications.length === 0 ? (
            <div className="notification-empty" role="status">
              Je hebt nog geen meldingen.
            </div>
          ) : (
            formattedNotifications.map((notification) => {
              const isOpen = selectedNotification?.id === notification.id
              return (
                <div
                  key={notification.id}
                  role="listitem"
                  className={`notification-item notification-item--compact${notification.read ? '' : ' notification-item--unread'}${isOpen ? ' notification-item--expanded' : ''}`}
                  onClick={() => {
                    if (isOpen) {
                      setSelectedNotification(null)
                    } else {
                      handleSelectNotification(notification)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (isOpen) {
                        setSelectedNotification(null)
                      } else {
                        handleSelectNotification(notification)
                      }
                    }
                  }}
                  tabIndex={0}
                >
                  <span className={`notification-priority-badge notification-priority-badge--${notification.priority}`}>
                      {notification.label}
                  </span>
                  <div className="notification-item__header notification-item__header--tight">
                    <div className="notification-item__meta">
                      <span
                        className="notification-item__time"
                        aria-label={`Verzonden op ${new Date(notification.createdAt).toLocaleString('nl-NL')}`}
                      >
                        {notification.relativeTime}
                      </span>
                      <button
                        type="button"
                        className="notification-item__mark notification-item__mark--solid"
                        onClick={(event) => handleToggleRead(event, notification)}
                        disabled={markReadMutation.isLoading}
                      >
                        {notification.read ? 'Markeer ongelezen' : 'Markeer gelezen'}
                      </button>
                    </div>
                  </div>
                  <p className="notification-item__title">{notification.title}</p>

                  {isOpen && (
                    <div className="notification-item__details">
                      {notification.body && (
                        <div
                          className="notification-item__message"
                          dangerouslySetInnerHTML={notification.formattedBody}
                        />
                      )}
                      {notification.target && (
                        <a
                          className="notification-detail__link"
                          href={notification.target.path || notification.target.href}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (notification.target.path?.startsWith('/')) {
                              event.preventDefault()
                              handleOpenTarget(event, notification)
                            }
                          }}
                          target={notification.target.href ? '_blank' : undefined}
                          rel="noopener noreferrer"
                        >
                          {notification.target.path || notification.target.href}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </section>
  )
}

export default NotificationsPage

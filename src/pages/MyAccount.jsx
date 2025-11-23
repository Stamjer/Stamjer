import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { withSupportContact } from '../config/appInfo'
import {
  changePassword,
  updateUserProfile,
  getEvents,
  subscribePush,
  getPushPublicKey,
  unsubscribePush
} from '../services/api'
import { invalidateEvents, invalidateUsers } from '../lib/queryClient'
import CalendarSubscription from '../components/CalendarSubscription'
import LocationLink from '../components/LocationLink'
import ToggleSwitch from '../components/ToggleSwitch'
import './MyAccount.css'
import './Auth.css'

const DEFAULT_NOTIFICATION_SETTINGS = {
  push: false,
  email: false
}

const DATE_FORMAT_DAY_MONTH = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})

const DATE_FORMAT_DAY_MONTH_YEAR = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
})

const TIME_FORMAT_HM = new Intl.DateTimeFormat('nl-NL', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

function normalizeNotificationSettings(settings = {}) {
  return {
    push: Boolean(settings.push),
    email: Boolean(settings.email)
  }
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

function normalizeValue(value = '') {
  return value.trim().toLowerCase()
}

function splitNames(value = '') {
  return value
    .replace(/\sen\s/gi, ',')
    .split(/[,/&]+/)
    .map(name => name.trim())
    .filter(Boolean)
}

const splitOpkomstmakerNames = splitNames
const splitSchoonmakerNames = splitNames

function safeParseDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function capitalize(value) {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatOpkomstDate(start, end, allDay) {
  const startDate = safeParseDate(start)
  if (!startDate) return 'Datum onbekend'

  const dateLabel = capitalize(DATE_FORMAT_DAY_MONTH.format(startDate))

  if (allDay) {
    return dateLabel
  }

  return dateLabel
}

function renderOpkomstDateDetails(opkomst) {
  if (!opkomst?.start) {
    return 'Datum onbekend'
  }

  const startDate = safeParseDate(opkomst.start)
  if (!startDate) {
    return 'Datum onbekend'
  }

  if (opkomst.allDay) {
    if (!opkomst.end) {
      return DATE_FORMAT_DAY_MONTH_YEAR.format(startDate)
    }

    const endDate = safeParseDate(opkomst.end)
    if (!endDate) {
      return DATE_FORMAT_DAY_MONTH_YEAR.format(startDate)
    }

    const adjustedEnd = new Date(endDate.getTime() - 24 * 60 * 60 * 1000)
    if (adjustedEnd.toDateString() === startDate.toDateString()) {
      return DATE_FORMAT_DAY_MONTH_YEAR.format(startDate)
    }

    return `Van ${DATE_FORMAT_DAY_MONTH_YEAR.format(startDate)}\nTot ${DATE_FORMAT_DAY_MONTH_YEAR.format(adjustedEnd)}`
  }

  return DATE_FORMAT_DAY_MONTH_YEAR.format(startDate)
}

function renderOpkomstTimeRange(opkomst) {
  if (!opkomst || opkomst.allDay || !opkomst.start) {
    return null
  }

  const startDate = safeParseDate(opkomst.start)
  if (!startDate) {
    return null
  }

  const startLabel = TIME_FORMAT_HM.format(startDate)
  if (!opkomst.end) {
    return startLabel
  }

  const endDate = safeParseDate(opkomst.end)
  if (!endDate) {
    return startLabel
  }

  return `${startLabel} - ${TIME_FORMAT_HM.format(endDate)}`
}

export default function MyAccount({ user: userProp, onLogout }) {
  const navigate = useNavigate()
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  })
  const [activeStatus, setActiveStatus] = useState(false)
  const [isUpdatingActive, setIsUpdatingActive] = useState(false)
  const [userWithStreepjes, setUserWithStreepjes] = useState(null)
  const [opkomstEvents, setOpkomstEvents] = useState([])
  const [isOpkomstenLoading, setIsOpkomstenLoading] = useState(true)
  const [opkomstenError, setOpkomstenError] = useState(null)
  const [selectedOpkomst, setSelectedOpkomst] = useState(null)
  const [notificationSettings, setNotificationSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS)
  const [notificationSettingsStatus, setNotificationSettingsStatus] = useState(null)
  const [isSavingNotificationSettings, setIsSavingNotificationSettings] = useState(false)
  const pushSupported = useMemo(
    () =>
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window,
    []
  )

  let user = userProp
  if (!user) {
    try {
      const fromSession = sessionStorage.getItem('user')
      const fromLocal = localStorage.getItem('user')
      const raw = fromSession || fromLocal
      if (raw) user = JSON.parse(raw)
    } catch {
      localStorage.removeItem('user')
      sessionStorage.removeItem('user')
    }
  }

  useEffect(() => {
    const loadUserData = async () => {
      if (!user) {
        return
      }

      try {
        const response = await fetch('/api/users/full')
        if (!response.ok) {
          return
        }
        const data = await response.json()
        const currentUser = data.users.find(u => u.id === user.id)
        if (currentUser) {
          setUserWithStreepjes(currentUser)
        }
      } catch (loadError) {
        console.error('Error loading user data:', loadError)
      }
    }

    loadUserData()
  }, [user])

  useEffect(() => {
    if (user) {
      console.log('MyAccount - Setting active status to:', user.active)
      setActiveStatus(user.active || false)
    }
  }, [user])

  useEffect(() => {
    const storedRaw = localStorage.getItem('notificationSettings')
    let storedSettings = {}

    try {
      storedSettings = storedRaw ? JSON.parse(storedRaw) : {}
    } catch {
      storedSettings = {}
    }

    const profileSettings = user?.notificationPreferences || {}
    const hasProfilePrefs =
      profileSettings && (
        Object.prototype.hasOwnProperty.call(profileSettings, 'push') ||
        Object.prototype.hasOwnProperty.call(profileSettings, 'email')
      )
    const effectiveStoredSettings = hasProfilePrefs ? storedSettings : {}

    const mergedSettings = normalizeNotificationSettings({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...(hasProfilePrefs ? profileSettings : {}),
      ...effectiveStoredSettings
    })

    setNotificationSettings(mergedSettings)
    setNotificationSettingsStatus(null)
  }, [user])

  useEffect(() => {
    if (!user) {
      setOpkomstEvents([])
      setIsOpkomstenLoading(false)
      return
    }

    let isCancelled = false

    const loadOpkomstEvents = async () => {
      setIsOpkomstenLoading(true)
      setOpkomstenError(null)

      try {
        const response = await getEvents()
        const events = Array.isArray(response) ? response : response?.events || []

        const normalizedFirstName = normalizeValue(user.firstName || '')
        const normalizedLastName = normalizeValue(user.lastName || '')
        const normalizedFullName = normalizeValue([user.firstName, user.lastName].filter(Boolean).join(' '))

        const isUpcomingEvent = start => {
          const eventDate = safeParseDate(start)
          if (!eventDate) return false

          const today = new Date()
          const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
          const normalizedEventDate = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())
          return normalizedEventDate >= normalizedToday
        }

        const candidates = [normalizedFirstName, normalizedLastName, normalizedFullName].filter(Boolean)

        const matchesCurrentUser = opkomstmakers => {
          const makerNames = splitOpkomstmakerNames(opkomstmakers)
          if (makerNames.length === 0) return false
          const normalizedMakers = makerNames.map(name => normalizeValue(name))
          return normalizedMakers.some(name => candidates.includes(name))
        }

        const matchesCurrentUserAsSchoonmaker = schoonmakers => {
          const makerNames = splitSchoonmakerNames(schoonmakers)
          if (makerNames.length === 0) return false
          const normalizedMakers = makerNames.map(name => normalizeValue(name))
          return normalizedMakers.some(name => candidates.includes(name))
        }

        const upcomingOwnedOpkomsten = events
          .filter(event => event?.isOpkomst)
          .filter(event => matchesCurrentUser(event.opkomstmakers))
          .filter(event => isUpcomingEvent(event.start))

        const upcomingOwnedSchoonmaak = events
          .filter(event => event?.isSchoonmaak)
          .filter(event => matchesCurrentUserAsSchoonmaker(event.schoonmakers))
          .filter(event => isUpcomingEvent(event.start))

        const upcomingOwnedEvents = [...upcomingOwnedOpkomsten, ...upcomingOwnedSchoonmaak].sort(
          (a, b) => new Date(a.start) - new Date(b.start)
        )

        if (!isCancelled) {
          setOpkomstEvents(upcomingOwnedEvents)
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Error loading opkomst events:', err)
          setOpkomstenError(withSupportContact(err.message || 'Opkomsten konden niet geladen worden.'))
        }
      } finally {
        if (!isCancelled) {
          setIsOpkomstenLoading(false)
        }
      }
    }

    loadOpkomstEvents()

    return () => {
      isCancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!selectedOpkomst) {
      return
    }

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        setSelectedOpkomst(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedOpkomst])

  useEffect(() => {
    if (!selectedOpkomst) {
      return
    }

    const stillExists = opkomstEvents.some(event => event?.id === selectedOpkomst.id)
    if (!stillExists) {
      setSelectedOpkomst(null)
    }
  }, [opkomstEvents, selectedOpkomst])

  useEffect(() => {
    if (!user) {
      navigate('/login')
    }
  }, [user, navigate])

  if (!user) return null

  const { firstName, lastName, email, id } = user
  const streepjes = userWithStreepjes?.streepjes ?? 0
  const isStreepjesLoading = userWithStreepjes === null

  const closeOpkomstDetails = () => setSelectedOpkomst(null)

  const selectedOpkomstDateText = selectedOpkomst ? renderOpkomstDateDetails(selectedOpkomst) : ''
  const selectedOpkomstTimeRange = selectedOpkomst ? renderOpkomstTimeRange(selectedOpkomst) : null
  const selectedOpkomstMakers = selectedOpkomst
    ? selectedOpkomst.isOpkomst
      ? splitOpkomstmakerNames(selectedOpkomst.opkomstmakers)
      : selectedOpkomst.isSchoonmaak
      ? splitSchoonmakerNames(selectedOpkomst.schoonmakers)
      : []
    : []

  console.log('MyAccount - User data:', {
    id,
    firstName,
    lastName,
    email,
    activeStatus
  })

  const handlePasswordChange = async e => {
    e.preventDefault()

    setError(null)
    setMessage(null)

    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      setError('Alle velden zijn verplicht.')
      return
    }

    if (passwordData.newPassword.length < 6) {
      setError('Nieuw wachtwoord moet minimaal 6 karakters bevatten.')
      return
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('Nieuwe wachtwoorden komen niet overeen.')
      return
    }

    if (passwordData.currentPassword === passwordData.newPassword) {
      setError('Nieuw wachtwoord moet verschillen van het huidige wachtwoord.')
      return
    }

    setIsLoading(true)

    try {
      const data = await changePassword(user.email, passwordData.currentPassword, passwordData.newPassword)
      setMessage(data.msg || 'Wachtwoord succesvol gewijzigd!')
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setShowPasswordForm(false)
    } catch (err) {
      console.error('Change password error:', err)
      setError(withSupportContact(err.message || 'Er is een fout opgetreden bij het wijzigen van het wachtwoord.'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleAccountLogout = useCallback(() => {
    if (typeof onLogout === 'function') {
      onLogout()
    } else {
      localStorage.removeItem('user')
      navigate('/login')
    }
  }, [navigate, onLogout])

  const togglePasswordVisibility = field => {
    setShowPasswords(prev => ({
      ...prev,
      [field]: !prev[field]
    }))
  }

  const cancelPasswordChange = () => {
    setShowPasswordForm(false)
    setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setError(null)
    setMessage(null)
    setShowPasswords({ current: false, new: false, confirm: false })
  }

  const handleActiveStatusChange = async newActiveStatus => {
    const previousStatus = activeStatus
    const statusText = newActiveStatus ? 'actief' : 'inactief'
    const presenceText = newActiveStatus ? 'aanwezig' : 'afwezig'
    const confirmationMessage = `Weet je zeker dat je je status wilt wijzigen naar "${statusText}"?

Als je ${statusText} bent, word je automatisch voor nieuwe opkomst op ${presenceText} gezet.

Let op: voor de alle toekomstige opkomsten die al zijn gepland, word je ook als ${presenceText} gemarkeerd!`

    if (!window.confirm(confirmationMessage)) {
      setActiveStatus(previousStatus)
      return
    }

    console.log('MyAccount - handleActiveStatusChange called with:', newActiveStatus)
    console.log('MyAccount - User ID:', id)
    console.log('MyAccount - User ID type:', typeof id)

    if (!id) {
      console.error('MyAccount - No user ID found!')
      setError(withSupportContact('Gebruikers-ID niet gevonden. Log opnieuw in.'))
      return
    }

    setIsUpdatingActive(true)
    setError(null)
    setMessage(null)

    try {
      const profileData = {
        userId: id,
        active: newActiveStatus
      }
      console.log('MyAccount - Calling updateUserProfile with:', profileData)

      const response = await updateUserProfile(profileData)

      console.log('MyAccount - API response:', response)

      if (previousStatus !== newActiveStatus) {
        try {
          await Promise.all([invalidateEvents(), invalidateUsers()])
        } catch (cacheError) {
          console.warn('MyAccount - Kon cache niet ongeldig maken:', cacheError)
        }
      }

      setActiveStatus(newActiveStatus)

      const updatedUser = { ...user, active: newActiveStatus }
      localStorage.setItem('user', JSON.stringify(updatedUser))
      sessionStorage.setItem('user', JSON.stringify(updatedUser))

      const attendanceUpdates = Number.isFinite(response?.attendanceUpdates) ? response.attendanceUpdates : 0
      const attendanceMessage =
        attendanceUpdates > 0
          ? ` ${attendanceUpdates} toekomstige opkomsten zijn ${newActiveStatus ? 'als aanwezig' : 'als afwezig'} voor je ingesteld.`
          : ''

      setMessage(`Status succesvol bijgewerkt naar ${statusText}.${attendanceMessage}`)
    } catch (err) {
      console.error('MyAccount - Error updating active status:', err)
      setError(withSupportContact(err.message || 'Er is een fout opgetreden bij het bijwerken van je status.'))
      setActiveStatus(!newActiveStatus)
    } finally {
      setIsUpdatingActive(false)
    }
  }

  const persistNotificationPreferences = useCallback(
    async nextSettings => {
      const normalized = normalizeNotificationSettings(nextSettings)
      localStorage.setItem('notificationSettings', JSON.stringify(normalized))

      if (user?.id) {
        const response = await updateUserProfile({
          userId: user.id,
          notificationPreferences: normalized
        })

        const updatedUser = {
          ...(response?.user || user),
          notificationPreferences: normalized
        }
        localStorage.setItem('user', JSON.stringify(updatedUser))
        sessionStorage.setItem('user', JSON.stringify(updatedUser))
      }

      return normalized
    },
    [user]
  )

  const ensureServiceWorkerRegistration = useCallback(async () => {
    if (!navigator?.serviceWorker) {
      throw new Error('Service worker niet beschikbaar in deze browser.')
    }

    const existing = await navigator.serviceWorker.getRegistration()
    if (existing) {
      return existing.active ? existing : navigator.serviceWorker.ready
    }

    const devEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_PWA_DEV === 'true'
    if (import.meta.env.DEV && !devEnabled) {
      throw new Error('Pushmeldingen testen? Zet VITE_ENABLE_PWA_DEV=true en vernieuw de pagina.')
    }

    throw new Error('Service worker is nog niet actief. Vernieuw de pagina en probeer opnieuw.')
  }, [])

  const handlePushPreferenceChange = async checked => {
    const previousSettings = notificationSettings
    const nextSettings = normalizeNotificationSettings({ ...notificationSettings, push: checked })

    setNotificationSettings(nextSettings)
    setNotificationSettingsStatus(null)

    if (!user?.id) {
      setNotificationSettings(previousSettings)
      setNotificationSettingsStatus({
        type: 'error',
        message: 'Log opnieuw in om pushmeldingen te beheren.'
      })
      return
    }

    setIsSavingNotificationSettings(true)

    try {
      if (!checked) {
        let unsubscribeFailed = false

        if (pushSupported) {
          try {
            const registration = await navigator.serviceWorker.ready
            const existingSubscription = await registration.pushManager.getSubscription()

            if (existingSubscription) {
              await unsubscribePush(existingSubscription.endpoint)
              await existingSubscription.unsubscribe()
            }
          } catch (unsubscribeError) {
            console.warn('MyAccount - Unable to unsubscribe push:', unsubscribeError)
            unsubscribeFailed = true
          }
        }

        if (unsubscribeFailed) {
          const fallbackSettings = normalizeNotificationSettings(previousSettings)
          setNotificationSettings(fallbackSettings)
          localStorage.setItem('notificationSettings', JSON.stringify(fallbackSettings))
          setNotificationSettingsStatus({
            type: 'error',
            message: 'Pushmeldingen konden niet worden uitgeschakeld. Probeer het opnieuw.'
          })
          return
        }

        try {
          await persistNotificationPreferences(nextSettings)
          setNotificationSettingsStatus({ type: 'success', message: 'Pushmeldingen uitgeschakeld.' })
        } catch (persistError) {
          console.error('MyAccount - Failed to persist push preference:', persistError)
          setNotificationSettingsStatus({
            type: 'error',
            message: 'Pushmeldingen zijn uitgeschakeld, maar synchroniseren met de server lukte niet.'
          })
        }
        return
      }

      if (!pushSupported) {
        throw new Error('Deze browser ondersteunt geen pushmeldingen.')
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error('Je hebt geen toestemming gegeven voor pushmeldingen.')
      }

      const registration = await ensureServiceWorkerRegistration()
      const readyRegistration = registration.active ? registration : await navigator.serviceWorker.ready
      const { vapidPublicKey, publicKey } = await getPushPublicKey()
      const key = vapidPublicKey || publicKey

      if (!key) {
        throw new Error('Publieke sleutel ontbreekt voor pushmeldingen.')
      }

      const existingSubscription = await readyRegistration.pushManager.getSubscription()
      if (existingSubscription) {
        await unsubscribePush(existingSubscription.endpoint)
        await existingSubscription.unsubscribe()
      }

      const subscription = await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      })

      await subscribePush(user.id, subscription.toJSON())

      try {
        await persistNotificationPreferences(nextSettings)
        setNotificationSettingsStatus({ type: 'success', message: 'Pushmeldingen zijn ingeschakeld.' })
      } catch (persistError) {
        console.error('MyAccount - Failed to persist push preference:', persistError)
        setNotificationSettingsStatus({
          type: 'error',
          message: 'Pushmeldingen staan aan, maar synchroniseren met de server lukte niet.'
        })
      }
    } catch (err) {
      console.error('MyAccount - Push preference change failed:', err)
      const fallbackSettings = checked
        ? normalizeNotificationSettings({ ...previousSettings, push: false })
        : normalizeNotificationSettings(previousSettings)
      setNotificationSettings(fallbackSettings)
      try {
        await persistNotificationPreferences(fallbackSettings)
      } catch (persistError) {
        console.error('MyAccount - Failed to persist fallback push preference:', persistError)
      }
      setNotificationSettingsStatus({
        type: 'error',
        message: err?.message || 'Pushmeldingen bijwerken mislukt.'
      })
    } finally {
      setIsSavingNotificationSettings(false)
    }
  }

  const handleEmailPreferenceChange = async checked => {
    const previousSettings = notificationSettings
    const nextSettings = normalizeNotificationSettings({ ...notificationSettings, email: checked })

    setNotificationSettings(nextSettings)
    setNotificationSettingsStatus(null)
    setIsSavingNotificationSettings(true)

    try {
      await persistNotificationPreferences(nextSettings)
      setNotificationSettingsStatus({ type: 'success', message: 'E-mailinstellingen bijgewerkt.' })
    } catch (err) {
      console.error('MyAccount - Email preference change failed:', err)
      setNotificationSettings(previousSettings)
      setNotificationSettingsStatus({
        type: 'error',
        message: err?.message || 'Bijwerken van e-mailinstelling mislukt.'
      })
    } finally {
      setIsSavingNotificationSettings(false)
    }
  }

  return (
    <>
      <div className="account-page-wrapper">
        <div className="account-page-container">
          <div className="account-header">
            <h1 className="account-title">Account</h1>
          </div>

          <div className="account-content-grid">
            <div className="account-card account-card-personal">
              <div className="account-card-header">
                <h4>Persoonlijke gegevens</h4>
              </div>
              <div className="account-card-body">
                <div className="info-grid">
                  <div className="info-item">
                    <label>Naam</label>
                    <span>
                      {firstName} {lastName}
                    </span>
                  </div>
                  <div className="info-item">
                    <label>E-mailadres</label>
                    <span>{email}</span>
                  </div>
                  <div className="info-item">
                    <label>Account type</label>
                    <span
                      className={`account-pill ${
                        user.isAdmin ? 'account-pill-admin' : 'account-pill-user'
                      }`}
                    >
                      {user.isAdmin ? 'Administrator' : 'Gebruiker'}
                    </span>
                  </div>
                  <div className="info-item">
                    <label>Streepjes</label>
                    {isStreepjesLoading ? (
                      <span className="streepjes-loading">Laden...</span>
                    ) : (
                      <span className={`streepjes-count ${streepjes > 0 ? 'has-streepjes' : ''}`}>
                        {streepjes}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="account-card account-card-opkomsten">
              <div className="account-card-header">
                <h4>Mijn evenementen</h4>
              </div>
              <div className="account-card-body">
                <div className="opkomst-list">
                  {isOpkomstenLoading ? (
                    <p className="opkomst-list__status">Evenementen laden...</p>
                  ) : opkomstenError ? (
                    <p className="opkomst-list__status opkomst-list__status--error">
                      {opkomstenError}
                    </p>
                  ) : opkomstEvents.length === 0 ? (
                    <p className="opkomst-list__status">
                      Je bent momenteel geen opkomstmaker of schoonmaker van een aankomend evenement.
                    </p>
                  ) : (
                    <ul className="opkomst-list__items">
                      {opkomstEvents.map(event => {
                        const isOpkomst = event?.isOpkomst
                        const isSchoonmaak = event?.isSchoonmaak
                        const makerNames = isOpkomst
                          ? splitOpkomstmakerNames(event.opkomstmakers)
                          : isSchoonmaak
                          ? splitSchoonmakerNames(event.schoonmakers)
                          : []

                        return (
                          <li key={event.id}>
                            <button
                              type="button"
                              className="opkomst-list__item"
                              onClick={() => setSelectedOpkomst(event)}
                              aria-label={`Bekijk details voor ${
                                event.title || 'dit evenement'
                              }`}
                            >
                              <div className="opkomst-list__header">
                                <span className="opkomst-list__title">
                                  {event.title || 'Evenement zonder titel'}
                                </span>
                              </div>
                              <div className="opkomst-list__meta">
                                <span className="opkomst-list__meta-value">
                                  {formatOpkomstDate(event.start, event.end, event.allDay)}
                                </span>
                              </div>
                              {makerNames.length > 0 && (
                                <div className="opkomst-list__makers">
                                  <div className="opkomst-list__makers-badges">
                                    {makerNames.map((maker, index) => (
                                      <span
                                        key={`${event.id}-maker-${index}`}
                                        className="opkomst-list__maker-pill"
                                      >
                                        {maker}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="account-card account-card-settings">
              <div className="account-card-header">
                <h4>Instellingen</h4>
              </div>
              <div className="account-card-body">
                <div className="setting-section setting-section-activity">
                  <div className="setting-item">
                    <div className="setting-label">
                      <h6>Activiteit</h6>
                      <p>
                        {activeStatus
                          ? 'Je bent automatisch aangemeld voor nieuwe opkomsten.'
                          : 'Je bent automatisch afgemeld voor nieuwe opkomsten.'}
                      </p>
                    </div>
                    <div className="toggle-container">
                      <ToggleSwitch
                        isToggled={activeStatus}
                        onToggle={event => handleActiveStatusChange(event.target.checked)}
                        disabled={isUpdatingActive}
                        variant="notification"
                      />
                      <span className="toggle-label-text">
                        {activeStatus ? 'Actief' : 'Inactief'}
                        {isUpdatingActive && <small> (bezig...)</small>}
                      </span>
                    </div>
                  </div>

                  {message?.startsWith('Status succesvol bijgewerkt') && (
                    <div className="setting-success">{message}</div>
                  )}
                  {error && <div className="setting-error">{error}</div>}
                </div>

                <div className="setting-section setting-section-notifications">
                  <div className="setting-section__header">
                    <h6>Meldingen</h6>
                  </div>

                  <div className="notification-toggle-list">
                    <div className="notification-toggle">
                      <div className="notification-toggle__label">
                        <span>Pushmeldingen</span>
                      </div>
                      <ToggleSwitch
                        isToggled={notificationSettings.push}
                        onToggle={event => handlePushPreferenceChange(event.target.checked)}
                        disabled={isSavingNotificationSettings}
                        variant="notification"
                      />
                    </div>

                    <div className="notification-toggle">
                      <div className="notification-toggle__label">
                        <span>E-mail updates</span>
                      </div>
                      <ToggleSwitch
                        isToggled={notificationSettings.email}
                        onToggle={event => handleEmailPreferenceChange(event.target.checked)}
                        disabled={isSavingNotificationSettings}
                        variant="notification"
                      />
                    </div>
                  </div>
                </div>

                <div className="setting-section">
                  <CalendarSubscription user={user} />
                </div>

                <div className="setting-section">
                  {!showPasswordForm ? (
                    <div className="setting-item-vertical">
                      <div className="setting-label">
                        <h6>Wachtwoord</h6>
                      </div>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setShowPasswordForm(true)}
                      >
                        Wachtwoord wijzigen
                      </button>
                    </div>
                  ) : (
                    <form className="password-form" onSubmit={handlePasswordChange}>
                      <h4>Nieuw wachtwoord instellen</h4>
                      <div className="form-group">
                        <label className="form-label" htmlFor="current-password">
                          Huidig wachtwoord
                        </label>
                        <div className="password-field">
                          <input
                            id="current-password"
                            type={showPasswords.current ? 'text' : 'password'}
                            value={passwordData.currentPassword}
                            onChange={e =>
                              setPasswordData(prev => ({
                                ...prev,
                                currentPassword: e.target.value
                              }))
                            }
                            className="form-input"
                            required
                            disabled={isLoading}
                          />
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility('current')}
                            className="password-toggle"
                          >
                            {showPasswords.current ? 'Verberg' : 'Toon'}
                          </button>
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="new-password">
                          Nieuw wachtwoord
                        </label>
                        <div className="password-field">
                          <input
                            id="new-password"
                            type={showPasswords.new ? 'text' : 'password'}
                            value={passwordData.newPassword}
                            onChange={e =>
                              setPasswordData(prev => ({
                                ...prev,
                                newPassword: e.target.value
                              }))
                            }
                            className="form-input"
                            required
                            disabled={isLoading}
                          />
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility('new')}
                            className="password-toggle"
                          >
                            {showPasswords.new ? 'Verberg' : 'Toon'}
                          </button>
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="confirm-password">
                          Bevestig wachtwoord
                        </label>
                        <div className="password-field">
                          <input
                            id="confirm-password"
                            type={showPasswords.confirm ? 'text' : 'password'}
                            value={passwordData.confirmPassword}
                            onChange={e =>
                              setPasswordData(prev => ({
                                ...prev,
                                confirmPassword: e.target.value
                              }))
                            }
                            className="form-input"
                            required
                            disabled={isLoading}
                          />
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility('confirm')}
                            className="password-toggle"
                          >
                            {showPasswords.confirm ? 'Verberg' : 'Toon'}
                          </button>
                        </div>
                      </div>
                      <div className="password-form-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={cancelPasswordChange}
                          disabled={isLoading}
                        >
                          Annuleren
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={isLoading}>
                          {isLoading ? 'Bezig...' : 'Opslaan'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </div>

          </div>
          <div className="account-footer">
            <button
              className="btn btn-danger"
              onClick={handleAccountLogout}
              disabled={isLoading}
            >
              Uitloggen
            </button>
          </div>
        </div>
      </div>
      {selectedOpkomst && (
        <div className="modal-overlay" role="presentation" onClick={closeOpkomstDetails}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="close-btn"
              onClick={closeOpkomstDetails}
              aria-label="Opkomstdetails sluiten"
            >
              x
            </button>
            <div className="modal-header">
              <h2 className="modal-title">
                {selectedOpkomst.title || 'Opkomst zonder titel'}
              </h2>
            </div>
            <div className="modal-body">
              <div className="event-details">
                <div className="detail-item">
                  <div className="detail-content">
                    <strong>Datum</strong>
                    <span className="description-text">{selectedOpkomstDateText}</span>
                  </div>
                </div>
                {selectedOpkomstTimeRange && (
                  <div className="detail-item">
                    <div className="detail-content">
                      <strong>Tijd</strong>
                      <span>{selectedOpkomstTimeRange}</span>
                    </div>
                  </div>
                )}
                {selectedOpkomst.location && (
                  <div className="detail-item">
                    <div className="detail-content">
                      <strong>Locatie</strong>
                      <LocationLink location={selectedOpkomst.location} />
                    </div>
                  </div>
                )}
                {selectedOpkomstMakers.length > 0 && (
                  <div className="detail-item">
                    <div className="detail-content">
                      <strong>
                        {selectedOpkomst.isOpkomst ? 'Opkomstmakers' : 'Schoonmakers'}
                      </strong>
                      <span className="description-text">
                        {selectedOpkomstMakers.join('\n')}
                      </span>
                    </div>
                  </div>
                )}
                {selectedOpkomst.isSchoonmaak &&
                  selectedOpkomst.schoonmaakOptions &&
                  selectedOpkomst.schoonmaakOptions.length > 0 && (
                    <div className="detail-item">
                      <div className="detail-content">
                        <strong>Schoonmaak opties</strong>
                        <span className="description-text">
                          {selectedOpkomst.schoonmaakOptions.join(', ')}
                        </span>
                      </div>
                    </div>
                  )}
                {selectedOpkomst.description && (
                  <div className="detail-item">
                    <div className="detail-content">
                      <strong>Beschrijving</strong>
                      <span className="description-text">
                        {selectedOpkomst.description}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeOpkomstDetails}
              >
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

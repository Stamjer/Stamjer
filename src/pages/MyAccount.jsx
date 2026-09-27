import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Eye, EyeOff, UserPlus, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { withSupportContact } from '../config/appInfo'
import {
  changePassword,
  createUser,
  updateUserStatus
} from '../services/api'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryClient'
import { useRawEvents, useUpdateUserProfile, useUsersWithStreepjes } from '../hooks/useQueries'
import CalendarSubscription from '../components/CalendarSubscription'
import LocationLink from '../components/LocationLink'
import ToggleSwitch from '../components/ToggleSwitch'
import './MyAccount.css'
import './Auth.css'

const USER_STATUS_LABELS = {
  active: 'Actief',
  inactive: 'Inactief',
  legacy: 'Alumni'
}

const ADMIN_STATUS_FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'active', label: 'Actief' },
  { value: 'inactive', label: 'Inactief' },
  { value: 'legacy', label: 'Alumni' }
]

function getEffectiveUserStatus(user) {
  return user?.status || 'active'
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
  const queryClient = useQueryClient()
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
  const [userStatus, setUserStatus] = useState(userProp?.status || 'active')
  const [allUsers, setAllUsers] = useState([])
  const [isChangingStatus, setIsChangingStatus] = useState(false)
  const [adminStatusError, setAdminStatusError] = useState(null)
  const [adminStatusMessage, setAdminStatusMessage] = useState(null)
  const [adminUserQuery, setAdminUserQuery] = useState('')
  const [adminStatusFilter, setAdminStatusFilter] = useState('all')
  const [showAddUser, setShowAddUser] = useState(false)
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [addUserError, setAddUserError] = useState(null)
  const [newUserData, setNewUserData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    isAdmin: false
  })
  const [selectedOpkomst, setSelectedOpkomst] = useState(null)
  const user = useMemo(() => {
    if (userProp) {
      return userProp
    }

    try {
      const raw = localStorage.getItem('user')
      return raw ? JSON.parse(raw) : null
    } catch {
      localStorage.removeItem('user')
      return null
    }
  }, [userProp])
  const { data: queriedUsers = [], isLoading: usersLoading } = useUsersWithStreepjes({ enabled: Boolean(user) })
  const {
    data: queriedEvents = [],
    isLoading: isOpkomstenLoading,
    error: opkomstenQueryError
  } = useRawEvents({ enabled: Boolean(user) })
  const updateProfileMutation = useUpdateUserProfile()
  const userWithStreepjes = queriedUsers.find(candidate => candidate.id === user?.id) || null
  const opkomstenError = opkomstenQueryError
    ? withSupportContact(opkomstenQueryError.message || 'Opkomsten konden niet geladen worden.')
    : null

  useEffect(() => {
    if (!userWithStreepjes) return
    setUserStatus(userWithStreepjes.status)
    setActiveStatus(userWithStreepjes.status === 'active')
    if (user?.isAdmin) setAllUsers(queriedUsers)
    localStorage.setItem('user', JSON.stringify({ ...user, ...userWithStreepjes }))
  }, [queriedUsers, user, userWithStreepjes])

  const opkomstEvents = useMemo(() => {
    if (!user?.id) return []
    const today = new Date()
    const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    return queriedEvents
      .filter(event => {
        const eventDate = safeParseDate(event.start)
        if (!eventDate) return false
        const normalizedEventDate = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())
        if (normalizedEventDate < normalizedToday) return false
        return (event.isOpkomst && event.opkomstmakerIds?.includes(user.id)) ||
          (event.isSchoonmaak && event.schoonmakerIds?.includes(user.id))
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start))
  }, [queriedEvents, user?.id])

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

  const { firstName, lastName, email, id } = user || {}
  const streepjes = userWithStreepjes?.streepjes ?? 0
  const isStreepjesLoading = usersLoading

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

  const adminUserSummary = useMemo(() => {
    return allUsers.reduce(
      (summary, adminUser) => {
        const effectiveStatus = getEffectiveUserStatus(adminUser)
        summary.all += 1
        summary[effectiveStatus] += 1
        return summary
      },
      { all: 0, active: 0, inactive: 0, legacy: 0 }
    )
  }, [allUsers])

  const visibleAdminUsers = useMemo(() => {
    const query = normalizeValue(adminUserQuery)

    return [...allUsers]
      .filter(adminUser => {
        const effectiveStatus = getEffectiveUserStatus(adminUser)
        if (adminStatusFilter !== 'all' && effectiveStatus !== adminStatusFilter) return false

        if (!query) return true
        const haystack = normalizeValue(
          [
            adminUser.firstName,
            adminUser.lastName,
            USER_STATUS_LABELS[effectiveStatus]
          ].filter(Boolean).join(' ')
        )
        return haystack.includes(query)
      })
      .sort((a, b) => {
        const statusOrder = { active: 0, inactive: 1, legacy: 2 }
        const statusDiff = statusOrder[getEffectiveUserStatus(a)] - statusOrder[getEffectiveUserStatus(b)]
        if (statusDiff !== 0) return statusDiff
        return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'nl-NL')
      })
  }, [allUsers, adminStatusFilter, adminUserQuery])

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

    if (!id) {
      setError(withSupportContact('Gebruikers-ID niet gevonden. Log opnieuw in.'))
      return
    }

    setIsUpdatingActive(true)
    setError(null)
    setMessage(null)

    try {
      const nextStatus = newActiveStatus ? 'active' : 'inactive'
      const response = await updateProfileMutation.mutateAsync({ status: nextStatus })

      setActiveStatus(newActiveStatus)
      setUserStatus(nextStatus)

      const updatedUser = { ...user, status: nextStatus }
      localStorage.setItem('user', JSON.stringify(updatedUser))

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

  const handleAdminStatusChange = useCallback(async (targetUserId, newStatus) => {
    const targetUser = allUsers.find(u => u.id === targetUserId)
    if (!targetUser) return

    const newLabel = USER_STATUS_LABELS[newStatus] || newStatus
    const currentStatus = getEffectiveUserStatus(targetUser)
    if (currentStatus === newStatus) return

    const currentLabel = USER_STATUS_LABELS[currentStatus] || currentStatus
    const confirmMsg = `Weet je zeker dat je de status van ${targetUser.firstName} ${targetUser.lastName} wilt wijzigen van "${currentLabel}" naar "${newLabel}"?`
    if (!window.confirm(confirmMsg)) return

    setIsChangingStatus(true)
    setAdminStatusError(null)
    setAdminStatusMessage(null)

    try {
      await updateUserStatus(targetUserId, newStatus)
      setAllUsers(prev => prev.map(u => u.id === targetUserId ? { ...u, status: newStatus } : u))
      if (targetUserId === id) {
        setUserStatus(newStatus)
        setActiveStatus(newStatus === 'active')
        localStorage.setItem('user', JSON.stringify({ ...user, status: newStatus }))
      }
      setAdminStatusMessage(`Status van ${targetUser.firstName} ${targetUser.lastName} bijgewerkt naar ${newLabel}.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      ])
    } catch (err) {
      setAdminStatusError(withSupportContact(err.message || 'Status bijwerken mislukt'))
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
    } finally {
      setIsChangingStatus(false)
    }
  }, [allUsers, id, queryClient, user])

  const closeAddUser = useCallback(() => {
    if (isCreatingUser) return
    setShowAddUser(false)
    setAddUserError(null)
    setNewUserData({ firstName: '', lastName: '', email: '', isAdmin: false })
  }, [isCreatingUser])

  const handleCreateUser = async event => {
    event.preventDefault()
    setIsCreatingUser(true)
    setAddUserError(null)
    setAdminStatusMessage(null)

    try {
      const response = await createUser(newUserData)
      if (response?.user) {
        setAllUsers(previousUsers => [...previousUsers, response.user])
      }
      setAdminStatusMessage(`${newUserData.firstName} ${newUserData.lastName} is toegevoegd.`)
      setShowAddUser(false)
      setNewUserData({ firstName: '', lastName: '', email: '', isAdmin: false })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      ])
    } catch (err) {
      setAddUserError(withSupportContact(err.message || 'Gebruiker toevoegen mislukt'))
    } finally {
      setIsCreatingUser(false)
    }
  }

  if (!user) return null

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
                    <label>Status</label>
                    <span className={`account-pill account-pill-${userStatus}`}>
                      {USER_STATUS_LABELS[userStatus]}
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
                      Je staat momenteel niet ingeroosterd als opkomstmaker of schoonmaker.
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
                  {userStatus !== 'legacy' ? (
                    <>
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
                            variant="activity"
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
                    </>
                  ) : (
                    <div className="setting-item-vertical">
                      <div className="setting-label">
                        <h6>Account status</h6>
                        <p>
                          {userStatus === 'inactive'
                            ? 'Je account is momenteel inactief. Je wordt niet automatisch aangemeld voor opkomsten. Neem contact op met een beheerder als dit niet klopt.'
                            : user.isAdmin
                            ? 'Je account is Alumni. Je wordt niet meegenomen in deelnemerslijsten, maar behoudt als admin toegang tot beheer en alle sitefuncties.'
                            : 'Je account is Alumni. Je hebt toegang tot declaraties en je account, maar niet tot kalender, opkomsten of strepen.'}
                        </p>
                      </div>
                    </div>
                  )}
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
                            {showPasswords.current ? <EyeOff size={18} /> : <Eye size={18} />}
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
                           {showPasswords.new ? <EyeOff size={18} /> : <Eye size={18} />}
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
                            {showPasswords.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
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

          {user.isAdmin && (
            <div className="account-card account-card-admin-users">
              <div className="account-card-header">
                <h4>Gebruikersbeheer</h4>
                <button
                  type="button"
                  className="btn btn-primary admin-add-user-button"
                  onClick={() => setShowAddUser(true)}
                >
                  <UserPlus size={17} aria-hidden="true" />
                  Gebruiker toevoegen
                </button>
              </div>
              <div className="account-card-body">
                <div className="admin-users-toolbar">
                  <div className="admin-users-search">
                    <label className="sr-only" htmlFor="admin-user-search">
                      Zoek gebruiker
                    </label>
                    <input
                      id="admin-user-search"
                      type="search"
                      value={adminUserQuery}
                      onChange={event => setAdminUserQuery(event.target.value)}
                      placeholder="Zoek gebruiker..."
                      className="admin-users-search-input"
                    />
                  </div>
                  <div className="admin-status-tabs" role="group" aria-label="Filter gebruikers op status">
                    {ADMIN_STATUS_FILTERS.map(filter => (
                      <button
                        key={filter.value}
                        type="button"
                        className={`admin-status-tab${adminStatusFilter === filter.value ? ' is-active' : ''}`}
                        onClick={() => setAdminStatusFilter(filter.value)}
                      >
                        <span>{filter.label}</span>
                        <strong>{adminUserSummary[filter.value]}</strong>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="admin-users-list">
                  {allUsers.length === 0 ? (
                    <p className="admin-users-loading">Gebruikers laden...</p>
                  ) : visibleAdminUsers.length === 0 ? (
                    <p className="admin-users-loading">Geen gebruikers gevonden.</p>
                  ) : (
                    visibleAdminUsers
                      .map(u => {
                        const effectiveStatus = getEffectiveUserStatus(u)
                        return (
                        <div key={u.id} className="admin-user-row">
                          <div className="admin-user-info">
                            <div className="admin-user-name-line">
                              <span className="admin-user-name">{u.firstName} {u.lastName}</span>
                            </div>
                          </div>
                          <select
                            className="admin-status-select"
                            value={effectiveStatus}
                            onChange={e => handleAdminStatusChange(u.id, e.target.value)}
                            disabled={isChangingStatus}
                            aria-label={`Status van ${u.firstName} ${u.lastName}`}
                          >
                            <option value="active">Actief</option>
                            <option value="inactive">Inactief</option>
                            <option value="legacy">Alumni</option>
                          </select>
                        </div>
                        )
                      })
                  )}
                </div>
                {adminStatusError && <div className="setting-error" style={{ marginTop: '1rem' }}>{adminStatusError}</div>}
                {adminStatusMessage && <div className="setting-success" style={{ marginTop: '1rem' }}>{adminStatusMessage}</div>}
              </div>
            </div>
          )}

        </div>
      </div>
      {showAddUser && (
        <div className="modal-overlay" role="presentation" onClick={closeAddUser}>
          <div
            className="modal-content add-user-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-user-title"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="close-btn"
              onClick={closeAddUser}
              disabled={isCreatingUser}
              aria-label="Venster sluiten"
            >
              <X size={20} aria-hidden="true" />
            </button>
            <div className="modal-header">
              <h2 id="add-user-title" className="modal-title">Gebruiker toevoegen</h2>
            </div>
            <form className="add-user-form" onSubmit={handleCreateUser}>
              <div className="form-group">
                <label htmlFor="new-user-first-name">Voornaam</label>
                <input
                  id="new-user-first-name"
                  type="text"
                  value={newUserData.firstName}
                  onChange={event => setNewUserData(current => ({ ...current, firstName: event.target.value }))}
                  autoComplete="off"
                  maxLength={80}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-user-last-name">Achternaam</label>
                <input
                  id="new-user-last-name"
                  type="text"
                  value={newUserData.lastName}
                  onChange={event => setNewUserData(current => ({ ...current, lastName: event.target.value }))}
                  autoComplete="off"
                  maxLength={120}
                  required
                />
              </div>
              <div className="form-group add-user-form__full-width">
                <label htmlFor="new-user-email">E-mailadres</label>
                <input
                  id="new-user-email"
                  type="email"
                  value={newUserData.email}
                  onChange={event => setNewUserData(current => ({ ...current, email: event.target.value }))}
                  autoComplete="off"
                  maxLength={254}
                  required
                />
              </div>
              <label className="add-user-admin-option add-user-form__full-width">
                <input
                  type="checkbox"
                  checked={newUserData.isAdmin}
                  onChange={event => setNewUserData(current => ({ ...current, isAdmin: event.target.checked }))}
                />
                <span>Administrator</span>
              </label>
              {addUserError && <div className="setting-error add-user-form__full-width">{addUserError}</div>}
              <div className="add-user-actions add-user-form__full-width">
                <button type="button" className="btn btn-secondary" onClick={closeAddUser} disabled={isCreatingUser}>
                  Annuleren
                </button>
                <button type="submit" className="btn btn-primary" disabled={isCreatingUser}>
                  <UserPlus size={17} aria-hidden="true" />
                  {isCreatingUser ? 'Toevoegen...' : 'Toevoegen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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

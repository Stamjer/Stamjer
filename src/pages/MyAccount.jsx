import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { withSupportContact } from '../config/appInfo'
import { changePassword, updateUserProfile } from '../services/api'
import './MyAccount.css'
import './Auth.css'

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
  
  // Resolve user from props first, then storage
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
  
  // Load user data with calculated streepjes
  React.useEffect(() => {
    const loadUserData = async () => {
      if (user) {
        try {
          const response = await fetch('/api/users/full')
          if (response.ok) {
            const data = await response.json()
            const currentUser = data.users.find(u => u.id === user.id)
            if (currentUser) {
              setUserWithStreepjes(currentUser)
            }
          }
        } catch (error) {
          console.error('Error loading user data:', error)
        }
      }
    }
    loadUserData()
  }, [user])
  
  // Initialize active status from user data
  React.useEffect(() => {
    if (user) {
      console.log('MyAccount - Setting active status to:', user.active)
      setActiveStatus(user.active || false)
    }
  }, [user])
  
  React.useEffect(() => {
    if (!user) {
      navigate('/login')
    }
  }, [user, navigate])
  if (!user) return null

  const { firstName, lastName, email, active = false, id } = user
  const streepjes = userWithStreepjes?.streepjes ?? 0
  const isStreepjesLoading = userWithStreepjes === null
  
  // Debug logging
  console.log('MyAccount - User data:', { id, firstName, lastName, email, active })

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    
    setError(null)
    setMessage(null)
    
    // Validatie
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
      // Use the API service function
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

  const handleAccountLogout = React.useCallback(() => {
    if (typeof onLogout === 'function') {
      onLogout()
    } else {
      localStorage.removeItem('user')
      navigate('/login')
    }
  }, [navigate, onLogout])

  const togglePasswordVisibility = (field) => {
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

  const handleActiveStatusChange = async (newActiveStatus) => {
    const statusText = newActiveStatus ? 'actief' : 'inactief';
    const confirmationMessage = `Weet je zeker dat je je status wilt wijzigen naar "${statusText}"?

Als je ${statusText} bent, word je automatisch ${newActiveStatus ? 'aangemeld voor' : 'afgemeld van'} alle toekomstige opkomsten.`;

    if (!window.confirm(confirmationMessage)) {
      return; // User cancelled the action
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
      
      // Update via API
      const response = await updateUserProfile(profileData)

      console.log('MyAccount - API response:', response)

      // Update local state
      setActiveStatus(newActiveStatus)
      
      // Update user data in localStorage
      const updatedUser = { ...user, active: newActiveStatus }
      localStorage.setItem('user', JSON.stringify(updatedUser))
      
      // Show success message - includes notification about email being sent
      setMessage(`Status succesvol bijgewerkt naar ${statusText}.`)
    } catch (err) {
      console.error('MyAccount - Error updating active status:', err)
      setError(withSupportContact(err.message || 'Er is een fout opgetreden bij het bijwerken van je status.'))
      // Revert the checkbox state on error
      setActiveStatus(!newActiveStatus)
    } finally {
      setIsUpdatingActive(false)
    }
  }

  return (
    <div className="account-page-wrapper">
      <div className="account-page-container">
        <div className="account-header">
          <h1 className="account-title">Account</h1>
        </div>

        <div className="account-content-grid">
          {/* Left Column: User Info */}
          <div className="account-card">
            <div className="account-card-header">
              <h4>Persoonlijke gegevens</h4>
            </div>
            <div className="account-card-body">
              <div className="info-grid">
                <div className="info-item">
                  <label>Naam</label>
                  <span>{firstName} {lastName}</span>
                </div>
                <div className="info-item">
                  <label>E-mailadres</label>
                  <span>{email}</span>
                </div>
                <div className="info-item">
                  <label>Account type</label>
                  <span className={`account-pill ${user.isAdmin ? 'account-pill-admin' : 'account-pill-user'}`}>
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

          {/* Right Column: Settings & Actions */}
          <div className="account-card">
            <div className="account-card-header">
              <h4>Instellingen</h4>
            </div>
            <div className="account-card-body">
              {/* Active Status Toggle */}
              <div className="setting-item">
                <div className="setting-label">
                  <h6>Activiteit</h6>
                  <p>{activeStatus ? 'Je bent automatisch aangemeld voor nieuwe opkomsten.' : 'Je bent automatisch afgemeld voor nieuwe opkomsten.'}</p>
                </div>
                <div className="toggle-container">
                  <input
                    id="active-toggle"
                    type="checkbox"
                    checked={activeStatus}
                    onChange={e => handleActiveStatusChange(e.target.checked)}
                    disabled={isUpdatingActive}
                    className="toggle-input"
                  />
                  <label htmlFor="active-toggle" className="toggle-switch">
                    <span className="switch-ball" />
                  </label>
                  <span className="toggle-label-text">
                    {activeStatus ? 'Actief' : 'Inactief'}
                    {isUpdatingActive && <small> (bezig...)</small>}
                  </span>
                </div>
              </div>

              {message?.startsWith('Status succesvol bijgewerkt') && (
                <div className="setting-success">
                  {message}
                </div>
              )}
              {error && <div className="setting-error">{error}</div>}

              <hr className="setting-divider" />

              {/* Password Change Section */}
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
                    <label className="form-label" htmlFor="current-password">Huidig wachtwoord</label>
                    <div className="password-field">
                      <input id="current-password" type={showPasswords.current ? "text" : "password"} value={passwordData.currentPassword} onChange={e => setPasswordData(prev => ({ ...prev, currentPassword: e.target.value }))} className="form-input" required disabled={isLoading} />
                      <button type="button" onClick={() => togglePasswordVisibility('current')} className="password-toggle">{showPasswords.current ? 'Verberg' : 'Toon'}</button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="new-password">Nieuw wachtwoord</label>
                    <div className="password-field">
                      <input id="new-password" type={showPasswords.new ? "text" : "password"} value={passwordData.newPassword} onChange={e => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))} className="form-input" required disabled={isLoading} />
                      <button type="button" onClick={() => togglePasswordVisibility('new')} className="password-toggle">{showPasswords.new ? 'Verberg' : 'Toon'}</button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="confirm-password">Bevestig wachtwoord</label>
                    <div className="password-field">
                      <input id="confirm-password" type={showPasswords.confirm ? "text" : "password"} value={passwordData.confirmPassword} onChange={e => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))} className="form-input" required disabled={isLoading} />
                      <button type="button" onClick={() => togglePasswordVisibility('confirm')} className="password-toggle">{showPasswords.confirm ? 'Verberg' : 'Toon'}</button>
                    </div>
                  </div>
                  <div className="password-form-actions">
                    <button type="button" className="btn btn-secondary" onClick={cancelPasswordChange} disabled={isLoading}>Annuleren</button>
                    <button type="submit" className="btn btn-primary" disabled={isLoading}>
                      {isLoading ? 'Bezig...' : 'Opslaan'}
                    </button>
                  </div>
                </form>
              )}
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
  )
}






import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { withSupportContact } from '../config/appInfo'
import { changePassword, updateUserProfile } from '../services/api'
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
      const statusText = newActiveStatus ? 'actief' : 'inactief'
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
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img 
            src="/stam_H.png" 
            alt="Stamjer Logo" 
            className="auth-logo"
          />
          <h2 className="auth-title">Mijn Account</h2>
        </div>
        
        <div className="auth-body">
          {/* Error Messages */}
          {error && (
            <div className="auth-error">
              {error}
            </div>
          )}
          
          {!showPasswordForm ? (
            <>             
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">
                  Naam
                </label>
                <div style={{ 
                  padding: '0.75rem', 
                  background: 'var(--secondary-50)', 
                  border: '1px solid var(--secondary-200)', 
                  borderRadius: 'var(--radius-md)', 
                  color: 'var(--secondary-800)', 
                  fontWeight: '500' 
                }}>
                  {firstName} {lastName}
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">
                  Account type
                </label>
                <div style={{ 
                  padding: '0.75rem', 
                  background: 'var(--secondary-50)', 
                  border: '1px solid var(--secondary-200)', 
                  borderRadius: 'var(--radius-md)', 
                  color: 'var(--secondary-800)', 
                  fontWeight: '500' 
                }}>
                  {user.isAdmin ? 'Administrator' : 'Gebruiker'}
                </div>
              </div>
              
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">
                  E-mailadres
                </label>
                <div style={{ 
                  padding: '0.75rem', 
                  background: 'var(--secondary-50)', 
                  border: '1px solid var(--secondary-200)', 
                  borderRadius: 'var(--radius-md)', 
                  color: 'var(--secondary-800)', 
                  fontWeight: '500' 
                }}>
                  {email}
                </div>
              </div>
              
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">
                  Streepjes
                </label>
                <div style={{ 
                  padding: '0.75rem', 
                  background: 'var(--secondary-50)', 
                  border: '1px solid var(--secondary-200)', 
                  borderRadius: 'var(--radius-md)', 
                  color: (isStreepjesLoading ? 'var(--secondary-600)' : (streepjes > 0 ? 'var(--accent-red-800)' : 'var(--secondary-800)')),
                  fontWeight: '500' 
                }}>
                  {isStreepjesLoading ? 'Streepjes worden geteld...' : streepjes}
                </div>
              </div>

              <label className="form-label">Activiteit</label>
              <div className="form-group toggle-section">

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
                  <span className="toggle-label">{activeStatus ? 'Actief' : 'Inactief'}{isUpdatingActive && <small> (wordt bijgewerkt...)</small>}</span>
                </div>

                <div className="toggle-desc">{activeStatus ? 'Je bent automatisch aangemeld voor nieuwe opkomsten' : 'Je bent automatisch afgemeld voor nieuwe opkomsten'}</div>

                {message?.startsWith('Status succesvol bijgewerkt') && (
                  <div className="toggle-success">
                    {message}
                  </div>
                )}
              </div>
              <p><br></br></p>
              <div className="form-group">
                <button 
                  className="btn-secondary" 
                  onClick={() => setShowPasswordForm(true)}
                  style={{ width: '100%'}}
                >
                  Wachtwoord wijzigen
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="auth-info">
                Voer je huidige wachtwoord en je nieuwe wachtwoord in
              </div>
              
              <form className="auth-form" onSubmit={handlePasswordChange}>
                {/* Current Password */}
                <div className="form-group">
                  <label className="form-label" htmlFor="current-password">
                    Huidig wachtwoord *
                  </label>
                  <div className="password-field">
                    <input 
                      id="current-password"
                      type={showPasswords.current ? "text" : "password"}
                      value={passwordData.currentPassword}
                      onChange={e => setPasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                      className="form-input"
                      placeholder="********"
                      required 
                      disabled={isLoading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => togglePasswordVisibility('current')}
                      className="password-toggle"
                      aria-label={showPasswords.current ? "Wachtwoord verbergen" : "Wachtwoord tonen"}
                      disabled={isLoading}
                    >
                      {showPasswords.current ? 'Verberg' : 'Toon'}
                    </button>
                  </div>
                </div>
                
                {/* New Password */}
                <div className="form-group">
                  <label className="form-label" htmlFor="new-password">
                    Nieuw wachtwoord *
                  </label>
                  <div className="password-field">
                    <input 
                      id="new-password"
                      type={showPasswords.new ? "text" : "password"}
                      value={passwordData.newPassword}
                      onChange={e => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                      className="form-input"
                      placeholder="********"
                      required 
                      disabled={isLoading}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => togglePasswordVisibility('new')}
                      className="password-toggle"
                      aria-label={showPasswords.new ? "Wachtwoord verbergen" : "Wachtwoord tonen"}
                      disabled={isLoading}
                    >
                      {showPasswords.new ? 'Verberg' : 'Toon'}
                    </button>
                  </div>
                </div>
                
                {/* Confirm Password */}
                <div className="form-group">
                  <label className="form-label" htmlFor="confirm-password">
                    Bevestig nieuw wachtwoord *
                  </label>
                  <div className="password-field">
                    <input 
                      id="confirm-password"
                      type={showPasswords.confirm ? "text" : "password"}
                      value={passwordData.confirmPassword}
                      onChange={e => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                      className="form-input"
                      placeholder="********"
                      required 
                      disabled={isLoading}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => togglePasswordVisibility('confirm')}
                      className="password-toggle"
                      aria-label={showPasswords.confirm ? "Wachtwoord verbergen" : "Wachtwoord tonen"}
                      disabled={isLoading}
                    >
                      {showPasswords.confirm ? 'Verberg' : 'Toon'}
                    </button>
                  </div>
                </div>
                
                <div className="form-group" style={{ display: 'flex', gap: '0.75rem' }}>
                  <button 
                    type="submit" 
                    className="btn-primary" 
                    disabled={isLoading}
                    style={{ flex: 1 }}
                  >
                    {isLoading ? (
                      <>
                        <div className="loading-spinner"></div>
                        Wijzigen...
                      </>
                    ) : (
                      <>Wachtwoord wijzigen</>
                    )}
                  </button>
                  
                  <button 
                    type="button" 
                    className="btn-secondary" 
                    onClick={cancelPasswordChange}
                    disabled={isLoading}
                    style={{ flex: 1 }}
                  >
                    Annuleren
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
        
        <div className="auth-footer">
          <div className="auth-links">
            <button
              className="btn-primary"
              onClick={handleAccountLogout}
              style={{ width: '100%' }}
              disabled={isLoading}
            >
              Uitloggen
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}






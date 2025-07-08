import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { changePassword, updateUserProfile } from '../services/api'
import './Auth.css'

export default function MyAccount() {
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
  
  let user = null
  try {
    user = JSON.parse(localStorage.getItem('user'))
  } catch {
    localStorage.removeItem('user')
  }
  
  // Initialize active status from user data
  React.useEffect(() => {
    if (user) {
      console.log('MyAccount - Setting active status to:', user.active)
      setActiveStatus(user.active || false)
    }
  }, [user])
  
  if (!user) {
    navigate('/login')
    return null
  }

  const { firstName, lastName, email, active = false, id } = user
  
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
      setError(err.message || 'Er is een fout opgetreden bij het wijzigen van het wachtwoord.')
    } finally {
      setIsLoading(false)
    }
  }

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
      setError('Gebruikers-ID niet gevonden. Log opnieuw in.')
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
      
      setMessage(response.msg || 'Status succesvol bijgewerkt!')
    } catch (err) {
      console.error('MyAccount - Error updating active status:', err)
      setError(err.message || 'Er is een fout opgetreden bij het bijwerken van je status.')
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
          {/* Success/Error Messages */}
          {message && (
            <div className="auth-success">
              ✅ {message}
            </div>
          )}
          
          {error && (
            <div className="auth-error">
              ❌ {error}
            </div>
          )}
          
          {!showPasswordForm ? (
            <>             
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">
                  👤 Voornaam
                </label>
                <div style={{ 
                  padding: '0.75rem', 
                  background: 'var(--secondary-50)', 
                  border: '1px solid var(--secondary-200)', 
                  borderRadius: 'var(--radius-md)', 
                  color: 'var(--secondary-800)', 
                  fontWeight: '500' 
                }}>
                  {firstName}
                </div>
              </div>
              
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">
                  👥 Achternaam
                </label>
                <div style={{ 
                  padding: '0.75rem', 
                  background: 'var(--secondary-50)', 
                  border: '1px solid var(--secondary-200)', 
                  borderRadius: 'var(--radius-md)', 
                  color: 'var(--secondary-800)', 
                  fontWeight: '500' 
                }}>
                  {lastName}
                </div>
              </div>
              
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">
                  📧 E-mailadres
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
                  🔑 Account type
                </label>
                <div style={{ 
                  padding: '0.75rem', 
                  background: user.isAdmin ? 'var(--accent-blue-50)' : 'var(--secondary-50)', 
                  border: `1px solid ${user.isAdmin ? 'var(--accent-blue-200)' : 'var(--secondary-200)'}`, 
                  borderRadius: 'var(--radius-md)', 
                  color: user.isAdmin ? 'var(--accent-blue-800)' : 'var(--secondary-800)', 
                  fontWeight: '500' 
                }}>
                  {user.isAdmin ? '👑 Administrator' : '👤 Gebruiker'}
                </div>
              </div>
              
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={activeStatus}
                    onChange={(e) => handleActiveStatusChange(e.target.checked)}
                    disabled={isUpdatingActive}
                    style={{
                      width: '1.25rem',
                      height: '1.25rem',
                      cursor: isUpdatingActive ? 'not-allowed' : 'pointer'
                    }}
                  />
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem'}}>
                    {activeStatus ? 'Actief' : 'Inactief'}
                    {isUpdatingActive && <span style={{ fontSize: '0.8rem', color: 'var(--secondary-600)' }}>(wordt bijgewerkt...)</span>}
                  </span>
                </label>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: 'var(--secondary-600)', 
                  marginTop: '0.25rem',
                  marginLeft: '1rem' 
                }}>
                  {activeStatus ? 'Je bent actief en automatisch aangemeld voor opkomsten' : 'Je bent inactief en automatisch afgemeld voor opkomsten'}
                </div>
              </div>
              <p><br></br></p>
              <div className="form-group">
                <button 
                  className="btn-secondary" 
                  onClick={() => setShowPasswordForm(true)}
                  style={{ width: '100%'}}
                >
                  🔒 Wachtwoord wijzigen
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
                      placeholder="••••••••"
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
                      {showPasswords.current ? '🔒' : '👁️'}
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
                      placeholder="••••••••"
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
                      {showPasswords.new ? '🔒' : '👁️'}
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
                      placeholder="••••••••"
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
                      {showPasswords.confirm ? '🔒' : '👁️'}
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
              onClick={() => { 
                localStorage.removeItem('user'); 
                navigate('/login') 
              }}
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

import React, { useState } from 'react'
import { useNavigate }      from 'react-router-dom'
import { withSupportContact } from '../config/appInfo'
import { forgotPassword, resetPassword } from '../services/api'
import './Auth.css'

export default function ForgotPassword() {
  const [step, setStep]                     = useState('request')
  const [email, setEmail]                   = useState('')
  const [code, setCode]                     = useState('')
  const [password, setPassword]             = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false) // of wachtwoord tonen of verbergen
  const [isLoading, setIsLoading]           = useState(false)
  const [error, setError]                   = useState(null)
  const [success, setSuccess]               = useState(null)
  const navigate                            = useNavigate()

  // toggle voor wachtwoord zien of verbergen
  const toggleNewPasswordVisibility = () => {
    setShowNewPassword(!showNewPassword)
  }

  // Send initial forgot password request
  const handleForgotPassword = async (e) => {
    e.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    
    console.log('Sending forgot password request for:', normalizedEmail) // Debug log
    
    if (!normalizedEmail) {
      setError('Vul je e-mailadres in.')
      return
    }

    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      await forgotPassword(normalizedEmail)
      setEmail(normalizedEmail) // Store normalized email for later use
      setStep('reset')
      setSuccess('Herstelcode verzonden naar je e-mailadres.')
    } catch (err) {
      console.error('Forgot password error:', err) // Debug log
      setError(withSupportContact(err.message || 'Er is een fout opgetreden bij het verzenden van de herstelcode.'))
    } finally {
      setIsLoading(false)
    }
  }

  // opnieuw code versturen zonder email opnieuw in te voeren
  const resendCode = async () => {
    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      await forgotPassword(normalizedEmail)
      setSuccess('Verificatiecode opnieuw verzonden.')
    } catch {
      setError(withSupportContact('Kon de verificatiecode niet opnieuw verzenden.'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleReset = async e => {
    e.preventDefault()
    if (!code.trim()) {
      setError('Vul de verificatiecode in.')
      return
    }
    if (password.length < 6) {
      setError('Wachtwoord moet minimaal 6 karakters bevatten.')
      return
    }

    setError(null)
    setSuccess(null)
    setIsLoading(true)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      console.log('Sending reset password request:', { email: normalizedEmail, code: code.trim() }) // Debug log
      await resetPassword(normalizedEmail, code.trim(), password)
      setSuccess('Wachtwoord succesvol gereset! Je wordt doorgestuurd naar de inlogpagina...')
      setTimeout(() => navigate('/login'), 2000)
    } catch (err) {
      console.error('Reset password error:', err) // Debug log
      const msg = err.message.toLowerCase()
      if (msg.includes('geen actieve herstelcode')) {
        setError('Geen actieve herstelcode gevonden. Vraag eerst een nieuwe code aan.')
      } else if (msg.includes('ongeldige herstelcode')) {
        setError('De ingevoerde code is niet correct. Controleer de code en probeer opnieuw.')
      } else if (msg.includes('verlopen')) {
        setError('De herstelcode is verlopen. Vraag een nieuwe code aan.')
      } else if (msg.includes('404')) {
        setError(withSupportContact('API endpoint niet gevonden. Controleer of de server draait.'))
      } else if (msg.includes('failed to fetch')) {
        setError(withSupportContact('Kan geen verbinding maken met de server. Controleer je internet.'))
      } else {
        setError(withSupportContact(err.message || 'Er is een fout opgetreden bij resetten.'))
      }
    } finally {
      setIsLoading(false)
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
          <h1 className="auth-title">Wachtwoord vergeten</h1>
          <p className="auth-subtitle">
            {step === 'request' 
              ? 'Voer je e-mailadres in om een herstelcode te ontvangen'
              : 'Voer de ontvangen code en je nieuwe wachtwoord in'
            }
          </p>
        </div>

        <div className="auth-body">
          {step === 'request' ? (
            <form onSubmit={handleForgotPassword} className="auth-form">
              {/* Email Field */}
              <div className="form-group">
                <label className="form-label" htmlFor="email">
                  📧 E-mailadres
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value.trim().toLowerCase())}
                  className="form-input"
                  placeholder="je@email.com"
                  required
                  disabled={isLoading}
                  autoComplete="email"
                />
              </div>

              {/* Submit Button */}
              <button type="submit" className="btn-primary" disabled={isLoading || !email.trim()}>
                {isLoading ? 'Verzenden…' : 'Verstuur herstelcode'}
              </button>
            </form>
          ) : (
            <>
              <div className="auth-info">
                Code is verstuurd naar <strong>{email}</strong>.
              </div>
              <form onSubmit={handleReset} className="auth-form">
                {/* Verification code */}
                <div className="form-group">
                  <label className="form-label">Verificatiecode</label>
                  <input
                    type="text"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    className="form-input code-input"
                    placeholder="123456"
                    required
                    disabled={isLoading}
                    maxLength={6}
                  />
                </div>

                {/* New password with visibility toggle */}
                <div className="form-group">
                  <label className="form-label">Nieuw wachtwoord</label>
                  <div className="input-wrapper">
                    <div className="password-field">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="form-input"
                        placeholder="••••••••"
                        required
                        minLength={6}
                        disabled={isLoading}
                        autoComplete="new-password"
                        aria-label="Nieuw wachtwoord"
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={toggleNewPasswordVisibility}
                        disabled={isLoading}
                        aria-label={
                          showNewPassword ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'
                        }
                      >
                        {showNewPassword ? '🔒' : '👁️'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Submit */}
                <button type="submit" className="btn-primary" disabled={isLoading}>
                  {isLoading ? 'Resetten…' : 'Reset wachtwoord'}
                </button>
              </form>

              {/* Resend code button */}
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-link"
                  onClick={resendCode}
                  disabled={isLoading}
                >
                  Opnieuw code verzenden
                </button>
              </div>
            </>
          )}

          {/* Success/Error messages */}
          {success && (
            <div className="success-message">
              ✅ {success}
            </div>
          )}
          {error && (
            <div className="error-message">
              ⚠️ {error}
            </div>
          )}

          {/* Back to login link */}
          <div className="auth-footer">
            <button
              type="button"
              className="btn-link"
              onClick={() => navigate('/login')}
              disabled={isLoading}
            >
              ← Terug naar inloggen
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

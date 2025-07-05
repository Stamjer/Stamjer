import React, { useState } from 'react'
import { useNavigate }      from 'react-router-dom'
import { forgotPassword, resetPassword } from '../services/api'
import './Auth.css'

export default function ForgotPassword() {
  const [step, setStep]        = useState('request')
  const [email, setEmail]      = useState('')
  const [code, setCode]        = useState('')
  const [password, setPassword]= useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage]     = useState(null)
  const [error, setError]         = useState(null)
  const navigate = useNavigate()

  const handleRequest = async e => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Vul een geldig e-mailadres in.')
      return
    }
    
    setError(null); setMessage(null); setIsLoading(true)
    console.log('Starting forgot password request for:', email)
    
    try {
      const data = await forgotPassword(email)
      console.log('Success response:', data)
      setMessage(data.msg)
      setStep('reset')
    } catch (err) {
      console.error('Reset request error:', err)
      console.error('Error type:', typeof err)
      console.error('Error message:', err.message)
      console.error('Error stack:', err.stack)
      
      // Show more specific error message
      if (err.message.includes('404')) {
        setError('API endpoint niet gevonden. Controleer of de server correct draait.')
      } else if (err.message.includes('Failed to fetch')) {
        setError('Kan geen verbinding maken met de server. Controleer je internetverbinding.')
      } else {
        setError('Er is een fout opgetreden. Probeer het later opnieuw.')
      }
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
    if (!password || password.length < 6) {
      setError('Wachtwoord moet minimaal 6 karakters bevatten.')
      return
    }
    
    setError(null); setMessage(null); setIsLoading(true)
    console.log('Starting password reset for:', email)
    
    try {
      const data = await resetPassword(email, code, password)
      console.log('Reset success response:', data)
      setMessage(data.msg || 'Wachtwoord succesvol gereset!')
      setTimeout(() => navigate('/login'), 2000)
    } catch (err) {
      console.error('Reset password error:', err)
      console.error('Error type:', typeof err)
      console.error('Error message:', err.message)
      console.error('Error stack:', err.stack)
      
      // Show more specific error message
      if (err.message.includes('404')) {
        setError('API endpoint niet gevonden. Controleer of de server correct draait.')
      } else if (err.message.includes('Failed to fetch')) {
        setError('Kan geen verbinding maken met de server. Controleer je internetverbinding.')
      } else {
        setError(err.message || 'Er is een fout opgetreden bij het resetten van het wachtwoord.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        {step === 'request' ? (
          <>
            <div className="auth-header">
              <img 
                src="/stam_H.png" 
                alt="Stamjer Logo" 
                className="auth-logo"
              />
              <h2 className="auth-title">Wachtwoord vergeten</h2>
              <p className="auth-subtitle">We sturen je een verificatiecode om je wachtwoord te resetten</p>
            </div>
            
            <div className="auth-body">
              <form className="auth-form" onSubmit={handleRequest}>
                <div className="form-group">
                  <label className="form-label">
                    E-mailadres
                  </label>
                  <input 
                    type="email" 
                    value={email} 
                    onChange={e => setEmail(e.target.value)} 
                    className="form-input"
                    placeholder="voorbeeld@email.com"
                    required 
                    disabled={isLoading}
                  />
                </div>
                
                <button type="submit" className="btn-primary" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <div className="loading-spinner"></div>
                      Versturen…
                    </>
                  ) : (
                    <>
                      Verstuur code
                    </>
                  )}
                </button>
              </form>
            </div>
            
            <div className="auth-footer">
              <div className="auth-links">
                <button 
                  className="btn-link" 
                  onClick={() => navigate('/login')} 
                  disabled={isLoading}
                >
                  Terug naar inloggen
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="auth-header">
              <img 
                src="/stam_H.png" 
                alt="Stamjer Logo" 
                className="auth-logo"
              />
              <h2 className="auth-title">Nieuw wachtwoord</h2>
              <p className="auth-subtitle">Voer de verificatiecode en je nieuwe wachtwoord in</p>
            </div>
            
            <div className="auth-body">
              <div className="auth-info">
                Controleer je e-mail voor de verificatiecode die naar <strong>{email}</strong> is verstuurd.
              </div>
              <p></p>
              
              <form className="auth-form" onSubmit={handleReset}>
                <div className="form-group">
                  <label className="form-label">
                    Verificatiecode
                  </label>
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
                
                <div className="form-group">
                  <label className="form-label">
                    Nieuw wachtwoord
                  </label>
                  <input 
                    type="password" 
                    value={password} 
                    onChange={e => setPassword(e.target.value)} 
                    className="form-input"
                    placeholder="••••••••"
                    required 
                    minLength={6} 
                    disabled={isLoading}
                  />
                </div>
                
                <button type="submit" className="btn-primary" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <div className="loading-spinner"></div>
                      Resetten…
                    </>
                  ) : (
                    <>
                      Reset wachtwoord
                    </>
                  )}
                </button>
              </form>
            </div>
            
            <div className="auth-footer">
              <div className="auth-links">
                <button 
                  className="btn-link" 
                  onClick={() => setStep('request')} 
                  disabled={isLoading}
                >
                  Andere e-mail gebruiken
                </button>
                <span className="auth-divider">•</span>
                <button 
                  className="btn-link" 
                  onClick={() => navigate('/login')} 
                  disabled={isLoading}
                >
                  Terug naar inloggen
                </button>
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="message error">
            ⚠️ {error}
          </div>
        )}
      </div>
    </div>
  )
}

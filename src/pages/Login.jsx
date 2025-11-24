/**
 * ================================================================
 * LOGIN PAGE COMPONENT
 * ================================================================
 * 
 * Enhanced login page with improved UX, accessibility, and security features:
 * - Better form validation
 * - Loading states
 * - Error handling
 * - Accessibility improvements
 * - Password visibility toggle
 * 
 * @author R.S. Kort
 *
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { withSupportContact } from '../config/appInfo'
import { login } from '../services/api'
import './Auth.css'

export default function Login({ setUser }) {
  // ================================================================
  // STATE MANAGEMENT
  // ================================================================
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [isFormValid, setIsFormValid] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [rememberMe, setRememberMe] = useState(true)
  
  const navigate = useNavigate()

  // ================================================================
  // FORM VALIDATION
  // ================================================================
  
  /**
   * Validate email format
   */
  const validateEmail = useCallback((email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }, [])

  /**
   * Validate entire form
   */
  useEffect(() => {
    const errors = {}
    
    if (email && !validateEmail(email)) {
      errors.email = 'Voer een geldig e-mailadres in'
    }
    
    setFieldErrors(errors)
    setIsFormValid(email && password && Object.keys(errors).length === 0)
  }, [email, password, validateEmail])

  // ================================================================
  // EVENT HANDLERS
  // ================================================================

  /**
   * Handle form submission with enhanced error handling
   */
  const handleSubmit = async (e) => {
    e.preventDefault()
    
    // Clear previous errors
    setError(null)
    setFieldErrors({})
    
    // Final validation
    if (!isFormValid) {
      setError('Controleer je invoer en probeer opnieuw')
      return
    }
    
    setIsLoading(true)
    
    try {
      const data = await login(email, password)
      
      // Store user data locally so login persists
      localStorage.setItem('user', JSON.stringify(data.user))
      localStorage.setItem('rememberMe', 'true')
      
      setUser(data.user)
      
      // Add success animation delay
      setTimeout(() => {
        navigate('/kalender')
      }, 300)
      
    } catch (err) {
      console.error('Login error:', err)
      
      // Handle specific error types
      if (err.message.includes('email')) {
        setFieldErrors({ email: 'E-mailadres niet gevonden' })
      } else if (err.message.includes('password')) {
        setFieldErrors({ password: 'Incorrect wachtwoord' })
      } else {
        setError(withSupportContact(err.message || 'Er is een fout opgetreden. Probeer het opnieuw.'))
      }
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Handle keyboard navigation
   */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && isFormValid && !isLoading) {
      handleSubmit(e)
    }
  }

  /**
   * Toggle password visibility
   */
  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword)
  }

  // ================================================================
  // LOAD REMEMBERED EMAIL
  // ================================================================
  
  useEffect(() => {
    const remembered = localStorage.getItem('rememberMe')
    if (remembered) {
      const savedUser = localStorage.getItem('user')
      if (savedUser) {
        try {
          const userData = JSON.parse(savedUser)
          if (userData.email) {
            setEmail(userData.email)
            setRememberMe(true)
          }
        } catch (error) {
          console.error('Error loading remembered user:', error)
        }
      }
    }
  }, [])

  // ================================================================
  // RENDER
  // ================================================================

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img 
            src="/stam_H.png" 
            alt="Stamjer Logo" 
            className="auth-logo"
          />
          <h1 className="auth-title">Welkom terug</h1>
          <p className="auth-subtitle">Log in op je Stamjer account</p>
        </div>
        
        <div className="auth-body">
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {/* Email Field */}
            <div className="form-group">
              <label className="form-label" htmlFor="email">
                E-mailadres
              </label>
              <div className="input-wrapper">
                <input 
                  id="email"
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value.trim().toLowerCase())} 
                  onKeyDown={handleKeyDown}
                  className={`form-input ${fieldErrors.email ? 'error' : ''}`}
                  placeholder="je@email.com"
                  required 
                  disabled={isLoading}
                  autoComplete="email"
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                />
                {fieldErrors.email && (
                  <div id="email-error" className="field-error" role="alert">
                    {fieldErrors.email}
                  </div>
                )}
              </div>
            </div>
            
            {/* Password Field */}
            <div className="form-group">
              <label className="form-label" htmlFor="password">
                Wachtwoord
              </label>
              <div className="input-wrapper">
                <div className="password-field">
                  <input 
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password} 
                    onChange={e => setPassword(e.target.value)} 
                    onKeyDown={handleKeyDown}
                    className={`form-input ${fieldErrors.password ? 'error' : ''}`}
                    placeholder="••••••••"
                    required 
                    disabled={isLoading}
                    autoComplete="current-password"
                    aria-describedby={fieldErrors.password ? "password-error" : undefined}
                  />
                  <button
                    type="button"
                    onClick={togglePasswordVisibility}
                    className="password-toggle"
                    aria-label={showPassword ? "Wachtwoord verbergen" : "Wachtwoord tonen"}
                    disabled={isLoading}
                  >
                    {showPassword ? 'Verberg' : 'Toon'}
                  </button>
                </div>
                {fieldErrors.password && (
                  <div id="password-error" className="field-error" role="alert">
                    {fieldErrors.password}
                  </div>
                )}
              </div>
            </div>

            {/* Remember Me Checkbox */}
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  disabled={isLoading}
                  className="checkbox-input"
                />
                <span className="checkbox-custom"></span>
                Onthoud mij
              </label>
            </div>
            
            {/* Submit Button */}
            <button 
              type="submit" 
              className={`btn-primary ${!isFormValid ? 'disabled' : ''}`} 
              disabled={isLoading || !isFormValid}
              aria-describedby={error ? "login-error" : undefined}
            >
              {isLoading ? (
                <>
                  <div className="loading-spinner"></div>
                  Inloggen…
                </>
              ) : (
                'Inloggen'
              )}
            </button>
            
            {/* Error Message */}
            {error && (
              <div id="login-error" className="error-message" role="alert">
                {error}
              </div>
            )}
          </form>
        </div>
        
        <div className="auth-footer">
          <div className="auth-links">
            <button 
              className="btn-link" 
              onClick={() => navigate('/forgot-password')} 
              disabled={isLoading}
              aria-label="Wachtwoord vergeten? Klik hier om je wachtwoord te resetten"
            >
              Wachtwoord vergeten?
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

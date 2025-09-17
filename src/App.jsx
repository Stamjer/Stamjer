/**
 * ================================================================
 * STAMJER CALENDAR APPLICATION - MAIN APP COMPONENT
 * ================================================================
 * 
 * This is the root component of the Stamjer calendar application.
 * It manages:
 * - User authentication state
 * - Navigation between different pages
 * - Route protection for authenticated pages
 * - Global navigation bar
 * - Error boundaries and performance optimization
 * 
 * @author R.S. Kort
 * @version 1.3.3
 */

// React core imports
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { APP_VERSION, withSupportContact } from './config/appInfo'

// Page components
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import CalendarPage from './pages/CalendarPage'
import OpkomstenPage from './pages/OpkomstenPage'
import MyAccount from './pages/MyAccount'
import StrepenPage from './pages/StrepenPage'

// Component imports
import ProtectedRoute from './components/ProtectedRoute'
import { AppErrorBoundary, PageErrorBoundary, setupGlobalErrorHandling } from './components/ErrorBoundary'
import { ToastProvider } from './hooks/useToast'

// Query client configuration
import { queryClient } from './lib/queryClient'

// Import the improved App CSS
import './App.css'
import './components/ErrorBoundary.css'

/**
 * Error Boundary Component for handling React errors gracefully
 * Note: This is now replaced by our professional error boundary system
 * but kept for backward compatibility during migration
 */
class LegacyErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Legacy Error Boundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-content">
            <h2>Er is iets misgegaan</h2>
            <p>{withSupportContact('We konden de applicatie niet laden. Probeer de pagina te vernieuwen.')}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="btn btn-primary"
            >
              Pagina vernieuwen
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Main Application Component
 * 
 * This component serves as the entry point for the entire application.
 * It handles:
 * - User authentication state management
 * - Route navigation and protection
 * - Global navigation bar rendering
 * - Local storage management for user sessions
 * - Performance optimization with memoization
 */
function App() {
  // ================================================================
  // HOOKS AND STATE MANAGEMENT
  // ================================================================
  
  // Navigation and routing hooks
  const navigate = useNavigate()
  const location = useLocation()
  
  // User authentication state
  // This stores the currently logged-in user information
  const [user, setUser] = useState(null)
  const [isInitializing, setIsInitializing] = useState(true)
  
  // Mobile navigation state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  // ================================================================
  // EFFECTS AND INITIALIZATION
  // ================================================================
  
  /**
   * Setup global error handling on app mount
   */
  React.useEffect(() => {
    setupGlobalErrorHandling()
  }, [])
  
  /**
   * Load user from localStorage on component mount
   * This allows users to stay logged in when they refresh the page
   */
  useEffect(() => {
    const initializeUser = async () => {
      try {
        const raw = localStorage.getItem('user')
        if (raw) {
          const userData = JSON.parse(raw)
          // Validate user data structure
          if (userData && (userData.email || userData.id)) {
            setUser(userData)
          } else {
            localStorage.removeItem('user')
          }
        }
      } catch (error) {
        console.error('Error loading user from localStorage:', error)
        localStorage.removeItem('user')
      } finally {
        setIsInitializing(false)
      }
    }

    initializeUser()
  }, [])

  /**
   * Close mobile menu when clicking outside or pressing escape
   */
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMobileMenuOpen && !event.target.closest('.nav-container')) {
        setIsMobileMenuOpen(false)
      }
    }

    const handleEscapeKey = (event) => {
      if (event.key === 'Escape' && isMobileMenuOpen) {
        setIsMobileMenuOpen(false)
      }
    }

    if (isMobileMenuOpen) {
      document.addEventListener('click', handleClickOutside)
      document.addEventListener('keydown', handleEscapeKey)
      // Prevent body scroll when mobile menu is open
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleEscapeKey)
      document.body.style.overflow = ''
    }
  }, [isMobileMenuOpen])

  // ================================================================
  // EVENT HANDLERS (MEMOIZED FOR PERFORMANCE)
  // ================================================================
  
  /**
   * Handle user logout
   * Clears user session and redirects to login page
   */
  const handleLogout = useCallback(() => {
    try {
      localStorage.removeItem('user')
      setUser(null)
      navigate('/login')
      setIsMobileMenuOpen(false) // Close mobile menu on logout
    } catch (error) {
      console.error('Error during logout:', error)
      // Force logout even if there's an error
      setUser(null)
      navigate('/login')
      setIsMobileMenuOpen(false)
    }
  }, [navigate])

  /**
   * Handle user login
   * Updates user state and saves to localStorage
   */
  const handleLogin = useCallback((userData) => {
    try {
      localStorage.setItem('user', JSON.stringify(userData))
      setUser(userData)
    } catch (error) {
      console.error('Error saving user to localStorage:', error)
      // Still set user in state even if localStorage fails
      setUser(userData)
    }
  }, [])

  /**
   * Toggle mobile menu visibility
   */
  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(prev => !prev)
  }, [])

  /**
   * Close mobile menu when navigating
   */
  const handleNavigation = useCallback((path) => {
    navigate(path)
    setIsMobileMenuOpen(false)
  }, [navigate])

  // ================================================================
  // MEMOIZED VALUES FOR PERFORMANCE
  // ================================================================
  
  /**
   * Determine if navigation should be hidden
   * Navigation is hidden on authentication pages (login, forgot-password, etc.)
   */
  const shouldHideNavigation = useMemo(() => {
    return ['/login', '/', '/forgot-password'].includes(location.pathname)
  }, [location.pathname])

  // ================================================================
  // LOADING STATE
  // ================================================================
  
  if (isInitializing) {
    return (
      <div className="app-loading">
        <div className="loading-content">
          <img src="/stam_H.png" alt="Stamjer Logo" className="loading-logo" />
          <div className="loading-spinner"></div>
          <p>Stamjer laden...</p>
        </div>
      </div>
    )
  }

  // ================================================================
  // RENDER
  // ================================================================
  
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider position="top-right">
        <AppErrorBoundary 
          onError={(errorReport) => {
            console.error('Application Error:', errorReport)
            // Here you could send to monitoring service
          }}
        >
        <div className="app-container">
          {/* Conditional Navigation Bar */}
          {!shouldHideNavigation && (
            <nav className="nav-container" role="navigation" aria-label="Hoofdnavigatie">
              {/* Brand Section */}
              <div className="nav-brand">
                <img 
                  src="/stam_H.png" 
                  alt="Stamjer Logo" 
                  className="nav-logo"
                />
                <span className="nav-title">Stamjer</span>
                <span
                  className="nav-version"
                  aria-label={`Applicatie versie ${APP_VERSION}`}
                >
                  v{APP_VERSION}
                </span>
              </div>

              {/* Mobile Menu Toggle Button */}
              <button 
                className="mobile-menu-toggle"
                onClick={toggleMobileMenu}
                aria-label="Menu openen/sluiten"
                aria-expanded={isMobileMenuOpen}
              >
                <span className={`hamburger ${isMobileMenuOpen ? 'open' : ''}`}>
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </button>

              {/* Navigation Menu */}
              <div className={`nav-menu ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
                <button 
                  onClick={() => handleNavigation('/kalender')} 
                  className="btn btn-secondary nav-btn"
                  aria-label="Ga naar kalender"
                >
                  📅 Kalender
                </button>
                <button 
                  onClick={() => handleNavigation('/opkomsten')} 
                  className="btn btn-secondary nav-btn"
                  aria-label="Ga naar opkomsten"
                >
                  🗓️ Opkomsten
                </button>
                {user && user.isAdmin && (
                  <button 
                    onClick={() => handleNavigation('/strepen')} 
                    className="btn btn-secondary nav-btn"
                    aria-label="Ga naar strepen"
                  >
                    🎯 Strepen
                  </button>
                )}

                {user ? (
                  // Authenticated user menu
                  <>
                    <button 
                      onClick={() => handleNavigation('/account')} 
                      className="btn btn-secondary nav-btn"
                      aria-label="Ga naar mijn account"
                    >
                      {user.isAdmin ? '👤 Mijn account' : '👤 Mijn account'}
                    </button>
                    <button 
                      onClick={handleLogout} 
                      className="btn btn-outline nav-btn"
                      aria-label="Uitloggen"
                    >
                      Uitloggen
                    </button>
                  </>
                ) : (
                  // Non-authenticated user menu
                  <button 
                    onClick={() => handleNavigation('/login')} 
                    className="btn btn-primary nav-btn"
                    aria-label="Ga naar inlogpagina"
                  >
                    🔐 Inloggen
                  </button>
                )}
              </div>
            </nav>
          )}

          {/* Application Routes */}
          <main role="main">
            <Routes>
              {/* Public Routes - Available to all users */}
              <Route path="/" element={
                <PageErrorBoundary pageName="Login">
                  <Login setUser={handleLogin} />
                </PageErrorBoundary>
              } />
              <Route path="/login" element={
                <PageErrorBoundary pageName="Login">
                  <Login setUser={handleLogin} />
                </PageErrorBoundary>
              } />
              <Route path="/forgot-password" element={
                <PageErrorBoundary pageName="Forgot Password">
                  <ForgotPassword />
                </PageErrorBoundary>
              } />
              
              {/* Protected Routes - Require authentication */}
              <Route path="/kalender" element={
                <ProtectedRoute user={user}>
                  <PageErrorBoundary pageName="Calendar">
                    <CalendarPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }/>
              <Route path="/opkomsten" element={
                <ProtectedRoute user={user}>
                  <PageErrorBoundary pageName="Opkomsten">
                    <OpkomstenPage />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }/>
              <Route path="/strepen" element={
                <ProtectedRoute user={user}>
                  <PageErrorBoundary pageName="Strepen">
                    {user && user.isAdmin ? <StrepenPage /> : <div>Alleen toegankelijk voor admins. Dus niet voor plebs zoals jij...</div>}
                  </PageErrorBoundary>
                </ProtectedRoute>
              }/>
              <Route path="/account" element={
                <ProtectedRoute user={user}>
                  <PageErrorBoundary pageName="My Account">
                    <MyAccount />
                  </PageErrorBoundary>
                </ProtectedRoute>
              }/>
            </Routes>
          </main>
        </div>

        {/* Development Query Devtools */}
        {import.meta.env.DEV && (
          <ReactQueryDevtools 
            initialIsOpen={false}
            position="bottom-right"
          />
        )}
      </AppErrorBoundary>
      </ToastProvider>
    </QueryClientProvider>
  )
}

// Export memoized component for performance
export default React.memo(App)

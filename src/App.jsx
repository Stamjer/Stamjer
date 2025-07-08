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
 * @author Stamjer Development Team
 * @version 1.1.0
 */

// React core imports
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'

// Page components
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import CalendarPage from './pages/CalendarPage'
import OpkomstenPage from './pages/OpkomstenPage'
import MyAccount from './pages/MyAccount'
import StrepenPage from './pages/StrepenPage'

// Component imports
import ProtectedRoute from './components/ProtectedRoute'

// Import the improved App CSS
import './App.css'

/**
 * Error Boundary Component for handling React errors gracefully
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('App Error Boundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-content">
            <h2>Er is iets misgegaan</h2>
            <p>We konden de applicatie niet laden. Probeer de pagina te vernieuwen.</p>
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

  // ================================================================
  // EFFECTS AND INITIALIZATION
  // ================================================================
  
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
    } catch (error) {
      console.error('Error during logout:', error)
      // Force logout even if there's an error
      setUser(null)
      navigate('/login')
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
    <ErrorBoundary>
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
            </div>

            {/* Navigation Menu */}
            <div className="nav-menu">
              <button 
                onClick={() => navigate('/calendar')} 
                className="btn btn-secondary"
                aria-label="Ga naar kalender"
              >
                📅 Kalender
              </button>
              <button 
                onClick={() => navigate('/opkomsten')} 
                className="btn btn-secondary"
                aria-label="Ga naar opkomsten"
              >
                🗓️ Opkomsten
              </button>
              {user && user.isAdmin && (
                <button 
                  onClick={() => navigate('/strepen')} 
                  className="btn btn-secondary"
                  aria-label="Ga naar strepen"
                >
                  🎯 Strepen
                </button>
              )}

              {user ? (
                // Authenticated user menu
                <>
                  <button 
                    onClick={() => navigate('/account')} 
                    className="btn btn-secondary"
                    aria-label="Ga naar mijn account"
                  >
                    {user.isAdmin ? '👤 Mijn account' : '👤 Mijn account'}
                  </button>
                  <button 
                    onClick={handleLogout} 
                    className="btn btn-outline"
                    aria-label="Uitloggen"
                  >
                    Uitloggen
                  </button>
                </>
              ) : (
                // Non-authenticated user menu
                <button 
                  onClick={() => navigate('/login')} 
                  className="btn btn-primary"
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
            <Route path="/" element={<Login setUser={handleLogin} />} />
            <Route path="/login" element={<Login setUser={handleLogin} />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            
            {/* Protected Routes - Require authentication */}
            <Route path="/calendar" element={
              <ProtectedRoute user={user}>
                <CalendarPage />
              </ProtectedRoute>
            }/>
            <Route path="/opkomsten" element={
              <ProtectedRoute user={user}>
                <OpkomstenPage />
              </ProtectedRoute>
            }/>
            <Route path="/strepen" element={
              <ProtectedRoute user={user}>
                {user && user.isAdmin ? <StrepenPage /> : <div>Alleen toegankelijk voor admins</div>}
              </ProtectedRoute>
            }/>
            <Route path="/account" element={
              <ProtectedRoute user={user}>
                <MyAccount />
              </ProtectedRoute>
            }/>
          </Routes>
        </main>
      </div>
    </ErrorBoundary>
  )
}

// Export memoized component for performance
export default React.memo(App)

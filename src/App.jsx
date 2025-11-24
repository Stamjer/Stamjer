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
 *
 */

// React core imports
import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense, useRef } from 'react'
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { APP_VERSION, withSupportContact } from './config/appInfo'


// Component imports
import ProtectedRoute from './components/ProtectedRoute'
import { AppErrorBoundary, PageErrorBoundary, setupGlobalErrorHandling } from './components/ErrorBoundary'
import { ToastProvider } from './hooks/useToast'
import { CalendarIcon, ClipboardIcon, EuroIcon, TrophyIcon, UserIcon, LoginIcon, NotificationIcon } from './components/icons'
import NotificationCenter from './components/notifications/NotificationCenter'
import PullToRefresh from './components/PullToRefresh'

// Query client configuration
import { queryClient } from './lib/queryClient'
import { performHardReset } from './lib/hardReset'

// Import styles
import './styles/shared.css'
import './App.css'
import './components/ErrorBoundary.css'
import clickSoundUrl from './assets/stamjer.mp3'

// Page components (lazy-loaded)
const Login = lazy(() => import('./pages/Login'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const OpkomstenPage = lazy(() => import('./pages/OpkomstenPage'))
const MyAccount = lazy(() => import('./pages/MyAccount'))
const StrepenPage = lazy(() => import('./pages/StrepenPage'))
const PaymentRequestPage = lazy(() => import('./pages/PaymentRequestPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const NotificationAdminPage = lazy(() => import('./pages/NotificationAdminPage'))
const NotFound = lazy(() => import('./pages/NotFound'))

const ROUTE_LABELS = {
  '/': 'Login',
  '/login': 'Login',
  '/forgot-password': 'Wachtwoord herstellen',
  '/kalender': 'Kalender',
  '/opkomsten': 'Opkomsten',
  '/declaraties': 'Declaraties',
  '/strepen': 'Strepen',
  '/account': 'Account',
  '/meldingen': 'Meldingen',
  '/meldingen/beheer': 'Meldingbeheer',
}

const NAV_ICON_MAP = {
  '/kalender': CalendarIcon,
  '/opkomsten': ClipboardIcon,
  '/declaraties': EuroIcon,
  '/strepen': TrophyIcon,
  '/account': UserIcon,
  '/login': LoginIcon,
  '/': LoginIcon,
  '/meldingen': NotificationIcon,
  '/meldingen/beheer': NotificationIcon,
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
  // Audio for logo click
  const clickSoundRef = useRef(null)

  // ================================================================
  // EFFECTS AND INITIALIZATION
  // ================================================================
  
  /**
   * Setup global error handling on app mount
   */
  React.useEffect(() => {
    setupGlobalErrorHandling()
  }, [])

  // Prepare click sound (preload) once
  useEffect(() => {
    try {
      const audio = new Audio(clickSoundUrl)
      audio.preload = 'auto'
      clickSoundRef.current = audio
    } catch (e) {
      // Ignore audio setup errors; playback will fallback to constructing on demand
    }
    return () => {
      if (clickSoundRef.current) {
        try {
          clickSoundRef.current.pause()
        } catch {}
        clickSoundRef.current = null
      }
    }
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
          // Validate user data structure and presence of sessionToken for API auth
          if (userData && (userData.email || userData.id) && userData.sessionToken) {
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
      document.body.classList.add('body-lock-scroll')
    } else {
      document.body.style.overflow = ''
      document.body.classList.remove('body-lock-scroll')
    }

    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleEscapeKey)
      document.body.style.overflow = ''
      document.body.classList.remove('body-lock-scroll')
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

  // Play sound when the logo is activated (click/keyboard)
  const playLogoSound = useCallback(() => {
    try {
      const audio = clickSoundRef.current || new Audio(clickSoundUrl)
      clickSoundRef.current = audio
      // Ensure fresh playback on rapid clicks
      try { audio.pause() } catch {}
      try { audio.currentTime = 0 } catch {}
      const p = audio.play()
      if (p && typeof p.catch === 'function') {
        p.catch(() => { /* Ignore user-gesture or interruption errors */ })
      }
    } catch {
      // No-op on audio errors
    }
  }, [])

  const handleHardReset = useCallback(() => {
    performHardReset()
  }, [])

  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  // ================================================================
  // MEMOIZED VALUES FOR PERFORMANCE
  // ================================================================
  
  /**
   * Determine if navigation should be hidden
   * Navigation is hidden on authentication pages (login, forgot-password, etc.)
   */
  const normalizedPathname = useMemo(() => {
    if (location.pathname === '/') {
      return '/login'
    }

    return location.pathname
  }, [location.pathname])

  const shouldHideNavigation = useMemo(() => {
    return ['/login', '/', '/forgot-password'].includes(location.pathname)
  }, [location.pathname])

  const navMenuItems = useMemo(() => {
    const baseItems = [
      {
        to: '/kalender',
        label: ROUTE_LABELS['/kalender'],
        icon: NAV_ICON_MAP['/kalender'],
        variant: 'secondary',
      },
      {
        to: '/opkomsten',
        label: ROUTE_LABELS['/opkomsten'],
        icon: NAV_ICON_MAP['/opkomsten'],
        variant: 'secondary',
      },
      {
        to: '/declaraties',
        label: ROUTE_LABELS['/declaraties'],
        icon: NAV_ICON_MAP['/declaraties'],
        variant: 'secondary',
      },
    ]

    if (user?.isAdmin) {
      baseItems.push({
        to: '/strepen',
        label: ROUTE_LABELS['/strepen'],
        icon: NAV_ICON_MAP['/strepen'],
        variant: 'secondary',
      })
    }

    baseItems.push(
      user
        ? {
            to: '/account',
            label: ROUTE_LABELS['/account'],
            icon: NAV_ICON_MAP['/account'],
            variant: 'secondary',
          }
        : {
            to: '/login',
            label: ROUTE_LABELS['/login'],
            icon: NAV_ICON_MAP['/login'],
            variant: 'primary',
          }
    )

    return baseItems
  }, [user])

  const mobileNavItems = useMemo(() => {
    if (!user) {
      return []
    }

    const items = [
      {
        to: '/kalender',
        label: ROUTE_LABELS['/kalender'],
        icon: NAV_ICON_MAP['/kalender'],
      },
      {
        to: '/opkomsten',
        label: ROUTE_LABELS['/opkomsten'],
        icon: NAV_ICON_MAP['/opkomsten'],
      },
      {
        to: '/declaraties',
        label: ROUTE_LABELS['/declaraties'],
        icon: NAV_ICON_MAP['/declaraties'],
      },
    ]

    if (user.isAdmin) {
      items.push({
        to: '/strepen',
        label: ROUTE_LABELS['/strepen'],
        icon: NAV_ICON_MAP['/strepen'],
      })
    }

    items.push({
      to: '/account',
      label: ROUTE_LABELS['/account'],
      icon: NAV_ICON_MAP['/account'],
    })

    return items
  }, [user])

  const activeSection = useMemo(() => {
    const label = ROUTE_LABELS[normalizedPathname]
    const Icon = NAV_ICON_MAP[normalizedPathname]

    if (!label) {
      return null
    }

    return { label, Icon }
  }, [normalizedPathname])

  const navUserMeta = useMemo(() => {
    if (!user) {
      return null
    }

    const initials = [user.firstName, user.lastName]
      .filter(Boolean)
      .map((name) => name.trim().charAt(0).toUpperCase())
      .filter(Boolean)
      .slice(0, 2)
      .join('')

    return {
      name: user.firstName || user.email || 'Gebruiker',
      role: user.isAdmin ? 'Administrator' : 'Lid',
      initials: initials || 'S',
    }
  }, [user])

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
          <PullToRefresh onRefresh={handleHardReset} />
          <a href="#main" className="skip-link">Ga naar hoofdinhoud</a>
          {/* Conditional Navigation Bar */}
          {!shouldHideNavigation && (
            <>
                        <nav className="nav-container" role="navigation" aria-label="Hoofdnavigatie">
              <div className="nav-primary">
                <div className="nav-brand">
                  <div
                    className="nav-logo-stack"
                    role="button"
                    tabIndex={0}
                    onClick={playLogoSound}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        playLogoSound()
                      }
                    }}
                  >
                    <img
                      src="/stam_H.png"
                      alt="Stamjer Logo"
                      className="nav-logo"
                      draggable="false"
                    />
                    <span
                      className="nav-version"
                      aria-label={`Applicatie versie ${APP_VERSION}`}
                    >
                      v{APP_VERSION}
                    </span>
                  </div>
                  <h1 className="nav-title">{ROUTE_LABELS[normalizedPathname] || 'Stamjer'}</h1>

                  {user && <NotificationCenter user={user} />}
                </div>
              </div>

              <button
                type="button"
                className="mobile-menu-toggle"
                onClick={toggleMobileMenu}
                aria-label="Menu openen/sluiten"
                aria-expanded={isMobileMenuOpen}
                aria-controls="primary-navigation"
              >
                <span className={`hamburger ${isMobileMenuOpen ? 'open' : ''}`}>
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              </button>

              <div
                id="primary-navigation"
                className={`nav-menu${isMobileMenuOpen ? ' mobile-open' : ''}`}
              >
                <div className="nav-menu-header">
                  <span className="nav-menu-title">Navigatie</span>
                  {user && (
                    <div className="nav-user-chip" role="group" aria-label="Gebruikersinformatie">
                      <span className="nav-user-name">{user.firstName}</span>
                      <span className="nav-user-role">{user.isAdmin ? 'Administrator' : 'Lid'}</span>
                    </div>
                  )}
                </div>

                <div className="nav-menu-links">
                  {navMenuItems.map((item) => {
                    const Icon = item.icon
                    const variantClass = item.variant === 'primary' ? 'btn-primary' : 'btn-secondary'

                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          `btn ${variantClass} nav-btn${isActive ? ' active' : ''}`
                        }
                        aria-label={`Ga naar ${item.label.toLowerCase()}`}
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        {Icon && (
                          <span className="nav-btn-icon" aria-hidden="true">
                            <Icon />
                          </span>
                        )}
                        <span className="nav-btn-text">{item.label}</span>
                        <span className="nav-btn-chevron" aria-hidden="true">&rsaquo;</span>
                      </NavLink>
                    )
                  })}
                </div>
              </div>

            </nav>
            {isMobileMenuOpen && (
              <button
                type="button"
                className="nav-overlay"
                aria-label="Mobiele navigatie sluiten"
                onClick={toggleMobileMenu}
              />
            )}
            </>
          )}

          {/* Application Routes */}

          <main id="main" role="main">
            <Suspense fallback={<div className="page-loading" aria-live="polite">Laden...</div>}>
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
                } />
                <Route path="/opkomsten" element={
                  <ProtectedRoute user={user}>
                    <PageErrorBoundary pageName="Opkomsten">
                      <OpkomstenPage />
                    </PageErrorBoundary>
                  </ProtectedRoute>
                } />
                <Route path="/declaraties" element={
                  <ProtectedRoute user={user}>
                    <PageErrorBoundary pageName="Declaraties">
                      <PaymentRequestPage user={user} />
                    </PageErrorBoundary>
                  </ProtectedRoute>
                } />
                <Route path="/strepen" element={
                  <ProtectedRoute user={user}>
                    <PageErrorBoundary pageName="Strepen">
                      {user && user.isAdmin ? <StrepenPage /> : <div>Alleen toegankelijk voor admins. Dus niet voor plebs zoals jij...</div>}
                    </PageErrorBoundary>
                  </ProtectedRoute>
                } />
                <Route path="/account" element={
                  <ProtectedRoute user={user}>
                    <PageErrorBoundary pageName="My Account">
                      <MyAccount user={user} onLogout={handleLogout} />
                    </PageErrorBoundary>
                  </ProtectedRoute>
                } />
                <Route path="/meldingen" element={
                  <ProtectedRoute user={user}>
                    <PageErrorBoundary pageName="Meldingen">
                      <NotificationsPage user={user} />
                    </PageErrorBoundary>
                  </ProtectedRoute>
                } />
                <Route path="/meldingen/beheer" element={
                  <ProtectedRoute user={user}>
                    <PageErrorBoundary pageName="Meldingbeheer">
                      <NotificationAdminPage user={user} />
                    </PageErrorBoundary>
                  </ProtectedRoute>
                } />
                <Route path="*" element={
                  <PageErrorBoundary pageName="404">
                    <NotFound />
                  </PageErrorBoundary>
                } />
              </Routes>
            </Suspense>
          </main>

          {!shouldHideNavigation && user && mobileNavItems.length > 0 && (
            <nav className="bottom-nav" aria-label="Snelle navigatie">
              {mobileNavItems.map((item) => {
                const Icon = item.icon

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `bottom-nav-link${isActive ? ' is-active' : ''}`
                    }
                    aria-label={item.label}
                    data-label={item.label}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {Icon && (
                      <span className="bottom-nav-icon" aria-hidden="true">
                        <Icon />
                      </span>
                    )}
                    <span className="bottom-nav-label" aria-hidden="true">
                      {item.label}
                    </span>
                  </NavLink>
                )
              })}
            </nav>
          )}
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

export default React.memo(App)














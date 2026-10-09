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
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { APP_VERSION } from './config/appInfo'


// Component imports
import ProtectedRoute from './components/ProtectedRoute'
import { AppErrorBoundary, PageErrorBoundary, setupGlobalErrorHandling } from './components/ErrorBoundary'
import { ToastProvider } from './hooks/useToast'
import { CalendarIcon, ClipboardIcon, EuroIcon, TrophyIcon, UserIcon, LoginIcon } from './components/icons'
import { Database as DatabaseIcon } from 'lucide-react'
import PullToRefresh from './components/PullToRefresh'

// Query client configuration
import { queryClient } from './lib/queryClient'
import { performHardReset } from './lib/hardReset'
import { canUsePaymentRequests, canUseStreepjes, getAuthenticatedLandingPath, isNonAdminAlumni } from './lib/authRouting'
import { isAdmin, isDeveloper } from '../shared/roles'
import { getCurrentSession, logout as logoutSession } from './services/api'
import { setGroupContext, hasPendingGroupWrites } from './lib/groupContext'

// Import styles
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
const NotFound = lazy(() => import('./pages/NotFound'))
const DeveloperPage = lazy(() => import('./pages/DeveloperPage'))

const ROUTE_LABELS = {
  '/': 'Login',
  '/login': 'Login',
  '/forgot-password': 'Wachtwoord herstellen',
  '/kalender': 'Kalender',
  '/opkomsten': 'Opkomsten',
  '/declaraties': 'Declaraties',
  '/strepen': 'Strepen',
  '/account': 'Account',
  '/developer': 'Beheer',
  '/developer/database': 'Database',
  '/developer/account': 'Account',
}

const NAV_ICON_MAP = {
  '/kalender': CalendarIcon,
  '/opkomsten': ClipboardIcon,
  '/declaraties': EuroIcon,
  '/strepen': TrophyIcon,
  '/account': UserIcon,
  '/developer': UserIcon,
  '/login': LoginIcon,
  '/': LoginIcon,
}

const DEVELOPER_NAV_ITEMS = [
  { to: '/developer', label: 'Beheer', icon: ClipboardIcon, variant: 'secondary' },
  { to: '/developer/database', label: 'Database', icon: DatabaseIcon, variant: 'secondary' },
  { to: '/developer/account', label: 'Account', icon: UserIcon, variant: 'secondary' },
]

function AlumniRestrictedRoute({ user, children }) {
  if (isDeveloper(user)) return <Navigate to="/developer" replace />
  if (user?.memberships && !user.groupId) return <Navigate to="/account" replace />
  if (isNonAdminAlumni(user)) {
    return <Navigate to={getAuthenticatedLandingPath(user)} replace />
  }

  return children
}

function AuthEntryRoute({ user, setUser }) {
  const landingPath = getAuthenticatedLandingPath(user)
  if (landingPath) return <Navigate to={landingPath} replace />
  return <Login setUser={setUser} />
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
  const userScopeRef = useRef('anonymous')
  const updateAuthenticatedUser = useCallback((nextUser) => {
    if (nextUser?.memberships && !isDeveloper(nextUser)) {
      const preferred = localStorage.getItem(`selected-group:${nextUser.id}`)
      const selected = nextUser.memberships.find(m => m.groupId === preferred) || nextUser.memberships.find(m => m.state === 'current') || nextUser.memberships[0]
      nextUser = { ...nextUser, groupId: selected?.groupId || null, groupName: selected?.group?.name || '', membershipId: selected?.id || null, membershipState: selected?.state || null,
        role: selected?.state === 'current' ? selected.role : 'user', isAdmin: selected?.state === 'current' && selected.role === 'admin',
        status: selected?.state === 'ended' ? 'alumni' : selected?.status || 'inactive', permissions: selected?.permissions || { canUsePaymentRequests: false, canUseStreepjes: false, canUseAttendance: false, canManageUsers: false } }
      if (selected) localStorage.setItem(`selected-group:${nextUser.id}`, selected.groupId)
    }
    const nextScope = nextUser ? `${nextUser.id}:${nextUser.groupId}:${nextUser.role}:${nextUser.membershipState}` : 'anonymous'
    if (userScopeRef.current !== nextScope) {
      // Cancel in-flight reads and remove the previous account/group's data.
      queryClient.clear()
      userScopeRef.current = nextScope
    }
    setGroupContext(nextUser)
    if (nextUser) localStorage.setItem('user', JSON.stringify(nextUser))
    setUser(nextUser)
  }, [])
  const switchGroup = event => {
    if (queryClient.isMutating() || hasPendingGroupWrites()) return
    if (!window.confirm('Van groep wisselen? Niet-opgeslagen wijzigingen in open formulieren blijven niet behouden.')) return
    localStorage.setItem(`selected-group:${user.id}`, event.target.value)
    updateAuthenticatedUser(user)
    setIsMobileMenuOpen(false)
  }
  
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
    } catch {
      // Ignore audio setup errors; playback will fallback to constructing on demand
    }
    return () => {
      if (clickSoundRef.current) {
        try {
          clickSoundRef.current.pause()
        } catch {
          // Ignore cleanup errors from browsers that block media operations.
        }
        clickSoundRef.current = null
      }
    }
  }, [])
  
  /**
   * Load the secure cookie-backed session on component mount.
   * localStorage is only a display cache; the server decides whether the session is valid.
   */
  useEffect(() => {
    let cancelled = false
    const refreshUser = async ({ initial = false } = {}) => {
      try {
        const data = await getCurrentSession()
        if (cancelled) return
        if (data?.user && (data.user.email || data.user.id)) {
          localStorage.setItem('user', JSON.stringify(data.user))
          updateAuthenticatedUser(data.user)
        } else {
          localStorage.removeItem('user')
          updateAuthenticatedUser(null)
        }
      } catch (error) {
        if (cancelled) return
        if (error?.status !== 401) {
          console.error('Error loading authenticated session:', error)
        } else {
          localStorage.removeItem('user')
          updateAuthenticatedUser(null)
        }
      } finally {
        if (initial && !cancelled) setIsInitializing(false)
      }
    }

    refreshUser({ initial: true })
    const intervalId = window.setInterval(() => refreshUser(), 15_000)
    const handleFocus = () => refreshUser()
    window.addEventListener('focus', handleFocus)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
    }
  }, [updateAuthenticatedUser])

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
  const handleLogout = useCallback(async () => {
    try {
      await logoutSession()
      localStorage.removeItem('user')
      updateAuthenticatedUser(null)
      navigate('/login')
      setIsMobileMenuOpen(false) // Close mobile menu on logout
    } catch (error) {
      console.error('Error during logout:', error)
      // Force logout even if there's an error
      localStorage.removeItem('user')
      updateAuthenticatedUser(null)
      navigate('/login')
      setIsMobileMenuOpen(false)
    }
  }, [navigate, updateAuthenticatedUser])

  /**
   * Handle user login
   * Updates user state and saves to localStorage
   */
  const handleLogin = useCallback((userData) => {
    try {
      localStorage.setItem('user', JSON.stringify(userData))
      updateAuthenticatedUser(userData)
    } catch (error) {
      console.error('Error saving user to localStorage:', error)
      // Still set user in state even if localStorage fails
      updateAuthenticatedUser(userData)
    }
  }, [updateAuthenticatedUser])

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
      try { audio.pause() } catch { /* Ignore playback reset errors */ }
      try { audio.currentTime = 0 } catch { /* Ignore playback reset errors */ }
      const p = audio.play()
      if (p && typeof p.catch === 'function') {
        p.catch(() => { /* Ignore user-gesture or interruption errors */ })
      }
    } catch {
      // Ignore audio errors; the logo action should never block navigation.
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
    if (isDeveloper(user)) return DEVELOPER_NAV_ITEMS
    const baseItems = []

    if (user?.groupId && user?.memberships) baseItems.push({ to: '/kalender', label: ROUTE_LABELS['/kalender'], icon: NAV_ICON_MAP['/kalender'], variant: 'secondary' })
    if (!isNonAdminAlumni(user) && (!user?.memberships || user.groupId)) {
      baseItems.push(
        ...(!user?.memberships ? [{
          to: '/kalender',
          label: ROUTE_LABELS['/kalender'],
          icon: NAV_ICON_MAP['/kalender'],
          variant: 'secondary',
        }] : []),
        {
          to: '/opkomsten',
          label: ROUTE_LABELS['/opkomsten'],
          icon: NAV_ICON_MAP['/opkomsten'],
          variant: 'secondary',
        }
      )
    }

    if (canUsePaymentRequests(user)) baseItems.push(
      {
        to: '/declaraties',
        label: ROUTE_LABELS['/declaraties'],
        icon: NAV_ICON_MAP['/declaraties'],
        variant: 'secondary',
      }
    )

    if (isAdmin(user) && !isNonAdminAlumni(user) && canUseStreepjes(user)) {
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
    if (isDeveloper(user)) return DEVELOPER_NAV_ITEMS
    if (!user) {
      return []
    }

    const items = []

    if (user.groupId && user.memberships) items.push({ to: '/kalender', label: ROUTE_LABELS['/kalender'], icon: NAV_ICON_MAP['/kalender'] })
    if (!isNonAdminAlumni(user) && (!user.memberships || user.groupId)) {
      items.push(
        ...(!user.memberships ? [{
          to: '/kalender',
          label: ROUTE_LABELS['/kalender'],
          icon: NAV_ICON_MAP['/kalender'],
        }] : []),
        {
          to: '/opkomsten',
          label: ROUTE_LABELS['/opkomsten'],
          icon: NAV_ICON_MAP['/opkomsten'],
        }
      )
    }

    if (canUsePaymentRequests(user)) items.push(
      {
        to: '/declaraties',
        label: ROUTE_LABELS['/declaraties'],
        icon: NAV_ICON_MAP['/declaraties'],
      }
    )

    if (isAdmin(user) && !isNonAdminAlumni(user) && canUseStreepjes(user)) {
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
                      <span className="nav-user-role">{isDeveloper(user) ? 'Developer' : isAdmin(user) ? 'Beheerder' : 'Lid'}</span>
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
                        end
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

          <main id="main" role="main" className={user ? 'app-main-authenticated' : undefined}>
            <Suspense fallback={<div className="page-loading" aria-live="polite">Laden...</div>}>
              <Routes key={`${user?.id}:${user?.groupId}:${user?.role}:${user?.membershipState}`}>
                {/* Public Routes - Available to all users */}
                <Route path="/" element={
                  <PageErrorBoundary pageName="Login">
                    <AuthEntryRoute user={user} setUser={handleLogin} />
                  </PageErrorBoundary>
                } />
                <Route path="/login" element={
                  <PageErrorBoundary pageName="Login">
                    <AuthEntryRoute user={user} setUser={handleLogin} />
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
                    {(user?.memberships && !user.groupId) || (!user?.memberships && isNonAdminAlumni(user)) ? <Navigate to={getAuthenticatedLandingPath(user)} replace /> : <>
                      <PageErrorBoundary pageName="Calendar">
                        <CalendarPage user={user} />
                      </PageErrorBoundary>
                    </>}
                  </ProtectedRoute>
                } />
                <Route path="/opkomsten" element={
                  <ProtectedRoute user={user}>
                    <AlumniRestrictedRoute user={user}>
                      <PageErrorBoundary pageName="Opkomsten">
                        <OpkomstenPage user={user} />
                      </PageErrorBoundary>
                    </AlumniRestrictedRoute>
                  </ProtectedRoute>
                } />
                <Route path="/declaraties" element={
                  <ProtectedRoute user={user}>
                    <PageErrorBoundary pageName="Declaraties">
                      {canUsePaymentRequests(user) ? <PaymentRequestPage user={user} /> : <Navigate to={getAuthenticatedLandingPath(user)} replace />}
                    </PageErrorBoundary>
                  </ProtectedRoute>
                } />
                <Route path="/strepen" element={
                  <ProtectedRoute user={user}>
                    <AlumniRestrictedRoute user={user}>
                      <PageErrorBoundary pageName="Strepen">
                        {!canUseStreepjes(user) ? <Navigate to={getAuthenticatedLandingPath(user)} replace /> : isAdmin(user) ? <StrepenPage user={user} /> : <div>Alleen toegankelijk voor admins.</div>}
                      </PageErrorBoundary>
                    </AlumniRestrictedRoute>
                  </ProtectedRoute>
                } />
                <Route path="/account" element={
                  <ProtectedRoute user={user}>
                    <PageErrorBoundary pageName="My Account">
                      {isDeveloper(user) ? <Navigate to="/developer/account" replace /> : <MyAccount user={user} onLogout={handleLogout} onGroupChange={switchGroup} />}
                    </PageErrorBoundary>
                  </ProtectedRoute>
                } />
                <Route path="/developer/*" element={
                  <ProtectedRoute user={user}>
                    <PageErrorBoundary pageName="Developer">
                      {isDeveloper(user) ? <DeveloperPage user={user} onLogout={handleLogout} /> : <Navigate to={getAuthenticatedLandingPath(user)} replace />}
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
                    end
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














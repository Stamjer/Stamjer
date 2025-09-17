/**
 * ================================================================
 * PROFESSIONAL ERROR BOUNDARY COMPONENTS
 * ================================================================
 * 
 * Comprehensive error boundary system for production-ready
 * error handling and user experience.
 * 
 * Features:
 * - Different error boundaries for different app sections
 * - Error reporting and logging
 * - Graceful fallback UIs
 * - Development vs production behavior
 * - Error recovery mechanisms
 * 
 * @author Stamjer Development Team
 * @version 1.3.0
 */

import React from 'react'
import { withSupportContact } from '../config/appInfo'

// ================================================================
// BASE ERROR BOUNDARY CLASS
// ================================================================

/**
 * Base error boundary with comprehensive error handling
 */
class BaseErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      eventId: null
    }
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { 
      hasError: true, 
      error,
      eventId: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error Boundary caught an error:', error, errorInfo)
    
    this.setState({
      error,
      errorInfo
    })

    // Report error to monitoring service in production
    this.reportError(error, errorInfo)
  }

  reportError = (error, errorInfo) => {
    const { onError, context } = this.props
    
    const errorReport = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo?.componentStack,
      context: context || 'Unknown',
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      eventId: this.state.eventId
    }

    // Call custom error handler if provided
    if (onError) {
      try {
        onError(errorReport)
      } catch (reportingError) {
        console.error('Error in error reporting:', reportingError)
      }
    }

    // In development, log detailed error info
    if (import.meta.env.DEV) {
      console.group('🚨 Error Boundary Report')
      console.error('Error:', error)
      console.error('Error Info:', errorInfo)
      console.error('Full Report:', errorReport)
      console.groupEnd()
    }

    // In production, you could send to error reporting service
    // Example: Sentry, LogRocket, etc.
    if (import.meta.env.PROD) {
      // window.errorReportingService?.captureException(error, errorReport)
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      eventId: null
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const { fallback, level = 'component' } = this.props
      
      // Use custom fallback if provided
      if (fallback) {
        return fallback(this.state.error, this.handleRetry, this.handleReload)
      }
      
      // Default fallback based on error level
      return this.renderDefaultFallback(level)
    }

    return this.props.children
  }

  renderDefaultFallback = (level) => {
    const { error, eventId } = this.state
    
    const baseStyles = {
      component: 'error-boundary-component',
      page: 'error-boundary-page', 
      app: 'error-boundary-app'
    }

    const baseMessage = level === 'app' ?
      'Er is een kritieke fout opgetreden. De applicatie kan niet verder laden.' :
      level === 'page' ?
      'Er is een fout opgetreden op deze pagina. Je kunt proberen om de pagina te verversen.' :
      'Er is een fout opgetreden in dit onderdeel. Je kunt proberen om het opnieuw te laden.'
    const supportMessage = withSupportContact(baseMessage)

    return (
      <div className={`error-boundary ${baseStyles[level]}`}>
        <div className="error-content">
          <div className="error-icon">
            {level === 'app' ? '💥' : level === 'page' ? '⚠️' : '🔧'}
          </div>
          
          <h2 className="error-title">
            {level === 'app' ? 'Applicatie Error' : 
             level === 'page' ? 'Pagina Error' : 'Component Error'}
          </h2>
          
          <p className="error-message">{supportMessage}</p>

          {import.meta.env.DEV && (
            <details className="error-details">
              <summary>Technische details (alleen in ontwikkeling)</summary>
              <pre className="error-stack">
                {error?.message}
                {'\n\n'}
                {error?.stack}
              </pre>
            </details>
          )}

          <div className="error-actions">
            {level === 'component' && (
              <button 
                onClick={this.handleRetry}
                className="btn btn-primary error-btn"
              >
                🔄 Probeer opnieuw
              </button>
            )}
            
            <button 
              onClick={this.handleReload}
              className="btn btn-secondary error-btn"
            >
              🔄 Pagina verversen
            </button>

            {import.meta.env.DEV && eventId && (
              <span className="error-id">
                Event ID: {eventId}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }
}

// ================================================================
// SPECIFIC ERROR BOUNDARY COMPONENTS
// ================================================================

/**
 * App-level error boundary for critical errors
 */
export function AppErrorBoundary({ children, onError }) {
  return (
    <BaseErrorBoundary 
      level="app" 
      context="Application"
      onError={onError}
    >
      {children}
    </BaseErrorBoundary>
  )
}

/**
 * Page-level error boundary for page-specific errors
 */
export function PageErrorBoundary({ children, pageName, onError }) {
  return (
    <BaseErrorBoundary 
      level="page" 
      context={`Page: ${pageName}`}
      onError={onError}
    >
      {children}
    </BaseErrorBoundary>
  )
}

/**
 * Component-level error boundary for isolated component errors
 */
export function ComponentErrorBoundary({ children, componentName, onError, fallback }) {
  return (
    <BaseErrorBoundary 
      level="component" 
      context={`Component: ${componentName}`}
      onError={onError}
      fallback={fallback}
    >
      {children}
    </BaseErrorBoundary>
  )
}

/**
 * Calendar-specific error boundary
 */
export function CalendarErrorBoundary({ children, onError }) {
  const calendarFallback = (error, retry, reload) => (
    <div className="calendar-error-fallback">
      <div className="calendar-error-content">
        <h3>📅 Kalender Fout</h3>
        <p>{withSupportContact('De kalender kon niet geladen worden. Dit kan komen door een tijdelijke serverfout.')}</p>
        
        <div className="calendar-error-actions">
          <button onClick={retry} className="btn btn-primary">
            🔄 Kalender opnieuw laden
          </button>
          <button onClick={reload} className="btn btn-secondary">
            🔄 Hele pagina verversen
          </button>
        </div>

        {import.meta.env.DEV && (
          <details className="error-details">
            <summary>Fout details</summary>
            <pre>{error?.message}\n\n{error?.stack}</pre>
          </details>
        )}
      </div>
    </div>
  )

  return (
    <BaseErrorBoundary 
      level="component"
      context="Calendar Component"
      onError={onError}
      fallback={calendarFallback}
    >
      {children}
    </BaseErrorBoundary>
  )
}

/**
 * Form-specific error boundary
 */
export function FormErrorBoundary({ children, formName, onError }) {
  const formFallback = (error, retry) => (
    <div className="form-error-fallback">
      <div className="form-error-content">
        <h4>📝 Formulier Fout</h4>
        <p>{withSupportContact(`Er is een fout opgetreden in het ${formName} formulier.`)}</p>
        
        <button onClick={retry} className="btn btn-primary btn-sm">
          🔄 Formulier opnieuw laden
        </button>

        {import.meta.env.DEV && (
          <details className="error-details">
            <summary>Fout details</summary>
            <pre>{error?.message}</pre>
          </details>
        )}
      </div>
    </div>
  )

  return (
    <BaseErrorBoundary 
      level="component"
      context={`Form: ${formName}`}
      onError={onError}
      fallback={formFallback}
    >
      {children}
    </BaseErrorBoundary>
  )
}

// ================================================================
// ASYNC ERROR BOUNDARY HOOK
// ================================================================

/**
 * Hook for catching async errors in React components
 * Since error boundaries only catch errors in render methods,
 * we need this for async operations
 */
export function useAsyncError() {
  const [, setError] = React.useState()
  
  return React.useCallback((error) => {
    console.error('Async error caught:', error)
    
    // Force React to re-render and trigger error boundary
    setError(() => {
      throw error
    })
  }, [])
}

/**
 * Higher-order component to wrap components with error boundary
 */
export function withErrorBoundary(Component, errorBoundaryProps = {}) {
  const WrappedComponent = (props) => (
    <ComponentErrorBoundary 
      componentName={Component.displayName || Component.name}
      {...errorBoundaryProps}
    >
      <Component {...props} />
    </ComponentErrorBoundary>
  )
  
  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`
  
  return WrappedComponent
}

// ================================================================
// ERROR REPORTING UTILITIES
// ================================================================

/**
 * Global error handler for unhandled promise rejections
 */
export function setupGlobalErrorHandling() {
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason)
    
    // Prevent the default browser behavior
    event.preventDefault()
    
    // You could report this to your error monitoring service
    const errorReport = {
      type: 'unhandledrejection',
      reason: event.reason,
      timestamp: new Date().toISOString(),
      url: window.location.href
    }
    
    if (import.meta.env.DEV) {
      console.warn('Unhandled Promise Rejection:', errorReport)
    }
  })

  // Handle general JavaScript errors
  window.addEventListener('error', (event) => {
    console.error('Global JavaScript error:', event.error)
    
    const errorReport = {
      type: 'javascript',
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
      timestamp: new Date().toISOString(),
      url: window.location.href
    }
    
    if (import.meta.env.DEV) {
      console.warn('Global JavaScript Error:', errorReport)
    }
  })
}

// ================================================================
// DEFAULT EXPORT
// ================================================================

export default BaseErrorBoundary
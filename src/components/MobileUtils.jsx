/**
 * Mobile Utilities and Enhancements
 * Provides mobile-specific functionality and UI improvements
 */

import { useEffect, useState, useCallback } from 'react'

/**
 * Enhanced hook to detect if user is on a mobile device
 */
export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkIsMobile = () => {
      const width = window.innerWidth
      const userAgent = navigator.userAgent
      const isMobileWidth = width <= 768
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
      setIsMobile(isMobileWidth || isMobileDevice)
      
      // Add mobile class to body for CSS targeting
      if (isMobileWidth || isMobileDevice) {
        document.body.classList.add('is-mobile')
      } else {
        document.body.classList.remove('is-mobile')
      }
    }

    checkIsMobile()
    window.addEventListener('resize', checkIsMobile)
    return () => {
      window.removeEventListener('resize', checkIsMobile)
      document.body.classList.remove('is-mobile')
    }
  }, [])

  return isMobile
}

/**
 * Force light mode on mobile devices
 */
export const useForceLightMode = () => {
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    
    const updateColorScheme = (e) => {
      if (e.matches) {
        // Force light mode on mobile
        document.documentElement.style.setProperty('color-scheme', 'light')
        document.body.setAttribute('data-theme', 'light')
      } else {
        // Allow normal color scheme on desktop
        document.documentElement.style.removeProperty('color-scheme')
        document.body.removeAttribute('data-theme')
      }
    }

    updateColorScheme(mediaQuery)
    mediaQuery.addEventListener('change', updateColorScheme)

    return () => {
      mediaQuery.removeEventListener('change', updateColorScheme)
      document.documentElement.style.removeProperty('color-scheme')
      document.body.removeAttribute('data-theme')
    }
  }, [])
}

/**
 * Hook for pull-to-refresh functionality
 */
export const usePullToRefresh = (onRefresh) => {
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    let startY = 0
    let currentY = 0
    let isAtTop = false

    const handleTouchStart = (e) => {
      startY = e.touches[0].clientY
      isAtTop = window.scrollY === 0
    }

    const handleTouchMove = (e) => {
      if (!isAtTop) return
      
      currentY = e.touches[0].clientY
      const diffY = currentY - startY

      if (diffY > 100 && !isRefreshing) {
        setIsRefreshing(true)
        onRefresh?.()
        setTimeout(() => setIsRefreshing(false), 2000)
      }
    }

    const handleTouchEnd = () => {
      startY = 0
      currentY = 0
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: true })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [onRefresh, isRefreshing])

  return isRefreshing
}

/**
 * Hook for swipe gestures
 */
export const useSwipeGesture = (onSwipeLeft, onSwipeRight) => {
  useEffect(() => {
    let startX = 0
    let startY = 0
    let endX = 0
    let endY = 0

    const handleTouchStart = (e) => {
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }

    const handleTouchEnd = (e) => {
      endX = e.changedTouches[0].clientX
      endY = e.changedTouches[0].clientY

      const diffX = endX - startX
      const diffY = endY - startY

      // Check if it's a horizontal swipe (more horizontal than vertical)
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
        if (diffX > 0) {
          onSwipeRight?.()
        } else {
          onSwipeLeft?.()
        }
      }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [onSwipeLeft, onSwipeRight])
}

/**
 * Hook to handle device orientation changes
 */
export const useOrientation = () => {
  const [orientation, setOrientation] = useState('portrait')

  useEffect(() => {
    const handleOrientationChange = () => {
      const isLandscape = window.innerWidth > window.innerHeight
      setOrientation(isLandscape ? 'landscape' : 'portrait')
    }

    handleOrientationChange()
    window.addEventListener('resize', handleOrientationChange)
    window.addEventListener('orientationchange', handleOrientationChange)

    return () => {
      window.removeEventListener('resize', handleOrientationChange)
      window.removeEventListener('orientationchange', handleOrientationChange)
    }
  }, [])

  return orientation
}

/**
 * Touch-friendly Button Component
 */
export const TouchButton = ({ 
  children, 
  onClick, 
  className = '', 
  variant = 'primary',
  size = 'medium',
  disabled = false,
  ...props 
}) => {
  const [isPressed, setIsPressed] = useState(false)

  const handleTouchStart = useCallback(() => {
    if (!disabled) {
      setIsPressed(true)
    }
  }, [disabled])

  const handleTouchEnd = useCallback(() => {
    setIsPressed(false)
  }, [])

  const baseClasses = `
    btn btn-${variant} touch-button
    ${size === 'large' ? 'btn-large' : size === 'small' ? 'btn-small' : ''}
    ${isPressed ? 'btn-pressed' : ''}
    ${className}
  `.trim()

  return (
    <button
      className={baseClasses}
      onClick={onClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * Mobile-optimized Modal Component
 */
export const MobileModal = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  className = '',
  showCloseButton = true 
}) => {
  const isMobile = useIsMobile()

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  if (!isOpen) return null

  const modalClasses = `
    modal mobile-modal
    ${isMobile ? 'modal-mobile' : ''}
    ${className}
  `.trim()

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={modalClasses} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="modal-header">
            <h2 className="modal-title">{title}</h2>
            {showCloseButton && (
              <TouchButton
                variant="ghost"
                size="small"
                onClick={onClose}
                className="modal-close-btn"
                aria-label="Sluiten"
              >
                ✕
              </TouchButton>
            )}
          </div>
        )}
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Mobile-optimized Input Component
 */
export const MobileInput = ({ 
  type = 'text', 
  placeholder, 
  value, 
  onChange, 
  className = '',
  autoFocus = false,
  ...props 
}) => {
  const inputClasses = `
    form-input mobile-input
    ${className}
  `.trim()

  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className={inputClasses}
      autoFocus={autoFocus}
      inputMode={type === 'email' ? 'email' : type === 'tel' ? 'tel' : 'text'}
      {...props}
    />
  )
}

/**
 * Utility function to prevent zoom on iOS double-tap
 */
export const preventZoom = () => {
  let lastTouchEnd = 0
  
  document.addEventListener('touchend', (event) => {
    const now = (new Date()).getTime()
    if (now - lastTouchEnd <= 300) {
      event.preventDefault()
    }
    lastTouchEnd = now
  }, false)
}

/**
 * Utility to add haptic feedback on supported devices
 */
export const hapticFeedback = (type = 'light') => {
  if (navigator.vibrate) {
    const patterns = {
      light: 10,
      medium: 20,
      heavy: 30,
      success: [10, 50, 10],
      error: [100, 30, 100]
    }
    navigator.vibrate(patterns[type] || patterns.light)
  }
}

export default {
  useIsMobile,
  useForceLightMode,
  usePullToRefresh,
  useSwipeGesture,
  useOrientation,
  TouchButton,
  MobileModal,
  MobileInput,
  preventZoom,
  hapticFeedback
}

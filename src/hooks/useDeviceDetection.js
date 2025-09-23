import { useState, useEffect } from 'react'

/**
 * Professional device detection hook that combines multiple methods:
 * 1. User Agent detection for mobile devices
 * 2. Touch capability detection
 * 3. Screen size as fallback
 * 4. Responsive breakpoint matching
 */
export const useDeviceDetection = () => {
  const [deviceInfo, setDeviceInfo] = useState(() => {
    if (typeof window === 'undefined') {
      return {
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        hasTouch: false,
        userAgent: '',
        screenSize: 'desktop'
      }
    }

    return detectDevice()
  })

  function detectDevice() {
    const userAgent = navigator.userAgent.toLowerCase()
    
    // Mobile device patterns (more comprehensive)
    const mobilePatterns = [
      /android/i,
      /webos/i,
      /iphone/i,
      /ipad/i,
      /ipod/i,
      /blackberry/i,
      /windows phone/i,
      /mobile/i,
      /opera mini/i,
      /iemobile/i
    ]

    // Tablet specific patterns
    const tabletPatterns = [
      /ipad/i,
      /android(?=.*tablet)/i,
      /windows tablet/i,
      /kindle/i,
      /silk/i,
      /playbook/i
    ]

    // Check for touch capability
    const hasTouch = (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      navigator.msMaxTouchPoints > 0
    )

    // User agent based detection
    const isMobileUA = mobilePatterns.some(pattern => pattern.test(userAgent))
    const isTabletUA = tabletPatterns.some(pattern => pattern.test(userAgent))

    // Screen size detection (as fallback)
    const screenWidth = window.innerWidth
    const isMobileScreen = screenWidth < 768
    const isTabletScreen = screenWidth >= 768 && screenWidth < 1024
    const isDesktopScreen = screenWidth >= 1024

    // Media query detection
    const mobileMediaQuery = window.matchMedia('(max-width: 767px)')
    const tabletMediaQuery = window.matchMedia('(min-width: 768px) and (max-width: 1023px)')
    
    // Determine device type with priority: UA > Touch + Screen > Screen only
    let isMobile = false
    let isTablet = false
    let isDesktop = false
    let screenSize = 'desktop'

    if (isMobileUA) {
      isMobile = true
      screenSize = 'mobile'
    } else if (isTabletUA) {
      isTablet = true
      screenSize = 'tablet'
    } else if (hasTouch && isMobileScreen) {
      isMobile = true
      screenSize = 'mobile'
    } else if (hasTouch && isTabletScreen) {
      isTablet = true
      screenSize = 'tablet'
    } else if (mobileMediaQuery.matches) {
      isMobile = true
      screenSize = 'mobile'
    } else if (tabletMediaQuery.matches) {
      isTablet = true
      screenSize = 'tablet'
    } else {
      isDesktop = true
      screenSize = 'desktop'
    }

    return {
      isMobile,
      isTablet,
      isDesktop,
      hasTouch,
      userAgent,
      screenSize,
      screenWidth,
      // Additional helpful properties
      isTouchDevice: hasTouch,
      isSmallScreen: mobileMediaQuery.matches,
      isMediumScreen: tabletMediaQuery.matches,
      isLargeScreen: isDesktopScreen
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleResize = () => {
      setDeviceInfo(detectDevice())
    }

    const handleOrientationChange = () => {
      // Delay to ensure accurate dimensions after orientation change
      setTimeout(() => {
        setDeviceInfo(detectDevice())
      }, 100)
    }

    // Listen for resize events
    window.addEventListener('resize', handleResize)
    
    // Listen for orientation changes (mobile devices)
    window.addEventListener('orientationchange', handleOrientationChange)

    // Media query listeners for responsive breakpoints
    const mobileMediaQuery = window.matchMedia('(max-width: 767px)')
    const tabletMediaQuery = window.matchMedia('(min-width: 768px) and (max-width: 1023px)')

    const handleMobileChange = () => setDeviceInfo(detectDevice())
    const handleTabletChange = () => setDeviceInfo(detectDevice())

    // Add media query listeners
    if (mobileMediaQuery.addEventListener) {
      mobileMediaQuery.addEventListener('change', handleMobileChange)
      tabletMediaQuery.addEventListener('change', handleTabletChange)
    } else {
      // Fallback for older browsers
      mobileMediaQuery.addListener(handleMobileChange)
      tabletMediaQuery.addListener(handleTabletChange)
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleOrientationChange)
      
      if (mobileMediaQuery.removeEventListener) {
        mobileMediaQuery.removeEventListener('change', handleMobileChange)
        tabletMediaQuery.removeEventListener('change', handleTabletChange)
      } else {
        mobileMediaQuery.removeListener(handleMobileChange)
        tabletMediaQuery.removeListener(handleTabletChange)
      }
    }
  }, [])

  return deviceInfo
}

/**
 * Simplified hook that just returns isMobile for backward compatibility
 */
export const useIsMobile = () => {
  const { isMobile } = useDeviceDetection()
  return isMobile
}

/**
 * Hook for responsive breakpoints
 */
export const useBreakpoint = () => {
  const { screenSize, isSmallScreen, isMediumScreen, isLargeScreen } = useDeviceDetection()
  
  return {
    current: screenSize,
    isSmall: isSmallScreen,  // mobile
    isMedium: isMediumScreen, // tablet
    isLarge: isLargeScreen,   // desktop
    // Semantic aliases
    isMobile: isSmallScreen,
    isTablet: isMediumScreen,
    isDesktop: isLargeScreen
  }
}

export default useDeviceDetection
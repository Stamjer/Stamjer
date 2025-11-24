import { useEffect, useRef, useState } from 'react'

/**
 * Lightweight, mobile-first pull-to-refresh detection.
 * Listens for downward touch drags from the top of the page and
 * calls onRefresh once the gesture crosses the configured threshold.
 */
export function usePullToRefresh({
  enabled = true,
  threshold = 120,
  maxPull = 200,
  damping = 0.65,
  onRefresh,
} = {}) {
  const [pullDistance, setPullDistance] = useState(0)
  const [status, setStatus] = useState('idle') // idle | pulling | ready | refreshing

  const startYRef = useRef(null)
  const isPullingRef = useRef(false)
  const distanceRef = useRef(0)
  const hasTriggeredRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setPullDistance(0)
      setStatus('idle')
      return
    }

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

    const getScrollTop = () => {
      return (
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement?.scrollTop ||
        document.body?.scrollTop ||
        0
      )
    }

    const resetState = () => {
      startYRef.current = null
      isPullingRef.current = false
      distanceRef.current = 0
      hasTriggeredRef.current = false
      setPullDistance(0)
      setStatus('idle')
    }

    const handleTouchStart = (event) => {
      if (!enabled) return
      if (event.touches.length !== 1) return
      if (document.body?.classList.contains('body-lock-scroll')) return
      if (document.body?.style.overflow === 'hidden') return
      if (getScrollTop() > 0) return

      startYRef.current = event.touches[0].clientY
      isPullingRef.current = true
      hasTriggeredRef.current = false
    }

    const handleTouchMove = (event) => {
      if (!enabled) return
      if (event.touches.length !== 1) return

      if (!isPullingRef.current) {
        if (getScrollTop() <= 0) {
          startYRef.current = event.touches[0].clientY
          isPullingRef.current = true
        } else {
          return
        }
      }

      const currentY = event.touches[0].clientY
      const deltaY = currentY - (startYRef.current ?? currentY)

      if (deltaY <= 0) {
        setPullDistance(0)
        setStatus('idle')
        return
      }

      const damped = clamp(deltaY * damping, 0, maxPull)
      distanceRef.current = damped
      setPullDistance(damped)
      setStatus(damped >= threshold ? 'ready' : 'pulling')

      // Prevent native scroll bounce while pulling down
      if (damped > 6 && event.cancelable) {
        event.preventDefault()
      }
    }

    const handleTouchEnd = () => {
      if (!isPullingRef.current) {
        resetState()
        return
      }

      const distance = distanceRef.current
      const shouldRefresh = distance >= threshold && !hasTriggeredRef.current

      if (shouldRefresh) {
        hasTriggeredRef.current = true
        isPullingRef.current = false
        startYRef.current = null
        distanceRef.current = threshold
        setPullDistance(Math.min(distance, maxPull))
        setStatus('refreshing')

        if (typeof onRefresh === 'function') {
          try {
            onRefresh()
          } catch (error) {
            console.error('Pull-to-refresh handler failed:', error)
          }
        }
        return
      }

      resetState()
    }

    const handleTouchCancel = () => resetState()

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('touchcancel', handleTouchCancel, { passive: true })

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [enabled, threshold, maxPull, damping, onRefresh])

  const progress = Math.min(pullDistance / threshold, 1)
  const isActive = status === 'pulling' || status === 'ready' || status === 'refreshing'

  return {
    pullDistance,
    progress,
    status,
    isActive,
    isReady: status === 'ready',
    isRefreshing: status === 'refreshing',
  }
}

export default usePullToRefresh

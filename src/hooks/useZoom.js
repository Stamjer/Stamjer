/**
 * Custom hook for handling zoom functionality
 * Supports both keyboard shortcuts (Ctrl +/-) and pinch-to-zoom on mobile
 */
import { useState, useEffect, useCallback, useRef } from 'react'

export const useZoom = (initialZoom = 1, minZoom = 0.5, maxZoom = 3) => {
  const [zoom, setZoom] = useState(initialZoom)
  const touchDistance = useRef(0)
  const initialTouchDistance = useRef(0)
  const isZooming = useRef(false)

  // Calculate distance between two touch points
  const getTouchDistance = useCallback((touches) => {
    if (touches.length < 2) return 0
    const touch1 = touches[0]
    const touch2 = touches[1]
    return Math.sqrt(
      Math.pow(touch2.clientX - touch1.clientX, 2) + 
      Math.pow(touch2.clientY - touch1.clientY, 2)
    )
  }, [])

  // Handle touch start (pinch gesture)
  const handleTouchStart = useCallback((event) => {
    if (event.touches.length === 2) {
      event.preventDefault()
      isZooming.current = true
      const distance = getTouchDistance(event.touches)
      touchDistance.current = distance
      initialTouchDistance.current = distance
    }
  }, [getTouchDistance])

  // Handle touch move (pinch gesture)
  const handleTouchMove = useCallback((event) => {
    if (event.touches.length === 2 && isZooming.current) {
      event.preventDefault()
      const distance = getTouchDistance(event.touches)
      const scale = distance / touchDistance.current
      const newZoom = Math.min(Math.max(zoom * scale, minZoom), maxZoom)
      
      // Only update if there's a meaningful change
      if (Math.abs(newZoom - zoom) > 0.01) {
        setZoom(newZoom)
        touchDistance.current = distance
      }
    }
  }, [zoom, minZoom, maxZoom, getTouchDistance])

  // Handle touch end
  const handleTouchEnd = useCallback((event) => {
    if (event.touches.length < 2) {
      isZooming.current = false
      touchDistance.current = 0
      initialTouchDistance.current = 0
    }
  }, [])

  // Handle keyboard zoom (Ctrl + Plus/Minus)
  const handleKeyDown = useCallback((event) => {
    if (event.ctrlKey) {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setZoom(prevZoom => Math.min(prevZoom + 0.1, maxZoom))
      } else if (event.key === '-') {
        event.preventDefault()
        setZoom(prevZoom => Math.max(prevZoom - 0.1, minZoom))
      } else if (event.key === '0') {
        event.preventDefault()
        setZoom(initialZoom)
      }
    }
  }, [initialZoom, minZoom, maxZoom])

  // Zoom in function
  const zoomIn = useCallback(() => {
    setZoom(prevZoom => Math.min(prevZoom + 0.1, maxZoom))
  }, [maxZoom])

  // Zoom out function
  const zoomOut = useCallback(() => {
    setZoom(prevZoom => Math.max(prevZoom - 0.1, minZoom))
  }, [minZoom])

  // Reset zoom function
  const resetZoom = useCallback(() => {
    setZoom(initialZoom)
  }, [initialZoom])

  // Set up event listeners
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('touchstart', handleTouchStart, { passive: false })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleKeyDown, handleTouchStart, handleTouchMove, handleTouchEnd])

  return {
    zoom,
    zoomIn,
    zoomOut,
    resetZoom,
    setZoom,
    isZooming: isZooming.current
  }
}

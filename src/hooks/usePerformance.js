/**
 * ================================================================
 * PERFORMANCE MONITORING HOOK
 * ================================================================
 * 
 * Custom React hook for monitoring and optimizing application performance.
 * Provides utilities for measuring render times, detecting performance issues,
 * and implementing performance optimizations.
 * 
 * Features:
 * - Render time measurement
 * - Memory usage tracking
 * - Component re-render detection
 * - Performance budgets and alerts
 * - Resource loading monitoring
 * - User experience metrics
 * 
 * @author Stamjer Development Team
 * @version 1.0.0
 */

import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Performance monitoring hook
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Enable performance monitoring (default: true in development)
 * @param {number} options.sampleRate - Sampling rate 0-1 (default: 1.0)
 * @param {boolean} options.logToConsole - Log metrics to console (default: true in development)
 * @returns {Object} Performance monitoring utilities
 */
export function usePerformance(options = {}) {
  const {
    enabled = import.meta.env.DEV,
    sampleRate = 1.0,
    logToConsole = import.meta.env.DEV
  } = options

  const [metrics, setMetrics] = useState({})
  const renderCount = useRef(0)
  const renderTimes = useRef([])
  const lastRenderTime = useRef(performance.now())

  // ================================================================
  // RENDER PERFORMANCE TRACKING
  // ================================================================

  useEffect(() => {
    if (!enabled || Math.random() > sampleRate) return

    renderCount.current++
    const currentTime = performance.now()
    const renderTime = currentTime - lastRenderTime.current
    
    renderTimes.current.push(renderTime)
    
    // Keep only last 100 render times
    if (renderTimes.current.length > 100) {
      renderTimes.current = renderTimes.current.slice(-100)
    }

    // Calculate metrics
    const avgRenderTime = renderTimes.current.reduce((a, b) => a + b, 0) / renderTimes.current.length
    const maxRenderTime = Math.max(...renderTimes.current)
    const minRenderTime = Math.min(...renderTimes.current)

    const newMetrics = {
      renderCount: renderCount.current,
      avgRenderTime: Math.round(avgRenderTime * 100) / 100,
      maxRenderTime: Math.round(maxRenderTime * 100) / 100,
      minRenderTime: Math.round(minRenderTime * 100) / 100,
      lastRenderTime: Math.round(renderTime * 100) / 100
    }

    setMetrics(newMetrics)

    if (logToConsole && renderCount.current % 10 === 0) {
      console.group('🔧 Performance Metrics')
      console.log('Render count:', newMetrics.renderCount)
      console.log('Average render time:', newMetrics.avgRenderTime + 'ms')
      console.log('Max render time:', newMetrics.maxRenderTime + 'ms')
      console.log('Min render time:', newMetrics.minRenderTime + 'ms')
      console.groupEnd()
    }

    // Alert on slow renders
    if (renderTime > 16.67) { // Slower than 60fps
      console.warn(`⚠️ Slow render detected: ${renderTime.toFixed(2)}ms`)
    }

    lastRenderTime.current = currentTime
  }, [enabled, sampleRate, logToConsole])

  // ================================================================
  // MEMORY USAGE TRACKING
  // ================================================================

  const getMemoryUsage = useCallback(() => {
    if (!enabled || !performance.memory) return null

    const memory = performance.memory
    return {
      usedJSHeapSize: Math.round(memory.usedJSHeapSize / 1024 / 1024 * 100) / 100, // MB
      totalJSHeapSize: Math.round(memory.totalJSHeapSize / 1024 / 1024 * 100) / 100, // MB
      jsHeapSizeLimit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024 * 100) / 100, // MB
      memoryUsagePercent: Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)
    }
  }, [enabled])

  // ================================================================
  // TIMING UTILITIES
  // ================================================================

  const createTimer = useCallback((name) => {
    if (!enabled) return { end: () => {} }

    const startTime = performance.now()
    
    return {
      end: () => {
        const endTime = performance.now()
        const duration = endTime - startTime
        
        if (logToConsole) {
          console.log(`⏱️ Timer "${name}": ${duration.toFixed(2)}ms`)
        }
        
        return duration
      }
    }
  }, [enabled, logToConsole])

  const measureAsync = useCallback(async (name, asyncFn) => {
    if (!enabled) return await asyncFn()

    const timer = createTimer(name)
    try {
      const result = await asyncFn()
      timer.end()
      return result
    } catch (error) {
      timer.end()
      throw error
    }
  }, [enabled, createTimer])

  // ================================================================
  // RESOURCE MONITORING
  // ================================================================

  const monitorResourceLoad = useCallback((resourceName) => {
    if (!enabled) return

    const startTime = performance.now()
    
    return {
      onLoad: () => {
        const loadTime = performance.now() - startTime
        if (logToConsole) {
          console.log(`📦 Resource "${resourceName}" loaded in ${loadTime.toFixed(2)}ms`)
        }
      },
      onError: () => {
        const errorTime = performance.now() - startTime
        console.error(`❌ Resource "${resourceName}" failed to load after ${errorTime.toFixed(2)}ms`)
      }
    }
  }, [enabled, logToConsole])

  // ================================================================
  // USER EXPERIENCE METRICS
  // ================================================================

  const trackUserAction = useCallback((actionName, data = {}) => {
    if (!enabled) return

    const timestamp = performance.now()
    
    if (logToConsole) {
      console.log(`👤 User action "${actionName}" at ${timestamp.toFixed(2)}ms`, data)
    }

    // You could send this to analytics service
    return { actionName, timestamp, data }
  }, [enabled, logToConsole])

  // ================================================================
  // PERFORMANCE BUDGET CHECKING
  // ================================================================

  const checkPerformanceBudget = useCallback((budgets = {}) => {
    if (!enabled) return { passed: true, violations: [] }

    const defaultBudgets = {
      maxRenderTime: 16.67, // 60fps
      maxAvgRenderTime: 8,
      maxMemoryUsage: 50, // 50MB
      maxMemoryPercent: 80 // 80%
    }

    const activeBudgets = { ...defaultBudgets, ...budgets }
    const violations = []
    const memoryUsage = getMemoryUsage()

    // Check render time budgets
    if (metrics.maxRenderTime > activeBudgets.maxRenderTime) {
      violations.push({
        type: 'render-time',
        message: `Max render time (${metrics.maxRenderTime}ms) exceeds budget (${activeBudgets.maxRenderTime}ms)`,
        actual: metrics.maxRenderTime,
        budget: activeBudgets.maxRenderTime
      })
    }

    if (metrics.avgRenderTime > activeBudgets.maxAvgRenderTime) {
      violations.push({
        type: 'avg-render-time',
        message: `Average render time (${metrics.avgRenderTime}ms) exceeds budget (${activeBudgets.maxAvgRenderTime}ms)`,
        actual: metrics.avgRenderTime,
        budget: activeBudgets.maxAvgRenderTime
      })
    }

    // Check memory budgets
    if (memoryUsage) {
      if (memoryUsage.usedJSHeapSize > activeBudgets.maxMemoryUsage) {
        violations.push({
          type: 'memory-usage',
          message: `Memory usage (${memoryUsage.usedJSHeapSize}MB) exceeds budget (${activeBudgets.maxMemoryUsage}MB)`,
          actual: memoryUsage.usedJSHeapSize,
          budget: activeBudgets.maxMemoryUsage
        })
      }

      if (memoryUsage.memoryUsagePercent > activeBudgets.maxMemoryPercent) {
        violations.push({
          type: 'memory-percent',
          message: `Memory usage (${memoryUsage.memoryUsagePercent}%) exceeds budget (${activeBudgets.maxMemoryPercent}%)`,
          actual: memoryUsage.memoryUsagePercent,
          budget: activeBudgets.maxMemoryPercent
        })
      }
    }

    const passed = violations.length === 0

    if (!passed && logToConsole) {
      console.group('💸 Performance Budget Violations')
      violations.forEach(violation => {
        console.warn(violation.message)
      })
      console.groupEnd()
    }

    return { passed, violations }
  }, [enabled, metrics, getMemoryUsage, logToConsole])

  // ================================================================
  // WEB VITALS MONITORING
  // ================================================================

  const trackWebVitals = useCallback(() => {
    if (!enabled || typeof window === 'undefined') return

    // Track Largest Contentful Paint (LCP)
    if ('PerformanceObserver' in window) {
      try {
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          const lastEntry = entries[entries.length - 1]
          
          if (logToConsole) {
            console.log(`🎯 LCP: ${lastEntry.startTime.toFixed(2)}ms`)
          }
        })
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] })

        // Track First Input Delay (FID)
        const fidObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          entries.forEach(entry => {
            const fid = entry.processingStart - entry.startTime
            if (logToConsole) {
              console.log(`⚡ FID: ${fid.toFixed(2)}ms`)
            }
          })
        })
        fidObserver.observe({ entryTypes: ['first-input'] })

        // Track Cumulative Layout Shift (CLS)
        let clsScore = 0
        const clsObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          entries.forEach(entry => {
            if (!entry.hadRecentInput) {
              clsScore += entry.value
            }
          })
          
          if (logToConsole) {
            console.log(`📐 CLS: ${clsScore.toFixed(4)}`)
          }
        })
        clsObserver.observe({ entryTypes: ['layout-shift'] })

        return () => {
          lcpObserver.disconnect()
          fidObserver.disconnect()
          clsObserver.disconnect()
        }
      } catch (error) {
        console.warn('Performance Observer not supported:', error)
      }
    }
  }, [enabled, logToConsole])

  // Start Web Vitals tracking on mount
  useEffect(() => {
    const cleanup = trackWebVitals()
    return cleanup
  }, [trackWebVitals])

  // ================================================================
  // COMPONENT RE-RENDER TRACKING
  // ================================================================

  const whyDidYouRender = useCallback((componentName, props, prevProps) => {
    if (!enabled || !prevProps) return

    const changedProps = {}
    let hasChanges = false

    Object.keys(props).forEach(key => {
      if (props[key] !== prevProps[key]) {
        changedProps[key] = {
          from: prevProps[key],
          to: props[key]
        }
        hasChanges = true
      }
    })

    if (hasChanges && logToConsole) {
      console.group(`🔄 ${componentName} re-rendered`)
      console.log('Changed props:', changedProps)
      console.groupEnd()
    }

    return changedProps
  }, [enabled, logToConsole])

  // ================================================================
  // EXPORT UTILITIES
  // ================================================================

  return {
    metrics,
    getMemoryUsage,
    createTimer,
    measureAsync,
    monitorResourceLoad,
    trackUserAction,
    checkPerformanceBudget,
    trackWebVitals,
    whyDidYouRender,
    enabled
  }
}

/**
 * HOC for automatic performance monitoring
 * @param {React.Component} Component - Component to wrap
 * @param {Object} options - Monitoring options
 * @returns {React.Component} Wrapped component
 */
export function withPerformanceMonitoring(Component, options = {}) {
  return function PerformanceMonitoredComponent(props) {
    const perf = usePerformance(options)
    const prevProps = useRef(props)
    
    useEffect(() => {
      if (options.trackRerenders) {
        perf.whyDidYouRender(Component.name || 'Component', props, prevProps.current)
      }
      prevProps.current = props
    })

    return <Component {...props} performance={perf} />
  }
}

/**
 * Performance provider for sharing performance context
 */
import React, { createContext, useContext } from 'react'

const PerformanceContext = createContext()

export function PerformanceProvider({ children, ...options }) {
  const performance = usePerformance(options)
  
  return (
    <PerformanceContext.Provider value={performance}>
      {children}
    </PerformanceContext.Provider>
  )
}

export function usePerformanceContext() {
  const context = useContext(PerformanceContext)
  if (!context) {
    throw new Error('usePerformanceContext must be used within a PerformanceProvider')
  }
  return context
}

export default usePerformance

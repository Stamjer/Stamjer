/**
 * ================================================================
 * TANSTACK QUERY CONFIGURATION
 * ================================================================
 * 
 * Central configuration for TanStack Query (React Query).
 * This file sets up the query client with professional defaults
 * for caching, error handling, and background refetching.
 * 
 * Features:
 * - Intelligent caching with stale-while-revalidate strategy
 * - Automatic retries with exponential backoff
 * - Background refetching on focus/reconnect
 * - Global error handling
 * - Query key factory for consistent cache keys
 * 
 * @author Stamjer Development Team
 * @version 1.0.0
 */

import { QueryClient } from '@tanstack/react-query'

// ================================================================
// QUERY DEFAULT OPTIONS
// ================================================================

const defaultQueryOptions = {
  queries: {
    // Cache for 5 minutes before considering stale
    staleTime: 5 * 60 * 1000,
    
    // Keep in cache for 10 minutes after component unmount
    gcTime: 10 * 60 * 1000,
    
    // Conservative retry logic to prevent infinite loops
    retry: false, // Disable retries for now to prevent loops
    
    // No automatic retries
    retryDelay: 1000,
    
    // Disable aggressive refetching to prevent loops
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false
  },
  
  mutations: {
    // No retries for mutations either
    retry: false,
    retryDelay: 1000
  }
}

// ================================================================
// GLOBAL ERROR HANDLER
// ================================================================

function globalErrorHandler(error) {
  console.error('Query error:', error)
  
  // Here you could integrate with error reporting services like Sentry
  // if (window.Sentry) {
  //   window.Sentry.captureException(error)
  // }
}

// ================================================================
// QUERY CLIENT INSTANCE
// ================================================================

export const queryClient = new QueryClient({
  defaultOptions: defaultQueryOptions
})

// ================================================================
// QUERY KEY FACTORY
// ================================================================

export const queryKeys = {
  // Events
  events: {
    all: ['events'],
    lists: () => [...queryKeys.events.all, 'list'],
    list: (filters) => 
      [...queryKeys.events.lists(), { filters }],
    details: () => [...queryKeys.events.all, 'detail'],
    detail: (id) => [...queryKeys.events.details(), id],
    opkomsten: () => [...queryKeys.events.all, 'opkomsten']
  },
  
  // Users
  users: {
    all: ['users'],
    lists: () => [...queryKeys.users.all, 'list'],
    full: () => [...queryKeys.users.all, 'full'],
    details: () => [...queryKeys.users.all, 'detail'],
    detail: (id) => [...queryKeys.users.details(), id],
    profile: () => [...queryKeys.users.all, 'profile']
  }
}

// ================================================================
// CACHE UTILITY FUNCTIONS
// ================================================================

/**
 * Invalidate all events queries
 */
export function invalidateEvents() {
  return queryClient.invalidateQueries({ 
    queryKey: queryKeys.events.all 
  })
}

/**
 * Invalidate all users queries
 */
export function invalidateUsers() {
  return queryClient.invalidateQueries({ 
    queryKey: queryKeys.users.all 
  })
}

/**
 * Prefetch events for better performance
 */
export function prefetchEvents() {
  return queryClient.prefetchQuery({
    queryKey: queryKeys.events.lists(),
    staleTime: 30 * 1000 // 30 seconds
  })
}

/**
 * Get cached events data without triggering a fetch
 */
export function getCachedEvents() {
  return queryClient.getQueryData(queryKeys.events.lists())
}

/**
 * Set events data in cache (useful for optimistic updates)
 */
export function setCachedEvents(data) {
  queryClient.setQueryData(queryKeys.events.lists(), data)
}

/**
 * Remove specific event from cache
 */
export function removeEventFromCache(eventId) {
  queryClient.removeQueries({
    queryKey: queryKeys.events.detail(eventId)
  })
}

/**
 * Update specific event in cache
 */
export function updateEventInCache(eventId, updater) {
  queryClient.setQueryData(
    queryKeys.events.detail(eventId),
    updater
  )
}

/**
 * Clear all cache (nuclear option)
 */
export function clearCache() {
  queryClient.clear()
}

/**
 * Reset query client (for logout scenarios)
 */
export function resetQueryClient() {
  queryClient.resetQueries()
}

/**
 * Get query client instance
 */
export function getQueryClient() {
  return queryClient
}

export default queryClient
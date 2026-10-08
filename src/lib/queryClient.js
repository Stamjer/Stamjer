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
 * @author R.S. Kort
 *
 */

import { QueryClient } from '@tanstack/react-query'

// ================================================================
// QUERY DEFAULT OPTIONS
// ================================================================

const defaultQueryOptions = {
  queries: {
    // Always treat server data as source of truth
    staleTime: 0,
    
    // Keep cache modestly long-lived but always refetch on view
    gcTime: 5 * 60 * 1000,
    
    // Retry failed queries twice with exponential backoff
    retry: 2,
    
    // Exponential backoff capped at 10s
    retryDelay: (attempt) => Math.min(1000 * (2 ** attempt), 10000),
    
    // Always refresh when user views a page
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: true,
    refetchOnMount: 'always',
    
    // Network mode for better offline handling
    networkMode: 'online',
    
    // Reduce structural sharing overhead for large data
    structuralSharing: true,
  },
  
  mutations: {
    // No retries for mutations
    retry: false,
    retryDelay: 1000,
    
    // Network mode for mutations
    networkMode: 'online',
  }
}

// ================================================================
// GLOBAL ERROR HANDLER
// ================================================================

// ================================================================
// QUERY CLIENT INSTANCE
// ================================================================

export const queryClient = new QueryClient({
  defaultOptions: defaultQueryOptions
})

// ================================================================
// QUERY KEY FACTORY
// ================================================================

import { groupCacheScope } from './groupContext'
export const queryKeys = {
  developer: {
    all: ['developer'],
    groups: () => ['developer', 'groups'],
    users: (groupId) => ['developer', 'users', groupId],
    events: (groupId) => ['developer', 'events', groupId]
  },
  // Events
  events: {
    all: ['events'],
    raw: () => [...queryKeys.events.all, 'raw', ...groupCacheScope()],
    lists: () => [...queryKeys.events.all, 'list', ...groupCacheScope()],
    opkomsten: () => [...queryKeys.events.all, 'opkomsten', ...groupCacheScope()]
  },
  
  // Users
  users: {
    all: ['users'],
    lists: () => [...queryKeys.users.all, 'list', ...groupCacheScope()],
    full: () => [...queryKeys.users.all, 'full', ...groupCacheScope()],
    history: (scope) => [...queryKeys.users.all, 'group-history', scope]
  }
}


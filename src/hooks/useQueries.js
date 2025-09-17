/**
 * ================================================================
 * DATA FETCHING HOOKS - TANSTACK QUERY
 * ================================================================
 * 
 * Professional query hooks for events and users data using TanStack Query.
 * Provides optimized caching, background refetching, and error handling.
 * 
 * Features:
 * - Intelligent caching with stale-while-revalidate
 * - Background refetching for data freshness
 * - Optimistic updates for instant UI feedback
 * - Robust error handling and retries
 * - TypeScript-like query key management
 * 
 * @author Stamjer Development Team
 * @version 1.3.0
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryClient'

// Import simplified API functions (we'll create these)
import * as api from '../services/api'

// ================================================================
// EVENTS QUERY HOOKS
// ================================================================

/**
 * Fetch all events with intelligent caching
 * @param {Object} options - Query options
 * @returns {Object} Query result with events data
 */
export function useEvents(options = {}) {
  return useQuery({
    queryKey: queryKeys.events.lists(),
    queryFn: async () => {
      const response = await api.getEvents()
      // Normalize response structure
      const events = Array.isArray(response) ? response : response.events || []
      
      // Transform for FullCalendar format
      return events.map(evt => ({
        id: evt.id,
        title: evt.title,
        start: evt.start,
        end: evt.end,
        allDay: evt.allDay,
        extendedProps: {
          location: evt.location,
          description: evt.description,
          isOpkomst: evt.isOpkomst,
          opkomstmakers: evt.opkomstmakers,
          participants: evt.participants || []
        },
      }))
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,   // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    ...options
  })
}

/**
 * Fetch opkomst events only
 * @param {Object} options - Query options
 * @returns {Object} Query result with opkomst events
 */
export function useOpkomstEvents(options = {}) {
  return useQuery({
    queryKey: queryKeys.events.opkomsten(),
    queryFn: async () => {
      const response = await api.getEvents()
      const events = Array.isArray(response) ? response : response.events || []
      return events.filter(evt => evt.isOpkomst)
    },
    staleTime: 2 * 60 * 1000,
    ...options
  })
}

/**
 * Fetch single event by ID
 * @param {string} eventId - Event ID
 * @param {Object} options - Query options
 * @returns {Object} Query result with single event
 */
export function useEvent(eventId, options = {}) {
  return useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: async () => {
      const events = await api.getEvents()
      const eventsList = Array.isArray(events) ? events : events.events || []
      return eventsList.find(evt => evt.id === eventId)
    },
    enabled: !!eventId, // Only run if eventId exists
    staleTime: 5 * 60 * 1000,
    ...options
  })
}

// ================================================================
// USERS QUERY HOOKS
// ================================================================

/**
 * Fetch all users for dropdowns and selections
 * @param {Object} options - Query options
 * @returns {Object} Query result with users data
 */
export function useUsers(options = {}) {
  return useQuery({
    queryKey: queryKeys.users.lists(),
    queryFn: async () => {
      const response = await fetch('/api/users')
      if (!response.ok) {
        throw new Error(`Kon gebruikers niet ophalen: ${response.status}`)
      }
      const data = await response.json()
      return Array.isArray(data) ? data : data.users || []
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000,   // 15 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    ...options
  })
}

/**
 * Fetch users with full information including streepjes
 * @param {Object} options - Query options
 * @returns {Object} Query result with full user data
 */
export function useUsersWithStreepjes(options = {}) {
  return useQuery({
    queryKey: queryKeys.users.full(),
    queryFn: async () => {
      const response = await fetch('/api/users/full')
      if (!response.ok) {
        throw new Error(`Kon gebruikers niet ophalen: ${response.status}`)
      }
      const data = await response.json()
      return data.users || []
    },
    staleTime: 3 * 60 * 1000, // Streepjes can change more frequently
    gcTime: 10 * 60 * 1000,
    ...options
  })
}

/**
 * Fetch current user profile
 * @param {Object} options - Query options
 * @returns {Object} Query result with user profile
 */
export function useUserProfile(options = {}) {
  return useQuery({
    queryKey: queryKeys.users.profile(),
    queryFn: async () => {
      const response = await fetch('/api/user/profile')
      if (!response.ok) {
        throw new Error(`Kon profiel niet ophalen: ${response.status}`)
      }
      return response.json()
    },
    staleTime: 5 * 60 * 1000,
    ...options
  })
}

// ================================================================
// MUTATION HOOKS FOR EVENTS
// ================================================================

/**
 * Create new event with optimistic updates
 * @param {Object} options - Mutation options
 * @returns {Object} Mutation object
 */
export function useCreateEvent(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ eventData, userId }) => {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...eventData, userId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.msg || `Serverfout: ${response.status}`)
      }

      return response.json()
    },

    // Optimistic update
    onMutate: async ({ eventData }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: queryKeys.events.lists() })

      // Get current events
      const previousEvents = queryClient.getQueryData(queryKeys.events.lists()) || []

      // Create optimistic event
      const optimisticEvent = {
        id: `temp-${Date.now()}`, // Temporary ID
        title: eventData.title,
        start: eventData.start,
        end: eventData.end,
        allDay: eventData.allDay,
        extendedProps: {
          location: eventData.location,
          description: eventData.description,
          isOpkomst: eventData.isOpkomst,
          opkomstmakers: eventData.opkomstmakers,
          participants: eventData.isOpkomst && eventData.title === 'Stam opkomst' ? 
            previousEvents.filter(e => e.extendedProps?.participants)
              .flatMap(e => e.extendedProps.participants || []) : []
        },
      }

      // Update cache optimistically
      queryClient.setQueryData(queryKeys.events.lists(), 
        old => [...(old || []), optimisticEvent]
      )

      return { previousEvents, optimisticEvent }
    },

    // Handle success
    onSuccess: (newEvent, variables, context) => {
      // Replace optimistic event with real event from server
      queryClient.setQueryData(queryKeys.events.lists(), old => {
        if (!old) return [newEvent]
        
        return old.map(evt => 
          evt.id === context.optimisticEvent.id ? {
            id: newEvent.id,
            title: newEvent.title,
            start: newEvent.start,
            end: newEvent.end,
            allDay: newEvent.allDay,
            extendedProps: {
              location: newEvent.location,
              description: newEvent.description,
              isOpkomst: newEvent.isOpkomst,
              opkomstmakers: newEvent.opkomstmakers,
              participants: newEvent.participants || []
            }
          } : evt
        )
      })

      // Invalidate related queries
      if (newEvent.isOpkomst) {
        queryClient.invalidateQueries({ queryKey: queryKeys.events.opkomsten() })
      }
    },

    // Handle error - rollback optimistic update
    onError: (error, variables, context) => {
      console.error('Create event error:', error)
      
      if (context?.previousEvents) {
        queryClient.setQueryData(queryKeys.events.lists(), context.previousEvents)
      }
    },

    // Always refetch after mutation
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.lists() })
    },

    ...options
  })
}

/**
 * Update existing event with optimistic updates
 * @param {Object} options - Mutation options
 * @returns {Object} Mutation object
 */
export function useUpdateEvent(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ eventId, eventData, userId }) => {
      const response = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...eventData, userId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.msg || `Serverfout: ${response.status}`)
      }

      return response.json()
    },

    // Optimistic update
    onMutate: async ({ eventId, eventData }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events.lists() })

      const previousEvents = queryClient.getQueryData(queryKeys.events.lists()) || []

      // Update event optimistically
      queryClient.setQueryData(queryKeys.events.lists(), old => {
        if (!old) return old
        
        return old.map(evt => 
          evt.id === eventId ? {
            ...evt,
            title: eventData.title,
            start: eventData.start,
            end: eventData.end,
            allDay: eventData.allDay,
            extendedProps: {
              ...evt.extendedProps,
              location: eventData.location,
              description: eventData.description,
              isOpkomst: eventData.isOpkomst,
              opkomstmakers: eventData.opkomstmakers,
            }
          } : evt
        )
      })

      return { previousEvents, eventId }
    },

    // Handle success
    onSuccess: (updatedEvent, { eventId }) => {
      // Update cache with server response
      queryClient.setQueryData(queryKeys.events.lists(), old => {
        if (!old) return old
        
        return old.map(evt => 
          evt.id === eventId ? {
            id: updatedEvent.id,
            title: updatedEvent.title,
            start: updatedEvent.start,
            end: updatedEvent.end,
            allDay: updatedEvent.allDay,
            extendedProps: {
              location: updatedEvent.location,
              description: updatedEvent.description,
              isOpkomst: updatedEvent.isOpkomst,
              opkomstmakers: updatedEvent.opkomstmakers,
              participants: updatedEvent.participants || []
            }
          } : evt
        )
      })

      // Update individual event cache
      queryClient.setQueryData(queryKeys.events.detail(eventId), updatedEvent)
    },

    // Handle error - rollback
    onError: (error, { eventId }, context) => {
      console.error('Update event error:', error)
      
      if (context?.previousEvents) {
        queryClient.setQueryData(queryKeys.events.lists(), context.previousEvents)
      }
    },

    // Cleanup
    onSettled: (data, error, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) })
    },

    ...options
  })
}

/**
 * Delete event with optimistic updates
 * @param {Object} options - Mutation options
 * @returns {Object} Mutation object
 */
export function useDeleteEvent(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ eventId, userId }) => {
      const response = await fetch(`/api/events/${eventId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.msg || `Serverfout: ${response.status}`)
      }

      return response.json()
    },

    // Optimistic update
    onMutate: async ({ eventId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events.lists() })

      const previousEvents = queryClient.getQueryData(queryKeys.events.lists()) || []

      // Remove event optimistically
      queryClient.setQueryData(queryKeys.events.lists(), 
        old => old?.filter(evt => evt.id !== eventId) || []
      )

      return { previousEvents, eventId }
    },

    // Handle success
    onSuccess: (data, { eventId }) => {
      // Remove from individual cache
      queryClient.removeQueries({ queryKey: queryKeys.events.detail(eventId) })
    },

    // Handle error - rollback
    onError: (error, { eventId }, context) => {
      console.error('Delete event error:', error)
      
      if (context?.previousEvents) {
        queryClient.setQueryData(queryKeys.events.lists(), context.previousEvents)
      }
    },

    // Cleanup
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.events.opkomsten() })
    },

    ...options
  })
}

// ================================================================
// MUTATION HOOKS FOR USERS
// ================================================================

/**
 * Update user profile
 * @param {Object} options - Mutation options
 * @returns {Object} Mutation object
 */
export function useUpdateUserProfile(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (profileData) => {
      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `Serverfout: ${response.status}`)
      }

      return response.json()
    },

    onSuccess: (data) => {
      // Update profile cache
      queryClient.setQueryData(queryKeys.users.profile(), data.user)
      
      // Invalidate users list to reflect changes
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.users.full() })
    },

    onError: (error) => {
      console.error('Update profile error:', error)
    },

    ...options
  })
}

/**
 * Update event attendance
 * @param {Object} options - Mutation options
 * @returns {Object} Mutation object
 */
export function useUpdateAttendance(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ eventId, userId, attending }) => {
      const response = await fetch(`/api/events/${eventId}/attendance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, attending }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.msg || `Serverfout: ${response.status}`)
      }

      return response.json()
    },

    // Optimistic update for attendance
    onMutate: async ({ eventId, userId, attending }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events.lists() })

      const previousEvents = queryClient.getQueryData(queryKeys.events.lists()) || []

      // Update attendance optimistically
      queryClient.setQueryData(queryKeys.events.lists(), old => {
        if (!old) return old
        
        return old.map(evt => {
          if (evt.id !== eventId) return evt
          
          const participants = evt.extendedProps?.participants || []
          const userIdNum = parseInt(userId, 10)
          const isCurrentlyParticipating = participants.includes(userIdNum)
          
          let newParticipants
          if (attending && !isCurrentlyParticipating) {
            newParticipants = [...participants, userIdNum]
          } else if (!attending && isCurrentlyParticipating) {
            newParticipants = participants.filter(id => id !== userIdNum)
          } else {
            newParticipants = participants
          }
          
          return {
            ...evt,
            extendedProps: {
              ...evt.extendedProps,
              participants: newParticipants
            }
          }
        })
      })

      return { previousEvents, eventId, userId }
    },

    onSuccess: (data, { eventId }) => {
      // Update with server response
      queryClient.setQueryData(queryKeys.events.detail(eventId), data.event)
      
      // Invalidate streepjes as attendance affects them
      queryClient.invalidateQueries({ queryKey: queryKeys.users.full() })
    },

    onError: (error, variables, context) => {
      console.error('Update attendance error:', error)
      
      if (context?.previousEvents) {
        queryClient.setQueryData(queryKeys.events.lists(), context.previousEvents)
      }
    },

    onSettled: ({ eventId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) })
    },

    ...options
  })
}

// ================================================================
// UTILITY HOOKS
// ================================================================

/**
 * Hook to prefetch events data
 * Useful for preloading data before navigation
 */
export function usePrefetchEvents() {
  const queryClient = useQueryClient()

  return () => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.events.lists(),
      queryFn: api.getEvents,
      staleTime: 2 * 60 * 1000,
    })
  }
}

/**
 * Hook to invalidate all events data
 * Useful for force refresh scenarios
 */
export function useInvalidateEvents() {
  const queryClient = useQueryClient()

  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
  }
}

/**
 * Hook to check if events are currently being fetched
 */
export function useIsEventsFetching() {
  const queryClient = useQueryClient()
  return queryClient.isFetching({ queryKey: queryKeys.events.all }) > 0
}
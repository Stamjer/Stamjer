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
 * @author R.S. Kort
 *
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
          isSchoonmaak: evt.isSchoonmaak,
          schoonmakers: evt.schoonmakers,
          schoonmaakOptions: evt.schoonmaakOptions,
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
      const users = await api.getUsers()
      return Array.isArray(users) ? users : users.users || []
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
      const users = await api.getUsersFull()
      return Array.isArray(users) ? users : users.users || []
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
    queryFn: async () => api.getUserProfile(),
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
    mutationFn: async ({ eventData, userId }) =>
      api.createEvent(eventData, userId),

    // Optimistic update
    onMutate: async ({ eventData }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: queryKeys.events.lists() })

      // Get current events
      const previousEvents = queryClient.getQueryData(queryKeys.events.lists()) || []

      const optimisticParticipants = Array.isArray(eventData.participants)
        ? eventData.participants
            .map(id => parseInt(id, 10))
            .filter(Number.isFinite)
        : []

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
          isSchoonmaak: eventData.isSchoonmaak,
          schoonmakers: eventData.schoonmakers,
          schoonmaakOptions: eventData.schoonmaakOptions,
          participants: optimisticParticipants
        },
      }

      // Update cache optimistically
      queryClient.setQueryData(queryKeys.events.lists(), 
        old => [...(old || []), optimisticEvent]
      )

      return { previousEvents, optimisticEvent }
    },

    // Handle success
    onSuccess: (newEventResponse, variables, context) => {
      const newEvent = newEventResponse?.event || newEventResponse

      if (!newEvent) {
        queryClient.invalidateQueries({ queryKey: queryKeys.events.lists() })
        return
      }

      // Replace optimistic event with server response
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
              isSchoonmaak: newEvent.isSchoonmaak,
              schoonmakers: newEvent.schoonmakers,
              schoonmaakOptions: newEvent.schoonmaakOptions,
              participants: newEvent.participants || []
            }
          } : evt
        )
      })

      if (newEvent.isOpkomst) {
        queryClient.invalidateQueries({ queryKey: queryKeys.events.opkomsten() })
      }

    },

    // Handle error - rollback optimistic update
    onError: (error, _variables, context) => {
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
    mutationFn: async ({ eventId, eventData, userId }) =>
      api.updateEvent(eventId, eventData, userId),

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
              isSchoonmaak: eventData.isSchoonmaak,
              schoonmakers: eventData.schoonmakers,
              schoonmaakOptions: eventData.schoonmaakOptions,
            }
          } : evt
        )
      })

      return { previousEvents, eventId }
    },

    // Handle success
    onSuccess: (updatedEventResponse, { eventId }) => {
      const updatedEvent = updatedEventResponse?.event || updatedEventResponse

      if (!updatedEvent) {
        queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.events.lists() })
        return
      }

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
              isSchoonmaak: updatedEvent.isSchoonmaak,
              schoonmakers: updatedEvent.schoonmakers,
              schoonmaakOptions: updatedEvent.schoonmaakOptions,
              participants: updatedEvent.participants || []
            }
          } : evt
        )
      })

      queryClient.setQueryData(queryKeys.events.detail(eventId), updatedEvent)

    },

    // Handle error - rollback
    onError: (error, { eventId }, context) => {
      console.error('Update event error:', error)
      
      if (context?.previousEvents) {
        queryClient.setQueryData(queryKeys.events.lists(), context.previousEvents)
      }

      if (eventId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) })
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
    mutationFn: async ({ eventId, userId }) =>
      api.deleteEvent(eventId, userId),

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

      if (eventId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) })
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
    mutationFn: async (profileData) => api.updateUserProfile(profileData),

    onSuccess: (data) => {
      const updatedProfile = data?.user || data

      queryClient.setQueryData(queryKeys.users.profile(), updatedProfile)

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
    mutationFn: async ({ eventId, userId, attending }) =>
      api.updateAttendance(eventId, userId, attending),

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
      const updatedEvent = data?.event || data

      if (updatedEvent) {
        queryClient.setQueryData(queryKeys.events.detail(eventId), updatedEvent)
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.users.full() })
    },

    onError: (error, variables, context) => {
      console.error('Update attendance error:', error)
      
      if (context?.previousEvents) {
        queryClient.setQueryData(queryKeys.events.lists(), context.previousEvents)
      }
    },

    onSettled: (data, error, variables) => {
      if (variables?.eventId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(variables.eventId) })
      }
    },

    ...options
  })
}

// ================================================================
// UTILITY HOOKS
// ================================================================

// ================================================================
// NOTIFICATIONS
// ================================================================

export function useNotifications(userId, options = {}) {
  return useQuery({
    queryKey: queryKeys.notifications.list(userId || 'anonymous'),
    queryFn: async () => {
      if (!userId) {
        return { notifications: [], unreadCount: 0, push: { enabled: false } }
      }
      const response = await api.getNotifications(userId)
      const notifications = Array.isArray(response?.notifications) ? response.notifications : []
      const unreadCount = Number.isFinite(response?.unreadCount) ? response.unreadCount : 0
      const push = response?.push || { enabled: false }
      return { notifications, unreadCount, push }
    },
    enabled: Boolean(userId),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    ...options
  })
}

export function useMarkNotificationsRead(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, notificationIds, read = true }) =>
      api.markNotificationsRead(userId, notificationIds, read),
    onSuccess: (_data, variables) => {
      if (variables?.userId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(variables.userId) })
      }
    },
    ...options
  })
}

export function useMarkAllNotificationsRead(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId }) =>
      api.markAllNotificationsRead(userId),
    onSuccess: (_data, variables) => {
      if (variables?.userId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(variables.userId) })
      }
    },
    ...options
  })
}

export function useSendManualNotification(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, payload, sessionToken }) =>
      api.sendManualNotification(userId, payload, sessionToken),
    onSuccess: (_data, variables) => {
      const userId = variables?.payload?.userId || variables?.userId
      if (userId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list(userId) })
      }
    },
    ...options
  })
}

export function useScheduledNotifications(options = {}) {
  const { sessionToken, ...rest } = options
  return useQuery({
    queryKey: queryKeys.notifications.scheduled(),
    queryFn: () => api.getScheduledNotifications(sessionToken),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    ...rest
  })
}

export function useScheduleNotification(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ payload, sessionToken }) => api.scheduleNotification(payload, sessionToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.scheduled() })
    },
    ...options
  })
}

export function useUpdateScheduledNotification(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ notificationId, payload, sessionToken }) =>
      api.updateScheduledNotification(notificationId, payload, sessionToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.scheduled() })
    },
    ...options
  })
}

export function useCancelScheduledNotification(options = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ notificationId, sessionToken }) =>
      api.cancelScheduledNotification(notificationId, sessionToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.scheduled() })
    },
    ...options
  })
}

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



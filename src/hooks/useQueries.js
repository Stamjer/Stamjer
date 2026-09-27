import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../lib/queryClient'
import {
  createEvent,
  deleteEvent,
  getEvents,
  getUsers,
  getUsersFull,
  updateAttendance,
  updateEvent,
  updateUserProfile
} from '../services/api'

const LIVE_QUERY_OPTIONS = {
  staleTime: 0,
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: true
}

function eventsFromResponse(response) {
  return Array.isArray(response) ? response : response?.events || []
}

function usersFromResponse(response) {
  return Array.isArray(response) ? response : response?.users || []
}

function toCalendarEvent(event) {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    extendedProps: {
      location: event.location,
      description: event.description,
      isOpkomst: event.isOpkomst,
      opkomstmakers: event.opkomstmakers,
      opkomstmakerIds: event.opkomstmakerIds || [],
      isSchoonmaak: event.isSchoonmaak,
      schoonmakers: event.schoonmakers,
      schoonmakerIds: event.schoonmakerIds || [],
      schoonmaakOptions: event.schoonmaakOptions || [],
      participants: event.participants || []
    }
  }
}

export function useEvents(options = {}) {
  return useQuery({
    queryKey: queryKeys.events.lists(),
    queryFn: async () => eventsFromResponse(await getEvents()).map(toCalendarEvent),
    ...LIVE_QUERY_OPTIONS,
    ...options
  })
}

export function useRawEvents(options = {}) {
  return useQuery({
    queryKey: queryKeys.events.raw(),
    queryFn: async () => eventsFromResponse(await getEvents()),
    ...LIVE_QUERY_OPTIONS,
    ...options
  })
}

export function useOpkomstEvents(options = {}) {
  return useQuery({
    queryKey: queryKeys.events.opkomsten(),
    queryFn: async () => eventsFromResponse(await getEvents()).filter((event) => event.isOpkomst),
    ...LIVE_QUERY_OPTIONS,
    ...options
  })
}

export function useUsers(options = {}) {
  return useQuery({
    queryKey: queryKeys.users.lists(),
    queryFn: async () => usersFromResponse(await getUsers()),
    ...LIVE_QUERY_OPTIONS,
    ...options
  })
}

export function useUsersWithStreepjes(options = {}) {
  return useQuery({
    queryKey: queryKeys.users.full(),
    queryFn: async () => usersFromResponse(await getUsersFull()),
    ...LIVE_QUERY_OPTIONS,
    ...options
  })
}

function useEventMutation(mutationFn, options = {}) {
  const queryClient = useQueryClient()
  const { onSuccess, ...mutationOptions } = options
  return useMutation({
    mutationFn,
    ...mutationOptions,
    onSuccess: async (data, variables, context) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.full() })
      onSuccess?.(data, variables, context)
    }
  })
}

export function useCreateEvent(options = {}) {
  return useEventMutation(({ eventData }) => createEvent(eventData), options)
}

export function useUpdateEvent(options = {}) {
  return useEventMutation(({ eventId, eventData }) => updateEvent(eventId, eventData), options)
}

export function useDeleteEvent(options = {}) {
  return useEventMutation(({ eventId }) => deleteEvent(eventId), options)
}

export function useUpdateAttendance(options = {}) {
  return useEventMutation(
    ({ eventId, userId, attending }) => updateAttendance(eventId, userId, attending),
    options
  )
}

export function useUpdateUserProfile(options = {}) {
  const queryClient = useQueryClient()
  const { onSuccess, ...mutationOptions } = options
  return useMutation({
    mutationFn: updateUserProfile,
    ...mutationOptions,
    onSuccess: async (data, variables, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      ])
      onSuccess?.(data, variables, context)
    }
  })
}

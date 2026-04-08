import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: (failureCount, error) => {
        if (error && typeof error === 'object' && 'status' in error) {
          const status = (error as { status: number }).status
          if (status >= 400 && status < 500) {
            return false
          }
        }
        return failureCount < 2
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: false,
    },
  },
})

export const queryKeys = {
  ai: {
    all: ['ai'] as const,
    conversations: () => [...queryKeys.ai.all, 'conversations'] as const,
    conversationDetail: (id: string) => [...queryKeys.ai.conversations(), 'detail', id] as const,
  },
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'list'] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.users.lists(), filters] as const,
    details: () => [...queryKeys.users.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.users.details(), id] as const,
  },
  activities: {
    all: ['activities'] as const,
    lists: () => [...queryKeys.activities.all, 'list'] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.activities.lists(), filters] as const,
    details: () => [...queryKeys.activities.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.activities.details(), id] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    operations: () => [...queryKeys.dashboard.all, 'operations'] as const,
  },
  moderation: {
    all: ['moderation'] as const,
    queue: (filters?: Record<string, unknown>) => [...queryKeys.moderation.all, 'queue', filters] as const,
    reports: () => [...queryKeys.moderation.all, 'reports'] as const,
  },
}

export const invalidateQueries = {
  ai: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.ai.all }),
    conversations: () => queryClient.invalidateQueries({ queryKey: queryKeys.ai.conversations() }),
    conversationDetail: (id: string) => queryClient.invalidateQueries({ queryKey: queryKeys.ai.conversationDetail(id) }),
  },
  users: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
    lists: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() }),
    detail: (id: string) => queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(id) }),
  },
  activities: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.activities.all }),
    lists: () => queryClient.invalidateQueries({ queryKey: queryKeys.activities.lists() }),
    detail: (id: string) => queryClient.invalidateQueries({ queryKey: queryKeys.activities.detail(id) }),
  },
  dashboard: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    operations: () => queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.operations() }),
  },
  moderation: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.moderation.all }),
    queue: () => queryClient.invalidateQueries({ queryKey: queryKeys.moderation.queue() }),
    reports: () => queryClient.invalidateQueries({ queryKey: queryKeys.moderation.reports() }),
  },
}

export const prefetchQueries = {
  usersList: (filters: Record<string, unknown> = {}) =>
    queryClient.prefetchQuery({
      queryKey: queryKeys.users.list(filters),
      queryFn: async () => null,
    }),
  activitiesList: (filters: Record<string, unknown> = {}) =>
    queryClient.prefetchQuery({
      queryKey: queryKeys.activities.list(filters),
      queryFn: async () => null,
    }),
}

export const optimisticUpdates = {
  setUserDetail: (userId: string, updater: (oldData: unknown) => unknown) =>
    queryClient.setQueryData(queryKeys.users.detail(userId), updater),
  setActivityDetail: (activityId: string, updater: (oldData: unknown) => unknown) =>
    queryClient.setQueryData(queryKeys.activities.detail(activityId), updater),
}

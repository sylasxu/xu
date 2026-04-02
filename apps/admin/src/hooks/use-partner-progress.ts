import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'

type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never

type PartnerIntentsResponse = ApiResponse<typeof api['partner-intents']>
type IntentMatchesResponse = ApiResponse<typeof api['intent-matches']>

export type PartnerIntent = NonNullable<PartnerIntentsResponse>['data'] extends (infer T)[] ? T : never
export type IntentMatch = NonNullable<IntentMatchesResponse>['data'] extends (infer T)[] ? T : never

export type PartnerIntentStatus = 'active' | 'matched' | 'expired' | 'cancelled'
export type IntentMatchOutcome = 'pending' | 'confirmed' | 'expired' | 'cancelled'
export type PartnerActivityType = 'food' | 'entertainment' | 'sports' | 'boardgame' | 'other'

export interface PartnerIntentFilters {
  page?: number
  limit?: number
  status?: PartnerIntentStatus
  activityType?: PartnerActivityType
  userId?: string
  search?: string
}

export interface IntentMatchFilters {
  page?: number
  limit?: number
  outcome?: IntentMatchOutcome
  activityType?: PartnerActivityType
  userId?: string
  tempOrganizerId?: string
  search?: string
}

export interface PartnerProgressSummary {
  activeIntentCount: number
  matchedIntentCount: number
  pendingMatchCount: number
  confirmedMatchCount: number
}

function buildPartnerIntentQuery(filters: PartnerIntentFilters) {
  const { page = 1, limit = 20, status, activityType, userId, search } = filters

  return {
    page,
    limit,
    ...(status ? { status } : {}),
    ...(activityType ? { activityType } : {}),
    ...(userId ? { userId } : {}),
    ...(search ? { search } : {}),
  }
}

function buildIntentMatchQuery(filters: IntentMatchFilters) {
  const { page = 1, limit = 20, outcome, activityType, userId, tempOrganizerId, search } = filters

  return {
    page,
    limit,
    ...(outcome ? { outcome } : {}),
    ...(activityType ? { activityType } : {}),
    ...(userId ? { userId } : {}),
    ...(tempOrganizerId ? { tempOrganizerId } : {}),
    ...(search ? { search } : {}),
  }
}

export function usePartnerIntents(filters: PartnerIntentFilters = {}) {
  const query = buildPartnerIntentQuery(filters)

  return useQuery({
    queryKey: ['partner-intents', query],
    queryFn: async () => {
      const result = await unwrap(api['partner-intents'].get({ query }))
      return {
        data: result?.data ?? [],
        total: result?.total ?? 0,
        page: result?.page ?? query.page,
        limit: result?.limit ?? query.limit,
      }
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  })
}

export function useIntentMatches(filters: IntentMatchFilters = {}) {
  const query = buildIntentMatchQuery(filters)

  return useQuery({
    queryKey: ['intent-matches', query],
    queryFn: async () => {
      const result = await unwrap(api['intent-matches'].get({ query }))
      return {
        data: result?.data ?? [],
        total: result?.total ?? 0,
        page: result?.page ?? query.page,
        limit: result?.limit ?? query.limit,
      }
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  })
}

export function usePartnerProgressSummary() {
  return useQuery<PartnerProgressSummary>({
    queryKey: ['partner-progress-summary'],
    queryFn: async () => {
      const [activeIntents, matchedIntents, pendingMatches, confirmedMatches] = await Promise.all([
        unwrap(api['partner-intents'].get({ query: { page: 1, limit: 1, status: 'active' } })),
        unwrap(api['partner-intents'].get({ query: { page: 1, limit: 1, status: 'matched' } })),
        unwrap(api['intent-matches'].get({ query: { page: 1, limit: 1, outcome: 'pending' } })),
        unwrap(api['intent-matches'].get({ query: { page: 1, limit: 1, outcome: 'confirmed' } })),
      ])

      return {
        activeIntentCount: activeIntents?.total ?? 0,
        matchedIntentCount: matchedIntents?.total ?? 0,
        pendingMatchCount: pendingMatches?.total ?? 0,
        confirmedMatchCount: confirmedMatches?.total ?? 0,
      }
    },
    staleTime: 30 * 1000,
  })
}

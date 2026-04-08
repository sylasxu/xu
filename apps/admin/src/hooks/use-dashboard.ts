import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { queryKeys } from '@/lib/query-client'
import type { ContentAnalyticsResult } from '@/features/content-ops/data/schema'

interface HotKeywordAnalyticsItem {
  keyword: string
  hitCount: number
  conversionCount: number
  conversionRate: number
  trend: 'up' | 'down' | 'stable'
}

interface HotKeywordAnalyticsResponse {
  items: HotKeywordAnalyticsItem[]
}

export interface OperationsDashboardData {
  hotKeywords: {
    totalHits: number
    totalConversions: number
    overallConversionRate: number
    topKeywords: HotKeywordAnalyticsItem[]
    needsAttention: HotKeywordAnalyticsItem | null
  }
  content: {
    totalNotes: number
    pendingPerformanceCount: number
    highPerformingCount: number
    newFollowersTotal: number
    topNotes: ContentAnalyticsResult['topNotes']
    byType: ContentAnalyticsResult['byType']
  }
}

export function useOperationsDashboardData() {
  return useQuery({
    queryKey: queryKeys.dashboard.operations(),
    queryFn: async (): Promise<OperationsDashboardData> => {
      const [hotKeywordsAnalytics, contentAnalytics] = await Promise.all([
        unwrap(api['hot-keywords'].analytics.get({ query: { period: '7d' } })),
        unwrap(api.content.analytics.get()),
      ])

      const hotKeywordItems = (hotKeywordsAnalytics as HotKeywordAnalyticsResponse | null)?.items ?? []
      const totalHits = hotKeywordItems.reduce((sum, item) => sum + item.hitCount, 0)
      const totalConversions = hotKeywordItems.reduce((sum, item) => sum + item.conversionCount, 0)
      const overallConversionRate = totalHits > 0 ? (totalConversions / totalHits) * 100 : 0
      const topKeywords = [...hotKeywordItems]
        .sort((a, b) => {
          if (b.conversionRate !== a.conversionRate) {
            return b.conversionRate - a.conversionRate
          }

          return b.hitCount - a.hitCount
        })
        .slice(0, 3)
      const needsAttention = [...hotKeywordItems]
        .filter((item) => item.hitCount >= 10)
        .sort((a, b) => {
          const aGap = a.hitCount * (100 - a.conversionRate)
          const bGap = b.hitCount * (100 - b.conversionRate)
          return bGap - aGap
        })[0] ?? null

      const safeContentAnalytics: ContentAnalyticsResult = contentAnalytics ?? {
        byType: [],
        topNotes: [],
        totalNotes: 0,
        totalWithPerformance: 0,
        pendingPerformanceCount: 0,
        highPerformingCount: 0,
        newFollowersTotal: 0,
      }

      return {
        hotKeywords: {
          totalHits,
          totalConversions,
          overallConversionRate,
          topKeywords,
          needsAttention,
        },
        content: {
          totalNotes: safeContentAnalytics.totalNotes,
          pendingPerformanceCount: safeContentAnalytics.pendingPerformanceCount,
          highPerformingCount: safeContentAnalytics.highPerformingCount,
          newFollowersTotal: safeContentAnalytics.newFollowersTotal,
          topNotes: safeContentAnalytics.topNotes.slice(0, 3),
          byType: safeContentAnalytics.byType.slice(0, 3),
        },
      }
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })
}

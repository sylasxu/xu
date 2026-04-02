// 仪表板数据 Hooks - 使用真实 API
import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { queryKeys } from '@/lib/query-client'
import type { ContentAnalyticsResult } from '@/features/content-ops/data/schema'

// ==========================================
// God View 仪表盘数据类型 (Admin Cockpit Redesign)
// ==========================================

// 实时概览
export interface RealtimeOverview {
  activeUsers: number
  todayActivities: number
  tokenUsage: number
  totalConversations: number
}

// AI 健康度
export interface AIHealth {
  badCaseRate: number
  toolErrorRate: number
  avgResponseTime: number
  badCaseTrend: number
  toolErrorTrend: number
}

// 异常警报
export interface Alerts {
  errorCount24h: number
  sensitiveWordHits: number
  pendingModeration: number
}

// God View 完整数据
export interface GodViewData {
  realtime: RealtimeOverview
  northStar: {
    value: number
    benchmark: 'green' | 'yellow' | 'red'
    comparison?: string
    convertedUsers: number
    totalJoiners: number
  }
  aiHealth: AIHealth
  alerts: Alerts
}

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

// 获取 God View 仪表盘数据
export function useGodViewData() {
  return useQuery({
    queryKey: queryKeys.dashboard.godView(),
    queryFn: async (): Promise<GodViewData> => {
      const data = await unwrap(api.analytics['platform-overview'].get())
      return data as GodViewData
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })
}

// ==========================================
// 核心业务指标 (PRD 17.2-17.4)
// ==========================================

// 从 Eden Treaty 推导类型 (Single Source of Truth)
type ApiResponse<T> = T extends { get: () => Promise<{ data: infer R }> } ? R : never
type BusinessMetricsResponse = ApiResponse<typeof api.analytics.metrics>

// 导出类型供组件使用
export type BenchmarkStatus = 'green' | 'yellow' | 'red'
export type BusinessMetrics = NonNullable<BusinessMetricsResponse>
export type J2CMetric = BusinessMetrics['j2cRate']
export type WeeklyCompletedMetric = BusinessMetrics['weeklyCompletedCount']
export type MetricItem = BusinessMetrics['draftPublishRate']
export interface OperationsDashboardData {
  businessMetrics: BusinessMetrics
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

// 获取核心业务指标 - 使用真实 API
export function useBusinessMetrics() {
  return useQuery({
    queryKey: queryKeys.dashboard.businessMetrics(),
    queryFn: async () => {
      const response = await unwrap(api.analytics.metrics.get())
      return response
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })
}

export function useOperationsDashboardData() {
  return useQuery({
    queryKey: [...queryKeys.dashboard.all, 'operations'],
    queryFn: async (): Promise<OperationsDashboardData> => {
      const [businessMetrics, hotKeywordsAnalytics, contentAnalytics] = await Promise.all([
        unwrap(api.analytics.metrics.get()),
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
        businessMetrics: businessMetrics as BusinessMetrics,
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

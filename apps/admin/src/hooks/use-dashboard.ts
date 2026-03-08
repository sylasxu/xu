// 仪表板数据 Hooks - 使用真实 API
import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { queryKeys } from '@/lib/query-client'

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

// 获取 God View 仪表盘数据
export function useGodViewData() {
  return useQuery({
    queryKey: queryKeys.dashboard.godView(),
    queryFn: async (): Promise<GodViewData> => {
      const data = await unwrap(api.dashboard['god-view'].get())
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
type BusinessMetricsResponse = ApiResponse<typeof api.dashboard.metrics>

// 导出类型供组件使用
export type BenchmarkStatus = 'green' | 'yellow' | 'red'
export type BusinessMetrics = NonNullable<BusinessMetricsResponse>
export type J2CMetric = BusinessMetrics['j2cRate']
export type WeeklyCompletedMetric = BusinessMetrics['weeklyCompletedCount']
export type MetricItem = BusinessMetrics['draftPublishRate']

// 获取核心业务指标 - 使用真实 API
export function useBusinessMetrics() {
  return useQuery({
    queryKey: queryKeys.dashboard.businessMetrics(),
    queryFn: async () => {
      const response = await unwrap(api.dashboard.metrics.get())
      return response
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })
}

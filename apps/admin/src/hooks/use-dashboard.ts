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
  tokenCost: number
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
// 旧版仪表板数据类型（保留兼容）
// ==========================================

// 仪表板 KPI 数据类型 (MVP 简化版)
export interface DashboardKPIs {
  totalUsers: number
  activeUsers: number
  totalActivities: number
  userGrowthRate: number
  activeUserGrowthRate: number
  activityGrowthRate: number
}

// 用户增长趋势数据类型
export interface UserGrowthData {
  date: string
  totalUsers: number
  newUsers: number
  activeUsers: number
}

// 最新活动数据类型
export interface RecentActivity {
  id: string
  title: string
  type: string
  creatorName: string
  participantCount: number
  status: string
  createdAt: string
  location?: string
}

// 地理分布数据类型
export interface GeographicItem {
  name: string
  users: number
  activities: number
}

// 获取仪表板 KPI 数据 - 使用真实 API
export function useDashboardKPIs() {
  return useQuery({
    queryKey: queryKeys.dashboard.kpis(),
    queryFn: async (): Promise<DashboardKPIs> => {
      try {
        const stats = await unwrap(api.dashboard.stats.get())
        const statsData = stats as {
          totalUsers?: number
          activeUsers?: number
          totalActivities?: number
          userGrowthRate?: number
          activeUserGrowthRate?: number
          activityGrowthRate?: number
        }

        return {
          totalUsers: statsData.totalUsers || 0,
          activeUsers: statsData.activeUsers || 0,
          totalActivities: statsData.totalActivities || 0,
          userGrowthRate: statsData.userGrowthRate || 0,
          activeUserGrowthRate: statsData.activeUserGrowthRate || 0,
          activityGrowthRate: statsData.activityGrowthRate || 0,
        }
      } catch {
        // 如果 API 失败，返回默认值
        return {
          totalUsers: 0,
          activeUsers: 0,
          totalActivities: 0,
          userGrowthRate: 0,
          activeUserGrowthRate: 0,
          activityGrowthRate: 0,
        }
      }
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })
}

// 获取用户增长趋势数据 - 使用真实 API
export function useUserGrowthTrend(days: number = 30) {
  return useQuery({
    queryKey: queryKeys.dashboard.userGrowth(days),
    queryFn: async (): Promise<UserGrowthData[]> => {
      try {
        const response = await unwrap(
          api.dashboard['user-growth'].get({ query: { days: String(days) } })
        )
        const data = response as Array<{
          date: string
          totalUsers: number
          newUsers: number
          activeUsers: number
        }>
        return data.map(item => ({
          date: item.date,
          totalUsers: item.totalUsers,
          newUsers: item.newUsers,
          activeUsers: item.activeUsers,
        }))
      } catch {
        return []
      }
    },
    staleTime: 10 * 60 * 1000,
  })
}


// 获取最新活动列表 - 使用真实 API
export function useRecentActivities(limit: number = 10) {
  return useQuery({
    queryKey: queryKeys.dashboard.recentActivities(limit),
    queryFn: async (): Promise<RecentActivity[]> => {
      try {
        const response = await unwrap(api.dashboard.activities.get())
        const responseData = response as Array<{
          id: string
          title: string
          type: string
          creatorInfo?: { nickname: string }
          creatorName?: string
          participantCount?: number
          status: string
          createdAt: string
          locationName?: string
        }>

        return responseData.map((activity) => ({
          id: activity.id,
          title: activity.title,
          type: activity.type || 'other',
          creatorName: activity.creatorName || activity.creatorInfo?.nickname || '未知用户',
          participantCount: activity.participantCount || 0,
          status: activity.status,
          createdAt: activity.createdAt,
          location: activity.locationName,
        }))
      } catch {
        return []
      }
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  })
}

// 获取活动类型分布数据 - 使用真实 API
export function useActivityTypeDistribution() {
  return useQuery({
    queryKey: queryKeys.dashboard.activityTypes(),
    queryFn: async () => {
      try {
        const response = await unwrap(api.dashboard['activity-types'].get())
        return response as {
          food: number
          sports: number
          entertainment: number
          boardgame: number
          other: number
        }
      } catch {
        return { food: 0, sports: 0, entertainment: 0, boardgame: 0, other: 0 }
      }
    },
    staleTime: 10 * 60 * 1000,
  })
}

// 获取地理分布数据 - 使用真实 API
export function useGeographicDistribution() {
  return useQuery({
    queryKey: queryKeys.dashboard.geographic(),
    queryFn: async (): Promise<GeographicItem[]> => {
      try {
        const response = await unwrap(api.dashboard.geographic.get())
        return response as GeographicItem[]
      } catch {
        return []
      }
    },
    staleTime: 30 * 60 * 1000,
  })
}

// 实时数据刷新 Hook
export function useRealTimeUpdates() {
  const { refetch: refetchKPIs } = useDashboardKPIs()
  const { refetch: refetchActivities } = useRecentActivities()

  const refreshAll = () => {
    refetchKPIs()
    refetchActivities()
  }

  return { refreshAll }
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

// React Query 客户端配置
import { QueryClient } from '@tanstack/react-query'

// 创建 Query Client 实例
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 数据缓存时间 (5 分钟)
      staleTime: 5 * 60 * 1000,
      // 缓存保持时间 (10 分钟)
      gcTime: 10 * 60 * 1000,
      // 重试配置
      retry: (failureCount, error) => {
        // 对于 4xx 错误不重试
        if (error && typeof error === 'object' && 'status' in error) {
          const status = (error as { status: number }).status
          if (status >= 400 && status < 500) {
            return false
          }
        }
        // 最多重试 2 次
        return failureCount < 2
      },
      // 重试延迟
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // 错误处理在全局 QueryCache 中处理
    },
    mutations: {
      // 重试配置（变更操作通常不重试）
      retry: false,
    },
  },
})

// Query Keys 工厂函数
export const queryKeys = {
  // AI 相关
  ai: {
    all: ['ai'],
    conversations: () => [...queryKeys.ai.all, 'conversations'],
    conversationsList: (filters?: Record<string, any>) => [...queryKeys.ai.conversations(), 'list', filters],
    conversationDetail: (id: string) => [...queryKeys.ai.conversations(), 'detail', id],
    playground: () => [...queryKeys.ai.all, 'playground'],
  },
  
  // 用户相关
  users: {
    all: ['users'],
    lists: () => [...queryKeys.users.all, 'list'],
    list: (filters: Record<string, any>) => [...queryKeys.users.lists(), filters],
    details: () => [...queryKeys.users.all, 'detail'],
    detail: (id: string) => [...queryKeys.users.details(), id],
  },
  
  // 活动相关
  activities: {
    all: ['activities'],
    lists: () => [...queryKeys.activities.all, 'list'],
    list: (filters: Record<string, any>) => [...queryKeys.activities.lists(), filters],
    details: () => [...queryKeys.activities.all, 'detail'],
    detail: (id: string) => [...queryKeys.activities.details(), id],
    moderation: () => [...queryKeys.activities.all, 'moderation'],
  },
  
  // 仪表板相关
  dashboard: {
    all: ['dashboard'],
    businessMetrics: () => [...queryKeys.dashboard.all, 'businessMetrics'],
    godView: () => [...queryKeys.dashboard.all, 'godView'],
  },
  
  // 审核相关
  moderation: {
    all: ['moderation'],
    queue: (filters?: any) => [...queryKeys.moderation.all, 'queue', filters],
    stats: () => [...queryKeys.moderation.all, 'stats'],
    item: (id: string) => [...queryKeys.moderation.all, 'item', id],
    moderators: () => [...queryKeys.moderation.all, 'moderators'],
    history: (targetId: string, targetType: string) => [...queryKeys.moderation.all, 'history', targetId, targetType],
    reports: () => [...queryKeys.moderation.all, 'reports'],
  },
  
  // 风险管理相关
  risk: {
    all: ['risk'],
    assessments: (filters?: any) => [...queryKeys.risk.all, 'assessments', filters],
    assessment: (id: string) => [...queryKeys.risk.all, 'assessment', id],
    stats: () => [...queryKeys.risk.all, 'stats'],
    userReliability: (userId: string) => [...queryKeys.risk.all, 'userReliability', userId],
    disputes: (filters?: any) => [...queryKeys.risk.all, 'disputes', filters],
    dispute: (id: string) => [...queryKeys.risk.all, 'dispute', id],
    fraudDetections: (filters?: any) => [...queryKeys.risk.all, 'fraudDetections', filters],
    fraudDetection: (id: string) => [...queryKeys.risk.all, 'fraudDetection', id],
    trends: (timeRange: string) => [...queryKeys.risk.all, 'trends', timeRange],
    mitigation: () => [...queryKeys.risk.all, 'mitigation'],
  },
  
  // 增值服务相关
  premiumServices: {
    all: ['premiumServices'],
    stats: (timeRange?: string) => [...queryKeys.premiumServices.all, 'stats', timeRange],
    membership: () => [...queryKeys.premiumServices.all, 'membership'],
    aiQuota: (timeRange?: string) => [...queryKeys.premiumServices.all, 'aiQuota', timeRange],
    configs: () => [...queryKeys.premiumServices.all, 'configs'],
    config: (id: string) => [...queryKeys.premiumServices.all, 'config', id],
    conversionFunnel: (serviceType?: string) => [...queryKeys.premiumServices.all, 'conversionFunnel', serviceType],
    userJourney: (timeRange?: string) => [...queryKeys.premiumServices.all, 'userJourney', timeRange],
    performance: (serviceType: string, timeRange?: string) => [...queryKeys.premiumServices.all, 'performance', serviceType, timeRange],
  },
  
  // 系统相关
  system: {
    all: ['system'],
    configs: (filters?: any) => [...queryKeys.system.all, 'configs', filters],
    config: (id: string) => [...queryKeys.system.all, 'config', id],
    businessRules: () => [...queryKeys.system.all, 'businessRules'],
    businessRule: (id: string) => [...queryKeys.system.all, 'businessRule', id],
    featureFlags: () => [...queryKeys.system.all, 'featureFlags'],
    featureFlag: (id: string) => [...queryKeys.system.all, 'featureFlag', id],
    health: () => [...queryKeys.system.all, 'health'],
    announcements: () => [...queryKeys.system.all, 'announcements'],
    announcement: (id: string) => [...queryKeys.system.all, 'announcement', id],
    auditLogs: (filters?: any) => [...queryKeys.system.all, 'auditLogs', filters],
    maintenance: () => [...queryKeys.system.all, 'maintenance'],
  },
  
  // 地理管理相关
  geography: {
    all: ['geography'],
    heatmap: (filters?: any) => [...queryKeys.geography.all, 'heatmap', filters],
    userDistribution: (filters?: any) => [...queryKeys.geography.all, 'userDistribution', filters],
    regionPerformance: (filters?: any) => [...queryKeys.geography.all, 'regionPerformance', filters],
    locations: (filters?: any) => [...queryKeys.geography.all, 'locations', filters],
    location: (id: string) => [...queryKeys.geography.all, 'location', id],
    verifications: (filters?: any) => [...queryKeys.geography.all, 'verifications', filters],
    verification: (id: string) => [...queryKeys.geography.all, 'verification', id],
    privacyControls: () => [...queryKeys.geography.all, 'privacyControls'],
    privacyControl: (userId: string) => [...queryKeys.geography.all, 'privacyControl', userId],
  },
  
  // 沟通管理相关
  communication: {
    all: ['communication'],
    chat: {
      all: ['communication', 'chat'],
      messages: (filters?: any) => [...queryKeys.communication.chat.all, 'messages', filters],
      message: (id: string) => [...queryKeys.communication.chat.all, 'message', id],
      moderations: (messageId: string) => [...queryKeys.communication.chat.all, 'moderations', messageId],
    },
    notifications: {
      all: ['communication', 'notifications'],
      list: (filters?: any) => [...queryKeys.communication.notifications.all, 'list', filters],
      notification: (id: string) => [...queryKeys.communication.notifications.all, 'notification', id],
    },
    support: {
      all: ['communication', 'support'],
      requests: (filters?: any) => [...queryKeys.communication.support.all, 'requests', filters],
      request: (id: string) => [...queryKeys.communication.support.all, 'request', id],
      responses: (requestId: string) => [...queryKeys.communication.support.all, 'responses', requestId],
    },
    stats: () => [...queryKeys.communication.all, 'stats'],
  },
}

// 缓存失效工具函数
export const invalidateQueries = {
  // AI 相关缓存失效
  ai: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.ai.all }),
    conversations: () => queryClient.invalidateQueries({ queryKey: queryKeys.ai.conversations() }),
    conversationDetail: (id: string) => queryClient.invalidateQueries({ queryKey: queryKeys.ai.conversationDetail(id) }),
  },
  
  // 用户相关缓存失效
  users: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
    lists: () => queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() }),
    detail: (id: string) => queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(id) }),
  },
  
  // 活动相关缓存失效
  activities: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.activities.all }),
    lists: () => queryClient.invalidateQueries({ queryKey: queryKeys.activities.lists() }),
    detail: (id: string) => queryClient.invalidateQueries({ queryKey: queryKeys.activities.detail(id) }),
    moderation: () => queryClient.invalidateQueries({ queryKey: queryKeys.activities.moderation() }),
  },
  
  // 仪表板相关缓存失效
  dashboard: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    businessMetrics: () => queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.businessMetrics() }),
    godView: () => queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.godView() }),
  },
  
  // 审核相关缓存失效
  moderation: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.moderation.all }),
    queue: () => queryClient.invalidateQueries({ queryKey: queryKeys.moderation.queue() }),
    reports: () => queryClient.invalidateQueries({ queryKey: queryKeys.moderation.reports() }),
  },
  
  // 风险管理相关缓存失效
  risk: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.risk.all }),
    assessments: () => queryClient.invalidateQueries({ queryKey: queryKeys.risk.assessments() }),
    disputes: () => queryClient.invalidateQueries({ queryKey: queryKeys.risk.disputes() }),
    fraudDetections: () => queryClient.invalidateQueries({ queryKey: queryKeys.risk.fraudDetections() }),
  },
  
  // 增值服务相关缓存失效
  premiumServices: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.premiumServices.all }),
    stats: () => queryClient.invalidateQueries({ queryKey: queryKeys.premiumServices.stats() }),
    membership: () => queryClient.invalidateQueries({ queryKey: queryKeys.premiumServices.membership() }),
    configs: () => queryClient.invalidateQueries({ queryKey: queryKeys.premiumServices.configs() }),
    aiQuota: () => queryClient.invalidateQueries({ queryKey: queryKeys.premiumServices.aiQuota() }),
  },
  
  // 系统相关缓存失效
  system: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.all }),
    configs: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.configs() }),
    businessRules: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.businessRules() }),
    featureFlags: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.featureFlags() }),
    health: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.health() }),
    announcements: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.announcements() }),
    auditLogs: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.auditLogs() }),
    maintenance: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.maintenance() }),
  },
  
  // 地理管理相关缓存失效
  geography: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.geography.all }),
    heatmap: () => queryClient.invalidateQueries({ queryKey: queryKeys.geography.heatmap() }),
    userDistribution: () => queryClient.invalidateQueries({ queryKey: queryKeys.geography.userDistribution() }),
    regionPerformance: () => queryClient.invalidateQueries({ queryKey: queryKeys.geography.regionPerformance() }),
    locations: () => queryClient.invalidateQueries({ queryKey: queryKeys.geography.locations() }),
    verifications: () => queryClient.invalidateQueries({ queryKey: queryKeys.geography.verifications() }),
    privacyControls: () => queryClient.invalidateQueries({ queryKey: queryKeys.geography.privacyControls() }),
  },
  
  // 沟通管理相关缓存失效
  communication: {
    all: () => queryClient.invalidateQueries({ queryKey: queryKeys.communication.all }),
    chat: () => queryClient.invalidateQueries({ queryKey: queryKeys.communication.chat.all }),
    notifications: () => queryClient.invalidateQueries({ queryKey: queryKeys.communication.notifications.all }),
    support: () => queryClient.invalidateQueries({ queryKey: queryKeys.communication.support.all }),
    stats: () => queryClient.invalidateQueries({ queryKey: queryKeys.communication.stats() }),
  },
}

// 预取数据工具函数
export const prefetchQueries = {
  // 预取用户列表
  usersList: (filters: Record<string, any> = {}) => {
    return queryClient.prefetchQuery({
      queryKey: queryKeys.users.list(filters),
      queryFn: async () => {
        // 这里会在具体的 hook 中实现
        return null
      },
    })
  },
  
  // 预取活动列表
  activitiesList: (filters: Record<string, any> = {}) => {
    return queryClient.prefetchQuery({
      queryKey: queryKeys.activities.list(filters),
      queryFn: async () => {
        // 这里会在具体的 hook 中实现
        return null
      },
    })
  },
}

// 乐观更新工具函数
export const optimisticUpdates = {
  // 用户状态更新
  updateUserStatus: (userId: string, status: string) => {
    queryClient.setQueryData(
      queryKeys.users.detail(userId),
      (oldData: any) => {
        if (!oldData) return oldData
        return { ...oldData, status }
      }
    )
  },
  
  // 活动状态更新
  updateActivityStatus: (activityId: string, status: string) => {
    queryClient.setQueryData(
      queryKeys.activities.detail(activityId),
      (oldData: any) => {
        if (!oldData) return oldData
        return { ...oldData, status }
      }
    )
  },
}

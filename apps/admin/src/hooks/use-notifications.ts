// 通知管理相关 Hooks
import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'

// 从 Eden Treaty 推导类型
type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never
type NotificationsResponse = ApiResponse<typeof api.notifications>

// 导出推导的类型
export type NotificationListResponse = NonNullable<NotificationsResponse>
export type Notification = NotificationListResponse['items'] extends (infer T)[] ? T : never

// 通知筛选参数类型 (前端特有，允许手动定义)
export interface NotificationFilters {
  page?: number
  limit?: number
  type?: string
}

// Query keys
const notificationKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
  list: (filters: NotificationFilters) =>
    [...notificationKeys.lists(), filters] as const,
}

// 获取通知列表
export function useNotificationsList(filters: NotificationFilters = {}) {
  const { page = 1, limit = 10, type } = filters

  return useQuery({
    queryKey: notificationKeys.list({ page, limit, type }),
    queryFn: async () => {
      const query: Record<string, unknown> = { scope: 'all', page, limit }
      if (type && type !== 'all') query.type = type
      const result = await unwrap(api.notifications.get({ query }))
      return result
    },
    staleTime: 2 * 60 * 1000,
  })
}

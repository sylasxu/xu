// AI 额度管理相关 Hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'

const DAILY_QUOTA_LIMIT = 3

// 从 Eden Treaty 推导类型
type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never
type UsersResponse = ApiResponse<typeof api.users>

// 导出推导的类型
export type UserQuota = NonNullable<UsersResponse>['data'] extends (infer T)[] ? T : never

// 额度筛选参数类型 (前端特有，允许手动定义)
export interface QuotaFilters {
  page?: number
  limit?: number
  search?: string
  usageStatus?: 'all' | 'used' | 'unused'
}

// Query keys
const quotaKeys = {
  all: ['quota'] as const,
  lists: () => [...quotaKeys.all, 'list'] as const,
  list: (filters: QuotaFilters) => [...quotaKeys.lists(), filters] as const,
}

// 获取用户额度列表
export function useQuotaList(filters: QuotaFilters = {}) {
  const { page = 1, limit = 10, search, usageStatus } = filters

  return useQuery({
    queryKey: quotaKeys.list({ page, limit, search, usageStatus }),
    queryFn: async () => {
      const result = await unwrap(
        api.users.get({
          query: {
            page,
            limit,
            search: search || undefined,
          },
        })
      )

      let users = (result?.data || [])

      // 客户端筛选额度使用状态
      if (usageStatus === 'used') {
        users = users.filter((u) => {
          const remaining = u.aiCreateQuotaToday ?? DAILY_QUOTA_LIMIT
          return remaining < DAILY_QUOTA_LIMIT && remaining <= DAILY_QUOTA_LIMIT
        })
      } else if (usageStatus === 'unused') {
        users = users.filter(
          (u) => (u.aiCreateQuotaToday ?? DAILY_QUOTA_LIMIT) === DAILY_QUOTA_LIMIT
        )
      }

      return {
        data: users,
        total: result?.total || 0,
        page: result?.page || 1,
        limit: result?.limit || limit,
      }
    },
    staleTime: 2 * 60 * 1000,
  })
}

// 设置单个用户额度
export function useSetUserQuota() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, quota }: { userId: string; quota: number }) => {
      return await unwrap(
        api.users({ id: userId }).quota.put({ quota })
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: quotaKeys.all })
      toast.success('额度已更新')
    },
    onError: (error: Error) => {
      toast.error(`更新失败: ${error.message}`)
    },
  })
}

// 批量设置用户额度
export function useSetUserQuotaBatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userIds, quota }: { userIds: string[]; quota: number }) => {
      return await unwrap(
        api.users.quota.batch.post({ userIds, quota })
      )
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: quotaKeys.all })
      toast.success(`已更新 ${data?.count || 0} 个用户的额度`)
    },
    onError: (error: Error) => {
      toast.error(`批量更新失败: ${error.message}`)
    },
  })
}

// 导出常量
export { DAILY_QUOTA_LIMIT }

// 举报管理相关 Hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'

// 从 Eden Treaty 推导类型
type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never
type ReportsResponse = ApiResponse<typeof api.reports>

// 导出推导的类型
export type ReportListResponse = NonNullable<ReportsResponse>
export type Report = ReportListResponse['items'] extends (infer T)[] ? T : never

// 举报筛选参数类型 (前端特有，允许手动定义)
export interface ReportFilters {
  page?: number
  limit?: number
  status?: 'pending' | 'resolved' | 'ignored'
  type?: 'activity' | 'message' | 'user'
}

// Query keys
const reportKeys = {
  all: ['reports'] as const,
  lists: () => [...reportKeys.all, 'list'] as const,
  list: (filters: ReportFilters) => [...reportKeys.lists(), filters] as const,
  details: () => [...reportKeys.all, 'detail'] as const,
  detail: (id: string) => [...reportKeys.details(), id] as const,
}

// 获取举报列表
export function useReportsList(filters: ReportFilters = {}) {
  const { page = 1, limit = 10, status, type } = filters

  return useQuery({
    queryKey: reportKeys.list({ page, limit, status, type }),
    queryFn: async () => {
      const query: Record<string, unknown> = { page, limit }
      if (status) query.status = status
      if (type) query.type = type
      const result = await unwrap(api.reports.get({ query }))
      return result
    },
    staleTime: 2 * 60 * 1000,
  })
}

// 更新举报状态
export function useUpdateReport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      status,
      adminNote,
    }: {
      id: string
      status: 'resolved' | 'ignored'
      adminNote?: string
    }) => {
      return unwrap(api.reports({ id }).patch({ status, adminNote }))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportKeys.all })
      toast.success('举报状态已更新')
    },
    onError: (error: Error) => {
      toast.error(`更新失败: ${error.message}`)
    },
  })
}

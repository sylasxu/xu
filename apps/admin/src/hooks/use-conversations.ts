import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'

// 从 Eden Treaty 推导类型
type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never
type SessionsResponse = ApiResponse<typeof api.ai.sessions>
type SessionDetailResponse = ApiResponse<ReturnType<typeof api.ai.sessions>>

// 导出推导的类型
export type SessionsListResponse = NonNullable<SessionsResponse>
export type ConversationSession = SessionsListResponse['items'] extends (infer T)[] ? T : never
export type SessionDetail = NonNullable<SessionDetailResponse>
export type ConversationMessage = SessionDetail['messages'] extends (infer T)[] ? T : never

// 统计数据类型
export interface SessionsStats {
  total: number
  todayNew: number
  avgMessages: number
  errorCount: number
}

interface SessionsListParams {
  page?: number
  limit?: number
  userId?: string
  startDate?: string
  endDate?: string
  // v4.6: 评估筛选
  evaluationStatus?: 'unreviewed' | 'good' | 'bad'
  hasError?: boolean
}

// 获取会话列表
export function useSessionsList(params: SessionsListParams = {}) {
  const { page = 1, limit = 20, userId, startDate, endDate, evaluationStatus, hasError } = params

  return useQuery({
    queryKey: ['conversations', 'sessions', { page, limit, userId, startDate, endDate, evaluationStatus, hasError }],
    queryFn: async () => {
      const result = await unwrap(
        api.ai.sessions.get({
          query: {
            page,
            limit,
            userId: userId || undefined,
            // v4.6: 评估筛选
            evaluationStatus: evaluationStatus || undefined,
            hasError: hasError,
          },
        })
      )

      // 客户端日期过滤（API 暂不支持日期参数）
      let items = result?.items || []
      if (startDate || endDate) {
        items = items.filter(item => {
          const itemDate = new Date(item.lastMessageAt).toISOString().split('T')[0]
          if (startDate && itemDate < startDate) return false
          if (endDate && itemDate > endDate) return false
          return true
        })
      }

      return {
        data: items,
        total: result?.total || 0,
      }
    },
  })
}

// 获取会话统计数据
export function useSessionsStats() {
  return useQuery({
    queryKey: ['conversations', 'stats'],
    queryFn: async () => {
      // 获取所有会话用于统计
      const result = await unwrap(
        api.ai.sessions.get({
          query: { page: 1, limit: 1000 },
        })
      )

      const items = result?.items || []
      const total = result?.total || 0

      // 计算今日新增
      const today = new Date().toISOString().split('T')[0]
      const todayNew = items.filter(item =>
        item.createdAt.split('T')[0] === today
      ).length

      // 计算平均消息数
      const totalMessages = items.reduce((sum, item) => sum + item.messageCount, 0)
      const avgMessages = items.length > 0 ? totalMessages / items.length : 0

      // v4.6: 错误会话数（使用 hasError 字段）
      const errorCount = items.filter(item => item.hasError).length

      return {
        total,
        todayNew,
        avgMessages,
        errorCount,
      } as SessionsStats
    },
  })
}

// 获取会话详情（消息列表）
export function useConversationDetail(
  conversationId: string | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['conversations', 'detail', conversationId],
    queryFn: async () => {
      if (!conversationId) return null

      const result = await unwrap(
        api.ai.sessions({ id: conversationId }).get()
      )

      return result
    },
    enabled: !!conversationId && enabled,
  })
}

// 删除单个会话
export function useDeleteSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      return await unwrap(api.ai.sessions({ id }).delete())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'sessions'] })
      toast.success('会话已删除')
    },
    onError: (error: Error) => {
      toast.error(`删除失败: ${error.message}`)
    },
  })
}

// 批量删除会话
export function useDeleteSessionsBatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (ids: string[]) => {
      return await unwrap(
        api.ai.sessions['batch-delete'].post({ ids })
      )
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'sessions'] })
      toast.success(`已删除 ${data?.count || 0} 个会话`)
    },
    onError: (error: Error) => {
      toast.error(`批量删除失败: ${error.message}`)
    },
  })
}

// ==========================================
// v4.6: 会话评估 (Admin Command Center)
// ==========================================

interface EvaluateParams {
  conversationId: string
  status: 'good' | 'bad'
  tags?: string[]
  note?: string
}

// 评估会话
export function useEvaluateSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ conversationId, status, tags, note }: EvaluateParams) => {
      return await unwrap(
        api.ai.sessions({ id: conversationId }).evaluate.patch({
          status,
          tags,
          note,
        })
      )
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'sessions'] })
      queryClient.invalidateQueries({ queryKey: ['conversations', 'detail', variables.conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations', 'stats'] })
      toast.success(variables.status === 'good' ? '已标记为 Good Case' : '已标记为 Bad Case')
    },
    onError: (error: Error) => {
      toast.error(`评估失败: ${error.message}`)
    },
  })
}

// 获取内容预览
export function getContentPreview(content: unknown): string {
  if (typeof content === 'string') {
    return content.slice(0, 50)
  }
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>
    if ('text' in obj && typeof obj.text === 'string') {
      return obj.text.slice(0, 50)
    }
    if ('title' in obj && typeof obj.title === 'string') {
      return obj.title
    }
  }
  return '[Widget]'
}

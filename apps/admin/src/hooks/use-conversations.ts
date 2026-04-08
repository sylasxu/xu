import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, unwrap } from '@/lib/eden'

type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never
type SessionsResponse = ApiResponse<typeof api.ai.sessions>
type SessionDetailResponse = ApiResponse<ReturnType<typeof api.ai.sessions>>

export type SessionsListResponse = NonNullable<SessionsResponse>
export type ConversationSession = SessionsListResponse['items'] extends (infer T)[] ? T : never
export type SessionDetail = NonNullable<SessionDetailResponse>
export type ConversationMessage = SessionDetail['messages'] extends (infer T)[] ? T : never

interface SessionsListParams {
  page?: number
  limit?: number
  userId?: string
  startDate?: string
  endDate?: string
  evaluationStatus?: 'unreviewed' | 'good' | 'bad'
  hasError?: boolean
}

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
            evaluationStatus: evaluationStatus || undefined,
            hasError,
          },
        }),
      )

      let items = result?.items || []
      if (startDate || endDate) {
        items = items.filter((item) => {
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

export function useConversationDetail(conversationId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['conversations', 'detail', conversationId],
    queryFn: async () => {
      if (!conversationId) return null
      return unwrap(api.ai.sessions({ id: conversationId }).get())
    },
    enabled: !!conversationId && enabled,
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => unwrap(api.ai.sessions({ id }).delete()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'sessions'] })
      toast.success('会话已删除')
    },
    onError: (error: Error) => {
      toast.error(`删除失败: ${error.message}`)
    },
  })
}

export function useDeleteSessionsBatch() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (ids: string[]) => unwrap(api.ai.sessions['batch-delete'].post({ ids })),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'sessions'] })
      toast.success(`已删除 ${data?.count || 0} 个会话`)
    },
    onError: (error: Error) => {
      toast.error(`批量删除失败: ${error.message}`)
    },
  })
}

interface EvaluateParams {
  conversationId: string
  status: 'good' | 'bad'
  tags?: string[]
  note?: string
}

export function useEvaluateSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ conversationId, status, tags, note }: EvaluateParams) =>
      unwrap(
        api.ai.sessions({ id: conversationId }).evaluate.patch({
          status,
          tags,
          note,
        }),
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', 'sessions'] })
      queryClient.invalidateQueries({ queryKey: ['conversations', 'detail', variables.conversationId] })
      toast.success(variables.status === 'good' ? '已标记为 Good Case' : '已标记为 Bad Case')
    },
    onError: (error: Error) => {
      toast.error(`评估失败: ${error.message}`)
    },
  })
}

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

// Moderation Hooks - 风险审核
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'

interface ModerationQuery {
  page?: number
  limit?: number
}

/**
 * 获取审核队列
 */
export function useModerationQueue(query: ModerationQuery = {}) {
  return useQuery({
    queryKey: ['moderation', 'queue', query],
    queryFn: () => unwrap(api.ai.security.moderation.queue.get({ query })),
    refetchInterval: 30000, // 30秒自动刷新
  })
}

/**
 * 审核通过
 */
export function useApproveModeration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => 
      unwrap(api.ai.security.moderation({ id }).approve.post()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderation', 'queue'] })
      toast.success('已通过审核')
    },
    onError: (error: Error) => toast.error(`操作失败: ${error.message}`),
  })
}

/**
 * 审核拒绝（删除内容）
 */
export function useRejectModeration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => 
      unwrap(api.ai.security.moderation({ id }).reject.post()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderation', 'queue'] })
      toast.success('已删除内容')
    },
    onError: (error: Error) => toast.error(`操作失败: ${error.message}`),
  })
}

/**
 * 审核拒绝并封号
 */
export function useBanModeration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => 
      unwrap(api.ai.security.moderation({ id }).ban.post()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderation', 'queue'] })
      toast.success('已删除内容并封禁用户')
    },
    onError: (error: Error) => toast.error(`操作失败: ${error.message}`),
  })
}

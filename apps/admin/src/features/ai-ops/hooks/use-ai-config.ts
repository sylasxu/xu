// AI Config Hooks — Eden Treaty + React Query
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'

// Query keys
const aiConfigKeys = {
  all: ['ai-configs'] as const,
  lists: () => [...aiConfigKeys.all, 'list'] as const,
  detail: (key: string) => [...aiConfigKeys.all, 'detail', key] as const,
  history: (key: string) => [...aiConfigKeys.all, 'history', key] as const,
}

// 配置项类型（前端特有，无对应 DB 表）
export interface AiConfigItem {
  configKey: string
  configValue: unknown
  description: string | null
  version: number
  updatedAt: string
}

export interface AiConfigHistory {
  version: number
  configValue: unknown
  updatedAt: string
  updatedBy: string | null
}

// 获取所有配置（按 category 分组）
export function useAiConfigs() {
  return useQuery({
    queryKey: aiConfigKeys.lists(),
    queryFn: () => unwrap(api.ai.configs.get()),
    staleTime: 30_000,
  })
}

// 获取单个配置
export function useAiConfigDetail(configKey: string) {
  return useQuery({
    queryKey: aiConfigKeys.detail(configKey),
    queryFn: () => unwrap(api.ai.configs({ configKey }).get()),
    enabled: !!configKey,
    staleTime: 30_000,
  })
}

// 获取配置变更历史
export function useAiConfigHistory(configKey: string) {
  return useQuery({
    queryKey: aiConfigKeys.history(configKey),
    queryFn: () => unwrap(api.ai.configs({ configKey }).history.get()),
    enabled: !!configKey,
  })
}

// 更新配置
export function useUpdateAiConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ configKey, configValue }: { configKey: string; configValue: unknown }) => {
      return unwrap(api.ai.configs({ configKey }).put({ configValue }))
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: aiConfigKeys.all })
      toast.success(`配置 ${variables.configKey} 已更新`)
    },
    onError: (error: Error) => toast.error(`更新失败: ${error.message}`),
  })
}

// 回滚配置
export function useRollbackAiConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ configKey, targetVersion }: { configKey: string; targetVersion: number }) => {
      return unwrap(api.ai.configs({ configKey }).rollback.post({ targetVersion }))
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: aiConfigKeys.all })
      toast.success(`已回滚到版本 ${variables.targetVersion}`)
    },
    onError: (error: Error) => toast.error(`回滚失败: ${error.message}`),
  })
}

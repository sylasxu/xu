import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'
import type { GenerateRequest, ContentFilters, PerformanceUpdate } from '../data/schema'

export function useGenerateNotes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: GenerateRequest) =>
      unwrap(api.growth.content.generate.post(params)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-library'] })
      toast.success('笔记生成成功')
    },
    onError: (error: Error) => toast.error(`生成失败: ${error.message}`),
  })
}

export function useContentLibrary(filters: ContentFilters) {
  return useQuery({
    queryKey: ['content-library', filters],
    queryFn: () =>
      unwrap(api.growth.content.library.get({ query: filters as any })),
  })
}

export function useContentDetail(id: string) {
  return useQuery({
    queryKey: ['content-detail', id],
    queryFn: () => unwrap(api.growth.content.library({ id }).get()),
    enabled: !!id,
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.growth.content.library({ id }).delete()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-library'] })
      toast.success('笔记已删除')
    },
    onError: (error: Error) => toast.error(`删除失败: ${error.message}`),
  })
}

export function useUpdatePerformance() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PerformanceUpdate }) =>
      unwrap(api.growth.content.library({ id }).performance.put(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-library'] })
      queryClient.invalidateQueries({ queryKey: ['content-detail'] })
      queryClient.invalidateQueries({ queryKey: ['content-analytics'] })
      toast.success('效果数据已更新')
    },
    onError: (error: Error) => toast.error(`更新失败: ${error.message}`),
  })
}

export function useContentAnalytics() {
  return useQuery({
    queryKey: ['content-analytics'],
    queryFn: () => unwrap(api.growth.content.analytics.get()),
  })
}

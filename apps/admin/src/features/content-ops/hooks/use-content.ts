import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'
import type { GenerateRequest, ContentFilters, PerformanceUpdate } from '../data/schema'

/**
 * Content Hooks - 内容运营
 * 已迁移到领域化架构：/content/*
 */

export function useGenerateNotes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: GenerateRequest) =>
      // 已迁移：从 /growth/content/generate 到 /content/generate
      unwrap(api.content.generate.post(params)),
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
      // 已迁移：从 /growth/content/library 到 /content/library
      unwrap(api.content.library.get({ query: filters as any })),
  })
}

export function useContentDetail(id: string) {
  return useQuery({
    queryKey: ['content-detail', id],
    queryFn: () => 
      // 已迁移：从 /growth/content/library/:id 到 /content/library/:id
      unwrap(api.content.library({ id }).get()),
    enabled: !!id,
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      // 已迁移：从 /growth/content/library/:id 到 /content/library/:id
      unwrap(api.content.library({ id }).delete()),
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
      // 已迁移：从 /growth/content/library/:id/performance 到 /content/library/:id/performance
      unwrap(api.content.library({ id }).performance.put(data)),
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
    queryFn: () => 
      // 已迁移：从 /growth/content/analytics 到 /analytics/content-performance
      unwrap(api.analytics['content-performance'].get()),
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'
import type {
  ContentAnalyticsResult,
  ContentFilters,
  ContentLibraryResult,
  ContentNote,
  GenerateRequest,
  PerformanceUpdate,
  TopicSuggestionRequest,
  TopicSuggestionResult,
} from '../data/schema'

/**
 * Content Hooks - 内容运营
 */

const EMPTY_TOPIC_SUGGESTIONS: TopicSuggestionResult = {
  items: [],
}

const EMPTY_CONTENT_LIBRARY: ContentLibraryResult = {
  items: [],
  total: 0,
  page: 1,
  limit: 10,
}

const EMPTY_CONTENT_ANALYTICS: ContentAnalyticsResult = {
  byType: [],
  topNotes: [],
  totalNotes: 0,
  totalWithPerformance: 0,
  pendingPerformanceCount: 0,
  highPerformingCount: 0,
  newFollowersTotal: 0,
}

export function useGenerateNotes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: GenerateRequest): Promise<ContentNote[]> =>
      // 内容生成统一走 /content/generate
      (await unwrap(api.content.generate.post(params))) ?? [],
    onSuccess: async (notes) => {
      for (const note of notes) {
        queryClient.setQueryData(['content-detail', note.id], note)
      }

      queryClient.invalidateQueries({ queryKey: ['content-library'] })
      toast.success('笔记生成成功')
    },
  })
}

export function useTopicSuggestions(params: TopicSuggestionRequest, refreshKey = 0) {
  return useQuery<TopicSuggestionResult>({
    queryKey: ['content-topic-suggestions', params, refreshKey],
    queryFn: async () =>
      (await unwrap(api.content['topic-suggestions'].post(params))) ?? EMPTY_TOPIC_SUGGESTIONS,
  })
}

export function useContentLibrary(filters: ContentFilters) {
  return useQuery<ContentLibraryResult>({
    queryKey: ['content-library', filters],
    queryFn: async () => {
      const result = await unwrap(api.content.library.get({ query: filters }))

      return result ?? {
        ...EMPTY_CONTENT_LIBRARY,
        page: filters.page,
        limit: filters.limit,
      }
    },
  })
}

export function useContentAnalytics() {
  return useQuery<ContentAnalyticsResult>({
    queryKey: ['content-analytics'],
    queryFn: async () => (await unwrap(api.content.analytics.get())) ?? EMPTY_CONTENT_ANALYTICS,
  })
}

export function useContentDetail(id: string) {
  return useQuery<ContentNote | null>({
    queryKey: ['content-detail', id],
    queryFn: () => unwrap(api.content.library({ id }).get()),
    enabled: !!id,
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      // 内容删除统一走 /content/library/:id
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
      // 内容效果统一走 /content/library/:id/performance
      unwrap(api.content.library({ id }).performance.put(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-library'] })
      queryClient.invalidateQueries({ queryKey: ['content-detail'] })
      toast.success('效果数据已更新')
    },
    onError: (error: Error) => toast.error(`更新失败: ${error.message}`),
  })
}

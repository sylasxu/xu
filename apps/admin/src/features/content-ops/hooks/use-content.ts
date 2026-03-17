import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'
import type {
  AnalyticsData,
  ContentFilters,
  ContentLibraryResult,
  ContentNote,
  GenerateRequest,
  PerformanceUpdate,
} from '../data/schema'
import { isContentType } from '../data/schema'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readContentType(value: unknown): ContentNote['contentType'] | null {
  return typeof value === 'string' && isContentType(value) ? value : null
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readContentNote(value: unknown): ContentNote | null {
  if (!isRecord(value)) {
    return null
  }

  const id = typeof value.id === 'string' ? value.id : null
  const topic = typeof value.topic === 'string' ? value.topic : null
  const contentType = readContentType(value.contentType)
  const batchId = typeof value.batchId === 'string' ? value.batchId : null
  const title = typeof value.title === 'string' ? value.title : null
  const body = typeof value.body === 'string' ? value.body : null
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : null
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null

  if (!id || !topic || !contentType || !batchId || !title || !body || !createdAt || !updatedAt) {
    return null
  }

  return {
    id,
    topic,
    contentType,
    batchId,
    title,
    body,
    hashtags: readStringList(value.hashtags),
    coverImageHint: typeof value.coverImageHint === 'string' ? value.coverImageHint : null,
    views: readNullableNumber(value.views),
    likes: readNullableNumber(value.likes),
    collects: readNullableNumber(value.collects),
    comments: readNullableNumber(value.comments),
    newFollowers: readNullableNumber(value.newFollowers),
    createdAt,
    updatedAt,
  }
}

function readContentLibraryResult(value: unknown): ContentLibraryResult {
  if (!isRecord(value)) {
    return { items: [], total: 0, page: 1, limit: 20 }
  }

  const items = Array.isArray(value.items)
    ? value.items
        .map((item) => readContentNote(item))
        .filter((item): item is ContentNote => item !== null)
    : []

  return {
    items,
    total: typeof value.total === 'number' ? value.total : 0,
    page: typeof value.page === 'number' ? value.page : 1,
    limit: typeof value.limit === 'number' ? value.limit : 20,
  }
}

function readAnalyticsData(value: unknown): AnalyticsData | null {
  if (!isRecord(value)) {
    return null
  }

  const byType = Array.isArray(value.byType)
    ? value.byType
        .map((item) => {
          if (!isRecord(item)) {
            return null
          }

          const contentType = readContentType(item.contentType)
          if (!contentType) {
            return null
          }

          return {
            contentType,
            avgViews: typeof item.avgViews === 'number' ? item.avgViews : 0,
            avgLikes: typeof item.avgLikes === 'number' ? item.avgLikes : 0,
            avgCollects: typeof item.avgCollects === 'number' ? item.avgCollects : 0,
            count: typeof item.count === 'number' ? item.count : 0,
          }
        })
        .filter((item): item is AnalyticsData['byType'][number] => item !== null)
    : []

  const topNotes = Array.isArray(value.topNotes)
    ? value.topNotes
        .map((item) => readContentNote(item))
        .filter((item): item is ContentNote => item !== null)
    : []

  return {
    byType,
    topNotes,
    totalNotes: typeof value.totalNotes === 'number' ? value.totalNotes : 0,
    totalWithPerformance: typeof value.totalWithPerformance === 'number' ? value.totalWithPerformance : 0,
  }
}

export function useContentLibrary(filters: ContentFilters) {
  return useQuery({
    queryKey: ['content-library', filters],
    queryFn: async () => {
      const result = await unwrap(api.content.library.get({ query: filters }))
      return readContentLibraryResult(result)
    },
  })
}

export function useContentDetail(id: string) {
  return useQuery({
    queryKey: ['content-detail', id],
    queryFn: async () => {
      const result = await unwrap(api.content.library({ id }).get())
      return readContentNote(result)
    },
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
    queryFn: async () => {
      const result = await unwrap(api.analytics['content-performance'].get())
      return readAnalyticsData(result)
    },
  })
}

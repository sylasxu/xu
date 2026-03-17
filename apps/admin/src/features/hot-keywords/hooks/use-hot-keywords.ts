// Hot Keywords Hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'
import type { 
  GlobalKeyword, 
  CreateGlobalKeywordRequest, 
  UpdateGlobalKeywordRequest,
  HotKeywordsFilters 
} from '../data/schema'

// Query keys
const hotKeywordsKeys = {
  all: ['hot-keywords'] as const,
  lists: () => [...hotKeywordsKeys.all, 'list'] as const,
  list: (filters: HotKeywordsFilters) => [...hotKeywordsKeys.lists(), filters] as const,
  details: () => [...hotKeywordsKeys.all, 'detail'] as const,
  detail: (id: string) => [...hotKeywordsKeys.details(), id] as const,
}

// 获取热词列表
export function useHotKeywordsList(filters: HotKeywordsFilters = {}) {
  return useQuery({
    queryKey: hotKeywordsKeys.list(filters),
    queryFn: async () => {
      const result = await unwrap(
        api['hot-keywords'].get({ 
          query: {
            detail: true,
            isActive: filters.isActive,
            matchType: filters.matchType,
            responseType: filters.responseType,
          } 
        })
      )
      
      if (!result) {
        return { data: [], total: 0 }
      }
      
      let keywords = result.items as GlobalKeyword[]
      
      // 前端过滤（搜索）
      if (filters.filter) {
        const searchLower = filters.filter.toLowerCase()
        keywords = keywords.filter(kw => 
          kw.keyword.toLowerCase().includes(searchLower)
        )
      }
      
      // 前端排序
      if (filters.sortBy) {
        keywords = [...keywords].sort((a, b) => {
          let aVal: number, bVal: number
          
          if (filters.sortBy === 'hitCount') {
            aVal = a.hitCount
            bVal = b.hitCount
          } else if (filters.sortBy === 'conversionRate') {
            aVal = a.hitCount > 0 ? (a.conversionCount / a.hitCount) : 0
            bVal = b.hitCount > 0 ? (b.conversionCount / b.hitCount) : 0
          } else { // createdAt
            aVal = new Date(a.createdAt).getTime()
            bVal = new Date(b.createdAt).getTime()
          }
          
          return filters.sortOrder === 'asc' ? aVal - bVal : bVal - aVal
        })
      }
      
      // 前端分页
      const page = filters.page || 1
      const limit = filters.limit || 10
      const start = (page - 1) * limit
      const end = start + limit
      const paginatedData = keywords.slice(start, end)
      
      return {
        data: paginatedData,
        total: keywords.length,
      }
    },
    staleTime: 2 * 60 * 1000,
  })
}

// 获取热词详情
export function useHotKeywordDetail(id: string) {
  return useQuery({
    queryKey: hotKeywordsKeys.detail(id),
    queryFn: async () => {
      // 通过列表接口获取所有数据，然后找到对应的热词
      const result = await unwrap(
        api['hot-keywords'].get({ query: { detail: true } })
      )
      if (!result) {
        throw new Error('获取热词列表失败')
      }
      const keyword = (result.items as GlobalKeyword[]).find(kw => kw.id === id)
      if (!keyword) {
        throw new Error('热词不存在')
      }
      return keyword
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

// 创建热词
export function useCreateHotKeyword() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (data: CreateGlobalKeywordRequest) => {
      return unwrap(api['hot-keywords'].post(data))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hotKeywordsKeys.all })
      toast.success('热词创建成功')
    },
    onError: (error: Error) => {
      toast.error(`创建失败: ${error.message}`)
    },
  })
}

// 更新热词
export function useUpdateHotKeyword() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateGlobalKeywordRequest }) => {
      return unwrap(api['hot-keywords']({ id }).patch(data))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hotKeywordsKeys.all })
      toast.success('热词更新成功')
    },
    onError: (error: Error) => {
      toast.error(`更新失败: ${error.message}`)
    },
  })
}

// 删除热词
export function useDeleteHotKeyword() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      return unwrap(api['hot-keywords']({ id }).delete())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hotKeywordsKeys.all })
      toast.success('热词已删除')
    },
    onError: (error: Error) => {
      toast.error(`删除失败: ${error.message}`)
    },
  })
}

// 批量更新状态
export function useBatchUpdateStatus() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ ids, isActive }: { ids: string[]; isActive: boolean }) => {
      // 批量调用更新接口
      await Promise.all(
        ids.map(id => unwrap(api['hot-keywords']({ id }).patch({ isActive })))
      )
      return { count: ids.length }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: hotKeywordsKeys.all })
      toast.success(`已更新 ${data.count} 个热词的状态`)
    },
    onError: (error: Error) => {
      toast.error(`批量更新失败: ${error.message}`)
    },
  })
}

// 批量删除
export function useBatchDeleteHotKeywords() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (ids: string[]) => {
      // 批量调用删除接口
      await Promise.all(
        ids.map(id => unwrap(api['hot-keywords']({ id }).delete()))
      )
      return { count: ids.length }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: hotKeywordsKeys.all })
      toast.success(`已删除 ${data.count} 个热词`)
    },
    onError: (error: Error) => {
      toast.error(`批量删除失败: ${error.message}`)
    },
  })
}

// 获取热词分析数据
export function useHotKeywordsAnalytics(period: '7d' | '30d' = '7d') {
  return useQuery({
    queryKey: [...hotKeywordsKeys.all, 'analytics', period],
    queryFn: async () => {
      const result = await unwrap(
        api['hot-keywords'].analytics.get({ 
          query: { period } 
        })
      )
      return result
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

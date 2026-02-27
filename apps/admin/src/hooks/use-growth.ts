// Growth Hooks - 增长工具
// 已迁移到领域化架构：
// - 趋势分析 → /analytics/trends
// - 内容生成 → /ai/generate/content

import { useMutation, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { toast } from 'sonner'

interface GeneratePosterParams {
  text: string
  style: 'minimal' | 'cyberpunk' | 'handwritten'
}

/**
 * 生成海报文案
 * 已迁移：使用 AI 领域的内容生成能力
 */
export function useGeneratePoster() {
  return useMutation({
    mutationFn: (params: GeneratePosterParams) =>
      unwrap(api.ai['generate']['content'].post({
        topic: params.text,
        contentType: 'poster',
        style: params.style,
        count: 1,
      })),
    onError: (error: Error) => toast.error(`生成失败: ${error.message}`),
  })
}

/**
 * 获取热门洞察
 * 已迁移：使用 Analytics 领域的趋势分析能力
 */
export function useTrendInsights(period: '7d' | '30d' = '7d') {
  return useQuery({
    queryKey: ['trends', period],
    queryFn: () => unwrap(api.analytics.trends.get({ query: { period } })),
  })
}

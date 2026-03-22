import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'

// 内容方向的简单趋势参考
export function useContentTrends(period: '7d' | '30d' = '7d') {
  return useQuery({
    queryKey: ['content-trends', period],
    queryFn: () => unwrap(api.analytics.trends.get({ query: { period } })),
  })
}

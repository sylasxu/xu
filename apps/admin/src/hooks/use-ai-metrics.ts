import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'

interface MetricsQuery {
  startDate?: string
  endDate?: string
}

export function useTokenUsageStats(query: MetricsQuery = {}) {
  return useQuery({
    queryKey: ['ai', 'metrics', 'usage', query],
    queryFn: () => unwrap(api.ai.metrics.usage.get({ query })),
  })
}

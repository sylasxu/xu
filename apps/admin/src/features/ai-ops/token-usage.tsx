import { AlertTriangle, DollarSign, Loader2, RefreshCw, TrendingUp, Users } from 'lucide-react'
import { useTokenUsageStats } from '@/hooks/use-ai-metrics'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function TokenUsage() {
  const { data, isLoading, error, refetch } = useTokenUsageStats()

  if (isLoading) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    )
  }

  if (error) {
    return <div className='flex h-64 items-center justify-center text-destructive'>加载失败: {error.message}</div>
  }

  const summary = data?.summary
  const estimatedCost = ((summary?.totalTokens ?? 0) / 1000) * 0.002

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>用量统计</h1>
          <p className='text-muted-foreground'>只保留排查成本、调用量和失败热点需要看的几项。</p>
        </div>
        <Button variant='outline' size='sm' onClick={() => refetch()}>
          <RefreshCw className='mr-2 h-4 w-4' />
          刷新
        </Button>
      </div>

      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <MetricCard
          title='总 Token 数'
          icon={<TrendingUp className='h-4 w-4' />}
          value={summary?.totalTokens?.toLocaleString() ?? 0}
          hint={`输入: ${summary?.totalInputTokens?.toLocaleString() ?? 0} | 输出: ${summary?.totalOutputTokens?.toLocaleString() ?? 0}`}
        />
        <MetricCard
          title='总请求数'
          icon={<Users className='h-4 w-4' />}
          value={summary?.totalRequests?.toLocaleString() ?? 0}
          hint={`平均: ${summary?.avgTokensPerRequest?.toFixed(0) ?? 0} tokens/请求`}
        />
        <MetricCard
          title='成本粗估'
          icon={<DollarSign className='h-4 w-4' />}
          value={`¥${estimatedCost.toFixed(2)}`}
          hint='按内部统一系数粗估，仅供内部排查'
        />
        <MetricCard
          title='缓存命中率'
          value={`${((summary?.overallCacheHitRate ?? 0) * 100).toFixed(1)}%`}
          hint={`命中: ${summary?.totalCacheHitTokens?.toLocaleString() ?? 0} tokens`}
        />
      </div>

      {data?.toolCalls && data.toolCalls.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Tool 调用统计</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              {data.toolCalls.map((tool) => (
                <div key={tool.toolName} className='flex items-center justify-between border-b py-2 last:border-0'>
                  <div className='flex items-center gap-2'>
                    <span className='font-mono text-sm'>{tool.toolName}</span>
                    <Badge variant='secondary' className='text-xs'>
                      {((tool.successRate ?? 0) * 100).toFixed(0)}% 成功率
                    </Badge>
                    {(tool.successRate ?? 1) < 0.8 ? (
                      <Badge variant='destructive' className='gap-1 text-xs'>
                        <AlertTriangle className='h-3 w-3' />
                        关注
                      </Badge>
                    ) : null}
                  </div>
                  <span className='text-muted-foreground'>{tool.totalCount} 次</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {data?.daily && data.daily.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>最近 7 天趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              {data.daily.slice(0, 7).map((day) => (
                <div key={day.date} className='flex items-center justify-between border-b py-2 last:border-0'>
                  <span className='text-sm'>{day.date}</span>
                  <div className='flex items-center gap-4'>
                    <span className='text-sm text-muted-foreground'>{day.totalTokens.toLocaleString()} tokens</span>
                    <span className='text-sm text-muted-foreground'>{day.totalRequests} 请求</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function MetricCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string
  value: string | number
  hint: string
  icon?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold'>{value}</div>
        <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>
      </CardContent>
    </Card>
  )
}

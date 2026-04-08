import { useState } from 'react'
import { BarChart3, Minus, RefreshCw, Target, TrendingDown, TrendingUp } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useHotKeywordsAnalytics } from '../hooks/use-hot-keywords'

export function HotKeywordsAnalytics({
  showPageChrome = true,
  onBack,
}: {
  showPageChrome?: boolean
  onBack?: () => void
}) {
  const [period, setPeriod] = useState<'7d' | '30d'>('7d')
  const { data, isLoading, error, refetch } = useHotKeywordsAnalytics(period)
  const analytics = data?.items || []

  const topByHits = [...analytics]
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, 10)
  const topByConversion = [...analytics]
    .filter((item) => item.hitCount >= 10)
    .sort((a, b) => b.conversionRate - a.conversionRate)
    .slice(0, 10)

  const totalHits = analytics.reduce((sum, item) => sum + item.hitCount, 0)
  const totalConversions = analytics.reduce((sum, item) => sum + item.conversionCount, 0)
  const overallConversionRate = totalHits > 0 ? (totalConversions / totalHits) * 100 : 0
  const activeKeywordsCount = analytics.length

  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return <TrendingUp className='h-4 w-4 text-green-500' />
      case 'down':
        return <TrendingDown className='h-4 w-4 text-red-500' />
      default:
        return <Minus className='h-4 w-4 text-muted-foreground' />
    }
  }

  const content = (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <BarChart3 className='h-6 w-6' />
          <div>
            <h2 className='text-2xl font-bold'>热词数据分析</h2>
            <p className='text-muted-foreground'>查看热词命中率和转化率数据。</p>
          </div>
        </div>
        <div className='flex gap-2'>
          {onBack ? (
            <Button variant='outline' size='sm' onClick={onBack}>
              返回列表
            </Button>
          ) : null}
          <Button variant={period === '7d' ? 'default' : 'outline'} size='sm' onClick={() => setPeriod('7d')}>
            最近 7 天
          </Button>
          <Button variant={period === '30d' ? 'default' : 'outline'} size='sm' onClick={() => setPeriod('30d')}>
            最近 30 天
          </Button>
          <Button variant='outline' size='sm' onClick={() => refetch()}>
            <RefreshCw className='h-4 w-4' />
          </Button>
        </div>
      </div>

      {error ? (
        <div className='rounded-lg bg-red-50 p-4 text-red-600'>
          加载失败: {error.message}
        </div>
      ) : null}

      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <SummaryMetric title='活跃热词数' icon={<Target className='h-4 w-4' />} isLoading={isLoading} value={activeKeywordsCount} />
        <SummaryMetric title='总命中次数' isLoading={isLoading} value={totalHits} />
        <SummaryMetric title='总转化次数' isLoading={isLoading} value={totalConversions} />
        <SummaryMetric title='整体转化率' isLoading={isLoading} value={`${overallConversionRate.toFixed(2)}%`} />
      </div>

      <div className='grid gap-6 lg:grid-cols-2'>
        <RankingCard
          title='热词命中排行 Top 10'
          isLoading={isLoading}
          emptyText='暂无数据'
          items={topByHits.map((item, index) => ({
            key: item.keyword,
            rank: index + 1,
            title: item.keyword,
            subtitle: `转化率: ${item.conversionRate.toFixed(2)}%`,
            metric: `${item.hitCount}`,
            metricHint: `${item.conversionCount} 转化`,
            trend: item.trend,
          }))}
          getTrendIcon={getTrendIcon}
        />

        <RankingCard
          title='转化率排行 Top 10'
          description='最少 10 次命中'
          isLoading={isLoading}
          emptyText='暂无数据（需要至少 10 次命中）'
          items={topByConversion.map((item, index) => ({
            key: item.keyword,
            rank: index + 1,
            title: item.keyword,
            subtitle: `命中: ${item.hitCount} 次`,
            metric: `${item.conversionRate.toFixed(2)}%`,
            metricHint: `${item.conversionCount} 转化`,
            trend: item.trend,
            highlightMetric: true,
          }))}
          getTrendIcon={getTrendIcon}
        />
      </div>
    </div>
  )

  if (!showPageChrome) {
    return content
  }

  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>{content}</Main>
    </>
  )
}

function SummaryMetric({
  title,
  value,
  isLoading,
  icon,
}: {
  title: string
  value: string | number
  isLoading: boolean
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
        {isLoading ? <Skeleton className='h-8 w-20' /> : <div className='text-2xl font-bold'>{value}</div>}
      </CardContent>
    </Card>
  )
}

function RankingCard({
  title,
  description,
  isLoading,
  emptyText,
  items,
  getTrendIcon,
}: {
  title: string
  description?: string
  isLoading: boolean
  emptyText: string
  items: Array<{
    key: string
    rank: number
    title: string
    subtitle: string
    metric: string
    metricHint: string
    trend: 'up' | 'down' | 'stable'
    highlightMetric?: boolean
  }>
  getTrendIcon: (trend: 'up' | 'down' | 'stable') => React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <p className='text-sm text-muted-foreground'>{description}</p> : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className='space-y-3'>
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} className='h-12 w-full' />
            ))}
          </div>
        ) : items.length > 0 ? (
          <div className='space-y-3'>
            {items.map((item) => (
              <div key={item.key} className='flex items-center justify-between border-b pb-3 last:border-0'>
                <div className='flex items-center gap-3'>
                  <span className='w-6 text-center font-mono text-muted-foreground'>{item.rank}</span>
                  <div>
                    <div className='font-medium'>{item.title}</div>
                    <div className='text-sm text-muted-foreground'>{item.subtitle}</div>
                  </div>
                </div>
                <div className='flex items-center gap-3'>
                  <div className='text-right'>
                    <div className={item.highlightMetric ? 'font-bold text-primary' : 'font-bold'}>
                      {item.metric}
                    </div>
                    <div className='text-sm text-muted-foreground'>{item.metricHint}</div>
                  </div>
                  {getTrendIcon(item.trend)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='py-8 text-center text-muted-foreground'>{emptyText}</div>
        )}
      </CardContent>
    </Card>
  )
}

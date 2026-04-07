import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Calendar,
  FileText,
  RefreshCw,
  TrendingUp,
  UserPlus,
  Zap,
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CONTENT_PLATFORM_OPTIONS,
  CONTENT_TYPE_OPTIONS,
} from '@/features/content-ops/data/schema'
import { useOperationsDashboardData } from '@/hooks/use-dashboard'

const contentTypeLabelMap = Object.fromEntries(
  CONTENT_TYPE_OPTIONS.map((option) => [option.value, option.label])
)

const platformLabelMap = Object.fromEntries(
  CONTENT_PLATFORM_OPTIONS.map((option) => [option.value, option.label])
)

export function Dashboard() {
  const { data, isLoading, error, refetch } = useOperationsDashboardData()

  const metrics = data?.businessMetrics
  const topContentType = [...(data?.content.byType ?? [])]
    .sort((a, b) => {
      if (b.avgViews !== a.avgViews) {
        return b.avgViews - a.avgViews
      }

      return b.count - a.count
    })[0]

  const priorityItems = [
    {
      key: 'content-pending',
      show: (data?.content.pendingPerformanceCount ?? 0) > 0,
      title: `${data?.content.pendingPerformanceCount ?? 0} 篇内容还没补效果`,
      description: '先把浏览、点赞和评论补完整，后面才知道哪些方向值得继续做。',
      to: '/content' as const,
      action: '去内容工作台',
    },
    {
      key: 'keyword-attention',
      show: !!data?.hotKeywords.needsAttention,
      title: data?.hotKeywords.needsAttention
        ? `热词「${data.hotKeywords.needsAttention.keyword}」命中 ${data.hotKeywords.needsAttention.hitCount} 次，但转化只有 ${data.hotKeywords.needsAttention.conversionRate.toFixed(1)}%`
        : '热词需要关注',
      description: '入口有人点，但承接内容还不够强，优先优化这一条的返回内容。',
      to: '/hot-keywords' as const,
      action: '去看热词',
    },
    {
      key: 'content-winning',
      show: Boolean(topContentType),
      title: topContentType
        ? `当前最值得继续做的是「${contentTypeLabelMap[topContentType.contentType] ?? topContentType.contentType}」`
        : '当前最值得继续做的内容方向',
      description: topContentType
        ? `平均浏览 ${Math.round(topContentType.avgViews)}，先沿这个方向继续扩写，不要从零猜题。`
        : '优先沿着已经跑出来的方向继续扩写。',
      to: '/content' as const,
      action: '继续扩写',
    },
    {
      key: 'activity-push',
      show: true,
      title: `本周成局 ${metrics?.weeklyCompletedCount.value ?? 0} 个`,
      description: metrics?.weeklyCompletedCount.comparison
        ? `${metrics.weeklyCompletedCount.comparison}，继续把能成局的活动往外推。`
        : '优先继续扩散已经有承接势能的活动和搭子结果。',
      to: '/activities' as const,
      action: '去看活动',
    },
  ].filter((item) => item.show).slice(0, 3)

  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-4 flex flex-wrap items-end justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>指挥舱</h1>
            <p className='text-muted-foreground'>只看最关键的四个数，再决定今天先推什么。</p>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => refetch()}
            className='flex items-center gap-2'
          >
            <RefreshCw className='h-4 w-4' />
            刷新
          </Button>
        </div>

        {error && (
          <div className='mb-4 rounded-lg bg-red-50 p-4 text-red-600'>
            加载失败，请刷新重试
          </div>
        )}

        <div className='mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <MetricCard
            title='本周成局数'
            icon={Calendar}
            isLoading={isLoading}
            value={metrics?.weeklyCompletedCount.value ?? 0}
            hint={metrics?.weeklyCompletedCount.comparison ?? '先看这周真实跑通了多少活动。'}
          />
          <MetricCard
            title='J2C 转化率'
            icon={TrendingUp}
            isLoading={isLoading}
            value={`${metrics?.j2cRate.value.toFixed(1) ?? '0.0'}%`}
            hint={metrics?.j2cRate.comparison ?? '先参局后组局，才说明链路真的在转。'}
          />
          <MetricCard
            title='热词整体转化率'
            icon={Zap}
            isLoading={isLoading}
            value={`${data?.hotKeywords.overallConversionRate.toFixed(1) ?? '0.0'}%`}
            hint={`${data?.hotKeywords.totalConversions ?? 0} 次转化 / ${data?.hotKeywords.totalHits ?? 0} 次命中`}
          />
          <MetricCard
            title='累计涨粉'
            icon={UserPlus}
            isLoading={isLoading}
            value={data?.content.newFollowersTotal ?? 0}
            hint='先看内容有没有带来真实新增关注，再决定要不要继续投。'
          />
        </div>

        <div className='mb-6 grid gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between'>
              <CardTitle>今天优先处理</CardTitle>
              <Link to='/content' className='text-sm text-primary hover:underline'>
                去内容工作台
              </Link>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <LoadingRows count={3} />
              ) : priorityItems.length > 0 ? (
                <div className='space-y-4'>
                  {priorityItems.map((item) => (
                    <PriorityRow
                      key={item.key}
                      title={item.title}
                      description={item.description}
                      to={item.to}
                      action={item.action}
                    />
                  ))}
                </div>
              ) : (
                <EmptyHint text='今天暂时没有特别紧急的处理项，先去看内容和热词表现。' />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between'>
              <CardTitle>最近值得继续做的内容</CardTitle>
              <Link to='/content' className='text-sm text-primary hover:underline'>
                查看内容库
              </Link>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <LoadingRows count={3} />
              ) : data?.content.topNotes.length ? (
                <div className='space-y-4'>
                  {data.content.topNotes.map((note) => (
                    <ContentNoteRow
                      key={note.id}
                      id={note.id}
                      title={note.title}
                      description={`${platformLabelMap[note.platform] ?? note.platform} · ${contentTypeLabelMap[note.contentType] ?? note.contentType}`}
                    />
                  ))}
                </div>
              ) : (
                <EmptyHint text='先补一些内容效果，后面这里会更稳地告诉你哪些内容值得继续发。' />
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle>当前主线</CardTitle>
            <Link to='/activities' className='text-sm text-primary hover:underline'>
              去组局
            </Link>
          </CardHeader>
          <CardContent className='grid gap-4 lg:grid-cols-3'>
            <FocusCard
              icon={Calendar}
              title='成局优先'
              description='找搭子和组局不是两个副线，先把能成局的真实需求接住，再往外扩散。'
            />
            <FocusCard
              icon={FileText}
              title='内容是分发器'
              description='内容工作台的职责不是做复杂分析，而是把真实需求翻成可批量分发的内容。'
            />
            <FocusCard
              icon={Zap}
              title='热词是入口'
              description='热词只负责把外部流量顺手带进来，不替代小红书和抖音的站内分析。'
            />
          </CardContent>
        </Card>
      </Main>
    </>
  )
}

function MetricCard({
  title,
  value,
  hint,
  icon: Icon,
  isLoading,
}: {
  title: string
  value: string | number
  hint: string
  icon: typeof Calendar
  isLoading: boolean
}) {
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-sm font-medium'>{title}</CardTitle>
        <Icon className='text-muted-foreground h-4 w-4' />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className='h-8 w-20' />
        ) : (
          <div className='text-2xl font-bold'>{value}</div>
        )}
        <p className='text-xs text-muted-foreground'>{hint}</p>
      </CardContent>
    </Card>
  )
}

function PriorityRow({
  title,
  description,
  to,
  action,
}: {
  title: string
  description: string
  to: '/activities' | '/content' | '/hot-keywords'
  action: string
}) {
  return (
    <div className='flex items-start justify-between gap-4 border-b pb-4 last:border-0 last:pb-0'>
      <div className='min-w-0 space-y-1'>
        <p className='font-medium'>{title}</p>
        <p className='text-sm text-muted-foreground'>{description}</p>
      </div>
      <Button asChild variant='ghost' size='sm' className='shrink-0'>
        <Link to={to}>
          {action}
          <ArrowRight className='ml-1 h-4 w-4' />
        </Link>
      </Button>
    </div>
  )
}

function ContentNoteRow({
  id,
  title,
  description,
}: {
  id: string
  title: string
  description: string
}) {
  return (
    <div className='flex items-start justify-between gap-4 border-b pb-4 last:border-0 last:pb-0'>
      <div className='min-w-0 space-y-1'>
        <p className='font-medium'>{title}</p>
        <p className='text-sm text-muted-foreground'>{description}</p>
      </div>
      <Button asChild variant='ghost' size='sm' className='shrink-0'>
        <Link to='/content/$id' params={{ id }}>
          打开详情
          <ArrowRight className='ml-1 h-4 w-4' />
        </Link>
      </Button>
    </div>
  )
}

function LoadingRows({ count }: { count: number }) {
  return (
    <div className='space-y-4'>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className='h-14 w-full' />
      ))}
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className='text-sm text-muted-foreground'>{text}</p>
}

function FocusCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Calendar
  title: string
  description: string
}) {
  return (
    <div className='rounded-lg border p-4'>
      <div className='mb-3 flex items-center gap-2'>
        <Icon className='text-muted-foreground h-4 w-4' />
        <p className='font-medium'>{title}</p>
      </div>
      <p className='text-sm text-muted-foreground'>{description}</p>
    </div>
  )
}

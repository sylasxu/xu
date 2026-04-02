import { CalendarClock, Handshake, MapPin, Users2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useIntentMatches,
  usePartnerIntents,
  usePartnerProgressSummary,
  type IntentMatch,
  type PartnerIntent,
} from '@/hooks/use-partner-progress'
import { activityTypeLabels } from '../data/data'

const partnerIntentStatusLabels: Record<string, string> = {
  active: '待匹配',
  matched: '已撮合',
  expired: '已过期',
  cancelled: '已取消',
}

const intentMatchOutcomeLabels: Record<string, string> = {
  pending: '待跟进',
  confirmed: '已确认',
  expired: '已过期',
  cancelled: '已取消',
}

function getBadgeVariant(status: string) {
  if (status === 'cancelled') {
    return 'destructive' as const
  }

  if (status === 'pending' || status === 'active') {
    return 'default' as const
  }

  return 'secondary' as const
}

function renderTags(tags: string[]) {
  if (tags.length === 0) {
    return <span className='text-muted-foreground'>未补充标签</span>
  }

  return (
    <div className='flex flex-wrap gap-1'>
      {tags.slice(0, 2).map((tag) => (
        <Badge key={tag} variant='outline' className='font-normal'>
          {tag}
        </Badge>
      ))}
      {tags.length > 2 ? (
        <Badge variant='outline' className='font-normal'>
          +{tags.length - 2}
        </Badge>
      ) : null}
    </div>
  )
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '待确认'
  }

  return new Date(value).toLocaleString('zh-CN')
}

function getAvatarFallback(name: string | null | undefined) {
  const normalized = name?.trim()
  if (!normalized) {
    return '搭'
  }

  return normalized.slice(0, 1).toUpperCase()
}

function PartnerSummaryCard({
  title,
  value,
  description,
  icon: Icon,
  isLoading,
}: {
  title: string
  value: number | undefined
  description: string
  icon: typeof Users2
  isLoading: boolean
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
          <Icon className='h-4 w-4' />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-1'>
        {isLoading ? (
          <Skeleton className='h-8 w-20' />
        ) : (
          <div className='text-2xl font-bold'>{value?.toLocaleString() ?? 0}</div>
        )}
        <p className='text-sm text-muted-foreground'>{description}</p>
      </CardContent>
    </Card>
  )
}

function LoadingRows() {
  return (
    <div className='space-y-2'>
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className='h-10 w-full' />
      ))}
    </div>
  )
}

function PartnerIntentRows({ items }: { items: PartnerIntent[] }) {
  if (items.length === 0) {
    return <div className='py-8 text-center text-sm text-muted-foreground'>当前没有待处理搭子意向</div>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>发起人</TableHead>
          <TableHead>类型</TableHead>
          <TableHead>地点 / 时间</TableHead>
          <TableHead>标签</TableHead>
          <TableHead>状态</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <div className='flex items-center gap-3'>
                <Avatar className='h-8 w-8'>
                  <AvatarImage src={item.avatarUrl ?? undefined} alt={item.nickname ?? '搭子用户'} />
                  <AvatarFallback>{getAvatarFallback(item.nickname)}</AvatarFallback>
                </Avatar>
                <div className='min-w-0'>
                  <div className='font-medium'>{item.nickname || '未命名用户'}</div>
                  <div className='text-xs text-muted-foreground'>{formatDateTime(item.updatedAt)}</div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className='space-y-1'>
                <div className='font-medium'>{activityTypeLabels[item.activityType] ?? item.activityType}</div>
                <div className='text-xs text-muted-foreground'>{item.rawInput || '由对话结构化生成'}</div>
              </div>
            </TableCell>
            <TableCell className='max-w-[220px] whitespace-normal'>
              <div className='space-y-1'>
                <div className='flex items-center gap-1 text-sm'>
                  <MapPin className='h-3.5 w-3.5 text-muted-foreground' />
                  <span>{item.locationHint}</span>
                </div>
                <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                  <CalendarClock className='h-3.5 w-3.5' />
                  <span>{item.timePreference || '时间待沟通'}</span>
                </div>
              </div>
            </TableCell>
            <TableCell className='max-w-[180px] whitespace-normal'>
              {renderTags(item.tags)}
            </TableCell>
            <TableCell>
              <Badge variant={getBadgeVariant(item.status)}>
                {partnerIntentStatusLabels[item.status] ?? item.status}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function IntentMatchRows({ items }: { items: IntentMatch[] }) {
  if (items.length === 0) {
    return <div className='py-8 text-center text-sm text-muted-foreground'>当前没有待跟进匹配</div>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>召集人</TableHead>
          <TableHead>匹配信息</TableHead>
          <TableHead>地点</TableHead>
          <TableHead>截止时间</TableHead>
          <TableHead>进度</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <div className='flex items-center gap-3'>
                <Avatar className='h-8 w-8'>
                  <AvatarImage src={item.organizerAvatarUrl ?? undefined} alt={item.organizerNickname ?? '召集人'} />
                  <AvatarFallback>{getAvatarFallback(item.organizerNickname)}</AvatarFallback>
                </Avatar>
                <div className='min-w-0'>
                  <div className='font-medium'>{item.organizerNickname || '待分配召集人'}</div>
                  <div className='text-xs text-muted-foreground'>
                    {item.userIds.length} 人匹配 · {Math.round(item.matchScore)} 分
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell className='max-w-[220px] whitespace-normal'>
              <div className='space-y-1'>
                <div className='font-medium'>{activityTypeLabels[item.activityType] ?? item.activityType}</div>
                <div className='text-xs text-muted-foreground'>
                  {item.commonTags.length > 0 ? item.commonTags.join('、') : '共同偏好待补充'}
                </div>
              </div>
            </TableCell>
            <TableCell className='max-w-[180px] whitespace-normal'>{item.centerLocationHint}</TableCell>
            <TableCell>{formatDateTime(item.confirmDeadline)}</TableCell>
            <TableCell>
              <div className='space-y-1'>
                <Badge variant={getBadgeVariant(item.outcome)}>
                  {intentMatchOutcomeLabels[item.outcome] ?? item.outcome}
                </Badge>
                <div className='text-xs text-muted-foreground'>
                  {item.activityId ? '已生成活动' : '待创建活动'}
                </div>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function PartnerProgressOverview() {
  const { data: summary, isLoading: isSummaryLoading } = usePartnerProgressSummary()
  const {
    data: activeIntentsResult,
    isLoading: isIntentsLoading,
    error: intentsError,
  } = usePartnerIntents({ page: 1, limit: 6, status: 'active' })
  const {
    data: pendingMatchesResult,
    isLoading: isMatchesLoading,
    error: matchesError,
  } = useIntentMatches({ page: 1, limit: 6, outcome: 'pending' })

  return (
    <div className='space-y-4'>
      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
        <PartnerSummaryCard
          title='待匹配意向'
          value={summary?.activeIntentCount}
          description='还没撮合成功，值得优先看一眼。'
          icon={Users2}
          isLoading={isSummaryLoading}
        />
        <PartnerSummaryCard
          title='已撮合意向'
          value={summary?.matchedIntentCount}
          description='说明找搭子链路已经开始转起来。'
          icon={Handshake}
          isLoading={isSummaryLoading}
        />
        <PartnerSummaryCard
          title='待跟进匹配'
          value={summary?.pendingMatchCount}
          description='还需要人工确认或补一手成局。'
          icon={CalendarClock}
          isLoading={isSummaryLoading}
        />
        <PartnerSummaryCard
          title='已确认匹配'
          value={summary?.confirmedMatchCount}
          description='已经明确成局，可以观察后续复购。'
          icon={MapPin}
          isLoading={isSummaryLoading}
        />
      </div>

      <div className='grid gap-4 xl:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>最近待处理搭子意向</CardTitle>
            <p className='text-sm text-muted-foreground'>优先看还没撮合成功、需要继续接球的用户需求。</p>
          </CardHeader>
          <CardContent>
            {isIntentsLoading ? (
              <LoadingRows />
            ) : intentsError ? (
              <div className='py-8 text-center text-sm text-muted-foreground'>搭子意向加载失败：{intentsError.message}</div>
            ) : (
              <PartnerIntentRows items={activeIntentsResult?.data ?? []} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最近待跟进匹配</CardTitle>
            <p className='text-sm text-muted-foreground'>看哪些匹配已经成型，但还差最后一步确认或建活动。</p>
          </CardHeader>
          <CardContent>
            {isMatchesLoading ? (
              <LoadingRows />
            ) : matchesError ? (
              <div className='py-8 text-center text-sm text-muted-foreground'>匹配进展加载失败：{matchesError.message}</div>
            ) : (
              <IntentMatchRows items={pendingMatchesResult?.data ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

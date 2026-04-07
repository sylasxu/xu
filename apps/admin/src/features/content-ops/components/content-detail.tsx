import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Copy, Eye, Heart, Bookmark, MessageCircle, UserPlus, Sparkles, Clock3 } from 'lucide-react'
import { toast } from 'sonner'
import { useContentDetail, useContentLibrary } from '../hooks/use-content'
import { CONTENT_PLATFORM_OPTIONS, CONTENT_TYPE_OPTIONS } from '../data/schema'
import { PerformanceForm } from './performance-form'
import { ContentGenerate } from './content-generate'
import { useContentRemark } from '../hooks/use-content-remark'

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_TYPE_OPTIONS.map((o) => [o.value, o.label])
)

const PLATFORM_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_PLATFORM_OPTIONS.map((o) => [o.value, o.label])
)

function describeContentState(note: {
  views: number | null
  likes: number | null
  comments: number | null
  collects: number | null
}) {
  const views = note.views ?? 0
  const likes = note.likes ?? 0
  const comments = note.comments ?? 0
  const collects = note.collects ?? 0

  if (views >= 1000 || likes >= 30 || comments >= 10 || collects >= 10) {
    return {
      label: '这版可以继续做',
      variant: 'default' as const,
      message: '已经有一些反应了，建议沿着同方向再试 1 到 2 个变体。',
    }
  }

  if (views > 0 || likes > 0 || comments > 0 || collects > 0) {
    return {
      label: '先观察这版',
      variant: 'secondary' as const,
      message: '这版已经发出去了，但还需要再看一轮，先把效果补完整。',
    }
  }

  return {
    label: '还没发出去',
    variant: 'outline' as const,
    message: '先复制出去发一版，之后回来补浏览、点赞和一句备注。',
  }
}

function describePublishCheck(note: {
  publishCheck: {
    status: 'ready' | 'review' | 'rewrite'
    summary: string
    issues: string[]
  }
}) {
  if (note.publishCheck.status === 'ready') {
    return {
      label: '可直接发',
      variant: 'default' as const,
    }
  }

  if (note.publishCheck.status === 'review') {
    return {
      label: '建议改一下',
      variant: 'secondary' as const,
    }
  }

  return {
    label: '先别发',
    variant: 'destructive' as const,
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('已复制到剪贴板')
}

export function ContentDetail({
  id,
  initialTab = 'current',
  focusTarget,
}: {
  id: string
  initialTab?: 'current' | 'generate' | 'history'
  focusTarget?: 'performance'
}) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'current' | 'generate' | 'history'>(initialTab)
  const performanceRef = useRef<HTMLDivElement | null>(null)
  const { data: note, isLoading, error } = useContentDetail(id)
  const {
    draftRemark,
    hasRemark,
    isDirty,
    saveRemark,
    setDraftRemark,
  } = useContentRemark(id)

  const relatedQuery = useContentLibrary({
    page: 1,
    limit: 10,
    keyword: note?.topic,
    platform: note?.platform,
    contentType: note?.contentType,
  })
  const relatedNotes = useMemo(() => {
    if (!note) {
      return []
    }

    return (relatedQuery.data?.items ?? [])
      .filter((item) => item.id !== note.id)
      .sort((a, b) => {
        const aScore =
          (a.views ?? 0) + (a.likes ?? 0) * 2 + (a.comments ?? 0) * 2 + (a.collects ?? 0) * 3
        const bScore =
          (b.views ?? 0) + (b.likes ?? 0) * 2 + (b.comments ?? 0) * 2 + (b.collects ?? 0) * 3
        return bScore - aScore
      })
  }, [relatedQuery.data?.items, note])

  if (isLoading) {
    return <div className='py-12 text-center text-muted-foreground'>加载中...</div>
  }

  if (error instanceof Error) {
    return <div className='py-12 text-center text-muted-foreground'>加载失败：{error.message}</div>
  }

  if (!note) {
    return <div className='py-12 text-center text-muted-foreground'>笔记不存在</div>
  }

  const hashtagsText = note.hashtags.map((tag) => `#${tag}`).join(' ')
  const fullText = `${note.title}\n\n${note.body}\n\n${hashtagsText}`
  const currentState = describeContentState(note)
  const publishCheck = describePublishCheck(note)

  const jumpToPerformance = () => {
    setActiveTab('current')
    requestAnimationFrame(() => {
      performanceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    if (focusTarget === 'performance') {
      jumpToPerformance()
    }
  }, [focusTarget])

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant='outline'>{PLATFORM_LABEL[note.platform] ?? note.platform}</Badge>
                <Badge variant='outline'>{TYPE_LABEL[note.contentType] ?? note.contentType}</Badge>
                <Badge variant='secondary'>{note.topic}</Badge>
                <Badge variant={publishCheck.variant}>{publishCheck.label}</Badge>
              </div>
              <CardTitle className='text-2xl'>{note.title}</CardTitle>
              <p className='text-sm text-muted-foreground'>
                继续围绕这个方向生成新版本，或者先补一下发布后的简单效果。
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button variant='outline' size='sm' onClick={() => copyToClipboard(fullText)}>
                <Copy className='h-4 w-4 mr-1' />
                全文复制
              </Button>
              <Button variant='outline' size='sm' onClick={() => setActiveTab('generate')}>
                <Sparkles className='h-4 w-4 mr-1' />
                继续生成
              </Button>
              <Button variant='outline' size='sm' onClick={jumpToPerformance}>
                <Eye className='h-4 w-4 mr-1' />
                去补效果
              </Button>
              <Button variant='outline' size='sm' onClick={() => setActiveTab('history')}>
                <Clock3 className='h-4 w-4 mr-1' />
                看历史版本
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className='space-y-6'>
        <TabsList className='grid w-full grid-cols-3'>
          <TabsTrigger value='current'>当前内容</TabsTrigger>
          <TabsTrigger value='generate'>继续生成</TabsTrigger>
          <TabsTrigger value='history'>历史版本</TabsTrigger>
        </TabsList>

        <TabsContent value='current' className='space-y-6'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>发布前检查</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex items-center gap-2'>
                <Badge variant={publishCheck.variant}>{publishCheck.label}</Badge>
                <p className='text-sm text-muted-foreground'>{note.publishCheck.summary}</p>
              </div>
              {note.publishCheck.issues.length > 0 ? (
                <ul className='space-y-2 text-sm text-muted-foreground'>
                  {note.publishCheck.issues.map((issue) => (
                    <li key={issue} className='rounded-md border bg-muted/30 px-3 py-2'>
                      {issue}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  这版没有明显硬伤，先发出去验证结果就行。
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>现在该怎么处理这版</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid gap-3 md:grid-cols-3'>
                <QuickStatCard
                  label='发布检查'
                  value={publishCheck.label}
                  hint={note.publishCheck.summary}
                  badgeVariant={publishCheck.variant}
                />
                <QuickStatCard
                  label='当前判断'
                  value={currentState.label}
                  hint={currentState.message}
                  badgeVariant={currentState.variant}
                />
                <QuickStatCard
                  label='历史版本'
                  value={relatedNotes.length > 0 ? `${relatedNotes.length} 个` : '暂无'}
                  hint='同方向里可以拿来参考和对比的旧版本。'
                />
                <QuickStatCard
                  label='效果记录'
                  value={
                    [note.views, note.likes, note.collects, note.comments, note.newFollowers].some(
                      (value) => typeof value === 'number' && value > 0
                    )
                      ? '已补一部分'
                      : '还没补'
                  }
                  hint='发出去后至少补浏览、点赞和一句备注。'
                />
                <QuickStatCard
                  label='运营备注'
                  value={hasRemark ? '已写' : '未写'}
                  hint='记一句这版为什么值得继续，或者为什么先停。'
                  badgeVariant={hasRemark ? 'secondary' : 'outline'}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>发布素材</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div>
                <div className='flex items-center justify-between mb-2'>
                  <span className='text-sm font-medium text-muted-foreground'>首页标题</span>
                  <Button variant='ghost' size='sm' onClick={() => copyToClipboard(note.title)}>
                    <Copy className='h-3.5 w-3.5 mr-1' />
                    复制
                  </Button>
                </div>
                <p className='text-lg font-semibold leading-tight'>{note.title}</p>
              </div>

              {note.coverText && (
                <div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-medium text-muted-foreground'>首页封面短句</span>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => copyToClipboard(note.coverText ?? '')}
                    >
                      <Copy className='h-3.5 w-3.5 mr-1' />
                      复制
                    </Button>
                  </div>
                  <p className='mt-1 text-base font-medium'>{note.coverText}</p>
                </div>
              )}

              {note.coverImageHint && (
                <div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-medium text-muted-foreground'>首页图片提示词</span>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => copyToClipboard(note.coverImageHint ?? '')}
                    >
                      <Copy className='h-3.5 w-3.5 mr-1' />
                      复制
                    </Button>
                  </div>
                  <p className='mt-1 whitespace-pre-line text-sm text-muted-foreground'>
                    {note.coverImageHint}
                  </p>
                </div>
              )}

              <div className='rounded-lg border bg-muted/20 p-4 space-y-4'>
                <div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-medium text-muted-foreground'>评论区引导句</span>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => copyToClipboard(note.trafficScript.commentPrompt)}
                    >
                      <Copy className='h-3.5 w-3.5 mr-1' />
                      复制
                    </Button>
                  </div>
                  <p className='mt-1 text-sm'>{note.trafficScript.commentPrompt}</p>
                </div>

                <div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-medium text-muted-foreground'>私聊承接话术</span>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => copyToClipboard(note.trafficScript.dmReply)}
                    >
                      <Copy className='h-3.5 w-3.5 mr-1' />
                      复制
                    </Button>
                  </div>
                  <p className='mt-1 text-sm'>{note.trafficScript.dmReply}</p>
                </div>

                <div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-medium text-muted-foreground'>转微信时参考句</span>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => copyToClipboard(note.trafficScript.wechatHandoff)}
                    >
                      <Copy className='h-3.5 w-3.5 mr-1' />
                      复制
                    </Button>
                  </div>
                  <p className='mt-1 text-sm'>{note.trafficScript.wechatHandoff}</p>
                </div>
              </div>

              <div>
                <div className='flex items-center justify-between mb-2'>
                  <span className='text-sm font-medium text-muted-foreground'>正文</span>
                  <Button variant='ghost' size='sm' onClick={() => copyToClipboard(note.body)}>
                    <Copy className='h-3.5 w-3.5 mr-1' />
                    复制
                  </Button>
                </div>
                <p className='whitespace-pre-line text-sm leading-relaxed'>{note.body}</p>
              </div>

              <div>
                <div className='flex items-center justify-between mb-2'>
                  <span className='text-sm font-medium text-muted-foreground'>话题标签</span>
                  <Button variant='ghost' size='sm' onClick={() => copyToClipboard(hashtagsText)}>
                    <Copy className='h-3.5 w-3.5 mr-1' />
                    复制
                  </Button>
                </div>
                <div className='flex flex-wrap gap-1.5'>
                  {note.hashtags.map((tag) => (
                    <Badge key={tag} variant='secondary'>
                      #{tag}
                    </Badge>
                  ))}
                </div>
              </div>

              <p className='text-xs text-muted-foreground border-t pt-3'>
                创建于 {new Date(note.createdAt).toLocaleString('zh-CN')}
              </p>
            </CardContent>
          </Card>

          <Card ref={performanceRef}>
            <CardHeader>
              <CardTitle className='text-base'>效果数据</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-5 gap-4 mb-6'>
                <MetricCard icon={Eye} label='浏览' value={note.views} />
                <MetricCard icon={Heart} label='点赞' value={note.likes} />
                <MetricCard icon={Bookmark} label='收藏' value={note.collects} />
                <MetricCard icon={MessageCircle} label='评论' value={note.comments} />
                <MetricCard icon={UserPlus} label='涨粉' value={note.newFollowers} />
              </div>

              <PerformanceForm
                noteId={note.id}
                defaultValues={{
                  views: note.views ?? undefined,
                  likes: note.likes ?? undefined,
                  collects: note.collects ?? undefined,
                  comments: note.comments ?? undefined,
                  newFollowers: note.newFollowers ?? undefined,
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>运营备注</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <Textarea
                value={draftRemark}
                onChange={(event) => setDraftRemark(event.target.value)}
                placeholder='比如：这版标题更能点进去，评论多但没人继续问，下次换成更像真实经历的开头。'
                rows={4}
              />
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <p className='text-sm text-muted-foreground'>
                  备注先保存在当前浏览器里，方便你快速复盘这版内容。
                </p>
                <Button onClick={saveRemark} disabled={!isDirty}>
                  保存备注
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='generate'>
          <ContentGenerate
            showPageTitle={false}
            heading='继续生成这个方向'
            description='沿用这个方向和内容类型，再多试几版更适合发布的内容。'
            initialTopic={note.topic}
            initialPlatform={note.platform}
            initialContentType={note.contentType}
          />
        </TabsContent>

        <TabsContent value='history'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Clock3 className='h-4 w-4' />
                同方向最近内容
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              {relatedQuery.isLoading ? (
                <div className='py-8 text-center text-muted-foreground'>加载中...</div>
              ) : relatedNotes.length === 0 ? (
                <div className='py-8 text-center text-muted-foreground'>
                  这个方向暂时还没有其他版本，先去继续生成一版吧。
                </div>
              ) : (
                relatedNotes.map((item) => (
                  <button
                    key={item.id}
                    type='button'
                    className='w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted/40'
                    onClick={() => navigate({ to: '/content/$id', params: { id: item.id } })}
                  >
                    <div className='flex flex-wrap items-center justify-between gap-3'>
                      <div className='space-y-1'>
                        <div className='flex items-center gap-2'>
                          <Badge variant='outline'>{TYPE_LABEL[item.contentType] ?? item.contentType}</Badge>
                          <Badge variant='secondary'>历史版本</Badge>
                          <span className='text-xs text-muted-foreground'>
                            {new Date(item.createdAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <p className='font-medium'>{item.title}</p>
                        <p className='line-clamp-2 text-sm text-muted-foreground'>{item.body}</p>
                      </div>
                      <div className='flex items-center gap-4 text-sm text-muted-foreground'>
                        <span className='flex items-center gap-1'>
                          <Eye className='h-4 w-4' />
                          {item.views ?? '-'}
                        </span>
                        <span className='flex items-center gap-1'>
                          <Heart className='h-4 w-4' />
                          {item.likes ?? '-'}
                        </span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Sparkles className='h-4 w-4' />
                这个方向的小提示
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-2 text-sm text-muted-foreground'>
              <p>先保留你觉得最能发的一版，再继续沿着同一个方向试 1 到 2 个变体。</p>
              <p>补效果时记一句人话备注，往往比复杂报表更有用，比如“标题更能点进去”或“评论多但没人继续问”。</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | null | undefined
}) {
  return (
    <div className='text-center'>
      <Icon className='h-5 w-5 mx-auto mb-1 text-muted-foreground' />
      <div className='text-lg font-semibold'>{value ?? '-'}</div>
      <div className='text-xs text-muted-foreground'>{label}</div>
    </div>
  )
}

function QuickStatCard({
  label,
  value,
  hint,
  badgeVariant,
}: {
  label: string
  value: string
  hint: string
  badgeVariant?: 'default' | 'secondary' | 'outline'
}) {
  return (
    <div className='rounded-lg border p-4'>
      <p className='text-sm text-muted-foreground'>{label}</p>
      <div className='mt-2'>
        {badgeVariant ? <Badge variant={badgeVariant}>{value}</Badge> : <p className='text-lg font-semibold'>{value}</p>}
      </div>
      <p className='mt-2 text-sm text-muted-foreground'>{hint}</p>
    </div>
  )
}

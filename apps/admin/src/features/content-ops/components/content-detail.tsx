import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Copy, Eye, Heart, Bookmark, MessageCircle, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useContentDetail } from '../hooks/use-content'
import { CONTENT_TYPE_OPTIONS } from '../data/schema'
import { PerformanceForm } from './performance-form'

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_TYPE_OPTIONS.map((o) => [o.value, o.label])
)

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('已复制到剪贴板')
}

export function ContentDetail({ id }: { id: string }) {
  const { data: note, isLoading } = useContentDetail(id)

  if (isLoading) {
    return <div className='py-12 text-center text-muted-foreground'>加载中...</div>
  }

  if (!note) {
    return <div className='py-12 text-center text-muted-foreground'>笔记不存在</div>
  }

  const n = note as any
  const hashtagsText = (n.hashtags ?? []).map((t: string) => `#${t}`).join(' ')
  const fullText = `${n.title}\n\n${n.body}\n\n${hashtagsText}`

  return (
    <div className='space-y-6'>
      {/* 笔记内容 */}
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Badge variant='outline'>{TYPE_LABEL[n.contentType] ?? n.contentType}</Badge>
              <CardTitle className='text-xl'>{n.title}</CardTitle>
            </div>
            <Button variant='outline' size='sm' onClick={() => copyToClipboard(fullText)}>
              <Copy className='h-4 w-4 mr-1' />
              全文复制
            </Button>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          {/* 正文 */}
          <div>
            <div className='flex items-center justify-between mb-2'>
              <span className='text-sm font-medium text-muted-foreground'>正文</span>
              <Button variant='ghost' size='sm' onClick={() => copyToClipboard(n.body)}>
                <Copy className='h-3.5 w-3.5 mr-1' />
                复制
              </Button>
            </div>
            <p className='whitespace-pre-line text-sm leading-relaxed'>{n.body}</p>
          </div>

          {/* 标签 */}
          <div>
            <div className='flex items-center justify-between mb-2'>
              <span className='text-sm font-medium text-muted-foreground'>话题标签</span>
              <Button variant='ghost' size='sm' onClick={() => copyToClipboard(hashtagsText)}>
                <Copy className='h-3.5 w-3.5 mr-1' />
                复制
              </Button>
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {(n.hashtags ?? []).map((tag: string) => (
                <Badge key={tag} variant='secondary'>
                  #{tag}
                </Badge>
              ))}
            </div>
          </div>

          {/* 封面提示 */}
          {n.coverImageHint && (
            <div>
              <span className='text-sm font-medium text-muted-foreground'>封面图片提示</span>
              <p className='mt-1 text-sm text-muted-foreground'>{n.coverImageHint}</p>
            </div>
          )}

          <p className='text-xs text-muted-foreground border-t pt-3'>
            创建于 {new Date(n.createdAt).toLocaleString('zh-CN')}
          </p>
        </CardContent>
      </Card>

      {/* 效果数据 */}
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>效果数据</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-5 gap-4 mb-6'>
            <MetricCard icon={Eye} label='浏览' value={n.views} />
            <MetricCard icon={Heart} label='点赞' value={n.likes} />
            <MetricCard icon={Bookmark} label='收藏' value={n.collects} />
            <MetricCard icon={MessageCircle} label='评论' value={n.comments} />
            <MetricCard icon={UserPlus} label='涨粉' value={n.newFollowers} />
          </div>

          <PerformanceForm
            noteId={n.id}
            defaultValues={{
              views: n.views ?? undefined,
              likes: n.likes ?? undefined,
              collects: n.collects ?? undefined,
              comments: n.comments ?? undefined,
              newFollowers: n.newFollowers ?? undefined,
            }}
          />
        </CardContent>
      </Card>
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

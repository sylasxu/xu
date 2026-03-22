import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, RefreshCcw, Sparkles, Copy, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useGenerateNotes, useTopicSuggestions } from '../hooks/use-content'
import {
  CONTENT_PLATFORM_OPTIONS,
  CONTENT_TYPE_DESCRIPTIONS,
  CONTENT_TYPE_OPTIONS,
  CONTENT_TYPE_TOPIC_PLACEHOLDERS,
  isContentPlatform,
  isContentType,
  type ContentPlatform,
  type ContentType,
} from '../data/schema'

export interface GeneratedNote {
  id: string
  title: string
  body: string
  hashtags: string[]
  coverText: string | null
  coverImageHint: string | null
}

interface ContentGenerateProps {
  initialTopic?: string
  initialPlatform?: ContentPlatform
  initialContentType?: ContentType
  initialCount?: string
  heading?: string
  description?: string
  showPageTitle?: boolean
  onGenerated?: (notes: GeneratedNote[]) => void
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('已复制到剪贴板')
}

export function ContentGenerate({
  initialTopic = '',
  initialPlatform = 'xiaohongshu',
  initialContentType = 'activity_recruit',
  initialCount = '1',
  heading = '内容生成',
  description,
  showPageTitle = true,
  onGenerated,
}: ContentGenerateProps) {
  const [topic, setTopic] = useState(initialTopic)
  const [platform, setPlatform] = useState<ContentPlatform>(initialPlatform)
  const [contentType, setContentType] = useState<ContentType>(initialContentType)
  const [count, setCount] = useState(initialCount)
  const [results, setResults] = useState<GeneratedNote[]>([])
  const [topicSuggestionRefresh, setTopicSuggestionRefresh] = useState(0)
  const [topicSuggestionSeed, setTopicSuggestionSeed] = useState<string | undefined>(undefined)
  const navigate = useNavigate()
  const generateMutation = useGenerateNotes()
  const topicSuggestionQuery = useTopicSuggestions({
    platform,
    contentType,
    seed: topicSuggestionSeed,
  }, topicSuggestionRefresh)
  const topicHints = (topicSuggestionQuery.data?.items ?? []).filter((hint) => hint.trim() !== topic.trim())
  const topicPlaceholder = topicHints[0] ?? CONTENT_TYPE_TOPIC_PLACEHOLDERS[contentType]

  useEffect(() => {
    setTopic(initialTopic)
  }, [initialTopic])

  useEffect(() => {
    setPlatform(initialPlatform)
  }, [initialPlatform])

  useEffect(() => {
    setContentType(initialContentType)
  }, [initialContentType])

  useEffect(() => {
    setTopicSuggestionSeed(undefined)
    setTopicSuggestionRefresh((value) => value + 1)
  }, [platform, contentType])

  const handleGenerate = async () => {
    if (!topic.trim()) return
    const data = await generateMutation.mutateAsync({
      topic,
      platform,
      contentType,
      count: Number(count),
    })
    const nextResults = Array.isArray(data) ? data : []
    setResults(nextResults)
    onGenerated?.(nextResults)
  }

  return (
    <div className='space-y-6'>
      {showPageTitle && (
        <div className='flex items-center gap-3'>
          <FileText className='h-6 w-6' />
          <div>
            <h1 className='text-2xl font-bold'>{heading}</h1>
            {description && <p className='text-sm text-muted-foreground'>{description}</p>}
          </div>
        </div>
      )}

      <div className='grid gap-6 lg:grid-cols-2'>
        {/* 输入区 */}
        <Card>
          <CardHeader>
            <CardTitle>{showPageTitle ? '生成配置' : heading}</CardTitle>
            {description && !showPageTitle && (
              <p className='text-sm text-muted-foreground'>{description}</p>
            )}
          </CardHeader>
          <CardContent className='space-y-4'>
            <div>
              <Label htmlFor='topic'>主题</Label>
              <Textarea
                id='topic'
                placeholder={topicPlaceholder}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={3}
                className='mt-2'
              />
              <div className='mt-2 space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                  <p className='text-xs text-muted-foreground'>
                    AI 会按当前平台和内容类型，优先推荐更像传单号的主题起手句，方便直接筛同频人。
                  </p>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='h-7 px-2 text-xs'
                    onClick={() => {
                      setTopicSuggestionSeed(topic.trim() || undefined)
                      setTopicSuggestionRefresh((value) => value + 1)
                    }}
                    disabled={topicSuggestionQuery.isLoading || topicSuggestionQuery.isFetching}
                  >
                    {topicSuggestionQuery.isLoading || topicSuggestionQuery.isFetching ? (
                      <Loader2 className='h-3.5 w-3.5 mr-1 animate-spin' />
                    ) : (
                      <RefreshCcw className='h-3.5 w-3.5 mr-1' />
                    )}
                    换一批
                  </Button>
                </div>
                {topicHints.length > 0 && (
                  <div className='grid gap-2'>
                    {topicHints.map((hint) => (
                      <Button
                        key={hint}
                        type='button'
                        variant='outline'
                        size='sm'
                        className='h-auto w-full justify-start rounded-xl px-3 py-2 text-left text-xs leading-5 text-muted-foreground whitespace-normal break-words'
                        onClick={() => setTopic(hint)}
                      >
                        {hint}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label>发布平台</Label>
              <Select
                value={platform}
                onValueChange={(value) => {
                  if (isContentPlatform(value)) {
                    setPlatform(value)
                  }
                }}
              >
                <SelectTrigger className='mt-2'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_PLATFORM_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>内容类型</Label>
              <Select
                value={contentType}
                onValueChange={(value) => {
                  if (isContentType(value)) {
                    setContentType(value)
                  }
                }}
              >
                <SelectTrigger className='mt-2'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='mt-2 text-xs text-muted-foreground'>
                {CONTENT_TYPE_DESCRIPTIONS[contentType]}
              </p>
            </div>

            <div>
              <Label>生成数量</Label>
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger className='mt-2'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} 篇
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={!topic.trim() || generateMutation.isPending}
              className='w-full'
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className='h-4 w-4 mr-2' />
                  生成内容稿
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* 结果区 */}
        <div className='space-y-4'>
          {results.length === 0 ? (
              <Card>
                <CardContent className='flex flex-col items-center justify-center py-12 text-muted-foreground'>
                  <FileText className='h-12 w-12 mb-4' />
                  <p>输入主题，AI 帮你生成更像传单号的内容稿</p>
                </CardContent>
              </Card>
          ) : (
            results.map((note, idx) => (
              <NoteCard
                key={note.id || idx}
                note={note}
                index={idx}
                onOpen={() => navigate({ to: '/content/$id', params: { id: note.id } })}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function NoteCard({
  note,
  index,
  onOpen,
}: {
  note: GeneratedNote
  index: number
  onOpen?: () => void
}) {
  const hashtagsText = note.hashtags.map((t) => `#${t}`).join(' ')
  const fullText = `${note.title}\n\n${note.body}\n\n${hashtagsText}`

  return (
    <Card>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-base'>内容稿 {index + 1}</CardTitle>
          <div className='flex items-center gap-2'>
            {onOpen && (
              <Button variant='outline' size='sm' onClick={onOpen}>
                打开详情
              </Button>
            )}
            <Button variant='ghost' size='sm' onClick={() => copyToClipboard(fullText)}>
              <Copy className='h-4 w-4 mr-1' />
              全文复制
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        {/* 标题 */}
        <div className='flex items-start justify-between gap-2'>
          <h3 className='font-semibold text-lg leading-tight'>{note.title}</h3>
          <Button
            variant='ghost'
            size='icon'
            className='shrink-0 h-7 w-7'
            onClick={() => copyToClipboard(note.title)}
          >
            <Copy className='h-3.5 w-3.5' />
          </Button>
        </div>

        {/* 正文预览 */}
        <div className='relative'>
          <p className='text-sm text-muted-foreground whitespace-pre-line line-clamp-6'>
            {note.body}
          </p>
          <Button
            variant='ghost'
            size='sm'
            className='mt-1'
            onClick={() => copyToClipboard(note.body)}
          >
            <Copy className='h-3.5 w-3.5 mr-1' />
            复制正文
          </Button>
        </div>

        {/* 标签 */}
        <div>
          <div className='flex flex-wrap gap-1.5'>
            {note.hashtags.map((tag) => (
              <Badge key={tag} variant='secondary' className='text-xs'>
                #{tag}
              </Badge>
            ))}
          </div>
          <Button
            variant='ghost'
            size='sm'
            className='mt-1'
            onClick={() => copyToClipboard(hashtagsText)}
          >
            <Copy className='h-3.5 w-3.5 mr-1' />
            复制标签
          </Button>
        </div>

        {/* 配图提示词 */}
        {note.coverText && (
          <div className='border-t pt-3'>
            <div className='flex items-center justify-between gap-2'>
              <p className='text-xs font-medium text-muted-foreground'>首图文案</p>
              <Button
                variant='ghost'
                size='sm'
                className='h-7 px-2 text-xs'
                onClick={() => copyToClipboard(note.coverText ?? '')}
              >
                <Copy className='h-3.5 w-3.5 mr-1' />
                复制首图文案
              </Button>
            </div>
            <p className='mt-1 text-sm font-medium'>{note.coverText}</p>
          </div>
        )}

        {/* 配图提示词 */}
        {note.coverImageHint && (
          <div className='border-t pt-3'>
            <div className='flex items-center justify-between gap-2'>
              <p className='text-xs font-medium text-muted-foreground'>首图配图提示词</p>
              <Button
                variant='ghost'
                size='sm'
                className='h-7 px-2 text-xs'
                onClick={() => copyToClipboard(note.coverImageHint ?? '')}
              >
                <Copy className='h-3.5 w-3.5 mr-1' />
                复制配图词
              </Button>
            </div>
            <p className='mt-1 whitespace-pre-line text-xs text-muted-foreground'>
              {note.coverImageHint}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

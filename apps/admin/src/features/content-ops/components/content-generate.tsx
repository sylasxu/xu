import { useState } from 'react'
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
import { Loader2, Sparkles, Copy, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useGenerateNotes } from '../hooks/use-content'
import { useTrendInsights } from '@/hooks/use-growth'
import { CONTENT_TYPE_OPTIONS, type ContentType } from '../data/schema'

interface GeneratedNote {
  id: string
  title: string
  body: string
  hashtags: string[]
  coverImageHint: string | null
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('已复制到剪贴板')
}

export function ContentGenerate() {
  const [topic, setTopic] = useState('')
  const [contentType, setContentType] = useState<ContentType>('xiaohongshu')
  const [count, setCount] = useState('1')
  const [results, setResults] = useState<GeneratedNote[]>([])

  const generateMutation = useGenerateNotes()
  const { data: trendsData } = useTrendInsights('7d')

  const handleGenerate = async () => {
    if (!topic.trim()) return
    const trendKeywords = trendsData?.topWords?.slice(0, 5).map((w) => w.word)
    const data = await generateMutation.mutateAsync({
      topic,
      contentType,
      count: Number(count),
      trendKeywords,
    })
    setResults(Array.isArray(data) ? data : [])
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center gap-3'>
        <FileText className='h-6 w-6' />
        <h1 className='text-2xl font-bold'>内容生成</h1>
      </div>

      <div className='grid gap-6 lg:grid-cols-2'>
        {/* 输入区 */}
        <Card>
          <CardHeader>
            <CardTitle>生成配置</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div>
              <Label htmlFor='topic'>主题</Label>
              <Textarea
                id='topic'
                placeholder='输入笔记主题，如：周末重庆搭子局、观音桥火锅约饭...'
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={3}
                className='mt-2'
              />
            </div>

            <div>
              <Label>内容类型</Label>
              <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
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

            {/* 热门关键词 */}
            {trendsData?.topWords && trendsData.topWords.length > 0 && (
              <div>
                <Label>热门关键词（点击填入）</Label>
                <div className='mt-2 flex flex-wrap gap-2'>
                  {trendsData.topWords.slice(0, 10).map((item) => (
                    <Badge
                      key={item.word}
                      variant='outline'
                      className='cursor-pointer hover:bg-primary hover:text-primary-foreground'
                      onClick={() => setTopic((prev) => (prev ? `${prev} ${item.word}` : item.word))}
                    >
                      {item.word}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

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
                  生成笔记
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
                <p>输入主题，AI 帮你写小红书笔记</p>
              </CardContent>
            </Card>
          ) : (
            results.map((note, idx) => (
              <NoteCard key={note.id || idx} note={note} index={idx} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function NoteCard({ note, index }: { note: GeneratedNote; index: number }) {
  const hashtagsText = note.hashtags.map((t) => `#${t}`).join(' ')
  const fullText = `${note.title}\n\n${note.body}\n\n${hashtagsText}`

  return (
    <Card>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-base'>笔记 {index + 1}</CardTitle>
          <Button variant='ghost' size='sm' onClick={() => copyToClipboard(fullText)}>
            <Copy className='h-4 w-4 mr-1' />
            全文复制
          </Button>
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

        {/* 封面提示 */}
        {note.coverImageHint && (
          <p className='text-xs text-muted-foreground border-t pt-2'>
            📷 封面提示：{note.coverImageHint}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

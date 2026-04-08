import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCreateHotKeyword, useHotKeywordDetail, useUpdateHotKeyword } from '../hooks/use-hot-keywords'

const matchTypeOptions = [
  { value: 'exact', label: '完全匹配' },
  { value: 'prefix', label: '前缀匹配' },
  { value: 'fuzzy', label: '模糊匹配' },
] as const

const responseTypeOptions = [
  { value: 'widget_explore', label: '探索活动' },
  { value: 'widget_draft', label: '创建草稿' },
  { value: 'widget_ask_preference', label: '偏好询问' },
  { value: 'text', label: '文本回复' },
] as const

type MatchType = (typeof matchTypeOptions)[number]['value']
type ResponseType = (typeof responseTypeOptions)[number]['value']

export function HotKeywordForm({
  keywordId,
  onSuccess,
  onCancel,
}: {
  keywordId?: string
  onSuccess?: () => void
  onCancel?: () => void
}) {
  const isEdit = !!keywordId
  const { data: existingKeyword, isLoading: isLoadingDetail } = useHotKeywordDetail(keywordId || '')
  const createMutation = useCreateHotKeyword()
  const updateMutation = useUpdateHotKeyword()

  const [keyword, setKeyword] = useState('')
  const [matchType, setMatchType] = useState<MatchType>('exact')
  const [responseType, setResponseType] = useState<ResponseType>('widget_explore')
  const [responseContent, setResponseContent] = useState('{}')
  const [priority, setPriority] = useState('0')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (!existingKeyword) {
      return
    }

    setKeyword(existingKeyword.keyword)
    setMatchType(existingKeyword.matchType as MatchType)
    setResponseType(existingKeyword.responseType as ResponseType)
    setResponseContent(JSON.stringify(existingKeyword.responseContent, null, 2))
    setPriority(String(existingKeyword.priority))
    setValidFrom(existingKeyword.validFrom ? new Date(existingKeyword.validFrom).toISOString().slice(0, 16) : '')
    setValidUntil(existingKeyword.validUntil ? new Date(existingKeyword.validUntil).toISOString().slice(0, 16) : '')
    setIsActive(existingKeyword.isActive)
  }, [existingKeyword])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!keyword.trim()) {
      toast.error('关键词不能为空')
      return
    }

    if (keyword.length > 100) {
      toast.error('关键词长度不能超过 100 字符')
      return
    }

    let parsedContent: Record<string, unknown>
    try {
      parsedContent = JSON.parse(responseContent) as Record<string, unknown>
    } catch {
      toast.error('响应内容必须是有效的 JSON 格式')
      return
    }

    const contentSize = new Blob([responseContent]).size
    if (contentSize > 10 * 1024) {
      toast.error('响应内容大小不能超过 10KB')
      return
    }

    if (validFrom && validUntil && new Date(validFrom) >= new Date(validUntil)) {
      toast.error('生效时间必须早于失效时间')
      return
    }

    const data = {
      keyword: keyword.trim(),
      matchType,
      responseType,
      responseContent: parsedContent,
      priority: parseInt(priority, 10) || 0,
      validFrom: validFrom ? new Date(validFrom).toISOString() : undefined,
      validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
      ...(isEdit ? { isActive } : {}),
    }

    try {
      if (isEdit && keywordId) {
        await updateMutation.mutateAsync({ id: keywordId, data })
      } else {
        await createMutation.mutateAsync(data)
      }
      onSuccess?.()
    } catch {
      // mutation 内部已经 toast
    }
  }

  if (isEdit && isLoadingDetail) {
    return <div className='p-8 text-muted-foreground'>加载中...</div>
  }

  return (
    <Card className='border-0 shadow-none'>
      <CardHeader className='px-0 pt-0'>
        <CardTitle>{isEdit ? '编辑热词' : '创建热词'}</CardTitle>
        <CardDescription>配置关键词匹配规则和响应内容。</CardDescription>
      </CardHeader>
      <CardContent className='px-0'>
        <form onSubmit={handleSubmit} className='space-y-6'>
          <div className='space-y-2'>
            <Label htmlFor='keyword'>关键词 *</Label>
            <Input
              id='keyword'
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder='例如：仙女山'
              maxLength={100}
              required
            />
            <p className='text-sm text-muted-foreground'>用户输入的关键词文本，最多 100 字符。</p>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='matchType'>匹配方式 *</Label>
              <Select value={matchType} onValueChange={(value) => setMatchType(value as MatchType)}>
                <SelectTrigger id='matchType'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {matchTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='responseType'>响应类型 *</Label>
              <Select value={responseType} onValueChange={(value) => setResponseType(value as ResponseType)}>
                <SelectTrigger id='responseType'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {responseTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='responseContent'>响应内容 (JSON) *</Label>
            <textarea
              id='responseContent'
              value={responseContent}
              onChange={(e) => setResponseContent(e.target.value)}
              className='min-h-[220px] w-full rounded-md border p-3 font-mono text-sm'
              placeholder='{"center":{"lat":29.56,"lng":106.55,"name":"仙女山"}}'
              required
            />
            <p className='text-sm text-muted-foreground'>预设响应的 JSON 内容，最大 10KB。</p>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='priority'>优先级</Label>
            <Input
              id='priority'
              type='number'
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder='0'
            />
            <p className='text-sm text-muted-foreground'>数字越大优先级越高，默认为 0。</p>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='validFrom'>生效时间</Label>
              <Input id='validFrom' type='datetime-local' value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='validUntil'>失效时间</Label>
              <Input id='validUntil' type='datetime-local' value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          {isEdit ? (
            <div className='flex items-center space-x-2'>
              <Switch id='isActive' checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor='isActive'>启用热词</Label>
            </div>
          ) : null}

          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={onCancel}>
              取消
            </Button>
            <Button type='submit' disabled={createMutation.isPending || updateMutation.isPending}>
              <Save className='mr-2 h-4 w-4' />
              {isEdit ? '保存修改' : '创建热词'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

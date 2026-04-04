import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCreateHotKeyword, useUpdateHotKeyword, useHotKeywordDetail } from '../hooks/use-hot-keywords'
import { toast } from 'sonner'

const matchTypeOptions = [
  { value: 'exact', label: '完全匹配' },
  { value: 'prefix', label: '前缀匹配' },
  { value: 'fuzzy', label: '模糊匹配' },
]

const responseTypeOptions = [
  { value: 'widget_explore', label: '探索活动' },
  { value: 'widget_draft', label: '创建草稿' },
  { value: 'widget_ask_preference', label: '偏好询问' },
  { value: 'text', label: '文本回复' },
]

export function HotKeywordForm() {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const isEdit = !!params?.id
  
  const { data: existingKeyword, isLoading: isLoadingDetail } = useHotKeywordDetail(params?.id || '')
  const createMutation = useCreateHotKeyword()
  const updateMutation = useUpdateHotKeyword()

  const [keyword, setKeyword] = useState('')
  const [matchType, setMatchType] = useState<'exact' | 'prefix' | 'fuzzy'>('exact')
  const [responseType, setResponseType] = useState<'widget_explore' | 'widget_draft' | 'widget_ask_preference' | 'text'>('widget_explore')
  const [responseContent, setResponseContent] = useState('{}')
  const [priority, setPriority] = useState('0')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [isActive, setIsActive] = useState(true)

  // 加载现有数据
  useState(() => {
    if (existingKeyword) {
      setKeyword(existingKeyword.keyword)
      setMatchType(existingKeyword.matchType)
      setResponseType(existingKeyword.responseType)
      setResponseContent(JSON.stringify(existingKeyword.responseContent, null, 2))
      setPriority(String(existingKeyword.priority))
      setValidFrom(existingKeyword.validFrom ? new Date(existingKeyword.validFrom).toISOString().slice(0, 16) : '')
      setValidUntil(existingKeyword.validUntil ? new Date(existingKeyword.validUntil).toISOString().slice(0, 16) : '')
      setIsActive(existingKeyword.isActive)
    }
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // 验证关键词
    if (!keyword.trim()) {
      toast.error('关键词不能为空')
      return
    }

    if (keyword.length > 100) {
      toast.error('关键词长度不能超过 100 字符')
      return
    }

    // 验证 JSON
    let parsedContent: Record<string, any>
    try {
      parsedContent = JSON.parse(responseContent)
    } catch (error) {
      toast.error('响应内容必须是有效的 JSON 格式')
      return
    }

    // 验证 JSON 大小
    const contentSize = new Blob([responseContent]).size
    if (contentSize > 10 * 1024) {
      toast.error('响应内容大小不能超过 10KB')
      return
    }

    // 验证日期范围
    if (validFrom && validUntil) {
      const fromDate = new Date(validFrom)
      const untilDate = new Date(validUntil)
      if (fromDate >= untilDate) {
        toast.error('生效时间必须早于失效时间')
        return
      }
    }

    const data = {
      keyword: keyword.trim(),
      matchType,
      responseType,
      responseContent: parsedContent,
      priority: parseInt(priority) || 0,
      validFrom: validFrom ? new Date(validFrom).toISOString() : undefined,
      validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
      ...(isEdit && { isActive }),
    }

    try {
      if (isEdit && params?.id) {
        await updateMutation.mutateAsync({ id: params.id, data })
      } else {
        await createMutation.mutateAsync(data)
      }
      navigate({ to: '/hot-keywords' })
    } catch (error) {
      // Error is already handled by the mutation
    }
  }

  if (isEdit && isLoadingDetail) {
    return <div className='p-8'>加载中...</div>
  }

  return (
    <div className='container max-w-4xl py-8'>
      <div className='mb-6'>
        <Button
          variant='ghost'
          onClick={() => navigate({ to: '/hot-keywords' })}
        >
          <ArrowLeft className='mr-2 h-4 w-4' />
          返回列表
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? '编辑热词' : '创建热词'}</CardTitle>
          <CardDescription>
            配置关键词匹配规则和响应内容
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              <p className='text-sm text-muted-foreground'>
                用户输入的关键词文本，最多 100 字符
              </p>
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label htmlFor='matchType'>匹配方式 *</Label>
                <Select value={matchType} onValueChange={(value: any) => setMatchType(value)}>
                  <SelectTrigger id='matchType'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {matchTypeOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='responseType'>响应类型 *</Label>
                <Select value={responseType} onValueChange={(value: any) => setResponseType(value)}>
                  <SelectTrigger id='responseType'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {responseTypeOptions.map(option => (
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
                className='w-full min-h-[200px] p-3 font-mono text-sm border rounded-md'
                placeholder='{"center": {"lat": 29.56, "lng": 106.55, "name": "仙女山"}}'
                required
              />
              <p className='text-sm text-muted-foreground'>
                预设响应的 JSON 内容，最大 10KB
              </p>
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
              <p className='text-sm text-muted-foreground'>
                数字越大优先级越高，默认为 0
              </p>
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label htmlFor='validFrom'>生效时间</Label>
                <Input
                  id='validFrom'
                  type='datetime-local'
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='validUntil'>失效时间</Label>
                <Input
                  id='validUntil'
                  type='datetime-local'
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            </div>

            {isEdit && (
              <div className='flex items-center space-x-2'>
                <Switch
                  id='isActive'
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
                <Label htmlFor='isActive'>启用热词</Label>
              </div>
            )}

            <div className='flex justify-end gap-4'>
              <Button
                type='button'
                variant='outline'
                onClick={() => navigate({ to: '/hot-keywords' })}
              >
                取消
              </Button>
              <Button type='submit' disabled={createMutation.isPending || updateMutation.isPending}>
                <Save className='mr-2 h-4 w-4' />
                {isEdit ? '保存' : '创建'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

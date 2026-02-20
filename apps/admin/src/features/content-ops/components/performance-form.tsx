import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { useUpdatePerformance } from '../hooks/use-content'
import type { PerformanceUpdate } from '../data/schema'

const FIELDS: Array<{ key: keyof PerformanceUpdate; label: string }> = [
  { key: 'views', label: '浏览量' },
  { key: 'likes', label: '点赞数' },
  { key: 'collects', label: '收藏数' },
  { key: 'comments', label: '评论数' },
  { key: 'newFollowers', label: '涨粉数' },
]

interface PerformanceFormProps {
  noteId: string
  defaultValues?: PerformanceUpdate
}

export function PerformanceForm({ noteId, defaultValues }: PerformanceFormProps) {
  const [values, setValues] = useState<PerformanceUpdate>(defaultValues ?? {})
  const mutation = useUpdatePerformance()

  const handleChange = (key: keyof PerformanceUpdate, raw: string) => {
    const num = raw === '' ? undefined : Number(raw)
    setValues((prev) => ({ ...prev, [key]: num }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate({ id: noteId, data: values })
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      <div className='grid grid-cols-5 gap-3'>
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <Label htmlFor={key} className='text-xs'>
              {label}
            </Label>
            <Input
              id={key}
              type='number'
              min={0}
              placeholder='0'
              value={values[key] ?? ''}
              onChange={(e) => handleChange(key, e.target.value)}
              className='mt-1'
            />
          </div>
        ))}
      </div>
      <Button type='submit' size='sm' disabled={mutation.isPending}>
        {mutation.isPending && <Loader2 className='h-4 w-4 mr-1 animate-spin' />}
        保存效果数据
      </Button>
    </form>
  )
}

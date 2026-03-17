import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { useHotKeywordsListContext } from './list-context'

const matchTypeLabels: Record<string, string> = {
  exact: '完全匹配',
  prefix: '前缀匹配',
  fuzzy: '模糊匹配',
}

const responseTypeLabels: Record<string, string> = {
  widget_explore: '探索活动',
  widget_draft: '创建草稿',
  widget_launcher: '快速发起',
  widget_action: '操作引导',
  widget_ask_preference: '偏好询问',
  text: '文本回复',
}

export function HotKeywordViewDialog() {
  const { currentRow, setOpen } = useHotKeywordsListContext()

  if (!currentRow) return null

  const conversionRate = currentRow.hitCount > 0 
    ? ((currentRow.conversionCount / currentRow.hitCount) * 100).toFixed(2)
    : '0.00'

  return (
    <Dialog open={true} onOpenChange={(open) => !open && setOpen(null)}>
      <DialogContent className='max-w-2xl max-h-[80vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>热词详情</DialogTitle>
          <DialogDescription>
            查看热词的详细信息和响应内容
          </DialogDescription>
        </DialogHeader>
        
        <div className='space-y-4'>
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>关键词</label>
              <p className='text-lg font-semibold'>{currentRow.keyword}</p>
            </div>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>状态</label>
              <div className='mt-1'>
                <Badge variant={currentRow.isActive ? 'default' : 'secondary'}>
                  {currentRow.isActive ? '活跃' : '已停用'}
                </Badge>
              </div>
            </div>
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>匹配方式</label>
              <div className='mt-1'>
                <Badge variant='outline'>
                  {matchTypeLabels[currentRow.matchType]}
                </Badge>
              </div>
            </div>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>响应类型</label>
              <div className='mt-1'>
                <Badge variant='secondary'>
                  {responseTypeLabels[currentRow.responseType]}
                </Badge>
              </div>
            </div>
          </div>

          <div className='grid grid-cols-3 gap-4'>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>优先级</label>
              <p className='text-lg font-mono'>{currentRow.priority}</p>
            </div>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>命中次数</label>
              <p className='text-lg font-bold'>{currentRow.hitCount}</p>
            </div>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>转化次数</label>
              <p className='text-lg font-bold'>{currentRow.conversionCount}</p>
            </div>
          </div>

          <div>
            <label className='text-sm font-medium text-muted-foreground'>转化率</label>
            <p className='text-lg font-bold'>{conversionRate}%</p>
          </div>

          {(currentRow.validFrom || currentRow.validUntil) && (
            <div className='grid grid-cols-2 gap-4'>
              {currentRow.validFrom && (
                <div>
                  <label className='text-sm font-medium text-muted-foreground'>生效时间</label>
                  <p>{new Date(currentRow.validFrom).toLocaleString('zh-CN')}</p>
                </div>
              )}
              {currentRow.validUntil && (
                <div>
                  <label className='text-sm font-medium text-muted-foreground'>失效时间</label>
                  <p>{new Date(currentRow.validUntil).toLocaleString('zh-CN')}</p>
                </div>
              )}
            </div>
          )}

          <div>
            <label className='text-sm font-medium text-muted-foreground'>响应内容</label>
            <pre className='mt-2 p-4 bg-muted rounded-md overflow-x-auto text-sm'>
              {JSON.stringify(currentRow.responseContent, null, 2)}
            </pre>
          </div>

          <div className='grid grid-cols-2 gap-4 text-sm text-muted-foreground'>
            <div>
              <label className='font-medium'>创建时间</label>
              <p>{new Date(currentRow.createdAt).toLocaleString('zh-CN')}</p>
            </div>
            <div>
              <label className='font-medium'>更新时间</label>
              <p>{new Date(currentRow.updatedAt).toLocaleString('zh-CN')}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

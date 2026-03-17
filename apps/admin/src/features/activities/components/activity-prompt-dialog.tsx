import { useQuery } from '@tanstack/react-query'
import { MessageSquare, User, Bot, ExternalLink } from 'lucide-react'
import { api } from '@/lib/eden'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { activityStatusLabels } from '../data/data'
import { useActivitiesListContext } from '../list-context'

export function ActivityPromptDialog() {
  const { open, setOpen, currentRow } = useActivitiesListContext()

  // 查询关联此活动的对话记录
  const { data, isLoading } = useQuery({
    queryKey: ['activity-conversations', currentRow?.id],
    queryFn: async () => {
      if (!currentRow?.id) return null
      const response = await api.ai.activities({ activityId: currentRow.id }).messages.get()
      if (response.error) throw new Error('Failed to fetch conversations')
      return response.data
    },
    enabled: open === 'prompt' && !!currentRow?.id,
  })

  const conversations = data?.items ?? []

  return (
    <Dialog open={open === 'prompt'} onOpenChange={(v) => setOpen(v ? 'prompt' : null)}>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <MessageSquare className='h-5 w-5' />
            关联 Prompt 记录
          </DialogTitle>
          <DialogDescription>
            查看创建此活动时的 AI 对话历史
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {/* Activity Info */}
          {currentRow && (
            <div className='rounded-lg border bg-muted/50 p-3'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='font-medium'>{currentRow.title}</p>
                  <p className='text-sm text-muted-foreground'>
                    {currentRow.locationName}
                  </p>
                </div>
                <Badge variant={currentRow.status === 'active' ? 'default' : 'secondary'}>
                  {activityStatusLabels[currentRow.status] || currentRow.status}
                </Badge>
              </div>
            </div>
          )}

          {/* Conversations */}
          <ScrollArea className='h-[400px] rounded-md border p-4'>
            {isLoading ? (
              <div className='flex items-center justify-center h-full'>
                <p className='text-muted-foreground'>加载中...</p>
              </div>
            ) : conversations.length === 0 ? (
              <div className='flex flex-col items-center justify-center h-full gap-2'>
                <MessageSquare className='h-12 w-12 text-muted-foreground/50' />
                <p className='text-muted-foreground'>暂无关联对话记录</p>
                <p className='text-sm text-muted-foreground'>
                  此活动可能是通过其他方式创建的
                </p>
              </div>
            ) : (
              <div className='space-y-4'>
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`flex gap-3 ${
                      conv.role === 'user' ? 'flex-row-reverse' : ''
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        conv.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      {conv.role === 'user' ? (
                        <User className='h-4 w-4' />
                      ) : (
                        <Bot className='h-4 w-4' />
                      )}
                    </div>
                    <div
                      className={`flex-1 rounded-lg p-3 ${
                        conv.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      <div className='flex items-center gap-2 mb-1'>
                        <span className='text-xs opacity-70'>
                          {conv.role === 'user' ? (conv.userNickname || '用户') : 'AI'}
                        </span>
                        <Badge variant='outline' className='text-xs'>
                          {conv.type}
                        </Badge>
                      </div>
                      <p className='text-sm whitespace-pre-wrap'>
                        {typeof conv.content === 'string'
                          ? conv.content
                          : JSON.stringify(conv.content, null, 2)}
                      </p>
                      <p className='text-xs opacity-50 mt-2'>
                        {new Date(conv.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Actions */}
          <div className='flex justify-end gap-2'>
            <Button
              variant='outline'
              onClick={() => {
                if (currentRow?.id) {
                  window.open(`/playground?activityId=${currentRow.id}`, '_blank')
                }
              }}
            >
              <ExternalLink className='h-4 w-4 mr-2' />
              在 Playground 中测试
            </Button>
            <Button variant='default' onClick={() => setOpen(null)}>
              关闭
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

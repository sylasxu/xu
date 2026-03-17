import { User, Bot, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  useConversationDetail,
  useDeleteSession,
  useDeleteSessionsBatch,
  type ConversationSession,
  type ConversationMessage,
} from '@/hooks/use-conversations'
import { useConversationsListContext } from '../list-context'

// 消息类型映射
const MESSAGE_TYPES: Record<string, string> = {
  text: '文本',
  widget_dashboard: '欢迎卡片',
  widget_launcher: '发射台',
  widget_action: '快捷操作',
  widget_draft: '活动草稿',
  widget_share: '分享卡片',
  widget_explore: '探索卡片',
  widget_error: '错误',
  widget_ask_preference: '偏好询问',
}

// 消息类型颜色
const messageTypeColors: Record<string, string> = {
  text: 'bg-gray-100 text-gray-800',
  widget_dashboard: 'bg-blue-100 text-blue-800',
  widget_launcher: 'bg-purple-100 text-purple-800',
  widget_action: 'bg-cyan-100 text-cyan-800',
  widget_draft: 'bg-green-100 text-green-800',
  widget_share: 'bg-indigo-100 text-indigo-800',
  widget_explore: 'bg-orange-100 text-orange-800',
  widget_error: 'bg-red-100 text-red-800',
  widget_ask_preference: 'bg-yellow-100 text-yellow-800',
}

export function ConversationsDialogs() {
  const { open, setOpen, currentRow, selectedRows, setSelectedRows } = useConversationsListContext()
  const deleteSession = useDeleteSession()
  const deleteSessionsBatch = useDeleteSessionsBatch()

  const handleDelete = () => {
    if (currentRow) {
      deleteSession.mutate(currentRow.id, {
        onSuccess: () => setOpen(null),
      })
    }
  }

  const handleBatchDelete = () => {
    if (selectedRows && selectedRows.length > 0) {
      const ids = selectedRows.map(row => row.id)
      deleteSessionsBatch.mutate(ids, {
        onSuccess: () => {
          setOpen(null)
          setSelectedRows?.([])
        },
      })
    }
  }

  return (
    <>
      <SessionDetailDialog
        session={currentRow}
        open={open === 'view'}
        onClose={() => setOpen(null)}
      />

      {/* 单个删除确认 */}
      <AlertDialog open={open === 'delete'} onOpenChange={() => setOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className='flex items-center gap-2'>
              <AlertTriangle className='h-5 w-5 text-destructive' />
              确认删除会话
            </AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{currentRow?.title || '无标题'}」会话吗？
              <br />
              此操作将同时删除该会话的所有消息，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              disabled={deleteSession.isPending}
            >
              {deleteSession.isPending ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 批量删除确认 */}
      <AlertDialog open={open === 'batch-delete'} onOpenChange={() => setOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className='flex items-center gap-2'>
              <AlertTriangle className='h-5 w-5 text-destructive' />
              确认批量删除
            </AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除选中的 {selectedRows?.length || 0} 个会话吗？
              <br />
              此操作将同时删除这些会话的所有消息，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBatchDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              disabled={deleteSessionsBatch.isPending}
            >
              {deleteSessionsBatch.isPending ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// 会话详情弹窗
function SessionDetailDialog({
  session,
  open,
  onClose,
}: {
  session: ConversationSession | null
  open: boolean
  onClose: () => void
}) {
  const { data, isLoading } = useConversationDetail(session?.id ?? null, open)

  if (!session) return null

  const messages = data?.messages || []

  // 获取内容显示
  const getContentDisplay = (content: unknown): string => {
    if (typeof content === 'string') {
      return content
    }
    if (content && typeof content === 'object') {
      const obj = content as Record<string, unknown>
      if ('text' in obj && typeof obj.text === 'string') {
        return obj.text
      }
      if ('title' in obj && typeof obj.title === 'string') {
        return obj.title
      }
    }
    return JSON.stringify(content, null, 2)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className='max-w-3xl h-[80vh] flex flex-col overflow-hidden'>
        <DialogHeader className='shrink-0'>
          <DialogTitle className='flex items-center gap-2'>
            <User className='h-5 w-5' />
            {session.userNickname || '匿名用户'} 的对话
            <Badge variant='secondary' className='ml-2'>
              {session.messageCount} 条消息
            </Badge>
          </DialogTitle>
          {session.title && (
            <p className='text-sm text-muted-foreground'>{session.title}</p>
          )}
        </DialogHeader>

        {isLoading ? (
          <div className='flex h-40 items-center justify-center text-muted-foreground'>
            加载中...
          </div>
        ) : messages.length === 0 ? (
          <div className='flex h-40 items-center justify-center text-muted-foreground'>
            暂无消息
          </div>
        ) : (
          <ScrollArea className='flex-1 min-h-0'>
            <div className='space-y-3 py-4 pr-4'>
              {messages.map((msg: ConversationMessage) => {
                const isUser = msg.role === 'user'
                const typeLabel = MESSAGE_TYPES[msg.messageType] || msg.messageType
                const typeColor = messageTypeColors[msg.messageType] || 'bg-gray-100 text-gray-800'

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex gap-3 rounded-lg p-3',
                      msg.messageType === 'widget_error' && 'bg-red-50/50 ring-1 ring-red-200'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      )}
                    >
                      {isUser ? <User className='h-3.5 w-3.5' /> : <Bot className='h-3.5 w-3.5' />}
                    </div>

                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-2 mb-1'>
                        <span className='text-sm font-medium'>
                          {isUser ? '用户' : 'AI'}
                        </span>
                        <Badge variant='secondary' className={cn('text-xs', typeColor)}>
                          {typeLabel}
                        </Badge>
                        <span className='ml-auto text-xs text-muted-foreground'>
                          {format(new Date(msg.createdAt), 'HH:mm:ss', { locale: zhCN })}
                        </span>
                      </div>
                      
                      <div className='rounded-md border bg-background p-2 text-sm whitespace-pre-wrap break-words'>
                        {getContentDisplay(msg.content)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}

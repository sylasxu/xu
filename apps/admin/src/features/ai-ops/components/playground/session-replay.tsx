/**
 * SessionReplay Component
 *
 * 支持选择历史会话（ConversationThread），按时间顺序逐条回放消息
 * 展示每条消息对应的 Trace 数据（意图分类、工具调用、处理器执行链路）
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, Play, Pause, SkipForward, RotateCcw } from 'lucide-react'
import { api, unwrap } from '@/lib/eden'

interface ReplayConversation {
  id: string
  title: string | null
  messageCount: number
}

interface ReplayMessage {
  id: string
  role: string
  createdAt: string
  activityId?: string | null
  content: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readConversation(value: unknown): ReplayConversation | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null
  }

  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : null,
    messageCount: typeof value.messageCount === 'number' ? value.messageCount : 0,
  }
}

function readReplayMessage(value: unknown): ReplayMessage | null {
  if (!isRecord(value)) {
    return null
  }

  const id = typeof value.id === 'string' ? value.id : null
  const role = typeof value.role === 'string' ? value.role : null
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : null

  if (!id || !role || !createdAt) {
    return null
  }

  return {
    id,
    role,
    createdAt,
    activityId: typeof value.activityId === 'string' ? value.activityId : null,
    content: value.content,
  }
}

function formatMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (content == null) {
    return ''
  }

  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

export function SessionReplay() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [replayIndex, setReplayIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  // 获取会话列表
  const { data: conversations, isLoading: loadingConversations } = useQuery({
    queryKey: ['conversations-replay'],
    queryFn: async () => {
      const result = await unwrap(api.ai.sessions.get({ query: { page: 1, limit: 20 } })).catch(() => null)
      return Array.isArray(result?.items)
        ? result.items
            .map((item) => readConversation(item))
            .filter((item): item is ReplayConversation => item !== null)
        : []
    },
  })

  // 获取选中会话的消息
  const { data: messages, isLoading: loadingMessages } = useQuery({
    queryKey: ['conversation-messages', selectedConversationId],
    queryFn: async () => {
      if (!selectedConversationId) return []
      const result = await unwrap(api.ai.sessions({ id: selectedConversationId }).get()).catch(() => null)
      return Array.isArray(result?.messages)
        ? result.messages
            .map((item) => readReplayMessage(item))
            .filter((item): item is ReplayMessage => item !== null)
        : []
    },
    enabled: !!selectedConversationId,
  })

  const messageList = Array.isArray(messages) ? messages : []
  const visibleMessages = messageList.slice(0, replayIndex + 1)

  const handlePlay = () => {
    if (replayIndex >= messageList.length - 1) {
      setReplayIndex(0)
    }
    setIsPlaying(true)
    // 自动播放
    const timer = setInterval(() => {
      setReplayIndex(prev => {
        if (prev >= messageList.length - 1) {
          clearInterval(timer)
          setIsPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, 1500)
  }

  const handleReset = () => {
    setReplayIndex(0)
    setIsPlaying(false)
  }

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-sm font-medium">会话回放</h3>

      {/* 会话选择 */}
      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">选择会话</span>
        {loadingConversations && <Loader2 className="h-4 w-4 animate-spin" />}
        <div className="max-h-32 overflow-y-auto space-y-1">
          {Array.isArray(conversations) && conversations.map((conv) => (
            <div
              key={conv.id}
              className={`rounded-md border p-2 cursor-pointer text-xs transition-colors ${selectedConversationId === conv.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'}`}
              onClick={() => { setSelectedConversationId(conv.id); setReplayIndex(0); setIsPlaying(false) }}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{conv.title || '未命名会话'}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{conv.messageCount ?? 0} 条</span>
              </div>
            </div>
          ))}
          {Array.isArray(conversations) && conversations.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">暂无历史会话</p>
          )}
        </div>
      </div>

      {/* 回放控制 */}
      {selectedConversationId && (
        <>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePlay} disabled={isPlaying}>
              <Play className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsPlaying(false)} disabled={!isPlaying}>
              <Pause className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setReplayIndex(Math.min(replayIndex + 1, messageList.length - 1))} disabled={replayIndex >= messageList.length - 1}>
              <SkipForward className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {replayIndex + 1} / {messageList.length}
            </span>
          </div>

          {/* 消息列表 */}
          {loadingMessages ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {visibleMessages.map((msg, i) => (
                <div key={msg.id} className={`rounded-md border p-2.5 ${i === replayIndex ? 'border-primary bg-primary/5' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={msg.role === 'user' ? 'outline' : 'default'} className="text-[10px]">
                      {msg.role === 'user' ? '用户' : 'AI'}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(msg.createdAt).toLocaleTimeString('zh-CN')}
                    </span>
                    {msg.activityId && (
                      <Badge variant="secondary" className="text-[10px]">活动关联</Badge>
                    )}
                  </div>
                  <p className="text-xs whitespace-pre-wrap line-clamp-4">{formatMessageContent(msg.content)}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

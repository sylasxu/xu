/**
 * ChatView Component
 *
 * Drawer 对话视图：消息列表 + Tool 卡片 + 输入框 + 欢迎状态
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { UIMessage } from '@ai-sdk/react'
import { Send, Square, Trash2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { api, unwrap } from '@/lib/eden'
import { cn } from '@/lib/utils'
import { TOOL_DISPLAY_NAMES } from '../../types/trace'
import { StreamingText } from '../shared/streaming-text'

interface ChatViewProps {
  messages: UIMessage[]
  onSendMessage: (text: string) => void
  onClear: () => void
  onStop: () => void
  isLoading: boolean
  error?: Error | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTextPartText(part: UIMessage['parts'][number]): string {
  if (part.type !== 'text' || !('text' in part) || typeof part.text !== 'string') {
    return ''
  }

  return part.text
}

function readToolCallPart(part: UIMessage['parts'][number]): {
  type: string
  toolName: string
  state: string
  input: Record<string, unknown>
  output?: unknown
} | null {
  if (
    typeof part.type !== 'string' ||
    !part.type.startsWith('tool-') ||
    !('toolName' in part) ||
    typeof part.toolName !== 'string' ||
    !('state' in part) ||
    typeof part.state !== 'string' ||
    !('input' in part) ||
    !isRecord(part.input)
  ) {
    return null
  }

  return {
    type: part.type,
    toolName: part.toolName,
    state: part.state,
    input: part.input,
    ...('output' in part ? { output: part.output } : {}),
  }
}

function readWelcomeQuickPrompts(value: unknown): Array<{ text: string; icon?: string }> {
  if (!isRecord(value) || !Array.isArray(value.quickPrompts)) {
    return []
  }

  return value.quickPrompts
    .map((item) => {
      if (!isRecord(item) || typeof item.text !== 'string') {
        return null
      }

      const text = item.text.trim()
      if (!text) {
        return null
      }

      return {
        text,
        ...(typeof item.icon === 'string' && item.icon.trim() ? { icon: item.icon.trim() } : {}),
      }
    })
    .filter((item): item is { text: string; icon?: string } => item !== null)
}

export function ChatView({ messages, onSendMessage, onClear, onStop, isLoading, error }: ChatViewProps) {
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || isLoading) return
    onSendMessage(text)
    setInput('')
    textareaRef.current?.focus()
  }, [input, isLoading, onSendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  // 空状态：获取欢迎数据
  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto">
          <WelcomeState onSendMessage={onSendMessage} />
        </div>
        <ChatInput
          input={input}
          setInput={setInput}
          onSend={handleSend}
          onKeyDown={handleKeyDown}
          isLoading={isLoading}
          textareaRef={textareaRef}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-end gap-2 px-4 py-2">
        {isLoading && (
          <Button variant="ghost" size="sm" onClick={onStop} className="gap-1.5 text-xs">
            <Square className="h-3 w-3" />
            停止
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear} className="gap-1.5 text-xs">
          <Trash2 className="h-3 w-3" />
          清空
        </Button>
      </div>

      <Separator />

      {/* 消息列表 */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="space-y-4 p-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} isStreaming={isLoading} />
          ))}
          {error && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                AI 请求失败: {error.message || '未知错误'}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 输入框 */}
      <ChatInput
        input={input}
        setInput={setInput}
        onSend={handleSend}
        onKeyDown={handleKeyDown}
        isLoading={isLoading}
        textareaRef={textareaRef}
      />
    </div>
  )
}


// ============ 子组件 ============

/** 消息气泡 */
function MessageBubble({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
  const isUser = message.role === 'user'
  const textContent = (message.parts ?? []).map(readTextPartText).join('')
  const toolParts = (message.parts ?? [])
    .map(readToolCallPart)
    .filter((part): part is NonNullable<ReturnType<typeof readToolCallPart>> => part !== null)

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        {/* 文本内容 */}
        {textContent && (
          <div className="whitespace-pre-wrap break-words">
            {!isUser && isStreaming ? (
              <StreamingText content={textContent} isStreaming={isStreaming} />
            ) : (
              textContent
            )}
          </div>
        )}

        {/* Tool 调用卡片 */}
        {toolParts.length > 0 && (
          <div className="mt-2 space-y-2">
            {toolParts.map((part, i) => (
              <ToolCard key={i} toolName={part.toolName} state={part.state} input={part.input} output={part.output} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Tool 调用卡片 */
function ToolCard({
  toolName,
  state,
  output,
}: {
  toolName: string
  state: string
  input?: Record<string, unknown>
  output?: unknown
}) {
  const displayName = TOOL_DISPLAY_NAMES[toolName] || toolName
  const isComplete = state === 'output-available'

  return (
    <div className="rounded-md border bg-background/50 p-2">
      <div className="flex items-center gap-2">
        <Badge variant={isComplete ? 'default' : 'secondary'} className="text-xs">
          {displayName}
        </Badge>
        {!isComplete && (
          <span className="text-xs text-muted-foreground animate-pulse">执行中...</span>
        )}
      </div>
      {isComplete && output != null && (
        <ToolResultPreview toolName={toolName} result={output} />
      )}
    </div>
  )
}

/** Tool 结果预览 */
function ToolResultPreview({ toolName, result }: { toolName: string; result: unknown }) {
  if (!isRecord(result)) {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground truncate">
        {JSON.stringify(result).slice(0, 80)}...
      </div>
    )
  }

  const data = result

  // exploreNearby: 活动列表
  if (toolName === 'exploreNearby' && Array.isArray(data.activities)) {
    const activities = data.activities.filter((activity): activity is { title: string } => (
      isRecord(activity) && typeof activity.title === 'string'
    ))
    return (
      <div className="mt-1.5 space-y-1">
        {activities.slice(0, 3).map((activity, i) => (
          <div key={i} className="text-xs text-muted-foreground truncate">
            • {activity.title}
          </div>
        ))}
        {activities.length > 3 && (
          <div className="text-xs text-muted-foreground">
            ...共 {activities.length} 个活动
          </div>
        )}
      </div>
    )
  }

  // publishActivity: 成功提示
  if (toolName === 'publishActivity') {
    return (
      <div className="mt-1.5 text-xs text-green-600 dark:text-green-400">
        活动发布成功
      </div>
    )
  }

  // createPartnerIntent: 意向信息
  if (toolName === 'createPartnerIntent' && data.type) {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        已创建 {String(data.type)} 意向
      </div>
    )
  }

  // askPreference: 选项
  if (toolName === 'askPreference' && Array.isArray(data.options)) {
    const options = data.options.filter((option): option is string => typeof option === 'string')
    return (
      <div className="mt-1.5 flex flex-wrap gap-1">
        {options.map((option, i) => (
          <Badge key={i} variant="outline" className="text-xs">
            {option}
          </Badge>
        ))}
      </div>
    )
  }

  // 默认：简单摘要
  return (
    <div className="mt-1.5 text-xs text-muted-foreground truncate">
      {JSON.stringify(data).slice(0, 80)}...
    </div>
  )
}

/** 欢迎状态 */
function WelcomeState({ onSendMessage }: { onSendMessage: (text: string) => void }) {
  const { data: welcome } = useQuery({
    queryKey: ['ai', 'welcome'],
    queryFn: () => unwrap(api.ai.welcome.get({})),
    staleTime: 5 * 60 * 1000,
  })

  const welcomeQuickPrompts = readWelcomeQuickPrompts(welcome)
  const quickActions = welcomeQuickPrompts.length > 0
    ? welcomeQuickPrompts
    : [
    { text: '帮我组个局', icon: '🎯' },
    { text: '附近有什么好玩的', icon: '🗺️' },
    { text: '找个搭子', icon: '🤝' },
  ]

  return (
    <div className="flex flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <div className="text-center">
        <h3 className="text-sm font-medium">AI Playground</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {welcome?.greeting ?? '发送消息开始调试 AI 对话'}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {quickActions.map((action, i) => (
          <Button
            key={i}
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => onSendMessage(action.text)}
          >
            {action.icon && <span>{action.icon}</span>}
            {action.text}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** 输入框 */
function ChatInput({
  input,
  setInput,
  onSend,
  onKeyDown,
  isLoading,
  textareaRef,
}: {
  input: string
  setInput: (v: string) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  isLoading: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  return (
    <div className="border-t p-3">
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          rows={2}
          className="min-h-[60px] resize-none text-sm"
        />
        <Button
          size="icon"
          onClick={onSend}
          disabled={!input.trim() || isLoading}
          className="h-[60px] w-10 shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

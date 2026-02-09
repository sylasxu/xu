"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  reasoning?: string
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setIsStreaming(true)
    setInput("")

    // 添加用户消息
    const userMsg: ChatMessage = { role: "user", content: text }
    setMessages((prev) => [...prev, userMsg])

    // 添加空的 assistant 消息占位
    setMessages((prev) => [...prev, { role: "assistant", content: "" }])

    try {
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          source: "miniprogram",
        }),
      })

      if (!res.ok) {
        throw new Error("AI 服务暂时不可用")
      }

      // 读取 Data Stream 格式的流式响应
      const reader = res.body?.getReader()
      if (!reader) throw new Error("无法读取响应流")

      const decoder = new TextDecoder()
      let assistantContent = ""
      let reasoning = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (!line.trim()) continue

          // Data Stream Protocol 格式: type:data
          // 0:"text" - 文本增量
          // g:"reasoning" - 推理增量
          if (line.startsWith("0:")) {
            try {
              const text = JSON.parse(line.slice(2))
              assistantContent += text
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    content: assistantContent,
                    reasoning: reasoning || undefined,
                  }
                }
                return updated
              })
            } catch {
              // 忽略解析错误
            }
          } else if (line.startsWith("g:")) {
            try {
              const text = JSON.parse(line.slice(2))
              reasoning += text
              setMessages((prev) => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    content: assistantContent,
                    reasoning,
                  }
                }
                return updated
              })
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error) {
      // 更新最后一条消息为错误提示
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === "assistant" && !last.content) {
          updated[updated.length - 1] = {
            ...last,
            content: "网络有点慢，再试一次？",
          }
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
    }
  }, [input, isStreaming, messages])

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col">
      {/* 顶栏 */}
      <header className="shrink-0 border-b border-gray-200 px-4 py-3 text-center">
        <h1 className="text-base font-medium text-gray-900">
          小聚 · 你的 AI 活动助理
        </h1>
      </header>

      {/* 消息列表 */}
      <Conversation className="flex-1 overflow-y-auto" ref={scrollRef}>
        <ConversationContent>
          {messages.length === 0 && (
            <div className="flex flex-1 items-center justify-center py-20">
              <p className="text-sm text-gray-400">
                想找点乐子？还是想约人？跟我说说。
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i}>
              {/* 推理过程 */}
              {msg.role === "assistant" && msg.reasoning && (
                <Reasoning className="mb-2">
                  <ReasoningTrigger />
                  <ReasoningContent>{msg.reasoning}</ReasoningContent>
                </Reasoning>
              )}
              <Message from={msg.role}>
                <MessageContent>
                  {msg.content || (isStreaming && i === messages.length - 1 ? "思考中..." : "")}
                </MessageContent>
              </Message>
            </div>
          ))}
        </ConversationContent>
      </Conversation>

      {/* 输入栏 */}
      <div className="shrink-0 border-t border-gray-200 p-4">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="想找点乐子？还是想约人？跟我说说。"
          />
          <PromptInputSubmit
            status={isStreaming ? "streaming" : "ready"}
            disabled={!input.trim()}
          />
        </PromptInput>
      </div>
    </div>
  )
}

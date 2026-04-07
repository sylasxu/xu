"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Send, Sparkles, Users, Wifi, WifiOff } from "lucide-react"
import { useSearchParams } from "next/navigation"

import { readClientToken, readClientUserId } from "@/lib/client-auth"
import { cn } from "@/lib/utils"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996"
const WS_BASE = API_BASE.replace(/^https?:\/\//, (matched) => matched === "https://" ? "wss://" : "ws://")

type RuntimeMessage = {
  id: string
  senderId: string | null
  senderNickname: string | null
  senderAvatarUrl: string | null
  content: string
  createdAt: string
}

type WsServerPayload =
  | {
      type: "history"
      data: RuntimeMessage[]
      ts: number
    }
  | {
      type: "message"
      data: RuntimeMessage
      ts: number
    }
  | {
      type: "online"
      data: {
        count: number
      }
      ts: number
    }
  | {
      type: "join" | "leave"
      data: {
        userId: string
        nickname: string
      }
      ts: number
    }
  | {
      type: "error"
      data: {
        code?: number
        message?: string
      }
      ts: number
    }
  | {
      type: "pong"
      data: null
      ts: number
    }

type MessageResponse = {
  id: string
  activityId: string
  senderId: string | null
  senderNickname: string | null
  senderAvatarUrl: string | null
  type: string
  content: string
  createdAt: string
}

type DiscussionRuntimePanelProps = {
  activityId: string
  activityTitle: string
  initialMessages: Array<{
    senderNickname: string | null
    senderAvatar: string | null
    content: string
    createdAt: string
  }>
  isArchived: boolean
}

type LoadState = "visitor" | "loading" | "ready" | "not_participant" | "error"
type ConnectionState = "idle" | "connecting" | "connected" | "disconnected"

function buildInitialMessages(
  messages: DiscussionRuntimePanelProps["initialMessages"]
): RuntimeMessage[] {
  return messages.map((message, index) => ({
    id: `preview-${index}-${message.createdAt}`,
    senderId: null,
    senderNickname: message.senderNickname,
    senderAvatarUrl: message.senderAvatar,
    content: message.content,
    createdAt: message.createdAt,
  }))
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) {
    return dateString
  }

  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff < 60 * 1000) {
    return "刚刚"
  }

  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 1000))} 分钟前`
  }

  if (date.toDateString() === now.toDateString()) {
    return `${date.getHours().toString().padStart(2, "0")}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}`
  }

  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`
}

function buildJoinGuideTitle(title: string): string {
  return `你已经加入「${title || "这场活动"}」`
}

function getJoinQuickStarters(title: string): string[] {
  const normalizedTitle = title.trim() || "这场活动"
  return [
    `哈喽，我刚报名「${normalizedTitle}」，很高兴认识大家～`,
    `我是刚进来的，关于「${normalizedTitle}」大家一般几点到呀？`,
    `我会按时到，大家出发前也可以在群里说一声～`,
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readWsPayload(value: unknown): WsServerPayload | null {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.ts !== "number") {
    return null
  }

  const ts = value.ts

  switch (value.type) {
    case "history":
      return Array.isArray(value.data)
        ? {
            type: "history",
            data: value.data.filter(isRecord).map((item, index) => ({
              id: typeof item.id === "string" ? item.id : `history-${index}-${ts}`,
              senderId: typeof item.senderId === "string" ? item.senderId : null,
              senderNickname: typeof item.senderNickname === "string" ? item.senderNickname : null,
              senderAvatarUrl: typeof item.senderAvatarUrl === "string" ? item.senderAvatarUrl : null,
              content: typeof item.content === "string" ? item.content : "",
              createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(ts).toISOString(),
            })),
            ts,
          }
        : null
    case "message":
      return isRecord(value.data)
        ? {
            type: "message",
            data: {
              id: typeof value.data.id === "string" ? value.data.id : `message-${ts}`,
              senderId: typeof value.data.senderId === "string" ? value.data.senderId : null,
              senderNickname: typeof value.data.senderNickname === "string" ? value.data.senderNickname : null,
              senderAvatarUrl: typeof value.data.senderAvatarUrl === "string" ? value.data.senderAvatarUrl : null,
              content: typeof value.data.content === "string" ? value.data.content : "",
              createdAt: typeof value.data.createdAt === "string" ? value.data.createdAt : new Date(ts).toISOString(),
            },
            ts,
          }
        : null
    case "online":
      return isRecord(value.data) && typeof value.data.count === "number"
        ? {
            type: "online",
            data: { count: value.data.count },
            ts,
          }
        : null
    case "join":
    case "leave":
      return isRecord(value.data) && typeof value.data.userId === "string" && typeof value.data.nickname === "string"
        ? {
            type: value.type,
            data: {
              userId: value.data.userId,
              nickname: value.data.nickname,
            },
            ts,
          }
        : null
    case "error":
      return isRecord(value.data)
        ? {
            type: "error",
            data: {
              ...(typeof value.data.code === "number" ? { code: value.data.code } : {}),
              ...(typeof value.data.message === "string" ? { message: value.data.message } : {}),
            },
            ts,
          }
        : null
    case "pong":
      return {
        type: "pong",
        data: null,
        ts,
      }
    default:
      return null
  }
}

function toRuntimeMessages(items: MessageResponse[]): RuntimeMessage[] {
  return items.map((item) => ({
    id: item.id,
    senderId: item.senderId,
    senderNickname: item.senderNickname,
    senderAvatarUrl: item.senderAvatarUrl,
    content: item.content,
    createdAt: item.createdAt,
  }))
}

function mergeMessageList(current: RuntimeMessage[], incoming: RuntimeMessage): RuntimeMessage[] {
  if (current.some((message) => message.id === incoming.id)) {
    return current
  }

  return [...current, incoming].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  )
}

export function DiscussionRuntimePanel({
  activityId,
  activityTitle,
  initialMessages,
  isArchived,
}: DiscussionRuntimePanelProps) {
  const searchParams = useSearchParams()
  const entry = searchParams.get("entry") || ""
  const isJoinSuccessEntry = entry === "join_success"
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [messages, setMessages] = useState<RuntimeMessage[]>(() => buildInitialMessages(initialMessages))
  const [loadState, setLoadState] = useState<LoadState>("visitor")
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle")
  const [onlineCount, setOnlineCount] = useState(0)
  const [input, setInput] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const pingTimerRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const quickStarters = useMemo(() => {
    return isJoinSuccessEntry ? getJoinQuickStarters(activityTitle) : []
  }, [activityTitle, isJoinSuccessEntry])

  const syncAuth = useCallback(() => {
    const token = readClientToken()
    setAuthToken(token)
    setCurrentUserId(readClientUserId(token))
  }, [])

  useEffect(() => {
    syncAuth()
    window.addEventListener("focus", syncAuth)
    window.addEventListener("storage", syncAuth)
    document.addEventListener("visibilitychange", syncAuth)

    return () => {
      window.removeEventListener("focus", syncAuth)
      window.removeEventListener("storage", syncAuth)
      document.removeEventListener("visibilitychange", syncAuth)
    }
  }, [syncAuth])

  useEffect(() => {
    if (!scrollRef.current) {
      return
    }

    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const closeSocket = useCallback(() => {
    if (pingTimerRef.current) {
      window.clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const loadMessages = useCallback(async () => {
    if (!authToken) {
      setLoadState("visitor")
      setMessages(buildInitialMessages(initialMessages))
      return
    }

    setLoadState("loading")
    setNotice(null)

    try {
      const response = await fetch(`${API_BASE}/chat/${activityId}/messages?limit=50`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        cache: "no-store",
      })
      const payload = (await response.json().catch(() => null)) as unknown

      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.msg === "string" ? payload.msg : `请求失败（${response.status}）`
        if (message.includes("不是该活动的参与者")) {
          setLoadState("not_participant")
          setMessages(buildInitialMessages(initialMessages))
          return
        }

        setLoadState("error")
        setNotice(message)
        return
      }

      if (!isRecord(payload) || !Array.isArray(payload.messages)) {
        setLoadState("error")
        setNotice("讨论消息加载失败")
        return
      }

      const parsedMessages = toRuntimeMessages(
        payload.messages.filter(isRecord).map((item) => ({
          id: typeof item.id === "string" ? item.id : "",
          activityId: typeof item.activityId === "string" ? item.activityId : activityId,
          senderId: typeof item.senderId === "string" ? item.senderId : null,
          senderNickname: typeof item.senderNickname === "string" ? item.senderNickname : null,
          senderAvatarUrl: typeof item.senderAvatarUrl === "string" ? item.senderAvatarUrl : null,
          type: typeof item.type === "string" ? item.type : "text",
          content: typeof item.content === "string" ? item.content : "",
          createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        }))
      )

      setMessages(parsedMessages)
      setLoadState("ready")
    } catch (error) {
      setLoadState("error")
      setNotice(error instanceof Error ? error.message : "讨论消息加载失败")
    }
  }, [activityId, authToken, initialMessages])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  useEffect(() => {
    closeSocket()

    if (!authToken || isArchived || loadState !== "ready") {
      setConnectionState(authToken && isArchived ? "disconnected" : "idle")
      return
    }

    setConnectionState("connecting")
    const ws = new WebSocket(`${WS_BASE}/chat/${activityId}/ws?token=${encodeURIComponent(authToken)}`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnectionState("connected")
      pingTimerRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }))
        }
      }, 15000)
    }

    ws.onmessage = (event) => {
      let payload: unknown

      try {
        payload = JSON.parse(String(event.data))
      } catch {
        return
      }

      const parsed = readWsPayload(payload)
      if (!parsed) {
        return
      }

      if (parsed.type === "history") {
        setMessages(parsed.data)
        return
      }

      if (parsed.type === "message") {
        setMessages((current) => mergeMessageList(current, parsed.data))
        return
      }

      if (parsed.type === "online") {
        setOnlineCount(parsed.data.count)
        return
      }

      if (parsed.type === "error") {
        setNotice(parsed.data.message || "讨论区连接出现异常")
      }
    }

    ws.onerror = () => {
      setConnectionState("disconnected")
    }

    ws.onclose = () => {
      setConnectionState("disconnected")
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current)
        pingTimerRef.current = null
      }
    }

    return () => {
      closeSocket()
    }
  }, [activityId, authToken, closeSocket, isArchived, loadState])

  const sendMessage = useCallback(async (content: string) => {
    const text = content.trim()
    if (!text || !authToken || isArchived || loadState !== "ready") {
      return
    }

    setSending(true)
    setNotice(null)

    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "message", content: text }))
      } else {
        const response = await fetch(`${API_BASE}/chat/${activityId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: text }),
        })
        const payload = (await response.json().catch(() => null)) as unknown
        if (!response.ok) {
          throw new Error(isRecord(payload) && typeof payload.msg === "string" ? payload.msg : `发送失败（${response.status}）`)
        }

        await loadMessages()
      }

      setInput("")
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "发送失败，请稍后再试")
    } finally {
      setSending(false)
    }
  }, [activityId, authToken, isArchived, loadMessages, loadState])

  const isReadOnly = isArchived || loadState !== "ready"
  const showComposer = loadState === "ready" && !isArchived

  return (
    <section className="rounded-2xl bg-white/90 p-4 shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-700">讨论区</h2>
            {connectionState === "connected" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                <Wifi className="h-3 w-3" />
                实时在线
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                <WifiOff className="h-3 w-3" />
                {isArchived ? "已归档" : "预览模式"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            {loadState === "visitor"
              ? "登录并加入后，这里会继续承接后续讨论和安排。"
              : loadState === "not_participant"
                ? "你还没加入这场活动，加入后这里会自动变成可继续沟通的讨论区。"
                : isArchived
                  ? "活动已归档，目前保留只读记录。"
                  : "加入成功后，接下来就在这里继续破冰、对齐和协作。"}
          </p>
        </div>

        {loadState === "ready" ? (
          <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">
            <Users className="h-3 w-3" />
            {onlineCount > 0 ? `${onlineCount} 人在线` : "已接入实时"}
          </div>
        ) : null}
      </div>

      {isJoinSuccessEntry ? (
        <div className="mt-3 rounded-2xl border border-[#e5e9ff] bg-[linear-gradient(180deg,#f8f9ff_0%,#f3f6ff_100%)] px-3 py-3">
          <div className="flex items-center gap-2 text-[#4453a4]">
            <Sparkles className="h-4 w-4" />
            <p className="text-sm font-semibold">{buildJoinGuideTitle(activityTitle)}</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#6673a8]">
            刚才报的这场局已经接上了，先发一句招呼，大家更容易接住你。
          </p>
          {quickStarters.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {quickStarters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => {
                    if (showComposer) {
                      void sendMessage(starter)
                      return
                    }

                    setInput(starter)
                  }}
                  className="rounded-full bg-white px-3 py-1.5 text-xs text-[#4150a8] shadow-[0_10px_24px_-20px_rgba(67,86,170,0.55)] transition hover:bg-[#f9fbff]"
                >
                  {starter}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className={cn(
          "mt-4 max-h-[360px] space-y-3 overflow-y-auto rounded-2xl border px-3 py-3",
          isReadOnly ? "border-slate-200 bg-slate-50/80" : "border-[#e5e9ff] bg-[#fbfcff]"
        )}
      >
        {messages.length === 0 ? (
          <div className="rounded-xl bg-white px-3 py-5 text-center text-sm text-slate-500">
            {loadState === "ready" ? "还没有讨论消息，你可以先来开个场。" : "暂时还没有可展示的讨论内容。"}
          </div>
        ) : (
          messages.map((message) => {
            const isSelf = currentUserId && message.senderId === currentUserId
            return (
              <div
                key={message.id}
                className={cn("flex gap-2", isSelf ? "justify-end" : "justify-start")}
              >
                {!isSelf ? (
                  message.senderAvatarUrl ? (
                    <img
                      src={message.senderAvatarUrl}
                      alt={message.senderNickname || "用户"}
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[11px] font-medium text-white">
                      {message.senderNickname?.charAt(0) || "?"}
                    </div>
                  )
                ) : null}

                <div className={cn("max-w-[82%] space-y-1", isSelf ? "items-end text-right" : "items-start text-left")}>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    {!isSelf ? <span>{message.senderNickname || "匿名用户"}</span> : null}
                    <span>{formatRelativeTime(message.createdAt)}</span>
                  </div>
                  <div
                    className={cn(
                      "rounded-2xl px-3 py-2 text-sm leading-6 shadow-[0_12px_24px_-18px_rgba(67,86,170,0.35)]",
                      isSelf ? "bg-[#5b67f4] text-white" : "bg-white text-slate-700"
                    )}
                  >
                    {message.content}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {notice ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {notice}
        </div>
      ) : null}

      {showComposer ? (
        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={input.trim().length > 24 ? 3 : 2}
            placeholder="说点集合、破冰、时间安排都可以"
            className="min-h-[48px] flex-1 resize-none rounded-2xl border border-[#dfe4ff] bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-[#b7c4ff]"
          />
          <button
            type="button"
            onClick={() => {
              void sendMessage(input)
            }}
            disabled={sending || !input.trim()}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#5b67f4] text-white shadow-[0_16px_28px_-18px_rgba(82,102,191,0.7)] transition hover:bg-[#4f5aec] disabled:opacity-40"
            aria-label="发送消息"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-500">
          {loadState === "visitor"
            ? "登录后这里会自动恢复为可继续讨论的实时面板。"
            : loadState === "not_participant"
              ? "加入成功后，这里就会继续安排和沟通。"
              : isArchived
                ? "活动已归档，当前保留讨论记录供回看。"
                : "讨论区暂时不可用，请稍后刷新再试。"}
        </div>
      )}
    </section>
  )
}

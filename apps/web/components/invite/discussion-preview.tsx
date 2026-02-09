// 讨论区预览组件 - 展示最近 2-3 条讨论消息

interface RecentMessage {
  senderNickname: string | null
  senderAvatar: string | null
  content: string
  createdAt: string
}

export function DiscussionPreview({
  messages,
}: {
  messages: RecentMessage[]
}) {
  if (messages.length === 0) return null

  return (
    <div className="rounded-2xl bg-white/90 backdrop-blur-sm p-4 shadow-lg">
      <h2 className="mb-3 text-sm font-semibold text-gray-500">💬 讨论区</h2>
      <div className="space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className="flex items-start gap-2.5">
            {msg.senderAvatar ? (
              <img
                src={msg.senderAvatar}
                alt={msg.senderNickname || "用户"}
                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-300 text-[10px] font-medium text-white">
                {msg.senderNickname?.charAt(0) || "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <span className="text-xs text-gray-400">
                {msg.senderNickname || "匿名"}
              </span>
              <p className="mt-0.5 text-sm leading-relaxed text-gray-800 line-clamp-2">
                {msg.content}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

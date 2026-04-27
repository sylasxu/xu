import type { ThemeConfig } from "@/lib/themes"

/** 公开活动数据（来自 GET /activities/:id/public） */
export interface PublicActivity {
  id: string
  title: string
  description: string | null
  startAt: string
  locationName: string
  locationHint: string
  type: string
  status: string
  maxParticipants: number
  currentParticipants: number
  remainingSeats: number
  isFull: boolean
  theme: string
  themeConfig: unknown
  isArchived: boolean
  canJoin: boolean
  creator: {
    nickname: string | null
    avatarUrl: string | null
  }
  participants: Array<{ nickname: string | null; avatarUrl: string | null }>
  recentMessages: Array<{
    senderNickname: string | null
    senderAvatar: string | null
    content: string
    createdAt: string
  }>
  conversionTips: {
    joinContext: string
    discussionContext: string
    cloneContext: string
  }
}

// ── 活动类型中文映射 ──────────────────────────────────────
const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  food: "🍜 美食",
  entertainment: "🎉 娱乐",
  sports: "⚽ 运动",
  boardgame: "🎲 桌游",
  other: "✨ 其他",
}

// ── 星期中文 ──────────────────────────────────────────────
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

/**
 * 格式化日期为中文友好格式
 * 例：2月15日 周六 14:00
 */
function formatDateChinese(dateStr: string): string {
  const date = new Date(dateStr)
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekday = WEEKDAY_LABELS[date.getDay()]
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${month}月${day}日 ${weekday} ${hours}:${minutes}`
}

/**
 * 默认头像占位（首字母圆形）
 */
function AvatarPlaceholder({
  name,
  size = "w-8 h-8",
  textSize = "text-xs",
}: {
  name: string | null
  size?: string
  textSize?: string
}) {
  const initial = name?.charAt(0) || "?"
  return (
    <div
      className={`${size} shrink-0 rounded-full bg-gray-300 flex items-center justify-center ${textSize} font-medium text-white`}
    >
      {initial}
    </div>
  )
}

/**
 * 头像组件：有 URL 显示图片，否则显示占位
 */
function Avatar({
  url,
  name,
  size = "w-8 h-8",
  textSize = "text-xs",
  className = "",
}: {
  url: string | null
  name: string | null
  size?: string
  textSize?: string
  className?: string
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={name || "用户头像"}
        className={`${size} shrink-0 rounded-full object-cover ${className}`}
      />
    )
  }
  return <AvatarPlaceholder name={name} size={size} textSize={textSize} />
}

// ── 状态徽章 ──────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-500/90 px-3 py-1 text-xs font-medium text-white">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-300" />
        活动已结束
      </span>
    )
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/90 px-3 py-1 text-xs font-medium text-white">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-300" />
        活动已取消
      </span>
    )
  }
  return null
}

function isLightHexColor(value: string): boolean {
  const hex = value.trim().replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return false
  }

  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.72
}

// ── 参与者头像列表（重叠圆形） ────────────────────────────

function ParticipantAvatars({
  participants,
  currentCount,
  maxCount,
  textColor,
}: {
  participants: PublicActivity["participants"]
  currentCount: number
  maxCount: number
  textColor: string
}) {
  const displayList = participants.slice(0, 5)
  const remaining = currentCount - displayList.length

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {displayList.map((p, i) => (
          <Avatar
            key={i}
            url={p.avatarUrl}
            name={p.nickname}
            size="w-7 h-7"
            textSize="text-[10px]"
            className="ring-2 ring-white/80"
          />
        ))}
        {remaining > 0 && (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-medium text-gray-600 ring-2 ring-white/80">
            +{remaining}
          </div>
        )}
      </div>
      <span className="text-sm opacity-80" style={{ color: textColor }}>
        {currentCount}/{maxCount} 人
      </span>
    </div>
  )
}

// ── 主卡片组件 ────────────────────────────────────────────

export function ActivityCard({
  activity,
  themeConfig,
}: {
  activity: PublicActivity
  themeConfig: ThemeConfig
}) {
  const textColor = themeConfig.colorScheme?.text || "#1F2937"
  const primaryColor = themeConfig.colorScheme?.primary || "#374151"
  const isEnded = activity.status === "completed" || activity.status === "cancelled"
  const typeLabel = ACTIVITY_TYPE_LABELS[activity.type] || "✨ 活动"
  const seatText = activity.isFull ? "当前已满员，可以先关注后续动态" : `还剩 ${activity.remainingSeats} 个位置`
  const creatorNickname = activity.creator.nickname
  const creatorAvatarUrl = activity.creator.avatarUrl
  const usesLightText = isLightHexColor(textColor)

  return (
    <div
      className={`mx-auto w-full max-w-lg overflow-hidden rounded-2xl border backdrop-blur-sm shadow-xl ${
        usesLightText
          ? "border-white/10 bg-black/52"
          : "border-white/65 bg-white/90"
      }`}
    >
      {/* 状态徽章 */}
      {isEnded && (
        <div className="flex justify-center pt-4">
          <StatusBadge status={activity.status} />
        </div>
      )}

      {/* 主体内容 */}
      <div className="p-5 sm:p-6 space-y-4">
        {/* 活动类型标签 */}
        <span
          className="inline-block rounded-full px-3 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: `${primaryColor}18`,
            color: primaryColor,
          }}
        >
          {typeLabel}
        </span>

        {/* 标题 */}
        <h1
          className="text-xl sm:text-2xl font-bold leading-tight"
          style={{ color: textColor }}
        >
          {activity.title}
        </h1>

        {/* 描述 */}
        {activity.description && (
          <p
            className="text-sm leading-relaxed opacity-75"
            style={{ color: textColor }}
          >
            {activity.description}
          </p>
        )}

        {/* 时间 & 地点 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-base">📅</span>
            <span className="text-sm" style={{ color: textColor }}>
              {formatDateChinese(activity.startAt)}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-base">📍</span>
            <div className="flex flex-col">
              <span className="text-sm" style={{ color: textColor }}>
                {activity.locationName}
              </span>
              {activity.locationHint && (
                <span
                  className="text-xs opacity-60"
                  style={{ color: textColor }}
                >
                  {activity.locationHint}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 分隔线 */}
        <div className={usesLightText ? "border-t border-white/10" : "border-t border-gray-200/60"} />

        {/* 发起人 */}
        <div className="flex items-center gap-3">
          <Avatar
            url={creatorAvatarUrl}
            name={creatorNickname}
            size="w-9 h-9"
            textSize="text-sm"
          />
          <div className="flex flex-col">
            <span
              className="text-xs opacity-50"
              style={{ color: textColor }}
            >
              发起人
            </span>
            <span
              className="text-sm font-medium"
              style={{ color: textColor }}
            >
              {creatorNickname || "匿名用户"}
            </span>
          </div>
        </div>

        {/* 参与者 */}
        <ParticipantAvatars
          participants={activity.participants}
          currentCount={activity.currentParticipants}
          maxCount={activity.maxParticipants}
          textColor={textColor}
        />
        {!isEnded && (
          <p className="text-xs opacity-70" style={{ color: textColor }}>
            {seatText}
          </p>
        )}
        {activity.conversionTips.discussionContext ? (
          <p
            className={`rounded-xl px-3 py-2 text-xs leading-5 opacity-75 ${
              usesLightText ? "bg-white/[0.08]" : "bg-black/[0.04]"
            }`}
            style={{ color: textColor }}
          >
            {activity.conversionTips.discussionContext}
          </p>
        ) : null}
      </div>
    </div>
  )
}

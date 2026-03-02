import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { resolveThemeConfig } from "@/lib/themes"
import { ThemeBackground } from "@/components/invite/theme-background"
import { ActivityCard } from "@/components/invite/activity-card"
import type { PublicActivity } from "@/components/invite/activity-card"
import { DiscussionPreview } from "@/components/invite/discussion-preview"
import { WechatRedirect } from "@/components/invite/wechat-redirect"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996"
const WEB_BASE = process.env.NEXT_PUBLIC_WEB_URL || "https://juchang.app"

async function getPublicActivity(id: string): Promise<PublicActivity | null> {
  try {
    const res = await fetch(`${API_BASE}/activities/${id}/public`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

// ── 星期中文 ──────────────────────────────────────────────
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_LABELS[d.getDay()]}`
}

// ── OG Meta Tags (SSR) ───────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const activity = await getPublicActivity(id)

  if (!activity) {
    return { title: "活动不存在 - 聚场" }
  }

  const vacancy = activity.maxParticipants - activity.currentParticipants
  const fomoText =
    vacancy > 0
      ? `已有${activity.currentParticipants}人报名，还差${vacancy}人`
      : "已满员"

  return {
    title: `${activity.title} - 聚场邀请你`,
    description: `${fomoText} · ${activity.locationName} · ${formatDateShort(activity.startAt)}`,
    openGraph: {
      title: activity.title,
      description: `${fomoText} · ${activity.locationName}`,
      url: `${WEB_BASE}/invite/${id}`,
      type: "website",
      images: [
        {
          url: `${WEB_BASE}/og/invite-default.svg`,
          width: 1200,
          height: 630,
          alt: "聚场活动邀请函",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: activity.title,
      description: `${fomoText} · ${activity.locationName}`,
      images: [`${WEB_BASE}/og/invite-default.svg`],
    },
  }
}

// ── 页面组件 (SSR) ───────────────────────────────────────

export default async function InvitePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const activity = await getPublicActivity(id)

  if (!activity) {
    notFound()
  }

  const themeConfig = resolveThemeConfig(
    activity.theme,
    activity.themeConfig as Parameters<typeof resolveThemeConfig>[1],
    activity.type,
  )

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* 动态背景 */}
      <ThemeBackground config={themeConfig} />

      {/* 活动信息卡片 */}
      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg items-center justify-center p-4 pb-28">
        <div className="w-full space-y-4">
          <ActivityCard activity={activity} themeConfig={themeConfig} />

          {/* 讨论区预览 */}
          {activity.recentMessages.length > 0 && (
            <DiscussionPreview messages={activity.recentMessages} />
          )}
        </div>
      </div>

      {/* 微信跳转引导（固定底部） */}
      <WechatRedirect activityId={id} />
    </div>
  )
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActivityDetailShell } from "@/components/activity-detail/activity-detail-shell";
import type { PublicActivity } from "@/components/activity/activity-card";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";
const WEB_BASE = process.env.NEXT_PUBLIC_WEB_URL || "https://xu.example";
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

async function getPublicActivity(id: string): Promise<PublicActivity | null> {
  try {
    const response = await fetch(`${API_BASE}/activities/${id}/public`, {
      next: { revalidate: 60 },
    });
    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const activity = await getPublicActivity(id);

  if (!activity) {
    return { title: "活动不存在 - xu" };
  }

  const vacancy = activity.maxParticipants - activity.currentParticipants;
  const fomoText =
    vacancy > 0
      ? `已有${activity.currentParticipants}人报名，还差${vacancy}人`
      : "已满员";

  return {
    title: `${activity.title} - xu`,
    description: `${fomoText} · ${activity.locationName} · ${formatDateShort(activity.startAt)}`,
    openGraph: {
      title: activity.title,
      description: `${fomoText} · ${activity.locationName}`,
      url: `${WEB_BASE}/activities/${id}`,
      type: "website",
      images: [
        {
          url: `${WEB_BASE}/og/activity-default.svg`,
          width: 1200,
          height: 630,
          alt: "xu 活动详情",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: activity.title,
      description: `${fomoText} · ${activity.locationName}`,
      images: [`${WEB_BASE}/og/activity-default.svg`],
    },
  };
}

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const activity = await getPublicActivity(id);

  if (!activity) {
    notFound();
  }

  return <ActivityDetailShell activity={activity} />;
}

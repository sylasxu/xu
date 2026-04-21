"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, MessageCircle, Share2, UserPlus } from "lucide-react";

import { AuthSheet } from "@/components/auth/auth-sheet";
import { ActivityCard, type PublicActivity } from "@/components/activity/activity-card";
import { DiscussionEntryTracker } from "@/components/activity/discussion-entry-tracker";
import { DiscussionRuntimePanel } from "@/components/activity/discussion-runtime-panel";
import { ThemeBackground } from "@/components/activity/theme-background";
import { Button } from "@/components/ui/button";
import { resolveThemeConfig } from "@/lib/themes";
import { buildActivityDetailPath, resolveActivityEntry } from "@/lib/activity-url";
import { readClientPhoneNumber, readClientToken, readClientUserId } from "@/lib/client-auth";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";

type ActivityJoinState = "creator" | "joined" | "waitlisted" | "not_joined" | "closed";
type ActivityJoinResult = "joined" | "already_joined" | "waitlisted" | "closed";

type ActivityDetail = {
  id: string;
  joinState: ActivityJoinState;
  canJoin: boolean;
  isFull: boolean;
  remainingSeats: number;
};

type JoinResponse = {
  success: boolean;
  msg: string;
  joinResult: ActivityJoinResult;
  participantId: string | null;
  navigationIntent: "open_discussion" | "stay_on_detail";
};

type ActivityDetailShellProps = {
  activity: PublicActivity;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readApiError(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.msg === "string") {
    return value.msg;
  }

  return fallback;
}

function isActivityDetail(value: unknown): value is ActivityDetail {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.canJoin === "boolean" &&
    typeof value.isFull === "boolean" &&
    typeof value.remainingSeats === "number" &&
    (value.joinState === "creator" ||
      value.joinState === "joined" ||
      value.joinState === "waitlisted" ||
      value.joinState === "not_joined" ||
      value.joinState === "closed")
  );
}

function isJoinResponse(value: unknown): value is JoinResponse {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    typeof value.msg === "string" &&
    (value.joinResult === "joined" ||
      value.joinResult === "already_joined" ||
      value.joinResult === "waitlisted" ||
      value.joinResult === "closed") &&
    (value.navigationIntent === "open_discussion" || value.navigationIntent === "stay_on_detail")
  );
}

function buildShareText(activity: PublicActivity): string {
  const seats = activity.isFull ? "目前已满员" : `还剩 ${activity.remainingSeats} 个位置`;
  return `${activity.title}\n${activity.locationName} · ${activity.locationHint}\n${seats}\n${window.location.href}`;
}

function openDiscussionFromDetail(activityId: string, entry?: string): void {
  window.location.href = buildActivityDetailPath(activityId, {
    entry: resolveActivityEntry(entry, "join_success"),
  });
}

export function ActivityDetailShell({ activity }: ActivityDetailShellProps) {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [joining, setJoining] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "failed">("idle");

  const themeConfig = useMemo(
    () => resolveThemeConfig(activity.theme, activity.themeConfig as Parameters<typeof resolveThemeConfig>[1], activity.type),
    [activity.theme, activity.themeConfig, activity.type]
  );

  const syncAuth = useCallback(() => {
    const token = readClientToken();
    setAuthToken(token);
    setPhoneNumber(readClientPhoneNumber(token));
  }, []);

  useEffect(() => {
    syncAuth();
    window.addEventListener("focus", syncAuth);
    window.addEventListener("storage", syncAuth);
    window.addEventListener("xu-auth-updated", syncAuth);
    document.addEventListener("visibilitychange", syncAuth);

    return () => {
      window.removeEventListener("focus", syncAuth);
      window.removeEventListener("storage", syncAuth);
      window.removeEventListener("xu-auth-updated", syncAuth);
      document.removeEventListener("visibilitychange", syncAuth);
    };
  }, [syncAuth]);

  const loadViewerDetail = useCallback(async () => {
    const token = readClientToken();
    if (!token) {
      setDetail(null);
      return;
    }

    setLoadingDetail(true);
    try {
      const response = await fetch(`${API_BASE}/activities/${activity.id}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !isActivityDetail(payload)) {
        setDetail(null);
        return;
      }

      setDetail(payload);
    } finally {
      setLoadingDetail(false);
    }
  }, [activity.id]);

  useEffect(() => {
    void loadViewerDetail();
  }, [authToken, loadViewerDetail]);

  const joinState = detail?.joinState ?? (activity.canJoin ? "not_joined" : "closed");
  const canJoin = detail?.canJoin ?? activity.canJoin;
  const remainingSeats = detail?.remainingSeats ?? activity.remainingSeats;
  const isJoined = joinState === "joined" || joinState === "creator";
  const isWaitlisted = joinState === "waitlisted";

  const joinLabel = isJoined
    ? "进入讨论区"
    : isWaitlisted
      ? "已在候补"
      : canJoin
        ? "报名加入"
        : "暂不可报名";

  const joinActivity = useCallback(async () => {
    if (isJoined) {
      openDiscussionFromDetail(activity.id, "join_success");
      return;
    }

    const token = readClientToken();
    const userId = readClientUserId(token);
    if (!token || !userId || !readClientPhoneNumber(token)) {
      setAuthOpen(true);
      return;
    }

    setJoining(true);
    setNotice(null);
    try {
      const response = await fetch(`${API_BASE}/activities/${activity.id}/join`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !isJoinResponse(payload)) {
        const message = readApiError(payload, `报名失败（${response.status}）`);
        if (message.includes("绑定手机号") || response.status === 401) {
          setAuthOpen(true);
        }
        throw new Error(message);
      }

      setNotice(payload.msg);
      await loadViewerDetail();
      if (payload.navigationIntent === "open_discussion") {
        openDiscussionFromDetail(activity.id, "join_success");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "报名失败，请稍后再试");
    } finally {
      setJoining(false);
    }
  }, [activity.id, isJoined, loadViewerDetail]);

  const copyShareText = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setShareStatus("failed");
      return;
    }

    try {
      await navigator.clipboard.writeText(buildShareText(activity));
      setShareStatus("copied");
      window.setTimeout(() => setShareStatus("idle"), 1200);
    } catch {
      setShareStatus("failed");
      window.setTimeout(() => setShareStatus("idle"), 1500);
    }
  }, [activity]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <DiscussionEntryTracker activityId={activity.id} />
      <ThemeBackground config={themeConfig} />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-32 bg-gradient-to-b from-black/55 to-transparent" />
      <main className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col px-4 pb-36 pt-4">
        <header className="mb-4 flex items-center justify-between">
          <a
            href="/chat"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white/86 backdrop-blur-md transition hover:bg-white/10"
            aria-label="返回首页"
          >
            <ArrowLeft className="h-4 w-4" />
          </a>
          <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] font-medium text-white/66 backdrop-blur-md">
            活动详情
          </div>
        </header>

        <div className="flex flex-1 items-center">
          <div className="w-full space-y-4">
            <ActivityCard activity={activity} themeConfig={themeConfig} />
            <DiscussionRuntimePanel
              activityId={activity.id}
              activityTitle={activity.title}
              initialMessages={activity.recentMessages}
              isArchived={activity.isArchived}
            />
          </div>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg px-4 pb-[max(18px,env(safe-area-inset-bottom))]">
        <section className="rounded-[28px] border border-white/10 bg-black/72 p-3 shadow-[0_-18px_60px_-36px_rgba(0,0,0,0.95)] backdrop-blur-2xl">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div>
              <p className="text-sm font-semibold text-white/92">
                {isJoined ? "你已经在局里" : isWaitlisted ? "你在候补里" : canJoin ? "这场还可以加入" : "这场暂不可加入"}
              </p>
              <p className="mt-1 text-xs text-white/44">
                {loadingDetail ? "正在同步你的参与状态" : canJoin ? `剩余 ${remainingSeats} 个位置` : "可以先分享给朋友或回到首页继续找局"}
              </p>
            </div>
            {notice ? <p className="max-w-[168px] text-right text-xs text-white/58">{notice}</p> : null}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button
              type="button"
              onClick={() => {
                void joinActivity();
              }}
              disabled={joining || (!canJoin && !isJoined)}
              className="h-12 rounded-2xl bg-white text-sm font-semibold text-black hover:bg-white/90"
            >
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : isJoined ? <MessageCircle className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {joinLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void copyShareText();
              }}
              className="h-12 rounded-2xl border-white/12 bg-white/[0.06] px-4 text-white hover:bg-white/10 hover:text-white"
            >
              <Share2 className="h-4 w-4" />
              <span className="sr-only">{shareStatus === "copied" ? "已复制" : "分享"}</span>
            </Button>
          </div>

          {shareStatus !== "idle" ? (
            <p className="mt-2 text-center text-xs text-white/44">
              {shareStatus === "copied" ? "分享文案已复制" : "复制失败，可以手动复制当前链接"}
            </p>
          ) : null}
        </section>
      </div>

      <AuthSheet
        mode={phoneNumber ? "login" : "bind_phone"}
        isDarkMode
        open={authOpen}
        onOpenChange={setAuthOpen}
        onAuthenticated={async () => {
          syncAuth();
          await loadViewerDetail();
          await joinActivity();
        }}
        reason="报名和讨论区需要先确认身份，完成后会继续刚才这一步。"
        trigger={<button type="button" className="hidden" aria-hidden="true" />}
      />
    </div>
  );
}

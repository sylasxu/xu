"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, MessageCircle, Plus, Share2, UserPlus } from "lucide-react";

import { AuthSheet } from "@/components/auth/auth-sheet";
import { ActivityCard, type PublicActivity } from "@/components/activity/activity-card";
import { DiscussionEntryTracker } from "@/components/activity/discussion-entry-tracker";
import { DiscussionRuntimePanel } from "@/components/activity/discussion-runtime-panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeBackground } from "@/components/activity/theme-background";
import { Button } from "@/components/ui/button";
import { resolveThemeConfig } from "@/lib/themes";
import { buildActivityDetailPath, resolveActivityEntry } from "@/lib/activity-url";
import { readClientPhoneNumber, readClientToken, readClientUserId } from "@/lib/client-auth";
import {
  persistPendingAgentActionStateInBrowser,
  type PendingActionAuthMode,
  type PendingAgentActionState,
} from "@/lib/pending-agent-action";
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

type ParticipantInfo = {
  id: string;
  userId: string;
  status: string;
  joinedAt: string | null;
  user: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
  } | null;
};

type FulfillmentDraftParticipant = {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  fulfilled: boolean;
};

type FulfillmentResponse = {
  activityId: string;
  attendedCount: number;
  noShowCount: number;
  totalSubmitted: number;
  msg: string;
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

function isParticipantInfo(value: unknown): value is ParticipantInfo {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.userId === "string" &&
    typeof value.status === "string" &&
    (typeof value.joinedAt === "string" || value.joinedAt === null) &&
    (value.user === null ||
      (isRecord(value.user) &&
        typeof value.user.id === "string" &&
        (typeof value.user.nickname === "string" || value.user.nickname === null) &&
        (typeof value.user.avatarUrl === "string" || value.user.avatarUrl === null)))
  );
}

function isFulfillmentResponse(value: unknown): value is FulfillmentResponse {
  return (
    isRecord(value) &&
    typeof value.activityId === "string" &&
    typeof value.attendedCount === "number" &&
    typeof value.noShowCount === "number" &&
    typeof value.totalSubmitted === "number" &&
    typeof value.msg === "string"
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

const ACTIVITY_TYPE_NAMES: Record<string, string> = {
  food: "美食",
  entertainment: "娱乐",
  sports: "运动",
  boardgame: "桌游",
  other: "",
};

function buildClonePrompt(activity: PublicActivity): string {
  const typeName = ACTIVITY_TYPE_NAMES[activity.type] || "";
  const location = activity.locationName || activity.locationHint || "";
  const parts: string[] = [];
  parts.push("帮我发一个类似的");
  if (typeName) {
    parts.push(`${typeName}局`);
  } else {
    parts.push("活动");
  }
  if (location) {
    parts.push(`，地点在${location}`);
  }
  if (activity.maxParticipants > 0) {
    parts.push(`，大概${activity.maxParticipants}个人`);
  }
  parts.push("，时间你帮我安排合适的");
  return parts.join("");
}

function navigateToChatWithPrefill(prefill: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem("xu:chat:prefill", prefill);
  window.location.href = "/chat";
}

function buildJoinPendingAgentAction(activity: PublicActivity, authMode: PendingActionAuthMode): PendingAgentActionState {
  return {
    action: {
      type: "structured_action",
      action: "join_activity",
      payload: {
        activityId: activity.id,
        source: "activity_detail_join",
        title: activity.title,
        startAt: activity.startAt,
        locationName: activity.locationName,
      },
      source: "activity_detail_join",
      originalText: "报名加入",
      authMode,
    },
  };
}

export function ActivityDetailShell({ activity }: ActivityDetailShellProps) {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [joining, setJoining] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<PendingActionAuthMode>("login");
  const [notice, setNotice] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [fulfillmentOpen, setFulfillmentOpen] = useState(false);
  const [fulfillmentLoading, setFulfillmentLoading] = useState(false);
  const [fulfillmentSubmitting, setFulfillmentSubmitting] = useState(false);
  const [fulfillmentParticipants, setFulfillmentParticipants] = useState<FulfillmentDraftParticipant[]>([]);
  const [fulfillmentNotice, setFulfillmentNotice] = useState<string | null>(null);

  const themeConfig = useMemo(
    () => resolveThemeConfig(activity.theme, activity.themeConfig as Parameters<typeof resolveThemeConfig>[1], activity.type),
    [activity.theme, activity.themeConfig, activity.type]
  );

  const syncAuth = useCallback(() => {
    const token = readClientToken();
    setAuthToken(token);
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

  const recordJoinAuthGateTask = useCallback(
    async (token: string, authMode: PendingActionAuthMode) => {
      const response = await fetch(`${API_BASE}/ai/tasks/join-auth-gate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          activityId: activity.id,
          activityTitle: activity.title,
          startAt: activity.startAt,
          locationName: activity.locationName,
          entry: "activity_detail_join",
          source: "activity_detail_join",
          authMode,
          originalText: "报名加入",
        }),
      });

      if (!response.ok) {
        throw new Error(`记录报名待恢复动作失败（${response.status}）`);
      }
    },
    [activity.id, activity.locationName, activity.startAt, activity.title],
  );

  const suspendJoinForAuth = useCallback(
    async (authMode: PendingActionAuthMode, token: string | null) => {
      persistPendingAgentActionStateInBrowser(buildJoinPendingAgentAction(activity, authMode));

      if (token) {
        await recordJoinAuthGateTask(token, authMode).catch((error) => {
          console.error("Failed to record join auth gate task:", error);
        });
      }

      setAuthMode(authMode);
      setAuthOpen(true);
    },
    [activity, recordJoinAuthGateTask],
  );

  useEffect(() => {
    void loadViewerDetail();
  }, [authToken, loadViewerDetail]);

  const joinState = detail?.joinState ?? (activity.canJoin ? "not_joined" : "closed");
  const canJoin = detail?.canJoin ?? activity.canJoin;
  const remainingSeats = detail?.remainingSeats ?? activity.remainingSeats;
  const isJoined = joinState === "joined" || joinState === "creator";
  const isWaitlisted = joinState === "waitlisted";
  const canConfirmFulfillment = joinState === "creator" && activity.status === "completed";
  const noShowCount = fulfillmentParticipants.filter((participant) => !participant.fulfilled).length;

  const joinLabel = isJoined
    ? "进入讨论区"
    : isWaitlisted
      ? "已在候补"
      : canJoin
        ? "报名加入"
        : "暂不可报名";

  const loadFulfillmentParticipants = useCallback(async () => {
    setFulfillmentLoading(true);
    setFulfillmentNotice(null);
    try {
      const response = await fetch(`${API_BASE}/participants/activity/${activity.id}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !Array.isArray(payload)) {
        throw new Error(readApiError(payload, "参与者列表加载失败"));
      }

      const nextParticipants = payload
        .filter(isParticipantInfo)
        .filter((participant) => participant.status === "joined")
        .map((participant) => ({
          userId: participant.userId,
          nickname: participant.user?.nickname?.trim() || "未命名成员",
          avatarUrl: participant.user?.avatarUrl ?? null,
          fulfilled: true,
        }));

      if (nextParticipants.length === 0) {
        throw new Error("当前还没有可确认的报名成员");
      }

      setFulfillmentParticipants(nextParticipants);
    } catch (error) {
      setFulfillmentParticipants([]);
      setFulfillmentNotice(error instanceof Error ? error.message : "参与者列表加载失败");
    } finally {
      setFulfillmentLoading(false);
    }
  }, [activity.id]);

  const joinActivity = useCallback(async () => {
    if (canConfirmFulfillment) {
      setFulfillmentOpen(true);
      void loadFulfillmentParticipants();
      return;
    }

    if (isJoined) {
      openDiscussionFromDetail(activity.id, "join_success");
      return;
    }

    const token = readClientToken();
    const userId = readClientUserId(token);
    if (!token || !userId || !readClientPhoneNumber(token)) {
      await suspendJoinForAuth(!token || !userId ? "login" : "bind_phone", token);
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
          await suspendJoinForAuth(message.includes("绑定手机号") ? "bind_phone" : "login", token);
        }
        throw new Error(message);
      }

      setNotice(payload.msg);
      persistPendingAgentActionStateInBrowser(null);
      await loadViewerDetail();
      if (payload.navigationIntent === "open_discussion") {
        openDiscussionFromDetail(activity.id, "join_success");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "报名失败，请稍后再试");
    } finally {
      setJoining(false);
    }
  }, [activity, canConfirmFulfillment, isJoined, loadFulfillmentParticipants, loadViewerDetail, suspendJoinForAuth]);

  const toggleFulfillmentParticipant = useCallback((userId: string) => {
    setFulfillmentParticipants((current) =>
      current.map((participant) =>
        participant.userId === userId
          ? { ...participant, fulfilled: !participant.fulfilled }
          : participant,
      ),
    );
  }, []);

  const submitFulfillment = useCallback(async () => {
    const token = readClientToken();
    if (!token) {
      setAuthMode("login");
      setAuthOpen(true);
      return;
    }

    if (fulfillmentParticipants.length === 0) {
      setFulfillmentNotice("当前还没有可确认的报名成员");
      return;
    }

    setFulfillmentSubmitting(true);
    setFulfillmentNotice(null);
    try {
      const response = await fetch(`${API_BASE}/participants/confirm-fulfillment`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          activityId: activity.id,
          participants: fulfillmentParticipants.map((participant) => ({
            userId: participant.userId,
            fulfilled: participant.fulfilled,
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !isFulfillmentResponse(payload)) {
        const message = readApiError(payload, `履约确认失败（${response.status}）`);
        if (response.status === 401) {
          setAuthOpen(true);
        }
        throw new Error(message);
      }

      setFulfillmentOpen(false);
      setNotice(payload.msg);
      await loadViewerDetail();
    } catch (error) {
      setFulfillmentNotice(error instanceof Error ? error.message : "履约确认失败，请稍后再试");
    } finally {
      setFulfillmentSubmitting(false);
    }
  }, [activity.id, fulfillmentParticipants, loadViewerDetail]);

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

  const cloneActivity = useCallback(() => {
    const prompt = buildClonePrompt(activity);
    navigateToChatWithPrefill(prompt);
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
                {canConfirmFulfillment
                  ? "这场已经结束，先把真实到场情况确认一下"
                  : isJoined
                    ? "你已经在局里"
                    : isWaitlisted
                      ? "你在候补里"
                      : canJoin
                        ? "这场还可以加入"
                        : "这场暂不可加入"}
              </p>
              <p className="mt-1 text-xs text-white/44">
                {loadingDetail
                  ? "正在同步你的参与状态"
                  : canConfirmFulfillment
                    ? "默认全部标记为到场，有未到场再取消勾选。"
                    : canJoin
                      ? `${activity.conversionTips.joinContext} 剩余 ${remainingSeats} 个位置`
                      : "可以先分享给朋友或回到首页继续找局"}
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
              disabled={joining || fulfillmentSubmitting || (!canJoin && !isJoined && !canConfirmFulfillment)}
              className="h-12 rounded-2xl bg-white text-sm font-semibold text-black hover:bg-white/90"
            >
              {joining || fulfillmentSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : canConfirmFulfillment ? (
                <Check className="h-4 w-4" />
              ) : isJoined ? (
                <MessageCircle className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {canConfirmFulfillment ? "履约确认" : joinLabel}
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

          <button
            type="button"
            onClick={() => {
              cloneActivity();
            }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs text-white/44 transition hover:bg-white/[0.04] hover:text-white/70"
            title={activity.conversionTips.cloneContext}
          >
            <Plus className="h-3.5 w-3.5" />
            我也组一个
          </button>
          <p className="px-2 text-center text-[11px] leading-5 text-white/35">{activity.conversionTips.cloneContext}</p>

          {shareStatus !== "idle" ? (
            <p className="mt-2 text-center text-xs text-white/44">
              {shareStatus === "copied" ? "分享文案已复制" : "复制失败，可以手动复制当前链接"}
            </p>
          ) : null}
        </section>
      </div>

      <AuthSheet
        mode={authMode}
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

      <Dialog open={fulfillmentOpen} onOpenChange={setFulfillmentOpen}>
        <DialogContent className="max-w-md border-zinc-900 bg-zinc-950 text-zinc-50">
          <DialogHeader>
            <DialogTitle>履约确认</DialogTitle>
            <DialogDescription className="text-zinc-400">
              把这场局真实到场情况记下来，后面的再约和推荐才会更准。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-200">
              <p className="font-medium text-white/92">{activity.title}</p>
              <p className="mt-1 text-xs text-white/45">
                默认都算到场。如果有人放鸽子，点一下切成“未到场”。
              </p>
            </div>

            <ScrollArea className="max-h-72 rounded-2xl border border-white/10 bg-black/20">
              <div className="space-y-2 p-3">
                {fulfillmentLoading ? (
                  <div className="flex items-center justify-center py-8 text-sm text-white/52">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    正在加载报名成员
                  </div>
                ) : fulfillmentParticipants.length === 0 ? (
                  <div className="py-8 text-center text-sm text-white/45">
                    {fulfillmentNotice || "当前没有可确认的报名成员。"}
                  </div>
                ) : (
                  fulfillmentParticipants.map((participant) => (
                    <button
                      key={participant.userId}
                      type="button"
                      onClick={() => {
                        toggleFulfillmentParticipant(participant.userId);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition",
                        participant.fulfilled
                          ? "border-emerald-400/30 bg-emerald-400/10"
                          : "border-rose-400/30 bg-rose-400/10",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white/92">{participant.nickname}</p>
                        <p className="mt-1 text-xs text-white/45">
                          {participant.fulfilled ? "已到场" : "未到场"}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex min-w-[72px] items-center justify-center rounded-full px-3 py-1 text-xs font-medium",
                          participant.fulfilled
                            ? "bg-emerald-300/16 text-emerald-100"
                            : "bg-rose-300/16 text-rose-100",
                        )}
                      >
                        {participant.fulfilled ? "到场" : "未到场"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-white/58">
              {noShowCount > 0
                ? `你标记了 ${noShowCount} 人未到场。提交后，这些真实结果会写回后续推荐和再约判断。`
                : "当前全部标记为到场。提交后，系统会把这次成局结果记下来。"}
            </div>

            {fulfillmentNotice ? (
              <p className="text-sm text-amber-200">{fulfillmentNotice}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFulfillmentOpen(false)}
              className="border-white/10 bg-transparent text-white hover:bg-white/8 hover:text-white"
            >
              稍后再说
            </Button>
            <Button
              type="button"
              onClick={() => {
                void submitFulfillment();
              }}
              disabled={fulfillmentLoading || fulfillmentSubmitting || fulfillmentParticipants.length === 0}
              className="bg-white text-black hover:bg-white/90"
            >
              {fulfillmentSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              提交履约结果
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

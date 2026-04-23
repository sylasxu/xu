"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Check,
  ChevronRight,
  Clock3,
  Loader2,
  Menu,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Users,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { buildActivityDetailPath } from "@/lib/activity-url";
import { cn } from "@/lib/utils";
import { readClientToken, readClientUserId } from "@/lib/client-auth";
import { DISCUSSION_STATE_UPDATED_EVENT } from "@/lib/discussion-state-events";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";

type NotificationType =
  | "join"
  | "quit"
  | "activity_start"
  | "completed"
  | "cancelled"
  | "new_participant"
  | "post_activity"
  | "activity_reminder";

type MessageCenterResponse = {
  actionItems: MessageCenterActionItem[];
  systemNotifications: {
    items: SystemNotification[];
    total: number;
    page: number;
    totalPages: number;
  };
  pendingMatches: PendingMatch[];
  unreadNotificationCount: number;
  chatActivities: {
    items: ChatActivity[];
    total: number;
    page: number;
    totalPages: number;
    totalUnread: number;
  };
  totalUnread: number;
  ui: {
    title: string;
    description: string;
    visitorTitle: string;
    visitorDescription: string;
    summaryTitle: string;
    actionInboxSectionTitle: string;
    actionInboxDescription: string;
    actionInboxEmpty: string;
    pendingMatchesTitle: string;
    pendingMatchesEmpty: string;
    requestAuthHint: string;
    loadFailedText: string;
    markReadSuccess: string;
    markReadFailed: string;
    pendingDetailAuthHint: string;
    pendingDetailLoadFailed: string;
    actionFailed: string;
    followUpFailed: string;
    refreshLabel: string;
    systemSectionTitle: string;
    systemEmpty: string;
    feedbackPositiveLabel: string;
    feedbackNeutralLabel: string;
    feedbackNegativeLabel: string;
    reviewActionLabel: string;
    rebookActionLabel: string;
    kickoffActionLabel: string;
    markReadActionLabel: string;
    chatSummarySectionTitle: string;
    chatSummaryDescription: string;
    chatSummaryEmpty: string;
    chatSummaryFallbackMessage: string;
  };
};

type PendingMatch = {
  id: string;
  activityType: string;
  typeName: string;
  requestMode: "auto_match" | "connect" | "group_up";
  matchScore: number;
  commonTags: string[];
  locationHint: string;
  confirmDeadline: string;
  isTempOrganizer: boolean;
};

type MessageCenterActionItem = {
  id: string;
  type: "post_activity_follow_up" | "discussion_reply" | "draft_continue" | "recruiting_follow_up";
  title: string;
  summary: string;
  statusLabel: string;
  updatedAt: string;
  activityId: string | null;
  badge?: string;
  primaryAction: {
    kind: "prompt" | "open_discussion" | "open_activity";
    label: string;
    prompt?: string;
    activityId?: string;
    activityMode?: "review" | "rebook" | "kickoff";
    entry?: string;
  };
};

type PendingMatchDetail = {
  id: string;
  activityType: string;
  typeName: string;
  requestMode: "auto_match" | "connect" | "group_up";
  matchScore: number;
  commonTags: string[];
  locationHint: string;
  confirmDeadline: string;
  isTempOrganizer: boolean;
  organizerUserId: string;
  organizerNickname: string | null;
  nextActionOwner: "self" | "organizer";
  nextActionText: string;
  members: Array<{
    userId: string;
    nickname: string | null;
    avatarUrl: string | null;
    isTempOrganizer: boolean;
    locationHint: string;
    timePreference: string | null;
    tags: string[];
    intentSummary: string;
  }>;
  icebreaker: {
    content: string;
    createdAt: string;
  } | null;
};

type SystemNotification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string | null;
  activityId: string | null;
  isRead: boolean;
  createdAt: string;
};

type ChatActivity = {
  activityId: string;
  activityTitle: string;
  activityImage: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
  lastMessageSenderId: string | null;
  lastMessageSenderNickname: string | null;
  unreadCount: number;
  responseNeeded: boolean;
  isArchived: boolean;
  participantCount: number;
};

type ApiError = {
  code: number;
  msg: string;
};

type MatchActionResponse = {
  code: number;
  msg: string;
  activityId?: string;
};

type SuccessResponse = {
  code: number;
  msg: string;
};

type ActivitySelfFeedbackValue = "positive" | "neutral" | "failed";

type DrawerNotice = {
  kind: "success" | "error";
  text: string;
  prompt?: {
    label: string;
    text: string;
  };
};

type PromptContextOverrides = {
  activityId?: string;
  activityMode?: "review" | "rebook" | "kickoff";
  entry?: string;
};

type MessageCenterDrawerProps = {
  disabled?: boolean;
  isDarkMode?: boolean;
  openSignal?: number;
  focusPendingMatchId?: string | null;
  trigger?: ReactNode;
  onSendPrompt: (
    prompt: string,
    displayText?: string,
    contextOverrides?: PromptContextOverrides
  ) => Promise<void>;
};

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "msg" in value &&
    typeof (value as { msg?: unknown }).msg === "string"
  );
}

function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) {
    return "刚刚";
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60 * 1000) {
    return "刚刚";
  }

  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  }

  if (date.toDateString() === now.toDateString()) {
    return `${date.getHours().toString().padStart(2, "0")}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "昨天";
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function normalizeActivityTitle(title: string): string {
  return title.replace(/^活动后反馈[：:\s]*/g, "").trim();
}

function buildFeedbackPrompt(notification: SystemNotification): string {
  const activityTitle = normalizeActivityTitle(notification.title);
  const activityHint = activityTitle ? `「${activityTitle}」` : "这场活动";
  const activityRef = notification.activityId ? `（activityId: ${notification.activityId}）` : "";
  return `我刚结束${activityHint}${activityRef}，帮我先做一份复盘：亮点、槽点、下次优化和一句可直接发群里的总结。`;
}

function buildRebookPrompt(notification: SystemNotification): string {
  const activityTitle = normalizeActivityTitle(notification.title);
  const activityHint = activityTitle ? `「${activityTitle}」` : "这场活动";
  const activityRef = notification.activityId ? `（activityId: ${notification.activityId}）` : "";
  return `基于我刚结束的${activityHint}${activityRef}，帮我快速再约一场：延续合适的人、给个新时间建议，并直接生成一段可发送的招呼文案。`;
}

function buildKickoffPrompt(activityId?: string, activityTitle?: string): string {
  const normalizedTitle = activityTitle ? normalizeActivityTitle(activityTitle) : ""
  const activityHint = normalizedTitle ? `「${normalizedTitle}」` : "这场活动"
  const activityRef = activityId ? `（activityId: ${activityId}）` : "";
  return `围绕${activityHint}${activityRef}，帮我生成一段讨论区开场白，再给我 3 条接下来的协同提醒。`;
}

function buildFollowUpEntry(notificationId: string, mode: NonNullable<PromptContextOverrides["activityMode"]>): string {
  if (mode === "kickoff") {
    return notificationId.startsWith("chat:") ? "message_center_chat_summary" : "message_center_notification";
  }

  return "message_center_post_activity";
}

function getNotificationFallbackContent(type: NotificationType): string {
  const map: Record<NotificationType, string> = {
    join: "有新成员加入你的活动",
    quit: "有成员退出了活动",
    activity_start: "活动即将开始，记得准时到场",
    completed: "活动已完成，欢迎继续组局",
    cancelled: "活动已取消",
    new_participant: "活动有新人加入，快去打个招呼",
    post_activity: "活动结束了，来聊聊这次体验",
    activity_reminder: "活动提醒已送达",
  };

  return map[type] || "你有一条新通知";
}

function getPendingMatchHeadline(detail: PendingMatchDetail): string {
  if (detail.requestMode === "connect") {
    return `搭子邀请 · ${detail.typeName}`;
  }

  if (detail.requestMode === "group_up") {
    return `组局邀请 · ${detail.typeName}`;
  }

  return `${detail.typeName} 匹配结果`;
}

function getPendingMatchListTitle(match: PendingMatch): string {
  if (match.requestMode === "connect") {
    return `收到搭子邀请（${match.typeName}）`;
  }

  if (match.requestMode === "group_up") {
    return `收到组局邀请（${match.typeName}）`;
  }

  return `匹配结果待确认（${match.typeName}）`;
}

function getPendingMatchListHint(match: PendingMatch): string {
  if (match.requestMode === "connect") {
    return "查看邀请说明、成员信息与后续处理方式。";
  }

  if (match.requestMode === "group_up") {
    return "查看组局说明、成员信息与后续处理方式。";
  }

  return "查看匹配说明、成员信息与后续处理方式。";
}

function getPendingMatchPrimaryActionLabel(mode: PendingMatch["requestMode"]): string {
  if (mode === "connect") {
    return "同意搭一下";
  }

  if (mode === "group_up") {
    return "同意一起组局";
  }

  return "确认成局";
}

function getPendingMatchSecondaryActionLabel(mode: PendingMatch["requestMode"]): string {
  if (mode === "connect") {
    return "这次先不搭";
  }

  if (mode === "group_up") {
    return "这次先不组";
  }

  return "暂不成局";
}

function getPendingMatchStatusLabel(match: PendingMatch): string {
  if (match.requestMode === "auto_match") {
    return match.isTempOrganizer ? "你来拍板" : "等召集人确认";
  }

  return match.isTempOrganizer ? "等你回应" : "等对方回应";
}

function getPendingMatchDetailStatusLabel(detail: PendingMatchDetail): string {
  if (detail.requestMode === "auto_match") {
    return detail.isTempOrganizer ? "你来拍板" : `等 ${detail.organizerNickname || "召集人"} 确认`;
  }

  return detail.isTempOrganizer ? "等你回应" : "等对方回应";
}

export function MessageCenterDrawer({
  disabled = false,
  isDarkMode = false,
  openSignal = 0,
  focusPendingMatchId = null,
  trigger,
  onSendPrompt,
}: MessageCenterDrawerProps) {
  const [open, setOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [messageCenter, setMessageCenter] = useState<MessageCenterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<DrawerNotice | null>(null);
  const [selectedPendingMatchId, setSelectedPendingMatchId] = useState<string | null>(null);
  const [pendingMatchDetail, setPendingMatchDetail] = useState<PendingMatchDetail | null>(null);
  const [pendingMatchDetailLoading, setPendingMatchDetailLoading] = useState(false);
  const [pendingMatchDetailError, setPendingMatchDetailError] = useState<string | null>(null);

  const userId = useMemo(() => readClientUserId(authToken), [authToken]);

  useEffect(() => {
    const syncAuth = () => {
      setAuthToken(readClientToken());
    };

    syncAuth();
    window.addEventListener("focus", syncAuth);
    window.addEventListener("storage", syncAuth);
    document.addEventListener("visibilitychange", syncAuth);

    return () => {
      window.removeEventListener("focus", syncAuth);
      window.removeEventListener("storage", syncAuth);
      document.removeEventListener("visibilitychange", syncAuth);
    };
  }, []);

  const requestJson = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!authToken) {
        throw new Error(messageCenter?.ui.requestAuthHint || "请先登录后再查看消息中心");
      }

      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${authToken}`);
      if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        throw new Error(isApiError(payload) ? payload.msg : `请求失败（${response.status}）`);
      }

      return payload as T;
    },
    [authToken, messageCenter?.ui.requestAuthHint]
  );

  const refreshMessageCenter = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!authToken || !userId) {
        setMessageCenter(null);
        setUnreadCount(0);
        if (!silent) {
          setError(null);
        }
        return;
      }

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const params = new URLSearchParams({
          userId,
          notificationPage: "1",
          notificationLimit: "20",
          chatPage: "1",
          chatLimit: "12",
        });
        const payload = await requestJson<MessageCenterResponse>(
          `/notifications/message-center?${params.toString()}`,
          { method: "GET" }
        );
        setMessageCenter(payload);
        setUnreadCount(payload.totalUnread || 0);
        setError(null);
      } catch (requestError) {
        if (!silent) {
          setError(requestError instanceof Error ? requestError.message : messageCenter?.ui.loadFailedText || "消息中心加载失败");
        }
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [authToken, messageCenter?.ui.loadFailedText, requestJson, userId]
  );

  useEffect(() => {
    if (!authToken || !userId) {
      setMessageCenter(null);
      setUnreadCount(0);
      setError(null);
      return;
    }

    void refreshMessageCenter({ silent: true });
  }, [authToken, refreshMessageCenter, userId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void refreshMessageCenter();
  }, [open, refreshMessageCenter]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void refreshMessageCenter({ silent: true });
    };

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [open, refreshMessageCenter]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const refreshFromDiscussion = () => {
      void refreshMessageCenter({ silent: true });
    };

    window.addEventListener(DISCUSSION_STATE_UPDATED_EVENT, refreshFromDiscussion);

    return () => {
      window.removeEventListener(DISCUSSION_STATE_UPDATED_EVENT, refreshFromDiscussion);
    };
  }, [open, refreshMessageCenter]);


  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      await requestJson<SuccessResponse>(`/notifications/${notificationId}/read`, {
        method: "POST",
      });
    },
    [requestJson]
  );

  const handleNotificationRead = useCallback(
    async (notificationId: string) => {
      const actionKey = `read:${notificationId}`;
      setPendingActionKey(actionKey);
      try {
        await markNotificationRead(notificationId);
        setNotice({ kind: "success", text: messageCenter?.ui.markReadSuccess || "已标记为已读" });
        await refreshMessageCenter({ silent: true });
      } catch (requestError) {
        setNotice({
          kind: "error",
          text: requestError instanceof Error ? requestError.message : messageCenter?.ui.markReadFailed || "标记已读失败",
        });
      } finally {
        setPendingActionKey(null);
      }
    },
    [markNotificationRead, messageCenter?.ui.markReadFailed, messageCenter?.ui.markReadSuccess, refreshMessageCenter]
  );

  const openPendingMatchDetail = useCallback(
    async (matchId: string) => {
      if (!userId) {
        setNotice({ kind: "error", text: messageCenter?.ui.pendingDetailAuthHint || "请先登录后再查看匹配详情" });
        return;
      }

      setSelectedPendingMatchId(matchId);
      setPendingMatchDetail(null);
      setPendingMatchDetailError(null);
      setPendingMatchDetailLoading(true);
      try {
        const params = new URLSearchParams({ userId });
        const payload = await requestJson<PendingMatchDetail>(
          `/notifications/pending-matches/${matchId}?${params.toString()}`,
          { method: "GET" }
        );
        setPendingMatchDetail(payload);
      } catch (requestError) {
        setPendingMatchDetailError(
          requestError instanceof Error ? requestError.message : messageCenter?.ui.pendingDetailLoadFailed || "详情加载失败"
        );
      } finally {
        setPendingMatchDetailLoading(false);
      }
    },
    [messageCenter?.ui.pendingDetailAuthHint, messageCenter?.ui.pendingDetailLoadFailed, requestJson, userId]
  );

  const closePendingMatchDetail = useCallback(() => {
    setSelectedPendingMatchId(null);
    setPendingMatchDetail(null);
    setPendingMatchDetailError(null);
    setPendingMatchDetailLoading(false);
  }, []);


  useEffect(() => {
    if (!open) {
      closePendingMatchDetail();
    }
  }, [closePendingMatchDetail, open]);

  useEffect(() => {
    if (openSignal > 0) {
      setOpen(true);
    }
  }, [openSignal]);

  useEffect(() => {
    if (!open || !focusPendingMatchId) {
      return;
    }

    void openPendingMatchDetail(focusPendingMatchId);
  }, [focusPendingMatchId, open, openPendingMatchDetail]);

  const recordRebookFollowUp = useCallback(
    async (activityId: string | null) => {
      if (!activityId) {
        return;
      }

      try {
        await requestJson<SuccessResponse>("/participants/rebook-follow-up", {
          method: "POST",
          body: JSON.stringify({ activityId }),
        });
      } catch (requestError) {
        console.error("记录再约意愿失败", requestError);
      }
    },
    [requestJson]
  );

  const recordActivitySelfFeedback = useCallback(
    async (notification: SystemNotification, feedback: ActivitySelfFeedbackValue) => {
      if (!notification.activityId) {
        return null;
      }

      return requestJson<SuccessResponse>("/participants/self-feedback", {
        method: "POST",
        body: JSON.stringify({
          activityId: notification.activityId,
          feedback,
        }),
      });
    },
    [requestJson]
  );

  const handlePendingMatchAction = useCallback(
    async (matchId: string, action: "confirm" | "cancel") => {
      const actionKey = `${action}:${matchId}`;
      setPendingActionKey(actionKey);
      try {
        const payload = await requestJson<MatchActionResponse>(
          `/notifications/pending-matches/${matchId}/${action}`,
          { method: "POST" }
        );

        if (action === "confirm" && payload.activityId) {
          closePendingMatchDetail();
          setOpen(false);
          window.location.href = buildActivityDetailPath(payload.activityId, { entry: "match_confirmed" });
          return;
        }

        setNotice({ kind: "success", text: payload.msg });
        if (action === "cancel") {
          closePendingMatchDetail();
        }
        await refreshMessageCenter({ silent: true });
      } catch (requestError) {
        setNotice({
          kind: "error",
          text: requestError instanceof Error ? requestError.message : messageCenter?.ui.actionFailed || "操作失败，请稍后再试",
        });
      } finally {
        setPendingActionKey(null);
      }
    },
    [closePendingMatchDetail, messageCenter?.ui.actionFailed, refreshMessageCenter, requestJson]
  );

  const handleFollowUpPrompt = useCallback(
    async (
      notification: SystemNotification,
      mode: "review" | "rebook" | "kickoff",
      promptOverride?: { label: string; text: string },
      options?: { skipMarkRead?: boolean }
    ) => {
      const actionKey = `${mode}:${notification.id}`;
      setPendingActionKey(actionKey);
      try {
        if (!options?.skipMarkRead && !notification.isRead) {
          await markNotificationRead(notification.id);
        }

        if (mode === "rebook") {
          await recordRebookFollowUp(notification.activityId);
        }

        const prompt =
          promptOverride?.text ||
          (mode === "review"
            ? buildFeedbackPrompt(notification)
            : mode === "rebook"
              ? buildRebookPrompt(notification)
              : buildKickoffPrompt(notification.activityId || undefined, notification.title));
        const displayText =
          promptOverride?.label ||
          (mode === "review"
            ? messageCenter?.ui.reviewActionLabel || "去复盘"
            : mode === "rebook"
              ? messageCenter?.ui.rebookActionLabel || "去再约"
              : messageCenter?.ui.kickoffActionLabel || "让 AI 帮我写开场白");
        const contextOverrides: PromptContextOverrides = {
          ...(notification.activityId ? { activityId: notification.activityId } : {}),
          activityMode: mode,
          entry: buildFollowUpEntry(notification.id, mode),
        };

        setOpen(false);
        await onSendPrompt(prompt, displayText, contextOverrides);
        setNotice(null);
        await refreshMessageCenter({ silent: true });
      } catch (requestError) {
        setNotice({
          kind: "error",
          text: requestError instanceof Error ? requestError.message : messageCenter?.ui.followUpFailed || "发起失败，请稍后再试",
        });
      } finally {
        setPendingActionKey(null);
      }
    },
    [
      markNotificationRead,
      messageCenter?.ui.followUpFailed,
      messageCenter?.ui.kickoffActionLabel,
      messageCenter?.ui.rebookActionLabel,
      messageCenter?.ui.reviewActionLabel,
      onSendPrompt,
      recordRebookFollowUp,
      refreshMessageCenter,
    ]
  );

  const handleQuickFeedback = useCallback(
    async (notification: SystemNotification, feedback: ActivitySelfFeedbackValue) => {
      const actionKey = `feedback:${feedback}:${notification.id}`;
      setPendingActionKey(actionKey);
      try {
        if (!notification.isRead) {
          await markNotificationRead(notification.id);
        }

        const result = await recordActivitySelfFeedback(notification, feedback);
        setNotice({
          kind: "success",
          text: result?.msg || "已记录这次活动反馈",
        });
        await refreshMessageCenter({ silent: true });
      } catch (requestError) {
        setNotice({
          kind: "error",
          text: requestError instanceof Error ? requestError.message : messageCenter?.ui.followUpFailed || "发起失败，请稍后再试",
        });
      } finally {
        setPendingActionKey(null);
      }
    },
    [markNotificationRead, messageCenter?.ui.followUpFailed, recordActivitySelfFeedback, refreshMessageCenter]
  );

  const handleActionItem = useCallback(
    async (item: MessageCenterActionItem) => {
      const action = item.primaryAction;
      const actionKey = `task:${item.id}`;
      setPendingActionKey(actionKey);

      try {
        if (action.kind === "open_discussion" || action.kind === "open_activity") {
          const activityId = action.activityId || item.activityId;
          if (!activityId) {
            throw new Error(messageCenter?.ui.followUpFailed || "发起失败，请稍后再试");
          }

          window.location.href = buildActivityDetailPath(activityId, {
            entry: action.entry || "message_center_action_item",
          });
          return;
        }

        if (action.kind === "prompt" && action.prompt) {
          setOpen(false);
          await onSendPrompt(action.prompt, item.title, {
            ...(action.activityId ? { activityId: action.activityId } : {}),
            ...(action.activityMode ? { activityMode: action.activityMode } : {}),
            ...(action.entry ? { entry: action.entry } : {}),
          });
          setNotice(null);
          await refreshMessageCenter({ silent: true });
          return;
        }

        throw new Error(messageCenter?.ui.followUpFailed || "发起失败，请稍后再试");
      } catch (requestError) {
        setNotice({
          kind: "error",
          text: requestError instanceof Error ? requestError.message : messageCenter?.ui.followUpFailed || "发起失败，请稍后再试",
        });
      } finally {
        setPendingActionKey(null);
      }
    },
    [messageCenter?.ui.followUpFailed, onSendPrompt, refreshMessageCenter]
  );

  const pendingMatches = messageCenter?.pendingMatches || [];
  const actionItems = messageCenter?.actionItems || [];
  const systemNotifications = messageCenter?.systemNotifications.items || [];
  const chatActivities = messageCenter?.chatActivities.items || [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <button
              type="button"
              className={cn(
                "relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                isDarkMode ? "text-white/88 hover:bg-white/[0.06]" : "text-[#1d2151] hover:bg-white/60"
              )}
              aria-label="打开消息中心"
            >
              <Menu className="h-5 w-5" />
              {unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-5 text-black shadow-[0_10px_16px_-10px_rgba(255,255,255,0.22)]">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </button>
          )}
        </DialogTrigger>
      )}

      <DialogContent
        className={cn(
          "left-auto right-0 top-0 flex h-[100dvh] w-full max-w-[420px] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-l p-0 shadow-[0_24px_72px_-36px_rgba(0,0,0,0.84)] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          isDarkMode ? "border-white/10 bg-black text-white/92" : "border-black/8 bg-white text-black/88"
        )}
      >
        <DialogHeader className={cn("border-b px-5 pb-4 pt-5 text-left", isDarkMode ? "border-white/8" : "border-black/8")}>
          <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
            <BellRing className="h-5 w-5" />
            {messageCenter?.ui.title || "消息中心"}
          </DialogTitle>
          <DialogDescription className={cn("text-sm", isDarkMode ? "text-white/54" : "text-black/52")}>
            {messageCenter?.ui.description || "待确认搭子、活动后跟进、群聊摘要都在这里处理。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
          {notice ? (
            <div
              className={cn(
                "mb-4 rounded-2xl border px-4 py-3 text-sm",
                notice.kind === "success"
                  ? isDarkMode
                    ? "border-white/10 bg-white/[0.04] text-white/86"
                    : "border-black/8 bg-black/[0.03] text-black/78"
                  : isDarkMode
                    ? "border-white/10 bg-white/[0.04] text-white/86"
                    : "border-black/8 bg-black/[0.03] text-black/78"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="leading-6">{notice.text}</p>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full opacity-70 transition hover:opacity-100"
                  onClick={() => setNotice(null)}
                  aria-label="关闭提示"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {notice.prompt
                ? (() => {
                    const prompt = notice.prompt;
                    return (
                      <button
                        type="button"
                        disabled={disabled || pendingActionKey === `kickoff:${prompt.label}`}
                        onClick={() =>
                          void handleFollowUpPrompt(
                            {
                              id: prompt.label,
                              userId: "",
                              type: "post_activity",
                              title: "",
                              content: null,
                              activityId: null,
                              isRead: true,
                              createdAt: new Date().toISOString(),
                            },
                            "kickoff",
                            prompt,
                            { skipMarkRead: true }
                          )
                        }
                        className={cn(
                          "mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition",
                          isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/82 hover:bg-white/[0.08]" : "border border-black/8 bg-white text-black/78 hover:bg-black/[0.03]"
                        )}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {prompt.label}
                      </button>
                    );
                  })()
                : null}
            </div>
          ) : null}

          {!authToken || !userId ? (
            <div
              className={cn(
                "rounded-[28px] border px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
                isDarkMode ? "border-white/10 bg-white/[0.035]" : "border-black/8 bg-white"
              )}
            >
              <p className="text-base font-semibold">{messageCenter?.ui.visitorTitle || "这里会接住后续进展"}</p>
              <p className={cn("mt-2 text-sm leading-6", isDarkMode ? "text-white/54" : "text-black/52")}>
                {messageCenter?.ui.visitorDescription || "待确认搭子、活动后跟进和群聊未读，都会整理到这里。"}
              </p>
            </div>
          ) : loading && !messageCenter ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/78" />
            </div>
          ) : error ? (
            <div
              className={cn(
                "rounded-[24px] border px-4 py-4 text-sm",
                isDarkMode ? "border-white/10 bg-white/[0.04] text-white/82" : "border-black/8 bg-black/[0.03] text-black/78"
              )}
            >
              <p>{error}</p>
              <button
                type="button"
                onClick={() => void refreshMessageCenter()}
                className={cn(
                  "mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium",
                  isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/82" : "border border-black/8 bg-white text-black/78"
                )}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{messageCenter?.ui.summaryTitle || "未读总数"}</p>
                  <p className={cn("mt-1 text-xs", isDarkMode ? "text-white/54" : "text-black/52")}>
                    通知 {messageCenter?.unreadNotificationCount || 0} 条，群聊 {messageCenter?.chatActivities.totalUnread || 0} 条
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshMessageCenter({ silent: true })}
                  disabled={refreshing || loading}
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-full border transition",
                    isDarkMode ? "border-white/10 bg-white/[0.035] text-white/82 hover:bg-white/[0.06]" : "border-black/8 bg-white text-black/76 hover:bg-black/[0.03]"
                  )}
                  aria-label={messageCenter?.ui.refreshLabel || "刷新消息中心"}
                >
                  <RefreshCw className={cn("h-4 w-4", refreshing ? "animate-spin" : "")} />
                </button>
              </div>

              <section
                className={cn(
                  "rounded-[28px] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_18px_42px_-32px_rgba(0,0,0,0.78)]",
                  isDarkMode ? "border-white/10 bg-white/[0.035]" : "border-black/8 bg-white"
                )}
              >
                <div className="mb-3 flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-white/62" />
                  <p className="text-sm font-semibold">{messageCenter?.ui.actionInboxSectionTitle || "等你处理"}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", isDarkMode ? "border border-white/8 bg-white/[0.04] text-white/70" : "border border-black/8 bg-black/[0.03] text-black/70")}>
                    {actionItems.length}
                  </span>
                </div>
                <p className={cn("mb-3 text-xs leading-5", isDarkMode ? "text-white/42" : "text-black/42")}>
                  {messageCenter?.ui.actionInboxDescription || "先把最需要你接一下的事摆在上面，点开就能继续原来的那条链路。"}
                </p>

                {actionItems.length === 0 ? (
                  <p className={cn("text-sm leading-6", isDarkMode ? "text-white/54" : "text-black/52")}>
                    {messageCenter?.ui.actionInboxEmpty || "当前没有必须立刻处理的事，新的进展会先出现在这里。"}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {actionItems.map((item) => {
                      const actionKey = `task:${item.id}`;
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "rounded-2xl border px-4 py-4",
                            isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-black/[0.02]"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold">{item.title}</p>
                                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", isDarkMode ? "border border-white/8 bg-white/[0.04] text-white/70" : "border border-black/8 bg-black/[0.03] text-black/70")}>
                                  {item.statusLabel}
                                </span>
                              </div>
                              <p className={cn("mt-1 text-xs leading-5", isDarkMode ? "text-white/54" : "text-black/52")}>
                                {item.summary}
                              </p>
                            </div>
                            {item.badge ? (
                              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-black">
                                {item.badge}
                              </span>
                            ) : null}
                          </div>
                          <div className={cn("mt-3 flex items-center gap-2 text-xs", isDarkMode ? "text-white/42" : "text-black/42")}>
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatRelativeTime(item.updatedAt)}
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              disabled={disabled || Boolean(pendingActionKey)}
                              onClick={() => void handleActionItem(item)}
                              className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {pendingActionKey === actionKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              {item.primaryAction.label}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section
                className={cn(
                  "rounded-[28px] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_18px_42px_-32px_rgba(0,0,0,0.78)]",
                  isDarkMode ? "border-white/10 bg-white/[0.035]" : "border-black/8 bg-white"
                )}
              >
                <div className="mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4 text-white/62" />
                  <p className="text-sm font-semibold">{messageCenter?.ui.pendingMatchesTitle || "待确认搭子"}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", isDarkMode ? "border border-white/8 bg-white/[0.04] text-white/70" : "border border-black/8 bg-black/[0.03] text-black/70")}>
                    {pendingMatches.length}
                  </span>
                </div>

                {selectedPendingMatchId ? (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={closePendingMatchDetail}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition",
                          isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/80 hover:bg-white/[0.08]" : "border border-black/8 bg-black/[0.03] text-black/76 hover:bg-black/[0.05]"
                      )}
                    >
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                      返回待确认列表
                    </button>

                    {pendingMatchDetailLoading ? (
                      <div
                        className={cn(
                          "rounded-2xl border px-4 py-8 text-center text-sm",
                          isDarkMode ? "border-white/8 bg-white/[0.03] text-white/72" : "border-black/8 bg-black/[0.03] text-black/72"
                        )}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          正在整理这次匹配详情…
                        </div>
                      </div>
                    ) : pendingMatchDetailError ? (
                      <div
                        className={cn(
                          "rounded-2xl border px-4 py-5 text-sm leading-6",
                          isDarkMode ? "border-white/10 bg-white/[0.04] text-white/78" : "border-black/8 bg-black/[0.03] text-black/78"
                        )}
                      >
                        {pendingMatchDetailError}
                      </div>
                    ) : pendingMatchDetail ? (
                      <div className="space-y-3">
                        <div
                          className={cn(
                            "rounded-2xl border px-4 py-4",
                            isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-black/[0.02]"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">{getPendingMatchHeadline(pendingMatchDetail)}</p>
                              <p className={cn("mt-1 text-xs leading-5", isDarkMode ? "text-white/54" : "text-black/52")}>
                                匹配度 {pendingMatchDetail.matchScore}% · {pendingMatchDetail.locationHint}
                                {pendingMatchDetail.commonTags.length > 0 ? ` · ${pendingMatchDetail.commonTags.join("、")}` : ""}
                              </p>
                            </div>
                            <span className={cn("rounded-full px-2 py-1 text-[11px] font-medium", pendingMatchDetail.isTempOrganizer ? "bg-white text-black" : isDarkMode ? "border border-white/8 bg-white/[0.04] text-white/70" : "border border-black/8 bg-black/[0.03] text-black/70")}>
                              {getPendingMatchDetailStatusLabel(pendingMatchDetail)}
                            </span>
                          </div>
                          <div className={cn("mt-3 flex flex-wrap items-center gap-3 text-xs", isDarkMode ? "text-white/42" : "text-black/42")}>
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatRelativeTime(pendingMatchDetail.confirmDeadline)} 前确认
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              召集人：{pendingMatchDetail.organizerNickname || "召集人"}
                            </span>
                          </div>
                        </div>

                        <div
                          className={cn(
                            "rounded-2xl border px-4 py-4",
                            isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-black/[0.02]"
                          )}
                        >
                          <p className="text-sm font-semibold">下一步怎么做</p>
                          <p className={cn("mt-2 text-xs leading-6", isDarkMode ? "text-white/54" : "text-black/52")}>{pendingMatchDetail.nextActionText}</p>
                        </div>

                        {pendingMatchDetail.icebreaker ? (
                          <div
                            className={cn(
                              "rounded-2xl border px-4 py-4",
                              isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-black/[0.02]"
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold">系统破冰建议</p>
                              <span className={cn("text-[11px]", isDarkMode ? "text-white/42" : "text-black/42")}>{formatRelativeTime(pendingMatchDetail.icebreaker.createdAt)}</span>
                            </div>
                            <p className={cn("mt-2 text-xs leading-6", isDarkMode ? "text-white/72" : "text-black/76")}>{pendingMatchDetail.icebreaker.content}</p>
                          </div>
                        ) : null}

                        <div
                          className={cn(
                            "rounded-2xl border px-4 py-4",
                            isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-black/[0.02]"
                          )}
                        >
                          <p className="text-sm font-semibold">匹配成员</p>
                          <div className="mt-3 space-y-3">
                            {pendingMatchDetail.members.map((member) => (
                              <div
                                key={member.userId}
                                className={cn(
                                  "rounded-2xl border px-3 py-3",
                                  isDarkMode ? "border-white/8 bg-white/[0.025]" : "border-black/8 bg-white"
                                )}
                              >
                                <div className="flex items-start gap-3">
                                  {member.avatarUrl ? (
                                    <img src={member.avatarUrl} alt={member.nickname || "成员头像"} className="h-10 w-10 rounded-full object-cover" />
                                  ) : (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/8 bg-white/[0.06] text-sm font-semibold text-white/78">
                                      {(member.nickname || "搭").slice(0, 1)}
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-sm font-semibold">{member.nickname || "匹配成员"}</p>
                                      {member.isTempOrganizer ? <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-black">召集人</span> : null}
                                    </div>
                                    <p className={cn("mt-1 text-xs leading-5", isDarkMode ? "text-white/42" : "text-black/42")}>{member.locationHint} · {member.timePreference || "时间待沟通"}</p>
                                    <p className={cn("mt-2 text-xs leading-6", isDarkMode ? "text-white/72" : "text-black/76")}>{member.intentSummary}</p>
                                    {member.tags.length > 0 ? (
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {member.tags.map((tag) => (
                                          <span key={`${member.userId}:${tag}`} className={cn("rounded-full px-2 py-1 text-[11px] font-medium", isDarkMode ? "border border-white/8 bg-white/[0.04] text-white/70" : "border border-black/8 bg-black/[0.03] text-black/70")}>{tag}</span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {pendingMatchDetail.isTempOrganizer ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={disabled || Boolean(pendingActionKey)}
                              onClick={() => void handlePendingMatchAction(pendingMatchDetail.id, "confirm")}
                              className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {pendingActionKey === `confirm:${pendingMatchDetail.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              {getPendingMatchPrimaryActionLabel(pendingMatchDetail.requestMode)}
                            </button>
                            <button
                              type="button"
                              disabled={disabled || Boolean(pendingActionKey)}
                              onClick={() => void handlePendingMatchAction(pendingMatchDetail.id, "cancel")}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                                isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/80 hover:bg-white/[0.08]" : "border border-black/8 bg-black/[0.03] text-black/76 hover:bg-black/[0.05]"
                              )}
                            >
                              {pendingActionKey === `cancel:${pendingMatchDetail.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                              {getPendingMatchSecondaryActionLabel(pendingMatchDetail.requestMode)}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : pendingMatches.length === 0 ? (
                  <p className={cn("text-sm leading-6", isDarkMode ? "text-white/54" : "text-black/52")}>
                    {messageCenter?.ui.pendingMatchesEmpty || "当前没有待确认匹配，新的搭子撮合到了会先出现在这里。"}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {pendingMatches.map((match) => {
                      const confirmKey = `confirm:${match.id}`;
                      const cancelKey = `cancel:${match.id}`;
                      const tags = match.commonTags.slice(0, 3).join("、");
                      return (
                        <div
                          key={match.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => void openPendingMatchDetail(match.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              void openPendingMatchDetail(match.id);
                            }
                          }}
                          className={cn(
                            "cursor-pointer rounded-2xl border px-4 py-4 transition",
                            isDarkMode ? "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.045]" : "border-black/8 bg-black/[0.02] hover:border-black/12 hover:bg-black/[0.035]"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">{getPendingMatchListTitle(match)}</p>
                              <p className={cn("mt-1 text-xs leading-5", isDarkMode ? "text-white/54" : "text-black/52")}>
                                匹配度 {match.matchScore}% · {match.locationHint}
                                {tags ? ` · ${tags}` : ""}
                              </p>
                            </div>
                            <span className={cn("rounded-full px-2 py-1 text-[11px] font-medium", match.isTempOrganizer ? "bg-white text-black" : isDarkMode ? "border border-white/8 bg-white/[0.04] text-white/70" : "border border-black/8 bg-black/[0.03] text-black/70")}>
                              {getPendingMatchStatusLabel(match)}
                            </span>
                          </div>
                          <div className={cn("mt-3 flex items-center gap-2 text-xs", isDarkMode ? "text-white/42" : "text-black/42")}>
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatRelativeTime(match.confirmDeadline)} 前确认
                          </div>
                          <div className={cn("mt-2 text-[11px]", isDarkMode ? "text-white/42" : "text-black/42")}>{getPendingMatchListHint(match)}</div>
                          {match.isTempOrganizer ? (
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                disabled={disabled || Boolean(pendingActionKey)}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handlePendingMatchAction(match.id, "confirm");
                                }}
                                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {pendingActionKey === confirmKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                {getPendingMatchPrimaryActionLabel(match.requestMode)}
                              </button>
                              <button
                                type="button"
                                disabled={disabled || Boolean(pendingActionKey)}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handlePendingMatchAction(match.id, "cancel");
                                }}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                                  isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/80 hover:bg-white/[0.08]" : "border border-black/8 bg-black/[0.03] text-black/76 hover:bg-black/[0.05]"
                                )}
                              >
                                {pendingActionKey === cancelKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                {getPendingMatchSecondaryActionLabel(match.requestMode)}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section
                className={cn(
                  "rounded-[28px] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_18px_42px_-32px_rgba(0,0,0,0.78)]",
                  isDarkMode ? "border-white/10 bg-white/[0.035]" : "border-black/8 bg-white"
                )}
              >
                <div className="mb-3 flex items-center gap-2">
                  <BellRing className="h-4 w-4 text-white/62" />
                  <p className="text-sm font-semibold">{messageCenter?.ui.systemSectionTitle || "系统跟进"}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", isDarkMode ? "border border-white/8 bg-white/[0.04] text-white/70" : "border border-black/8 bg-black/[0.03] text-black/70")}>
                    {systemNotifications.length}
                  </span>
                </div>

                {systemNotifications.length === 0 ? (
                  <p className={cn("text-sm leading-6", isDarkMode ? "text-white/54" : "text-black/52")}>
                    {messageCenter?.ui.systemEmpty || "暂无系统通知，活动进度有变化会第一时间出现在这里。"}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {systemNotifications.map((notification) => {
                      const readKey = `read:${notification.id}`;
                      const reviewKey = `review:${notification.id}`;
                      const rebookKey = `rebook:${notification.id}`;
                      const kickoffKey = `kickoff:${notification.id}`;
                      const positiveFeedbackKey = `feedback:positive:${notification.id}`;
                      const neutralFeedbackKey = `feedback:neutral:${notification.id}`;
                      const negativeFeedbackKey = `feedback:failed:${notification.id}`;
                      const canKickoff =
                        (notification.type === "join" || notification.type === "new_participant") &&
                        Boolean(notification.activityId);
                      return (
                        <div
                          key={notification.id}
                          className={cn(
                            "rounded-2xl border px-4 py-4",
                            notification.isRead
                              ? isDarkMode
                                ? "border-white/8 bg-white/[0.03]"
                                : "border-black/8 bg-black/[0.02]"
                              : isDarkMode
                                ? "border-white/12 bg-white/[0.055]"
                                : "border-black/10 bg-black/[0.045]"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">{notification.title}</p>
                              <p className={cn("mt-1 text-xs leading-5", isDarkMode ? "text-white/54" : "text-black/52")}>
                                {notification.content || getNotificationFallbackContent(notification.type)}
                              </p>
                            </div>
                            {!notification.isRead ? (
                              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-white/72" />
                            ) : null}
                          </div>
                          <div className={cn("mt-3 flex items-center gap-2 text-xs", isDarkMode ? "text-white/42" : "text-black/42")}>
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatRelativeTime(notification.createdAt)}
                          </div>

                          {notification.type === "post_activity" ? (
                            <div className="mt-3 space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={disabled || Boolean(pendingActionKey)}
                                  onClick={() => void handleQuickFeedback(notification, "positive")}
                                  className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {pendingActionKey === positiveFeedbackKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                  {messageCenter?.ui.feedbackPositiveLabel || "挺顺利"}
                                </button>
                                <button
                                  type="button"
                                  disabled={disabled || Boolean(pendingActionKey)}
                                  onClick={() => void handleQuickFeedback(notification, "neutral")}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                                    isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/80 hover:bg-white/[0.08]" : "border border-black/8 bg-black/[0.03] text-black/76 hover:bg-black/[0.05]"
                                  )}
                                >
                                  {pendingActionKey === neutralFeedbackKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  {messageCenter?.ui.feedbackNeutralLabel || "一般"}
                                </button>
                                <button
                                  type="button"
                                  disabled={disabled || Boolean(pendingActionKey)}
                                  onClick={() => void handleQuickFeedback(notification, "failed")}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                                    isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/80 hover:bg-white/[0.08]" : "border border-black/8 bg-black/[0.03] text-black/76 hover:bg-black/[0.05]"
                                  )}
                                >
                                  {pendingActionKey === negativeFeedbackKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                  {messageCenter?.ui.feedbackNegativeLabel || "没成局"}
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={disabled || Boolean(pendingActionKey)}
                                  onClick={() => void handleFollowUpPrompt(notification, "review")}
                                  className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {pendingActionKey === reviewKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                  {messageCenter?.ui.reviewActionLabel || "去复盘"}
                                </button>
                                <button
                                  type="button"
                                  disabled={disabled || Boolean(pendingActionKey)}
                                  onClick={() => void handleFollowUpPrompt(notification, "rebook")}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                                    isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/80 hover:bg-white/[0.08]" : "border border-black/8 bg-black/[0.03] text-black/76 hover:bg-black/[0.05]"
                                  )}
                                >
                                  {pendingActionKey === rebookKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  {messageCenter?.ui.rebookActionLabel || "去再约"}
                                </button>
                              </div>
                            </div>
                          ) : canKickoff ? (
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                disabled={disabled || Boolean(pendingActionKey)}
                                onClick={() => void handleFollowUpPrompt(notification, "kickoff")}
                                className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {pendingActionKey === kickoffKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                                {messageCenter?.ui.kickoffActionLabel || "让 AI 帮我写开场白"}
                              </button>
                            </div>
                          ) : !notification.isRead ? (
                            <button
                              type="button"
                              disabled={Boolean(pendingActionKey)}
                              onClick={() => void handleNotificationRead(notification.id)}
                              className={cn(
                                "mt-3 inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                                isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/80 hover:bg-white/[0.08]" : "border border-black/8 bg-black/[0.03] text-black/76 hover:bg-black/[0.05]"
                              )}
                            >
                              {pendingActionKey === readKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              {messageCenter?.ui.markReadActionLabel || "标记已读"}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section
                className={cn(
                  "rounded-[28px] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_18px_42px_-32px_rgba(0,0,0,0.78)]",
                  isDarkMode ? "border-white/10 bg-white/[0.035]" : "border-black/8 bg-white"
                )}
              >
                <div className="mb-3 flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-white/62" />
                  <p className="text-sm font-semibold">{messageCenter?.ui.chatSummarySectionTitle || "活动群聊摘要"}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", isDarkMode ? "border border-white/8 bg-white/[0.04] text-white/70" : "border border-black/8 bg-black/[0.03] text-black/70")}>
                    {messageCenter?.chatActivities.totalUnread || 0} 条未读
                  </span>
                </div>
                <p className={cn("mb-3 text-xs leading-5", isDarkMode ? "text-white/42" : "text-black/42")}>
                  {messageCenter?.ui.chatSummaryDescription || "这里汇总活动群聊的最近动态，点进详情可以继续讨论和跟进。"}
                </p>

                {chatActivities.length === 0 ? (
                  <p className={cn("text-sm leading-6", isDarkMode ? "text-white/54" : "text-black/52")}>
                    {messageCenter?.ui.chatSummaryEmpty || "暂无活动群聊记录，参与活动后这里会同步显示最近动态。"}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {chatActivities.map((chat) => (
                      <div
                        key={chat.activityId}
                        className={cn(
                          "rounded-2xl border px-4 py-4",
                          isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-black/[0.02]"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold">{chat.activityTitle}</p>
                              {chat.responseNeeded ? (
                                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-black">
                                  等你回应
                                </span>
                              ) : null}
                            </div>
                            <p className={cn("mt-1 text-xs leading-5", isDarkMode ? "text-white/54" : "text-black/52")}>
                              {chat.lastMessage
                                ? `${chat.lastMessageSenderNickname ? `${chat.lastMessageSenderNickname}：` : ""}${chat.lastMessage}`
                                : messageCenter?.ui.chatSummaryFallbackMessage || "还没人说话，发句开场吧"}
                            </p>
                          </div>
                          {chat.unreadCount > 0 ? (
                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-black">
                              {chat.unreadCount}
                            </span>
                          ) : null}
                        </div>
                        <div className={cn("mt-3 flex items-center gap-3 text-xs", isDarkMode ? "text-white/42" : "text-black/42")}>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatRelativeTime(chat.lastMessageTime)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {chat.participantCount} 人
                          </span>
                          {chat.isArchived ? <span>已归档</span> : null}
                        </div>
                        {!chat.isArchived ? (
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              disabled={disabled || Boolean(pendingActionKey)}
                              onClick={() =>
                                void handleFollowUpPrompt(
                                  {
                                    id: `chat:${chat.activityId}`,
                                    userId: "",
                                    type: "new_participant",
                                    title: chat.activityTitle,
                                    content: chat.lastMessage,
                                    activityId: chat.activityId,
                                    isRead: true,
                                    createdAt: new Date().toISOString(),
                                  },
                                  "kickoff",
                                  undefined,
                                  { skipMarkRead: true }
                                )
                              }
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                                isDarkMode ? "border border-white/8 bg-white/[0.05] text-white/80 hover:bg-white/[0.08]" : "border border-black/8 bg-black/[0.03] text-black/76 hover:bg-black/[0.05]"
                              )}
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              {messageCenter?.ui.kickoffActionLabel || "让 AI 帮我写开场白"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

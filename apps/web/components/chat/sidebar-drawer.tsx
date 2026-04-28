"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  ChevronRight,
  Clock3,
  History,
  Menu,
  Search,
  UserRound,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { readClientToken, readClientUserId } from "@/lib/client-auth";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";

type SidebarDrawerProps = {
  isDarkMode?: boolean;
  disabled?: boolean;
  activeConversationId?: string | null;
  currentTasks: SidebarTaskSnapshot[];
  currentTasksLoading?: boolean;
  ui: {
    title: string;
    messageCenterLabel: string;
    currentTasksTitle: string;
    currentTasksEmpty: string;
    historyTitle: string;
    searchPlaceholder: string;
    emptySearchResult: string;
    emptyHistory: string;
  };
  onSelectConversation: (conversationId: string) => Promise<void>;
  onSelectTaskAction: (action: SidebarTaskAction) => Promise<void> | void;
  onOpenMessageCenter: () => void;
};

type SidebarUserProfile = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  phoneNumber: string | null;
};

type SidebarConversation = {
  id: string;
  userId: string;
  title: string | null;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  userNickname: string | null;
};

type ConversationsPayload = {
  items: SidebarConversation[];
  total: number;
  hasMore: boolean;
  cursor: string | null;
};

type SidebarTaskAction = {
  kind: "structured_action" | "navigate" | "switch_tab";
  label: string;
  action?: string;
  payload?: Record<string, unknown>;
  source?: string;
  originalText?: string;
  url?: string;
};

type SidebarTaskSnapshot = {
  id: string;
  taskType: "join_activity" | "find_partner" | "create_activity";
  taskTypeLabel: string;
  currentStage: string;
  stageLabel: string;
  status: "active" | "waiting_auth" | "waiting_async_result" | "completed" | "cancelled" | "expired";
  goalText: string;
  headline: string;
  summary: string;
  updatedAt: string;
  activityId?: string;
  activityTitle?: string;
  attentionLevel?: "normal" | "time_sensitive" | "action_required" | "follow_up";
  primaryAction?: SidebarTaskAction;
  secondaryAction?: SidebarTaskAction;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readConversationLabel(item: SidebarConversation): string {
  if (typeof item.title === "string" && item.title.trim()) {
    return item.title.trim();
  }

  if (typeof item.userNickname === "string" && item.userNickname.trim()) {
    return `${item.userNickname.trim()} 的对话`;
  }

  return "未命名对话";
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return `${date.getHours().toString().padStart(2, "0")}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function SidebarDrawer({
  isDarkMode = false,
  disabled = false,
  activeConversationId = null,
  currentTasks,
  currentTasksLoading = false,
  ui,
  onSelectConversation,
  onSelectTaskAction,
  onOpenMessageCenter,
}: SidebarDrawerProps) {
  const [open, setOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<SidebarUserProfile | null>(null);
  const [conversations, setConversations] = useState<SidebarConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  const userId = useMemo(() => readClientUserId(authToken), [authToken]);

  useEffect(() => {
    const syncAuth = () => {
      setAuthToken(readClientToken());
    };

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
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!authToken || !userId) {
      setUserProfile(null);
      setConversations([]);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const headers = {
      Authorization: `Bearer ${authToken}`,
    };

    void Promise.all([
      fetch(`${API_BASE}/users/${userId}`, {
        headers,
        cache: "no-store",
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as unknown;
        if (!isRecord(payload) || typeof payload.id !== "string") {
          return null;
        }

        return {
          id: payload.id,
          nickname: typeof payload.nickname === "string" ? payload.nickname : null,
          avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : null,
          phoneNumber: typeof payload.phoneNumber === "string" ? payload.phoneNumber : null,
        } satisfies SidebarUserProfile;
      }),
      fetch(`${API_BASE}/ai/conversations?userId=${encodeURIComponent(userId)}&limit=20`, {
        headers,
        cache: "no-store",
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as unknown;
        if (!isRecord(payload) || !Array.isArray(payload.items)) {
          return null;
        }

        return payload as ConversationsPayload;
      }),
    ])
      .then(([profile, conversationPayload]) => {
        setUserProfile(profile);
        setConversations(conversationPayload?.items ?? []);
      })
      .catch(() => {
        setUserProfile(null);
        setConversations([]);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [authToken, open, userId]);

  const filteredConversations = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase();
    if (!keyword) {
      return conversations;
    }

    return conversations.filter((item) => {
      const title = readConversationLabel(item).toLowerCase();
      return title.includes(keyword);
    });
  }, [conversations, searchValue]);

  const displayName = userProfile?.nickname?.trim() || (userId ? `用户 ${userId.slice(0, 6)}` : "访客模式");
  const secondaryLabel = userProfile?.phoneNumber?.trim() ?? "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
            isDarkMode ? "text-white/92 hover:bg-white/[0.06]" : "text-black/86 hover:bg-black/[0.05]"
          )}
          aria-label="打开侧边栏"
        >
          <Menu className="h-5 w-5" />
        </button>
      </DialogTrigger>

      <DialogContent
        className={cn(
          "left-0 top-0 flex h-[100dvh] w-full max-w-[420px] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-r p-0 shadow-[0_24px_72px_-36px_rgba(0,0,0,0.84)] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
          isDarkMode ? "border-white/10 bg-black text-white/92" : "border-black/8 bg-white text-black/88"
        )}
      >
          <DialogHeader className={cn("border-b px-5 pb-4 pt-5 text-left", isDarkMode ? "border-white/8" : "border-black/8")}>
          <DialogTitle className="text-[18px] font-semibold tracking-tight">{ui.title}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
          <section
            className={cn(
              "rounded-[28px] border p-4",
              isDarkMode
                ? "border-white/8 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                : "border-black/8 bg-white shadow-[0_16px_40px_-32px_rgba(0,0,0,0.12)]"
            )}
          >
            <div className="flex items-center gap-3">
              {userProfile?.avatarUrl ? (
                <img
                  src={userProfile.avatarUrl}
                  alt={displayName}
                  className={cn("h-12 w-12 rounded-full border object-cover", isDarkMode ? "border-white/10" : "border-black/10")}
                />
              ) : (
                <div
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full border",
                    isDarkMode ? "border-white/10 bg-white/[0.05] text-white/82" : "border-black/10 bg-black/[0.05] text-black/76"
                  )}
                >
                  <UserRound className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className={cn("truncate text-[17px] font-semibold", isDarkMode ? "text-white/94" : "text-black/90")}>{displayName}</p>
                {secondaryLabel ? (
                  <p className={cn("mt-1 text-xs", isDarkMode ? "text-white/48" : "text-black/46")}>{secondaryLabel}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenMessageCenter();
                }}
                className={cn(
                  "flex items-center justify-between rounded-[20px] border px-3.5 py-3 text-left text-sm transition",
                  isDarkMode
                    ? "border-white/8 bg-white/[0.03] text-white/84 hover:bg-white/[0.05]"
                    : "border-black/8 bg-black/[0.03] text-black/80 hover:bg-black/[0.045]"
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <BellRing className="h-4 w-4" />
                  {ui.messageCenterLabel}
                </span>
              </button>
            </div>
          </section>

          {authToken ? (
            <section className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className={cn("text-[15px] font-semibold", isDarkMode ? "text-white/92" : "text-black/88")}>{ui.currentTasksTitle}</p>
              </div>
              <Clock3 className={cn("h-4 w-4", isDarkMode ? "text-white/40" : "text-black/36")} />
            </div>

            {loading || currentTasksLoading ? (
              <div className="space-y-2">
                {[0, 1].map((item) => (
                  <div
                    key={item}
                    className={cn(
                      "h-[118px] animate-pulse rounded-[22px] border",
                      isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-white"
                    )}
                  />
                ))}
              </div>
            ) : currentTasks.length === 0 ? (
              <div
                className={cn(
                  "rounded-[24px] border px-4 py-4 text-sm",
                  isDarkMode ? "border-white/8 bg-white/[0.02] text-white/60" : "border-black/8 bg-white text-black/60"
                )}
              >
                {ui.currentTasksEmpty}
              </div>
            ) : (
              <div className="space-y-2">
                {currentTasks.map((task) => {
                  const isPendingTask = pendingTaskId === task.id;
                  return (
                    <div
                      key={task.id}
                      className={cn(
                        "rounded-[22px] border px-4 py-3",
                        task.attentionLevel === "time_sensitive" || task.attentionLevel === "action_required"
                          ? isDarkMode
                            ? "border-amber-300/20 bg-amber-300/[0.045]"
                            : "border-amber-500/18 bg-amber-50"
                          : task.attentionLevel === "follow_up"
                            ? isDarkMode
                              ? "border-emerald-300/16 bg-emerald-300/[0.035]"
                              : "border-emerald-600/14 bg-emerald-50"
                          : isDarkMode ? "border-white/8 bg-white/[0.025]" : "border-black/8 bg-white"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={cn("truncate text-sm font-medium", isDarkMode ? "text-white/88" : "text-black/84")}>
                            {task.headline}
                          </p>
                          <p className={cn("mt-1 text-xs", isDarkMode ? "text-white/42" : "text-black/40")}>
                            {task.taskTypeLabel} · {task.stageLabel}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-1 text-[11px]",
                            isDarkMode ? "bg-white/[0.06] text-white/58" : "bg-black/[0.045] text-black/52"
                          )}
                        >
                          {task.stageLabel}
                        </span>
                      </div>

                      <p className={cn("mt-3 text-sm leading-6", isDarkMode ? "text-white/68" : "text-black/64")}>
                        {task.summary}
                      </p>

                      {task.primaryAction || task.secondaryAction ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {task.primaryAction ? (
                            <button
                              type="button"
                              disabled={disabled || isPendingTask}
                              onClick={() => {
                                setPendingTaskId(task.id);
                                void Promise.resolve(onSelectTaskAction(task.primaryAction!)).finally(() => {
                                  setPendingTaskId((current) => (current === task.id ? null : current));
                                });
                              }}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
                                isDarkMode ? "bg-white text-[#111111] hover:bg-white/92" : "bg-black text-white hover:bg-black/92"
                              )}
                            >
                              {task.primaryAction.label}
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          ) : null}

                          {task.secondaryAction ? (
                            <button
                              type="button"
                              disabled={disabled || isPendingTask}
                              onClick={() => {
                                setPendingTaskId(task.id);
                                void Promise.resolve(onSelectTaskAction(task.secondaryAction!)).finally(() => {
                                  setPendingTaskId((current) => (current === task.id ? null : current));
                                });
                              }}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
                                isDarkMode
                                  ? "border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.05]"
                                  : "border-black/10 bg-black/[0.03] text-black/76 hover:bg-black/[0.045]"
                              )}
                            >
                              {task.secondaryAction.label}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            </section>
          ) : null}

          {authToken ? (
            <section className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className={cn("text-[15px] font-semibold", isDarkMode ? "text-white/92" : "text-black/88")}>{ui.historyTitle}</p>
              </div>
              <History className={cn("h-4 w-4", isDarkMode ? "text-white/40" : "text-black/36")} />
            </div>

            <div
              className={cn(
                "mb-3 flex items-center gap-2 rounded-[18px] border px-3 py-2.5",
                isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-white"
              )}
            >
              <Search className={cn("h-4 w-4", isDarkMode ? "text-white/36" : "text-black/34")} />
              <input
                type="text"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder={ui.searchPlaceholder}
                className={cn(
                  "min-w-0 flex-1 bg-transparent text-sm outline-none",
                  isDarkMode ? "text-white/84 placeholder:text-white/26" : "text-black/84 placeholder:text-black/26"
                )}
              />
            </div>

            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className={cn(
                      "h-[72px] animate-pulse rounded-[22px] border",
                      isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-white"
                    )}
                  />
                ))}
              </div>
            ) : filteredConversations.length === 0 ? (
              <div
                className={cn(
                  "rounded-[24px] border px-4 py-4 text-sm",
                  isDarkMode ? "border-white/8 bg-white/[0.02] text-white/60" : "border-black/8 bg-white text-black/60"
                )}
              >
                {searchValue.trim() ? ui.emptySearchResult : ui.emptyHistory}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredConversations.map((item) => {
                  const isActive = item.id === activeConversationId;
                  const isPending = pendingConversationId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setPendingConversationId(item.id);
                        void onSelectConversation(item.id)
                          .then(() => {
                            setOpen(false);
                          })
                          .finally(() => {
                            setPendingConversationId((current) => (current === item.id ? null : current));
                          });
                      }}
                      disabled={disabled || isPending}
                      className={cn(
                        "w-full rounded-[22px] border px-4 py-3 text-left transition disabled:opacity-45",
                        isActive
                          ? isDarkMode
                            ? "border-white/12 bg-white/[0.06]"
                            : "border-black/10 bg-black/[0.045]"
                          : isDarkMode
                            ? "border-white/8 bg-white/[0.025] hover:bg-white/[0.04]"
                            : "border-black/8 bg-white hover:bg-black/[0.025]"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={cn("truncate text-sm font-medium", isDarkMode ? "text-white/88" : "text-black/84")}>
                            {readConversationLabel(item)}
                          </p>
                          <p className={cn("mt-1 text-xs", isDarkMode ? "text-white/40" : "text-black/38")}>
                            {item.messageCount} 条消息
                          </p>
                        </div>
                        <span className={cn("shrink-0 text-[11px]", isDarkMode ? "text-white/34" : "text-black/34")}>
                          {isPending ? "载入中" : formatConversationTime(item.lastMessageAt)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </section>
          ) : null}

        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  Camera,
  ChevronRight,
  Menu,
  Mic,
  MoreHorizontal,
  Plus,
  QrCode,
  Sparkles,
  Volume2,
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Suggestion,
  Suggestions,
} from "@/components/ai-elements/suggestion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  GenUIAlertBlock,
  GenUIBlock,
  GenUIChoiceBlock,
  GenUIChoiceOption,
  GenUICtaGroupBlock,
  GenUICtaItem,
  GenUIEntityCardBlock,
  GenUIFormBlock,
  GenUIInput,
  GenUIListBlock,
  GenUIStreamEvent,
  GenUITextBlock,
  GenUITurnEnvelope,
} from "@/src/gen/genui-contract";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";
const GROUP_INVITE_URL = process.env.NEXT_PUBLIC_GROUP_INVITE_URL || "https://juchang.app";
const GROUP_QR_IMAGE_URL =
  process.env.NEXT_PUBLIC_GROUP_QR_URL ||
  `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(GROUP_INVITE_URL)}`;
const DEFAULT_PROMPTS = [
  "想租个周五晚上的局",
  "我在观音桥，想组个桌游局",
  "周末附近有什么活动",
];
const DEFAULT_WELCOME_GREETING = "你好～";
const DEFAULT_WELCOME_SUB_GREETING = "今天想约什么局？";
const DEFAULT_BOTTOM_ACTIONS: string[] = [
  "快速组局",
  "找搭子",
  "附近活动",
  "我的草稿",
];
const DEFAULT_PROFILE_HINTS = {
  low: "补充偏好后，小聚推荐会更准",
  medium: "社交画像正在完善中，继续聊聊你的习惯",
  high: "社交画像已较完整，可直接让小聚给你安排",
};

type ComposerStatus = "ready" | "submitted";

type ChatRecord =
  | {
      id: string;
      role: "user";
      text: string;
    }
  | {
      id: string;
      role: "assistant";
      pending?: boolean;
      turn?: GenUITurnEnvelope;
      error?: string;
    };

type AssistantRecord = Extract<ChatRecord, { role: "assistant" }>;
type ActionOption = Pick<GenUIChoiceOption, "label" | "action" | "params"> | GenUICtaItem;
type WelcomeSocialProfile = {
  participationCount: number;
  activitiesCreatedCount: number;
  preferenceCompleteness: number;
};
type WelcomeUiPayload = {
  bottomQuickActions: string[];
  profileHints: {
    low: string;
    medium: string;
    high: string;
  };
};

const TYPEWRITER_INTERVAL_MS = 18;

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function readClientToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const tokenKeys = ["token", "authToken", "accessToken"];
  for (const key of tokenKeys) {
    const value = window.localStorage.getItem(key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSSEPacket(packet: string): { eventName: string; dataText: string } | null {
  const trimmed = packet.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  return {
    eventName,
    dataText: dataLines.join("\n"),
  };
}

function createEmptyEnvelope(params: {
  traceId: string;
  conversationId: string;
  turnId: string;
}): GenUITurnEnvelope {
  return {
    traceId: params.traceId,
    conversationId: params.conversationId,
    turn: {
      turnId: params.turnId,
      role: "assistant",
      status: "streaming",
      blocks: [],
    },
  };
}

function extractWelcomePrompts(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.quickPrompts)) {
    return [];
  }

  return payload.quickPrompts
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }

      if (typeof item.prompt === "string" && item.prompt.trim()) {
        return item.prompt.trim();
      }

      if (typeof item.text === "string" && item.text.trim()) {
        return item.text.trim();
      }

      return "";
    })
    .filter(Boolean)
    .slice(0, 5);
}

function extractWelcomeSocialProfile(payload: unknown): WelcomeSocialProfile | null {
  if (!isRecord(payload) || !isRecord(payload.socialProfile)) {
    return null;
  }

  const participationCount = Number(payload.socialProfile.participationCount);
  const activitiesCreatedCount = Number(payload.socialProfile.activitiesCreatedCount);
  const preferenceCompleteness = Number(payload.socialProfile.preferenceCompleteness);

  if (
    !Number.isFinite(participationCount) ||
    !Number.isFinite(activitiesCreatedCount) ||
    !Number.isFinite(preferenceCompleteness)
  ) {
    return null;
  }

  return {
    participationCount,
    activitiesCreatedCount,
    preferenceCompleteness,
  };
}

function extractWelcomeGreeting(payload: unknown): { greeting: string; subGreeting: string } {
  if (!isRecord(payload)) {
    return {
      greeting: DEFAULT_WELCOME_GREETING,
      subGreeting: DEFAULT_WELCOME_SUB_GREETING,
    };
  }

  const greeting =
    typeof payload.greeting === "string" && payload.greeting.trim()
      ? payload.greeting.trim()
      : DEFAULT_WELCOME_GREETING;
  const subGreeting =
    typeof payload.subGreeting === "string" && payload.subGreeting.trim()
      ? payload.subGreeting.trim()
      : DEFAULT_WELCOME_SUB_GREETING;

  return { greeting, subGreeting };
}

function extractWelcomeUi(payload: unknown): WelcomeUiPayload {
  if (!isRecord(payload) || !isRecord(payload.ui)) {
    return {
      bottomQuickActions: DEFAULT_BOTTOM_ACTIONS,
      profileHints: DEFAULT_PROFILE_HINTS,
    };
  }

  const actions = Array.isArray(payload.ui.bottomQuickActions)
    ? payload.ui.bottomQuickActions
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];

  const hintsSource = isRecord(payload.ui.profileHints) ? payload.ui.profileHints : {};
  const profileHints = {
    low:
      typeof hintsSource.low === "string" && hintsSource.low.trim()
        ? hintsSource.low.trim()
        : DEFAULT_PROFILE_HINTS.low,
    medium:
      typeof hintsSource.medium === "string" && hintsSource.medium.trim()
        ? hintsSource.medium.trim()
        : DEFAULT_PROFILE_HINTS.medium,
    high:
      typeof hintsSource.high === "string" && hintsSource.high.trim()
        ? hintsSource.high.trim()
        : DEFAULT_PROFILE_HINTS.high,
  };

  return {
    bottomQuickActions: actions.length ? actions : DEFAULT_BOTTOM_ACTIONS,
    profileHints,
  };
}

function getProfileHint(
  completeness: number,
  profileHints: WelcomeUiPayload["profileHints"] = DEFAULT_PROFILE_HINTS
): string {
  if (completeness < 30) {
    return profileHints.low;
  }

  if (completeness < 70) {
    return profileHints.medium;
  }

  return profileHints.high;
}

function upsertBlockWithMode(
  blocks: GenUIBlock[],
  block: GenUIBlock,
  mode: "append" | "replace"
): { blocks: GenUIBlock[]; index: number } {
  if (mode === "replace") {
    const targetIndex = blocks.findIndex((item) => item.blockId === block.blockId);
    if (targetIndex >= 0) {
      const nextBlocks = [...blocks];
      nextBlocks[targetIndex] = block;
      return { blocks: nextBlocks, index: targetIndex };
    }
  }

  const nextBlocks = [...blocks, block];
  return { blocks: nextBlocks, index: nextBlocks.length - 1 };
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatRecord[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ComposerStatus>("ready");
  const [quickPrompts, setQuickPrompts] = useState<string[]>(DEFAULT_PROMPTS);
  const [welcomeProfile, setWelcomeProfile] = useState<WelcomeSocialProfile | null>(null);
  const [welcomeGreeting, setWelcomeGreeting] = useState(DEFAULT_WELCOME_GREETING);
  const [welcomeSubGreeting, setWelcomeSubGreeting] = useState(DEFAULT_WELCOME_SUB_GREETING);
  const [welcomeUi, setWelcomeUi] = useState<WelcomeUiPayload>({
    bottomQuickActions: DEFAULT_BOTTOM_ACTIONS,
    profileHints: DEFAULT_PROFILE_HINTS,
  });
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const isDarkMode = false;

  const isSending = status === "submitted";

  useEffect(() => {
    const controller = new AbortController();

    void fetch(`${API_BASE}/ai/welcome`, {
      method: "GET",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as unknown;
        const prompts = extractWelcomePrompts(payload);
        if (prompts.length > 0) {
          setQuickPrompts(prompts);
        }
        const { greeting, subGreeting } = extractWelcomeGreeting(payload);
        setWelcomeGreeting(greeting);
        setWelcomeSubGreeting(subGreeting);
        setWelcomeUi(extractWelcomeUi(payload));
        setWelcomeProfile(extractWelcomeSocialProfile(payload));
      })
      .catch(() => {
        // keep local fallback prompts
      });

    return () => {
      controller.abort();
    };
  }, []);

  const sendTurn = useCallback(
    async (nextInput: GenUIInput, userDisplayText: string) => {
      if (isSending) {
        return;
      }

      const userMessageId = randomId("user");
      const assistantMessageId = randomId("assistant");

      setMessages((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: "user",
          text: userDisplayText,
        },
        {
          id: assistantMessageId,
          role: "assistant",
          pending: true,
        },
      ]);
      setStatus("submitted");

      try {
        let currentEnvelope: GenUITurnEnvelope | null = null;

        const patchAssistantMessage = (
          updater: (message: AssistantRecord) => AssistantRecord
        ) => {
          setMessages((prev) =>
            prev.map((message) => {
              if (message.id !== assistantMessageId || message.role !== "assistant") {
                return message;
              }
              return updater(message);
            })
          );
        };

        const applyEnvelope = (nextEnvelope: GenUITurnEnvelope, pending = true) => {
          currentEnvelope = nextEnvelope;
          patchAssistantMessage(() => ({
            id: assistantMessageId,
            role: "assistant",
            pending,
            turn: nextEnvelope,
          }));
        };

        const ensureEnvelope = () => {
          if (currentEnvelope) {
            return currentEnvelope;
          }

          const fallbackConversationId = conversationId ?? randomId("conv");
          const nextEnvelope = createEmptyEnvelope({
            traceId: randomId("trace"),
            conversationId: fallbackConversationId,
            turnId: randomId("turn"),
          });
          applyEnvelope(nextEnvelope, true);
          return nextEnvelope;
        };

        const applyBlock = (block: GenUIBlock, mode: "append" | "replace") => {
          const baseEnvelope = ensureEnvelope();
          const merge = upsertBlockWithMode(baseEnvelope.turn.blocks, block, mode);
          const nextEnvelope: GenUITurnEnvelope = {
            ...baseEnvelope,
            turn: {
              ...baseEnvelope.turn,
              blocks: merge.blocks,
            },
          };
          applyEnvelope(nextEnvelope, true);
          return merge.index;
        };

        const typewriteTextBlock = async (
          block: GenUITextBlock,
          mode: "append" | "replace"
        ) => {
          const text = block.content || "";
          const typingBlock: GenUITextBlock = {
            ...block,
            content: "",
          };
          const blockIndex = applyBlock(typingBlock, mode);
          if (!text) {
            return;
          }

          for (let cursor = 1; cursor <= text.length; cursor += 1) {
            const activeEnvelope = ensureEnvelope();
            const nextBlocks = [...activeEnvelope.turn.blocks];
            const currentBlock = nextBlocks[blockIndex];
            if (!currentBlock || currentBlock.type !== "text") {
              break;
            }

            nextBlocks[blockIndex] = {
              ...currentBlock,
              content: text.slice(0, cursor),
            };

            const nextEnvelope: GenUITurnEnvelope = {
              ...activeEnvelope,
              turn: {
                ...activeEnvelope.turn,
                blocks: nextBlocks,
              },
            };
            applyEnvelope(nextEnvelope, true);
            await sleep(TYPEWRITER_INTERVAL_MS);
          }
        };

        const token = readClientToken();
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE}/ai/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...(conversationId ? { conversationId } : {}),
            input: nextInput,
            context: {
              client: "web",
              locale: "zh-CN",
              timezone: "Asia/Shanghai",
              platformVersion: "web-vnext",
            },
            stream: true,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`请求失败（${response.status}）`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawTurnComplete = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          let separatorIndex = buffer.indexOf("\n\n");
          while (separatorIndex >= 0) {
            const packet = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);

            const parsed = parseSSEPacket(packet);
            if (!parsed || !parsed.dataText) {
              separatorIndex = buffer.indexOf("\n\n");
              continue;
            }

            if (parsed.dataText === "[DONE]") {
              separatorIndex = buffer.indexOf("\n\n");
              continue;
            }

            let payload: unknown = parsed.dataText;
            try {
              payload = JSON.parse(parsed.dataText) as GenUIStreamEvent;
            } catch {
              payload = { raw: parsed.dataText };
            }

            const eventName =
              isRecord(payload) && typeof payload.event === "string"
                ? payload.event
                : parsed.eventName;

            if (eventName === "turn-start" && isRecord(payload) && isRecord(payload.data)) {
              const traceId =
                typeof payload.data.traceId === "string"
                  ? payload.data.traceId
                  : randomId("trace");
              const streamConversationId =
                typeof payload.data.conversationId === "string"
                  ? payload.data.conversationId
                  : conversationId ?? randomId("conv");
              const turnId =
                typeof payload.data.turnId === "string"
                  ? payload.data.turnId
                  : randomId("turn");

              setConversationId(streamConversationId);
              applyEnvelope(
                createEmptyEnvelope({
                  traceId,
                  conversationId: streamConversationId,
                  turnId,
                }),
                true
              );
            }

            if (
              (eventName === "block-append" || eventName === "block-replace") &&
              isRecord(payload) &&
              isRecord(payload.data) &&
              isRecord(payload.data.block)
            ) {
              const block = payload.data.block as unknown as GenUIBlock;
              const mode = eventName === "block-replace" ? "replace" : "append";

              if (block.type === "text") {
                await typewriteTextBlock(block as GenUITextBlock, mode);
              } else {
                applyBlock(block, mode);
              }
            }

            if (eventName === "turn-status" && isRecord(payload) && isRecord(payload.data)) {
              const statusText =
                payload.data.status === "streaming" ||
                payload.data.status === "completed" ||
                payload.data.status === "error"
                  ? payload.data.status
                  : null;
              if (statusText) {
                const activeEnvelope = ensureEnvelope();
                applyEnvelope(
                  {
                    ...activeEnvelope,
                    turn: {
                      ...activeEnvelope.turn,
                      status: statusText,
                    },
                  },
                  true
                );
              }
            }

            if (eventName === "turn-complete" && isRecord(payload) && isRecord(payload.data)) {
              const completeEnvelope = payload.data as unknown as GenUITurnEnvelope;
              sawTurnComplete = true;
              setConversationId(completeEnvelope.conversationId);
              applyEnvelope(completeEnvelope, false);
            }

            if (eventName === "turn-error" && isRecord(payload) && isRecord(payload.data)) {
              const message =
                typeof payload.data.message === "string"
                  ? payload.data.message
                  : "生成失败，请稍后再试";
              throw new Error(message);
            }

            separatorIndex = buffer.indexOf("\n\n");
          }
        }

        if (!sawTurnComplete && currentEnvelope) {
          const envelope = currentEnvelope as GenUITurnEnvelope;
          const completedEnvelope: GenUITurnEnvelope = {
            traceId: envelope.traceId,
            conversationId: envelope.conversationId,
            turn: {
              ...envelope.turn,
              status: "completed",
            },
          };
          applyEnvelope(completedEnvelope, false);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "请求失败，请稍后再试";

        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId
              ? {
                  id: assistantMessageId,
                  role: "assistant",
                  pending: false,
                  error: errorMessage,
                }
              : message
          )
        );
      } finally {
        setStatus("ready");
      }
    },
    [conversationId, isSending]
  );

  const handleSubmit = useCallback(
    async ({ text }: { text: string }) => {
      const value = text.trim();
      if (!value || isSending) {
        return;
      }

      setInput("");
      await sendTurn(
        {
          type: "text",
          text: value,
        },
        value
      );
    },
    [isSending, sendTurn]
  );

  const handleActionSelect = useCallback(
    async (option: ActionOption) => {
      if (isSending) {
        return;
      }

      await sendTurn(
        {
          type: "action",
          action: option.action,
          actionId: randomId("action"),
          params: option.params,
          displayText: option.label,
        },
        option.label
      );
    },
    [isSending, sendTurn]
  );

  const latestAssistantTurn = useMemo(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find(
        (message): message is AssistantRecord =>
          message.role === "assistant" && Boolean(message.turn)
      );

    return lastAssistant?.turn;
  }, [messages]);

  const bottomQuickActions = useMemo(() => {
    const actionBlock = latestAssistantTurn?.turn.blocks.find(
      (block): block is GenUICtaGroupBlock => block.type === "cta-group"
    );

    if (actionBlock?.items?.length) {
      return actionBlock.items.slice(0, 5).map((item, index) => ({
        id: `cta-${index}-${item.action}`,
        label: item.label,
        option: item,
      }));
    }

    return welcomeUi.bottomQuickActions.map((label) => ({
      id: `default-${label}`,
      label,
      prompt: label,
    }));
  }, [latestAssistantTurn, welcomeUi.bottomQuickActions]);

  const handleBottomAction = useCallback(
    async (action: { label: string; option?: ActionOption; prompt?: string }) => {
      if (isSending) {
        return;
      }

      if (action.option) {
        await handleActionSelect(action.option);
        return;
      }

      const fallbackPrompt = action.prompt || action.label;
      await sendTurn(
        {
          type: "text",
          text: fallbackPrompt,
        },
        fallbackPrompt
      );
    },
    [handleActionSelect, isSending, sendTurn]
  );

  return (
    <div
      className={cn(
        "relative min-h-screen overflow-hidden [font-family:SF_Pro_Display,SF_Pro_Text,PingFang_SC,-apple-system,BlinkMacSystemFont,Segoe_UI,sans-serif]",
        isDarkMode
          ? "bg-[linear-gradient(180deg,#0f142e_0%,#111736_45%,#11182f_100%)]"
          : "bg-[linear-gradient(180deg,#ebeefb_0%,#edf0fb_45%,#f2f4ff_100%)]"
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          isDarkMode
            ? "bg-[radial-gradient(circle_at_22%_-8%,rgba(88,112,255,0.22)_0%,rgba(27,35,84,0.18)_50%,rgba(16,20,46,0)_72%)]"
            : "bg-[radial-gradient(circle_at_22%_-8%,rgba(102,120,255,0.24)_0%,rgba(188,198,255,0.09)_48%,rgba(235,238,251,0)_72%)]"
        )}
      />

      <div className={cn("relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col", isDarkMode ? "text-slate-100" : "text-slate-900")}>
        <header className="flex shrink-0 items-center justify-between px-3 pb-2 pt-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full",
                isDarkMode ? "text-[#dde2ff]" : "text-[#1d2151]"
              )}
            >
              <Menu className="h-5 w-5" />
            </button>
            <p className={cn("text-[18px] font-semibold tracking-tight", isDarkMode ? "text-[#f0f3ff]" : "text-[#111633]")}>聚场</p>
          </div>

          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium shadow-[0_8px_18px_-14px_rgba(66,85,164,0.7)]",
                    isDarkMode
                      ? "border border-[#3a4589]/70 bg-[#1b234f]/85 text-[#f0f3ff]"
                      : "border border-white/60 bg-white/88 text-[#111633]"
                  )}
                >
                  <QrCode className="h-4 w-4" />
                  群二维码
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className={cn(
                  "w-[232px] rounded-2xl border p-3",
                  isDarkMode
                    ? "border-[#3a4589] bg-[#141d42] text-[#e6eaff]"
                    : "border-[#dfe4ff] bg-white text-[#1f275c]"
                )}
              >
                <p className="text-sm font-semibold">社群二维码</p>
                <p className={cn("mt-1 text-xs", isDarkMode ? "text-[#b8c0f4]" : "text-slate-500")}>
                  扫码加入聚场交流群
                </p>
                <div
                  className={cn(
                    "mt-2 rounded-xl border p-2",
                    isDarkMode ? "border-[#2f3979] bg-[#0f1533]" : "border-[#e7ebff] bg-[#f8f9ff]"
                  )}
                >
                  <img
                    src={GROUP_QR_IMAGE_URL}
                    alt="聚场群二维码"
                    className="h-[180px] w-[180px] rounded-md bg-white object-cover"
                  />
                </div>
              </PopoverContent>
            </Popover>

            <div
              className={cn(
                "inline-flex h-9 items-center rounded-full px-1 shadow-[0_8px_18px_-14px_rgba(66,85,164,0.7)]",
                isDarkMode
                  ? "border border-[#3a4589]/70 bg-[#1b234f]/85 text-[#e6eaff]"
                  : "border border-white/60 bg-white/88 text-[#22274d]"
              )}
            >
              <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-full">
                <Volume2 className="h-4 w-4" />
              </button>
              <div className={cn("mx-1 h-4 w-px", isDarkMode ? "bg-[#425095]" : "bg-slate-200")} />
              <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-full">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <Conversation className="relative">
          <ConversationContent className="w-full gap-4 px-3 pb-4 pt-1">
            {messages.length === 0 ? (
              <ConversationEmptyState className="justify-start px-1 pt-2">
                <div className="w-full space-y-3">
                  <div className="flex items-start justify-between px-2">
                    <div className="space-y-1 text-left">
                      <p className={cn("text-[28px] font-bold leading-none", isDarkMode ? "text-[#e6eaff]" : "text-[#272f8b]")}>{welcomeGreeting}</p>
                      <p className={cn("text-[28px] font-bold leading-none", isDarkMode ? "text-[#e6eaff]" : "text-[#272f8b]")}>{welcomeSubGreeting}</p>
                    </div>
                    <div className={cn("mt-1 flex items-start justify-end pb-1", isDarkMode ? "text-[#8e9cff]" : "text-[#5b67f4]")}>
                      <Sparkles className="h-8 w-8" />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-[28px] border border-white/65 bg-white/30 p-3 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.72),inset_0_-14px_30px_rgba(109,126,255,0.08),0_22px_34px_-30px_rgba(60,75,156,0.6)]">
                    <div className="rounded-2xl border border-white/70 bg-white/58 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]">
                      <div className="mb-2 flex items-center gap-2 text-[#2b3168]">
                        <span className="h-4 w-1 rounded-full bg-[linear-gradient(180deg,#6d78ff_0%,#8b8eff_100%)]" />
                        <span className="text-[16px] font-semibold">我的社交状态</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl bg-white/76 px-2 py-2 text-center text-[#2f3870]">
                          <p className="text-[11px] text-slate-500">参与</p>
                          <p className="text-[16px] font-semibold">{welcomeProfile?.participationCount ?? 0}<span className="ml-0.5 text-[11px] font-normal">场</span></p>
                        </div>
                        <div className="rounded-xl bg-white/76 px-2 py-2 text-center text-[#2f3870]">
                          <p className="text-[11px] text-slate-500">发起</p>
                          <p className="text-[16px] font-semibold">{welcomeProfile?.activitiesCreatedCount ?? 0}<span className="ml-0.5 text-[11px] font-normal">场</span></p>
                        </div>
                        <div className="rounded-xl bg-white/76 px-2 py-2 text-center text-[#2f3870]">
                          <p className="text-[11px] text-slate-500">偏好完善</p>
                          <p className="text-[16px] font-semibold">{welcomeProfile?.preferenceCompleteness ?? 0}<span className="ml-0.5 text-[11px] font-normal">%</span></p>
                        </div>
                      </div>
                      <p className="mt-2 text-[12px] text-[#616c9f]">
                        {getProfileHint(
                          welcomeProfile?.preferenceCompleteness ?? 0,
                          welcomeUi.profileHints
                        )}
                      </p>
                    </div>

                    <div className="space-y-2">
                      {quickPrompts.slice(0, 3).map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => {
                            void sendTurn(
                              {
                                type: "text",
                                text: prompt,
                              },
                              prompt
                            );
                          }}
                          className="flex w-full items-start gap-2 rounded-2xl bg-white/86 px-3 py-2.5 text-left text-[14px] text-[#2a315e] shadow-[0_12px_24px_-20px_rgba(67,86,170,0.52)]"
                        >
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[linear-gradient(140deg,#4e5dff_0%,#8658f8_100%)] text-[12px] font-semibold text-white">
                            #
                          </span>
                          <span className="flex-1 break-words pr-2 leading-5">{prompt}</span>
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </ConversationEmptyState>
            ) : (
              messages.map((message, index) => {
                if (message.role === "user") {
                  return <UserMessage key={message.id} text={message.text} />;
                }

                return (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    isLast={index === messages.length - 1}
                    disabled={isSending}
                    onActionSelect={handleActionSelect}
                  />
                );
              })
            )}
          </ConversationContent>
        </Conversation>

        <div
          className={cn(
            "shrink-0 px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-2",
            isDarkMode
              ? "border-t border-[#394480]/75 bg-[linear-gradient(180deg,rgba(17,24,55,0.92)_0%,rgba(15,21,48,0.96)_100%)]"
              : "border-t border-white/65 bg-[linear-gradient(180deg,rgba(245,247,255,0.92)_0%,rgba(238,241,254,0.96)_100%)]"
          )}
        >
          <div className="mb-2 overflow-x-auto">
            <Suggestions className="flex w-max gap-2 pr-1">
              {bottomQuickActions.map((action) => (
                <Suggestion
                  key={action.id}
                  suggestion={action.label}
                  onClick={() => {
                    void handleBottomAction(action);
                  }}
                  disabled={isSending}
                  className="h-8 rounded-full border border-white/60 bg-white/88 px-3 text-xs text-[#20264f] shadow-[0_8px_16px_-14px_rgba(68,83,166,0.6)] hover:bg-white"
                />
              ))}
            </Suggestions>
          </div>

          <PromptInput
            onSubmit={handleSubmit}
            className={cn(
              "rounded-3xl border border-transparent bg-transparent p-0 has-[[data-slot=input-group-control]:focus-visible]:!ring-0 has-[[data-slot=input-group-control]:focus-visible]:!border-transparent [&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:rounded-[20px] [&_[data-slot=input-group]]:!border-transparent [&_[data-slot=input-group]]:px-2 [&_[data-slot=input-group]]:py-1.5 [&_[data-slot=input-group]]:shadow-[0_14px_24px_-18px_rgba(66,84,156,0.52)] [&_[data-slot=input-group]]:focus-within:!ring-0 [&_[data-slot=input-group]]:focus-within:!border-transparent",
              isDarkMode ? "[&_[data-slot=input-group]]:bg-[#1b244f]" : "[&_[data-slot=input-group]]:bg-white"
            )}
          >
            <PromptInputTextarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onFocus={() => setIsComposerFocused(true)}
              onBlur={() => setIsComposerFocused(false)}
              rows={isComposerFocused ? 2 : 1}
              placeholder="发消息或按住说话..."
              disabled={isSending}
              className={cn(
                "max-h-[116px] flex-1 border-none bg-transparent px-2 py-2 text-[16px] leading-6 focus-visible:ring-0 focus-visible:outline-none",
                isComposerFocused ? "" : "overflow-hidden",
                isDarkMode ? "text-[#e9edff] placeholder:text-[#808bc1]" : "text-[#252c5b] placeholder:text-slate-400"
              )}
            />

            <PromptInputFooter
              align={isComposerFocused ? "block-end" : "inline-end"}
              className={cn("items-center", isComposerFocused ? "" : "pr-1")}
            >
              <PromptInputTools className="gap-1">
                <PromptInputButton
                  className="h-9 w-9 rounded-full border border-[#e6e9f9] bg-white text-[#1d2451] hover:bg-[#f4f6ff]"
                >
                  <Mic className="h-4 w-4" />
                </PromptInputButton>
              </PromptInputTools>

              <div className="flex items-center gap-2">
                <PromptInputSubmit
                  status={isSending ? "submitted" : "ready"}
                  disabled={isSending}
                  className="h-9 w-9 rounded-full border border-[#e6e9f9] bg-white text-[#1d2451] hover:bg-[#f4f6ff] disabled:opacity-40"
                >
                  {input.trim() ? <ArrowUp className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </PromptInputSubmit>

                <PromptInputButton
                  className="h-9 w-9 rounded-full border border-[#e6e9f9] bg-white text-[#1d2451] hover:bg-[#f4f6ff]"
                >
                  <Camera className="h-4 w-4" />
                </PromptInputButton>
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <Message from="user" className="max-w-[82%]">
      <MessageContent className="rounded-[18px] rounded-tr-[8px] bg-[linear-gradient(135deg,#6271ff_0%,#5766f9_46%,#4f59e4_100%)] px-4 py-3 text-white shadow-[0_14px_26px_-16px_rgba(81,99,230,0.72)]">
        <MessageResponse className="text-[15px] leading-6 text-white">{text}</MessageResponse>
      </MessageContent>
    </Message>
  );
}

function AssistantMessage({
  message,
  isLast,
  disabled,
  onActionSelect,
}: {
  message: Extract<ChatRecord, { role: "assistant" }>;
  isLast: boolean;
  disabled: boolean;
  onActionSelect: (option: ActionOption) => Promise<void>;
}) {
  return (
    <Message from="assistant" className="max-w-full pr-1">
      <MessageContent className="w-full rounded-[20px] bg-white px-4 py-3 text-slate-800 shadow-[0_16px_30px_-24px_rgba(83,105,152,0.52)]">
        {message.pending && isLast ? (
          <ThinkingDots />
        ) : message.error ? (
          <p className="text-sm text-rose-600">{message.error}</p>
        ) : message.turn ? (
          <div className="space-y-3">
            {message.turn.turn.blocks.map((block) => (
              <TurnBlockRenderer
                key={block.blockId}
                block={block}
                disabled={disabled}
                onActionSelect={onActionSelect}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">这条消息暂时没有可展示内容</p>
        )}
      </MessageContent>
    </Message>
  );
}

function TurnBlockRenderer({
  block,
  disabled,
  onActionSelect,
}: {
  block: GenUIBlock;
  disabled: boolean;
  onActionSelect: (option: ActionOption) => Promise<void>;
}) {
  if (block.type === "text") {
    return (
      <MessageResponse className="text-[15px] leading-7 text-slate-800">
        {block.content}
      </MessageResponse>
    );
  }

  if (block.type === "choice") {
    return (
      <ChoiceBlockCard
        block={block}
        disabled={disabled}
        onActionSelect={onActionSelect}
      />
    );
  }

  if (block.type === "entity-card") {
    if (isShareEntityCard(block)) {
      return <ShareEntityCardBlock block={block} />;
    }

    return <EntityCardBlock block={block} />;
  }

  if (block.type === "list") {
    return <ListBlockCard block={block} />;
  }

  if (block.type === "form") {
    return <FormBlockCard block={block} />;
  }

  if (block.type === "cta-group") {
    return (
      <CtaGroupBlockCard
        block={block}
        disabled={disabled}
        onActionSelect={onActionSelect}
      />
    );
  }

  if (block.type === "alert") {
    return <AlertBlockCard block={block} />;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-500">
      block 已返回，下一阶段接入专用渲染组件。
    </div>
  );
}

function ChoiceBlockCard({
  block,
  disabled,
  onActionSelect,
}: {
  block: GenUIChoiceBlock;
  disabled: boolean;
  onActionSelect: (option: ActionOption) => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/85 p-3">
      <p className="text-sm font-medium text-slate-700">{block.question}</p>
      <Suggestions className="mt-2 gap-2">
        {block.options.map((option, index) => (
          <Suggestion
            key={`${option.label}-${index}`}
            suggestion={option.label}
            onClick={() => {
              void onActionSelect(option);
            }}
            disabled={disabled}
            className="h-8 border-transparent bg-sky-50 px-3 text-xs text-sky-700 hover:bg-sky-100 disabled:opacity-45"
          />
        ))}
      </Suggestions>
    </div>
  );
}

function readStringField(
  fields: Record<string, unknown>,
  key: string,
  fallback = ""
): string {
  const value = fields[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

function readNumberField(
  fields: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const value = fields[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function isShareEntityCard(block: GenUIEntityCardBlock): boolean {
  const fields =
    typeof block.fields === "object" && block.fields !== null
      ? (block.fields as Record<string, unknown>)
      : {};
  const activityId = readStringField(fields, "activityId");
  const hasShareData =
    readStringField(fields, "shareTitle") ||
    readStringField(fields, "shareUrl") ||
    readStringField(fields, "sharePath");

  return (
    block.dedupeKey === "published_activity" ||
    block.dedupeKey === "share_payload" ||
    (!!activityId && !activityId.startsWith("draft_") && !!hasShareData)
  );
}

function ShareEntityCardBlock({ block }: { block: GenUIEntityCardBlock }) {
  const fields =
    typeof block.fields === "object" && block.fields !== null
      ? (block.fields as Record<string, unknown>)
      : {};

  const activityId = readStringField(fields, "activityId", "activity_unknown");
  const title = readStringField(fields, "title", "周五活动局");
  const locationName = readStringField(fields, "locationName", "待定地点");
  const startAt = renderFieldValue(fields.startAt);
  const maxParticipants = readNumberField(fields, "maxParticipants", 6);
  const currentParticipants = readNumberField(fields, "currentParticipants", 1);
  const remaining = Math.max(maxParticipants - currentParticipants, 0);
  const shareTitle =
    readStringField(fields, "shareTitle") ||
    `🔥 ${title}，还差${remaining}人，速来！`;
  const shareUrl = readStringField(fields, "shareUrl");
  const sharePath = readStringField(fields, "sharePath");

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const copySharePayload = useCallback(async () => {
    if (!shareUrl || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopyStatus("failed");
      return;
    }

    const copyText = [shareTitle, shareUrl, sharePath ? `小程序路径：${sharePath}` : ""]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(copyText);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1200);
    } catch {
      setCopyStatus("failed");
      window.setTimeout(() => setCopyStatus("idle"), 1500);
    }
  }, [sharePath, shareTitle, shareUrl]);

  return (
    <div className="rounded-xl border border-sky-100 bg-[linear-gradient(180deg,#ffffff_0%,#f2f7ff_100%)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">{block.title || "分享卡片"}</p>
        <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-slate-500">
          ID: {activityId}
        </span>
      </div>
      <p className="text-sm text-slate-800">{shareTitle}</p>
      <p className="mt-1 text-xs text-slate-500">
        {locationName} · {startAt}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        已有 {currentParticipants}/{maxParticipants} 人报名
      </p>

      {(shareUrl || sharePath) && (
        <div className="mt-3 space-y-1 rounded-lg bg-white/80 px-2 py-2">
          {shareUrl && (
            <p className="break-all text-[11px] text-slate-600">H5: {shareUrl}</p>
          )}
          {sharePath && (
            <p className="break-all text-[11px] text-slate-600">Mini: {sharePath}</p>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            void copySharePayload();
          }}
          className="rounded-full bg-sky-500 px-3 py-1.5 text-xs text-white hover:bg-sky-600"
        >
          {copyStatus === "copied"
            ? "已复制"
            : copyStatus === "failed"
              ? "复制失败"
              : "复制文案"}
        </button>
        {shareUrl && (
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            打开邀请页
          </a>
        )}
      </div>
    </div>
  );
}

function EntityCardBlock({ block }: { block: GenUIEntityCardBlock }) {
  const entries = Object.entries(block.fields || {});

  return (
    <div className="rounded-xl border border-slate-200 bg-white/85 p-3">
      <p className="text-sm font-semibold text-slate-800">{block.title}</p>
      <div className="mt-2 space-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3 text-xs">
            <span className="text-slate-500">{prettyFieldLabel(key)}</span>
            <span className="text-right text-slate-700">{renderFieldValue(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListBlockCard({ block }: { block: GenUIListBlock }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/85 p-3">
      {block.title && <p className="text-sm font-semibold text-slate-800">{block.title}</p>}
      <div className="mt-2 space-y-2">
        {block.items.map((item, index) => (
          <div
            key={String(item.id ?? index)}
            className="rounded-lg bg-slate-50/90 px-3 py-2"
          >
            <p className="text-sm font-medium text-slate-800">
              {String(item.title ?? `活动 ${index + 1}`)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {String(item.locationName ?? "附近")} ·{" "}
              {formatDistance(item.distance)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormBlockCard({ block }: { block: GenUIFormBlock }) {
  const initial = block.initialValues || {};

  return (
    <div className="rounded-xl border border-slate-200 bg-white/85 p-3">
      <p className="text-sm font-semibold text-slate-800">{block.title || "参数设置"}</p>
      <div className="mt-2 space-y-2">
        {Object.entries(initial).map(([key, value]) => (
          <div key={key} className="rounded-lg bg-slate-50/90 px-3 py-2">
            <p className="text-[11px] text-slate-500">{prettyFieldLabel(key)}</p>
            <p className="text-sm text-slate-800">{renderFieldValue(value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CtaGroupBlockCard({
  block,
  disabled,
  onActionSelect,
}: {
  block: GenUICtaGroupBlock;
  disabled: boolean;
  onActionSelect: (option: ActionOption) => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/85 p-3">
      <p className="text-xs text-slate-500">接下来你可以：</p>
      <Suggestions className="mt-2 gap-2">
        {block.items.map((item, index) => (
          <Suggestion
            key={`${item.label}-${index}`}
            suggestion={item.label}
            onClick={() => {
              void onActionSelect(item);
            }}
            disabled={disabled}
            className="h-8 border-transparent bg-slate-100 px-3 text-xs text-slate-700 hover:bg-slate-200 disabled:opacity-45"
          />
        ))}
      </Suggestions>
    </div>
  );
}

function AlertBlockCard({ block }: { block: GenUIAlertBlock }) {
  const alertStyleMap: Record<
    GenUIAlertBlock["level"],
    { className: string; label: string }
  > = {
    info: {
      className: "border-sky-200 bg-sky-50 text-sky-800",
      label: "提示",
    },
    warning: {
      className: "border-amber-200 bg-amber-50 text-amber-800",
      label: "注意",
    },
    error: {
      className: "border-rose-200 bg-rose-50 text-rose-700",
      label: "异常",
    },
    success: {
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      label: "成功",
    },
  };

  const style = alertStyleMap[block.level];

  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${style.className}`}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide">{style.label}</p>
      <p>{block.message}</p>
    </div>
  );
}

function prettyFieldLabel(key: string): string {
  const map: Record<string, string> = {
    activityId: "活动 ID",
    title: "标题",
    type: "类型",
    startAt: "时间",
    locationName: "地点",
    locationHint: "位置说明",
    maxParticipants: "人数上限",
    currentParticipants: "当前人数",
    lat: "纬度",
    lng: "经度",
    slot: "时段",
    max_participants: "人数上限",
  };

  return map[key] || key;
}

function renderFieldValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(5);
  }

  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    }

    return value;
  }

  if (value === null || value === undefined) {
    return "-";
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }

  return JSON.stringify(value);
}

function formatDistance(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  if (value < 1000) {
    return `${Math.round(value)}m`;
  }

  return `${(value / 1000).toFixed(1)}km`;
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500"
          style={{ animationDelay: `${index * 0.12}s` }}
        />
      ))}
    </div>
  );
}

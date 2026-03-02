"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  ChevronRight,
  MapPin,
  Menu,
  Paperclip,
  Square,
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmpty,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { ToolInvocationCard } from "@/components/ai-elements/tool-invocation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";
const HOT_KEYWORD_LIMIT = 6;

interface WelcomeQuickItem {
  type: "draft" | "suggestion" | "explore";
  label: string;
  prompt: string;
  icon?: string;
}

interface WelcomeSection {
  id: string;
  icon: string;
  title: string;
  items: WelcomeQuickItem[];
}

interface SocialProfile {
  participationCount: number;
  activitiesCreatedCount: number;
  preferenceCompleteness: number;
}

interface QuickPrompt {
  icon: string;
  text: string;
  prompt: string;
}

interface WelcomeResponse {
  greeting: string;
  subGreeting?: string;
  sections: WelcomeSection[];
  socialProfile?: SocialProfile;
  quickPrompts: QuickPrompt[];
}

interface HotKeywordItem {
  id: string;
  keyword: string;
}

interface PromptChip {
  id: string;
  text: string;
  prompt: string;
}

const FALLBACK_WELCOME: WelcomeResponse = {
  greeting: "我是小聚，你的 AI 活动助理",
  subGreeting: "想约点什么？",
  sections: [
    {
      id: "suggestions",
      icon: "",
      title: "快速组局",
      items: [
        { type: "suggestion", label: "约饭局", prompt: "帮我组一个吃饭的局" },
        { type: "suggestion", label: "找运动搭子", prompt: "帮我找个运动搭子" },
        { type: "suggestion", label: "周末活动", prompt: "周末附近有什么活动" },
        { type: "suggestion", label: "组周五晚局", prompt: "想组个周五晚的局" },
      ],
    },
  ],
  quickPrompts: [
    { icon: "", text: "周末附近有什么活动？", prompt: "周末附近有什么活动" },
    { icon: "", text: "帮我找个运动搭子", prompt: "帮我找个运动搭子" },
    { icon: "", text: "想组个周五晚的局", prompt: "想组个周五晚的局" },
  ],
};

export default function ChatPage() {
  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    regenerate,
    setMessages,
  } = useChat({
    transport: new DefaultChatTransport({
      api: `${API_BASE}/ai/chat`,
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: { source: "miniprogram" },
    }),
  });

  const [input, setInput] = useState("");
  const [welcomeData, setWelcomeData] = useState<WelcomeResponse>(FALLBACK_WELCOME);
  const [hotKeywords, setHotKeywords] = useState<HotKeywordItem[]>([]);
  const [isWelcomeLoading, setIsWelcomeLoading] = useState(true);
  const [showTopMenu, setShowTopMenu] = useState(false);

  const isLoading = status === "submitted" || status === "streaming";
  const hasInput = input.length > 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  const resetChat = useCallback(() => {
    setMessages([]);
    setInput("");
  }, [setMessages]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  const loadWelcomeAndKeywords = useCallback(async (signal?: AbortSignal) => {
    setIsWelcomeLoading(true);

    const [welcomeResult, hotKeywordsResult] = await Promise.allSettled([
      fetchWelcome(signal),
      fetchHotKeywords(signal),
    ]);

    if (signal?.aborted) {
      return;
    }

    if (welcomeResult.status === "fulfilled") {
      setWelcomeData(welcomeResult.value);
    } else {
      setWelcomeData(FALLBACK_WELCOME);
    }

    if (hotKeywordsResult.status === "fulfilled") {
      setHotKeywords(hotKeywordsResult.value);
    } else {
      setHotKeywords([]);
    }

    setIsWelcomeLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadWelcomeAndKeywords(controller.signal);
    return () => controller.abort();
  }, [loadWelcomeAndKeywords]);

  useEffect(() => {
    if (!showTopMenu) return;

    const closeMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-top-menu]")) return;
      if (target.closest("[data-top-menu-trigger]")) return;
      setShowTopMenu(false);
    };

    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [showTopMenu]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;

      const text = input.trim();
      setInput("");
      await sendMessage({ text });
    },
    [input, isLoading, sendMessage]
  );

  const handlePromptSend = useCallback(
    async (text: string) => {
      if (isLoading || !text.trim()) return;
      await sendMessage({ text: text.trim() });
    },
    [isLoading, sendMessage]
  );

  const promptChips = useMemo(() => {
    const pool: PromptChip[] = [];
    const deduped: PromptChip[] = [];
    const visibleWelcomePromptKeys = new Set(
      getVisibleWelcomePrompts(welcomeData).map((item) => normalizePromptKey(item))
    );
    const seen = new Set<string>();

    hotKeywords.forEach((item) => {
      const keyword = item.keyword.trim();
      if (!keyword) return;
      pool.push({ id: `hot-${item.id}`, text: keyword, prompt: keyword });
    });

    if (messages.length > 0) {
      welcomeData.sections.forEach((section, sectionIndex) => {
        section.items.forEach((item, itemIndex) => {
          const text = item.label?.trim();
          const prompt = item.prompt?.trim();
          if (!text || !prompt) return;
          pool.push({
            id: `welcome-section-${sectionIndex}-${itemIndex}`,
            text,
            prompt,
          });
        });
      });

      welcomeData.quickPrompts.forEach((item, index) => {
        const text = item.text?.trim();
        const prompt = item.prompt?.trim() || text;
        if (!text || !prompt) return;
        pool.push({ id: `welcome-quick-${index}`, text, prompt });
      });
    }

    for (const item of pool) {
      const key = normalizePromptKey(item.prompt);
      if (seen.has(key)) continue;
      if (visibleWelcomePromptKeys.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= 8) break;
    }

    return deduped;
  }, [hotKeywords, messages.length, welcomeData]);

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col border-x border-zinc-200 bg-zinc-50">
      <header className="relative shrink-0 border-b border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur-sm">
        <div className="mx-auto grid max-w-2xl grid-cols-[32px_1fr_32px] items-center">
          <button
            onClick={() => setShowTopMenu((prev) => !prev)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="菜单"
            data-top-menu-trigger
          >
            <Menu className="h-4 w-4" />
          </button>

          <h1 className="text-center text-sm font-semibold tracking-[0.04em] text-zinc-900">
            聚场
          </h1>

          <div className="h-8 w-8" />
        </div>

        {showTopMenu && (
          <div
            data-top-menu
            className="absolute left-4 top-11 z-20 w-40 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg"
          >
            <button
              onClick={() => {
                setShowTopMenu(false);
                resetChat();
              }}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            >
              新对话
            </button>
          </div>
        )}
      </header>

      <Conversation ref={scrollRef}>
        <ConversationContent className="mx-auto max-w-2xl">
          {messages.length === 0 ? (
            <WelcomeScreen
              data={welcomeData}
              loading={isWelcomeLoading}
              onQuickPrompt={handlePromptSend}
            />
          ) : (
            <>
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isLast={index === messages.length - 1}
                  isLoading={isLoading}
                />
              ))}

              {isLoading && !hasContent(messages) && <ThinkingIndicator />}
              {error && <ErrorMessage error={error} onRetry={() => void regenerate()} />}
            </>
          )}
        </ConversationContent>
      </Conversation>

      <div className="shrink-0 border-t border-zinc-200 bg-white p-4">
        <div className="mx-auto max-w-2xl">
          {promptChips.length > 0 && (
            <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {promptChips.map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => void handlePromptSend(chip.prompt)}
                  disabled={isLoading}
                  className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 transition-all hover:border-zinc-400 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {chip.text}
                </button>
              ))}
            </div>
          )}

          <PromptInput
            onSubmit={onSubmit}
            className={hasInput ? "flex-col items-stretch gap-2" : "gap-2"}
          >
            {hasInput ? (
              <>
                <PromptInputTextarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="想找点乐子？跟我说说..."
                  disabled={isLoading}
                  className="max-h-[120px] flex-1 overflow-y-auto"
                />
                <div className="flex items-center justify-between px-1 pb-0.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-600"
                      aria-label="位置工具"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      位置
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-xs text-zinc-600"
                      aria-label="附件工具"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      附件
                    </button>
                  </div>
                  {isLoading ? (
                    <PromptInputSubmit isLoading onClick={() => void stop()}>
                      <Square className="h-4 w-4 fill-current" />
                    </PromptInputSubmit>
                  ) : (
                    <PromptInputSubmit disabled={!input.trim()}>
                      <ArrowUp className="h-4 w-4" />
                    </PromptInputSubmit>
                  )}
                </div>
              </>
            ) : (
              <>
                <PromptInputTextarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="想找点乐子？跟我说说..."
                  disabled={isLoading}
                  className="flex-1"
                />
                {isLoading ? (
                  <PromptInputSubmit isLoading onClick={() => void stop()}>
                    <Square className="h-4 w-4 fill-current" />
                  </PromptInputSubmit>
                ) : (
                  <PromptInputSubmit disabled={!input.trim()}>
                    <ArrowUp className="h-4 w-4" />
                  </PromptInputSubmit>
                )}
              </>
            )}
          </PromptInput>
        </div>
      </div>
      </div>
    </div>
  );
}

function ChatMessage({
  message,
  isLast,
  isLoading,
}: {
  message: any;
  isLast: boolean;
  isLoading: boolean;
}) {
  const [showReasoning, setShowReasoning] = useState(false);
  const isUser = message.role === "user";
  const textContent = getMessageText(message);
  const reasoningContent = getReasoningText(message);
  const isStreaming = isLast && isLoading && !textContent;
  const toolInvocations = getToolInvocations(message);

  if (isUser) {
    return (
      <Message role="user">
        <MessageContent role="user">{textContent}</MessageContent>
        <MessageFooter>{formatTime(message.createdAt)}</MessageFooter>
      </Message>
    );
  }

  return (
    <Message role="assistant">
      <MessageAvatar fallback="聚" />
      <div className="flex flex-col gap-1">
        {reasoningContent && (
          <Reasoning>
            <ReasoningTrigger
              isOpen={showReasoning}
              onClick={() => setShowReasoning(!showReasoning)}
            />
            <ReasoningContent isOpen={showReasoning}>{reasoningContent}</ReasoningContent>
          </Reasoning>
        )}

        <MessageContent role="assistant">
          {isStreaming ? <StreamingDots /> : textContent}
        </MessageContent>

        {toolInvocations.length > 0 && (
          <div className="mt-1 space-y-2">
            {toolInvocations.map((invocation) => (
              <ToolInvocationCard key={invocation.toolCallId} toolInvocation={invocation} />
            ))}
          </div>
        )}

        <MessageFooter>{formatTime(message.createdAt)}</MessageFooter>
      </div>
    </Message>
  );
}

function WelcomeScreen({
  data,
  loading,
  onQuickPrompt,
}: {
  data: WelcomeResponse;
  loading: boolean;
  onQuickPrompt: (text: string) => void;
}) {
  const quickPrompts = data.quickPrompts.filter(
    (item) => item.text.trim() && (item.prompt || item.text).trim()
  );
  const sectionItems = getSectionPromptItems(data);

  return (
    <ConversationEmpty>
      <h2 className="mb-2 text-center text-xl font-semibold text-zinc-900">
        {data.greeting}
      </h2>

      <p className="mb-6 text-center text-sm text-zinc-500">
        {data.subGreeting || "想约点什么？"}
      </p>

      {quickPrompts.length > 0 ? (
        <div className="w-full max-w-sm space-y-2">
          {quickPrompts.slice(0, 4).map((item, index) => (
            <button
              key={`${item.text}-${index}`}
              onClick={() => onQuickPrompt(item.prompt || item.text)}
              className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left transition-all hover:border-zinc-400 hover:bg-zinc-50"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-500">{item.icon || "•"}</span>
                <span className="text-sm text-zinc-800">{item.text}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-400" />
            </button>
          ))}
        </div>
      ) : (
        <div className="grid w-full max-w-sm grid-cols-2 gap-3">
          {sectionItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onQuickPrompt(item.prompt)}
              className="group flex min-h-24 flex-col items-start justify-between rounded-xl border border-zinc-200 bg-white p-3 text-left transition-all hover:border-zinc-500 hover:bg-zinc-50 active:scale-[0.99]"
            >
              <span className="text-[11px] text-zinc-500">{item.label}</span>
              <span className="text-xs leading-relaxed text-zinc-700">{item.text}</span>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="mt-4 text-xs text-zinc-400 animate-pulse">正在同步欢迎内容...</div>
      )}
    </ConversationEmpty>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 py-2 pl-11">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800">
        <Bot className="h-4 w-4 text-white" />
      </div>
      <div className="flex items-center gap-2 rounded-2xl bg-zinc-100 px-4 py-2.5">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 animate-pulse rounded-full bg-zinc-500"
              style={{ animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </div>
        <span className="text-xs text-zinc-500">思考中...</span>
      </div>
    </div>
  );
}

function StreamingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  );
}

function ErrorMessage({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div className="flex justify-center py-4">
      <div className="rounded-lg border border-zinc-300 bg-zinc-100 px-4 py-2 text-sm text-zinc-700">
        出错了：{error.message || "请重试"}
        <button onClick={onRetry} className="ml-2 underline hover:no-underline">
          重试
        </button>
      </div>
    </div>
  );
}

function hasContent(messages: any[]): boolean {
  const lastMessage = messages[messages.length - 1];
  return lastMessage?.role === "assistant" && !!getMessageText(lastMessage);
}

function formatTime(date?: Date | string): string {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function getMessageText(message: any): string {
  if (Array.isArray(message?.parts)) {
    return message.parts
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("");
  }

  return typeof message?.content === "string" ? message.content : "";
}

function getReasoningText(message: any): string {
  if (Array.isArray(message?.parts)) {
    return message.parts
      .filter((part: any) => part?.type === "reasoning" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n");
  }

  return typeof message?.reasoning === "string" ? message.reasoning : "";
}

function getToolInvocations(message: any): Array<{
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  state: "partial-call" | "call" | "result";
}> {
  if (Array.isArray(message?.toolInvocations)) {
    return message.toolInvocations;
  }

  if (!Array.isArray(message?.parts)) {
    return [];
  }

  return message.parts
    .map((part: any) => {
      const isStaticTool = typeof part?.type === "string" && part.type.startsWith("tool-");
      const isDynamicTool = part?.type === "dynamic-tool";

      if (!isStaticTool && !isDynamicTool) {
        return null;
      }

      const toolName = isDynamicTool ? part.toolName : String(part.type).slice(5);
      const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : "";
      const args =
        part.input && typeof part.input === "object" && !Array.isArray(part.input)
          ? (part.input as Record<string, unknown>)
          : {};

      const state =
        part.state === "input-streaming"
          ? "partial-call"
          : part.state === "input-available"
            ? "call"
            : "result";

      const result =
        part.state === "output-error"
          ? { error: part.errorText ?? "工具调用失败" }
          : part.output && typeof part.output === "object" && !Array.isArray(part.output)
            ? (part.output as Record<string, unknown>)
            : part.output !== undefined
              ? { value: part.output }
              : undefined;

      return {
        toolCallId,
        toolName,
        args,
        result,
        state,
      };
    })
    .filter(Boolean);
}

function getVisibleWelcomePrompts(data: WelcomeResponse): string[] {
  const quickPrompts = data.quickPrompts
    .map((item) => item.prompt?.trim() || item.text?.trim() || "")
    .filter(Boolean)
    .slice(0, 4);

  if (quickPrompts.length > 0) {
    return quickPrompts;
  }

  return getSectionPromptItems(data)
    .map((item) => item.prompt.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizePromptKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[?？!！。,.，、;；:：'"`~\-_/\\()[\]{}]/g, "");
}

function getSectionPromptItems(data: WelcomeResponse): Array<{
  id: string;
  label: string;
  text: string;
  prompt: string;
}> {
  const sectionItems = data.sections.flatMap((section, sectionIndex) =>
    section.items.map((item, itemIndex) => ({
      id: `section-${section.id}-${itemIndex}`,
      label: section.title || `推荐 ${sectionIndex + 1}`,
      text: item.label,
      prompt: item.prompt,
    }))
  );

  const fromSections = sectionItems
    .filter((item) => item.text.trim() && item.prompt.trim())
    .slice(0, 4);

  if (fromSections.length > 0) {
    return fromSections;
  }

  return data.quickPrompts
    .map((item, index) => ({
      id: `quick-${index}`,
      label: "推荐",
      text: item.text,
      prompt: item.prompt || item.text,
    }))
    .filter((item) => item.text.trim() && item.prompt.trim())
    .slice(0, 4);
}

async function fetchWelcome(signal?: AbortSignal): Promise<WelcomeResponse> {
  const response = await fetch(`${API_BASE}/ai/welcome`, {
    method: "GET",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`welcome request failed: ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  return normalizeWelcomeResponse(payload);
}

async function fetchHotKeywords(signal?: AbortSignal): Promise<HotKeywordItem[]> {
  const response = await fetch(`${API_BASE}/hot-keywords?limit=${HOT_KEYWORD_LIMIT}`, {
    method: "GET",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`hot keywords request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { items?: unknown[] };

  if (!Array.isArray(payload.items)) {
    return [];
  }

  return payload.items
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const keyword = typeof item.keyword === "string" ? item.keyword.trim() : "";
      if (!keyword) return null;
      const id = typeof item.id === "string" ? item.id : `keyword-${index}`;
      return { id, keyword };
    })
    .filter((item): item is HotKeywordItem => Boolean(item));
}

function normalizeWelcomeResponse(payload: unknown): WelcomeResponse {
  if (!isRecord(payload)) {
    return FALLBACK_WELCOME;
  }

  const sections = Array.isArray(payload.sections)
    ? payload.sections
        .map((section, sectionIndex) => normalizeSection(section, sectionIndex))
        .filter((section): section is WelcomeSection => Boolean(section))
    : [];

  const quickPrompts = Array.isArray(payload.quickPrompts)
    ? payload.quickPrompts
        .map((item, index) => normalizeQuickPrompt(item, index))
        .filter((item): item is QuickPrompt => Boolean(item))
    : [];

  const socialProfile = normalizeSocialProfile(payload.socialProfile);

  return {
    greeting:
      typeof payload.greeting === "string" && payload.greeting.trim()
        ? payload.greeting
        : FALLBACK_WELCOME.greeting,
    subGreeting:
      typeof payload.subGreeting === "string" && payload.subGreeting.trim()
        ? payload.subGreeting
        : FALLBACK_WELCOME.subGreeting,
    sections: sections.length > 0 ? sections : FALLBACK_WELCOME.sections,
    socialProfile,
    quickPrompts: quickPrompts.length > 0 ? quickPrompts : FALLBACK_WELCOME.quickPrompts,
  };
}

function normalizeSection(section: unknown, sectionIndex: number): WelcomeSection | null {
  if (!isRecord(section)) return null;

  const rawItems = Array.isArray(section.items) ? section.items : [];
  const items = rawItems
    .map((item) => normalizeQuickItem(item))
    .filter((item): item is WelcomeQuickItem => Boolean(item));

  if (items.length === 0) return null;

  const id = typeof section.id === "string" && section.id.trim()
    ? section.id
    : `section-${sectionIndex}`;

  const title = typeof section.title === "string" && section.title.trim()
    ? section.title
    : "推荐";

  return {
    id,
    title,
    icon: typeof section.icon === "string" ? section.icon : "",
    items,
  };
}

function normalizeQuickItem(item: unknown): WelcomeQuickItem | null {
  if (!isRecord(item)) return null;

  const label = typeof item.label === "string" ? item.label.trim() : "";
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";

  if (!label || !prompt) return null;

  const type = item.type;
  const normalizedType: WelcomeQuickItem["type"] =
    type === "draft" || type === "suggestion" || type === "explore"
      ? type
      : "suggestion";

  return {
    type: normalizedType,
    label,
    prompt,
    icon: typeof item.icon === "string" ? item.icon : "",
  };
}

function normalizeQuickPrompt(item: unknown, index: number): QuickPrompt | null {
  if (!isRecord(item)) return null;

  const text = typeof item.text === "string" ? item.text.trim() : "";
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : text;

  if (!text || !prompt) return null;

  return {
    icon: typeof item.icon === "string" ? item.icon : `quick-${index}`,
    text,
    prompt,
  };
}

function normalizeSocialProfile(profile: unknown): SocialProfile | undefined {
  if (!isRecord(profile)) return undefined;

  const participationCount =
    typeof profile.participationCount === "number" ? profile.participationCount : 0;
  const activitiesCreatedCount =
    typeof profile.activitiesCreatedCount === "number" ? profile.activitiesCreatedCount : 0;
  const preferenceCompleteness =
    typeof profile.preferenceCompleteness === "number" ? profile.preferenceCompleteness : 0;

  if (
    participationCount <= 0 &&
    activitiesCreatedCount <= 0 &&
    preferenceCompleteness <= 0
  ) {
    return undefined;
  }

  return {
    participationCount,
    activitiesCreatedCount,
    preferenceCompleteness,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

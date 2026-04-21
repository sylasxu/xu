"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  isDataUIPart,
  isTextUIPart,
  readUIMessageStream,
  simulateReadableStream,
  type UIMessage as AISDKUIMessage,
  type UIMessageChunk,
} from "ai";
import {
  ArrowUp,
  ChevronRight,
  Clock3,
  Moon,
  Plus,
  Sparkles,
  Sun,
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
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Suggestion,
  Suggestions,
} from "@/components/ai-elements/suggestion";
import BorderGlow from "@/components/BorderGlow";
import { MessageCenterDrawer } from "@/components/chat/message-center-drawer";
import { SidebarDrawer } from "@/components/chat/sidebar-drawer";
import Orb from "@/components/Orb";
import { AuthSheet } from "@/components/auth/auth-sheet";
import { buildActivityDetailPath, resolveActivityEntry } from "@/lib/activity-url";
import { readClientToken, readClientUserId } from "@/lib/client-auth";
import { isWelcomeFocusCoveredByCurrentTasks } from "@/lib/runtime-task-focus";
import { cn } from "@/lib/utils";
import { HomeStateCard } from "@/components/chat/home-state-card";
import type { HomeStateTaskSnapshot } from "@/components/chat/home-state-card";
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
  GenUIRequestContext,
  GenUITextBlock,
  GenUIResponseEnvelope,
} from "@/src/gen/genui-contract";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";
const DEFAULT_PROMPTS = [
  "周末想找个轻松局",
  "想认识附近同频的人",
  "帮我写个不尴尬的邀约",
];
const DEFAULT_PROMPT_ENTRIES: WelcomePromptEntry[] = DEFAULT_PROMPTS.map((prompt) => ({
  text: prompt,
  prompt,
}));
const DEFAULT_WELCOME_GREETING = "今天有什么想玩的？";
const DEFAULT_COMPOSER_PLACEHOLDER = "想玩什么，或者想找谁一起？";
const DEFAULT_BOTTOM_ACTIONS: string[] = [
  "快速组局",
  "找搭子",
  "附近活动",
  "我的草稿",
];
const DEFAULT_PROFILE_HINTS = {
  low: "多聊一点，我会更懂你的偏好",
  medium: "我正在记住你的习惯",
  high: "你的偏好已经比较清楚，可以直接让我来安排",
};
const DEFAULT_CHAT_SHELL_UI = {
  composerHint: "也可以直接说地方、时间、类型或你想找的人",
  pendingActionTitle: "待恢复动作",
  pendingActionDefaultMessage: "这一步已经挂起，登录后会继续替你办完。",
  pendingActionLoginHint: "完成登录后回到这里，我会自动继续。",
  pendingActionBindPhoneHint: "完成绑定手机号后回到这里，我会自动继续。",
  pendingActionResumeLabel: "我已完成，继续",
};
const DEFAULT_SIDEBAR_UI = {
  title: "xu",
  authSubtitle: "会话与后续进展会持续同步",
  visitorSubtitle: "先聊当前这一轮，需要时再同步记录",
  messageCenterLabel: "消息中心",
  messageCenterHint: "搭子确认 / 活动跟进",
  authContinuationHint: "需要确认搭子或回看结果时，我会帮你继续接上",
  currentTasksTitle: "现在最需要继续的事",
  currentTasksDescriptionAuthenticated: "先接住还在推进中的事，再决定要不要翻旧对话。",
  currentTasksDescriptionVisitor: "登录后，这里会继续接住你没做完的事。",
  currentTasksEmpty: "当前没有需要继续推进的事，新的进展会先出现在这里。",
  historyTitle: "历史会话",
  historyDescriptionAuthenticated: "继续上次聊到一半的内容",
  historyDescriptionVisitor: "当前设备上的会话会先留在这里",
  searchPlaceholder: "搜索历史会话",
  visitorHistoryHint: "访客模式下可以直接开始聊天，但不会在这里展示云端会话记录。",
  emptySearchResult: "没有找到匹配的历史会话。",
  emptyHistory: "还没有历史会话，发起第一条消息后这里就会出现。",
  composerCapabilityHint: "当前输入区已只保留文本发送，没有语音和附件入口。",
};
const COMPOSER_EXPAND_THRESHOLD = 10;
const PENDING_AGENT_ACTION_STORAGE_KEY = "xu:web:pending-agent-action";
const THEME_STORAGE_KEY = "xu:web:theme";
const TEXT_STREAM_CHUNK_DELAY_MS = 60;  // v5.5: 调慢打字机速度，提升可读性
const ChatThemeContext = createContext(true);

type ComposerStatus = "ready" | "submitted";
type ActivityContextOverrides = Pick<GenUIRequestContext, "activityId" | "activityMode" | "entry">;
type GenUIRecentMessage = NonNullable<GenUIRequestContext["recentMessages"]>[number];
type LocalStructuredAction = {
  action: string;
  actionId: string;
  params?: Record<string, unknown>;
  source?: string;
  displayText?: string;
};
type LocalGenUIRecentMessage = GenUIRecentMessage & {
  action?: string;
  actionId?: string;
  params?: Record<string, unknown>;
  source?: string;
  displayText?: string;
};
const MAX_TRANSIENT_TURNS = 10;
type PendingActionAuthMode = "login" | "bind_phone";

type StructuredPendingAction = {
  type: "structured_action";
  action: string;
  payload: Record<string, unknown>;
  source?: string;
  originalText?: string;
  authMode?: PendingActionAuthMode;
};

type PendingAgentActionState = {
  action: StructuredPendingAction;
  message?: string;
};

type MessageCenterFocusIntent = {
  taskId?: string;
  matchId?: string;
};

type DiscussionNavigationPayload = {
  activityId: string;
  title?: string;
  startAt?: string;
  locationName?: string;
  entry?: string;
  source?: string;
};

type GenUIFormFieldType = "single-select" | "multi-select" | "textarea" | "text";

type GenUIFormOption = {
  label: string;
  value: string;
};

type GenUIFormField = {
  name: string;
  label: string;
  type: GenUIFormFieldType;
  required?: boolean;
  options?: GenUIFormOption[];
  placeholder?: string;
  maxLength?: number;
};

type GenUIFormSchemaConfig = {
  formType?: string;
  submitAction?: string;
  submitLabel?: string;
  fields: GenUIFormField[];
};

type ChatRecord =
  | {
      id: string;
      role: "user";
      text: string;
      structuredAction?: LocalStructuredAction;
    }
  | {
      id: string;
      role: "assistant";
      pending?: boolean;
      response?: GenUIResponseEnvelope;
      error?: string;
    };

type AssistantRecord = Extract<ChatRecord, { role: "assistant" }>;
type ActionOption = Pick<GenUIChoiceOption, "label" | "action" | "params"> | GenUICtaItem;
type ChatStreamMessageMetadata = {
  traceId?: string;
  conversationId?: string;
  responseId?: string;
  status?: GenUIResponseEnvelope["response"]["status"];
  suggestions?: GenUIResponseEnvelope["response"]["suggestions"];
  assistantTextOverride?: string;
};
type ChatStreamDataTypes = {
  genui_block: {
    block: GenUIBlock;
    mode: "append" | "replace";
  };
};
type ChatStreamMessage = AISDKUIMessage<ChatStreamMessageMetadata, ChatStreamDataTypes>;
type ChatStreamChunk = UIMessageChunk<ChatStreamMessageMetadata, ChatStreamDataTypes>;
type WelcomeUiPayload = {
  composerPlaceholder: string;
  bottomQuickActions: string[];
  profileHints: {
    low: string;
    medium: string;
    high: string;
  };
  chatShell: {
    composerHint: string;
    pendingActionTitle: string;
    pendingActionDefaultMessage: string;
    pendingActionLoginHint: string;
    pendingActionBindPhoneHint: string;
    pendingActionResumeLabel: string;
  };
  sidebar: {
    title: string;
    authSubtitle: string;
    visitorSubtitle: string;
    messageCenterLabel: string;
    messageCenterHint: string;
    authContinuationHint: string;
    currentTasksTitle: string;
    currentTasksDescriptionAuthenticated: string;
    currentTasksDescriptionVisitor: string;
    currentTasksEmpty: string;
    historyTitle: string;
    historyDescriptionAuthenticated: string;
    historyDescriptionVisitor: string;
    searchPlaceholder: string;
    visitorHistoryHint: string;
    emptySearchResult: string;
    emptyHistory: string;
    composerCapabilityHint: string;
  };
};
type WelcomePromptEntry = {
  text: string;
  prompt: string;
  action?: string;
  params?: Record<string, unknown>;
};

type RuntimeTaskAction = {
  kind: "structured_action" | "navigate" | "switch_tab";
  label: string;
  action?: string;
  payload?: Record<string, unknown>;
  source?: string;
  originalText?: string;
  url?: string;
};

type RuntimeTaskSnapshot = {
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
  primaryAction?: RuntimeTaskAction;
  secondaryAction?: RuntimeTaskAction;
};
type WelcomeFocusPayload = {
  type: "post_activity_feedback" | "recruiting_result" | "unfinished_intent";
  label: string;
  prompt: string;
  priority: number;
  taskId?: string;
  activityId?: string;
};
type StoredConversationMessage = {
  id: string;
  userId: string;
  userNickname: string | null;
  role: "user" | "assistant";
  type: string;
  content: unknown;
  activityId: string | null;
  createdAt: string;
};
type StoredConversationMessagesPayload = {
  conversationId: string;
  items: StoredConversationMessage[];
  total: number;
  hasMore: boolean;
  cursor: string | null;
};

const WELCOME_LOCATION_WAIT_MS = 600;

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function useChatTheme() {
  return useContext(ChatThemeContext);
}

function shouldExpandComposer(value: string) {
  return value.trim().length > COMPOSER_EXPAND_THRESHOLD;
}

function syncComposerHeight(element: HTMLTextAreaElement, value: string) {
  if (!shouldExpandComposer(value)) {
    element.style.height = "36px";
    return;
  }

  element.style.height = "0px";
  const nextHeight = Math.min(112, Math.max(36, element.scrollHeight));
  element.style.height = `${nextHeight}px`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPendingActionAuthMode(value: unknown): PendingActionAuthMode | null {
  return value === "login" || value === "bind_phone" ? value : null;
}

function readStructuredPendingAction(value: unknown): StructuredPendingAction | null {
  if (!isRecord(value) || value.type !== "structured_action") {
    return null;
  }

  const action = readString(value.action);
  const payload = isRecord(value.payload) ? value.payload : null;
  if (!action || !payload) {
    return null;
  }

  const authMode = readPendingActionAuthMode(value.authMode);

  return {
    type: "structured_action",
    action,
    payload,
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(typeof value.originalText === "string" ? { originalText: value.originalText } : {}),
    ...(authMode ? { authMode } : {}),
  };
}

function readPendingAgentActionState(value: unknown): PendingAgentActionState | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = readStructuredPendingAction(value.action);
  if (!action) {
    return null;
  }

  return {
    action,
    ...(typeof value.message === "string" && value.message.trim()
      ? { message: value.message.trim() }
      : {}),
  };
}

function readPendingAgentActionStateFromStorage(): PendingAgentActionState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_AGENT_ACTION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return readPendingAgentActionState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistPendingAgentActionState(state: PendingAgentActionState | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!state) {
    window.sessionStorage.removeItem(PENDING_AGENT_ACTION_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(PENDING_AGENT_ACTION_STORAGE_KEY, JSON.stringify(state));
}

function readMessageCenterFocusIntent(value: unknown): MessageCenterFocusIntent | null {
  if (!isRecord(value)) {
    return null;
  }

  const taskId = readString(value.taskId) ?? undefined;
  const matchId = readString(value.matchId) ?? undefined;
  if (!taskId && !matchId) {
    return null;
  }

  return {
    ...(taskId ? { taskId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

function readDiscussionNavigationPayload(value: unknown): DiscussionNavigationPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const activityId = readString(value.activityId);
  if (!activityId) {
    return null;
  }

  return {
    activityId,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.startAt === "string" ? { startAt: value.startAt } : {}),
    ...(typeof value.locationName === "string" ? { locationName: value.locationName } : {}),
    ...(typeof value.entry === "string" ? { entry: value.entry } : {}),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
  };
}

function readGenUIFormFieldType(value: unknown): GenUIFormFieldType | null {
  return value === "single-select" || value === "multi-select" || value === "textarea" || value === "text"
    ? value
    : null;
}

function isPartnerSearchResultsList(block: GenUIListBlock): boolean {
  return isRecord(block.meta) && block.meta.listKind === "partner_search_results";
}

function readListPresentation(
  block: GenUIListBlock
): "compact-stack" | "immersive-carousel" | "partner-carousel" | null {
  const presentation = isRecord(block.meta) ? block.meta.listPresentation : undefined;
  return presentation === "compact-stack" || presentation === "immersive-carousel" || presentation === "partner-carousel"
    ? presentation
    : null;
}

function readListShowHeader(block: GenUIListBlock): boolean {
  const showHeader = isRecord(block.meta) ? block.meta.listShowHeader : undefined;
  return showHeader !== false;
}

function readFormShowHeader(block: GenUIFormBlock): boolean {
  const showHeader = isRecord(block.meta) ? block.meta.formShowHeader : undefined;
  return showHeader !== false;
}

function readChoiceQuestionType(block: GenUIChoiceBlock): string | null {
  const questionType = isRecord(block.meta) ? block.meta.choiceQuestionType : undefined;
  if (typeof questionType === "string" && questionType.trim()) {
    return questionType.trim();
  }

  const option = block.options.find((entry) => {
    const params = isRecord(entry.params) ? entry.params : null;
    return typeof params?.questionType === "string" && params.questionType.trim().length > 0;
  });

  if (!option || !isRecord(option.params) || typeof option.params.questionType !== "string") {
    return null;
  }

  return option.params.questionType.trim();
}

function readListItemActions(item: Record<string, unknown>): ActionOption[] {
  if (!Array.isArray(item.actions)) {
    return [];
  }

  return item.actions.reduce<ActionOption[]>((result, entry) => {
    if (!isRecord(entry) || typeof entry.label !== "string" || typeof entry.action !== "string") {
      return result;
    }

    result.push({
      label: entry.label,
      action: entry.action,
      ...(isRecord(entry.params) ? { params: entry.params } : {}),
    });

    return result;
  }, []);
}

function readGenUIFormSchema(value: unknown): GenUIFormSchemaConfig {
  if (!isRecord(value)) {
    return { fields: [] };
  }

  const fields = Array.isArray(value.fields)
    ? value.fields.reduce<GenUIFormField[]>((result, item) => {
          if (!isRecord(item) || typeof item.name !== "string" || typeof item.label !== "string") {
            return result;
          }

          const fieldType = readGenUIFormFieldType(item.type);
          if (!fieldType) {
            return result;
          }

          const options = Array.isArray(item.options)
            ? item.options
                .map((option) => {
                  if (!isRecord(option) || typeof option.label !== "string" || typeof option.value !== "string") {
                    return null;
                  }

                  return {
                    label: option.label,
                    value: option.value,
                  };
                })
                .filter((option): option is GenUIFormOption => option !== null)
            : [];

          result.push({
            name: item.name,
            label: item.label,
            type: fieldType,
            required: item.required === true,
            options,
            ...(typeof item.placeholder === "string" ? { placeholder: item.placeholder } : {}),
            ...(typeof item.maxLength === "number" ? { maxLength: item.maxLength } : {}),
          });

          return result;
        }, [])
    : [];

  return {
    ...(typeof value.formType === "string" ? { formType: value.formType } : {}),
    ...(typeof value.submitAction === "string" ? { submitAction: value.submitAction } : {}),
    ...(typeof value.submitLabel === "string" ? { submitLabel: value.submitLabel } : {}),
    fields,
  };
}

function buildGenUIFormValues(initialValues: Record<string, unknown>, schema: GenUIFormSchemaConfig): Record<string, unknown> {
  const nextValues: Record<string, unknown> = {};

  for (const field of schema.fields) {
    if (field.type === "multi-select") {
      const currentValue = initialValues[field.name];
      nextValues[field.name] = Array.isArray(currentValue)
        ? currentValue.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      continue;
    }

    nextValues[field.name] = typeof initialValues[field.name] === "string" ? initialValues[field.name] : "";
  }

  return nextValues;
}

function readGenUIFormTextValue(values: Record<string, unknown>, fieldName: string): string {
  const value = values[fieldName];
  return typeof value === "string" ? value : "";
}

function readGenUIFormMultiValue(values: Record<string, unknown>, fieldName: string): string[] {
  const value = values[fieldName];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function validateGenUIFormRequiredFields(schema: GenUIFormSchemaConfig, values: Record<string, unknown>): string | null {
  for (const field of schema.fields) {
    if (!field.required) {
      continue;
    }

    if (field.type === "multi-select") {
      if (readGenUIFormMultiValue(values, field.name).length === 0) {
        return field.label;
      }
      continue;
    }

    const currentValue = readGenUIFormTextValue(values, field.name).trim();
    if (!currentValue) {
      return field.label;
    }

    const fieldOptions = field.options ?? [];
    if (
      field.type === "single-select" &&
      fieldOptions.length > 0 &&
      !fieldOptions.some((option) => option.value === currentValue)
    ) {
      return field.label;
    }
  }

  return null;
}

function countGenUIFormMissingRequiredFields(
  schema: GenUIFormSchemaConfig,
  values: Record<string, unknown>
): number {
  let missingCount = 0;

  for (const field of schema.fields) {
    if (!field.required) {
      continue;
    }

    if (field.type === "multi-select") {
      if (readGenUIFormMultiValue(values, field.name).length === 0) {
        missingCount += 1;
      }
      continue;
    }

    const currentValue = readGenUIFormTextValue(values, field.name).trim();
    if (!currentValue) {
      missingCount += 1;
      continue;
    }

    const fieldOptions = field.options ?? [];
    if (
      field.type === "single-select" &&
      fieldOptions.length > 0 &&
      !fieldOptions.some((option) => option.value === currentValue)
    ) {
      missingCount += 1;
    }
  }

  return missingCount;
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

function readStreamEventData(payload: unknown): unknown {
  if (isRecord(payload) && payload.data !== undefined) {
    return payload.data;
  }

  return payload;
}

function normalizeChatErrorMessage(message: string): string {
  const normalized = message.trim();
  const lowerCased = normalized.toLowerCase();

  if (
    lowerCased.includes("free tier of the model has been exhausted") ||
    (lowerCased.includes("use free tier only") &&
      lowerCased.includes("management console"))
  ) {
    return "AI 服务额度暂时用完了，请稍后再试。";
  }

  return normalized || "请求失败，请稍后再试";
}

function createEmptyEnvelope(params: {
  traceId: string;
  conversationId: string;
  responseId: string;
}): GenUIResponseEnvelope {
  return {
    traceId: params.traceId,
    conversationId: params.conversationId,
    response: {
      responseId: params.responseId,
      role: "assistant",
      status: "streaming",
      blocks: [],
    },
  };
}

function resolvePrimaryBlockType(blocks: GenUIBlock[]): GenUIRecentMessage["primaryBlockType"] {
  const primaryBlock = blocks.find((block) => block.type !== "text") ?? blocks[0];
  return primaryBlock?.type ?? null;
}

async function readChatResponseErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      return `请求失败（${response.status}）`;
    }

    try {
      const payload = JSON.parse(text) as unknown;
      if (isRecord(payload) && typeof payload.msg === "string") {
        return normalizeChatErrorMessage(payload.msg);
      }
      if (isRecord(payload) && typeof payload.message === "string") {
        return normalizeChatErrorMessage(payload.message);
      }
    } catch {
      return normalizeChatErrorMessage(text);
    }

    return normalizeChatErrorMessage(text);
  } catch {
    return `请求失败（${response.status}）`;
  }
}

function splitTextForUiStreaming(text: string): string[] {
  const chunks = text.match(/.{1,8}(?:[，。！？；：,.!?;:\n\s]+|$)/gu);
  return chunks && chunks.length > 0 ? chunks : [text];
}

async function enqueueSimulatedTextDeltaChunks(
  enqueue: (chunk: ChatStreamChunk) => void,
  params: {
    textPartId: string;
    deltaText: string;
  }
): Promise<void> {
  const slices = splitTextForUiStreaming(params.deltaText).filter(Boolean);
  if (slices.length === 0) {
    return;
  }

  const stream = simulateReadableStream({
    chunks: slices,
    initialDelayInMs: 0,
    chunkDelayInMs: TEXT_STREAM_CHUNK_DELAY_MS,
  });
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    enqueue({
      type: "text-delta",
      id: params.textPartId,
      delta: value,
    });
  }
}

function buildEnvelopeFromStreamMessage(message: ChatStreamMessage): GenUIResponseEnvelope {
  const metadata = message.metadata;
  const blocks = message.parts.reduce<GenUIBlock[]>((result, part, index) => {
    if (isTextUIPart(part)) {
      const content =
        typeof metadata?.assistantTextOverride === "string"
          ? metadata.assistantTextOverride
          : part.text;
      if (!content.trim()) {
        return result;
      }

      result.push({
        blockId: `${message.id}_text_${index}`,
        type: "text",
        content,
      });
      return result;
    }

    if (isDataUIPart<ChatStreamDataTypes>(part) && part.type === "data-genui_block") {
      const payload = part.data;
      if (!isRecord(payload) || !isGenUIBlock(payload.block)) {
        return result;
      }

      const mode = payload.mode === "replace" ? "replace" : "append";
      return upsertBlockWithMode(result, payload.block, mode).blocks;
    }

    return result;
  }, []);
  const hasTextBlock = blocks.some((block) => block.type === "text");
  if (!hasTextBlock && typeof metadata?.assistantTextOverride === "string") {
    const content = metadata.assistantTextOverride.trim();
    if (content) {
      blocks.unshift({
        blockId: `${message.id}_text_override`,
        type: "text",
        content,
      });
    }
  }

  return {
    traceId: metadata?.traceId ?? `trace_${message.id}`,
    conversationId: metadata?.conversationId ?? `conv_${message.id}`,
    response: {
      responseId: metadata?.responseId ?? message.id,
      role: "assistant",
      status: metadata?.status ?? "streaming",
      blocks,
      ...(metadata?.suggestions ? { suggestions: metadata.suggestions } : {}),
    },
  };
}

function trimStructuredTextContent(text: string, blocks: GenUIBlock[]): string {
  return text.trim();
}

function getRenderableBlocks(blocks: GenUIBlock[]): GenUIBlock[] {
  return blocks.reduce<GenUIBlock[]>((result, block) => {
    if (block.type !== "text") {
      result.push(block);
      return result;
    }

    const content = trimStructuredTextContent(block.content, blocks);
    if (!content) {
      return result;
    }

    result.push({
      ...block,
      content,
    });
    return result;
  }, []);
}

function summarizeAssistantBlocks(blocks: GenUIBlock[]): string {
  const textBlocks = getRenderableBlocks(blocks)
    .filter((block): block is GenUITextBlock => block.type === "text")
    .map((block) => block.content.trim())
    .filter(Boolean);

  if (textBlocks.length > 0) {
    return textBlocks.join("\n\n");
  }

  for (const block of blocks) {
    if (block.type === "choice" && block.question.trim()) {
      return block.question.trim();
    }

    if (block.type === "list") {
      if (typeof block.title === "string" && block.title.trim()) {
        return block.title.trim();
      }

      const firstItem = block.items.find((item) => isRecord(item) && typeof item.title === "string" && item.title.trim());
      if (firstItem && typeof firstItem.title === "string") {
        return firstItem.title.trim();
      }
    }

    if (block.type === "entity-card" && block.title.trim()) {
      return block.title.trim();
    }

    if (block.type === "form" && typeof block.title === "string" && block.title.trim()) {
      return block.title.trim();
    }

    if (block.type === "cta-group" && block.items.length > 0) {
      return block.items[0]?.label?.trim() || "";
    }

    if (block.type === "alert" && block.message.trim()) {
      return block.message.trim();
    }
  }

  return "";
}

function extractRecordText(record: ChatRecord): string {
  if (record.role === "user") {
    return record.text.trim();
  }

  if (record.response) {
    return summarizeAssistantBlocks(record.response.response.blocks);
  }

  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }

  return "";
}

function buildRecentMessages(records: ChatRecord[]): LocalGenUIRecentMessage[] {
  return records
    .slice(-MAX_TRANSIENT_TURNS)
    .map((record): LocalGenUIRecentMessage | null => {
      const text = extractRecordText(record);
      if (!text) {
        return null;
      }

      if (record.role === "user") {
        return {
          messageId: record.id,
          role: "user",
          text,
          ...(record.structuredAction
            ? {
                action: record.structuredAction.action,
                actionId: record.structuredAction.actionId,
                ...(record.structuredAction.params ? { params: record.structuredAction.params } : {}),
                ...(record.structuredAction.source ? { source: record.structuredAction.source } : {}),
                ...(record.structuredAction.displayText ? { displayText: record.structuredAction.displayText } : {}),
              }
            : {}),
        };
      }

      const primaryBlockType = record.response
        ? resolvePrimaryBlockType(record.response.response.blocks)
        : null;

      return {
        messageId: record.id,
        role: "assistant",
        text,
        ...(primaryBlockType !== undefined ? { primaryBlockType } : {}),
        ...(record.response?.response.suggestions ? { suggestions: record.response.response.suggestions } : {}),
      };
    })
    .filter((turn): turn is LocalGenUIRecentMessage => Boolean(turn));
}

function isGenUIAlertLevel(value: unknown): value is GenUIAlertBlock["level"] {
  return value === "info" || value === "warning" || value === "error" || value === "success";
}

function isGenUIResponseStatus(value: unknown): value is GenUIResponseEnvelope["response"]["status"] {
  return value === "streaming" || value === "completed" || value === "error";
}

function isGenUIChoiceOption(value: unknown): value is GenUIChoiceOption {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.action === "string" &&
    (value.params === undefined || isRecord(value.params))
  );
}

function isGenUICtaItem(value: unknown): value is GenUICtaItem {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.action === "string" &&
    (value.params === undefined || isRecord(value.params))
  );
}

function isGenUIBlock(value: unknown): value is GenUIBlock {
  if (!isRecord(value) || typeof value.blockId !== "string") {
    return false;
  }

  if (value.dedupeKey !== undefined && typeof value.dedupeKey !== "string") {
    return false;
  }

  if (
    value.replacePolicy !== undefined &&
    value.replacePolicy !== "append" &&
    value.replacePolicy !== "replace" &&
    value.replacePolicy !== "ignore-if-exists"
  ) {
    return false;
  }

  if (value.meta !== undefined && !isRecord(value.meta)) {
    return false;
  }

  switch (value.type) {
    case "text":
      return typeof value.content === "string";
    case "choice":
      return typeof value.question === "string" && Array.isArray(value.options) && value.options.every(isGenUIChoiceOption);
    case "entity-card":
      return typeof value.title === "string" && isRecord(value.fields);
    case "list":
      return (
        (value.title === undefined || typeof value.title === "string") &&
        Array.isArray(value.items) &&
        value.items.every(isRecord)
      );
    case "form":
      return (
        (value.title === undefined || typeof value.title === "string") &&
        isRecord(value.schema) &&
        (value.initialValues === undefined || isRecord(value.initialValues))
      );
    case "cta-group":
      return Array.isArray(value.items) && value.items.every(isGenUICtaItem);
    case "alert":
      return isGenUIAlertLevel(value.level) && typeof value.message === "string";
    default:
      return false;
  }
}

function isGenUITextBlock(block: GenUIBlock): block is GenUITextBlock {
  return block.type === "text";
}

function isGenUISuggestions(value: unknown): value is NonNullable<GenUIResponseEnvelope["response"]["suggestions"]> {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "choice") {
    return Array.isArray(value.options);
  }

  if (value.kind === "list") {
    return Array.isArray(value.items);
  }

  if (value.kind === "cta-group") {
    return Array.isArray(value.items);
  }

  return false;
}

function isGenUIResponseEnvelope(value: unknown): value is GenUIResponseEnvelope {
  if (!isRecord(value) || typeof value.traceId !== "string" || typeof value.conversationId !== "string") {
    return false;
  }

  if (!isRecord(value.response)) {
    return false;
  }

  return (
    typeof value.response.responseId === "string" &&
    value.response.role === "assistant" &&
    isGenUIResponseStatus(value.response.status) &&
    Array.isArray(value.response.blocks) &&
    value.response.blocks.every(isGenUIBlock)
  );
}

function readStoredConversationText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!isRecord(content)) {
    return "";
  }

  if (typeof content.text === "string" && content.text.trim()) {
    return content.text.trim();
  }

  if (typeof content.message === "string" && content.message.trim()) {
    return content.message.trim();
  }

  return "";
}

function buildEnvelopeFromStoredAssistantMessage(params: {
  conversationId: string;
  messageId: string;
  content: unknown;
}): GenUIResponseEnvelope | null {
  if (isRecord(params.content) && isRecord(params.content.response)) {
    const storedResponse = params.content.response;
    const blocks = Array.isArray(storedResponse.blocks) ? storedResponse.blocks.filter(isGenUIBlock) : [];

    if (blocks.length > 0) {
      return {
        traceId:
          typeof storedResponse.traceId === "string" && storedResponse.traceId.trim()
            ? storedResponse.traceId
            : `history_trace_${params.messageId}`,
        conversationId: params.conversationId,
        response: {
          responseId:
            typeof storedResponse.responseId === "string" && storedResponse.responseId.trim()
              ? storedResponse.responseId
              : `history_response_${params.messageId}`,
          role: "assistant",
          status: isGenUIResponseStatus(storedResponse.status) ? storedResponse.status : "completed",
          ...(isGenUISuggestions(storedResponse.suggestions) ? { suggestions: storedResponse.suggestions } : {}),
          blocks,
        },
      };
    }
  }

  const text = readStoredConversationText(params.content);
  if (!text) {
    return null;
  }

  return {
    traceId: `history_trace_${params.messageId}`,
    conversationId: params.conversationId,
    response: {
      responseId: `history_response_${params.messageId}`,
      role: "assistant",
      status: "completed",
      blocks: [
        {
          blockId: `${params.messageId}_text`,
          type: "text",
          content: text,
        },
      ],
    },
  };
}

function buildChatRecordFromStoredMessage(
  conversationId: string,
  item: StoredConversationMessage
): ChatRecord | null {
  if (item.role === "user") {
    const text = readStoredConversationText(item.content);
    if (!text) {
      return null;
    }

    const structuredAction =
      item.type === "user_action" && isRecord(item.content) && typeof item.content.action === "string"
        ? {
            action: item.content.action,
            actionId: item.id,
            ...(isRecord(item.content.payload) ? { params: item.content.payload } : {}),
            ...(typeof item.content.source === "string" ? { source: item.content.source } : {}),
            displayText: text,
          }
        : undefined;

    return {
      id: item.id,
      role: "user",
      text,
      ...(structuredAction ? { structuredAction } : {}),
    };
  }

  const response = buildEnvelopeFromStoredAssistantMessage({
    conversationId,
    messageId: item.id,
    content: item.content,
  });
  if (!response) {
    return null;
  }

  return {
    id: item.id,
    role: "assistant",
    response,
  };
}

function extractWelcomePrompts(payload: unknown): WelcomePromptEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.quickPrompts)) {
    return [];
  }

  return payload.quickPrompts
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const prompt =
        typeof item.prompt === "string" && item.prompt.trim()
          ? item.prompt.trim()
          : typeof item.text === "string" && item.text.trim()
            ? item.text.trim()
            : "";
      const text =
        typeof item.text === "string" && item.text.trim()
          ? item.text.trim()
          : prompt;
      const action = typeof item.action === "string" && item.action.trim() ? item.action.trim() : undefined;
      const params = isRecord(item.params) ? item.params : undefined;
      if (!prompt || !text) {
        return null;
      }

      return {
        text,
        prompt,
        ...(action ? { action } : {}),
        ...(params ? { params } : {}),
      };
    })
    .filter((item): item is WelcomePromptEntry => item !== null)
    .slice(0, 5);
}

function extractWelcomeGreeting(payload: unknown): string {
  if (!isRecord(payload)) {
    return DEFAULT_WELCOME_GREETING;
  }

  return (
    typeof payload.greeting === "string" && payload.greeting.trim()
      ? payload.greeting.trim()
      : DEFAULT_WELCOME_GREETING
  );
}

function isWelcomeFocusType(value: unknown): value is WelcomeFocusPayload["type"] {
  return value === "post_activity_feedback" || value === "recruiting_result" || value === "unfinished_intent";
}

function extractWelcomeFocus(payload: unknown): WelcomeFocusPayload | null {
  if (!isRecord(payload) || !isRecord(payload.welcomeFocus)) {
    return null;
  }

  const focus = payload.welcomeFocus;
  if (
    !isWelcomeFocusType(focus.type) ||
    typeof focus.label !== "string" ||
    typeof focus.prompt !== "string" ||
    typeof focus.priority !== "number"
  ) {
    return null;
  }

  const label = focus.label.trim();
  const prompt = focus.prompt.trim();
  if (!label || !prompt) {
    return null;
  }

  const context = isRecord(focus.context) ? focus.context : null;
  const taskId =
    context && typeof context.taskId === "string" && context.taskId.trim()
      ? context.taskId.trim()
      : undefined;
  const activityId =
    context && typeof context.activityId === "string" && context.activityId.trim()
      ? context.activityId.trim()
      : undefined;

  return {
    type: focus.type,
    label,
    prompt,
    priority: focus.priority,
    ...(taskId ? { taskId } : {}),
    ...(activityId ? { activityId } : {}),
  };
}

function extractWelcomeUi(payload: unknown): WelcomeUiPayload {
  if (!isRecord(payload) || !isRecord(payload.ui)) {
    return {
      composerPlaceholder: DEFAULT_COMPOSER_PLACEHOLDER,
      bottomQuickActions: DEFAULT_BOTTOM_ACTIONS,
      profileHints: DEFAULT_PROFILE_HINTS,
      chatShell: DEFAULT_CHAT_SHELL_UI,
      sidebar: DEFAULT_SIDEBAR_UI,
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

  const composerPlaceholder =
    typeof payload.ui.composerPlaceholder === "string" &&
    payload.ui.composerPlaceholder.trim()
      ? payload.ui.composerPlaceholder.trim()
      : DEFAULT_COMPOSER_PLACEHOLDER;
  const chatShellSource = isRecord(payload.ui.chatShell) ? payload.ui.chatShell : {};
  const sidebarSource = isRecord(payload.ui.sidebar) ? payload.ui.sidebar : {};

  return {
    composerPlaceholder,
    bottomQuickActions: actions.length ? actions : DEFAULT_BOTTOM_ACTIONS,
    profileHints,
    chatShell: {
      composerHint:
        typeof chatShellSource.composerHint === "string" && chatShellSource.composerHint.trim()
          ? chatShellSource.composerHint.trim()
          : DEFAULT_CHAT_SHELL_UI.composerHint,
      pendingActionTitle:
        typeof chatShellSource.pendingActionTitle === "string" && chatShellSource.pendingActionTitle.trim()
          ? chatShellSource.pendingActionTitle.trim()
          : DEFAULT_CHAT_SHELL_UI.pendingActionTitle,
      pendingActionDefaultMessage:
        typeof chatShellSource.pendingActionDefaultMessage === "string" && chatShellSource.pendingActionDefaultMessage.trim()
          ? chatShellSource.pendingActionDefaultMessage.trim()
          : DEFAULT_CHAT_SHELL_UI.pendingActionDefaultMessage,
      pendingActionLoginHint:
        typeof chatShellSource.pendingActionLoginHint === "string" && chatShellSource.pendingActionLoginHint.trim()
          ? chatShellSource.pendingActionLoginHint.trim()
          : DEFAULT_CHAT_SHELL_UI.pendingActionLoginHint,
      pendingActionBindPhoneHint:
        typeof chatShellSource.pendingActionBindPhoneHint === "string" && chatShellSource.pendingActionBindPhoneHint.trim()
          ? chatShellSource.pendingActionBindPhoneHint.trim()
          : DEFAULT_CHAT_SHELL_UI.pendingActionBindPhoneHint,
      pendingActionResumeLabel:
        typeof chatShellSource.pendingActionResumeLabel === "string" && chatShellSource.pendingActionResumeLabel.trim()
          ? chatShellSource.pendingActionResumeLabel.trim()
          : DEFAULT_CHAT_SHELL_UI.pendingActionResumeLabel,
    },
    sidebar: {
      title:
        typeof sidebarSource.title === "string" && sidebarSource.title.trim()
          ? sidebarSource.title.trim()
          : DEFAULT_SIDEBAR_UI.title,
      authSubtitle:
        typeof sidebarSource.authSubtitle === "string" && sidebarSource.authSubtitle.trim()
          ? sidebarSource.authSubtitle.trim()
          : DEFAULT_SIDEBAR_UI.authSubtitle,
      visitorSubtitle:
        typeof sidebarSource.visitorSubtitle === "string" && sidebarSource.visitorSubtitle.trim()
          ? sidebarSource.visitorSubtitle.trim()
          : DEFAULT_SIDEBAR_UI.visitorSubtitle,
      messageCenterLabel:
        typeof sidebarSource.messageCenterLabel === "string" && sidebarSource.messageCenterLabel.trim()
          ? sidebarSource.messageCenterLabel.trim()
          : DEFAULT_SIDEBAR_UI.messageCenterLabel,
      messageCenterHint:
        typeof sidebarSource.messageCenterHint === "string" && sidebarSource.messageCenterHint.trim()
          ? sidebarSource.messageCenterHint.trim()
          : DEFAULT_SIDEBAR_UI.messageCenterHint,
      authContinuationHint:
        typeof sidebarSource.authContinuationHint === "string" && sidebarSource.authContinuationHint.trim()
          ? sidebarSource.authContinuationHint.trim()
          : DEFAULT_SIDEBAR_UI.authContinuationHint,
      currentTasksTitle:
        typeof sidebarSource.currentTasksTitle === "string" && sidebarSource.currentTasksTitle.trim()
          ? sidebarSource.currentTasksTitle.trim()
          : DEFAULT_SIDEBAR_UI.currentTasksTitle,
      currentTasksDescriptionAuthenticated:
        typeof sidebarSource.currentTasksDescriptionAuthenticated === "string" && sidebarSource.currentTasksDescriptionAuthenticated.trim()
          ? sidebarSource.currentTasksDescriptionAuthenticated.trim()
          : DEFAULT_SIDEBAR_UI.currentTasksDescriptionAuthenticated,
      currentTasksDescriptionVisitor:
        typeof sidebarSource.currentTasksDescriptionVisitor === "string" && sidebarSource.currentTasksDescriptionVisitor.trim()
          ? sidebarSource.currentTasksDescriptionVisitor.trim()
          : DEFAULT_SIDEBAR_UI.currentTasksDescriptionVisitor,
      currentTasksEmpty:
        typeof sidebarSource.currentTasksEmpty === "string" && sidebarSource.currentTasksEmpty.trim()
          ? sidebarSource.currentTasksEmpty.trim()
          : DEFAULT_SIDEBAR_UI.currentTasksEmpty,
      historyTitle:
        typeof sidebarSource.historyTitle === "string" && sidebarSource.historyTitle.trim()
          ? sidebarSource.historyTitle.trim()
          : DEFAULT_SIDEBAR_UI.historyTitle,
      historyDescriptionAuthenticated:
        typeof sidebarSource.historyDescriptionAuthenticated === "string" && sidebarSource.historyDescriptionAuthenticated.trim()
          ? sidebarSource.historyDescriptionAuthenticated.trim()
          : DEFAULT_SIDEBAR_UI.historyDescriptionAuthenticated,
      historyDescriptionVisitor:
        typeof sidebarSource.historyDescriptionVisitor === "string" && sidebarSource.historyDescriptionVisitor.trim()
          ? sidebarSource.historyDescriptionVisitor.trim()
          : DEFAULT_SIDEBAR_UI.historyDescriptionVisitor,
      searchPlaceholder:
        typeof sidebarSource.searchPlaceholder === "string" && sidebarSource.searchPlaceholder.trim()
          ? sidebarSource.searchPlaceholder.trim()
          : DEFAULT_SIDEBAR_UI.searchPlaceholder,
      visitorHistoryHint:
        typeof sidebarSource.visitorHistoryHint === "string" && sidebarSource.visitorHistoryHint.trim()
          ? sidebarSource.visitorHistoryHint.trim()
          : DEFAULT_SIDEBAR_UI.visitorHistoryHint,
      emptySearchResult:
        typeof sidebarSource.emptySearchResult === "string" && sidebarSource.emptySearchResult.trim()
          ? sidebarSource.emptySearchResult.trim()
          : DEFAULT_SIDEBAR_UI.emptySearchResult,
      emptyHistory:
        typeof sidebarSource.emptyHistory === "string" && sidebarSource.emptyHistory.trim()
          ? sidebarSource.emptyHistory.trim()
          : DEFAULT_SIDEBAR_UI.emptyHistory,
      composerCapabilityHint:
        typeof sidebarSource.composerCapabilityHint === "string" && sidebarSource.composerCapabilityHint.trim()
          ? sidebarSource.composerCapabilityHint.trim()
          : DEFAULT_SIDEBAR_UI.composerCapabilityHint,
    },
  };
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

function resolveHomeState(tasks: HomeStateTaskSnapshot[]): { state: "H0" | "H1" | "H2" | "H3" | "H4"; primaryTask: HomeStateTaskSnapshot | null } {
  if (tasks.length === 0) {
    return { state: "H0", primaryTask: null };
  }

  const h3 = tasks.find((t) => t.currentStage === "match_ready");
  if (h3) {
    return { state: "H3", primaryTask: h3 };
  }

  const activeStages = [
    "explore",
    "preference_collecting",
    "draft_collecting",
    "action_selected",
    "draft_ready",
    "joined",
    "discussion",
    "published",
    "intent_posted",
    "awaiting_match",
  ];
  const h2 = tasks.find((t) => t.status === "active" && activeStages.includes(t.currentStage));
  if (h2) {
    return { state: "H2", primaryTask: h2 };
  }

  const h1 = tasks.find((t) => t.status === "waiting_auth");
  if (h1) {
    return { state: "H1", primaryTask: h1 };
  }

  const h4 = tasks.find((t) => t.currentStage === "post_activity");
  if (h4) {
    return { state: "H4", primaryTask: h4 };
  }

  return { state: "H0", primaryTask: null };
}

function resolveMiniProgramUrlToWeb(url: string): { webUrl: string } | { openMessageCenter: true; matchId?: string } | null {
  if (url.startsWith("/subpackages/activity/detail/index")) {
    const queryString = url.split("?")[1];
    if (!queryString) return null;
    const parsed = new URLSearchParams(queryString);
    const activityId = parsed.get("id")?.trim();
    if (!activityId) return null;
    const entry = parsed.get("entry")?.trim();
    return { webUrl: buildActivityDetailPath(activityId, entry ? { entry } : undefined) };
  }

  if (url.startsWith("/subpackages/activity/discussion/index")) {
    const queryString = url.split("?")[1];
    if (!queryString) return null;
    const parsed = new URLSearchParams(queryString);
    const activityId = parsed.get("id")?.trim();
    const entry = parsed.get("entry")?.trim() || "task_runtime_panel";
    if (!activityId) return null;
    return { webUrl: buildActivityDetailPath(activityId, { entry }) };
  }

  if (url === "/pages/message/index" || url.startsWith("/pages/message")) {
    return { openMessageCenter: true };
  }

  return null;
}

function readActivityIdFromRuntimeTaskAction(taskAction: RuntimeTaskAction): string | null {
  const payloadActivityId =
    isRecord(taskAction.payload) && typeof taskAction.payload.activityId === "string"
      ? taskAction.payload.activityId.trim()
      : "";
  if (payloadActivityId) {
    return payloadActivityId;
  }

  if (!taskAction.url) {
    return null;
  }

  const queryString = taskAction.url.split("?")[1];
  if (!queryString) {
    return null;
  }

  const parsed = new URLSearchParams(queryString);
  const activityId = parsed.get("id");
  return activityId?.trim() || null;
}

function readEntryFromRuntimeTaskAction(taskAction: RuntimeTaskAction): string | undefined {
  if (!taskAction.url) {
    return undefined;
  }

  const queryString = taskAction.url.split("?")[1];
  if (!queryString) {
    return undefined;
  }

  const parsed = new URLSearchParams(queryString);
  const entry = parsed.get("entry")?.trim();
  return entry || undefined;
}

function readActivityContextOverridesFromTaskAction(
  taskAction: RuntimeTaskAction
): ActivityContextOverrides | undefined {
  if (!isRecord(taskAction.payload)) {
    return undefined;
  }

  const activityId =
    typeof taskAction.payload.activityId === "string" && taskAction.payload.activityId.trim()
      ? taskAction.payload.activityId.trim()
      : undefined;
  const activityMode =
    taskAction.payload.activityMode === "review" ||
    taskAction.payload.activityMode === "rebook" ||
    taskAction.payload.activityMode === "kickoff"
      ? taskAction.payload.activityMode
      : undefined;
  const entry =
    typeof taskAction.payload.entry === "string" && taskAction.payload.entry.trim()
      ? taskAction.payload.entry.trim()
      : undefined;

  if (!activityId && !activityMode && !entry) {
    return undefined;
  }

  return {
    ...(activityId ? { activityId } : {}),
    ...(activityMode ? { activityMode } : {}),
    ...(entry ? { entry } : {}),
  };
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatRecord[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ComposerStatus>("ready");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [quickPrompts, setQuickPrompts] = useState<WelcomePromptEntry[]>(DEFAULT_PROMPT_ENTRIES);
  const [welcomeGreeting, setWelcomeGreeting] = useState(DEFAULT_WELCOME_GREETING);
  const [welcomeFocus, setWelcomeFocus] = useState<WelcomeFocusPayload | null>(null);
  const [isWelcomeLoading, setIsWelcomeLoading] = useState(true);
  const [currentTasks, setCurrentTasks] = useState<RuntimeTaskSnapshot[]>([]);
  const [isCurrentTasksLoading, setIsCurrentTasksLoading] = useState(false);
  const [welcomeUi, setWelcomeUi] = useState<WelcomeUiPayload>({
    composerPlaceholder: DEFAULT_COMPOSER_PLACEHOLDER,
    bottomQuickActions: DEFAULT_BOTTOM_ACTIONS,
    profileHints: DEFAULT_PROFILE_HINTS,
    chatShell: DEFAULT_CHAT_SHELL_UI,
    sidebar: DEFAULT_SIDEBAR_UI,
  });
  const [clientLocation, setClientLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [welcomeLocationResolved, setWelcomeLocationResolved] = useState(false);
  const [pendingAgentAction, setPendingAgentAction] = useState<PendingAgentActionState | null>(null);
  const [pendingAgentActionHydrated, setPendingAgentActionHydrated] = useState(false);
  const [pendingActionNotice, setPendingActionNotice] = useState<string | null>(null);
  const [messageCenterOpenSignal, setMessageCenterOpenSignal] = useState(0);
  const [messageCenterFocusMatchId, setMessageCenterFocusMatchId] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const hasResumedPendingActionRef = useRef(false);
  const requestedWelcomeKeyRef = useRef<string | null>(null);

  const isSending = status === "submitted";
  const showComposerHint = shouldExpandComposer(input);
  const currentUserId = useMemo(() => readClientUserId(authToken), [authToken]);
  const visibleCurrentTasks = useMemo(() => currentTasks.slice(0, 2), [currentTasks]);
  const visibleWelcomeFocus = useMemo(
    () => (isWelcomeFocusCoveredByCurrentTasks(welcomeFocus, currentTasks) ? null : welcomeFocus),
    [currentTasks, welcomeFocus]
  );

  const { state: homeState, primaryTask: primaryHomeTask } = useMemo(() => resolveHomeState(currentTasks), [currentTasks]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light") {
      setIsDarkMode(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? "dark" : "light");
    document.documentElement.dataset.theme = isDarkMode ? "dark" : "light";
  }, [isDarkMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

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
    if (typeof window === "undefined") {
      return;
    }

    const prefill = window.sessionStorage.getItem("xu:chat:prefill");
    if (prefill) {
      setInput(prefill);
      window.sessionStorage.removeItem("xu:chat:prefill");
    }
  }, []);

  const refreshCurrentTasks = useCallback(
    async (tokenOverride?: string | null) => {
      const effectiveToken = tokenOverride ?? authToken ?? readClientToken();
      const effectiveUserId = readClientUserId(effectiveToken);

      if (!effectiveToken || !effectiveUserId) {
        setCurrentTasks([]);
        setIsCurrentTasksLoading(false);
        return;
      }

      setIsCurrentTasksLoading(true);

      try {
        const response = await fetch(`${API_BASE}/ai/tasks/current`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
          },
          cache: "no-store",
        });

        if (!response.ok) {
          setCurrentTasks([]);
          return;
        }

        const payload = (await response.json()) as unknown;
        if (!isRecord(payload) || !Array.isArray(payload.items)) {
          setCurrentTasks([]);
          return;
        }

        setCurrentTasks(payload.items as RuntimeTaskSnapshot[]);
      } catch {
        setCurrentTasks([]);
      } finally {
        setIsCurrentTasksLoading(false);
      }
    },
    [authToken]
  );

  const handleStartNewConversation = useCallback(() => {
    if (isSending) {
      return;
    }

    setMessages([]);
    setConversationId(null);
    setInput("");
    setStatus("ready");
    setPendingActionNotice(null);
    setMessageCenterFocusMatchId(null);
  }, [isSending]);

  const handleSelectConversation = useCallback(
    async (targetConversationId: string) => {
      if (isSending || !authToken || !currentUserId) {
        return;
      }

      const response = await fetch(
        `${API_BASE}/ai/conversations/${targetConversationId}/messages?userId=${encodeURIComponent(currentUserId)}&limit=100`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(await readChatResponseErrorMessage(response));
      }

      const payload = (await response.json()) as StoredConversationMessagesPayload;
      const nextMessages = [...payload.items]
        .reverse()
        .map((item) => buildChatRecordFromStoredMessage(payload.conversationId, item))
        .filter((item): item is ChatRecord => item !== null);

      setMessages(nextMessages);
      setConversationId(payload.conversationId);
      setInput("");
      setStatus("ready");
      setPendingActionNotice(null);
      setMessageCenterFocusMatchId(null);
    },
    [authToken, currentUserId, isSending]
  );

  useEffect(() => {
    const nextToken = readClientToken();
    if (nextToken) {
      setPendingAgentAction(readPendingAgentActionStateFromStorage());
    }
    setPendingAgentActionHydrated(true);
  }, []);

  useEffect(() => {
    if (!pendingAgentActionHydrated) {
      return;
    }

    persistPendingAgentActionState(pendingAgentAction);
  }, [pendingAgentAction, pendingAgentActionHydrated]);

  useEffect(() => {
    if (!pendingAgentActionHydrated || !authToken || pendingAgentAction) {
      return;
    }

    const restoredPendingAction = readPendingAgentActionStateFromStorage();
    if (restoredPendingAction) {
      setPendingAgentAction(restoredPendingAction);
    }
  }, [authToken, pendingAgentAction, pendingAgentActionHydrated]);

  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setWelcomeLocationResolved(true);
      return;
    }

    let cancelled = false;
    let settled = false;
    const fallbackTimer = window.setTimeout(() => {
      if (cancelled || settled) {
        return;
      }

      settled = true;
      setWelcomeLocationResolved(true);
    }, WELCOME_LOCATION_WAIT_MS);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled || settled) {
          return;
        }

        settled = true;
        window.clearTimeout(fallbackTimer);
        setClientLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setWelcomeLocationResolved(true);
      },
      () => {
        if (cancelled || settled) {
          return;
        }

        settled = true;
        window.clearTimeout(fallbackTimer);
        setWelcomeLocationResolved(true);
        // silent fallback: no location context
      },
      {
        enableHighAccuracy: false,
        timeout: 4000,
        maximumAge: 5 * 60 * 1000,
      }
    );

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    if (!welcomeLocationResolved) {
      return;
    }

    const currentAuthToken = authToken ?? readClientToken();
    const locationKey = clientLocation ? `${clientLocation.lat.toFixed(4)},${clientLocation.lng.toFixed(4)}` : "none";
    const welcomeRequestKey = `${currentAuthToken ? "auth" : "visitor"}:${locationKey}`;
    if (requestedWelcomeKeyRef.current === welcomeRequestKey) {
      return;
    }

    requestedWelcomeKeyRef.current = welcomeRequestKey;
    const controller = new AbortController();
    let active = true;
    const welcomeUrl = new URL(`${API_BASE}/ai/welcome`);
    if (clientLocation) {
      welcomeUrl.searchParams.set("lat", String(clientLocation.lat));
      welcomeUrl.searchParams.set("lng", String(clientLocation.lng));
    }

    void fetch(welcomeUrl.toString(), {
      method: "GET",
      ...(currentAuthToken
        ? { headers: { Authorization: `Bearer ${currentAuthToken}` } }
        : {}),
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
        setWelcomeGreeting(extractWelcomeGreeting(payload));
        setWelcomeFocus(extractWelcomeFocus(payload));
        setWelcomeUi(extractWelcomeUi(payload));
      })
      .catch(() => {
        // keep local fallback prompts
      })
      .finally(() => {
        if (active) {
          setIsWelcomeLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [authToken, clientLocation, welcomeLocationResolved]);

  useEffect(() => {
    void refreshCurrentTasks(authToken);
  }, [authToken, currentUserId, refreshCurrentTasks]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const refreshVisibleTasks = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void refreshCurrentTasks();
    };

    window.addEventListener("focus", refreshVisibleTasks);
    window.addEventListener("xu-auth-updated", refreshVisibleTasks);
    document.addEventListener("visibilitychange", refreshVisibleTasks);

    return () => {
      window.removeEventListener("focus", refreshVisibleTasks);
      window.removeEventListener("xu-auth-updated", refreshVisibleTasks);
      document.removeEventListener("visibilitychange", refreshVisibleTasks);
    };
  }, [refreshCurrentTasks]);

  const applyCompletionEffectsFromBlocks = useCallback((blocks: GenUIBlock[]) => {
    for (const block of blocks) {
      if (block.type !== "alert") {
        continue;
      }

      const meta = isRecord(block.meta) ? block.meta : null;
      const authRequiredMeta = isRecord(meta?.authRequired) ? meta.authRequired : null;
      if (authRequiredMeta) {
        const pendingAction = readStructuredPendingAction(authRequiredMeta.pendingAction);
        const authMode = readPendingActionAuthMode(authRequiredMeta.mode);
        if (pendingAction) {
          setPendingAgentAction({
            action: {
              ...pendingAction,
              ...(authMode ? { authMode } : {}),
            },
            ...(block.message.trim() ? { message: block.message.trim() } : {}),
          });
          setPendingActionNotice(null);
        }
        return;
      }

      if (meta?.navigationIntent === "open_discussion") {
        const payload = readDiscussionNavigationPayload(meta.navigationPayload);
        if (payload && typeof window !== "undefined") {
          const entry = resolveActivityEntry(payload.entry, payload.source ?? "join_success");
          window.setTimeout(() => {
            window.location.href = buildActivityDetailPath(payload.activityId, { entry });
          }, 360);
        }
        return;
      }

      if (meta?.navigationIntent === "open_message_center") {
        const focusIntent = readMessageCenterFocusIntent(meta.navigationPayload);
        setMessageCenterFocusMatchId(focusIntent?.matchId ?? null);
        setMessageCenterOpenSignal((value) => value + 1);
        return;
      }
    }
  }, []);


  const sendChatRequest = useCallback(
    async (
      nextInput: GenUIInput,
      userDisplayText: string,
      contextOverrides?: ActivityContextOverrides
    ) => {
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
          ...(nextInput.type === "action"
            ? {
                structuredAction: {
                  action: nextInput.action,
                  actionId: nextInput.actionId,
                  ...(isRecord(nextInput.params) ? { params: nextInput.params } : {}),
                  ...(typeof contextOverrides?.entry === "string"
                    ? { source: contextOverrides.entry }
                    : isRecord(nextInput.params) && typeof nextInput.params.source === "string"
                      ? { source: nextInput.params.source }
                      : {}),
                  ...(typeof nextInput.displayText === "string" ? { displayText: nextInput.displayText } : {}),
                },
              }
            : {}),
        },
        {
          id: assistantMessageId,
          role: "assistant",
          pending: true,
        },
      ]);
      setStatus("submitted");

      let uiChunkController: ReadableStreamDefaultController<ChatStreamChunk> | null =
        null;
      let uiMessageReader: Promise<void> | null = null;
      let closeUiChunkStream = () => {};
      let errorUiChunkStream = (_reason: unknown) => {};

      try {
        const streamState: { envelope: GenUIResponseEnvelope | null } = {
          envelope: null,
        };

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

        const applyEnvelope = (nextEnvelope: GenUIResponseEnvelope, pending = true) => {
          streamState.envelope = nextEnvelope;
          patchAssistantMessage(() => ({
            id: assistantMessageId,
            role: "assistant",
            pending,
            turn: nextEnvelope,
          }));
        };

        const effectiveAuthToken = authToken ?? readClientToken();
        const recentMessages = !effectiveAuthToken ? buildRecentMessages(messages) : undefined;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (effectiveAuthToken) {
          headers.Authorization = `Bearer ${effectiveAuthToken}`;
        }

        const response = await fetch(`${API_BASE}/ai/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...(conversationId ? { conversationId } : {}),
            input: nextInput,
            trace: false,
            context: {
              client: "web",
              locale: "zh-CN",
              timezone: "Asia/Shanghai",
              platformVersion: "web-vnext",
              ...(clientLocation
                ? {
                    lat: clientLocation.lat,
                    lng: clientLocation.lng,
                  }
                : {}),
              ...(recentMessages && recentMessages.length > 0
                ? {
                    recentMessages,
                  }
                : {}),
              ...(contextOverrides || {}),
            },
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(await readChatResponseErrorMessage(response));
        }

        const uiStreamState: {
          metadata: ChatStreamMessageMetadata;
          started: boolean;
          textPartStarted: boolean;
          assistantText: string;
          textBlocks: GenUITextBlock[];
        } = {
          metadata: {
            traceId: randomId("trace"),
            conversationId: conversationId ?? randomId("conv"),
            responseId: randomId("turn"),
            status: "streaming",
          },
          started: false,
          textPartStarted: false,
          assistantText: "",
          textBlocks: [],
        };
        const uiChunkStream = new ReadableStream<ChatStreamChunk>({
          start(controller) {
            uiChunkController = controller;
            closeUiChunkStream = () => {
              controller.close();
            };
            errorUiChunkStream = (reason) => {
              controller.error(reason);
            };
          },
        });
        const enqueueChunk = (chunk: ChatStreamChunk) => {
          uiChunkController?.enqueue(chunk);
        };
        const startAssistantUiMessage = () => {
          if (uiStreamState.started) {
            return;
          }

          enqueueChunk({
            type: "start",
            messageId: assistantMessageId,
            messageMetadata: uiStreamState.metadata,
          });
          uiStreamState.started = true;
        };
        const updateAssistantUiMetadata = (
          patch: Partial<ChatStreamMessageMetadata>
        ) => {
          uiStreamState.metadata = {
            ...uiStreamState.metadata,
            ...patch,
          };
          startAssistantUiMessage();
          enqueueChunk({
            type: "message-metadata",
            messageMetadata: uiStreamState.metadata,
          });
        };
        const ensureTextPartStarted = () => {
          if (uiStreamState.textPartStarted) {
            return;
          }

          startAssistantUiMessage();
          enqueueChunk({
            type: "text-start",
            id: `${assistantMessageId}_text`,
          });
          uiStreamState.textPartStarted = true;
        };
        const syncAssistantTextBlock = async (
          block: GenUITextBlock,
          mode: "append" | "replace"
        ) => {
          uiStreamState.textBlocks = upsertBlockWithMode(
            uiStreamState.textBlocks,
            block,
            mode
          ).blocks.filter((item): item is GenUITextBlock => item.type === "text");

          const nextAssistantText = uiStreamState.textBlocks
            .map((item) => item.content)
            .filter(Boolean)
            .join("\n\n");

          if (nextAssistantText === uiStreamState.assistantText) {
            return;
          }

          if (!nextAssistantText.startsWith(uiStreamState.assistantText)) {
            uiStreamState.assistantText = nextAssistantText;
            updateAssistantUiMetadata({
              assistantTextOverride: nextAssistantText,
            });
            return;
          }

          const deltaText = nextAssistantText.slice(uiStreamState.assistantText.length);
          if (!deltaText) {
            return;
          }

          ensureTextPartStarted();
          await enqueueSimulatedTextDeltaChunks(enqueueChunk, {
            textPartId: `${assistantMessageId}_text`,
            deltaText,
          });
          uiStreamState.assistantText = nextAssistantText;
        };
        const appendStructuredBlockToUiMessage = (
          block: GenUIBlock,
          mode: "append" | "replace"
        ) => {
          startAssistantUiMessage();
          enqueueChunk({
            type: "data-genui_block",
            id: block.blockId,
            data: {
              block,
              mode,
            },
          });
        };
        uiMessageReader = (async () => {
          for await (const streamMessage of readUIMessageStream<ChatStreamMessage>({
            stream: uiChunkStream,
            terminateOnError: true,
          })) {
            const nextEnvelope = buildEnvelopeFromStreamMessage(streamMessage);
            setConversationId(nextEnvelope.conversationId);
            // v5.5: 一旦有内容（特别是文字），立即隐藏 loading，打字机效果和 loading 互斥
            const hasTextContent = nextEnvelope.response.blocks.some(
              (b) => b.type === "text" && typeof b.content === "string" && b.content.trim().length > 0
            );
            applyEnvelope(nextEnvelope, !hasTextContent && nextEnvelope.response.status !== "completed");
          }
        })();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawResponseComplete = false;

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
              payload = JSON.parse(parsed.dataText);
            } catch {
              payload = { raw: parsed.dataText };
            }

            const eventName =
              isRecord(payload) && typeof payload.event === "string"
                ? payload.event
                : parsed.eventName;
            const eventData = readStreamEventData(payload);

            if (eventName === "response-start" && isRecord(eventData)) {
              const traceId =
                typeof eventData.traceId === "string"
                  ? eventData.traceId
                  : randomId("trace");
              const streamConversationId =
                typeof eventData.conversationId === "string"
                  ? eventData.conversationId
                  : conversationId ?? randomId("conv");
              const responseId =
                typeof eventData.responseId === "string"
                  ? eventData.responseId
                  : randomId("response");

              setConversationId(streamConversationId);
              updateAssistantUiMetadata({
                traceId,
                conversationId: streamConversationId,
                responseId,
                status: "streaming",
                assistantTextOverride: undefined,
              });
            }

            if (
              (eventName === "block-append" || eventName === "block-replace") &&
              isRecord(eventData) &&
              isGenUIBlock(eventData.block)
            ) {
              const block = eventData.block;
              const mode = eventName === "block-replace" ? "replace" : "append";
              if (block.type === "text") {
                await syncAssistantTextBlock(block, mode);
              } else {
                appendStructuredBlockToUiMessage(block, mode);
              }
            }

            if (eventName === "response-status" && isRecord(eventData)) {
              const statusText =
                eventData.status === "streaming" ||
                eventData.status === "completed" ||
                eventData.status === "error"
                  ? eventData.status
                  : null;
              if (statusText) {
                updateAssistantUiMetadata({
                  status: statusText,
                });
              }
            }

            if (eventName === "response-complete" && isGenUIResponseEnvelope(eventData)) {
              const completeEnvelope = eventData;
              sawResponseComplete = true;
              setConversationId(completeEnvelope.conversationId);
              updateAssistantUiMetadata({
                traceId: completeEnvelope.traceId,
                conversationId: completeEnvelope.conversationId,
                responseId: completeEnvelope.response.responseId,
                status: completeEnvelope.response.status,
                suggestions: completeEnvelope.response.suggestions,
              });

              const finalAssistantText = completeEnvelope.response.blocks
                .filter((block): block is GenUITextBlock => block.type === "text")
                .map((block) => block.content)
                .filter(Boolean)
                .join("\n\n");
              if (
                finalAssistantText &&
                finalAssistantText !== uiStreamState.assistantText
              ) {
                if (finalAssistantText.startsWith(uiStreamState.assistantText)) {
                  ensureTextPartStarted();
                  await enqueueSimulatedTextDeltaChunks(enqueueChunk, {
                    textPartId: `${assistantMessageId}_text`,
                    deltaText: finalAssistantText.slice(uiStreamState.assistantText.length),
                  });
                } else {
                  updateAssistantUiMetadata({
                    assistantTextOverride: finalAssistantText,
                  });
                }
                uiStreamState.assistantText = finalAssistantText;
              }
            }

            if (eventName === "response-error" && isRecord(eventData)) {
              const message =
                typeof eventData.message === "string"
                  ? normalizeChatErrorMessage(eventData.message)
                  : "生成失败，请稍后再试";
              throw new Error(message);
            }

            separatorIndex = buffer.indexOf("\n\n");
          }
        }

        if (!sawResponseComplete) {
          updateAssistantUiMetadata({
            status: "completed",
          });
        }

        if (uiStreamState.textPartStarted) {
          enqueueChunk({
            type: "text-end",
            id: `${assistantMessageId}_text`,
          });
        }
        startAssistantUiMessage();
        enqueueChunk({
          type: "finish",
          finishReason: "stop",
          messageMetadata: uiStreamState.metadata,
        });
        closeUiChunkStream();
        await uiMessageReader;

        const completedEnvelope = streamState.envelope;
        if (completedEnvelope) {
          applyEnvelope(completedEnvelope, false);
          applyCompletionEffectsFromBlocks(completedEnvelope.response.blocks);
          void refreshCurrentTasks(effectiveAuthToken);
        }
      } catch (error) {
        errorUiChunkStream(error);
        if (uiMessageReader) {
          await uiMessageReader.catch(() => undefined);
        }

        const errorMessage = normalizeChatErrorMessage(
          error instanceof Error ? error.message : "请求失败，请稍后再试"
        );

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
    [applyCompletionEffectsFromBlocks, authToken, clientLocation, conversationId, isSending, messages, refreshCurrentTasks]
  );

  const resumeStructuredPendingAction = useCallback(async () => {
    const nextToken = readClientToken();
    if (!pendingAgentAction) {
      return;
    }

    if (!nextToken) {
      setPendingActionNotice(
        pendingAgentAction.action.authMode === "bind_phone"
          ? "先完成绑定手机号，再回到这里继续这一步。"
          : "先完成登录，再回到这里继续这一步。"
      );
      return;
    }

    setAuthToken(nextToken);
    const actionToResume = pendingAgentAction.action;
    setPendingAgentAction(null);
    setPendingActionNotice(null);

    await sendChatRequest(
      {
        type: "action",
        action: actionToResume.action,
        actionId: randomId("action"),
        params: actionToResume.payload,
        displayText: actionToResume.originalText || "继续刚才那步",
      },
      actionToResume.originalText || "继续刚才那步"
    );
  }, [pendingAgentAction, sendChatRequest]);

  useEffect(() => {
    if (!authToken || !pendingAgentAction || isSending || hasResumedPendingActionRef.current) {
      return;
    }

    hasResumedPendingActionRef.current = true;
    void resumeStructuredPendingAction().finally(() => {
      hasResumedPendingActionRef.current = false;
    });
  }, [authToken, isSending, pendingAgentAction, resumeStructuredPendingAction]);

  const handleSubmit = useCallback(
    async ({ text }: { text: string }) => {
      const value = text.trim();
      if (!value || isSending) {
        return;
      }

      setInput("");
      await sendChatRequest(
        {
          type: "text",
          text: value,
        },
        value
      );
    },
    [isSending, sendChatRequest]
  );

  const handleActionSelect = useCallback(
    async (option: ActionOption) => {
      if (isSending) {
        return;
      }

      await sendChatRequest(
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
    [isSending, sendChatRequest]
  );

  const handleRuntimeTaskAction = useCallback(
    async (taskAction: RuntimeTaskAction) => {
      if (isSending) {
        return;
      }

      if (taskAction.kind === "switch_tab") {
        const matchId =
          isRecord(taskAction.payload) && typeof taskAction.payload.matchId === "string"
            ? taskAction.payload.matchId
            : null;

        if (taskAction.url) {
          const resolved = resolveMiniProgramUrlToWeb(taskAction.url);
          if (resolved && "openMessageCenter" in resolved) {
            setMessageCenterFocusMatchId(matchId ?? resolved.matchId ?? null);
            setMessageCenterOpenSignal((value) => value + 1);
            return;
          }
        }

        setMessageCenterFocusMatchId(matchId);
        setMessageCenterOpenSignal((value) => value + 1);
        return;
      }

      if (taskAction.kind === "navigate") {
        if (taskAction.url && typeof window !== "undefined") {
          const resolved = resolveMiniProgramUrlToWeb(taskAction.url);
          if (resolved && "webUrl" in resolved) {
            window.location.href = resolved.webUrl;
            return;
          }
        }

        const activityId = readActivityIdFromRuntimeTaskAction(taskAction);
        if (!activityId || typeof window === "undefined") {
          return;
        }

        window.location.href = buildActivityDetailPath(activityId, {
          entry: readEntryFromRuntimeTaskAction(taskAction),
        });
        return;
      }

      if (taskAction.action === "start_follow_up_chat" && isRecord(taskAction.payload)) {
        const prompt =
          typeof taskAction.payload.prompt === "string" && taskAction.payload.prompt.trim()
            ? taskAction.payload.prompt.trim()
            : "";
        if (!prompt) {
          return;
        }

        await sendChatRequest(
          {
            type: "text",
            text: prompt,
          },
          taskAction.originalText || taskAction.label,
          readActivityContextOverridesFromTaskAction(taskAction)
        );
        return;
      }

      if (!taskAction.action) {
        return;
      }

      await sendChatRequest(
        {
          type: "action",
          action: taskAction.action,
          actionId: randomId("action"),
          params: taskAction.payload,
          displayText: taskAction.originalText || taskAction.label,
        },
        taskAction.originalText || taskAction.label
      );
    },
    [isSending, sendChatRequest]
  );

  return (
    <div
      className={cn(
        "relative min-h-screen overflow-hidden [font-family:SF_Pro_Display,SF_Pro_Text,PingFang_SC,-apple-system,BlinkMacSystemFont,Segoe_UI,sans-serif]",
        isDarkMode
          ? messages.length === 0
            ? "bg-[#090909]"
            : "bg-black"
          : "bg-white"
      )}
    >
      <ChatThemeContext.Provider value={isDarkMode}>
      <div className={cn("relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col", isDarkMode ? "text-zinc-100" : "text-slate-900")}>
        <MessageCenterDrawer
          disabled={isSending}
          isDarkMode={isDarkMode}
          openSignal={messageCenterOpenSignal}
          focusPendingMatchId={messageCenterFocusMatchId}
          trigger={null}
          onSendPrompt={async (prompt, displayText, contextOverrides) => {
            await sendChatRequest(
              {
                type: "text",
                text: prompt,
              },
              displayText || prompt,
              contextOverrides
            );
          }}
        />

        <header className="flex shrink-0 items-center justify-between px-5 pb-2 pt-6">
          <div className="flex items-center gap-2.5">
            <SidebarDrawer
              disabled={isSending}
              isDarkMode={isDarkMode}
              activeConversationId={conversationId}
              currentTasks={currentTasks}
              currentTasksLoading={isCurrentTasksLoading}
              ui={welcomeUi.sidebar}
              onSelectConversation={handleSelectConversation}
              onSelectTaskAction={handleRuntimeTaskAction}
              onOpenMessageCenter={() => {
                setMessageCenterFocusMatchId(null);
                setMessageCenterOpenSignal((value) => value + 1);
              }}
            />
            <div className="flex flex-col">
              <p className={cn("text-[20px] font-semibold tracking-[-0.04em]", isDarkMode ? "text-white/96" : "text-black/92")}>xu</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsDarkMode((current) => !current)}
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-sm transition-all",
                  isDarkMode
                    ? "border-white/8 bg-white/[0.035] text-white/80 hover:bg-white/[0.06]"
                    : "border-black/10 bg-white text-black/74 hover:bg-black/[0.03]"
              )}
              aria-label={isDarkMode ? "切换到明亮模式" : "切换到暗色模式"}
              title={isDarkMode ? "切换到明亮模式" : "切换到暗色模式"}
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleStartNewConversation}
              disabled={isSending}
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-sm transition-all disabled:opacity-45",
                isDarkMode
                  ? "border-white/8 bg-white/[0.035] text-white/84 hover:bg-white/[0.06]"
                  : "border-black/10 bg-white text-black/78 hover:bg-black/[0.03]"
              )}
              aria-label="开始新对话"
              title="开始新对话"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </header>

        {pendingAgentAction && homeState !== "H1" ? (
          <div className="shrink-0 space-y-2 px-3 pb-2">
            {pendingAgentAction ? (
              <section
                className={cn(
                  "rounded-[24px] border px-4 py-3 shadow-[0_20px_36px_-30px_rgba(0,0,0,0.78)]",
                  isDarkMode
                    ? "border-white/10 bg-white/[0.04] text-white/88"
                    : "border-black/10 bg-white text-black/88"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-[12px] font-semibold tracking-wide">{welcomeUi.chatShell.pendingActionTitle}</p>
                    <p className="text-sm font-medium">
                      {pendingAgentAction.message || welcomeUi.chatShell.pendingActionDefaultMessage}
                    </p>
                    <p className={cn("text-xs leading-5", isDarkMode ? "text-white/54" : "text-black/52")}>
                      {pendingAgentAction.action.authMode === "bind_phone"
                        ? welcomeUi.chatShell.pendingActionBindPhoneHint
                        : welcomeUi.chatShell.pendingActionLoginHint}
                    </p>
                    {pendingActionNotice ? (
                      <p className={cn("text-xs", isDarkMode ? "text-white/54" : "text-black/52")}>{pendingActionNotice}</p>
                    ) : null}
                  </div>
                  {authToken ? (
                    <button
                      type="button"
                      onClick={() => {
                        void resumeStructuredPendingAction();
                      }}
                      disabled={isSending}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
                        isDarkMode ? "bg-white text-[#111111] hover:bg-white/92" : "bg-black text-white hover:bg-black/92"
                      )}
                    >
                      {welcomeUi.chatShell.pendingActionResumeLabel}
                    </button>
                  ) : (
                    <AuthSheet
                      mode={pendingAgentAction.action.authMode ?? "login"}
                      isDarkMode={isDarkMode}
                      reason={pendingAgentAction.message || welcomeUi.chatShell.pendingActionDefaultMessage}
                      onAuthenticated={async () => {
                        setPendingActionNotice(null);
                        setAuthToken(readClientToken());
                      }}
                      trigger={
                        <button
                          type="button"
                          disabled={isSending}
                          className={cn(
                            "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
                            isDarkMode ? "bg-white text-[#111111] hover:bg-white/92" : "bg-black text-white hover:bg-black/92"
                          )}
                        >
                          {welcomeUi.chatShell.pendingActionResumeLabel}
                        </button>
                      }
                    />
                  )}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1">
          {messages.length > 0 ? (
            <>
              <div className={cn("pointer-events-none absolute inset-x-0 top-0 z-10 h-14 bg-gradient-to-b to-transparent", isDarkMode ? "from-black via-black/70" : "from-white via-white/88")} />
              <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t to-transparent", isDarkMode ? "from-black via-black/82" : "from-white via-white/92")} />
            </>
          ) : null}
          <Conversation className="relative h-full">
            <ConversationContent
              className={cn(
                "w-full gap-4 px-3 pb-4 pt-1",
                messages.length > 0 &&
                  (isDarkMode
                    ? "[scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/12 [&::-webkit-scrollbar-thumb:hover]:bg-white/20"
                    : "[scrollbar-color:rgba(0,0,0,0.16)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/12 [&::-webkit-scrollbar-thumb:hover]:bg-black/20")
              )}
            >
            {messages.length === 0 ? (
              <ConversationEmptyState className="justify-start px-4 pt-3">
                <div className="relative min-h-[544px] w-full overflow-visible pt-[128px]">
                  <div
                    className={cn(
                      "pointer-events-none absolute left-1/2 z-0 -translate-x-1/2",
                      isDarkMode
                        ? "top-[-8px] h-[356px] w-[356px]"
                        : "top-[10px] h-[312px] w-[312px]"
                    )}
                  >
                    <Orb
                      hue={1}
                      hoverIntensity={0.2}
                      rotateOnHover={false}
                      forceHoverState={false}
                      backgroundColor={isDarkMode ? "#000000" : "#ffffff"}
                    />
                  </div>
                  <div
                    className={cn(
                      "pointer-events-none absolute left-1/2 z-0 -translate-x-1/2",
                      isDarkMode
                        ? "top-[140px] h-44 w-[368px] bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.56)_0%,rgba(0,0,0,0.22)_48%,transparent_78%)]"
                        : "top-[126px] h-36 w-[320px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.95)_0%,rgba(255,255,255,0.68)_46%,transparent_80%)]"
                    )}
                  />

                  <div className="relative z-10 mx-auto max-w-[340px] text-center">
                    {isWelcomeLoading ? (
                      <div className="space-y-3 pt-1">
                        <div className="mx-auto h-10 w-36 animate-pulse rounded-full bg-white/10" />
                        <div className="mx-auto h-10 w-64 max-w-[78vw] animate-pulse rounded-full bg-white/10" />
                        <div className="mx-auto h-10 w-52 animate-pulse rounded-full bg-white/10" />
                      </div>
                    ) : (
                      <>
                        {visibleWelcomeFocus ? (
                          <button
                            type="button"
                            onClick={() => {
                              void sendChatRequest(
                                {
                                  type: "text",
                                  text: visibleWelcomeFocus.prompt,
                                },
                                visibleWelcomeFocus.prompt
                              );
                            }}
                            className={cn(
                              "mb-7 inline-flex max-w-[300px] items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12px] font-medium tracking-[-0.01em] backdrop-blur-md transition-all",
                              isDarkMode
                                ? "border-white/10 bg-white/[0.035] text-white/64 hover:bg-white/[0.07] hover:text-white/80"
                                : "border-black/10 bg-white text-black/58 hover:bg-black/[0.03] hover:text-black/78"
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", isDarkMode ? "bg-white/42" : "bg-black/36")} />
                            <span className="truncate">{visibleWelcomeFocus.label}</span>
                            <ChevronRight className={cn("h-3 w-3 shrink-0", isDarkMode ? "text-white/24" : "text-black/24")} />
                          </button>
                        ) : null}
                        <div>
                          <p className={cn(
                            "mx-auto max-w-[320px] text-balance font-semibold leading-[0.98] tracking-[-0.058em] transition-all duration-300",
                            homeState === "H0"
                              ? "text-[38px]"
                              : "text-[22px]",
                            homeState === "H0"
                              ? isDarkMode
                                ? "text-white/97 drop-shadow-[0_2px_14px_rgba(0,0,0,0.42)]"
                                : "text-black/92"
                              : isDarkMode
                                ? "text-white/58"
                                : "text-black/52"
                          )}>{welcomeGreeting}</p>
                        </div>
                      </>
                    )}
                  </div>

                  {homeState !== "H0" && primaryHomeTask ? (
                    <div className="relative z-10 mx-auto mt-8 w-full max-w-[348px] px-4">
                      <HomeStateCard
                        task={primaryHomeTask}
                        homeState={homeState}
                        isDarkMode={isDarkMode}
                        disabled={isSending}
                        onAction={handleRuntimeTaskAction}
                      />
                    </div>
                  ) : null}

                  <div className={cn("relative z-10 space-y-3", homeState === "H0" ? "mt-12" : "mt-6")}>
                    {homeState === "H0" && authToken && (isCurrentTasksLoading || visibleCurrentTasks.length > 0) ? (
                      <section
                        className={cn(
                          "mx-auto mb-4 w-full max-w-[348px] rounded-[28px] border px-4 py-4 text-left",
                          isDarkMode
                            ? "border-white/10 bg-white/[0.04] shadow-[0_20px_36px_-30px_rgba(0,0,0,0.78)]"
                            : "border-black/8 bg-white shadow-[0_18px_36px_-30px_rgba(0,0,0,0.12)]"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={cn("text-[12px] font-semibold tracking-wide", isDarkMode ? "text-white/54" : "text-black/48")}>
                              {welcomeUi.sidebar.currentTasksTitle}
                            </p>
                            <p className={cn("mt-1 text-xs leading-5", isDarkMode ? "text-white/42" : "text-black/40")}>
                              {welcomeUi.sidebar.currentTasksDescriptionAuthenticated}
                            </p>
                          </div>
                          <Clock3 className={cn("mt-0.5 h-4 w-4 shrink-0", isDarkMode ? "text-white/34" : "text-black/32")} />
                        </div>

                        <div className="mt-4 space-y-2.5">
                          {isCurrentTasksLoading
                            ? [0, 1].map((item) => (
                                <div
                                  key={`empty-task-skeleton-${item}`}
                                  className={cn(
                                    "h-[92px] animate-pulse rounded-[22px] border",
                                    isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-black/[0.03]"
                                  )}
                                />
                              ))
                            : visibleCurrentTasks.map((task) => (
                                <div
                                  key={task.id}
                                  className={cn(
                                    "rounded-[22px] border px-4 py-3",
                                    isDarkMode ? "border-white/8 bg-white/[0.03]" : "border-black/8 bg-black/[0.025]"
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className={cn("truncate text-[15px] font-semibold tracking-[-0.02em]", isDarkMode ? "text-white/88" : "text-black/84")}>
                                        {task.headline}
                                      </p>
                                      <p className={cn("mt-1 text-xs", isDarkMode ? "text-white/40" : "text-black/38")}>
                                        {task.taskTypeLabel} · {task.stageLabel}
                                      </p>
                                    </div>
                                    <span
                                      className={cn(
                                        "shrink-0 rounded-full border px-2.5 py-1 text-[11px]",
                                        isDarkMode
                                          ? "border-white/8 bg-white/[0.03] text-white/46"
                                          : "border-black/8 bg-white text-black/42"
                                      )}
                                    >
                                      {task.stageLabel}
                                    </span>
                                  </div>

                                  <p className={cn("mt-3 text-sm leading-6", isDarkMode ? "text-white/66" : "text-black/62")}>
                                    {task.summary}
                                  </p>

                                  {task.primaryAction || task.secondaryAction ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {task.primaryAction ? (
                                        <button
                                          type="button"
                                          disabled={isSending}
                                          onClick={() => {
                                            void handleRuntimeTaskAction(task.primaryAction!);
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
                                          disabled={isSending}
                                          onClick={() => {
                                            void handleRuntimeTaskAction(task.secondaryAction!);
                                          }}
                                          className={cn(
                                            "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
                                            isDarkMode
                                              ? "border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.05]"
                                              : "border-black/10 bg-white text-black/76 hover:bg-black/[0.045]"
                                          )}
                                        >
                                          {task.secondaryAction.label}
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                        </div>
                      </section>
                    ) : null}

                    {homeState === "H0" && (isWelcomeLoading
                      ? [0.82, 0.7, 0.76].map((widthRatio, index) => (
                          <div
                            key={`welcome-skeleton-${index}`}
                            className={cn(
                              "mx-auto flex w-full max-w-[348px] items-center gap-3.5 rounded-[26px] border px-5 py-4.5",
                              isDarkMode
                                ? "border-white/8 bg-white/[0.03]"
                                : "border-black/8 bg-white shadow-[0_18px_36px_-30px_rgba(0,0,0,0.12)]"
                            )}
                          >
                            <div
                              className={cn(
                                "inline-flex h-6 w-6 shrink-0 animate-pulse rounded-full",
                                isDarkMode ? "bg-white/10" : "bg-black/[0.06]"
                              )}
                            />
                            <div
                              className={cn("h-4 animate-pulse rounded-full", isDarkMode ? "bg-white/10" : "bg-black/[0.06]")}
                              style={{ width: `${widthRatio * 100}%` }}
                            />
                            <div
                              className={cn(
                                "h-4 w-4 shrink-0 animate-pulse rounded-full",
                                isDarkMode ? "bg-white/10" : "bg-black/[0.06]"
                              )}
                            />
                          </div>
                        ))
                      : quickPrompts.slice(0, 3).map((entry, index) => (
                          <button
                            key={`${entry.action ?? "prompt"}-${entry.prompt}`}
                            type="button"
                            onClick={() => {
                              void sendChatRequest(
                                entry.action
                                  ? {
                                      type: "action",
                                      action: entry.action,
                                      actionId: randomId("action"),
                                      params: entry.params,
                                      displayText: entry.prompt,
                                    }
                                  : {
                                      type: "text",
                                      text: entry.prompt,
                                    },
                                entry.prompt
                              );
                            }}
                            className={cn(
                              "mx-auto flex w-full max-w-[348px] items-center gap-3.5 rounded-[26px] border px-5 py-4.5 text-left text-[17px] backdrop-blur-md transition-all duration-200",
                              isDarkMode
                                ? "border-white/10 bg-white/[0.035] text-white/92 hover:bg-white/[0.06]"
                                : "border-black/8 bg-white text-black/86 shadow-[0_18px_36px_-32px_rgba(0,0,0,0.14)] hover:bg-black/[0.02] hover:shadow-[0_22px_42px_-34px_rgba(0,0,0,0.16)]"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                                isDarkMode
                                  ? "border-white/8 bg-white/[0.02] text-white/42"
                                  : "border-black/8 bg-black/[0.025] text-black/42"
                              )}
                            >
                              {index + 1}
                            </span>
                            <span className={cn("flex-1 break-words pr-2 text-[15px] font-medium leading-[1.3] tracking-[-0.02em]", isDarkMode ? "text-white/88" : "text-black/80")}>
                              {entry.text}
                            </span>
                            <ChevronRight className={cn("h-4 w-4 shrink-0", isDarkMode ? "text-white/14" : "text-black/16")} />
                          </button>
                        )))}
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
        </div>

        <div
          className={cn(
            "shrink-0 px-4 pb-[calc(14px+env(safe-area-inset-bottom,0px))] pt-2",
            isDarkMode ? "bg-black" : "bg-white"
          )}
        >
          <div className={cn("mx-auto w-full", messages.length === 0 ? "max-w-[356px]" : "max-w-none")}>
            {messages.length === 0 ? (
              <BorderGlow
                className="rounded-[28px]"
                edgeSensitivity={30}
                glowColor="40 80 80"
                backgroundColor={isDarkMode ? "#060010" : "#ffffff"}
                borderColor={isDarkMode ? "rgb(255 255 255 / 0.15)" : "#ffffff"}
                borderRadius={28}
                glowRadius={isDarkMode ? 40 : 30}
                glowIntensity={isDarkMode ? 1 : 0.82}
                coneSpread={25}
                fillOpacity={isDarkMode ? 0.5 : 0.03}
                baseShadow={
                  isDarkMode
                    ? `rgba(0, 0, 0, 0.1) 0px 1px 2px,
                      rgba(0, 0, 0, 0.1) 0px 2px 4px,
                      rgba(0, 0, 0, 0.1) 0px 4px 8px,
                      rgba(0, 0, 0, 0.1) 0px 8px 16px,
                      rgba(0, 0, 0, 0.1) 0px 16px 32px,
                      rgba(0, 0, 0, 0.1) 0px 32px 64px`
                    : "none"
                }
                animated
                colors={["#c084fc", "#f472b6", "#38bdf8"]}
              >
                <PromptInput
                  onSubmit={handleSubmit}
                  className={cn(
                    "relative rounded-3xl border border-transparent bg-transparent p-0 has-[[data-slot=input-group-control]:focus-visible]:!ring-0 has-[[data-slot=input-group-control]:focus-visible]:!border-transparent [&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:px-2 [&_[data-slot=input-group]]:py-1.5 [&_[data-slot=input-group]]:focus-within:!ring-0 [&_[data-slot=input-group]]:focus-within:!border-transparent",
                    isDarkMode
                      ? "[&_[data-slot=input-group]]:rounded-[30px] [&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:border-white/8 [&_[data-slot=input-group]]:bg-[#101012]/92 [&_[data-slot=input-group]]:shadow-[0_0_0_1px_rgba(255,255,255,0.015),0_24px_60px_-30px_rgba(0,0,0,0.82)]"
                      : "[&_[data-slot=input-group]]:rounded-[28px] [&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:border-white [&_[data-slot=input-group]]:bg-white [&_[data-slot=input-group]]:shadow-none"
                  )}
                >
                  <PromptInputTextarea
                    value={input}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setInput(nextValue);
                      syncComposerHeight(event.currentTarget, nextValue);
                    }}
                    rows={1}
                    placeholder={welcomeUi.composerPlaceholder}
                    disabled={isSending}
                    className={cn(
                      "!max-h-none !min-h-0 flex-1 border-none bg-transparent px-3 py-2 text-[16px] leading-5 focus-visible:ring-0 focus-visible:outline-none",
                      isDarkMode ? "text-white/94 placeholder:text-white/34" : "text-black/88 placeholder:text-black/30",
                      showComposerHint ? "h-auto overflow-hidden" : "h-9 overflow-hidden"
                    )}
                  />

                  <PromptInputFooter
                    align={showComposerHint ? "block-end" : "inline-end"}
                    className={cn(
                      "items-center gap-2",
                      showComposerHint ? "justify-between !px-2 !pt-1 !pb-1" : "justify-end pr-1"
                    )}
                  >
                    {showComposerHint ? (
                      <span className={cn("text-xs leading-5", isDarkMode ? "text-white/24" : "text-black/28")}>
                        {welcomeUi.chatShell.composerHint}
                      </span>
                    ) : null}
                    <PromptInputSubmit
                      status={isSending ? "submitted" : "ready"}
                      disabled={isSending || !input.trim()}
                      variant="ghost"
                      className={cn(
                        "h-10 w-10 rounded-full border p-0 backdrop-blur-sm focus-visible:ring-0 focus-visible:outline-none disabled:opacity-35",
                        isDarkMode
                          ? "border-black/5 bg-white text-[#111111] shadow-[0_10px_24px_-16px_rgba(255,255,255,0.28)] hover:bg-white/92"
                          : "border-white bg-black text-white shadow-none hover:bg-black/92"
                      )}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </PromptInputSubmit>
                  </PromptInputFooter>
                </PromptInput>
              </BorderGlow>
            ) : (
              <PromptInput
                onSubmit={handleSubmit}
                className={cn(
                  "relative rounded-3xl border border-transparent bg-transparent p-0 has-[[data-slot=input-group-control]:focus-visible]:!ring-0 has-[[data-slot=input-group-control]:focus-visible]:!border-transparent [&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:rounded-[24px] [&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:px-2 [&_[data-slot=input-group]]:py-1.5 [&_[data-slot=input-group]]:focus-within:!ring-0 [&_[data-slot=input-group]]:focus-within:!border-transparent",
                  isDarkMode
                    ? "[&_[data-slot=input-group]]:border-white/10 [&_[data-slot=input-group]]:bg-[#0f0f11] [&_[data-slot=input-group]]:shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_18px_36px_-24px_rgba(0,0,0,0.82)]"
                    : "[&_[data-slot=input-group]]:border-black/10 [&_[data-slot=input-group]]:bg-white [&_[data-slot=input-group]]:shadow-[0_0_0_1px_rgba(0,0,0,0.03),0_18px_36px_-28px_rgba(0,0,0,0.12)]"
                )}
              >
                <PromptInputTextarea
                  value={input}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setInput(nextValue);
                    syncComposerHeight(event.currentTarget, nextValue);
                  }}
                  rows={1}
                  placeholder={welcomeUi.composerPlaceholder}
                  disabled={isSending}
                  className={cn(
                    "!max-h-none !min-h-0 flex-1 border-none bg-transparent px-3 py-2 text-[16px] leading-5 focus-visible:ring-0 focus-visible:outline-none",
                    isDarkMode ? "text-white/92 placeholder:text-white/28" : "text-black/88 placeholder:text-black/30",
                    showComposerHint ? "h-auto overflow-hidden" : "h-9 overflow-hidden"
                  )}
                />

                <PromptInputFooter
                  align={showComposerHint ? "block-end" : "inline-end"}
                  className={cn(
                    "items-center gap-2",
                    showComposerHint ? "justify-between !px-2 !pt-1 !pb-1" : "justify-end pr-1"
                  )}
                >
                  {showComposerHint ? (
                    <span className={cn("text-xs leading-5", isDarkMode ? "text-white/24" : "text-black/28")}>
                      {welcomeUi.chatShell.composerHint}
                    </span>
                  ) : null}
                  <PromptInputSubmit
                    status={isSending ? "submitted" : "ready"}
                    disabled={isSending || !input.trim()}
                    variant="ghost"
                    className={cn(
                      "h-10 w-10 rounded-full border-0 p-0 backdrop-blur-sm focus-visible:ring-0 focus-visible:outline-none disabled:opacity-35",
                      isDarkMode
                        ? "bg-[#111111] text-white shadow-[0_10px_30px_-18px_rgba(0,0,0,0.7)] hover:bg-black"
                        : "bg-black text-white shadow-[0_10px_30px_-18px_rgba(0,0,0,0.28)] hover:bg-black/88"
                    )}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </PromptInputSubmit>
                </PromptInputFooter>
              </PromptInput>
            )}
          </div>
        </div>
      </div>
      </ChatThemeContext.Provider>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  const isDarkMode = useChatTheme();
  return (
    <Message from="user" className="max-w-[82%] pt-4">
      <MessageContent className={cn(
        "rounded-[18px] rounded-tr-[8px] px-4 py-3",
        isDarkMode
          ? "bg-white/[0.08] text-white"
          : "bg-black/[0.06] text-black"
      )}>
        <MessageResponse className={cn("text-[15px] leading-6", isDarkMode ? "text-white/96" : "text-black/90")}>{text}</MessageResponse>
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
  const isDarkMode = useChatTheme();
  const renderableBlocks = message.response ? getRenderableBlocks(message.response.response.blocks) : [];
  const hasRenderableBlocks = renderableBlocks.length > 0;
  // 非最后一条消息或正在发送中时，禁用交互
  const isDisabled = disabled || !isLast;

  return (
    <Message from="assistant" className="w-full max-w-none pr-0">
      <MessageContent className={cn("w-full overflow-visible rounded-none bg-transparent px-0 py-0 shadow-none", isDarkMode ? "text-zinc-100" : "text-slate-900")}>
        {message.error ? (
          <p className={cn("text-sm", isDarkMode ? "text-white/68" : "text-black/56")}>{message.error}</p>
        ) : hasRenderableBlocks ? (
          <div className="space-y-3">
            {renderableBlocks.map((block) => (
              <TurnBlockRenderer
                key={block.blockId}
                block={block}
                disabled={isDisabled}
                onActionSelect={onActionSelect}
              />
            ))}
            {message.pending && isLast ? <ThinkingDots /> : null}
          </div>
        ) : message.pending && isLast ? (
          <ThinkingDots />
        ) : (
          <p className={cn("text-sm", isDarkMode ? "text-white/45" : "text-black/42")}>这条消息暂时没有可展示内容</p>
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
  const isDarkMode = useChatTheme();
  if (block.type === "text") {
    return (
      <MessageResponse className={cn("w-full max-w-none text-[15px] leading-7", isDarkMode ? "text-white/88" : "text-black/78")}>
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
    return (
      <ListBlockCard
        block={block}
        disabled={disabled}
        onActionSelect={onActionSelect}
      />
    );
  }

  if (block.type === "form") {
    return (
      <FormBlockCard
        block={block}
        disabled={disabled}
        onActionSelect={onActionSelect}
      />
    );
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
    <p className={cn("text-xs", isDarkMode ? "text-white/42" : "text-black/40")}>这条内容正在整理展示中。</p>
  );
}

function GenUICardHeader({
  eyebrow,
  title,
  description,
  trailingLabel,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  trailingLabel?: string;
  className?: string;
}) {
  const isDarkMode = useChatTheme();
  return (
    <div className={cn("mb-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className={cn("mb-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-[-0.01em]", isDarkMode ? "border-white/8 bg-white/[0.03] text-white/52" : "border-black/8 bg-black/[0.035] text-black/44")}>
          <Sparkles className="h-3.5 w-3.5" />
          <span>{eyebrow}</span>
        </div>
        {trailingLabel ? (
          <div className={cn("shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-[-0.01em]", isDarkMode ? "border-white/8 bg-white/[0.03] text-white/42" : "border-black/8 bg-black/[0.035] text-black/36")}>
            {trailingLabel}
          </div>
        ) : null}
      </div>
      <p className={cn("text-[15px] font-semibold tracking-[0.01em]", isDarkMode ? "text-white/92" : "text-black/88")}>{title}</p>
      {description ? (
        <p className={cn("mt-1.5 text-xs leading-5", isDarkMode ? "text-white/45" : "text-black/42")}>{description}</p>
      ) : null}
    </div>
  );
}

function GenUIActionChips({
  items,
  disabled,
}: {
  items: Array<{
    key: string;
    label: string;
    onSelect: () => void;
  }>;
  disabled: boolean;
}) {
  const isDarkMode = useChatTheme();
  return (
    <Suggestions className="gap-2.5">
      {items.map((item) => (
        <Suggestion
          key={item.key}
          suggestion={item.label}
          onClick={item.onSelect}
          disabled={disabled}
          className={cn(
            "h-11 rounded-full border px-5 text-sm font-medium tracking-[-0.015em] transition-colors disabled:opacity-45",
            isDarkMode
              ? "border-white/8 bg-white/[0.03] text-white/78 hover:bg-white/[0.05]"
              : "border-black/8 bg-black/[0.035] text-black/72 hover:bg-black/[0.06]"
          )}
        />
      ))}
    </Suggestions>
  );
}

function readChoicePresentation(block: GenUIChoiceBlock): "inline-actions" | "card-form" {
  const presentation = isRecord(block.meta) ? block.meta.choicePresentation : undefined;
  return presentation === "card-form" ? "card-form" : "inline-actions";
}

function readChoiceInputMode(block: GenUIChoiceBlock): "none" | "free-text-optional" {
  const inputMode = isRecord(block.meta) ? block.meta.choiceInputMode : undefined;
  return inputMode === "free-text-optional" ? "free-text-optional" : "none";
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
  const isDarkMode = useChatTheme();
  const [customLocation, setCustomLocation] = useState("");
  const choicePresentation = useMemo(() => readChoicePresentation(block), [block]);
  const choiceInputMode = useMemo(() => readChoiceInputMode(block), [block]);
  const choiceQuestionType = useMemo(() => readChoiceQuestionType(block), [block]);

  const supportsCustomLocation = useMemo(() => {
    return choiceQuestionType === "location" && choiceInputMode === "free-text-optional";
  }, [choiceInputMode, choiceQuestionType]);

  const choiceActionItems = useMemo(
    () =>
      block.options.map((option, index) => ({
        key: `${option.label}-${index}`,
        label: option.label,
        onSelect: () => {
          void onActionSelect(option);
        },
      })),
    [block.options, onActionSelect]
  );

  const customLocationAction = useMemo(() => {
    const normalizedLocation = customLocation.trim();
    if (!supportsCustomLocation || !normalizedLocation) {
      return null;
    }

    const templateOption = block.options.find((option) => {
      const params = isRecord(option.params) ? option.params : null;
      return params?.questionType === "location";
    }) ?? block.options[0];

    if (!templateOption) {
      return null;
    }

    const templateParams = isRecord(templateOption.params) ? templateOption.params : {};
    const {
      lat: _lat,
      lng: _lng,
      center: _center,
      _location: __location,
      radiusKm: _radiusKm,
      location: _templateLocation,
      locationName: _templateLocationName,
      value: _templateValue,
      selectedValue: _templateSelectedValue,
      selectedLabel: _templateSelectedLabel,
      ...restParams
    } = templateParams;

    return {
      label: normalizedLocation,
      action: "select_preference",
      params: {
        ...restParams,
        questionType: "location",
        value: normalizedLocation,
        selectedValue: normalizedLocation,
        selectedLabel: normalizedLocation,
        location: normalizedLocation,
        locationName: normalizedLocation,
      },
    } satisfies ActionOption;
  }, [block.options, customLocation, supportsCustomLocation]);

  useEffect(() => {
    setCustomLocation("");
  }, [block.blockId]);

  return (
    <div
      className={cn(
        "mt-1 space-y-2.5",
        choicePresentation === "card-form" ? "pt-0" : undefined
      )}
    >
      <GenUIActionChips items={choiceActionItems} disabled={disabled} />

      {supportsCustomLocation ? (
        <div className="px-0 py-1">
          <p className={cn("text-[12px] font-medium", isDarkMode ? "text-white/78" : "text-black/76")}>上面都不合适？直接输入片区</p>
          <p className={cn("mt-1 text-[11px] leading-5", isDarkMode ? "text-white/42" : "text-black/42")}>
            直接输入你常活动的地方，我会按这里继续筛。
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              type="text"
              value={customLocation}
              onChange={(event) => setCustomLocation(event.target.value)}
              disabled={disabled}
              placeholder="比如大学城、沙坪坝、两路口"
              className={cn("h-10 min-w-0 flex-1 rounded-full border px-3 text-xs outline-none transition disabled:opacity-45", isDarkMode ? "border-white/10 bg-white/[0.08] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] placeholder:text-white/30 focus:border-white/16 focus:bg-white/[0.1]" : "border-black/10 bg-white/88 text-black/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] placeholder:text-black/30 focus:border-black/16 focus:bg-white")}
            />
            <button
              type="button"
              disabled={disabled || !customLocationAction}
              onClick={() => {
                if (!customLocationAction) {
                  return;
                }
                void onActionSelect(customLocationAction);
              }}
              className={cn("h-10 shrink-0 rounded-full border px-4 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45", isDarkMode ? "border-white/8 bg-white/[0.05] text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.08]" : "border-black/8 bg-black text-white shadow-[0_10px_24px_-18px_rgba(0,0,0,0.18)] hover:bg-black/90")}
            >
              使用该区域
            </button>
          </div>
        </div>
      ) : null}
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
    readStringField(fields, "shareUrl");

  return (
    block.dedupeKey === "published_activity" ||
    block.dedupeKey === "share_payload" ||
    (!!activityId && !activityId.startsWith("draft_") && !!hasShareData)
  );
}

function ShareEntityCardBlock({ block }: { block: GenUIEntityCardBlock }) {
  const isDarkMode = useChatTheme();
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

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const copySharePayload = useCallback(async () => {
    if (!shareUrl || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopyStatus("failed");
      return;
    }

    const copyText = [shareTitle, shareUrl]
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
  }, [shareTitle, shareUrl]);

  return (
    <div className="py-1">
      <div className="mb-2 flex items-center justify-between">
        <p className={cn("text-sm font-semibold", isDarkMode ? "text-white/92" : "text-black/88")}>{block.title || "分享卡片"}</p>
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", isDarkMode ? "border-white/8 bg-white/[0.03] text-white/42" : "border-black/8 bg-black/[0.03] text-black/38")}>
          ID: {activityId}
        </span>
      </div>
      <p className={cn("text-sm", isDarkMode ? "text-white/82" : "text-black/80")}>{shareTitle}</p>
      <p className={cn("mt-1 text-xs", isDarkMode ? "text-white/42" : "text-black/42")}>
        {locationName} · {startAt}
      </p>
      <p className={cn("mt-1 text-xs", isDarkMode ? "text-white/42" : "text-black/42")}>
        已有 {currentParticipants}/{maxParticipants} 人报名
      </p>

      {shareUrl && (
        <div className="mt-3 space-y-1 px-0 py-0">
          <p className={cn("break-all text-[11px]", isDarkMode ? "text-white/50" : "text-black/48")}>详情页: {shareUrl}</p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            void copySharePayload();
          }}
          className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-white/90"
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
            className={cn("rounded-full border px-3 py-1.5 text-xs", isDarkMode ? "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.08]" : "border-black/8 bg-black/[0.04] text-black/72 hover:bg-black/[0.06]")}
          >
            打开活动详情
          </a>
        )}
      </div>
    </div>
  );
}

function EntityCardBlock({ block }: { block: GenUIEntityCardBlock }) {
  const isDarkMode = useChatTheme();
  const entries = Object.entries(block.fields || {});

  return (
    <div className={cn("rounded-[20px] border p-3.5", isDarkMode ? "border-white/8 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]" : "border-black/8 bg-black/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]")}>
      <p className={cn("text-sm font-semibold", isDarkMode ? "text-white/88" : "text-black/84")}>{block.title}</p>
      <div className="mt-2 space-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3 text-xs">
            <span className={cn(isDarkMode ? "text-white/42" : "text-black/42")}>{prettyFieldLabel(key)}</span>
            <span className={cn("text-right", isDarkMode ? "text-white/72" : "text-black/70")}>{renderFieldValue(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function isBrowseableResultList(block: GenUIListBlock): boolean {
  const presentation = readListPresentation(block);
  if (presentation === "immersive-carousel" || presentation === "partner-carousel") {
    return true;
  }

  if (presentation === "compact-stack") {
    return false;
  }

  if (block.items.length <= 1) {
    return false;
  }

  const interaction = isRecord(block.interaction) ? block.interaction : null;
  if (interaction?.swipeable === true) {
    return true;
  }

  return false;
}

function ResultCarouselCard({
  item,
  index,
  active,
  partnerMode,
  disabled,
  onActionSelect,
}: {
  item: Record<string, unknown>;
  index: number;
  active: boolean;
  partnerMode?: boolean;
  disabled?: boolean;
  onActionSelect?: (option: ActionOption) => Promise<void>;
}) {
  const isDarkMode = useChatTheme();
  const title = readStringField(item, "title", `结果 ${index + 1}`);
  const type = readStringField(item, "type");
  const locationName = readStringField(item, "locationName", "附近");
  const startAt = renderFieldValue(item.startAt);
  const avatarUrl = readStringField(item, "avatarUrl");
  const distance = formatDistance(item.distance);
  const currentParticipants = item.currentParticipants;
  const maxParticipants = item.maxParticipants;
  const timePreference = readStringField(item, "timePreference");
  const score = readNumberField(item, "score", 0);
  const note =
    readStringField(item, "summary") ||
    readStringField(item, "description") ||
    readStringField(item, "matchReason") ||
    readStringField(item, "reason") ||
    readStringField(item, "locationHint");
  const actions = readListItemActions(item);
  const tags = Array.isArray(item.tags)
    ? item.tags
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        .slice(0, 3)
    : [];
  const hiddenKeys = new Set([
    "id",
    "partnerIntentId",
    "candidateUserId",
    "title",
    "type",
    "avatarUrl",
    "locationName",
    "locationHint",
    "startAt",
    "timePreference",
    "distance",
    "score",
    "currentParticipants",
    "maxParticipants",
    "summary",
    "description",
    "matchReason",
    "reason",
    "tags",
    "actions",
    "lat",
    "lng",
  ]);
  const detailEntries = Object.entries(item)
    .filter(([key, value]) => !hiddenKeys.has(key) && value !== undefined && value !== null)
    .slice(0, 2);

  return (
    <article
      className={cn(
        "flex min-h-[238px] flex-col p-1 transition-all duration-300",
        active ? "opacity-100" : "opacity-[0.55]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {partnerMode ? (
            avatarUrl ? (
              <img
                src={avatarUrl}
                alt={title}
                className={cn("h-11 w-11 shrink-0 rounded-full border object-cover shadow-[0_10px_24px_-18px_rgba(0,0,0,0.22)]", isDarkMode ? "border-white/10" : "border-black/10")}
              />
            ) : (
              <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-semibold shadow-[0_10px_24px_-18px_rgba(0,0,0,0.18)]", isDarkMode ? "border-white/10 bg-white/[0.06] text-white/82" : "border-black/10 bg-black/[0.05] text-black/78")}>
                {title.slice(0, 1) || "搭"}
              </div>
            )
          ) : null}
          <div className="min-w-0">
          {type ? (
            <div className={cn("mb-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]", isDarkMode ? "border-white/8 bg-white/[0.03] text-white/56" : "border-black/8 bg-black/[0.03] text-black/50")}>
              {type}
            </div>
          ) : null}
          <h3 className={cn("text-[15px] font-semibold leading-6", isDarkMode ? "text-white/92" : "text-black/88")}>{title}</h3>
          </div>
        </div>
        {partnerMode && score > 0 ? (
          <div className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]", isDarkMode ? "border-white/8 bg-white/[0.05] text-white/78" : "border-black/8 bg-black/[0.05] text-black/76")}>
            匹配 {score}%
          </div>
        ) : (
          <div className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]", isDarkMode ? "border-white/8 bg-white/[0.03] text-white/42" : "border-black/8 bg-black/[0.03] text-black/40")}>
            {index + 1}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium", isDarkMode ? "border-white/8 bg-white/[0.04] text-white/68" : "border-black/8 bg-black/[0.04] text-black/66")}>
          {locationName}
        </span>
        {partnerMode && timePreference ? (
          <span className={cn("rounded-full border px-2.5 py-1 text-[11px]", isDarkMode ? "border-white/8 bg-white/[0.03] text-white/46" : "border-black/8 bg-black/[0.03] text-black/46")}>
            {timePreference}
          </span>
        ) : null}
        {distance !== "-" ? (
          <span className={cn("rounded-full border px-2.5 py-1 text-[11px]", isDarkMode ? "border-white/8 bg-white/[0.03] text-white/46" : "border-black/8 bg-black/[0.03] text-black/46")}>
            距离 {distance}
          </span>
        ) : null}
        {startAt !== "-" ? (
          <span className={cn("rounded-full border px-2.5 py-1 text-[11px]", isDarkMode ? "border-white/8 bg-white/[0.03] text-white/46" : "border-black/8 bg-black/[0.03] text-black/46")}>
            {startAt}
          </span>
        ) : null}
      </div>

      {note ? (
        <p className={cn("mt-3 text-sm leading-6", isDarkMode ? "text-white/62" : "text-black/60")}>{note}</p>
      ) : (
        <p className={cn("mt-3 text-sm leading-6", isDarkMode ? "text-white/42" : "text-black/42")}>
          左右滑动看看其他结果，选到顺眼的我们再继续。
        </p>
      )}

      <div className="mt-4 space-y-2">
        {currentParticipants !== undefined && maxParticipants !== undefined ? (
          <div
            className={cn(
              "flex items-center justify-between px-0 py-1 text-xs",
              isDarkMode ? "text-white/46" : "text-black/46"
            )}
          >
            <span>当前进度</span>
            <span className={cn("font-medium", isDarkMode ? "text-white/76" : "text-black/76")}>
              {renderFieldValue(currentParticipants)}/{renderFieldValue(maxParticipants)} 人
            </span>
          </div>
        ) : null}

        {detailEntries.map(([key, value]) => (
          <div
            key={key}
            className={cn(
              "flex items-center justify-between gap-3 px-0 py-1 text-xs",
              isDarkMode ? "text-white/46" : "text-black/46"
            )}
          >
            <span>{prettyFieldLabel(key)}</span>
            <span className={cn("text-right font-medium", isDarkMode ? "text-white/76" : "text-black/76")}>
              {renderFieldValue(value)}
            </span>
          </div>
        ))}
      </div>

      {tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px]",
                isDarkMode
                  ? "border-white/8 bg-white/[0.03] text-white/46"
                  : "border-black/8 bg-black/[0.03] text-black/46"
              )}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {partnerMode && actions.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-2">
          {actions.map((action, actionIndex) => (
            <button
              key={`${action.action}-${actionIndex}`}
              type="button"
              onClick={() => {
                if (onActionSelect) {
                  void onActionSelect(action);
                }
              }}
              disabled={disabled}
              className={cn(
                "rounded-[18px] px-3.5 py-2.5 text-left text-xs font-medium transition-all disabled:opacity-45",
                actionIndex === 0
                  ? isDarkMode
                    ? "bg-white text-[#111111] shadow-[0_18px_30px_-22px_rgba(255,255,255,0.18)]"
                    : "bg-black text-white shadow-[0_18px_30px_-22px_rgba(0,0,0,0.22)]"
                  : isDarkMode
                    ? "border border-white/8 bg-white/[0.04] text-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                    : "border border-black/8 bg-black/[0.04] text-black/76 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ResultCarousel({
  items,
  partnerMode,
  disabled,
  onActionSelect,
}: {
  items: Record<string, unknown>[];
  partnerMode?: boolean;
  disabled?: boolean;
  onActionSelect?: (option: ActionOption) => Promise<void>;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isDarkMode = useChatTheme();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateActiveIndex = () => {
      const cards = Array.from(
        viewport.querySelectorAll<HTMLElement>("[data-carousel-index]")
      );
      if (cards.length === 0) {
        return;
      }

      const viewportCenter = viewport.scrollLeft + viewport.clientWidth / 2;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      cards.forEach((card, index) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const distance = Math.abs(cardCenter - viewportCenter);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      setActiveIndex(nearestIndex);
    };

    updateActiveIndex();
    viewport.addEventListener("scroll", updateActiveIndex, { passive: true });
    window.addEventListener("resize", updateActiveIndex);

    return () => {
      viewport.removeEventListener("scroll", updateActiveIndex);
      window.removeEventListener("resize", updateActiveIndex);
    };
  }, [items.length]);

  return (
    <div className="mt-3">
      <div className="relative">
        <div
          ref={viewportRef}
          className="[&::-webkit-scrollbar]:hidden overflow-x-auto px-[10%] pb-2 [scrollbar-width:none]"
        >
          <div className="flex snap-x snap-mandatory gap-3">
            {items.map((item, index) => (
              <div
                key={String(item.id ?? index)}
                data-carousel-index={index}
                className={cn(
                  "basis-[80%] shrink-0 snap-center transition-transform duration-300",
                  activeIndex === index ? "scale-100" : "scale-[0.965]"
                )}
              >
                <ResultCarouselCard
                  item={item}
                  index={index}
                  active={activeIndex === index}
                  partnerMode={partnerMode}
                  disabled={disabled}
                  onActionSelect={onActionSelect}
                />
              </div>
            ))}
          </div>
        </div>
        <div className={cn("pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r to-transparent", isDarkMode ? "from-black via-black/92" : "from-white via-white/92")} />
        <div className={cn("pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l to-transparent", isDarkMode ? "from-black via-black/92" : "from-white via-white/92")} />
      </div>

      <div className={cn("mt-2 flex items-center justify-between px-1 text-[11px]", isDarkMode ? "text-white/40" : "text-black/38")}>
        <span>左右滑动查看</span>
        <span>
          {activeIndex + 1} / {items.length}
        </span>
      </div>
    </div>
  );
}

function ListBlockGlobalActions({
  meta,
  disabled,
  onActionSelect,
}: {
  meta: Record<string, unknown>;
  disabled: boolean;
  onActionSelect?: (option: ActionOption) => Promise<void>;
}) {
  const isDarkMode = useChatTheme();
  const primaryAction = isRecord(meta.primaryAction) ? meta.primaryAction : null;
  const secondaryAction = isRecord(meta.secondaryAction) ? meta.secondaryAction : null;

  if (!primaryAction && !secondaryAction) {
    return null;
  }

  const primaryLabel = typeof primaryAction?.label === "string" ? primaryAction.label : "";
  const primaryActionType = typeof primaryAction?.action === "string" ? primaryAction.action : "";
  const primaryParams = isRecord(primaryAction?.params) ? primaryAction.params : {};
  const secondaryLabel = typeof secondaryAction?.label === "string" ? secondaryAction.label : "";
  const secondaryActionType = typeof secondaryAction?.action === "string" ? secondaryAction.action : "";
  const secondaryParams = isRecord(secondaryAction?.params) ? secondaryAction.params : {};

  return (
    <div className="mt-4 flex items-center justify-center gap-3 px-4">
      {secondaryActionType && secondaryLabel ? (
        <button
          type="button"
          onClick={() => {
            if (onActionSelect) {
              void onActionSelect({
                label: secondaryLabel,
                action: secondaryActionType,
                params: secondaryParams,
              });
            }
          }}
          disabled={disabled}
          className={cn("rounded-[22px] border px-5 py-3 text-sm font-medium transition-all disabled:opacity-45", isDarkMode ? "border-white/8 bg-white/[0.04] text-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]" : "border-black/8 bg-black/[0.04] text-black/74 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]")}
        >
          {secondaryLabel}
        </button>
      ) : null}
      {primaryActionType && primaryLabel ? (
        <button
          type="button"
          onClick={() => {
            if (onActionSelect) {
              void onActionSelect({
                label: primaryLabel,
                action: primaryActionType,
                params: primaryParams,
              });
            }
          }}
          disabled={disabled}
          className="rounded-[22px] bg-white px-5 py-3 text-sm font-semibold text-[#111111] shadow-[0_18px_30px_-22px_rgba(255,255,255,0.18)] transition-all disabled:opacity-45"
        >
          {primaryLabel}
        </button>
      ) : null}
    </div>
  );
}

function ListBlockCard({
  block,
  disabled,
  onActionSelect,
}: {
  block: GenUIListBlock;
  disabled: boolean;
  onActionSelect: (option: ActionOption) => Promise<void>;
}) {
  const isDarkMode = useChatTheme();
  const partnerMode = isPartnerSearchResultsList(block);
  const browseable = isBrowseableResultList(block);
  const listPresentation = readListPresentation(block);
  const showHeader = readListShowHeader(block);
  const preview = isRecord(block.preview) ? block.preview : null;
  const fetchConfig = isRecord(block.fetchConfig) ? block.fetchConfig : null;

  if (block.items.length === 0 && !preview && !fetchConfig) {
    return null;
  }

  return (
    <div
      className={cn(
        showHeader
          ? "space-y-0"
          : "mt-1",
        showHeader && listPresentation === "compact-stack"
          ? "space-y-0"
          : undefined
      )}
    >
      {showHeader && block.title ? (
        <GenUICardHeader
          eyebrow={partnerMode ? "搭子候选" : "结果浏览"}
          title={block.title}
          trailingLabel={`${block.items.length} ${partnerMode ? "位" : "张"}`}
        />
      ) : null}

      {block.subtitle ? (
        <p className={cn("mt-2 text-sm", isDarkMode ? "text-white/42" : "text-black/42")}>{block.subtitle}</p>
      ) : null}

      {browseable ? (
        <ResultCarousel
          items={block.items}
          partnerMode={partnerMode}
          disabled={disabled}
          onActionSelect={onActionSelect}
        />
      ) : (
        <div className={cn(showHeader ? "mt-3 space-y-2" : "space-y-2")}>
          {block.items.map((item, index) => (
            partnerMode ? (
              <ResultCarouselCard
                key={String(item.id ?? index)}
                item={item}
                index={index}
                active
                partnerMode
                disabled={disabled}
                onActionSelect={onActionSelect}
              />
            ) : (
              <div
              key={String(item.id ?? index)}
              className="px-0 py-1"
              >
                <p className={cn("text-sm font-medium", isDarkMode ? "text-white/90" : "text-black/86")}>
                  {String(item.title ?? `活动 ${index + 1}`)}
                </p>
                <p className={cn("mt-1 text-xs", isDarkMode ? "text-white/42" : "text-black/42")}>
                  {String(item.locationName ?? "附近")} · {formatDistance(item.distance)}
                </p>
              </div>
            )
          ))}
        </div>
      )}

      {/* 全局动作按钮（如"帮我继续留意"） */}
      {partnerMode && isRecord(block.meta) ? (
        <ListBlockGlobalActions
          meta={block.meta}
          disabled={disabled}
          onActionSelect={onActionSelect}
        />
      ) : null}
    </div>
  );
}

function FormBlockCard({
  block,
  disabled,
  onActionSelect,
}: {
  block: GenUIFormBlock;
  disabled: boolean;
  onActionSelect: (option: ActionOption) => Promise<void>;
}) {
  const isDarkMode = useChatTheme();
  const schema = useMemo(() => readGenUIFormSchema(block.schema), [block.schema]);
  const initialValues = useMemo(
    () => buildGenUIFormValues(isRecord(block.initialValues) ? block.initialValues : {}, schema),
    [block.initialValues, schema]
  );
  const [formValues, setFormValues] = useState<Record<string, unknown>>(initialValues);
  const [formError, setFormError] = useState<string | null>(null);
  const showHeader = useMemo(() => readFormShowHeader(block), [block]);

  useEffect(() => {
    setFormValues(initialValues);
    setFormError(null);
  }, [initialValues]);

  const submitLabel =
    typeof schema.submitLabel === "string" && schema.submitLabel.trim()
      ? schema.submitLabel.trim()
      : "提交";
  const requiredFields = useMemo(
    () => schema.fields.filter((field) => field.required),
    [schema.fields]
  );
  const optionalFields = useMemo(
    () => schema.fields.filter((field) => !field.required),
    [schema.fields]
  );
  const missingRequiredCount = useMemo(
    () => countGenUIFormMissingRequiredFields(schema, formValues),
    [formValues, schema]
  );
  const submitBlocked = missingRequiredCount > 0;
  const submitButtonLabel =
    missingRequiredCount > 0 ? `${submitLabel} · 还差 ${missingRequiredCount} 项必填` : submitLabel;

  const handleSingleSelect = useCallback((fieldName: string, value: string) => {
    setFormValues((current) => ({
      ...current,
      [fieldName]: value,
    }));
    setFormError(null);
  }, []);

  const handleMultiSelect = useCallback((fieldName: string, value: string) => {
    setFormValues((current) => {
      const currentValues = readGenUIFormMultiValue(current, fieldName);
      const hasValue = currentValues.includes(value);
      const nextValues = hasValue
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];

      return {
        ...current,
        [fieldName]:
          value === "NoPreference" && !hasValue
            ? ["NoPreference"]
            : value !== "NoPreference"
              ? nextValues.filter((item) => item !== "NoPreference")
              : nextValues,
      };
    });
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const submitAction =
      typeof schema.submitAction === "string" && schema.submitAction.trim()
        ? schema.submitAction.trim()
        : null;

    if (!submitAction) {
      setFormError("这张表单暂时还不能直接提交。");
      return;
    }

    const missingField = validateGenUIFormRequiredFields(schema, formValues);
    if (missingField) {
      setFormError(`请先补充${missingField}`);
      return;
    }

    await onActionSelect({
      label: submitLabel,
      action: submitAction,
      params: formValues,
    });
  }, [formValues, onActionSelect, schema, submitLabel]);

  const fields = schema.fields;
  const showFallbackPreview = fields.length === 0;

  const renderField = (field: GenUIFormField) => {
    if (field.type === "textarea") {
      const currentValue = readGenUIFormTextValue(formValues, field.name);
      return (
        <div key={field.name} className="space-y-1.5">
          <div className="flex items-center gap-1">
            <p className={cn("text-[12px] font-medium", isDarkMode ? "text-white/82" : "text-black/82")}>{field.label}</p>
            {field.required ? <span className={cn("text-[11px]", isDarkMode ? "text-white/38" : "text-black/36")}>*</span> : null}
          </div>
          <textarea
            value={currentValue}
            onChange={(event) => {
              setFormValues((current) => ({
                ...current,
                [field.name]: event.target.value,
              }));
              setFormError(null);
            }}
            disabled={disabled}
            maxLength={typeof field.maxLength === "number" ? field.maxLength : 120}
            rows={3}
            placeholder={field.placeholder || `补充${field.label}`}
            className={cn(
              "min-h-[92px] w-full rounded-[22px] border px-3 py-2.5 text-sm outline-none transition disabled:opacity-45",
              isDarkMode
                ? "border-white/10 bg-white/[0.08] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] placeholder:text-white/30 focus:border-white/16 focus:bg-white/[0.1]"
                : "border-black/10 bg-white text-black/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] placeholder:text-black/30 focus:border-black/16 focus:bg-white"
            )}
          />
        </div>
      );
    }

    if (field.type === "text") {
      const currentValue = readGenUIFormTextValue(formValues, field.name);
      return (
        <div key={field.name} className="space-y-1.5">
          <div className="flex items-center gap-1">
            <p className={cn("text-[12px] font-medium", isDarkMode ? "text-white/82" : "text-black/82")}>{field.label}</p>
            {field.required ? <span className={cn("text-[11px]", isDarkMode ? "text-white/38" : "text-black/36")}>*</span> : null}
          </div>
          <input
            type="text"
            value={currentValue}
            onChange={(event) => {
              setFormValues((current) => ({
                ...current,
                [field.name]: event.target.value,
              }));
              setFormError(null);
            }}
            disabled={disabled}
            maxLength={typeof field.maxLength === "number" ? field.maxLength : 60}
            placeholder={field.placeholder || `补充${field.label}`}
            className={cn(
              "h-11 w-full rounded-[18px] border px-3 text-sm outline-none transition disabled:opacity-45",
              isDarkMode
                ? "border-white/10 bg-white/[0.08] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] placeholder:text-white/30 focus:border-white/16 focus:bg-white/[0.1]"
                : "border-black/10 bg-white text-black/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] placeholder:text-black/30 focus:border-black/16 focus:bg-white"
            )}
          />
        </div>
      );
    }

    if (field.type === "multi-select") {
      const currentValues = readGenUIFormMultiValue(formValues, field.name);
      return (
        <div key={field.name} className="space-y-1.5">
          <div className="flex items-center gap-1">
            <p className={cn("text-[12px] font-medium", isDarkMode ? "text-white/82" : "text-black/82")}>{field.label}</p>
            {field.required ? <span className={cn("text-[11px]", isDarkMode ? "text-white/38" : "text-black/36")}>*</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {(field.options || []).map((option) => {
              const selected = currentValues.includes(option.value);
              return (
                <button
                  key={`${field.name}-${option.value}`}
                  type="button"
                  onClick={() => handleMultiSelect(field.name, option.value)}
                  disabled={disabled}
                  className={cn(
                    "rounded-full border px-3 py-2 text-xs transition-all duration-150 disabled:opacity-45",
                    selected
                      ? isDarkMode
                        ? "border-white/10 bg-white text-[#111111] shadow-[0_12px_24px_-18px_rgba(255,255,255,0.16)]"
                        : "border-black/10 bg-black text-white shadow-[0_12px_24px_-18px_rgba(0,0,0,0.18)]"
                      : isDarkMode
                        ? "border-white/10 bg-white/[0.05] text-white/78 hover:bg-white/[0.08]"
                        : "border-black/10 bg-black/[0.04] text-black/76 hover:bg-black/[0.07]"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    const currentValue = readGenUIFormTextValue(formValues, field.name);
    return (
      <div key={field.name} className="space-y-1.5">
        <div className="flex items-center gap-1">
          <p className={cn("text-[12px] font-medium", isDarkMode ? "text-white/82" : "text-black/82")}>{field.label}</p>
          {field.required ? <span className={cn("text-[11px]", isDarkMode ? "text-white/38" : "text-black/36")}>*</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {(field.options || []).map((option) => (
            <button
              key={`${field.name}-${option.value}`}
              type="button"
              onClick={() => handleSingleSelect(field.name, option.value)}
              disabled={disabled}
              className={cn(
                "rounded-full border px-3 py-2 text-xs transition-all duration-150 disabled:opacity-45",
                currentValue === option.value
                  ? isDarkMode
                    ? "border-white/10 bg-white text-[#111111] shadow-[0_12px_24px_-18px_rgba(255,255,255,0.16)]"
                    : "border-black/10 bg-black text-white shadow-[0_12px_24px_-18px_rgba(0,0,0,0.18)]"
                  : isDarkMode
                    ? "border-white/10 bg-white/[0.05] text-white/78 hover:bg-white/[0.08]"
                    : "border-black/10 bg-black/[0.04] text-black/76 hover:bg-black/[0.07]"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        showHeader
          ? "space-y-3"
          : "mt-1 space-y-3"
      )}
    >
      {showHeader ? (
        <GenUICardHeader
          eyebrow="搭子偏好表"
          title={block.title || "参数设置"}
          description={
            requiredFields.length > 0
              ? missingRequiredCount > 0
                ? `先补齐 ${requiredFields.length} 项必填，我就按这些条件开始筛。`
                : "必填已经补齐，选填项能帮我筛得更准。"
              : "按你的想法补几项，我会据此把范围收窄。"
          }
          trailingLabel={
            requiredFields.length > 0
              ? `${requiredFields.length - missingRequiredCount}/${requiredFields.length} 必填`
              : undefined
          }
        />
      ) : null}

      {showFallbackPreview ? (
        <div className={cn(showHeader ? "mt-2 space-y-2" : "space-y-2")}>
          {Object.entries(initialValues).map(([key, value]) => (
            <div key={key} className={cn("rounded-[16px] px-3 py-2.5", isDarkMode ? "bg-white/[0.04]" : "bg-black/[0.03]")}>
              <p className={cn("text-[11px]", isDarkMode ? "text-white/42" : "text-black/42")}>{prettyFieldLabel(key)}</p>
              <p className={cn("text-sm", isDarkMode ? "text-white/88" : "text-black/84")}>{renderFieldValue(value)}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className={cn(showHeader ? "mt-3 space-y-3" : "space-y-3")}>
          {requiredFields.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className={cn("text-[12px] font-semibold tracking-[0.02em]", isDarkMode ? "text-white/86" : "text-black/82")}>先填这几项</p>
                <span className={cn("rounded-full border px-2 py-1 text-[11px]", isDarkMode ? "border-white/8 bg-white/[0.03] text-white/56" : "border-black/8 bg-black/[0.03] text-black/48")}>
                  {missingRequiredCount > 0 ? `还差 ${missingRequiredCount} 项` : "已补齐"}
                </span>
              </div>
              <div className="space-y-3">{requiredFields.map(renderField)}</div>
            </div>
          ) : null}

          {optionalFields.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className={cn("text-[12px] font-semibold tracking-[0.02em]", isDarkMode ? "text-white/82" : "text-black/80")}>有空再补</p>
                <span className={cn("text-[11px]", isDarkMode ? "text-white/42" : "text-black/42")}>选填，能帮我筛得更准</span>
              </div>
              <div className="space-y-3">{optionalFields.map(renderField)}</div>
            </div>
          ) : null}

          {formError ? (
            <p className={cn("px-0 py-1 text-xs", isDarkMode ? "text-white/72" : "text-black/72")}>{formError}</p>
          ) : null}

          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={disabled}
            className={cn(
              "w-full rounded-[22px] px-4 py-3 text-sm font-medium transition-all",
              submitBlocked
                ? isDarkMode
                  ? "bg-white/[0.12] text-white/46 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  : "bg-black/[0.08] text-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
                : isDarkMode
                  ? "bg-white text-[#111111] shadow-[0_16px_32px_-24px_rgba(255,255,255,0.2)] hover:bg-white/92"
                  : "bg-black text-white shadow-[0_16px_32px_-24px_rgba(0,0,0,0.22)] hover:bg-black/92"
            )}
          >
            {submitButtonLabel}
          </button>
          <p className={cn("px-1 text-[11px] leading-5", isDarkMode ? "text-white/42" : "text-black/42")}>
            {submitBlocked
              ? "把上面的必填补齐后，我就按这些条件开始匹配。"
              : "提交后会直接进入匹配，不会再让你重填一遍。"}
          </p>
        </div>
      )}
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
    <div className="mt-1">
      <GenUIActionChips
        items={block.items.map((item, index) => ({
          key: `${item.label}-${index}`,
          label: item.label,
          onSelect: () => {
            void onActionSelect(item);
          },
        }))}
        disabled={disabled}
      />
    </div>
  );
}

function AlertBlockCard({ block }: { block: GenUIAlertBlock }) {
  const isDarkMode = useChatTheme();
  const alertStyleMap: Record<
    GenUIAlertBlock["level"],
    { className: string; label: string }
  > = {
    info: {
      className: isDarkMode ? "border-white/8 bg-white/[0.04] text-white/78" : "border-black/8 bg-black/[0.04] text-black/76",
      label: "提示",
    },
    warning: {
      className: isDarkMode ? "border-white/8 bg-white/[0.05] text-white/78" : "border-black/8 bg-black/[0.05] text-black/76",
      label: "注意",
    },
    error: {
      className: isDarkMode ? "border-white/10 bg-white/[0.06] text-white/82" : "border-black/10 bg-black/[0.06] text-black/82",
      label: "异常",
    },
    success: {
      className: isDarkMode ? "border-white/8 bg-white/[0.04] text-white/78" : "border-black/8 bg-black/[0.04] text-black/76",
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
  const isDarkMode = useChatTheme();
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 px-0 py-2"
      )}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn("h-1.5 w-1.5 animate-pulse rounded-full", isDarkMode ? "bg-white/68" : "bg-black/56")}
          style={{ animationDelay: `${index * 0.12}s` }}
        />
      ))}
    </div>
  );
}

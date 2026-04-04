"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MoreHorizontal,
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
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Suggestion,
  Suggestions,
} from "@/components/ai-elements/suggestion";
import { MessageCenterDrawer } from "@/components/chat/message-center-drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { readClientToken } from "@/lib/client-auth";
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
  GenUIRequestContext,
  GenUITextBlock,
  GenUIResponseEnvelope,
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
const DEFAULT_COMPOSER_PLACEHOLDER = "你想找什么活动？";
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
const COMPOSER_EXPAND_THRESHOLD = 10;
const PENDING_AGENT_ACTION_STORAGE_KEY = "juchang:web:pending-agent-action";
const TEXT_STREAM_CHUNK_DELAY_MS = 60;  // v5.5: 调慢打字机速度，提升可读性

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
type WelcomeSocialProfile = {
  joinedActivities: number;
  hostedActivities: number;
  preferenceCompleteness: number;
};
type WelcomePendingActivity = {
  id: string;
  title: string;
  type: string;
  startAt: string;
  locationName: string;
  locationHint: string;
  currentParticipants: number;
  maxParticipants: number;
  status: string;
};
type WelcomeDraftAction = {
  label: string;
  prompt: string;
  activityId?: string;
};
type WelcomeUiPayload = {
  composerPlaceholder: string;
  bottomQuickActions: string[];
  profileHints: {
    low: string;
    medium: string;
    high: string;
  };
};

const WELCOME_LOCATION_WAIT_MS = 600;

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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

  const joinedActivities = Number(payload.socialProfile.joinedActivities);
  const hostedActivities = Number(payload.socialProfile.hostedActivities);
  const preferenceCompleteness = Number(payload.socialProfile.preferenceCompleteness);

  if (
    !Number.isFinite(joinedActivities) ||
    !Number.isFinite(hostedActivities) ||
    !Number.isFinite(preferenceCompleteness)
  ) {
    return null;
  }

  return {
    joinedActivities,
    hostedActivities,
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
      composerPlaceholder: DEFAULT_COMPOSER_PLACEHOLDER,
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

  const composerPlaceholder =
    typeof payload.ui.composerPlaceholder === "string" &&
    payload.ui.composerPlaceholder.trim()
      ? payload.ui.composerPlaceholder.trim()
      : DEFAULT_COMPOSER_PLACEHOLDER;

  return {
    composerPlaceholder,
    bottomQuickActions: actions.length ? actions : DEFAULT_BOTTOM_ACTIONS,
    profileHints,
  };
}

function extractWelcomePendingActivities(payload: unknown): WelcomePendingActivity[] {
  if (!isRecord(payload) || !Array.isArray(payload.pendingActivities)) {
    return [];
  }

  return payload.pendingActivities
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const id = typeof item.id === "string" ? item.id : "";
      const title = typeof item.title === "string" ? item.title : "";
      const type = typeof item.type === "string" ? item.type : "other";
      const startAt = typeof item.startAt === "string" ? item.startAt : "";
      const locationName = typeof item.locationName === "string" ? item.locationName : "";
      const locationHint = typeof item.locationHint === "string" ? item.locationHint : "";
      const currentParticipants = Number(item.currentParticipants);
      const maxParticipants = Number(item.maxParticipants);
      const status = typeof item.status === "string" ? item.status : "";

      if (!id || !title || !startAt || !locationName || !Number.isFinite(currentParticipants) || !Number.isFinite(maxParticipants)) {
        return null;
      }

      return {
        id,
        title,
        type,
        startAt,
        locationName,
        locationHint,
        currentParticipants,
        maxParticipants,
        status,
      };
    })
    .filter((item): item is WelcomePendingActivity => item !== null)
    .slice(0, 3);
}

function extractWelcomeDraftAction(payload: unknown): WelcomeDraftAction | null {
  if (!isRecord(payload) || !Array.isArray(payload.sections)) {
    return null;
  }

  const draftSection = payload.sections.find((section) => {
    if (!isRecord(section)) {
      return false;
    }

    return section.id === "draft" && Array.isArray(section.items);
  });

  if (!isRecord(draftSection) || !Array.isArray(draftSection.items) || draftSection.items.length === 0) {
    return null;
  }

  const firstItem = draftSection.items[0];
  if (!isRecord(firstItem)) {
    return null;
  }

  const label = typeof firstItem.label === "string" ? firstItem.label.trim() : "";
  const prompt = typeof firstItem.prompt === "string" ? firstItem.prompt.trim() : "";
  const activityId =
    isRecord(firstItem.context) && typeof firstItem.context.activityId === "string"
      ? firstItem.context.activityId
      : undefined;

  if (!label || !prompt) {
    return null;
  }

  return { label, prompt, activityId };
}

function formatWelcomeActivityTime(startAt: string): string {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) {
    return "时间待定";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [quickPrompts, setQuickPrompts] = useState<string[]>(DEFAULT_PROMPTS);
  const [welcomeProfile, setWelcomeProfile] = useState<WelcomeSocialProfile | null>(null);
  const [welcomePendingActivities, setWelcomePendingActivities] = useState<WelcomePendingActivity[]>([]);
  const [welcomeDraftAction, setWelcomeDraftAction] = useState<WelcomeDraftAction | null>(null);
  const [welcomeGreeting, setWelcomeGreeting] = useState(DEFAULT_WELCOME_GREETING);
  const [welcomeSubGreeting, setWelcomeSubGreeting] = useState(DEFAULT_WELCOME_SUB_GREETING);
  const [isWelcomeLoading, setIsWelcomeLoading] = useState(true);
  const [welcomeUi, setWelcomeUi] = useState<WelcomeUiPayload>({
    composerPlaceholder: DEFAULT_COMPOSER_PLACEHOLDER,
    bottomQuickActions: DEFAULT_BOTTOM_ACTIONS,
    profileHints: DEFAULT_PROFILE_HINTS,
  });
  const [clientLocation, setClientLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [welcomeLocationResolved, setWelcomeLocationResolved] = useState(false);
  const [pendingAgentAction, setPendingAgentAction] = useState<PendingAgentActionState | null>(null);
  const [pendingAgentActionHydrated, setPendingAgentActionHydrated] = useState(false);
  const [pendingActionNotice, setPendingActionNotice] = useState<string | null>(null);
  const [messageCenterOpenSignal, setMessageCenterOpenSignal] = useState(0);
  const [messageCenterFocusMatchId, setMessageCenterFocusMatchId] = useState<string | null>(null);
  const isDarkMode = false;
  const hasResumedPendingActionRef = useRef(false);
  const hasRequestedWelcomeRef = useRef(false);

  const isSending = status === "submitted";
  const showComposerHint = shouldExpandComposer(input);

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
    document.addEventListener("visibilitychange", syncAuth);

    return () => {
      window.removeEventListener("focus", syncAuth);
      window.removeEventListener("storage", syncAuth);
      document.removeEventListener("visibilitychange", syncAuth);
    };
  }, []);

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

    if (hasRequestedWelcomeRef.current) {
      return;
    }

    hasRequestedWelcomeRef.current = true;

    const controller = new AbortController();
    let active = true;
    const welcomeUrl = new URL(`${API_BASE}/ai/welcome`);
    if (clientLocation) {
      welcomeUrl.searchParams.set("lat", String(clientLocation.lat));
      welcomeUrl.searchParams.set("lng", String(clientLocation.lng));
    }

    void fetch(welcomeUrl.toString(), {
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
        setWelcomePendingActivities(extractWelcomePendingActivities(payload));
        setWelcomeDraftAction(extractWelcomeDraftAction(payload));
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
  }, [clientLocation, welcomeLocationResolved]);

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
          window.setTimeout(() => {
            window.location.href = `/invite/${payload.activityId}?entry=join_success`;
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


  const sendTurn = useCallback(
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

        const recentMessages = !authToken ? buildRecentMessages(messages) : undefined;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (authToken) {
          headers.Authorization = `Bearer ${authToken}`;
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
            stream: true,
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
                  : randomId("turn");

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
              sawTurnComplete = true;
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

        if (!sawTurnComplete) {
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
    [applyCompletionEffectsFromBlocks, authToken, clientLocation, conversationId, isSending, messages]
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

    await sendTurn(
      {
        type: "action",
        action: actionToResume.action,
        actionId: randomId("action"),
        params: actionToResume.payload,
        displayText: actionToResume.originalText || "继续刚才那步",
      },
      actionToResume.originalText || "继续刚才那步"
    );
  }, [pendingAgentAction, sendTurn]);

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

  const handleWelcomeDraftContinue = useCallback(async () => {
    if (!welcomeDraftAction) {
      return;
    }

    if (welcomeDraftAction.activityId) {
      await sendTurn(
        {
          type: "action",
          action: "edit_draft",
          actionId: randomId("action"),
          params: { activityId: welcomeDraftAction.activityId },
          displayText: welcomeDraftAction.label,
        },
        welcomeDraftAction.label
      );
      return;
    }

    await sendTurn(
      {
        type: "text",
        text: welcomeDraftAction.prompt,
      },
      welcomeDraftAction.prompt
    );
  }, [sendTurn, welcomeDraftAction]);

  const handleOpenPendingActivity = useCallback((activityId: string) => {
    if (typeof window === "undefined") {
      return;
    }

    window.location.href = `/invite/${activityId}`;
  }, []);

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
            <MessageCenterDrawer
              disabled={isSending}
              isDarkMode={isDarkMode}
              openSignal={messageCenterOpenSignal}
              focusPendingMatchId={messageCenterFocusMatchId}
              onSendPrompt={async (prompt, displayText, contextOverrides) => {
                await sendTurn(
                  {
                    type: "text",
                    text: prompt,
                  },
                  displayText || prompt,
                  contextOverrides
                );
              }}
            />
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

        {pendingAgentAction ? (
          <div className="shrink-0 space-y-2 px-3 pb-2">
            {pendingAgentAction ? (
              <section
                className={cn(
                  "rounded-[24px] border px-4 py-3 shadow-[0_18px_36px_-30px_rgba(120,94,16,0.55)]",
                  isDarkMode
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-50"
                    : "border-amber-200 bg-[linear-gradient(180deg,#fff8eb_0%,#fff4dc_100%)] text-amber-900"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-[12px] font-semibold tracking-wide">待恢复动作</p>
                    <p className="text-sm font-medium">
                      {pendingAgentAction.message || "这一步已经挂起，登录后会继续替你办完。"}
                    </p>
                    <p className={cn("text-xs leading-5", isDarkMode ? "text-amber-100/80" : "text-amber-700")}>
                      {pendingAgentAction.action.authMode === "bind_phone"
                        ? "完成绑定手机号后回到这里，我会自动继续。"
                        : "完成登录后回到这里，我会自动继续。"}
                    </p>
                    {pendingActionNotice ? (
                      <p className={cn("text-xs", isDarkMode ? "text-amber-100/80" : "text-amber-700")}>{pendingActionNotice}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void resumeStructuredPendingAction();
                    }}
                    disabled={isSending}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
                      isDarkMode ? "bg-white/10 text-white hover:bg-white/15" : "bg-white text-[#8a5c12] hover:bg-white/90"
                    )}
                  >
                    我已完成，继续
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        <Conversation className="relative">
          <ConversationContent className="w-full gap-4 px-3 pb-4 pt-1">
            {messages.length === 0 ? (
              <ConversationEmptyState className="justify-start px-1 pt-2">
                <div className="w-full space-y-3">
                  <div className="flex items-start justify-between px-2">
                    <div className="min-h-[112px] space-y-1 text-left">
                      {isWelcomeLoading ? (
                        <div className="space-y-2 pt-1">
                          <div className="h-9 w-36 animate-pulse rounded-full bg-white/55" />
                          <div className="h-9 w-64 max-w-[78vw] animate-pulse rounded-full bg-white/55" />
                          <div className="h-9 w-52 animate-pulse rounded-full bg-white/48" />
                        </div>
                      ) : (
                        <>
                          <p className={cn("text-[28px] font-bold leading-none", isDarkMode ? "text-[#e6eaff]" : "text-[#272f8b]")}>{welcomeGreeting}</p>
                          <p className={cn("text-[28px] font-bold leading-none", isDarkMode ? "text-[#e6eaff]" : "text-[#272f8b]")}>{welcomeSubGreeting}</p>
                        </>
                      )}
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
                          {isWelcomeLoading ? (
                            <div className="mx-auto mt-2 h-6 w-12 animate-pulse rounded-full bg-white/75" />
                          ) : (
                            <p className="text-[16px] font-semibold">{welcomeProfile?.joinedActivities ?? 0}<span className="ml-0.5 text-[11px] font-normal">场</span></p>
                          )}
                        </div>
                        <div className="rounded-xl bg-white/76 px-2 py-2 text-center text-[#2f3870]">
                          <p className="text-[11px] text-slate-500">发起</p>
                          {isWelcomeLoading ? (
                            <div className="mx-auto mt-2 h-6 w-12 animate-pulse rounded-full bg-white/75" />
                          ) : (
                            <p className="text-[16px] font-semibold">{welcomeProfile?.hostedActivities ?? 0}<span className="ml-0.5 text-[11px] font-normal">场</span></p>
                          )}
                        </div>
                        <div className="rounded-xl bg-white/76 px-2 py-2 text-center text-[#2f3870]">
                          <p className="text-[11px] text-slate-500">偏好完善</p>
                          {isWelcomeLoading ? (
                            <div className="mx-auto mt-2 h-6 w-12 animate-pulse rounded-full bg-white/75" />
                          ) : (
                            <p className="text-[16px] font-semibold">{welcomeProfile?.preferenceCompleteness ?? 0}<span className="ml-0.5 text-[11px] font-normal">%</span></p>
                          )}
                        </div>
                      </div>
                      {isWelcomeLoading ? (
                        <div className="mt-3 h-4 w-40 animate-pulse rounded-full bg-white/70" />
                      ) : (
                        <p className="mt-2 text-[12px] text-[#616c9f]">
                          {getProfileHint(
                            welcomeProfile?.preferenceCompleteness ?? 0,
                            welcomeUi.profileHints
                          )}
                        </p>
                      )}
                    </div>

                    {!isWelcomeLoading && welcomeDraftAction ? (
                      <button
                        type="button"
                        onClick={() => void handleWelcomeDraftContinue()}
                        className="flex w-full items-center justify-between rounded-2xl border border-[#dfe4ff] bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(243,245,255,0.95)_100%)] px-3 py-3 text-left shadow-[0_16px_28px_-24px_rgba(76,98,191,0.55)]"
                      >
                        <div className="space-y-1">
                          <p className="text-[12px] font-medium text-[#6470a6]">继续上次草稿</p>
                          <p className="text-[14px] font-semibold text-[#2a315e]">{welcomeDraftAction.label}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#7f8ad1]" />
                      </button>
                    ) : null}

                    {!isWelcomeLoading && welcomePendingActivities.length > 0 ? (
                      <div className="space-y-2 rounded-2xl border border-white/70 bg-white/58 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]">
                        <div className="mb-2 flex items-center gap-2 text-[#2b3168]">
                          <span className="h-4 w-1 rounded-full bg-[linear-gradient(180deg,#5b75fb_0%,#7b90ff_100%)]" />
                          <span className="text-[16px] font-semibold">接下来要参加的局</span>
                        </div>
                        <div className="space-y-2">
                          {welcomePendingActivities.map((activity) => (
                            <button
                              key={activity.id}
                              type="button"
                              onClick={() => handleOpenPendingActivity(activity.id)}
                              className="flex w-full items-start justify-between rounded-2xl bg-white/86 px-3 py-2.5 text-left shadow-[0_12px_24px_-20px_rgba(67,86,170,0.52)]"
                            >
                              <div className="min-w-0 flex-1 space-y-1 pr-3">
                                <p className="truncate text-[14px] font-semibold text-[#2a315e]">{activity.title}</p>
                                <p className="text-[12px] text-[#6470a6]">{formatWelcomeActivityTime(activity.startAt)} · {activity.locationName}</p>
                                <p className="truncate text-[12px] text-slate-500">{activity.locationHint}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-[12px] font-medium text-[#5b67f4]">{activity.currentParticipants}/{activity.maxParticipants}人</p>
                                <ChevronRight className="ml-auto mt-2 h-4 w-4 text-slate-300" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      {isWelcomeLoading
                        ? [0.82, 0.7, 0.76].map((widthRatio, index) => (
                            <div
                              key={`welcome-skeleton-${index}`}
                              className="flex w-full items-end gap-2 rounded-2xl bg-white/86 px-3 py-2.5 shadow-[0_12px_24px_-20px_rgba(67,86,170,0.32)]"
                            >
                              <div className="mt-0.5 inline-flex h-5 w-5 shrink-0 animate-pulse rounded-md bg-[linear-gradient(140deg,#d4dbff_0%,#e5dcff_100%)]" />
                              <div
                                className="h-4 animate-pulse rounded-full bg-white/90"
                                style={{ width: `${widthRatio * 100}%` }}
                              />
                              <div className="mt-0.5 h-4 w-4 shrink-0 animate-pulse rounded-full bg-[#e4e9ff]" />
                            </div>
                          ))
                        : quickPrompts.slice(0, 3).map((prompt) => (
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
                              className="flex w-full items-end gap-2 rounded-2xl bg-white/86 px-3 py-2.5 text-left text-[14px] text-[#2a315e] shadow-[0_12px_24px_-20px_rgba(67,86,170,0.52)]"
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
          <PromptInput
            onSubmit={handleSubmit}
            className={cn(
              "rounded-3xl border border-transparent bg-transparent p-0 has-[[data-slot=input-group-control]:focus-visible]:!ring-0 has-[[data-slot=input-group-control]:focus-visible]:!border-transparent [&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:rounded-[20px] [&_[data-slot=input-group]]:!border-transparent [&_[data-slot=input-group]]:px-2 [&_[data-slot=input-group]]:py-1 [&_[data-slot=input-group]]:shadow-[0_14px_24px_-18px_rgba(66,84,156,0.52)] [&_[data-slot=input-group]]:focus-within:!ring-0 [&_[data-slot=input-group]]:focus-within:!border-transparent",
              isDarkMode ? "[&_[data-slot=input-group]]:bg-[#1b244f]" : "[&_[data-slot=input-group]]:bg-white"
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
                "!max-h-none !min-h-0 flex-1 border-none bg-transparent px-3 py-1.5 text-[16px] leading-5 focus-visible:ring-0 focus-visible:outline-none",
                showComposerHint ? "h-auto overflow-hidden" : "h-9 overflow-hidden",
                isDarkMode ? "text-[#e9edff] placeholder:text-[#808bc1]" : "text-[#252c5b] placeholder:text-slate-400"
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
                <span
                  className={cn(
                    "text-xs leading-5",
                    isDarkMode ? "text-[#808bc1]" : "text-slate-400"
                  )}
                >
                  也可以直接说地方、时间、类型或你想找的人
                </span>
              ) : null}
              <PromptInputSubmit
                status={isSending ? "submitted" : "ready"}
                disabled={isSending || !input.trim()}
                variant="ghost"
                className={cn(
                  "h-10 w-10 rounded-full border-0 p-0 shadow-[0_14px_28px_-16px_rgba(82,102,191,0.52)] backdrop-blur-sm focus-visible:ring-0 focus-visible:outline-none disabled:opacity-35",
                  isDarkMode
                    ? "bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22)_0%,rgba(129,150,236,0.2)_56%,rgba(79,97,171,0.2)_100%)] text-[#e9edff] hover:brightness-110"
                    : "bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98)_0%,rgba(244,248,255,0.96)_54%,rgba(230,238,255,0.95)_100%)] text-[#2d396f] hover:brightness-[1.02]"
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </PromptInputSubmit>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <Message from="user" className="max-w-[82%] pt-4">
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
  const renderableBlocks = message.response ? getRenderableBlocks(message.response.response.blocks) : [];
  const hasRenderableBlocks = renderableBlocks.length > 0;
  // 非最后一条消息或正在发送中时，禁用交互
  const isDisabled = disabled || !isLast;

  return (
    <Message from="assistant" className="w-full max-w-none pr-0">
      <MessageContent className="w-full overflow-visible rounded-none bg-transparent px-0 py-0 text-slate-800 shadow-none">
        {message.error ? (
          <p className="text-sm text-rose-600">{message.error}</p>
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
      <MessageResponse className="w-full max-w-none text-[15px] leading-7 text-[#2b3568]">
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
    <p className="text-xs text-slate-500">这条内容正在整理展示中。</p>
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
  return (
    <div className={cn("mb-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/56 px-2.5 py-1 text-[11px] font-medium text-[#5b67f4] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
          <Sparkles className="h-3.5 w-3.5" />
          <span>{eyebrow}</span>
        </div>
        {trailingLabel ? (
          <div className="shrink-0 rounded-full border border-white/70 bg-white/52 px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
            {trailingLabel}
          </div>
        ) : null}
      </div>
      <p className="text-[15px] font-semibold tracking-[0.01em] text-slate-800">{title}</p>
      {description ? (
        <p className="mt-1.5 text-xs leading-5 text-slate-500">{description}</p>
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
  return (
    <Suggestions className="gap-2.5">
      {items.map((item) => (
        <Suggestion
          key={item.key}
          suggestion={item.label}
          onClick={item.onSelect}
          disabled={disabled}
          className="h-11 rounded-full border border-white/78 bg-white/78 px-5 text-sm font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_12px_24px_-20px_rgba(67,86,170,0.34)] transition-all hover:border-[#d5dbff] hover:bg-white/86 disabled:opacity-45"
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
        choicePresentation === "card-form"
          ? "rounded-[26px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(245,248,255,0.62)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_20px_40px_-32px_rgba(60,78,160,0.48)] backdrop-blur-xl"
          : undefined
      )}
    >
      <GenUIActionChips items={choiceActionItems} disabled={disabled} />

      {supportsCustomLocation ? (
        <div className="rounded-[24px] border border-white/78 bg-white/74 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_16px_28px_-24px_rgba(67,86,170,0.28)]">
          <p className="text-[12px] font-medium text-slate-700">上面都不合适？直接输入片区</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            直接输入你常活动的地方，我会按这里继续筛。
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              type="text"
              value={customLocation}
              onChange={(event) => setCustomLocation(event.target.value)}
              disabled={disabled}
              placeholder="比如大学城、沙坪坝、两路口"
              className="h-10 min-w-0 flex-1 rounded-full border border-white/80 bg-white/92 px-3 text-xs text-slate-700 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.66)] transition focus:border-[#c8d1ff] focus:bg-white disabled:opacity-45"
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
              className="h-10 shrink-0 rounded-full bg-[linear-gradient(135deg,#5b67f4_0%,#7380ff_52%,#7d6bff_100%)] px-4 text-xs font-medium text-white shadow-[0_12px_24px_-16px_rgba(91,103,244,0.72)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
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
        "flex min-h-[238px] flex-col rounded-[30px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,247,255,0.94)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_28px_48px_-34px_rgba(65,83,162,0.48)] transition-all duration-300",
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
                className="h-11 w-11 shrink-0 rounded-full border border-white/80 object-cover shadow-[0_10px_24px_-18px_rgba(65,83,162,0.52)]"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/80 bg-[linear-gradient(135deg,#eef2ff_0%,#dbe4ff_100%)] text-sm font-semibold text-[#5b67f4] shadow-[0_10px_24px_-18px_rgba(65,83,162,0.52)]">
                {title.slice(0, 1) || "搭"}
              </div>
            )
          ) : null}
          <div className="min-w-0">
          {type ? (
            <div className="mb-2 inline-flex items-center rounded-full border border-white/75 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-[#5b67f4] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
              {type}
            </div>
          ) : null}
          <h3 className="text-[15px] font-semibold leading-6 text-slate-800">{title}</h3>
          </div>
        </div>
        {partnerMode && score > 0 ? (
          <div className="shrink-0 rounded-full border border-[#dce4ff] bg-white/84 px-2.5 py-1 text-[11px] font-semibold text-[#4f63f3] shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
            匹配 {score}%
          </div>
        ) : (
          <div className="shrink-0 rounded-full border border-white/75 bg-white/72 px-2.5 py-1 text-[11px] font-medium text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
            {index + 1}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-[rgba(92,106,244,0.08)] px-2.5 py-1 text-[11px] font-medium text-slate-600">
          {locationName}
        </span>
        {partnerMode && timePreference ? (
          <span className="rounded-full bg-white/78 px-2.5 py-1 text-[11px] text-slate-500">
            {timePreference}
          </span>
        ) : null}
        {distance !== "-" ? (
          <span className="rounded-full bg-white/78 px-2.5 py-1 text-[11px] text-slate-500">
            距离 {distance}
          </span>
        ) : null}
        {startAt !== "-" ? (
          <span className="rounded-full bg-white/78 px-2.5 py-1 text-[11px] text-slate-500">
            {startAt}
          </span>
        ) : null}
      </div>

      {note ? (
        <p className="mt-3 text-sm leading-6 text-slate-600">{note}</p>
      ) : (
        <p className="mt-3 text-sm leading-6 text-slate-500">
          左右滑动看看其他结果，选到顺眼的我们再继续。
        </p>
      )}

      <div className="mt-4 space-y-2">
        {currentParticipants !== undefined && maxParticipants !== undefined ? (
          <div className="flex items-center justify-between rounded-[20px] border border-white/75 bg-white/70 px-3 py-2 text-xs text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
            <span>当前进度</span>
            <span className="font-medium text-slate-700">
              {renderFieldValue(currentParticipants)}/{renderFieldValue(maxParticipants)} 人
            </span>
          </div>
        ) : null}

        {detailEntries.map(([key, value]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 rounded-[20px] border border-white/70 bg-white/62 px-3 py-2 text-xs text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
          >
            <span>{prettyFieldLabel(key)}</span>
            <span className="text-right font-medium text-slate-700">{renderFieldValue(value)}</span>
          </div>
        ))}
      </div>

      {tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/75 bg-white/74 px-2.5 py-1 text-[11px] text-slate-500"
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
                  ? "bg-[linear-gradient(135deg,#5b67f4_0%,#6f7cff_100%)] text-white shadow-[0_18px_30px_-22px_rgba(81,96,236,0.72)]"
                  : "border border-white/80 bg-white/84 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
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
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-[#f3f6ff] via-[#f3f6ff] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[#f3f6ff] via-[#f3f6ff] to-transparent" />
      </div>

      <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-500">
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
  const primaryAction = isRecord(meta.primaryAction) ? meta.primaryAction : null;
  const secondaryAction = isRecord(meta.secondaryAction) ? meta.secondaryAction : null;

  if (!primaryAction && !secondaryAction) {
    return null;
  }

  const primaryLabel = typeof primaryAction?.label === "string" ? primaryAction.label : "";
  const primaryActionType = typeof primaryAction?.action === "string" ? primaryAction.action : "";
  const secondaryLabel = typeof secondaryAction?.label === "string" ? secondaryAction.label : "";
  const secondaryActionType = typeof secondaryAction?.action === "string" ? secondaryAction.action : "";

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
                params: {},
              });
            }
          }}
          disabled={disabled}
          className="rounded-[22px] border border-white/80 bg-white/84 px-5 py-3 text-sm font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-all disabled:opacity-45"
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
                params: {},
              });
            }
          }}
          disabled={disabled}
          className="rounded-[22px] bg-[linear-gradient(135deg,#5b67f4_0%,#6f7cff_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_30px_-22px_rgba(81,96,236,0.72)] transition-all disabled:opacity-45"
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
          ? "rounded-[28px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(245,248,255,0.64)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_24px_46px_-34px_rgba(63,79,162,0.44)] backdrop-blur-xl"
          : "mt-1",
        showHeader && listPresentation === "compact-stack"
          ? "rounded-[24px] bg-white/64 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_18px_32px_-28px_rgba(63,79,162,0.28)]"
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
        <p className="mt-2 text-sm text-slate-500">{block.subtitle}</p>
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
              className="rounded-[20px] border border-white/75 bg-white/80 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]"
              >
                <p className="text-sm font-medium text-slate-800">
                  {String(item.title ?? `活动 ${index + 1}`)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
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
            <p className="text-[12px] font-medium text-slate-700">{field.label}</p>
            {field.required ? <span className="text-[11px] text-rose-500">*</span> : null}
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
            className="min-h-[92px] w-full rounded-[22px] border border-white/80 bg-white/92 px-3 py-2.5 text-sm text-slate-700 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.66)] transition focus:border-[#c8d1ff] focus:bg-white disabled:opacity-45"
          />
        </div>
      );
    }

    if (field.type === "text") {
      const currentValue = readGenUIFormTextValue(formValues, field.name);
      return (
        <div key={field.name} className="space-y-1.5">
          <div className="flex items-center gap-1">
            <p className="text-[12px] font-medium text-slate-700">{field.label}</p>
            {field.required ? <span className="text-[11px] text-rose-500">*</span> : null}
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
            className="h-11 w-full rounded-[18px] border border-white/80 bg-white/92 px-3 text-sm text-slate-700 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.66)] transition focus:border-[#c8d1ff] focus:bg-white disabled:opacity-45"
          />
        </div>
      );
    }

    if (field.type === "multi-select") {
      const currentValues = readGenUIFormMultiValue(formValues, field.name);
      return (
        <div key={field.name} className="space-y-1.5">
          <div className="flex items-center gap-1">
            <p className="text-[12px] font-medium text-slate-700">{field.label}</p>
            {field.required ? <span className="text-[11px] text-rose-500">*</span> : null}
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
                      ? "border-transparent bg-[linear-gradient(135deg,#4856e8_0%,#6775ff_100%)] text-white shadow-[0_12px_24px_-16px_rgba(83,97,232,0.78)]"
                      : "border-slate-200 bg-white/92 text-slate-700 hover:border-[#d5dbff] hover:bg-[#f7f8ff]"
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
          <p className="text-[12px] font-medium text-slate-700">{field.label}</p>
          {field.required ? <span className="text-[11px] text-rose-500">*</span> : null}
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
                  ? "border-transparent bg-[linear-gradient(135deg,#5b67f4_0%,#7380ff_52%,#7d6bff_100%)] text-white shadow-[0_12px_24px_-16px_rgba(91,103,244,0.78)]"
                  : "border-slate-200 bg-white/92 text-slate-700 hover:border-[#d5dbff] hover:bg-[#f7f8ff]"
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
          ? "rounded-[28px] border border-[#dde3ff] bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(246,248,255,0.96)_100%)] p-4 shadow-[0_26px_46px_-34px_rgba(63,79,162,0.48)]"
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
            <div key={key} className="rounded-lg bg-slate-50/90 px-3 py-2">
              <p className="text-[11px] text-slate-500">{prettyFieldLabel(key)}</p>
              <p className="text-sm text-slate-800">{renderFieldValue(value)}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className={cn(showHeader ? "mt-3 space-y-3" : "space-y-3")}>
          {requiredFields.length > 0 ? (
            <div className="space-y-3 rounded-[24px] border border-[#ffd8e1] bg-[linear-gradient(180deg,rgba(255,247,249,0.96)_0%,rgba(255,241,245,0.92)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold tracking-[0.02em] text-slate-700">先填这几项</p>
                <span className="rounded-full bg-white/72 px-2 py-1 text-[11px] text-rose-500">
                  {missingRequiredCount > 0 ? `还差 ${missingRequiredCount} 项` : "已补齐"}
                </span>
              </div>
              <div className="space-y-3">{requiredFields.map(renderField)}</div>
            </div>
          ) : null}

          {optionalFields.length > 0 ? (
            <div className="space-y-3 rounded-[24px] border border-[#e3e8f6] bg-[linear-gradient(180deg,rgba(250,251,255,0.96)_0%,rgba(244,247,252,0.92)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold tracking-[0.02em] text-slate-700">有空再补</p>
                <span className="text-[11px] text-slate-500">选填，能帮我筛得更准</span>
              </div>
              <div className="space-y-3">{optionalFields.map(renderField)}</div>
            </div>
          ) : null}

          {formError ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{formError}</p>
          ) : null}

          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={disabled}
            className={cn(
              "w-full rounded-[22px] px-4 py-3 text-sm font-medium text-white transition-all",
              submitBlocked
                ? "bg-[linear-gradient(135deg,#b4bddf_0%,#96a1c9_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                : "bg-[linear-gradient(135deg,#5b67f4_0%,#6e7cff_52%,#7d6bff_100%)] shadow-[0_22px_36px_-24px_rgba(81,96,236,0.72)] hover:brightness-[1.02]"
            )}
          >
            {submitButtonLabel}
          </button>
          <p className="px-1 text-[11px] leading-5 text-slate-500">
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

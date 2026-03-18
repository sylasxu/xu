"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type ComposerStatus = "ready" | "submitted";
type TurnContextOverrides = Pick<GenUIRequestContext, "activityId" | "followUpMode" | "entry">;
type GenUITransientTurn = NonNullable<GenUIRequestContext["transientTurns"]>[number];
const MAX_TRANSIENT_TURNS = 8;
type CurrentTaskActionKind = "structured_action" | "navigate" | "switch_tab";
type PendingActionAuthMode = "login" | "bind_phone";

type CurrentTaskAction = {
  kind: CurrentTaskActionKind;
  label: string;
  action?: string;
  payload?: Record<string, unknown>;
  source?: string;
  originalText?: string;
  url?: string;
};

type CurrentTaskItem = {
  id: string;
  taskType: "join_activity" | "find_partner" | "create_activity";
  taskTypeLabel: string;
  currentStage: string;
  stageLabel: string;
  status: string;
  goalText: string;
  headline: string;
  summary: string;
  updatedAt: string;
  activityId?: string;
  activityTitle?: string;
  primaryAction?: CurrentTaskAction;
  secondaryAction?: CurrentTaskAction;
};

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

type TaskChatPromptPayload = {
  prompt: string;
  activityId?: string;
  followUpMode?: "review" | "rebook" | "kickoff";
  entry?: string;
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

type GenUIFormFieldType = "single-select" | "multi-select" | "textarea";

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

const TYPEWRITER_INTERVAL_MS = 18;

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

function readCurrentTaskAction(value: unknown): CurrentTaskAction | null {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.label !== "string") {
    return null;
  }

  if (value.kind !== "structured_action" && value.kind !== "navigate" && value.kind !== "switch_tab") {
    return null;
  }

  return {
    kind: value.kind,
    label: value.label,
    ...(typeof value.action === "string" ? { action: value.action } : {}),
    ...(isRecord(value.payload) ? { payload: value.payload } : {}),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(typeof value.originalText === "string" ? { originalText: value.originalText } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
  };
}

function readCurrentTaskItem(value: unknown): CurrentTaskItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.taskType !== "string" ||
    typeof value.taskTypeLabel !== "string" ||
    typeof value.currentStage !== "string" ||
    typeof value.stageLabel !== "string" ||
    typeof value.status !== "string" ||
    typeof value.goalText !== "string" ||
    typeof value.headline !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  if (
    value.taskType !== "join_activity" &&
    value.taskType !== "find_partner" &&
    value.taskType !== "create_activity"
  ) {
    return null;
  }

  return {
    id: value.id,
    taskType: value.taskType,
    taskTypeLabel: value.taskTypeLabel,
    currentStage: value.currentStage,
    stageLabel: value.stageLabel,
    status: value.status,
    goalText: value.goalText,
    headline: value.headline,
    summary: value.summary,
    updatedAt: value.updatedAt,
    ...(typeof value.activityId === "string" ? { activityId: value.activityId } : {}),
    ...(typeof value.activityTitle === "string" ? { activityTitle: value.activityTitle } : {}),
    ...(value.primaryAction ? { primaryAction: readCurrentTaskAction(value.primaryAction) ?? undefined } : {}),
    ...(value.secondaryAction ? { secondaryAction: readCurrentTaskAction(value.secondaryAction) ?? undefined } : {}),
  };
}

function readTaskChatPromptPayload(value: unknown): TaskChatPromptPayload | null {
  if (!isRecord(value) || typeof value.prompt !== "string" || !value.prompt.trim()) {
    return null;
  }

  const followUpMode =
    value.followUpMode === "review" || value.followUpMode === "rebook" || value.followUpMode === "kickoff"
      ? value.followUpMode
      : undefined;

  return {
    prompt: value.prompt.trim(),
    ...(typeof value.activityId === "string" ? { activityId: value.activityId } : {}),
    ...(followUpMode ? { followUpMode } : {}),
    ...(typeof value.entry === "string" ? { entry: value.entry } : {}),
  };
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
  return value === "single-select" || value === "multi-select" || value === "textarea" ? value : null;
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

    if (!readGenUIFormTextValue(values, field.name).trim()) {
      return field.label;
    }
  }

  return null;
}

function extractActivityIdFromMiniProgramUrl(url: string): string | null {
  try {
    const parsed = new URL(url, GROUP_INVITE_URL);
    return readString(parsed.searchParams.get("id"));
  } catch {
    return null;
  }
}

function resolveWebTaskNavigation(action: CurrentTaskAction): { url?: string; focusIntent?: MessageCenterFocusIntent } {
  if (!action.url) {
    return {};
  }

  if (action.kind === "switch_tab" && action.url === "/pages/message/index") {
    return {
      focusIntent: readMessageCenterFocusIntent(action.payload) ?? undefined,
    };
  }

  if (action.url.startsWith("/subpackages/activity/discussion/index")) {
    const activityId = extractActivityIdFromMiniProgramUrl(action.url);
    if (!activityId) {
      return {};
    }

    return {
      url: `/invite/${activityId}?entry=task_runtime_panel`,
    };
  }

  if (action.url.startsWith("/subpackages/activity/detail/index")) {
    const activityId = extractActivityIdFromMiniProgramUrl(action.url);
    if (!activityId) {
      return {};
    }

    return {
      url: `/invite/${activityId}`,
    };
  }

  return {
    url: action.url,
  };
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

function resolvePrimaryBlockType(blocks: GenUIBlock[]): GenUITransientTurn["primaryBlockType"] {
  const primaryBlock = blocks.find((block) => block.type !== "text") ?? blocks[0];
  return primaryBlock?.type ?? null;
}

function summarizeAssistantBlocks(blocks: GenUIBlock[]): string {
  const textBlocks = blocks
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

  if (record.turn) {
    return summarizeAssistantBlocks(record.turn.turn.blocks);
  }

  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }

  return "";
}

function buildTransientTurns(records: ChatRecord[]): GenUITransientTurn[] {
  return records
    .slice(-MAX_TRANSIENT_TURNS)
    .map((record) => {
      const text = extractRecordText(record);
      if (!text) {
        return null;
      }

      if (record.role === "user") {
        return {
          role: "user",
          text,
        };
      }

      const primaryBlockType = record.turn
        ? resolvePrimaryBlockType(record.turn.turn.blocks)
        : null;

      return {
        role: "assistant",
        text,
        ...(primaryBlockType !== undefined ? { primaryBlockType } : {}),
        ...(record.turn?.turn.turnContext ? { turnContext: record.turn.turn.turnContext } : {}),
      };
    })
    .filter((turn): turn is GenUITransientTurn => Boolean(turn));
}

function isGenUIAlertLevel(value: unknown): value is GenUIAlertBlock["level"] {
  return value === "info" || value === "warning" || value === "error" || value === "success";
}

function isGenUITurnStatus(value: unknown): value is GenUITurnEnvelope["turn"]["status"] {
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

function isGenUITurnEnvelope(value: unknown): value is GenUITurnEnvelope {
  if (!isRecord(value) || typeof value.traceId !== "string" || typeof value.conversationId !== "string") {
    return false;
  }

  if (!isRecord(value.turn)) {
    return false;
  }

  return (
    typeof value.turn.turnId === "string" &&
    value.turn.role === "assistant" &&
    isGenUITurnStatus(value.turn.status) &&
    Array.isArray(value.turn.blocks) &&
    value.turn.blocks.every(isGenUIBlock)
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
  const [welcomeUi, setWelcomeUi] = useState<WelcomeUiPayload>({
    composerPlaceholder: DEFAULT_COMPOSER_PLACEHOLDER,
    bottomQuickActions: DEFAULT_BOTTOM_ACTIONS,
    profileHints: DEFAULT_PROFILE_HINTS,
  });
  const [clientLocation, setClientLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [currentTasks, setCurrentTasks] = useState<CurrentTaskItem[]>([]);
  const [pendingAgentAction, setPendingAgentAction] = useState<PendingAgentActionState | null>(null);
  const [taskPanelNotice, setTaskPanelNotice] = useState<string | null>(null);
  const [messageCenterOpenSignal, setMessageCenterOpenSignal] = useState(0);
  const [messageCenterFocusMatchId, setMessageCenterFocusMatchId] = useState<string | null>(null);
  const isDarkMode = false;
  const hasResumedPendingActionRef = useRef(false);

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
    setPendingAgentAction(readPendingAgentActionStateFromStorage());
  }, []);

  useEffect(() => {
    persistPendingAgentActionState(pendingAgentAction);
  }, [pendingAgentAction]);

  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      return;
    }

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) {
          return;
        }
        setClientLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
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
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
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
      });

    return () => {
      controller.abort();
    };
  }, [clientLocation]);

  const loadCurrentTasks = useCallback(async () => {
    if (!authToken) {
      setCurrentTasks([]);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/ai/tasks/current`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
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

      setCurrentTasks(
        payload.items
          .map((item) => readCurrentTaskItem(item))
          .filter((item): item is CurrentTaskItem => item !== null)
      );
    } catch {
      setCurrentTasks([]);
    }
  }, [authToken]);

  useEffect(() => {
    void loadCurrentTasks();
  }, [loadCurrentTasks]);

  const recordRebookFollowUp = useCallback(
    async (activityId?: string) => {
      if (!activityId || !authToken) {
        return;
      }

      try {
        await fetch(`${API_BASE}/participants/rebook-follow-up`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ activityId }),
        });
      } catch {
        // best effort only
      }
    },
    [authToken]
  );

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
          setTaskPanelNotice(null);
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
    }
  }, []);


  const sendTurn = useCallback(
    async (
      nextInput: GenUIInput,
      userDisplayText: string,
      contextOverrides?: TurnContextOverrides
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
        },
        {
          id: assistantMessageId,
          role: "assistant",
          pending: true,
        },
      ]);
      setStatus("submitted");

      try {
        const streamState: { envelope: GenUITurnEnvelope | null } = {
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

        const applyEnvelope = (nextEnvelope: GenUITurnEnvelope, pending = true) => {
          streamState.envelope = nextEnvelope;
          patchAssistantMessage(() => ({
            id: assistantMessageId,
            role: "assistant",
            pending,
            turn: nextEnvelope,
          }));
        };

        const ensureEnvelope = () => {
          if (streamState.envelope) {
            return streamState.envelope;
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

        const transientTurns = !authToken ? buildTransientTurns(messages) : undefined;
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
              ...(transientTurns && transientTurns.length > 0
                ? {
                    transientTurns,
                  }
                : {}),
              ...(contextOverrides || {}),
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
              payload = JSON.parse(parsed.dataText);
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
              isGenUIBlock(payload.data.block)
            ) {
              const block = payload.data.block;
              const mode = eventName === "block-replace" ? "replace" : "append";

              if (isGenUITextBlock(block)) {
                await typewriteTextBlock(block, mode);
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

            if (eventName === "turn-complete" && isRecord(payload) && isGenUITurnEnvelope(payload.data)) {
              const completeEnvelope = payload.data;
              sawTurnComplete = true;
              setConversationId(completeEnvelope.conversationId);
              applyEnvelope(completeEnvelope, false);
              applyCompletionEffectsFromBlocks(completeEnvelope.turn.blocks);
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

        const incompleteEnvelope = !sawTurnComplete ? streamState.envelope : null;
        if (incompleteEnvelope) {
          const completedEnvelope: GenUITurnEnvelope = {
            traceId: incompleteEnvelope.traceId,
            conversationId: incompleteEnvelope.conversationId,
            turn: {
              ...incompleteEnvelope.turn,
              status: "completed",
            },
          };
          applyEnvelope(completedEnvelope, false);
          applyCompletionEffectsFromBlocks(completedEnvelope.turn.blocks);
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
        if (authToken) {
          void loadCurrentTasks();
        }
      }
    },
    [applyCompletionEffectsFromBlocks, authToken, clientLocation, conversationId, isSending, loadCurrentTasks, messages]
  );

  const resumeStructuredPendingAction = useCallback(async () => {
    const nextToken = readClientToken();
    if (!pendingAgentAction) {
      return;
    }

    if (!nextToken) {
      setTaskPanelNotice(
        pendingAgentAction.action.authMode === "bind_phone"
          ? "先完成绑定手机号，再回到这里继续这一步。"
          : "先完成登录，再回到这里继续这一步。"
      );
      return;
    }

    setAuthToken(nextToken);
    const actionToResume = pendingAgentAction.action;
    setPendingAgentAction(null);
    setTaskPanelNotice(null);

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

  const executeCurrentTaskAction = useCallback(
    async (action: CurrentTaskAction) => {
      if (isSending) {
        return;
      }

      if (action.kind === "structured_action") {
        if (!action.action) {
          return;
        }

        if (action.action === "start_follow_up_chat") {
          const promptPayload = readTaskChatPromptPayload(action.payload);
          if (!promptPayload) {
            return;
          }

          if (promptPayload.followUpMode === "rebook" && promptPayload.activityId) {
            await recordRebookFollowUp(promptPayload.activityId);
          }

          await sendTurn(
            {
              type: "text",
              text: promptPayload.prompt,
            },
            action.originalText || action.label,
            {
              ...(promptPayload.activityId ? { activityId: promptPayload.activityId } : {}),
              ...(promptPayload.followUpMode ? { followUpMode: promptPayload.followUpMode } : {}),
              ...(promptPayload.entry ? { entry: promptPayload.entry } : {}),
            }
          );
          return;
        }

        await sendTurn(
          {
            type: "action",
            action: action.action,
            actionId: randomId("action"),
            params: action.payload,
            displayText: action.originalText || action.label,
          },
          action.originalText || action.label
        );
        return;
      }

      const navigation = resolveWebTaskNavigation(action);
      if (navigation.focusIntent) {
        setMessageCenterFocusMatchId(navigation.focusIntent.matchId ?? null);
        setMessageCenterOpenSignal((value) => value + 1);
        return;
      }

      if (navigation.url && typeof window !== "undefined") {
        window.location.href = navigation.url;
      }
    },
    [isSending, recordRebookFollowUp, sendTurn]
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

        {pendingAgentAction || currentTasks.length > 0 ? (
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
                    {taskPanelNotice ? (
                      <p className={cn("text-xs", isDarkMode ? "text-amber-100/80" : "text-amber-700")}>{taskPanelNotice}</p>
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

            {currentTasks.map((task) => (
              <section
                key={task.id}
                className={cn(
                  "rounded-[24px] border px-4 py-3 shadow-[0_18px_34px_-30px_rgba(52,72,158,0.5)]",
                  isDarkMode
                    ? "border-[#334185] bg-[#141c45]/88 text-[#eef2ff]"
                    : "border-white/70 bg-white/72 text-[#1b2558]"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          isDarkMode ? "bg-white/10 text-[#dce1ff]" : "bg-[#eef2ff] text-[#4250a7]"
                        )}
                      >
                        {task.taskTypeLabel}
                      </span>
                      <span className={cn("text-[11px]", isDarkMode ? "text-[#aeb7e7]" : "text-[#6d78a8]")}>
                        {task.stageLabel}
                      </span>
                    </div>
                    <p className="truncate text-[15px] font-semibold">{task.headline}</p>
                    <p className={cn("text-xs leading-5", isDarkMode ? "text-[#c6cef5]" : "text-[#5f6b9d]")}>{task.summary}</p>
                  </div>
                  <span className={cn("shrink-0 text-[11px]", isDarkMode ? "text-[#9ca8df]" : "text-[#7280b0]")}>
                    {formatRelativeTime(task.updatedAt)}
                  </span>
                </div>

                {task.primaryAction || task.secondaryAction ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.primaryAction ? (
                      <button
                        type="button"
                        onClick={() => {
                          void executeCurrentTaskAction(task.primaryAction!);
                        }}
                        disabled={isSending}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
                          isDarkMode ? "bg-[#5b67f4] text-white hover:bg-[#6a75ff]" : "bg-[#5b67f4] text-white hover:bg-[#4d59ec]"
                        )}
                      >
                        {task.primaryAction.label}
                      </button>
                    ) : null}
                    {task.secondaryAction ? (
                      <button
                        type="button"
                        onClick={() => {
                          void executeCurrentTaskAction(task.secondaryAction!);
                        }}
                        disabled={isSending}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-45",
                          isDarkMode ? "bg-white/10 text-white hover:bg-white/15" : "bg-[#edf1ff] text-[#33407c] hover:bg-[#e4eaff]"
                        )}
                      >
                        {task.secondaryAction.label}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        ) : null}

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

                    {welcomeDraftAction ? (
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

                    {welcomePendingActivities.length > 0 ? (
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
                  className={cn(
                    "h-8 rounded-full border-0 px-3 text-xs backdrop-blur-sm shadow-[0_10px_22px_-14px_rgba(82,102,191,0.34)] transition-[filter,transform] hover:brightness-[1.02] hover:-translate-y-[0.5px]",
                    isDarkMode
                      ? "bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22)_0%,rgba(129,150,236,0.2)_56%,rgba(79,97,171,0.2)_100%)] text-[#e9edff]"
                      : "bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98)_0%,rgba(244,248,255,0.96)_54%,rgba(230,238,255,0.95)_100%)] text-[#2d396f]"
                  )}
                />
              ))}
            </Suggestions>
          </div>

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
                  可补充时间、地点、人数
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
    <Message from="assistant" className="w-full max-w-none pr-0">
      <MessageContent className="w-full overflow-visible rounded-none bg-transparent px-0 py-0 text-slate-800 shadow-none">
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
    return <ListBlockCard block={block} />;
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

  useEffect(() => {
    setFormValues(initialValues);
    setFormError(null);
  }, [initialValues]);

  const submitLabel =
    typeof schema.submitLabel === "string" && schema.submitLabel.trim()
      ? schema.submitLabel.trim()
      : "提交";

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

  return (
    <div className="rounded-xl border border-slate-200 bg-white/85 p-3">
      <p className="text-sm font-semibold text-slate-800">{block.title || "参数设置"}</p>

      {showFallbackPreview ? (
        <div className="mt-2 space-y-2">
          {Object.entries(initialValues).map(([key, value]) => (
            <div key={key} className="rounded-lg bg-slate-50/90 px-3 py-2">
              <p className="text-[11px] text-slate-500">{prettyFieldLabel(key)}</p>
              <p className="text-sm text-slate-800">{renderFieldValue(value)}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {fields.map((field) => {
            if (field.type === "textarea") {
              const currentValue = readGenUIFormTextValue(formValues, field.name);
              return (
                <div key={field.name} className="space-y-1.5">
                  <div className="flex items-center gap-1">
                    <p className="text-[12px] font-medium text-slate-600">{field.label}</p>
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
                    className="min-h-[84px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300 disabled:opacity-45"
                  />
                </div>
              );
            }

            if (field.type === "multi-select") {
              const currentValues = readGenUIFormMultiValue(formValues, field.name);
              return (
                <div key={field.name} className="space-y-1.5">
                  <div className="flex items-center gap-1">
                    <p className="text-[12px] font-medium text-slate-600">{field.label}</p>
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
                            "rounded-full px-3 py-1.5 text-xs transition disabled:opacity-45",
                            selected
                              ? "bg-slate-800 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
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
                  <p className="text-[12px] font-medium text-slate-600">{field.label}</p>
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
                        "rounded-full px-3 py-1.5 text-xs transition disabled:opacity-45",
                        currentValue === option.value
                          ? "bg-[#5b67f4] text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {formError ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{formError}</p>
          ) : null}

          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={disabled}
            className="w-full rounded-2xl bg-[#5b67f4] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#4d59ec] disabled:opacity-45"
          >
            {submitLabel}
          </button>
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

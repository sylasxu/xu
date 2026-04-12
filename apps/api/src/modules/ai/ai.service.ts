/**
 * AI Service - 模块化架构
 * 
 * 精简的服务层，编排各模块完成 AI Chat
 * 
 * 模块依赖：
 * - intent/ - 意图识别
 * - memory/ - 会话存储
 * - tools/ - 工具系统
 * - models/ - 模型路由
 */

import {
  db,
  users,
  conversations,
  conversationMessages,
  activities,
  participants,
  agentTasks,
  eq,
  desc,
  sql,
  inArray,
  and,
  or,
  gt,
  lt,
} from '@juchang/db';
import {
  convertToModelMessages,
  stepCountIs,
  hasToolCall,
  type LanguageModelUsage,
  type UIMessage,
} from 'ai';
import { randomUUID } from 'crypto';
import type { ProcessorLogEntry } from '@juchang/db';
import type { GenUIBlock, GenUIRequest, GenUITracePayload, GenUISuggestions } from '@juchang/genui-contract';

// 新架构模块
import { type ClassifyResult } from './intent';
import { getOrCreateThread, saveMessage, clearUserThreads, deleteThread } from './memory';
import { getConversationMessageExpiresAt, refreshMessageEmbedding } from './memory/store';
import { resolveToolsForIntent } from './tools';
import { getSystemPrompt, type PromptContext, type ActivityDraftForPrompt } from './prompts';
import { getFallbackConfig, resolveChatModelSelection, resolveFallbackChatModelSelection, shouldOmitTemperatureForModelId } from './models/router';
import { runText } from './models/runtime';
import { generateText } from 'ai';
// Guardrails
import { checkRateLimit } from './guardrails/rate-limiter';
// 辅助函数（从独立模块导入）
import { getUserNickname } from '../users/user.service';
import { reverseGeocode } from './utils/geo';
// Observability
import { createLogger } from './observability/logger';
import { runWithTrace } from './observability/tracer';
// WorkingMemory (Enhanced)
import {
  getEnhancedUserProfile,
  buildProfilePrompt,
} from './memory/working';
// Processors (v4.9 管线架构)
import {
  inputGuardProcessor,
  keywordMatchProcessor,
  extractPreferencesProcessor,
  outputGuardProcessor,
  recordMetricsProcessor,
  persistRequestProcessor,
  runProcessors,
  runPostLLMProcessors,
  runAsyncProcessors,
  buildPreLLMPipeline,
  type ProcessorContext,
} from './processors';
// Partner Matching - 找搭子追问流程
import {
  buildPartnerAskPreferencePayload,
  buildPartnerSearchPayloadFromState,
  shouldStartPartnerMatching,
  recoverPartnerMatchingState,
  createPartnerMatchingState,
  updatePartnerMatchingState,
  getNextQuestion,
  parseUserAnswer,
  looksLikePartnerAnswer,
  inferPartnerMessageHints,
  persistPartnerMatchingState,
  buildPartnerWorkflowIntroText,
  type PartnerMatchingState,
} from './workflow/partner-matching';
// Structured Action：结构化动作可直接映射为 UI 响应
import { handleStructuredAction, type StructuredAction } from './user-action';
import { buildSuggestionsFromBlocks } from './suggestions';
import { getConfigValue } from './config/config.service';
import { buildNextBestActions, type NextBestActionItem } from './workflow/next-actions';
import {
  listCurrentAgentTaskSnapshots,
  markJoinTaskDiscussionEntered,
  resolveConversationTaskId,
  syncCreateTaskFromChatResponse,
  syncJoinTaskFromChatResponse,
  syncPartnerTaskFromChatResponse,
} from './task-runtime/agent-task.service';
import { isIdentityMemoryQuestion } from './identity-reply';
import { applyAiChatResponsePolicies } from './runtime/response-policy';
import type { AiChatEnvelopeResult } from './runtime/chat-response';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ViewerContext {
  id: string;
  role: string;
}

export function isUuidLike(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function resolveConversationUserText(input: GenUIRequest['input']): string {
  if (input.type === 'text') {
    return input.text.trim();
  }

  if (typeof input.displayText === 'string' && input.displayText.trim()) {
    return input.displayText.trim();
  }

  const params = input.params && typeof input.params === 'object' ? input.params : null;
  const candidates = params
    ? [params.location, params.value, params.activityType, params.type, params.slot, params.title]
    : [];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return input.action.trim();
}

type ConversationMessageRecord = typeof conversationMessages.$inferSelect;

interface HydratedConversationMessage {
  id: string;
  userId: string;
  userNickname: string | null;
  role: ConversationMessageRecord['role'];
  type: ConversationMessageRecord['messageType'];
  content: ConversationMessageRecord['content'];
  activityId: ConversationMessageRecord['activityId'];
  createdAt: string;
}

interface HydratedConversationListItem {
  id: string;
  userId: string;
  title: string | null;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  userNickname: string | null;
  evaluationStatus: typeof conversations.$inferSelect.evaluationStatus;
  evaluationTags: string[];
  evaluationNote: string | null;
  hasError: boolean;
}

// ==========================================
// Domain Facade Exports (ai.service 总线收口)
// ==========================================
export {
  getRagStats,
  testRagSearch,
  rebuildActivityIndex,
  startBackfill,
  getBackfillStatus,
} from './rag/rag.service';

export {
  getUserMemoryProfile,
  searchUsers,
  testMaxSim,
} from './memory/memory.service';

export {
  getSecurityOverview,
  getSensitiveWords,
  addSensitiveWord,
  deleteSensitiveWord,
  importSensitiveWords,
  getModerationQueue,
  approveModeration,
  rejectModeration,
  banModeration,
  getViolationStats,
  getSensitiveWordsFromDB,
  addSensitiveWordToDB,
  deleteSensitiveWordFromDB,
  getSecurityEvents,
  getSecurityStatsFromDB,
} from './security/security.service';

export {
  getTokenUsageStats,
  getTokenUsageSummary,
  getToolCallStats,
} from './observability/metrics';

export {
  getSystemPrompt,
  getPromptTemplateConfig,
  getPromptTemplateMetadata,
} from './prompts';

export {
  listCurrentAgentTaskSnapshots,
  markJoinTaskDiscussionEntered,
} from './task-runtime/agent-task.service';

export {
  normalizeAiProviderErrorMessage,
} from './models/provider-error';

const logger = createLogger('ai.service');

// ==========================================
// Types
// ==========================================

export interface ChatRequest {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content?: string;
    parts?: Array<Record<string, unknown>>;
  }>;
  userId: string | null;
  rateLimitUserId?: string | null;
  conversationId?: string;
  location?: [number, number];
  source: 'web' | 'miniprogram' | 'admin';
  draftContext?: { activityId: string; currentDraft: ActivityDraftForPrompt };
  trace?: boolean;
  ai?: { model?: string; temperature?: number; maxTokens?: number };
  abortSignal?: AbortSignal;
  /** 结构化动作：跳过 LLM 意图识别直接执行 */
  structuredAction?: StructuredAction;
  /** v5.4: 最近一次 Assistant 回复携带的 follow-up，用于无登录状态下继续承接上下文 */
  latestAssistantSuggestions?: GenUISuggestions;
  /** 更早历史的压缩摘要，避免直接发送全量消息 */
  conversationSummary?: string;
}

export interface TraceStep {
  toolName: string;
  toolCallId: string;
  args: unknown;
  result?: unknown;
  errorText?: string;
}

export type ChatExecutionPath = 'llm_orchestrated' | 'structured_action';

export interface ChatBlockPayload {
  widgetType: string;
  payload: unknown;
}

export interface ChatActionResult {
  success: boolean;
  error?: string;
  nextActions?: Array<{
    label: string;
    action: string;
    params?: Record<string, unknown>;
  }>;
}

export interface ChatExecutionResult {
  assistantText: string;
  executionPath: ChatExecutionPath;
  toolCallRecords: TraceStep[];
  blockPayloads: ChatBlockPayload[];
  actionResults: ChatActionResult[];
  traces: GenUITracePayload[];
}

type ChatMessage = ChatRequest['messages'][number];
type ChatMessagePart = NonNullable<ChatMessage['parts']>[number];
const CONVERSATION_MESSAGE_TYPES = new Set<string>([
  'text',
  'user_action',
  'widget_dashboard',
  'widget_launcher',
  'widget_action',
  'widget_draft',
  'widget_share',
  'widget_explore',
  'widget_error',
  'widget_ask_preference',
]);

interface TextChatMessagePart extends Record<string, unknown> {
  type: 'text';
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isTextChatMessagePart(part: ChatMessagePart | undefined): part is TextChatMessagePart {
  return isRecord(part) && part.type === 'text' && typeof part.text === 'string';
}

function getMessageTextContent(message: Pick<ChatMessage, 'content' | 'parts'>): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  const textPart = message.parts?.find((part): part is TextChatMessagePart => isTextChatMessagePart(part));
  return textPart?.text ?? '';
}

function isConversationMessageType(value: string): value is ConversationMessageRecord['messageType'] {
  return CONVERSATION_MESSAGE_TYPES.has(value);
}

function replaceMessageTextContent(message: ChatMessage, text: string): ChatMessage {
  return {
    ...message,
    content: text,
    parts: [{ type: 'text', text }],
  };
}

function toTextUIMessageParts(message: ChatMessage): UIMessage['parts'] {
  const text = getMessageTextContent(message);
  return text ? [{ type: 'text', text }] : [];
}

function getActivityIdFromValue(value: unknown): string | undefined {
  const record = asRecord(value);
  return typeof record?.activityId === 'string' ? record.activityId : undefined;
}

function getActivityIdFromTraceSteps(steps: TraceStep[]): string | undefined {
  for (const step of steps) {
    const activityId = getActivityIdFromValue(step.result);
    if (activityId) {
      return activityId;
    }
  }

  return undefined;
}

function getTokenLimitSnapshot(data: unknown): {
  truncated: boolean;
  originalLength: number;
  finalLength: number;
} {
  const tokenData = asRecord(data);
  const originalLength = typeof tokenData?.originalTokens === 'number'
    ? tokenData.originalTokens
    : typeof tokenData?.totalTokens === 'number'
      ? tokenData.totalTokens
      : 0;
  const finalLength = typeof tokenData?.truncatedTokens === 'number'
    ? tokenData.truncatedTokens
    : typeof tokenData?.totalTokens === 'number'
      ? tokenData.totalTokens
      : 0;

  return {
    truncated: tokenData?.truncated === true,
    originalLength,
    finalLength,
  };
}

function shouldEmitExploreWidgetPayload(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) {
    return false;
  }

  const results = Array.isArray(record.results) ? record.results : [];
  const fetchConfig = asRecord(record.fetchConfig);
  const preview = asRecord(record.preview);

  return results.length > 0 || !!fetchConfig || !!preview;
}

function getExploreTypeLabel(type: string | undefined): string | null {
  switch (type) {
    case 'sports':
      return '运动';
    case 'food':
      return '约饭';
    case 'boardgame':
      return '桌游';
    case 'entertainment':
      return '娱乐';
    case 'other':
      return '活动';
    default:
      return null;
  }
}

function formatNextActionLabels(items: NextBestActionItem[]): string {
  const labels = items
    .map((item) => item.label.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (labels.length === 0) {
    return '';
  }

  if (labels.length === 1) {
    return `“${labels[0]}”`;
  }

  if (labels.length === 2) {
    return `“${labels[0]}”或“${labels[1]}”`;
  }

  return `“${labels[0]}”、“${labels[1]}”或“${labels[2]}”`;
}

function normalizeSourceText(text: string | undefined): string {
  return typeof text === 'string' ? text.trim() : '';
}

function looksLikeAvailabilityQuestion(text: string): boolean {
  return /有没有|有吗|能不能|还有吗/.test(text);
}

function looksLikeBrowseRequest(text: string): boolean {
  return /看看|看下|瞅瞅|刷刷|先看/.test(text);
}

function looksLikeFillSeatRequest(text: string): boolean {
  return /三缺一|差一个|缺人|补位/.test(text);
}

function buildExploreOpening(params: {
  originalText: string;
  locationLabel: string;
  targetLabel: string;
  hasResults: boolean;
  actionLabels: string;
}): string {
  const { originalText, locationLabel, targetLabel, hasResults, actionLabels } = params;

  if (hasResults) {
    if (looksLikeAvailabilityQuestion(originalText)) {
      return `${locationLabel}这边有，我先替你筛了一轮，下面这些${targetLabel}你先看看有没有想继续接的。`;
    }

    if (looksLikeBrowseRequest(originalText)) {
      return `先把${locationLabel}这边能接得上的${targetLabel}给你摆出来了，你先往下看。`;
    }

    return `${locationLabel}这边我先给你收了一批${targetLabel}，你先看看哪几个更对味。`;
  }

  const nextStepText = actionLabels
    ? `你可以先试试${actionLabels}，`
    : '';

  if (looksLikeAvailabilityQuestion(originalText)) {
    return `${locationLabel}这会儿我还没替你刷到特别合适的${targetLabel}。${nextStepText}也可以直接告诉我想换的地方、时间、类型或预算，我继续帮你找。`;
  }

  return `${locationLabel}这会儿还没刷到合适的${targetLabel}。${nextStepText}你也可以直接把条件改细一点，我继续往下筛。`;
}

function buildPartnerOpening(params: {
  originalText: string;
  locationLabel: string;
  targetLabel: string;
  hasResults: boolean;
  actionLabels: string;
}): string {
  const { originalText, locationLabel, targetLabel, hasResults, actionLabels } = params;
  const searchTargetLabel = looksLikeFillSeatRequest(originalText) ? '能来补位的人' : targetLabel;

  if (hasResults) {
    if (looksLikeFillSeatRequest(originalText)) {
      return `${locationLabel}这边我先按补位方向筛了一圈，下面这几位你先看看能不能接上这桌。`;
    }

    if (looksLikeAvailabilityQuestion(originalText)) {
      return `${locationLabel}这边有，我先按${searchTargetLabel}这个方向筛了一轮，你先看看下面这些合不合适。`;
    }

    return `${locationLabel}这边我先帮你筛了一圈${searchTargetLabel}，你先看看下面这几位顺不顺眼。`;
  }

  const nextStepText = actionLabels
    ? `你可以先试试${actionLabels}，`
    : '';

  if (looksLikeFillSeatRequest(originalText)) {
    return `${locationLabel}这边我先按补位方向找过一轮了，暂时还没碰到特别合适的人。${nextStepText}你也可以补一句时间、牌风或者具体在哪一片，我继续帮你捞。`;
  }

  return `${locationLabel}这边我先筛过一轮，暂时还没碰到特别合适的${searchTargetLabel}。${nextStepText}也可以直接告诉我你想找的人是什么样、一般在哪片活动方便，我继续帮你收窄。`;
}

function buildStructuredActionReplyText(params: {
  actionType: StructuredAction['action'] | undefined;
  data: Record<string, unknown> | undefined;
  defaultMessage: string;
  nextActions: NextBestActionItem[];
  originalText?: string;
}): string {
  const { actionType, data, defaultMessage, nextActions, originalText } = params;
  const trimmedDefaultMessage = defaultMessage.trim();
  const actionLabels = formatNextActionLabels(nextActions);
  const sourceText = normalizeSourceText(originalText);
  const locationName = typeof data?.locationName === 'string' ? data.locationName.trim() : '';
  const exploreType = typeof data?.type === 'string' ? data.type : undefined;
  const exploreTypeLabel = getExploreTypeLabel(exploreType);
  const explorePayload = isRecord(data?.explore) ? data.explore : null;
  const exploreCenter = isRecord(explorePayload?.center) ? explorePayload.center : null;
  const exploreLocationName = typeof exploreCenter?.name === 'string' && exploreCenter.name.trim()
    ? exploreCenter.name.trim()
    : locationName;
  const exploreResults = Array.isArray(explorePayload?.results) ? explorePayload.results : [];

  if (actionType === 'explore_nearby') {
    const locationLabel = exploreLocationName || '附近';
    const targetLabel = exploreTypeLabel ? `${exploreTypeLabel}局` : '局';
    return buildExploreOpening({
      originalText: sourceText,
      locationLabel,
      targetLabel,
      hasResults: exploreResults.length > 0,
      actionLabels,
    });
  }

  if (actionType === 'find_partner' || actionType === 'search_partners' || actionType === 'submit_partner_intent_form') {
    if (isRecord(data?.partnerIntentForm)) {
      const partnerStage = typeof data.partnerIntentForm.partnerStage === 'string'
        ? data.partnerIntentForm.partnerStage
        : '';
      if (partnerStage === 'intent_pool') {
        return `${trimmedDefaultMessage || '我把可补充的偏好都展开了。'}填得越具体，后面替你留意时就会越准。`;
      }

      return `${trimmedDefaultMessage || '我把可调整的偏好都展开了。'}你可以直接细化这些条件，我会按新的要求继续筛。`;
    }

    if (isRecord(data?.askPreference)) {
      const actionGuidance = actionLabels
        ? `你可以先试试${actionLabels}，`
        : '';
      return `${trimmedDefaultMessage || '我先按你刚才说的方向收一收，再补一个最关键的条件。'}${actionGuidance}也可以直接告诉我你想找的人是什么样、一般在哪片活动方便，我继续帮你往下接。`;
    }

    const partnerResults = isRecord(data?.partnerSearchResults) && Array.isArray(data.partnerSearchResults.items)
      ? data.partnerSearchResults.items
      : [];
    const locationLabel = locationName || '你这附近';
    const targetLabel = exploreTypeLabel ? `${exploreTypeLabel}搭子` : '搭子';
    return buildPartnerOpening({
      originalText: sourceText,
      locationLabel,
      targetLabel,
      hasResults: partnerResults.length > 0,
      actionLabels,
    });
  }

  if (actionType === 'create_activity' || actionType === 'save_draft_settings' || actionType === 'publish_draft' || actionType === 'confirm_publish') {
    const actionGuidance = actionLabels
      ? `你可以直接试试${actionLabels}，`
      : '';
    return `${trimmedDefaultMessage || '我先把这场局替你整理好了。'}${actionGuidance}也可以直接告诉我还想改哪里，我继续帮你调。`;
  }

  if (actionType === 'join_activity' || actionType === 'confirm_match' || actionType === 'cancel_match' || actionType === 'cancel_join' || actionType === 'record_activity_feedback') {
    const actionGuidance = actionLabels
      ? `你可以先试试${actionLabels}，`
      : '';
    return `${trimmedDefaultMessage || '这一步已经接上了。'}${actionGuidance}也可以直接告诉我你接下来想看什么，我继续陪你往下走。`;
  }

  if (actionLabels) {
    return `${trimmedDefaultMessage || '我先把接下来能做的路给你收好了。'}你可以先试试${actionLabels}，也可以直接告诉我还想怎么改，我继续帮你处理。`;
  }

  return trimmedDefaultMessage;
}

function getCacheHitTokens(usage: LanguageModelUsage): number | undefined {
  return usage.inputTokenDetails.cacheReadTokens ?? usage.cachedInputTokens;
}

function getCacheMissTokens(usage: LanguageModelUsage): number | undefined {
  return usage.inputTokenDetails.noCacheTokens;
}

function inferIntentFromStructuredAction(actionType: StructuredAction['action'] | undefined): ClassifyResult['intent'] {
  if (!actionType) {
    return 'unknown';
  }

  if (
    actionType === 'create_activity'
    || actionType === 'edit_draft'
    || actionType === 'save_draft_settings'
    || actionType === 'publish_draft'
    || actionType === 'confirm_publish'
  ) {
    return 'create';
  }

  if (
    actionType === 'explore_nearby'
    || actionType === 'ask_preference'
    || actionType === 'expand_map'
    || actionType === 'filter_activities'
  ) {
    return 'explore';
  }

  if (
    actionType === 'find_partner'
    || actionType === 'search_partners'
    || actionType === 'connect_partner'
    || actionType === 'request_partner_group_up'
    || actionType === 'opt_in_partner_pool'
    || actionType === 'submit_partner_intent_form'
    || actionType === 'confirm_match'
    || actionType === 'cancel_match'
    || actionType === 'select_preference'
    || actionType === 'skip_preference'
  ) {
    return 'partner';
  }

  if (
    actionType === 'join_activity'
    || actionType === 'view_activity'
    || actionType === 'cancel_join'
    || actionType === 'share_activity'
    || actionType === 'record_activity_feedback'
  ) {
    return 'manage';
  }

  return 'unknown';
}

// ==========================================
// AI Chat 核心
// ==========================================

export async function executeChatRequest(request: ChatRequest): Promise<ChatExecutionResult> {
  return runWithTrace(async () => {
    const {
      messages,
      userId,
      rateLimitUserId,
      conversationId,
      location,
      source,
      draftContext,
      ai,
      abortSignal,
      structuredAction,
      conversationSummary,
    } = request;

    let effectiveMessages = messages;
    const startTime = Date.now();
    const latestMessage = messages[messages.length - 1];
    const currentInputText = typeof latestMessage?.content === 'string'
      ? latestMessage.content
      : latestMessage?.parts?.find((part): part is { type: 'text'; text: string } => part.type === 'text')?.text
        || structuredAction?.originalText
        || '';

    const rateLimitSubject = userId || rateLimitUserId || null;
    const rateLimitResult = await checkRateLimit(rateLimitSubject, { maxRequests: 30, windowSeconds: 60 });
    if (!rateLimitResult.allowed) {
      logger.warn('Rate limit exceeded', { userId, retryAfter: rateLimitResult.retryAfter });
      return buildDirectResponseResult({ type: 'rate_limit', retryAfter: rateLimitResult.retryAfter });
    }

    const processorLogs: ProcessorLogEntry[] = [];
    const createGuardContext = (inputText: string): ProcessorContext => ({
      userId,
      messages: [],
      rawUserInput: inputText,
      userInput: inputText.trim().slice(0, 2000),
      systemPrompt: '',
      metadata: {},
    });

    const initialGuardResult = await inputGuardProcessor(createGuardContext(currentInputText));
    processorLogs.push({
      processorName: inputGuardProcessor.processorName,
      executionTime: initialGuardResult.executionTime,
      success: initialGuardResult.success,
      data: initialGuardResult.data,
      error: initialGuardResult.error,
      timestamp: new Date().toISOString(),
    });

    if (!initialGuardResult.success) {
      logger.warn('Input blocked', { userId, error: initialGuardResult.error });
      return buildDirectResponseResult({ type: 'blocked' });
    }

    let sanitizedInput = initialGuardResult.context.userInput;

    if (structuredAction) {
      logger.info('Processing structured action', {
        action: structuredAction.action,
        source: structuredAction.source,
        userId: userId || 'anon',
      });

      const actionResult = await handleStructuredAction(
        structuredAction,
        userId,
        location ? { lat: location[1], lng: location[0] } : undefined
      );

      if (!actionResult.fallbackToLLM) {
        return buildStructuredActionResult(actionResult, structuredAction);
      }

      if (actionResult.fallbackToLLM && actionResult.fallbackText) {
        const modifiedMessages = [...effectiveMessages];
        if (modifiedMessages.length > 0) {
          const lastMsg = modifiedMessages[modifiedMessages.length - 1];
          if (lastMsg.role === 'user') {
            modifiedMessages[modifiedMessages.length - 1] = replaceMessageTextContent(lastMsg, actionResult.fallbackText);
          }
        }
        effectiveMessages = modifiedMessages;

        if (actionResult.fallbackText !== currentInputText) {
          const fallbackGuardResult = await inputGuardProcessor(createGuardContext(actionResult.fallbackText));
          processorLogs.push({
            processorName: inputGuardProcessor.processorName,
            executionTime: fallbackGuardResult.executionTime,
            success: fallbackGuardResult.success,
            data: fallbackGuardResult.data,
            error: fallbackGuardResult.error,
            timestamp: new Date().toISOString(),
          });

          if (!fallbackGuardResult.success) {
            logger.warn('Fallback input blocked', { userId, error: fallbackGuardResult.error });
            return buildDirectResponseResult({ type: 'blocked' });
          }

          sanitizedInput = fallbackGuardResult.context.userInput;
        }
      }
    }

    const conversationHistory: Array<{
      role: ChatRequest['messages'][number]['role'];
      content: string;
    }> = effectiveMessages.map((m) => ({
      role: m.role,
      content: getMessageTextContent(m),
    }));
    const rawUserInput = conversationHistory.filter((message) => message.role === 'user').pop()?.content || currentInputText;

    const locationName = location ? await reverseGeocode(location[1], location[0]) : undefined;
    const userNickname = userId ? await getUserNickname(userId) : undefined;
    const userProfile = userId ? await getEnhancedUserProfile(userId) : null;

    const baseMemory = userProfile ? buildProfilePrompt(userProfile) : null;
    const memoryContext = [baseMemory]
      .filter((section): section is string => Boolean(section))
      .join('\n\n') || null;

    const promptContext: PromptContext = {
      currentTime: new Date(),
      userLocation: location ? { lat: location[1], lng: location[0], name: locationName } : undefined,
      userNickname,
      draftContext,
      memoryContext,
    };

    const baseSystemPrompt = await getSystemPrompt(promptContext);
    const initialContext: ProcessorContext = {
      userId,
      messages: conversationHistory,
      rawUserInput,
      userInput: sanitizedInput,
      systemPrompt: conversationSummary
        ? `${baseSystemPrompt}\n\n## 更早对话摘要\n${conversationSummary}`
        : baseSystemPrompt,
      metadata: {
        ...(ai ? { requestAi: ai } : {}),
      },
    };

    const keywordResult = await keywordMatchProcessor(initialContext);
    processorLogs.push({
      processorName: keywordMatchProcessor.processorName,
      executionTime: keywordResult.executionTime,
      success: keywordResult.success,
      data: keywordResult.data,
      error: keywordResult.error,
      timestamp: new Date().toISOString(),
    });

    const keywordMeta = keywordResult.context.metadata.keywordMatch;
    const matchedKeywordId = keywordMeta?.matched ? (keywordMeta.keywordId ?? null) : null;

    const preLLMConfigs = await buildPreLLMPipeline();
    const { context: preLLMContext, logs: pipelineLogs, success: pipelineSuccess } = await runProcessors(preLLMConfigs, keywordResult.context);
    processorLogs.push(...pipelineLogs);

    if (!pipelineSuccess) {
      logger.warn('Pre-LLM pipeline failed', { logs: pipelineLogs.filter(l => !l.success) });
      return buildDirectResponseResult({ type: 'fallback', context: 'Pre-LLM pipeline failed' });
    }

    const intentClassifyMeta = preLLMContext.metadata.intentClassify;
    const intentResult: ClassifyResult = intentClassifyMeta ? {
      intent: intentClassifyMeta.intent,
      confidence: intentClassifyMeta.confidence,
      method: intentClassifyMeta.method,
      matchedPattern: intentClassifyMeta.matchedPattern,
      p1Features: intentClassifyMeta.p1Features,
    } : { intent: 'unknown' as const, confidence: 0, method: 'p1' as const };

    if (keywordMeta?.matched) {
      logger.info('P0 keyword matched', {
        keywordId: keywordMeta.keywordId,
        keyword: keywordMeta.keyword,
        matchType: keywordMeta.matchType,
        userId: userId || 'anon',
      });

      const { incrementHitCount } = await import('../hot-keywords/hot-keywords.service');
      if (keywordMeta.keywordId) {
        incrementHitCount(keywordMeta.keywordId).catch(err => {
          logger.error('Failed to increment hit count', { error: err });
        });
      }
    }

    if (userId) {
      const partnerThreadId = conversationId || (await getOrCreateThread(userId)).id;
      const partnerMatchingState = await recoverPartnerMatchingState(partnerThreadId);

      if (partnerMatchingState) {
        const currentQuestion = getNextQuestion(partnerMatchingState);
        if (looksLikePartnerAnswer(sanitizedInput, currentQuestion)) {
          return handlePartnerMatchingFlowResult(request, partnerMatchingState, partnerThreadId, sanitizedInput);
        }
      }

      if (intentResult.intent === 'partner' && shouldStartPartnerMatching('partner', partnerMatchingState)) {
        return handlePartnerMatchingFlowResult(request, partnerMatchingState, partnerThreadId, sanitizedInput);
      }
    }

    const userLocation = location ? { lat: location[1], lng: location[0] } : null;
    const tools = await resolveToolsForIntent(userId, intentResult.intent, {
      hasDraftContext: !!draftContext,
      location: userLocation,
    });

    const injectedPrompts: string[] = [];
    if (preLLMContext.metadata.userProfilePrompt) {
      injectedPrompts.push(preLLMContext.metadata.userProfilePrompt as string);
    }
    if (preLLMContext.metadata.semanticRecallPrompt) {
      injectedPrompts.push(preLLMContext.metadata.semanticRecallPrompt as string);
    }
    const systemPrompt = injectedPrompts.length > 0
      ? `${preLLMContext.systemPrompt}\n\n${injectedPrompts.join('\n\n')}`
      : preLLMContext.systemPrompt;

    const uiMessages: UIMessage[] = effectiveMessages.map((m, i) => ({
      id: `msg-${i}`,
      role: m.role,
      parts: toTextUIMessageParts(m),
    }));
    const aiMessages = await convertToModelMessages(uiMessages);

    const toolCallRecords: TraceStep[] = [];
    const modelType = ((intent: string): 'chat' | 'reasoning' | 'agent' => {
      switch (intent) {
        case 'partner': return 'reasoning';
        case 'create': return 'agent';
        default: return 'chat';
      }
    })(intentResult.intent);
    const {
      model: selectedModel,
      modelId: selectedModelId,
      provider: selectedProvider,
    } = await resolveChatModelSelection({
      intent: modelType,
      modelId: ai?.model,
    });

    const runTextRequest = {
      system: systemPrompt,
      messages: aiMessages,
      tools,
      ...(
        selectedProvider === 'moonshot'
          ? {
              providerOptions: {
                moonshotai: {
                  reasoningHistory: 'disabled' as const,
                },
              },
            }
          : {}
      ),
      ...(
        shouldOmitTemperatureForModelId(selectedModelId)
          ? {}
          : { temperature: ai?.temperature ?? 0 }
      ),
      maxOutputTokens: ai?.maxTokens,
      abortSignal,
      stopWhen: [stepCountIs(5), hasToolCall('askPreference')],
      onStepFinish: (step: any) => {
        for (const tc of step.toolCalls || []) {
          if (!toolCallRecords.find((item) => item.toolCallId === tc.toolCallId)) {
            toolCallRecords.push({
              toolName: tc.toolName,
              toolCallId: tc.toolCallId,
              args: tc.input,
            });
          }
        }

        for (const tr of step.toolResults || []) {
          const existing = toolCallRecords.find((item) => item.toolCallId === tr.toolCallId);
          if (existing) {
            existing.result = tr.output;
          }
        }
      },
    };

    let textResult;
    let modelId = selectedModelId;

    try {
      textResult = await runText({
        model: selectedModel,
        ...runTextRequest,
      });
    } catch (primaryError) {
      const fallbackConfig = await getFallbackConfig();
      if (!fallbackConfig.enableFallback) {
        throw primaryError;
      }

      const fallbackSelection = await resolveFallbackChatModelSelection({ intent: modelType });

      if (
        fallbackSelection.provider === selectedProvider
        && fallbackSelection.modelId === selectedModelId
      ) {
        throw primaryError;
      }

      logger.warn('Primary chat model failed, retrying with fallback provider', {
        primaryProvider: selectedProvider,
        primaryModelId: selectedModelId,
        fallbackProvider: fallbackSelection.provider,
        fallbackModelId: fallbackSelection.modelId,
        configuredFallback: fallbackConfig.fallback,
        error: primaryError instanceof Error ? primaryError.message : String(primaryError),
      });

      textResult = await runText({
        model: fallbackSelection.model,
        ...runTextRequest,
      });
      modelId = fallbackSelection.modelId;
    }

    const aiResponseText = textResult.text || '';
    const usage = textResult.usage;
    const totalUsage = {
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
    };
    const duration = Date.now() - startTime;

    const postLLMContext: ProcessorContext = {
      ...preLLMContext,
      messages: [
        ...preLLMContext.messages,
        { role: 'assistant' as const, content: aiResponseText },
      ],
      metadata: {
        ...preLLMContext.metadata,
        chatProtocol: 'genui_chat',
        conversationId: conversationId ?? undefined,
        activityId: getActivityIdFromTraceSteps(toolCallRecords),
        metricsData: {
          modelId,
          duration,
          inputTokens: totalUsage.promptTokens,
          outputTokens: totalUsage.completionTokens,
          totalTokens: totalUsage.totalTokens,
          cacheHitTokens: usage ? getCacheHitTokens(usage) : undefined,
          cacheMissTokens: usage ? getCacheMissTokens(usage) : undefined,
          toolCalls: toolCallRecords.map((step) => ({ toolName: step.toolName })),
          source,
          intent: intentResult.intent,
          userId,
        },
        persistData: {
          userId: userId || null,
          modelId,
          inputTokens: totalUsage.promptTokens,
          outputTokens: totalUsage.completionTokens,
          latencyMs: duration,
          processorLog: processorLogs,
          p0MatchKeyword: matchedKeywordId,
          input: rawUserInput,
          output: aiResponseText,
        },
      },
    };

    if (userId) {
      const { logs: postLLMLogs } = await runPostLLMProcessors(
        [{ processor: outputGuardProcessor }],
        postLLMContext
      );
      processorLogs.push(...postLLMLogs);

      runAsyncProcessors(
        [{ processor: extractPreferencesProcessor }],
        postLLMContext
      ).then(({ logs: asyncLogs }) => {
        processorLogs.push(...asyncLogs);
      }).catch((err: Error) => {
        logger.warn('Async processors failed', { error: err.message });
      });
    }

    runAsyncProcessors(
      [
        { processor: recordMetricsProcessor },
        { processor: persistRequestProcessor },
      ],
      postLLMContext
    ).then(({ logs: asyncLogs }) => {
      processorLogs.push(...asyncLogs);
    }).catch((err: Error) => {
      logger.warn('Post-finish async processors failed', { error: err.message });
    });

    return {
      assistantText: aiResponseText,
      executionPath: 'llm_orchestrated',
      toolCallRecords,
      blockPayloads: [],
      actionResults: [],
      traces: [
        createExecutionTrace('chat_execution_completed', {
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          toolCallCount: toolCallRecords.length,
          modelId,
          totalTokens: totalUsage.totalTokens,
          durationMs: duration,
        }),
      ],
    };
  });
}

// ==========================================
// 辅助函数
// ==========================================

/**
 * 小聚人设 System Prompt
 * 用于轻量 LLM 生成有温度的回复
 */
const XIAOJU_PERSONA = `你是"小聚"，一个热情、接地气、有活力的组局达人。你是用户的社交助理，像朋友一样帮忙组局、找搭子、探索活动。

说话风格：
- 像朋友一样自然，不要太正式
- 用表情符号增加温度 😊🎉🔥
- 不要说"已为您构建"，要说"帮你把局组好了！"
- 不要说"正在解析"，要说"收到，小聚正在帮你整理..."
- 用户是喜欢组局、参加活动的人，你要表现出对社交活动的热情
- 称呼用户为"朋友"或直接对话，不要叫"用户"

记住：你是"组局助手"小聚，有血有肉有灵魂，不是冷冰冰的系统。`;

/**
 * 轻量 LLM 生成有灵魂的回复
 * 默认跟随当前主聊天链路的 Kimi 路由
 */
async function generateSoulfulResponse(
  userInput: string,
  context: {
    keyword: string;
    intent: string;
    responseHint: string;
  }
): Promise<string> {
  const startTime = Date.now();
  try {
    const { model, modelId } = await resolveChatModelSelection({ routeKey: 'chat' });

    const prompt = `用户说："${userInput}"

触发了热词"${context.keyword}"，意图是${context.intent}。
参考信息：${context.responseHint}

请用一句话热情回应用户，体现小聚的组局达人性格。要求：
1. 自然、有温度、像朋友一样
2. 可以带表情符号
3. 不要机械复述参考信息，要转化成自己的话
4. 如果是活动相关，表现出热情
5. 直接输出回应文字，不要解释

回应：`;

    const result = await generateText({
      model,
      system: XIAOJU_PERSONA,
      prompt,
      ...(shouldOmitTemperatureForModelId(modelId) ? {} : { temperature: 0.8 }),
      maxOutputTokens: 150,
    });

    const latency = Date.now() - startTime;
    logger.info('p0_soulful_response_generated', {
      keyword: context.keyword,
      intent: context.intent,
      model: modelId,
      latencyMs: latency,
      responseLength: result.text.trim().length,
    });
    return result.text.trim() || context.responseHint;
  } catch (error) {
    // 降级到默认提示
    logger.error('p0_soulful_response_failed', { error: String(error), keyword: context.keyword });
    return context.responseHint;
  }
}

// ==========================================
// 辅助函数
// ==========================================

type DirectResponseScenario =
  | { type: 'rate_limit'; retryAfter?: number }
  | { type: 'blocked'; reason?: string }
  | { type: 'error'; error?: string }
  | { type: 'fallback'; context?: string };

/** 限流场景预设文案 - 随机选择增加多样性 */
const RATE_LIMIT_RESPONSES = [
  '哎呀，小聚有点忙不过来了，你稍等 1 分钟再来呗 😅',
  '哇，你今天好活跃！让我喘口气，等会儿继续帮你组局～',
  '小聚正在处理其他朋友的请求，1 分钟后回来找你！',
  '等等我等等我！小聚马上就好，你稍等片刻 ⏳',
];

/** 拦截场景预设文案 */
const BLOCKED_RESPONSES = [
  '这个话题我帮不了你 😅 我们聊点别的？比如最近有什么好玩的活动～',
  '哎呀，这个我不太方便聊，换个话题呗？你最近想组什么局？',
  '小聚是个组局助手，这方面不太懂 😅 聊聊活动怎么样？',
];

/**
 * 小聚快速回复生成器
 * 为各种边缘场景生成有灵魂的兜底回复
 */
async function xiaoJuQuickReply(scenario: DirectResponseScenario): Promise<string> {
  // 限流和拦截场景：直接返回预设文案，不调用 LLM（减少延迟和成本）
  if (scenario.type === 'rate_limit') {
    const index = Math.floor(Math.random() * RATE_LIMIT_RESPONSES.length);
    logger.info('edge_response_preset', { scenario: 'rate_limit', source: 'preset' });
    return RATE_LIMIT_RESPONSES[index];
  }

  if (scenario.type === 'blocked') {
    const index = Math.floor(Math.random() * BLOCKED_RESPONSES.length);
    logger.info('edge_response_preset', { scenario: 'blocked', source: 'preset' });
    return BLOCKED_RESPONSES[index];
  }

  // error 和 fallback 场景：走 LLM 生成更个性化的回复
  const startTime = Date.now();
  try {
    const { model, modelId } = await resolveChatModelSelection({ routeKey: 'chat' });

    let prompt = '';
    switch (scenario.type) {
      case 'error':
        prompt = `系统出错了${scenario.error ? `：${scenario.error}` : ''}。
用轻松、幽默的方式道歉，告诉用户再试试，不要显得太技术化。`;
        break;
      case 'fallback':
        prompt = `没理解用户的意思${scenario.context ? `（上下文：${scenario.context}）` : ''}。
用友好、轻松的方式请用户换个说法，表现出愿意继续帮忙的态度。`;
        break;
    }

    const result = await generateText({
      model,
      system: XIAOJU_PERSONA,
      prompt,
      ...(shouldOmitTemperatureForModelId(modelId) ? {} : { temperature: 0.7 }),
      maxOutputTokens: 100,
    });

    const latency = Date.now() - startTime;
    logger.info('edge_response_generated', {
      scenario: scenario.type,
      model: modelId,
      latencyMs: latency,
      responseLength: result.text.trim().length,
    });
    return result.text.trim() || getFallbackText(scenario);
  } catch (error) {
    logger.error('edge_response_failed', { scenario: scenario.type, error: String(error) });
    return getFallbackText(scenario);
  }
}

/**
 * 获取兜底文本（LLM 失败时使用）
 */
function getFallbackText(scenario: DirectResponseScenario): string {
  switch (scenario.type) {
    case 'rate_limit':
      return '哎呀，小聚有点忙不过来了，你稍等 1 分钟再来呗 😅';
    case 'blocked':
      return '这个话题我帮不了你 😅';
    case 'error':
      return '我这会儿有点卡住了，你换个说法再试试，我继续帮你接。';
    case 'fallback':
      return '我没太明白，换个说法呗？';
    default:
      return '小聚还在学习中，再试一次？';
  }
}

function createExecutionTrace(stage: string, detail: Record<string, unknown>): GenUITracePayload {
  return { stage, detail };
}

async function buildDirectResponseResult(
  scenario: DirectResponseScenario
): Promise<ChatExecutionResult> {
  const text = await xiaoJuQuickReply(scenario);
  return {
    assistantText: text,
    executionPath: 'llm_orchestrated',
    toolCallRecords: [],
    blockPayloads: [],
    actionResults: [],
    traces: [
      createExecutionTrace('direct_response', {
        scenario: scenario.type,
      }),
    ],
  };
}

function buildStructuredActionResult(
  result: import('./user-action').StructuredActionResult,
  structuredAction?: StructuredAction
): ChatExecutionResult {
  const data = asRecord(result.data);
  const pendingAction = asRecord(data?.pendingAction);
  const explorePayload = (() => {
    if (Array.isArray(data?.explore)) {
      return {
        results: data.explore,
        title: '帮你找到这些局，点一个就能继续',
      };
    }

    const explore = asRecord(data?.explore);
    const fetchConfig = asRecord(data?.fetchConfig);
    const interaction = asRecord(data?.interaction);
    const preview = asRecord(data?.preview);
    if (!explore) {
      return null;
    }

    return {
      ...explore,
      ...(fetchConfig ? { fetchConfig } : {}),
      ...(interaction ? { interaction } : {}),
      ...(preview ? { preview } : {}),
    };
  })();

  const actionType = structuredAction?.action;
  const actionMessage = (
    typeof data?.message === 'string' && data.message.trim()
      ? data.message.trim()
      : data?.action === 'navigate'
        ? '已为你打开详情入口'
        : data?.action === 'share'
          ? '准备分享给朋友吧～'
          : data?.action === 'publish'
            ? '草稿已准备好，确认后就能发出去'
            : result.success
              ? '操作成功！'
              : typeof result.error === 'string' && result.error.trim()
                ? result.error.trim()
                : '操作失败，请稍后再试'
  );
  const authRequiredPayload = data?.requiresAuth === true && pendingAction
    ? {
        message: actionMessage,
        authRequired: {
          mode: data?.requiresPhoneBinding === true ? 'bind_phone' : 'login',
          pendingAction,
        },
      }
    : null;
  const successWidgetPayload = result.success && actionMessage && (
    typeof data?.navigationIntent === 'string' ||
    isRecord(data?.navigationPayload) ||
    (data?.draft && typeof data.draft === 'object')
  )
    ? {
        message: actionMessage,
        ...(typeof data?.navigationIntent === 'string' ? { navigationIntent: data.navigationIntent } : {}),
        ...(isRecord(data?.navigationPayload) ? { navigationPayload: data.navigationPayload } : {}),
      }
    : null;
  const errorWidgetPayload = !result.success && !authRequiredPayload
    ? {
        message: actionMessage,
      }
    : null;
  const shouldWritePrimaryText = !authRequiredPayload && !successWidgetPayload;
  const nextActions = buildNextBestActions({ actionType, data });
  const assistantReplyText = buildStructuredActionReplyText({
    actionType,
    data,
    defaultMessage: actionMessage,
    nextActions,
    originalText: structuredAction?.originalText,
  });
  const structuredIntent = inferIntentFromStructuredAction(actionType);
  const activityId = typeof data?.activityId === 'string' ? data.activityId : null;

  const blockPayloads: ChatBlockPayload[] = [];
  if (explorePayload && shouldEmitExploreWidgetPayload(explorePayload)) {
    blockPayloads.push({ widgetType: 'widget_explore', payload: explorePayload });
  }
  if (data?.askPreference && typeof data.askPreference === 'object') {
    blockPayloads.push({ widgetType: 'widget_ask_preference', payload: data.askPreference });
  }
  if (data?.partnerIntentForm && typeof data.partnerIntentForm === 'object') {
    blockPayloads.push({ widgetType: 'widget_partner_intent_form', payload: data.partnerIntentForm });
  }
  if (data?.partnerSearchResults && typeof data.partnerSearchResults === 'object') {
    blockPayloads.push({ widgetType: 'widget_partner_search_results', payload: data.partnerSearchResults });
  }
  if (data?.draftSettingsForm && typeof data.draftSettingsForm === 'object') {
    blockPayloads.push({ widgetType: 'widget_draft_settings_form', payload: data.draftSettingsForm });
  }
  if (data?.draft && typeof data.draft === 'object') {
    blockPayloads.push({
      widgetType: 'widget_draft',
      payload: {
        ...(typeof data.activityId === 'string' ? { activityId: data.activityId } : {}),
        ...data.draft,
      },
    });
  }
  if (data?.publishedActivity && typeof data.publishedActivity === 'object') {
    blockPayloads.push({ widgetType: 'widget_share', payload: data.publishedActivity });
  }
  if (authRequiredPayload) {
    blockPayloads.push({ widgetType: 'widget_auth_required', payload: authRequiredPayload });
  }
  if (errorWidgetPayload) {
    blockPayloads.push({ widgetType: 'widget_error', payload: errorWidgetPayload });
  }
  if (successWidgetPayload) {
    blockPayloads.push({ widgetType: 'widget_success', payload: successWidgetPayload });
  }

  return {
    assistantText: shouldWritePrimaryText ? assistantReplyText : '',
    executionPath: 'structured_action',
    toolCallRecords: [],
    blockPayloads,
    actionResults: [{
      success: result.success,
      ...(typeof result.error === 'string' ? { error: result.error } : {}),
      ...(nextActions.length > 0 ? { nextActions } : {}),
    }],
    traces: [
      createExecutionTrace('structured_action', {
        action: actionType,
        intent: structuredIntent,
        success: result.success,
        ...(activityId ? { activityId } : {}),
      }),
    ],
  };
}

async function handlePartnerMatchingFlowResult(
  request: ChatRequest,
  existingState: PartnerMatchingState | null,
  threadId: string,
  userMessage: string
): Promise<ChatExecutionResult> {
  const { userId } = request;

  let state = existingState || createPartnerMatchingState(userMessage);

  if (existingState) {
    const currentQuestion = getNextQuestion(existingState);
    const answer = parseUserAnswer(userMessage, currentQuestion);

    if (answer) {
      state = updatePartnerMatchingState(state, answer);
      const messageHints = inferPartnerMessageHints(userMessage);
      if (messageHints.location || (messageHints.tags && messageHints.tags.length > 0)) {
        state = {
          ...state,
          collectedPreferences: {
            ...state.collectedPreferences,
            ...(messageHints.location && !state.collectedPreferences.location
              ? { location: messageHints.location }
              : {}),
            ...(messageHints.tags && messageHints.tags.length > 0
              ? { tags: Array.from(new Set([...(state.collectedPreferences.tags || []), ...messageHints.tags])) }
              : {}),
          },
        };
      }
    }
  }

  const nextQuestion = getNextQuestion(state);

  if (!nextQuestion) {
    const completedState: PartnerMatchingState = {
      ...state,
      status: 'completed',
      updatedAt: new Date(),
    };

    if (userId) {
      await persistPartnerMatchingState(threadId, userId, completedState);
    }

    const payload = buildPartnerSearchPayloadFromState(completedState);
    const actionResult = await handleStructuredAction(
      {
        action: 'search_partners',
        payload,
        source: 'partner_matching_workflow',
        originalText: completedState.rawInput,
      },
      userId,
    );
    return buildStructuredActionResult(actionResult, {
      action: 'search_partners',
      payload,
      source: 'partner_matching_workflow',
      originalText: completedState.rawInput,
    });
  }

  if (userId) {
    await persistPartnerMatchingState(threadId, userId, state);
  }

  const introText = buildPartnerWorkflowIntroText(state);
  const askPreferencePayload = buildPartnerAskPreferencePayload(state);

  return {
    assistantText: introText,
    executionPath: 'structured_action',
    toolCallRecords: [],
    blockPayloads: askPreferencePayload
      ? [{ widgetType: 'widget_ask_preference', payload: askPreferencePayload }]
      : [],
    actionResults: [],
    traces: [
      createExecutionTrace('partner_matching', {
        status: 'collecting',
        hasNextQuestion: Boolean(nextQuestion),
      }),
    ],
  };
}

// ==========================================
// 会话管理 API
// ==========================================

export async function listConversations(params: {
  userId?: string;
  page?: number;
  limit?: number;
  // v4.6: 评估筛选
  evaluationStatus?: 'unreviewed' | 'good' | 'bad';
  hasError?: boolean;
}) {
  const { userId, page = 1, limit = 20, evaluationStatus, hasError } = params;
  const offset = (page - 1) * limit;

  // 构建 where 条件
  const conditions = [];
  if (userId) conditions.push(eq(conversations.userId, userId));
  if (evaluationStatus) conditions.push(eq(conversations.evaluationStatus, evaluationStatus));
  if (hasError !== undefined) conditions.push(eq(conversations.hasError, hasError));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: conversations.id,
        userId: conversations.userId,
        title: conversations.title,
        messageCount: conversations.messageCount,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        // v4.6: 评估字段
        evaluationStatus: conversations.evaluationStatus,
        evaluationTags: conversations.evaluationTags,
        evaluationNote: conversations.evaluationNote,
        hasError: conversations.hasError,
      })
      .from(conversations)
      .where(whereClause)
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(conversations)
      .where(whereClause),
  ]);

  // 获取用户昵称
  const userIds = [...new Set(items.map(i => i.userId))];
  const userNicknames = userIds.length > 0
    ? await db.select({ id: users.id, nickname: users.nickname }).from(users).where(inArray(users.id, userIds))
    : [];
  const nicknameMap = new Map(userNicknames.map(u => [u.id, u.nickname]));

  return {
    items: items.map(i => ({
      ...i,
      userNickname: nicknameMap.get(i.userId) || null,
      lastMessageAt: i.lastMessageAt?.toISOString() || new Date().toISOString(),
      createdAt: i.createdAt.toISOString(),
      // v4.6: 评估字段
      evaluationStatus: i.evaluationStatus,
      evaluationTags: i.evaluationTags || [],
      evaluationNote: i.evaluationNote,
      hasError: i.hasError,
    })),
    total: Number(countResult[0]?.count || 0),
  };
}

async function hydrateConversationListItems(
  rows: Array<{
    id: string;
    userId: string;
    title: string | null;
    messageCount: number;
    lastMessageAt: Date | null;
    createdAt: Date;
    evaluationStatus: typeof conversations.$inferSelect.evaluationStatus;
    evaluationTags: string[] | null;
    evaluationNote: string | null;
    hasError: boolean;
  }>
): Promise<HydratedConversationListItem[]> {
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const userNicknames = userIds.length > 0
    ? await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users)
      .where(inArray(users.id, userIds))
    : [];
  const nicknameMap = new Map(userNicknames.map((user) => [user.id, user.nickname]));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    title: row.title,
    messageCount: row.messageCount,
    lastMessageAt: row.lastMessageAt?.toISOString() || row.createdAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    userNickname: nicknameMap.get(row.userId) || null,
    evaluationStatus: row.evaluationStatus,
    evaluationTags: row.evaluationTags || [],
    evaluationNote: row.evaluationNote,
    hasError: row.hasError,
  }));
}

export async function listUserConversations(params: {
  userId: string;
  cursor?: string;
  limit?: number;
}) {
  const { userId, cursor, limit = 20 } = params;
  const conditions = [eq(conversations.userId, userId)];

  if (cursor) {
    const [cursorConversation] = await db
      .select({
        id: conversations.id,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(and(
        eq(conversations.id, cursor),
        eq(conversations.userId, userId),
      ))
      .limit(1);

    if (cursorConversation) {
      const cursorTimestamp = cursorConversation.lastMessageAt || cursorConversation.createdAt;
      const cursorCondition = or(
        lt(conversations.lastMessageAt, cursorTimestamp),
        and(
          eq(conversations.lastMessageAt, cursorTimestamp),
          lt(conversations.id, cursorConversation.id),
        ),
      );

      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }
  }

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: conversations.id,
        userId: conversations.userId,
        title: conversations.title,
        messageCount: conversations.messageCount,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        evaluationStatus: conversations.evaluationStatus,
        evaluationTags: conversations.evaluationTags,
        evaluationNote: conversations.evaluationNote,
        hasError: conversations.hasError,
      })
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(limit + 1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(eq(conversations.userId, userId)),
  ]);

  const hasMore = rows.length > limit;
  const visibleRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: await hydrateConversationListItems(visibleRows),
    total: totalResult[0]?.count || 0,
    hasMore,
    cursor: hasMore ? visibleRows[visibleRows.length - 1]?.id || null : null,
  };
}

async function hydrateConversationMessages(
  rows: Array<{
    id: string;
    userId: string;
    role: ConversationMessageRecord['role'];
    messageType: ConversationMessageRecord['messageType'];
    content: ConversationMessageRecord['content'];
    activityId: string | null;
    createdAt: Date;
  }>
): Promise<HydratedConversationMessage[]> {
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const userNicknames = userIds.length > 0
    ? await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users)
      .where(inArray(users.id, userIds))
    : [];
  const nicknameMap = new Map(userNicknames.map((user) => [user.id, user.nickname]));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userNickname: nicknameMap.get(row.userId) || null,
    role: row.role,
    type: row.messageType,
    content: row.content,
    activityId: row.activityId,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listConversationMessages(params: {
  userId: string;
  conversationId: string;
  cursor?: string;
  limit?: number;
  role?: 'user' | 'assistant';
  messageType?: ConversationMessageRecord['messageType'];
}) {
  const {
    userId,
    conversationId,
    cursor,
    limit = 20,
    role,
    messageType,
  } = params;

  if (!isUuidLike(conversationId)) {
    throw new Error('会话不存在');
  }

  const [thread] = await db
    .select({ id: conversations.id, userId: conversations.userId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!thread) {
    throw new Error('会话不存在');
  }

  if (thread.userId !== userId) {
    throw new Error('会话与用户不匹配');
  }

  const baseConditions: Array<ReturnType<typeof eq>> = [
    eq(conversationMessages.conversationId, conversationId),
  ];
  if (role) {
    baseConditions.push(eq(conversationMessages.role, role));
  }
  if (messageType) {
    baseConditions.push(eq(conversationMessages.messageType, messageType));
  }

  const messageConditions = [...baseConditions];
  if (cursor) {
    const [cursorMessage] = await db
      .select({ createdAt: conversationMessages.createdAt })
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.id, cursor),
        eq(conversationMessages.conversationId, conversationId),
      ))
      .limit(1);

    if (cursorMessage) {
      messageConditions.push(lt(conversationMessages.createdAt, cursorMessage.createdAt));
    }
  }

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: conversationMessages.id,
        userId: conversationMessages.userId,
        role: conversationMessages.role,
        messageType: conversationMessages.messageType,
        content: conversationMessages.content,
        activityId: conversationMessages.activityId,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .where(and(...messageConditions))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(limit + 1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversationMessages)
      .where(and(...baseConditions)),
  ]);

  const hasMore = rows.length > limit;
  const visibleRows = hasMore ? rows.slice(0, limit) : rows;
  const items = await hydrateConversationMessages(visibleRows);

  return {
    conversationId,
    items,
    total: totalResult[0]?.count || 0,
    hasMore,
    cursor: hasMore ? visibleRows[visibleRows.length - 1]?.id || null : null,
  };
}

export async function getConversationMessages(conversationId: string) {
  if (!isUuidLike(conversationId)) {
    return { conversation: null, messages: [] };
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) return { conversation: null, messages: [] };

  const [user] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, conv.userId)).limit(1);

  const msgs = await db
    .select()
    .from(conversationMessages)
    .where(
      sql`${conversationMessages.conversationId} = ${conversationId}
        AND (${conversationMessages.expiresAt} IS NULL OR ${conversationMessages.expiresAt} > NOW())`
    )
    .orderBy(conversationMessages.createdAt);

  return {
    conversation: {
      id: conv.id,
      userId: conv.userId,
      userNickname: user?.nickname || null,
      title: conv.title,
      messageCount: conv.messageCount,
      lastMessageAt: conv.lastMessageAt?.toISOString() || new Date().toISOString(),
      createdAt: conv.createdAt.toISOString(),
      // v4.6: 评估字段
      evaluationStatus: conv.evaluationStatus,
      evaluationTags: conv.evaluationTags || [],
      evaluationNote: conv.evaluationNote,
      hasError: conv.hasError,
    },
    messages: msgs.map(m => ({
      id: m.id,
      role: m.role,
      messageType: m.messageType,
      content: m.content,
      activityId: m.activityId,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

function summarizeAssistantBlocks(blocks: GenUIBlock[]): string {
  const textSegments = blocks
    .filter((block): block is Extract<GenUIBlock, { type: 'text' }> =>
      block.type === 'text' && typeof block.content === 'string' && block.content.trim().length > 0
    )
    .map((block) => block.content.trim());

  if (textSegments.length > 0) {
    return textSegments.join('\n\n');
  }

  for (const block of blocks) {
    if (block.type === 'alert' && block.message.trim()) {
      return block.message.trim();
    }

    if (block.type === 'choice' && block.question.trim()) {
      return block.question.trim();
    }

    if (block.type === 'list') {
      const title = typeof block.title === 'string' && block.title.trim()
        ? block.title.trim()
        : '';
      if (title) {
        return title;
      }

      const firstItem = block.items.find((item) => isRecord(item) && typeof item.title === 'string' && item.title.trim());
      if (firstItem && typeof firstItem.title === 'string') {
        return firstItem.title.trim();
      }

      return '附近活动';
    }

    if (block.type === 'entity-card' && block.title.trim()) {
      return block.title.trim();
    }

    if (block.type === 'form') {
      if (typeof block.title === 'string' && block.title.trim()) {
        return block.title.trim();
      }

      return '请先补充一下信息';
    }

    if (block.type === 'cta-group') {
      return '可继续操作';
    }
  }

  return '';
}

function resolveAssistantMessageTypeFromBlocks(
  blocks: GenUIBlock[]
): ConversationMessageRecord['messageType'] {
  for (const block of blocks) {
    if (block.type === 'choice') {
      return 'widget_ask_preference';
    }

    if (block.type === 'list') {
      return 'widget_explore';
    }

    if (block.type === 'entity-card') {
      return 'widget_draft';
    }

    if (block.type === 'cta-group' || block.type === 'form') {
      return 'widget_action';
    }

    if (block.type === 'alert' && block.level === 'error') {
      return 'widget_error';
    }
  }

  return 'text';
}

function extractActivityIdFromBlocks(blocks: GenUIBlock[]): string | undefined {
  for (const block of blocks) {
    if (block.type === 'entity-card' && isRecord(block.fields) && typeof block.fields.activityId === 'string') {
      return block.fields.activityId;
    }

    if (block.type === 'cta-group') {
      for (const item of block.items) {
        if (isRecord(item.params) && typeof item.params.activityId === 'string') {
          return item.params.activityId;
        }
      }
    }

    if (block.type === 'form' && isRecord(block.initialValues) && typeof block.initialValues.activityId === 'string') {
      return block.initialValues.activityId;
    }
  }

  return undefined;
}

function hasAssistantErrorBlock(blocks: GenUIBlock[]): boolean {
  return blocks.some((block) => block.type === 'alert' && block.level === 'error');
}

function resolvePrimaryBlockType(blocks: GenUIBlock[]): GenUIBlock['type'] | null {
  const primaryBlock = blocks.find((block) => block.type !== 'text') ?? blocks[0];
  return primaryBlock?.type ?? null;
}

function buildAssistantConversationSnapshot(
  blocks: GenUIBlock[],
  params?: { responseId?: string; traceId?: string }
): {
  messageType: ConversationMessageRecord['messageType'];
  content: Record<string, unknown>;
} | null {
  if (blocks.length === 0) {
    return null;
  }

  const text = summarizeAssistantBlocks(blocks);
  const suggestions = buildSuggestionsFromBlocks(blocks);

  return {
    messageType: resolveAssistantMessageTypeFromBlocks(blocks),
    content: {
      ...(text ? { text } : {}),
      primaryBlockType: resolvePrimaryBlockType(blocks),
      ...(suggestions ? { suggestions } : {}),
      blocks,
      response: {
        ...(params?.responseId ? { responseId: params.responseId } : {}),
        ...(params?.traceId ? { traceId: params.traceId } : {}),
        status: 'completed',
        primaryBlockType: resolvePrimaryBlockType(blocks),
        ...(suggestions ? { suggestions } : {}),
        blocks,
      },
    },
  };
}

function extractStoredConversationText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!isRecord(content)) {
    return '';
  }

  if (typeof content.text === 'string' && content.text.trim()) {
    return content.text.trim();
  }

  if (typeof content.message === 'string' && content.message.trim()) {
    return content.message.trim();
  }

  return '';
}

export async function syncConversationResponseSnapshot(params: {
  conversationId: string;
  userId: string;
  userText?: string;
  blocks: GenUIBlock[];
  responseId?: string;
  traceId?: string;
  inputType?: 'text' | 'action';
  resolvedStructuredAction?: StructuredAction;
  activityId?: string;
}) {
  const assistantRecord = buildAssistantConversationSnapshot(params.blocks, {
    responseId: params.responseId,
    traceId: params.traceId,
  });
  if (!assistantRecord) {
    return;
  }

  const normalizedUserText = params.userText?.trim() || '';
  const shouldPersistStructuredActionInput = params.inputType === 'action' && !!params.resolvedStructuredAction;
  const userRecord = normalizedUserText
    ? {
        messageType: shouldPersistStructuredActionInput ? 'user_action' as const : 'text' as const,
        kind: shouldPersistStructuredActionInput ? 'action' as const : 'text' as const,
        text: normalizedUserText,
        payload: shouldPersistStructuredActionInput
          ? {
              action: params.resolvedStructuredAction?.action,
              payload: params.resolvedStructuredAction?.payload,
              source: params.resolvedStructuredAction?.source || 'structured_action',
            }
          : undefined,
        content: shouldPersistStructuredActionInput
          ? {
              text: normalizedUserText,
              action: params.resolvedStructuredAction?.action,
              payload: params.resolvedStructuredAction?.payload,
              source: params.resolvedStructuredAction?.source || 'structured_action',
            }
          : { text: normalizedUserText },
      }
    : null;
  const resolvedActivityId = params.activityId || extractActivityIdFromBlocks(params.blocks);
  const resolvedTaskId = await resolveConversationTaskId({
    userId: params.userId,
    conversationId: params.conversationId,
    ...(resolvedActivityId ? { activityId: resolvedActivityId } : {}),
  });
  const hasError = hasAssistantErrorBlock(params.blocks);

  const recentMessages = await db
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      content: conversationMessages.content,
    })
    .from(conversationMessages)
    .where(
      sql`${conversationMessages.conversationId} = ${params.conversationId}
        AND (${conversationMessages.expiresAt} IS NULL OR ${conversationMessages.expiresAt} > NOW())`
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(4);

  const existingAssistantResponse = params.responseId
    ? recentMessages.find((message) => {
      if (message.role !== 'assistant' || !isRecord(message.content)) {
        return false;
      }

      const turn = isRecord(message.content.response) ? message.content.response : null;
      return turn?.responseId === params.responseId;
    })
    : undefined;

  if (existingAssistantResponse) {
    const previousAssistantText = extractStoredConversationText(existingAssistantResponse.content);
    const nextAssistantText = extractStoredConversationText(assistantRecord.content);
    const shouldRefreshEmbedding = nextAssistantText.length > 0 && nextAssistantText !== previousAssistantText;

    await db
      .update(conversationMessages)
      .set({
        messageType: assistantRecord.messageType,
        kind: hasError ? 'error' : 'response',
        text: nextAssistantText || null,
        payload: {
          ...(isRecord(assistantRecord.content.response) ? { response: assistantRecord.content.response } : {}),
          ...(assistantRecord.content.primaryBlockType ? { primaryBlockType: assistantRecord.content.primaryBlockType } : {}),
          ...(assistantRecord.content.suggestions ? { suggestions: assistantRecord.content.suggestions } : {}),
        },
        content: assistantRecord.content,
        activityId: resolvedActivityId ?? null,
        taskId: resolvedTaskId ?? null,
        expiresAt: getConversationMessageExpiresAt(),
      })
      .where(eq(conversationMessages.id, existingAssistantResponse.id));

    if (shouldRefreshEmbedding) {
      refreshMessageEmbedding(existingAssistantResponse.id, nextAssistantText);
    }

    if (hasError) {
      await db
        .update(conversations)
        .set({ hasError: true })
        .where(eq(conversations.id, params.conversationId));
    }
    return;
  }

  const latestMessage = recentMessages[0];
  const shouldInsertUser = Boolean(
    userRecord
      && !(
        latestMessage?.role === 'user'
        && extractStoredConversationText(latestMessage.content) === normalizedUserText
      )
  );

  if (shouldInsertUser && userRecord) {
    await saveMessage({
      conversationId: params.conversationId,
      userId: params.userId,
      role: 'user',
      messageType: userRecord.messageType,
      kind: userRecord.kind,
      text: userRecord.text,
      ...(userRecord.payload ? { payload: userRecord.payload } : {}),
      content: userRecord.content,
      ...(resolvedTaskId ? { taskId: resolvedTaskId } : {}),
    });
  }

  const assistantMessage = await saveMessage({
    conversationId: params.conversationId,
    userId: params.userId,
    role: 'assistant',
    messageType: assistantRecord.messageType,
    kind: hasError ? 'error' : 'response',
    text: extractStoredConversationText(assistantRecord.content),
    payload: {
      ...(isRecord(assistantRecord.content.response) ? { response: assistantRecord.content.response } : {}),
      ...(assistantRecord.content.primaryBlockType ? { primaryBlockType: assistantRecord.content.primaryBlockType } : {}),
      ...(assistantRecord.content.suggestions ? { suggestions: assistantRecord.content.suggestions } : {}),
    },
    content: assistantRecord.content,
    ...(resolvedActivityId ? { activityId: resolvedActivityId } : {}),
    ...(resolvedTaskId ? { taskId: resolvedTaskId } : {}),
  });

  if (hasError) {
    await db
      .update(conversations)
      .set({ hasError: true })
      .where(eq(conversations.id, params.conversationId));
  }
}

// ==========================================
// v4.6: 会话评估 (Admin Command Center)
// ==========================================

export async function evaluateConversation(params: {
  conversationId: string;
  status: 'good' | 'bad';
  tags?: string[];
  note?: string;
}) {
  const { conversationId, status, tags = [], note } = params;

  const [updated] = await db
    .update(conversations)
    .set({
      evaluationStatus: status,
      evaluationTags: tags,
      evaluationNote: note || null,
    })
    .where(eq(conversations.id, conversationId))
    .returning();

  if (!updated) return null;
  // 获取用户昵称
  const [user] = await db
    .select({ nickname: users.nickname })
    .from(users)
    .where(eq(users.id, updated.userId))
    .limit(1);

  return {
    id: updated.id,
    userId: updated.userId,
    userNickname: user?.nickname || null,
    title: updated.title,
    messageCount: updated.messageCount,
    lastMessageAt: updated.lastMessageAt?.toISOString() || new Date().toISOString(),
    createdAt: updated.createdAt.toISOString(),
    evaluationStatus: updated.evaluationStatus,
    evaluationTags: updated.evaluationTags || [],
    evaluationNote: updated.evaluationNote,
    hasError: updated.hasError,
  };
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  return deleteThread(conversationId);
}

export async function deleteConversationsBatch(ids: string[]): Promise<{ deletedCount: number }> {
  if (ids.length === 0) return { deletedCount: 0 };

  const result = await db
    .delete(conversations)
    .where(inArray(conversations.id, ids))
    .returning({ id: conversations.id });

  return { deletedCount: result.length };
}

export async function clearConversations(userId: string): Promise<{ deletedCount: number }> {
  return clearUserThreads(userId);
}

export async function getActivityConversationMessages(activityId: string) {
  const rows = await db
    .select({
      id: conversationMessages.id,
      userId: conversationMessages.userId,
      role: conversationMessages.role,
      messageType: conversationMessages.messageType,
      content: conversationMessages.content,
      activityId: conversationMessages.activityId,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.activityId, activityId))
    .orderBy(conversationMessages.createdAt);

  return {
    activityId,
    items: await hydrateConversationMessages(rows),
    total: rows.length,
  };
}

// ==========================================
// Welcome Card
// ==========================================

export interface WelcomeSection {
  id: string;
  title: string;
  icon?: string;
  items: Array<{
    type: 'draft' | 'suggestion' | 'explore';
    label: string;
    prompt: string;
    icon?: string;
    context?: unknown;
  }>;
}

// 社交档案 (v4.4 新增)
export interface SocialProfile {
  joinedActivities: number;
  hostedActivities: number;
  preferenceCompleteness: number;
}

export interface WelcomePendingActivity {
  id: string;
  title: string;
  type: string;
  startAt: string;
  locationName: string;
  locationHint: string;
  currentParticipants: number;
  maxParticipants: number;
  status: string;
}

// 快捷入口 (v4.4 新增)
export interface QuickPrompt {
  icon: string;
  text: string;
  prompt: string;
  action?: string;
  params?: Record<string, unknown>;
}

export type WelcomeFocusType = 'post_activity_feedback' | 'recruiting_result' | 'unfinished_intent';

export interface WelcomeFocus {
  type: WelcomeFocusType;
  label: string;
  prompt: string;
  priority: number;
  context?: unknown;
}

export interface WelcomeResponse {
  greeting: string;
  subGreeting?: string;
  sections: WelcomeSection[];
  socialProfile?: SocialProfile | undefined;
  pendingActivities?: WelcomePendingActivity[] | undefined;
  welcomeFocus?: WelcomeFocus | undefined;
  quickPrompts: QuickPrompt[];
  ui?: {
    composerPlaceholder: string;
    bottomQuickActions: string[];
    profileHints: {
      low: string;
      medium: string;
      high: string;
    };
  };
}

async function getUserActivityStats(userId: string): Promise<{
  joinedActivities: number;
  hostedActivities: number;
}> {
  const [createdResult, joinedResult] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(activities)
      .where(eq(activities.creatorId, userId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(participants)
      .where(and(eq(participants.userId, userId), eq(participants.status, 'joined'))),
  ]);

  return {
    joinedActivities: joinedResult[0]?.count ?? 0,
    hostedActivities: createdResult[0]?.count ?? 0,
  };
}

type WelcomeGreetingPeriod =
  | 'lateNight'
  | 'morning'
  | 'forenoon'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'night';

interface WelcomeCopyConfig {
  fallbackNickname: string;
  subGreeting: string;
  greetingTemplates: Record<WelcomeGreetingPeriod, string>;
}

interface WelcomeUiConfig {
  composerPlaceholder: string;
  sectionTitles: {
    suggestions: string;
    explore: string;
  };
  exploreTemplates: {
    label: string;
    prompt: string;
  };
  suggestionItems: Array<{
    label: string;
    prompt: string;
    icon?: string;
  }>;
  quickPrompts: QuickPrompt[];
  bottomQuickActions: string[];
  profileHints: {
    low: string;
    medium: string;
    high: string;
  };
}

const DEFAULT_WELCOME_COPY_CONFIG: WelcomeCopyConfig = {
  fallbackNickname: '朋友',
  subGreeting: '今天想约什么局？',
  greetingTemplates: {
    lateNight: '夜深了，{nickname}～',
    morning: '早上好，{nickname}！',
    forenoon: '上午好，{nickname}！',
    noon: '中午好，{nickname}！',
    afternoon: '下午好，{nickname}！',
    evening: '晚上好，{nickname}！',
    night: '夜深了，{nickname}～',
  },
};

const DEFAULT_WELCOME_UI_CONFIG: WelcomeUiConfig = {
  composerPlaceholder: '你想找什么活动？',
  sectionTitles: {
    suggestions: '快速组局',
    explore: '探索附近',
  },
  exploreTemplates: {
    label: '看看{locationName}有什么局',
    prompt: '看看{locationName}附近有什么活动',
  },
  suggestionItems: [
    { label: '约饭局', prompt: '帮我组一个吃饭的局', icon: '🍜' },
    { label: '打游戏', prompt: '想找人一起打游戏', icon: '🎮' },
    { label: '运动', prompt: '想找人一起运动', icon: '🏃' },
    { label: '喝咖啡', prompt: '想约人喝咖啡聊天', icon: '☕' },
  ],
  quickPrompts: [
    { icon: '📍', text: '周末附近有什么活动？', prompt: '周末附近有什么活动' },
    { icon: '🏸', text: '帮我找个运动搭子', prompt: '帮我找个运动搭子' },
    { icon: '✨', text: '想组个周五晚的局', prompt: '想组个周五晚的局' },
  ],
  bottomQuickActions: ['快速组局', '找搭子', '附近活动', '我的草稿'],
  profileHints: {
    low: '补充偏好后，小聚推荐会更准',
    medium: '社交画像正在完善中，继续聊聊你的习惯',
    high: '社交画像已较完整，可直接让小聚给你安排',
  },
};

const WELCOME_GREETING_PERIODS: WelcomeGreetingPeriod[] = [
  'lateNight',
  'morning',
  'forenoon',
  'noon',
  'afternoon',
  'evening',
  'night',
];

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeWelcomeCopyConfig(raw: unknown): WelcomeCopyConfig {
  if (!isRecord(raw)) {
    return DEFAULT_WELCOME_COPY_CONFIG;
  }

  const greetingTemplates = { ...DEFAULT_WELCOME_COPY_CONFIG.greetingTemplates };
  const greetingTemplatesInput = isRecord(raw.greetingTemplates) ? raw.greetingTemplates : null;
  if (greetingTemplatesInput) {
    for (const key of WELCOME_GREETING_PERIODS) {
      const next = getNonEmptyString(greetingTemplatesInput[key]);
      if (next) {
        greetingTemplates[key] = next;
      }
    }
  }

  return {
    fallbackNickname: getNonEmptyString(raw.fallbackNickname) ?? DEFAULT_WELCOME_COPY_CONFIG.fallbackNickname,
    subGreeting: getNonEmptyString(raw.subGreeting) ?? DEFAULT_WELCOME_COPY_CONFIG.subGreeting,
    greetingTemplates,
  };
}

function normalizeWelcomeUiConfig(raw: unknown): WelcomeUiConfig {
  if (!isRecord(raw)) {
    return DEFAULT_WELCOME_UI_CONFIG;
  }

  const sectionTitlesInput = isRecord(raw.sectionTitles) ? raw.sectionTitles : null;
  const exploreTemplatesInput = isRecord(raw.exploreTemplates) ? raw.exploreTemplates : null;
  const profileHintsInput = isRecord(raw.profileHints) ? raw.profileHints : null;

  const suggestionItems = Array.isArray(raw.suggestionItems)
    ? raw.suggestionItems
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const label = getNonEmptyString(item.label);
        const prompt = getNonEmptyString(item.prompt);
        const icon = getNonEmptyString(item.icon) ?? undefined;
        if (!label || !prompt) {
          return null;
        }

        return {
          label,
          prompt,
          ...(icon ? { icon } : {}),
        };
      })
      .filter((item): item is { label: string; prompt: string; icon?: string } => Boolean(item?.label && item.prompt))
    : [];

  const quickPrompts = Array.isArray(raw.quickPrompts)
    ? raw.quickPrompts
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const text = getNonEmptyString(item.text);
        const prompt = getNonEmptyString(item.prompt);
        const icon = getNonEmptyString(item.icon);
        if (!text || !prompt || !icon) {
          return null;
        }

        return {
          icon,
          text,
          prompt,
        };
      })
      .filter((item): item is QuickPrompt => Boolean(item?.icon && item.text && item.prompt))
    : [];

  const bottomQuickActions = Array.isArray(raw.bottomQuickActions)
    ? raw.bottomQuickActions
      .map((item) => getNonEmptyString(item) ?? '')
      .filter(Boolean)
    : [];

  const profileHints = {
    low: getNonEmptyString(profileHintsInput?.low) ?? DEFAULT_WELCOME_UI_CONFIG.profileHints.low,
    medium: getNonEmptyString(profileHintsInput?.medium) ?? DEFAULT_WELCOME_UI_CONFIG.profileHints.medium,
    high: getNonEmptyString(profileHintsInput?.high) ?? DEFAULT_WELCOME_UI_CONFIG.profileHints.high,
  };

  const sectionTitles = {
    suggestions: getNonEmptyString(sectionTitlesInput?.suggestions) ?? DEFAULT_WELCOME_UI_CONFIG.sectionTitles.suggestions,
    explore: getNonEmptyString(sectionTitlesInput?.explore) ?? DEFAULT_WELCOME_UI_CONFIG.sectionTitles.explore,
  };

  const exploreTemplates = {
    label: getNonEmptyString(exploreTemplatesInput?.label) ?? DEFAULT_WELCOME_UI_CONFIG.exploreTemplates.label,
    prompt: getNonEmptyString(exploreTemplatesInput?.prompt) ?? DEFAULT_WELCOME_UI_CONFIG.exploreTemplates.prompt,
  };

  const composerPlaceholder = getNonEmptyString(raw.composerPlaceholder) ?? DEFAULT_WELCOME_UI_CONFIG.composerPlaceholder;

  return {
    composerPlaceholder,
    sectionTitles,
    exploreTemplates,
    suggestionItems: suggestionItems.length ? suggestionItems : DEFAULT_WELCOME_UI_CONFIG.suggestionItems,
    quickPrompts: quickPrompts.length ? quickPrompts : DEFAULT_WELCOME_UI_CONFIG.quickPrompts,
    bottomQuickActions: bottomQuickActions.length ? bottomQuickActions : DEFAULT_WELCOME_UI_CONFIG.bottomQuickActions,
    profileHints,
  };
}

function resolveWelcomePeriod(hour: number): WelcomeGreetingPeriod {
  if (hour < 6) return 'lateNight';
  if (hour < 9) return 'morning';
  if (hour < 12) return 'forenoon';
  if (hour < 14) return 'noon';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.split(`{${key}}`).join(value);
  }
  return output;
}

function renderWelcomeTemplate(template: string, nickname: string): string {
  return renderTemplate(template, {
    nickname,
    name: nickname,
  });
}

function clampWelcomeTitle(title: string, maxLength = 12): string {
  const normalized = title.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1))}…`;
}

const OPEN_WELCOME_TASK_STATUSES = ['active', 'waiting_auth', 'waiting_async_result'] as const;

function buildPostActivityFeedbackPrompts(activityTitle: string, activityId: string): QuickPrompt[] {
  const title = clampWelcomeTitle(activityTitle, 16);
  return [
    {
      icon: '✓',
      text: '挺顺利',
      prompt: `这次「${title}」挺顺利，帮我记录一下反馈。`,
      action: 'record_activity_feedback',
      params: {
        activityId,
        feedback: 'positive',
        reviewSummary: `这次「${title}」挺顺利。`,
      },
    },
    {
      icon: '·',
      text: '一般',
      prompt: `这次「${title}」一般，帮我记录一下并看看要不要调整。`,
      action: 'record_activity_feedback',
      params: {
        activityId,
        feedback: 'neutral',
        reviewSummary: `这次「${title}」一般，需要后续再优化。`,
      },
    },
    {
      icon: '×',
      text: '没成局',
      prompt: `这次「${title}」没成局，帮我记录一下并分析原因。`,
      action: 'record_activity_feedback',
      params: {
        activityId,
        feedback: 'failed',
        reviewSummary: `这次「${title}」没成局。`,
      },
    },
  ];
}

function buildUnfinishedIntentLabel(stage: string, status: string): string {
  if (stage === 'match_ready') {
    return '有新匹配';
  }

  if (stage === 'draft_ready') {
    return '草稿待确认';
  }

  if (status === 'waiting_async_result') {
    return '结果待查看';
  }

  return '继续这件事';
}

async function selectWelcomeFocus(userId: string, now: Date): Promise<WelcomeFocus | undefined> {
  const [postActivityTask] = await db
    .select({
      taskId: agentTasks.id,
      activityId: agentTasks.activityId,
      goalText: agentTasks.goalText,
      activityTitle: activities.title,
    })
    .from(agentTasks)
    .innerJoin(activities, eq(agentTasks.activityId, activities.id))
    .where(and(
      eq(agentTasks.userId, userId),
      eq(agentTasks.taskType, 'join_activity'),
      eq(agentTasks.currentStage, 'post_activity'),
      inArray(agentTasks.status, OPEN_WELCOME_TASK_STATUSES),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  if (postActivityTask) {
    const title = postActivityTask.activityTitle || postActivityTask.goalText;
    return {
      type: 'post_activity_feedback',
      label: `这次「${clampWelcomeTitle(title, 10)}」怎么样？`,
      prompt: `这次「${title}」怎么样？帮我记录这次活动反馈。`,
      priority: 1,
      context: {
        taskId: postActivityTask.taskId,
        activityId: postActivityTask.activityId,
        activityTitle: title,
      },
    };
  }

  const [recruitingActivity] = await db
    .select({
      id: activities.id,
      title: activities.title,
      currentParticipants: activities.currentParticipants,
      maxParticipants: activities.maxParticipants,
    })
    .from(activities)
    .where(and(
      eq(activities.creatorId, userId),
      eq(activities.status, 'active'),
      gt(activities.startAt, now),
      sql`${activities.currentParticipants} < ${activities.maxParticipants}`,
    ))
    .orderBy(sql`${activities.startAt} ASC`)
    .limit(1);

  if (recruitingActivity) {
    const remaining = Math.max(recruitingActivity.maxParticipants - recruitingActivity.currentParticipants, 0);
    return {
      type: 'recruiting_result',
      label: `「${clampWelcomeTitle(recruitingActivity.title, 10)}」还差 ${remaining} 人`,
      prompt: `继续处理「${recruitingActivity.title}」的招人结果，还差 ${remaining} 人，帮我看看下一步怎么推进。`,
      priority: 2,
      context: {
        activityId: recruitingActivity.id,
        remaining,
      },
    };
  }

  const openTasks = await db
    .select({
      taskId: agentTasks.id,
      taskType: agentTasks.taskType,
      currentStage: agentTasks.currentStage,
      status: agentTasks.status,
      goalText: agentTasks.goalText,
      activityId: agentTasks.activityId,
      partnerIntentId: agentTasks.partnerIntentId,
      intentMatchId: agentTasks.intentMatchId,
    })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, userId),
      inArray(agentTasks.status, OPEN_WELCOME_TASK_STATUSES),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(5);

  const unfinishedTask = openTasks.find((task) => task.currentStage !== 'post_activity');
  if (!unfinishedTask) {
    return undefined;
  }

  return {
    type: 'unfinished_intent',
    label: buildUnfinishedIntentLabel(unfinishedTask.currentStage, unfinishedTask.status),
    prompt: `继续处理：${unfinishedTask.goalText}`,
    priority: 3,
    context: {
      taskId: unfinishedTask.taskId,
      taskType: unfinishedTask.taskType,
      currentStage: unfinishedTask.currentStage,
      status: unfinishedTask.status,
      activityId: unfinishedTask.activityId,
      partnerIntentId: unfinishedTask.partnerIntentId,
      intentMatchId: unfinishedTask.intentMatchId,
    },
  };
}

export function generateGreeting(
  nickname: string | null,
  config: WelcomeCopyConfig = DEFAULT_WELCOME_COPY_CONFIG,
): string {
  const hour = new Date().getHours();
  const name = nickname?.trim() || config.fallbackNickname;
  const period = resolveWelcomePeriod(hour);
  return renderWelcomeTemplate(config.greetingTemplates[period], name);
}

export async function getWelcomeCard(
  userId: string | null,
  nickname: string | null,
  location: { lat: number; lng: number } | null
): Promise<WelcomeResponse> {
  const welcomeCopyRaw = await getConfigValue<unknown>('welcome.copy', DEFAULT_WELCOME_COPY_CONFIG);
  const welcomeCopy = normalizeWelcomeCopyConfig(welcomeCopyRaw);
  const welcomeUiRaw = await getConfigValue<unknown>('welcome.ui', DEFAULT_WELCOME_UI_CONFIG);
  const welcomeUi = normalizeWelcomeUiConfig(welcomeUiRaw);
  const greeting = generateGreeting(nickname, welcomeCopy);
  const sections: WelcomeSection[] = [];
  const now = new Date();

  // 社交档案（已登录用户）
  let socialProfile: { joinedActivities: number; hostedActivities: number; preferenceCompleteness: number } | undefined;
  let pendingActivities: WelcomePendingActivity[] = [];
  let hasDraftActivity = false;
  let welcomeFocus: WelcomeFocus | undefined;

  if (userId) {
    const [activityStats, profile, selectedWelcomeFocus] = await Promise.all([
      getUserActivityStats(userId),
      getEnhancedUserProfile(userId),
      selectWelcomeFocus(userId, now),
    ]);
    welcomeFocus = selectedWelcomeFocus;

    const preferencesCount = profile.preferences.length;
    const locationsCount = profile.frequentLocations.length;
    const preferenceCompleteness = Math.min(100, preferencesCount * 15 + locationsCount * 10);

    socialProfile = {
      joinedActivities: activityStats.joinedActivities,
      hostedActivities: activityStats.hostedActivities,
      preferenceCompleteness,
    };

    const [draftRows, activeRows] = await Promise.all([
      db
        .select({
          id: activities.id,
          title: activities.title,
        })
        .from(activities)
        .where(and(
          eq(activities.creatorId, userId),
          eq(activities.status, 'draft'),
          gt(activities.startAt, now),
        ))
        .orderBy(desc(activities.updatedAt))
        .limit(1),
      db
        .select({
          id: activities.id,
          title: activities.title,
          type: activities.type,
          startAt: activities.startAt,
          locationName: activities.locationName,
          locationHint: activities.locationHint,
          currentParticipants: activities.currentParticipants,
          maxParticipants: activities.maxParticipants,
          status: activities.status,
        })
        .from(participants)
        .innerJoin(activities, eq(participants.activityId, activities.id))
        .where(and(
          eq(participants.userId, userId),
          eq(participants.status, 'joined'),
          eq(activities.status, 'active'),
          gt(activities.startAt, now),
        ))
        .orderBy(sql`${activities.startAt} ASC`)
        .limit(3),
    ]);

    if (draftRows.length > 0) {
      const draft = draftRows[0];
      hasDraftActivity = true;
      sections.push({
        id: 'draft',
        title: '继续上次草稿',
        items: [
          {
            type: 'draft',
            label: `继续完善「${clampWelcomeTitle(draft.title)}」`,
            prompt: `继续完善我的活动草稿：${draft.title}`,
            context: { activityId: draft.id },
          },
        ],
      });
    }

    pendingActivities = activeRows.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      startAt: item.startAt.toISOString(),
      locationName: item.locationName,
      locationHint: item.locationHint,
      currentParticipants: item.currentParticipants,
      maxParticipants: item.maxParticipants,
      status: item.status,
    }));
  }

  // 快速组局建议
  const suggestions: WelcomeSection = {
    id: 'suggestions',
    title: welcomeUi.sectionTitles.suggestions,
    icon: '✨',
    items: welcomeUi.suggestionItems.map((item) => ({
      type: 'suggestion' as const,
      label: item.label,
      prompt: item.prompt,
      ...(item.icon ? { icon: item.icon } : {}),
    })),
  };
  sections.push(suggestions);

  // 探索附近（有位置时显示）
  if (location) {
    const locationName = await reverseGeocode(location.lat, location.lng);
    const explore: WelcomeSection = {
      id: 'explore',
      title: welcomeUi.sectionTitles.explore,
      icon: '📍',
      items: [
        {
          type: 'explore',
          label: renderTemplate(welcomeUi.exploreTemplates.label, { locationName, location: locationName }),
          prompt: renderTemplate(welcomeUi.exploreTemplates.prompt, { locationName, location: locationName }),
          icon: '🗺️',
          context: { locationName, lat: location.lat, lng: location.lng },
        },
      ],
    };
    sections.push(explore);
  }

  let subGreeting = welcomeCopy.subGreeting;

  if (hasDraftActivity) {
    subGreeting = '你有一个草稿还没发出去，要不要现在继续？';
  } else if (pendingActivities.length > 0) {
    subGreeting = `你有 ${pendingActivities.length} 个待参加活动，先看看接下来怎么安排？`;
  } else if (socialProfile && socialProfile.preferenceCompleteness < 30) {
    subGreeting = '告诉我你偏爱什么，小聚会推荐得更准。';
  } else if (location) {
    subGreeting = '附近有新局，想直接看看吗？';
  }

  // 快捷入口（v4.4 新增）
  const focusContext = isRecord(welcomeFocus?.context) ? welcomeFocus.context : null;
  const focusActivityTitle = getNonEmptyString(focusContext?.activityTitle);
  const focusActivityId = getNonEmptyString(focusContext?.activityId);
  const quickPrompts = welcomeFocus?.type === 'post_activity_feedback' && focusActivityTitle && focusActivityId
    ? buildPostActivityFeedbackPrompts(focusActivityTitle, focusActivityId)
    : hasDraftActivity ? [] : welcomeUi.quickPrompts;

  return {
    greeting,
    subGreeting,
    sections,
    socialProfile,
    pendingActivities,
    welcomeFocus,
    quickPrompts,
    ui: {
      composerPlaceholder: welcomeUi.composerPlaceholder,
      bottomQuickActions: welcomeUi.bottomQuickActions,
      profileHints: welcomeUi.profileHints,
    },
  };
}

async function buildAiChatEnvelopeInternal(
  request: GenUIRequest,
  options: { viewer?: ViewerContext | null; abortSignal?: AbortSignal } = {}
): Promise<AiChatEnvelopeResult> {
  const chatRuntime = await import('./runtime/chat-response');
  return chatRuntime.buildAiChatEnvelope(request, options);
}

async function finalizeAiChatResponse(params: {
  request: GenUIRequest;
  viewer: ViewerContext | null;
  result: AiChatEnvelopeResult;
}): Promise<AiChatEnvelopeResult> {
  const normalized = applyAiChatResponsePolicies({
    request: params.request,
    viewer: params.viewer,
    envelope: params.result.envelope,
    traces: params.result.traces,
    resolvedStructuredAction: params.result.resolvedStructuredAction,
    executionPath: params.result.executionPath,
  });

  if (params.viewer) {
    const syncResults = await Promise.allSettled([
      syncJoinTaskFromChatResponse({
        userId: params.viewer.id,
        conversationId: normalized.envelope.conversationId,
        request: params.request,
        blocks: normalized.envelope.response.blocks,
      }),
      syncPartnerTaskFromChatResponse({
        userId: params.viewer.id,
        conversationId: normalized.envelope.conversationId,
        request: params.request,
        blocks: normalized.envelope.response.blocks,
      }),
      syncCreateTaskFromChatResponse({
        userId: params.viewer.id,
        conversationId: normalized.envelope.conversationId,
        request: params.request,
        blocks: normalized.envelope.response.blocks,
      }),
      syncConversationResponseSnapshot({
        conversationId: normalized.envelope.conversationId,
        userId: params.viewer.id,
        userText: resolveConversationUserText(params.request.input),
        blocks: normalized.envelope.response.blocks,
        responseId: normalized.envelope.response.responseId,
        traceId: normalized.envelope.traceId,
        inputType: params.request.input.type,
        resolvedStructuredAction: params.result.resolvedStructuredAction,
        activityId: typeof params.request.context?.activityId === 'string' ? params.request.context.activityId : undefined,
      }),
    ]);

    syncResults.forEach((settled, index) => {
      if (settled.status === 'rejected') {
        const labels = [
          'syncJoinTaskFromChatResponse',
          'syncPartnerTaskFromChatResponse',
          'syncCreateTaskFromChatResponse',
          'syncConversationResponseSnapshot',
        ] as const;
        console.error(`[AI Chat Finalize] ${labels[index]} failed:`, settled.reason);
      }
    });
  }

  return {
    ...params.result,
    envelope: normalized.envelope,
    traces: normalized.traces,
  };
}

export async function streamAiChatResponse(
  request: GenUIRequest,
  options: { viewer?: ViewerContext | null; abortSignal?: AbortSignal; requestAbortSignal?: AbortSignal } = {}
) {
  const result = await buildAiChatEnvelopeInternal(request, {
    viewer: options.viewer,
    abortSignal: options.requestAbortSignal ?? options.abortSignal,
  });
  const finalized = await finalizeAiChatResponse({
    request,
    viewer: options.viewer ?? null,
    result,
  });
  const chatRuntime = await import('./runtime/chat-response');
  return chatRuntime.createAiChatStreamResponse({
    request,
    envelope: finalized.envelope,
    traces: finalized.traces,
  });
}

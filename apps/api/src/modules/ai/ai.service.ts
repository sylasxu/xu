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
  userMemories,
  activityMessages,
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
} from '@xu/db';
import {
  convertToModelMessages,
  stepCountIs,
  hasToolCall,
  type LanguageModelUsage,
  type UIMessage,
  generateObject,
  jsonSchema,
} from 'ai';
import { randomUUID } from 'crypto';
import type { ProcessorLogEntry } from '@xu/db';
import type { GenUIBlock, GenUIRequest, GenUITracePayload, GenUISuggestions } from '@xu/genui-contract';

// 新架构模块
import { type ClassifyResult } from './intent';
import { getOrCreateThread, saveMessage, clearUserThreads, deleteThread } from './memory';
import { getConversationMessageExpiresAt, refreshMessageEmbedding } from './memory/store';
import { resolveToolsForIntent } from './tools';
import { getSystemPrompt, type PromptContext, type ActivityDraftForPrompt } from './prompts';
import { getFallbackConfig, resolveChatModelSelection, resolveFallbackChatModelSelection, shouldOmitTemperatureForModelId } from './models/router';
import { runText } from './models/runtime';
import {
  isKnownAiProviderErrorMessage as isKnownProviderError,
  normalizeAiProviderErrorMessage as normalizeProviderError,
} from './models/provider-error';
import { generateText } from 'ai';
import { resolveFollowupActions } from './shared/action-outcomes';
// Guardrails
import { checkRateLimit } from './guardrails/rate-limiter';
// 辅助函数（从独立模块导入）
import { getUserNickname } from '../users/user.service';
import { reverseGeocode } from './utils/geo';
// Observability
import { createLogger } from './observability/logger';
import { runWithTrace } from './observability/tracer';
import type { EnhancedUserProfile } from './memory';
// Processors (v4.9 管线架构)
import {
  inputGuardProcessor,
  keywordMatchProcessor,
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
import {
  listCurrentAgentTaskSnapshots,
  markJoinTaskDiscussionEntered,
  resolveConversationTaskId,
  syncCreateTaskFromChatResponse,
  syncJoinTaskFromChatResponse,
  syncPartnerTaskFromChatResponse,
} from './task-runtime/agent-task.service';
import { applyAiChatResponsePolicies } from './runtime/response-policy';
import {
  buildAiChatEnvelope,
  createAiChatStreamResponse,
  createAiChatErrorStreamResponse,
  type AiChatEnvelopeResult,
} from './runtime/chat-response';

export {
  recordJoinTaskAuthGateFromDomain,
  resolveCurrentTaskHomeState,
} from './task-runtime/agent-task.service';

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

async function loadUserMemoryContext(userId: string | null): Promise<string | null> {
  if (!userId || !isUuidLike(userId)) return null;

  const memories = await db
    .select({ content: userMemories.content, memoryType: userMemories.memoryType })
    .from(userMemories)
    .where(eq(userMemories.userId, userId))
    .orderBy(desc(userMemories.updatedAt))
    .limit(3);

  if (memories.length === 0) return null;

  const lines = memories.map((m, i) => `${i + 1}. [${m.memoryType}] ${m.content}`);
  return `## 关于这位用户的历史记忆\n${lines.join('\n')}`;
}

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

    const conversationHistory: Array<{
      role: ChatRequest['messages'][number]['role'];
      content: string;
    }> = effectiveMessages.map((m) => ({
      role: m.role,
      content: getMessageTextContent(m),
    }));
    const rawUserInput = conversationHistory.filter((message) => message.role === 'user').pop()?.content || currentInputText;

    const locationName = location ? await reverseGeocode(location[1], location[0]) : undefined;
    const userNickname = isUuidLike(userId) ? await getUserNickname(userId) : undefined;
    const memoryContext = await loadUserMemoryContext(userId);

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

    const rawPreLLMConfigs = await buildPreLLMPipeline();
    const preLLMConfigs = rawPreLLMConfigs.filter((config) => {
      const name = (config as { name?: string }).name;
      if (structuredAction && name === 'intent-classify-processor') {
        return false;
      }
      if (userId && !isUuidLike(userId) && name === 'user-profile-processor') {
        return false;
      }
      return true;
    });
    const { context: preLLMContext, logs: pipelineLogs } = await runProcessors(preLLMConfigs, keywordResult.context);
    processorLogs.push(...pipelineLogs);

    const actionHandlerContext: import('./user-action').ActionHandlerContext = {
      recalledActivities: undefined,
      userProfile: preLLMContext.metadata.userProfile,
    };

    let actionResult: import('./user-action').StructuredActionResult | undefined;

    if (structuredAction) {
      logger.info('Processing structured action', {
        action: structuredAction.action,
        source: structuredAction.source,
        userId: userId || 'anon',
      });

      actionResult = await handleStructuredAction(
        structuredAction,
        userId,
        location ? { lat: location[1], lng: location[0] } : undefined,
        actionHandlerContext,
      );
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

    if (userId && !structuredAction) {
      const partnerThreadId = conversationId || (await getOrCreateThread(userId)).id;
      const partnerMatchingState = await recoverPartnerMatchingState(partnerThreadId);

      if (partnerMatchingState) {
        const currentQuestion = getNextQuestion(partnerMatchingState);
        if (looksLikePartnerAnswer(sanitizedInput, currentQuestion)) {
          return handlePartnerMatchingFlowResult(request, partnerMatchingState, partnerThreadId, sanitizedInput, actionHandlerContext);
        }
      }

      if (intentResult.intent === 'partner' && shouldStartPartnerMatching('partner', partnerMatchingState)) {
        return handlePartnerMatchingFlowResult(request, partnerMatchingState, partnerThreadId, sanitizedInput, actionHandlerContext);
      }
    }

    // Action 快速出口：使用 Voice 层生成人味回复 + 动态按钮
    if (structuredAction && actionResult) {
      const { text, nextActions } = await generateActionResponse({
        actionType: structuredAction.action,
        result: actionResult,
        userNickname: userNickname ?? undefined,
        locationName: locationName ?? undefined,
      });
      return buildStructuredActionResult(actionResult, structuredAction, text, nextActions);
    }

    const userLocation = location ? { lat: location[1], lng: location[0] } : null;
    const tools = await resolveToolsForIntent(userId, intentResult.intent, {
      hasDraftContext: !!draftContext,
      location: userLocation,
      recalledActivities: undefined,
    });

    const injectedPrompts: string[] = [];
    if (preLLMContext.metadata.userProfilePrompt) {
      injectedPrompts.push(preLLMContext.metadata.userProfilePrompt as string);
    }
    const systemPrompt = injectedPrompts.length > 0
      ? `${preLLMContext.systemPrompt}\n\n${injectedPrompts.join('\n\n')}`
      : preLLMContext.systemPrompt;

    logger.info('system_prompt_audit', {
      totalLength: systemPrompt.length,
      baseLength: preLLMContext.systemPrompt.length,
      enrichmentLength: injectedPrompts.join('\n\n').length,
      enrichmentCount: injectedPrompts.length,
    });

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
 * xu 人设 System Prompt
 * 用于轻量 LLM 生成符合 xu 气质的回复
 */
const XU_PERSONA = `你是"xu"，一个碎片化社交助理。你帮用户把想玩的事、找人、组局、开口和活动后的跟进整理成可执行的下一步。

说话风格：
- 短句、自然、直接，不要像客服，也不要装熟
- 先帮用户把事情理清楚，再给下一步选择
- 不替用户做社交表演，不冒进承诺，不催促
- 可以温和一点，但少用感叹号和表情符号
- 不要说"正在解析"，要说"收到，我先帮你整理一下。"
- 称呼用户时优先直接对话，不要叫"用户"

记住：你是 xu，一个会帮用户张罗但懂分寸的社交助理。`;

/**
 * Action Response 层 — 为 Action 执行结果生成人味回复 + 上下文按钮
 *
 * v6.0: 按钮文案不再硬编码，由 LLM 根据上下文动态生成。
 * 使用 generateObject 同时输出 text + labels，一轮调用搞定。
 * 失败时降级到系统消息 + 默认按钮，不阻塞主链路。
 */
async function generateActionResponse(params: {
  actionType: string;
  result: import('./user-action').StructuredActionResult;
  userNickname?: string;
  locationName?: string;
}): Promise<{ text: string; nextActions: Array<{ label: string; action: string; params?: Record<string, unknown> }> }> {
  const startTime = Date.now();
  const { actionType, result, userNickname, locationName } = params;
  const data = asRecord(result.data);
  const hasError = !result.success;
  const systemMessage = typeof result.error === 'string' && result.error.trim()
    ? result.error.trim()
    : (typeof data?.message === 'string' && data.message.trim() ? data.message.trim() : '');
  const loc = locationName || (typeof data?.locationName === 'string' ? data.locationName : '');

  const followupActions = resolveFollowupActions({ actionType, data });

  // 测试运行时直接走本地兜底，不调 LLM
  if (isTestRuntime()) {
    const localVoice = buildDeterministicActionVoice({
      actionType,
      data,
      hasError,
      systemMessage,
      locationName: loc,
    });
    return {
      text: localVoice || systemMessage || '已处理',
      nextActions: followupActions.map((a) => ({ label: a.action, ...a })),
    };
  }

  const contextLines: string[] = [];
  if (userNickname) contextLines.push(`用户昵称：${userNickname}`);
  if (loc) contextLines.push(`地点：${loc}`);
  if (systemMessage) contextLines.push(`操作反馈：${systemMessage}`);

  const actionDescriptions = followupActions
    .map((a, i) => `${i + 1}. ${a.action}${a.params ? `（参数：${JSON.stringify(a.params)}）` : ''}`)
    .join('\n');

  const prompt = `用户刚刚执行了操作：${actionType}
操作结果：${hasError ? '失败' : '成功'}
${contextLines.join('\n')}

可用的下一步操作：
${actionDescriptions || '（无）'}

请生成：
1. 一句自然回应（短句、直接、不装熟，不超过50字）
2. 为每个可用操作写一个自然的按钮标签（每个不超过12字）。如果某个操作不适合当前语境，对应位置放空字符串。

要求：
- 你是 xu，碎片化社交助理
- 不要重复操作反馈里的具体数据
- ${hasError ? '温和告知失败，给一个轻松的替代建议' : '轻松确认成功，暗示下一步可以做什么'}`;

  try {
    const { model, modelId } = await resolveChatModelSelection({ routeKey: 'chat' });

    const { object } = await generateObject({
      model,
      system: XU_PERSONA,
      prompt,
      schema: jsonSchema<{ text: string; labels: string[] }>({
        type: 'object',
        properties: {
          text: { type: 'string', description: '自然回应文字，不超过50字' },
          labels: {
            type: 'array',
            items: { type: 'string', description: '按钮标签，不超过12字，不适合时为空字符串' },
            description: `按钮标签数组，长度必须等于可用操作数量(${followupActions.length})`,
          },
        },
        required: ['text', 'labels'],
      }),
      ...(shouldOmitTemperatureForModelId(modelId) ? {} : { temperature: 0.7 }),
    });

    const latency = Date.now() - startTime;
    const nextActions = followupActions
      .map((action, index) => ({
        label: (object.labels[index] || '').trim() || action.action,
        action: action.action,
        ...(action.params ? { params: action.params } : {}),
      }))
      .filter((item) => item.label);

    logger.info('action_response_generated', {
      actionType,
      model: modelId,
      latencyMs: latency,
      responseLength: object.text.trim().length,
      nextActionCount: nextActions.length,
      hasError,
    });

    return {
      text: object.text.trim() || systemMessage || '已处理',
      nextActions,
    };
  } catch (error) {
    logger.error('action_response_failed', { actionType, error: String(error) });
    return {
      text: systemMessage || '已处理',
      nextActions: followupActions.map((a) => ({ label: a.action, ...a })),
    };
  }
}

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test'
    || process.env.BUN_ENV === 'test'
    || process.env.VITEST === 'true'
    || process.argv.some((arg) =>
      arg.endsWith('sandbox-regression.ts')
      || arg.endsWith('ten-user-world.ts')
    );
}

function getActivityTypeLabel(type: unknown): string {
  switch (type) {
    case 'boardgame':
      return '桌游';
    case 'sports':
      return '运动局';
    case 'food':
      return '饭局';
    case 'entertainment':
      return '活动';
    default:
      return '局';
  }
}

function buildDeterministicActionVoice(params: {
  actionType: string;
  data: Record<string, unknown> | undefined;
  hasError: boolean;
  systemMessage: string;
  locationName: string;
}): string | null {
  if (params.hasError) {
    return params.systemMessage || '这一步没处理成，换个入口再试一次。';
  }

  if (params.actionType === 'explore_nearby') {
    const explore = asRecord(params.data?.explore);
    const center = asRecord(explore?.center);
    const locationName = typeof center?.name === 'string' && center.name.trim()
      ? center.name.trim()
      : params.locationName;
    const results = Array.isArray(explore?.results) ? explore.results : [];
    const typeLabel = getActivityTypeLabel(params.data?.type);

    if (results.length > 0) {
      return locationName
        ? `${locationName}有，先替你筛了一轮，先看看。`
        : '有，先替你筛了一轮，先看看。';
    }

    return locationName
      ? `${locationName}附近暂时没有合适的${typeLabel}，你可以先试试“那我自己组一个”，也可以“帮我找同类搭子”。`
      : `暂时没有合适的${typeLabel}，你可以先试试“那我自己组一个”，也可以“帮我找同类搭子”。`;
  }

  if (params.actionType === 'search_partners') {
    const typeLabel = getActivityTypeLabel(params.data?.type);
    if (typeLabel === '桌游') {
      return '这桌补位方向我先帮你筛了一轮，先看看合不合适。';
    }

    return params.locationName
      ? `${params.locationName}这边我先帮你筛了一轮，先看看。`
      : '我先帮你筛了一轮，先看看。';
  }

  return params.systemMessage || null;
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
  '我现在有点忙，你稍等 1 分钟再试一次。',
  '请求有点密，我缓一下，等会儿继续帮你整理。',
  '我正在处理其他朋友的请求，1 分钟后回来找你！',
  '稍等一下，我马上回来。',
];

/** 拦截场景预设文案 */
const BLOCKED_RESPONSES = [
  '这个话题我帮不了你。我们换个更适合聊的方向吧。',
  '这个我不太方便继续。你可以跟我说说最近想玩什么。',
  '这方面我不适合帮你判断。聊聊活动或找搭子会更合适。',
];

/**
 * xu 快速回复生成器
 * 为各种边缘场景生成有灵魂的兜底回复
 */
async function xuQuickReply(scenario: DirectResponseScenario): Promise<string> {
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
      system: XU_PERSONA,
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
      return '哎呀，我有点忙不过来了，你稍等 1 分钟再来呗 😅';
    case 'blocked':
      return '这个话题我帮不了你 😅';
    case 'error':
      return '我这会儿有点卡住了，你换个说法再试试，我继续帮你接。';
    case 'fallback':
      return '我没太明白，换个说法呗？';
    default:
      return '我还在学习中，再试一次？';
  }
}

function createExecutionTrace(stage: string, detail: Record<string, unknown>): GenUITracePayload {
  return { stage, detail };
}

async function buildDirectResponseResult(
  scenario: DirectResponseScenario
): Promise<ChatExecutionResult> {
  const text = await xuQuickReply(scenario);
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
  structuredAction?: StructuredAction,
  voiceText?: string,
  nextActions?: Array<{ label: string; action: string; params?: Record<string, unknown> }>,
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
  // v5.5: Voice 层存在时总是输出文本，否则按原逻辑判断
  const shouldWritePrimaryText = voiceText ? true : (!authRequiredPayload && !successWidgetPayload);
  const assistantReplyText = voiceText ?? actionMessage;
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
      ...(nextActions && nextActions.length > 0 ? { nextActions } : {}),
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
  userMessage: string,
  context?: import('./user-action').ActionHandlerContext,
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
    const partnerAction = {
      action: 'search_partners' as const,
      payload,
      source: 'partner_matching_workflow',
      originalText: completedState.rawInput,
    };
    const actionResult = await handleStructuredAction(partnerAction, userId, undefined, context);
    const { text, nextActions } = await generateActionResponse({
      actionType: partnerAction.action,
      result: actionResult,
    });
    return buildStructuredActionResult(actionResult, partnerAction, text, nextActions);
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
    .orderBy(conversationMessages.createdAt)
    .limit(50);

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

// Welcome Card 已迁移到 ./welcome/welcome.service.ts
export {
  getWelcomeCard,
  generateGreeting,
  type WelcomeResponse,
  type WelcomeSection,
  type WelcomeFocus,
  type WelcomePendingActivity,
  type QuickPrompt,
  type SocialProfile,
  type WelcomeFocusType,
} from './welcome/welcome.service';

// ==========================================
// End of Welcome Card re-exports
// ==========================================


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
  try {
    const result = await buildAiChatEnvelope(request, {
      viewer: options.viewer,
      abortSignal: options.requestAbortSignal ?? options.abortSignal,
      executeChatRequest,
      getConversationMessages,
    });
    const finalized = await finalizeAiChatResponse({
      request,
      viewer: options.viewer ?? null,
      result,
    });
    return createAiChatStreamResponse({
      request,
      envelope: finalized.envelope,
      traces: finalized.traces,
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    if (!isKnownProviderError(rawMessage)) {
      throw error;
    }

    const message = normalizeProviderError(rawMessage);
    logger.warn('AI provider error converted to stream response', {
      message,
      viewerId: options.viewer?.id || null,
    });
    return createAiChatErrorStreamResponse({
      request,
      message,
    });
  }
}

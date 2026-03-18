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

import { db, users, conversations, conversationMessages, activities, participants, eq, desc, sql, inArray, and, or, gt, lt } from '@juchang/db';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  stepCountIs,
  hasToolCall,
  type LanguageModelUsage,
  type UIMessage,
  type UIMessageStreamWriter,
} from 'ai';
import { randomUUID } from 'crypto';
import type { ProcessorLogEntry } from '@juchang/db';
import type { GenUIBlock } from '@juchang/genui-contract';

// 新架构模块
import { type ClassifyResult } from './intent';
import { getOrCreateThread, saveMessage, clearUserThreads, deleteThread } from './memory';
import { resolveToolsForIntent, getToolWidgetType, getToolDisplayName } from './tools';
import { createPartnerIntent } from './tools/partner-tools';
import { getSystemPrompt, type PromptContext, type ActivityDraftForPrompt } from './prompts';
import { resolveChatModelSelection } from './models/router';
import { runObject, runStream } from './models/runtime';
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
  evaluateQualityProcessor,
  runProcessors,
  runPostLLMProcessors,
  runAsyncProcessors,
  buildPreLLMPipeline,
  type ProcessorContext,
} from './processors';
// Partner Matching - 找搭子追问流程
import {
  shouldStartPartnerMatching,
  recoverPartnerMatchingState,
  createPartnerMatchingState,
  updatePartnerMatchingState,
  getNextQuestion,
  parseUserAnswer,
  looksLikePartnerAnswer,
  inferPartnerMessageHints,
  persistPartnerMatchingState,
  buildPartnerIntentPayload,
  buildPartnerIntentFormPayload,
  getPartnerActivityTypeLabel,
  getPartnerTimeLabel,
  type PartnerMatchingState,
} from './workflow/partner-matching';
// Structured Action：结构化动作可直接映射为 UI 响应
import { handleStructuredAction, type StructuredAction } from './user-action';
import { buildTurnContextFromBlocks } from './turn-context';
import { getConfigValue } from './config/config.service';
import { buildNextBestActions } from './next-best-action.service';
import { resolveConversationTaskId } from './task-runtime/agent-task.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
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
  getQualityMetrics,
  getConversionMetrics,
  getPlaygroundStats,
  getAIHealthMetrics,
} from './observability/ai-metrics.service';

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
  source: 'miniprogram' | 'admin';
  draftContext?: { activityId: string; currentDraft: ActivityDraftForPrompt };
  trace?: boolean;
  ai?: { model?: string; temperature?: number; maxTokens?: number };
  abortSignal?: AbortSignal;
  /** 结构化动作：跳过 LLM 意图识别直接执行 */
  structuredAction?: StructuredAction;
}

export interface TraceStep {
  toolName: string;
  toolCallId: string;
  args: unknown;
  result?: unknown;
}

type ChatMessage = ChatRequest['messages'][number];
type ChatMessagePart = NonNullable<ChatMessage['parts']>[number];
type AIStreamWriter = UIMessageStreamWriter<UIMessage>;
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

function getToolStepPhase(step: { stepNumber: number; toolResults: unknown[] }): 'initial' | 'continue' | 'tool-result' {
  if (step.stepNumber === 0) {
    return 'initial';
  }

  return step.toolResults.length > 0 ? 'tool-result' : 'continue';
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

function writeWidgetEvent(writer: AIStreamWriter, data: Record<string, unknown>): void {
  writer.write({
    type: 'data-widget',
    data,
  });
}

function writeTraceStartEvent(writer: AIStreamWriter, data: Record<string, unknown>): void {
  writer.write({
    type: 'data-trace-start',
    data,
    transient: true,
  });
}

function writeTraceStepEvent(writer: AIStreamWriter, data: Record<string, unknown>): void {
  writer.write({
    type: 'data-trace-step',
    data,
    transient: true,
  });
}

function writeTraceEndEvent(writer: AIStreamWriter, data: Record<string, unknown>): void {
  writer.write({
    type: 'data-trace-end',
    data,
    transient: true,
  });
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
  ) {
    return 'manage';
  }

  return 'unknown';
}

function extractToolSchema(tool: unknown): unknown {
  const toolRecord = asRecord(tool);
  if (!toolRecord) {
    return {};
  }

  const inputSchema = toolRecord.inputSchema;
  if (isRecord(inputSchema) && 'jsonSchema' in inputSchema) {
    return inputSchema.jsonSchema;
  }

  return inputSchema ?? toolRecord.parameters ?? {};
}

// ==========================================
// AI Chat 核心
// ==========================================

export async function handleChatStream(request: ChatRequest): Promise<Response> {
  return runWithTrace(async () => {
  const { messages, userId, rateLimitUserId, conversationId, location, source, draftContext, trace, ai, abortSignal, structuredAction } = request;
  let effectiveMessages = messages;
  const startTime = Date.now();
  const latestMessage = messages[messages.length - 1];
  const currentInputText = typeof latestMessage?.content === 'string'
    ? latestMessage.content
    : latestMessage?.parts?.find((part): part is { type: 'text'; text: string } => part.type === 'text')?.text
      || structuredAction?.originalText
      || '';

  // 0. 提前执行限流与输入护栏，避免文本推断出的结构化动作绕过基础保护
  const rateLimitSubject = userId || rateLimitUserId || null;
  const rateLimitResult = await checkRateLimit(rateLimitSubject, { maxRequests: 30, windowSeconds: 60 });
  if (!rateLimitResult.allowed) {
    logger.warn('Rate limit exceeded', { userId, retryAfter: rateLimitResult.retryAfter });
    return createDirectResponse('请求太频繁了，休息一下再来吧～', trace);
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
    return createDirectResponse('这个话题我帮不了你 😅', trace);
  }

  let sanitizedInput = initialGuardResult.context.userInput;

  if (userId && structuredAction?.source === 'text_action_inference') {
    const partnerThreadId = conversationId || (await getOrCreateThread(userId)).id;
    const partnerMatchingState = await recoverPartnerMatchingState(partnerThreadId);
    if (partnerMatchingState) {
      const currentQuestion = getNextQuestion(partnerMatchingState);
      if (looksLikePartnerAnswer(sanitizedInput, currentQuestion)) {
        return handlePartnerMatchingFlow(
          request,
          partnerMatchingState,
          partnerThreadId,
          sanitizedInput,
          { intent: 'partner', confidence: 1, method: 'p1' }
        );
      }
    }
  }

  // 1. 先尝试执行结构化动作
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
    
    // 如果动作处理成功且不需要回退到 LLM
    if (actionResult.success && !actionResult.fallbackToLLM) {
      return createStructuredActionResponse(actionResult, trace, structuredAction);
    }
    
    // 如果需要回退到 LLM，使用 fallbackText 作为用户消息
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
          return createDirectResponse('这个话题我帮不了你 😅', trace);
        }

        sanitizedInput = fallbackGuardResult.context.userInput;
      }
    }
    
    // 如果动作失败且不回退，直接返回错误
    if (!actionResult.success && !actionResult.fallbackToLLM) {
      return createDirectResponse(actionResult.error || '操作失败', trace);
    }
  }

  // 2. 提取最后一条用户消息（用于后续 LLM 管线）
  const conversationHistory: Array<{
    role: ChatRequest['messages'][number]['role'];
    content: string;
  }> = effectiveMessages.map((m) => ({
    role: m.role,
    content: getMessageTextContent(m),
  }));
  const rawUserInput = conversationHistory.filter((message) => message.role === 'user').pop()?.content || currentInputText;

  // ── Pre-LLM 管线阶段 ──
  // 2.5 构建上下文（promptContext 需要在 ProcessorContext 之前准备好）
  const locationName = location ? await reverseGeocode(location[1], location[0]) : undefined;
  const userNickname = userId ? await getUserNickname(userId) : undefined;
  const userProfile = userId ? await getEnhancedUserProfile(userId) : null;

  const promptContext: PromptContext = {
    currentTime: new Date(),
    userLocation: location ? { lat: location[1], lng: location[0], name: locationName } : undefined,
    userNickname,
    draftContext,
    workingMemory: userProfile ? buildProfilePrompt(userProfile) : null,
  };

  // 构建初始 ProcessorContext（所有处理器间数据通过 context.metadata 传递）
  const initialContext: ProcessorContext = {
    userId,
    messages: conversationHistory,
    rawUserInput,
    userInput: sanitizedInput,
    systemPrompt: await getSystemPrompt(promptContext),
    metadata: {
      ...(ai ? { requestAi: ai } : {}),
    },
  };

  // 2.6 P0 层：keyword-match-processor（独立预检查，命中后直接返回）
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

  if (keywordMeta?.matched) {
    logger.info('P0 keyword matched', {
      keywordId: keywordMeta.keywordId,
      keyword: keywordMeta.keyword,
      matchType: keywordMeta.matchType,
      userId: userId || 'anon',
    });

    // 增加命中次数（异步，不阻塞）
    const { incrementHitCount } = await import('../hot-keywords/hot-keywords.service');
    if (keywordMeta.keywordId) {
      incrementHitCount(keywordMeta.keywordId).catch(err => {
        logger.error('Failed to increment hit count', { error: err });
      });
    }

    // 返回预设响应（需要完整的 keyword 对象，从 hot-keywords 服务重新获取）
    const { matchKeyword } = await import('../hot-keywords/hot-keywords.service');
    const matchedKeyword = await matchKeyword(sanitizedInput);
    if (matchedKeyword) {
      return createKeywordResponse(matchedKeyword, trace);
    }
    // 降级：metadata 标记命中但无法获取完整 keyword 对象，继续后续流程
  }

  // 3. 运行 Pre-LLM 管线：intent-classify → [user-profile ∥ semantic-recall] → token-limit
  const preLLMConfigs = await buildPreLLMPipeline();
  const { context: preLLMContext, logs: pipelineLogs, success: pipelineSuccess } = await runProcessors(preLLMConfigs, keywordResult.context);
  processorLogs.push(...pipelineLogs);

  if (!pipelineSuccess) {
    logger.warn('Pre-LLM pipeline failed', { logs: pipelineLogs.filter(l => !l.success) });
    const failedLogs = pipelineLogs.filter((log) => !log.success);
    const failureMessage = failedLogs[0]?.error || 'Pre-LLM pipeline failed';
    throw new Error(failureMessage);
  }

  // 4. 从 context.metadata 提取意图分类结果
  const intentClassifyMeta = preLLMContext.metadata.intentClassify;
  const intentResult: ClassifyResult = intentClassifyMeta ? {
    intent: intentClassifyMeta.intent,
    confidence: intentClassifyMeta.confidence,
    method: intentClassifyMeta.method,
    matchedPattern: intentClassifyMeta.matchedPattern,
    p1Features: intentClassifyMeta.p1Features,
  } : { intent: 'unknown' as const, confidence: 0, method: 'p1' as const };

  logger.info('Intent classified', { intent: intentResult.intent, method: intentResult.method });

  // 5. Partner Matching 检查（找搭子追问流程）
  if (userId) {
    const partnerThreadId = conversationId || (await getOrCreateThread(userId)).id;
    const partnerMatchingState = await recoverPartnerMatchingState(partnerThreadId);

    if (partnerMatchingState) {
      const currentQuestion = getNextQuestion(partnerMatchingState);
      if (looksLikePartnerAnswer(sanitizedInput, currentQuestion)) {
        return handlePartnerMatchingFlow(request, partnerMatchingState, partnerThreadId, sanitizedInput, intentResult);
      }
    }

    if (intentResult.intent === 'partner' && shouldStartPartnerMatching('partner', partnerMatchingState)) {
      return handlePartnerMatchingFlow(request, partnerMatchingState, partnerThreadId, sanitizedInput, intentResult);
    }
  }

  // 6. 特殊意图快速响应
  if (intentResult.intent === 'chitchat') {
    return handleChitchat(trace, intentResult);
  }

  // 7. 获取工具集
  const userLocation = location ? { lat: location[1], lng: location[0] } : null;
  const tools = await resolveToolsForIntent(userId, intentResult.intent, {
    hasDraftContext: !!draftContext,
    location: userLocation,
  });
  logger.debug('Tools selected', { tools: Object.keys(tools) });

  // 8. 使用管线处理后的 systemPrompt（已包含 user-profile + semantic-recall + token-limit）
  const systemPrompt = preLLMContext.systemPrompt;

  const uiMessages: UIMessage[] = effectiveMessages.map((m, i) => ({
    id: `msg-${i}`,
    role: m.role,
    parts: toTextUIMessageParts(m),
  }));
  const aiMessages = await convertToModelMessages(uiMessages);

  // 9. 执行 LLM 推理
  const toolCallRecords: TraceStep[] = [];
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let aiResponseText = '';
  
  // 根据意图选择模型
  const intentToModelType = (intent: string): 'chat' | 'reasoning' | 'agent' => {
    switch (intent) {
      case 'partner': return 'reasoning';
      case 'create': return 'agent';
      default: return 'chat';
    }
  };
  const modelType = intentToModelType(intentResult.intent);
  const {
    model: selectedModel,
    modelId,
  } = await resolveChatModelSelection({
    intent: modelType,
    modelId: ai?.model,
  });

  const result = runStream({
    model: selectedModel,
    system: systemPrompt,
    messages: aiMessages,
    tools,
    temperature: ai?.temperature ?? 0,
    maxOutputTokens: ai?.maxTokens,
    abortSignal,
    stopWhen: [stepCountIs(5), hasToolCall('askPreference')],
    onStepFinish: (step) => {
      // 记录每一步的详细信息
      const stepNumber = toolCallRecords.length + 1;
      const stepType = getToolStepPhase(step);

      logger.debug('AI step finished', {
        stepNumber,
        stepType,
        toolCallsCount: step.toolCalls?.length || 0,
        toolResultsCount: step.toolResults?.length || 0,
        hasText: !!step.text,
        finishReason: step.finishReason,
      });

      // 收集 Tool Calls
      for (const tc of step.toolCalls || []) {
        if (!toolCallRecords.find(s => s.toolCallId === tc.toolCallId)) {
          toolCallRecords.push({
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
            args: tc.input,
          });

          // 记录 Tool 调用日志
          logger.info('Tool called', {
            stepNumber,
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
          });
        }
      }

      // 收集 Tool Results
      for (const tr of step.toolResults || []) {
        const existing = toolCallRecords.find(s => s.toolCallId === tr.toolCallId);
        if (existing) {
          existing.result = tr.output;

          // 记录 Tool 结果日志
          logger.info('Tool result received', {
            stepNumber,
            toolName: existing.toolName,
            toolCallId: tr.toolCallId,
            hasResult: tr.output !== undefined,
          });
        }
      }

      // 如果达到最大步数，记录警告
      if (stepNumber >= 5) {
        logger.warn('Max steps reached', {
          stepNumber,
          toolCalls: toolCallRecords.map(s => s.toolName),
        });
      }
    },
    onFinish: async ({ usage, text }) => {
      aiResponseText = text || '';
      // 必须 mutate 而非 reassign，因为 createTracedStreamResponse 持有同一对象引用
      totalUsage.promptTokens = usage.inputTokens ?? 0;
      totalUsage.completionTokens = usage.outputTokens ?? 0;
      totalUsage.totalTokens = usage.totalTokens ?? 0;

      const duration = Date.now() - startTime;
      logger.info('AI request completed', {
        source, userId: userId || 'anon',
        tokens: totalUsage.totalTokens,
        duration,
        intent: intentResult.intent,
      });

      // ── Post-LLM 阶段：通过管线编排 ──
      // 构建 Post-LLM context，包含 AI 响应数据和各 Processor 所需的 metadata
      const postLLMContext: ProcessorContext = {
        ...preLLMContext,
        messages: [
          ...preLLMContext.messages,
          { role: 'assistant' as const, content: text || '' },
        ],
        metadata: {
          ...preLLMContext.metadata,
          chatProtocol: 'genui_chat',
          conversationId: conversationId ?? undefined,
          activityId: getActivityIdFromTraceSteps(toolCallRecords),
          // record-metrics-processor 数据
          metricsData: {
            modelId,
            duration,
            inputTokens: totalUsage.promptTokens,
            outputTokens: totalUsage.completionTokens,
            totalTokens: totalUsage.totalTokens,
            cacheHitTokens: getCacheHitTokens(usage),
            cacheMissTokens: getCacheMissTokens(usage),
            toolCalls: toolCallRecords.map(s => ({ toolName: s.toolName })),
            source,
            intent: intentResult.intent,
            userId,
          },
          // persist-request-processor 数据
          persistData: {
            userId: userId || null,
            modelId,
            inputTokens: totalUsage.promptTokens,
            outputTokens: totalUsage.completionTokens,
            latencyMs: duration,
            processorLog: processorLogs,
            p0MatchKeyword: matchedKeywordId,
            input: rawUserInput,
            output: text || '',
          },
          // evaluate-quality-processor 数据
          qualityData: {
            rawUserInput,
            aiResponseText: text || '',
            intent: intentResult.intent,
            intentConfidence: intentResult.confidence,
            toolCallRecords: toolCallRecords.map(s => ({ toolName: s.toolName, result: s.result })),
            userId,
            inputTokens: totalUsage.promptTokens,
            outputTokens: totalUsage.completionTokens,
            totalTokens: totalUsage.totalTokens,
            latencyMs: duration,
            source,
          },
        },
      };

      if (userId) {
        // Post-LLM: output-guard（对话持久化统一在 controller 末端处理）
        const { logs: postLLMLogs } = await runPostLLMProcessors(
          [{ processor: outputGuardProcessor }],
          postLLMContext
        );
        processorLogs.push(...postLLMLogs);

        // Async: extract-preferences（火并忘，不阻塞响应）
        runAsyncProcessors(
          [{ processor: extractPreferencesProcessor }],
          postLLMContext
        ).then(({ logs: asyncLogs }) => {
          processorLogs.push(...asyncLogs);
        }).catch((err: Error) => {
          logger.warn('Async processors failed', { error: err.message });
        });
      }

      // Post-LLM: record-metrics → persist-request → evaluate-quality
      // 使用 runPostLLMProcessors 确保单个 Processor 失败不影响其他 Processor
      const { logs: postFinishLogs } = await runPostLLMProcessors(
        [
          { processor: recordMetricsProcessor },
          { processor: persistRequestProcessor },
          { processor: evaluateQualityProcessor },
        ],
        postLLMContext
      );
      processorLogs.push(...postFinishLogs);
    },
  });

  // 10. 返回响应
  if (!trace) {
    return result.toUIMessageStreamResponse();
  }

  return createTracedStreamResponse(result, {
    requestId: randomUUID(),
    startedAt: new Date().toISOString(),
    intent: intentResult,
    systemPrompt,
    tools,
    toolCallRecords,
    totalUsage,
    aiResponseText,
    rawUserInput,
    source,
    userId: userId || null,
    modelId,
    // Processor 数据（从 ProcessorContext.metadata 读取）
    preLLMContext,
    inputGuard: {
      duration: initialGuardResult.executionTime,
      blocked: false,
      sanitized: sanitizedInput,
      triggeredRules: [],
    },
    keywordMatch: {
      matched: keywordMeta?.matched ?? false,
      keyword: keywordMeta?.keyword,
      matchType: keywordMeta?.matchType,
      priority: keywordMeta?.priority,
      responseType: keywordMeta?.responseType,
      duration: keywordResult.executionTime,
    },
    processorLogs,
  });
  });
}

// ==========================================
// 辅助函数
// ==========================================

function createDirectResponse(text: string, trace?: boolean): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-delta', delta: text, id: randomUUID() });
      if (trace) {
        const now = new Date().toISOString();
        writeTraceStartEvent(writer, {
          requestId: randomUUID(),
          startedAt: now,
          intent: 'blocked',
          intentMethod: 'guardrail',
        });
        writeTraceEndEvent(writer, {
          completedAt: now,
          status: 'blocked',
          output: { text, toolCalls: [] },
        });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/**
 * 创建关键词匹配响应 (P0 层)
 * 直接返回预设响应，无需 LLM 处理
 */
async function createKeywordResponse(
  keyword: import('../hot-keywords/hot-keywords.model').GlobalKeywordResponse, 
  trace: boolean | undefined
): Promise<Response> {
  const keywordContext = {
    keywordId: keyword.id,
    matchedAt: new Date().toISOString(),
  };
  
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      // 返回 widget 数据
      writeWidgetEvent(writer, {
        type: keyword.responseType,
        payload: keyword.responseContent,
        keywordContext,
      });
      
      // 如果是文本类型，返回文本内容
      if (keyword.responseType === 'text' && typeof keyword.responseContent === 'string') {
        writer.write({ type: 'text-delta', delta: keyword.responseContent, id: randomUUID() });
      }
      
      if (trace) {
        const now = new Date().toISOString();
        writeTraceStartEvent(writer, {
          requestId: randomUUID(),
          startedAt: now,
          intent: 'keyword_match',
          intentMethod: 'p0_layer',
          keyword: keyword.keyword,
          matchType: keyword.matchType,
        });
        writeTraceEndEvent(writer, {
          completedAt: now,
          status: 'completed',
          output: {
            keywordId: keyword.id,
            responseType: keyword.responseType,
          },
        });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/**
 * 创建 Structured Action 响应
 * 直接返回动作执行结果，不经过 LLM
 */
function createStructuredActionResponse(
  result: import('./user-action').StructuredActionResult,
  trace?: boolean,
  structuredAction?: StructuredAction
): Response {
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
  const shouldWritePrimaryText = !authRequiredPayload && !successWidgetPayload;
  const nextActions = buildNextBestActions({ actionType, data });
  const actionDurationMs = typeof result.durationMs === 'number' && Number.isFinite(result.durationMs)
    ? Math.max(0, result.durationMs)
    : 0;
  const traceCompletedAtMs = Date.now();
  const traceStartedAtMs = traceCompletedAtMs - actionDurationMs;
  const traceStartedAt = new Date(traceStartedAtMs).toISOString();
  const traceCompletedAt = new Date(traceCompletedAtMs).toISOString();
  const requestId = randomUUID();
  const structuredIntent = inferIntentFromStructuredAction(actionType);
  const activityId = typeof data?.activityId === 'string' ? data.activityId : null;

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      if (trace) {
        writeTraceStartEvent(writer, {
          requestId,
          startedAt: traceStartedAt,
          intent: structuredIntent,
          intentMethod: 'structured_action',
          executionPath: 'structured_action',
        });

        writeTraceStepEvent(writer, {
          id: `${requestId}-structured_action_resolved`,
          type: 'structured-action',
          name: '结构化动作判定',
          startedAt: traceStartedAt,
          completedAt: traceStartedAt,
          status: 'success',
          duration: 0,
          data: {
            phase: 'resolved',
            action: actionType,
            source: structuredAction?.source || 'structured_action',
            executionPath: 'structured_action',
          },
        });

        writeTraceStepEvent(writer, {
          id: `${requestId}-structured_action_executed`,
          type: 'structured-action',
          name: '结构化动作执行',
          startedAt: traceStartedAt,
          completedAt: traceCompletedAt,
          status: result.success ? 'success' : 'error',
          duration: actionDurationMs,
          data: {
            phase: 'executed',
            action: actionType,
            success: result.success,
            fallbackToLLM: result.fallbackToLLM === true,
            ...(activityId ? { activityId } : {}),
          },
          ...(result.error ? { error: result.error } : {}),
        });
      }

      // 返回 action 结果作为 data
      writeWidgetEvent(writer, {
        type: 'action_result',
        success: result.success,
        data: result.data,
        error: result.error,
        nextActions,
      });

      if (explorePayload) {
        writeWidgetEvent(writer, {
          type: 'widget_explore',
          payload: explorePayload,
        });
      }

      if (data?.askPreference && typeof data.askPreference === 'object') {
        writeWidgetEvent(writer, {
          type: 'widget_ask_preference',
          payload: data.askPreference,
        });
      }

      if (data?.partnerIntentForm && typeof data.partnerIntentForm === 'object') {
        writeWidgetEvent(writer, {
          type: 'widget_partner_intent_form',
          payload: data.partnerIntentForm,
        });
      }

      if (data?.draftSettingsForm && typeof data.draftSettingsForm === 'object') {
        writeWidgetEvent(writer, {
          type: 'widget_draft_settings_form',
          payload: data.draftSettingsForm,
        });
      }

      if (data?.draft && typeof data.draft === 'object') {
        writeWidgetEvent(writer, {
          type: 'widget_draft',
          payload: {
            ...(typeof data.activityId === 'string' ? { activityId: data.activityId } : {}),
            ...data.draft,
          },
        });
      }

      if (authRequiredPayload) {
        writeWidgetEvent(writer, {
          type: 'widget_auth_required',
          payload: authRequiredPayload,
        });
      }

      if (successWidgetPayload) {
        writeWidgetEvent(writer, {
          type: 'widget_success',
          payload: successWidgetPayload,
        });
      }

      if (shouldWritePrimaryText && actionMessage) {
        writer.write({ type: 'text-delta', delta: actionMessage, id: randomUUID() });
      }
      
      if (trace) {
        writeTraceStepEvent(writer, {
          id: `${requestId}-output`,
          type: 'output',
          name: '输出',
          startedAt: traceCompletedAt,
          completedAt: traceCompletedAt,
          status: result.success ? 'success' : 'error',
          duration: 0,
          data: {
            text: actionMessage,
            executionPath: 'structured_action',
            structuredAction: actionType,
          },
        });

        writeTraceEndEvent(writer, {
          requestId,
          completedAt: traceCompletedAt,
          totalDuration: actionDurationMs,
          status: result.success ? 'completed' : 'failed',
          executionPath: 'structured_action',
          output: {
            text: actionMessage,
            structuredAction: actionType,
            success: result.success,
            ...(activityId ? { activityId } : {}),
          },
        });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}


function handleChitchat(trace: boolean | undefined, _intent: ClassifyResult): Response {
  const responses = [
    '哈哈，我只会帮你组局约人，闲聊就不太行了～想约点什么？',
    '聊天我不太擅长，但组局我很在行！想找人一起玩点什么？',
    '我是组局小助手，帮你约人才是我的强项～有什么想玩的吗？',
  ];
  const text = responses[Math.floor(Math.random() * responses.length)];

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-delta', delta: text, id: randomUUID() });
      if (trace) {
        const now = new Date().toISOString();
        writeTraceStartEvent(writer, {
          requestId: randomUUID(),
          startedAt: now,
          intent: _intent.intent,
          intentMethod: _intent.method,
        });
        writeTraceEndEvent(writer, {
          completedAt: now,
          status: 'completed',
          output: { text, toolCalls: [] },
        });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/**
 * 处理 Partner Matching 流程（找搭子追问）
 */
async function handlePartnerMatchingFlow(
  request: ChatRequest,
  existingState: PartnerMatchingState | null,
  threadId: string,
  userMessage: string,
  _intentResult: ClassifyResult
): Promise<Response> {
  const { userId, trace, location } = request;
  const userLocation = location ? { lat: location[1], lng: location[0] } : null;

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
      logger.debug('Partner matching state updated', { field: answer.field, value: answer.value });
    }
  }

  const nextQuestion = getNextQuestion(state);

  if (!nextQuestion) {
    const completedState: PartnerMatchingState = {
      ...state,
      status: 'completed',
      updatedAt: new Date(),
    };

    const fallbackLocationHint = completedState.collectedPreferences.location?.trim()
      || (userLocation ? await reverseGeocode(userLocation.lat, userLocation.lng) : '附近');
    const partnerIntentParams = buildPartnerIntentPayload(completedState, fallbackLocationHint);
    const partnerResult = await createPartnerIntent(userId, userLocation, partnerIntentParams);

    logger.info('Partner workflow completed', {
      userId,
      activityType: partnerIntentParams.activityType,
      matchFound: partnerResult.success ? partnerResult.matchFound : false,
      success: partnerResult.success,
    });

    if (userId) {
      await persistPartnerMatchingState(threadId, userId, completedState);
    }

    const summaryLines = [
      '📋 需求确认：',
      `- 🎯 活动类型：${getPartnerActivityTypeLabel(partnerIntentParams.activityType)}`,
      `- ⏰ 时间：${partnerIntentParams.timePreference || getPartnerTimeLabel(completedState.collectedPreferences.timeRange)}`,
      `- 📍 地点：${partnerIntentParams.locationHint}`,
    ];

    const statusText = partnerResult.success
      ? partnerResult.matchFound
        ? '🎉 已经给你拉到一组待确认搭子，等临时召集人点头就能成局。'
        : '已帮你进入匹配池，有合适的人我会第一时间叫你。'
      : partnerResult.error;

    const confirmText = `${summaryLines.join('\n')}\n\n${statusText}`;
    const traceToolCalls = [{ name: 'createPartnerIntent', input: partnerIntentParams, output: partnerResult }];

    const exploreParams: Record<string, unknown> = {
      locationName: partnerIntentParams.locationHint,
      type: partnerIntentParams.activityType,
    };

    const widgetOptions = partnerResult.success
      ? [
          {
            label: '看看附近同类局',
            value: 'explore_similar',
            action: 'explore_nearby',
            params: exploreParams,
          },
          partnerResult.matchFound
            ? {
                label: '看看我的搭子进展',
                value: 'review_partner_status',
                action: 'quick_prompt',
                params: { prompt: '看看我的搭子进度' },
              }
            : {
                label: '继续补充偏好',
                value: 'refine_preference',
                action: 'quick_prompt',
                params: { prompt: '我想再补充一下偏好' },
              },
        ]
      : [];

    const widgetQuestion = partnerResult.success && partnerResult.matchFound
      ? '匹配进度 2/2：已经帮你凑到一组人，接下来你想做什么？'
      : '匹配进度 2/2：已进入匹配池，接下来你想做什么？';

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'text-delta', delta: confirmText, id: randomUUID() });

        if (widgetOptions.length > 0) {
          writeWidgetEvent(writer, {
            type: 'widget_ask_preference',
            payload: {
              status: 'completed',
              preferences: completedState.collectedPreferences,
              questionType: 'result',
              question: widgetQuestion,
              options: widgetOptions,
            },
          });
        }

        if (trace) {
          const now = new Date().toISOString();
          writeTraceStartEvent(writer, {
            requestId: randomUUID(),
            startedAt: now,
            intent: 'partner',
            intentMethod: 'partner_matching',
          });
          writeTraceEndEvent(writer, {
            completedAt: now,
            status: 'completed',
            output: { text: confirmText, toolCalls: traceToolCalls },
          });
        }
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  if (userId) {
    await persistPartnerMatchingState(threadId, userId, state);
  }

  const fallbackLocationHint = state.collectedPreferences.location?.trim()
    || (userLocation ? await reverseGeocode(userLocation.lat, userLocation.lng) : '附近');
  const formPayload = buildPartnerIntentFormPayload({
    state,
    fallbackLocationHint,
  });
  const introText = '附近还没有合适的人选，填一下偏好，我帮你找找有没有同意向的人。';
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-delta', delta: introText, id: randomUUID() });
      writeWidgetEvent(writer, {
        type: 'widget_partner_intent_form',
        payload: formPayload,
      });
      if (trace) {
        const now = new Date().toISOString();
        writeTraceStartEvent(writer, {
          requestId: randomUUID(),
          startedAt: now,
          intent: 'partner',
          intentMethod: 'partner_matching',
        });
        writeTraceEndEvent(writer, {
          completedAt: now,
          status: 'collecting',
          output: { text: introText, toolCalls: [] },
        });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

// @ts-ignore - 保留以备将来使用
async function _persistConversation(
  userId: string,
  userMessage: string,
  assistantResponse: string,
  toolCalls: TraceStep[]
) {
  try {
    const { id: threadId } = await getOrCreateThread(userId);

    if (userMessage) {
      await saveMessage({ conversationId: threadId, userId, role: 'user', messageType: 'text', content: { text: userMessage } });
    }

    const activityId = getActivityIdFromTraceSteps(toolCalls);
    let messageType: typeof conversationMessages.$inferSelect.messageType = 'text';
    if (toolCalls.length > 0) {
      const widgetType = getToolWidgetType(toolCalls[toolCalls.length - 1].toolName);
      if (widgetType && isConversationMessageType(widgetType)) {
        messageType = widgetType;
      }
    }

    await saveMessage({
      conversationId: threadId,
      userId,
      role: 'assistant',
      messageType,
      content: { text: assistantResponse, toolCalls: toolCalls.map(tc => ({ toolName: tc.toolName, args: tc.args, result: tc.result })) },
      ...(activityId ? { activityId } : {}),
    });
  } catch (error) {
    console.error('[AI] Failed to save conversation:', error);
  }
}

function createTracedStreamResponse(result: ReturnType<typeof runStream>, ctx: {
  requestId: string;
  startedAt: string;
  intent: ClassifyResult;
  systemPrompt: string;
  tools: Record<string, unknown>;
  toolCallRecords: TraceStep[];
  totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  aiResponseText: string;
  rawUserInput: string;
  source: string;
  userId: string | null;
  modelId: string;
  // Pre-LLM 管线上下文（从 metadata 读取各处理器数据）
  preLLMContext: ProcessorContext;
  // 独立于管线的 Processor 数据（管线外执行，无法从 metadata 获取）
  inputGuard?: {
    duration: number;
    blocked: boolean;
    sanitized: string;
    triggeredRules?: string[];
  };
  keywordMatch?: {
    matched: boolean;
    keyword?: string;
    matchType?: string;
    priority?: number;
    responseType?: string;
    duration: number;
  };
  // processorLogs 仅用于获取执行时间（metadata 不存储 duration）
  processorLogs: import('./processors/types').ProcessorLogEntry[];
}): Response {
  const llmStartedAt = new Date().toISOString();
  const llmStepId = `step-llm`;

  // 从 ProcessorContext.metadata 读取各处理器数据
  const { metadata } = ctx.preLLMContext;
  const intentClassifyMeta = metadata.intentClassify;
  const userProfileMeta = metadata.userProfile;
  const semanticRecallMeta = metadata.semanticRecall;

  // 辅助函数：从 processorLogs 获取执行时间
  const getLogDuration = (name: string) => ctx.processorLogs.find(l => l.processorName === name)?.executionTime ?? 0;
  const getLogData = (name: string) => ctx.processorLogs.find(l => l.processorName === name)?.data;

  const toolsInfo = Object.entries(ctx.tools).map(([name, tool]) => {
    const toolRecord = asRecord(tool);
    return {
      name,
      description: typeof toolRecord?.description === 'string' ? toolRecord.description : '',
      schema: extractToolSchema(tool),
    };
  });

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({
        type: 'data-trace-start',
        data: { requestId: ctx.requestId, startedAt: ctx.startedAt, systemPrompt: ctx.systemPrompt, tools: toolsInfo, intent: ctx.intent.intent, intentMethod: ctx.intent.method },
        transient: true,
      });

      writer.write({
        type: 'data-trace-step',
        data: { id: `${ctx.requestId}-input`, type: 'input', name: '用户输入', startedAt: ctx.startedAt, completedAt: ctx.startedAt, status: 'success', duration: 0, data: { text: ctx.rawUserInput, source: ctx.source, userId: ctx.userId } },
        transient: true,
      });

      // Input Guard Processor trace
      if (ctx.inputGuard) {
        const guardCompletedAt = new Date(new Date(ctx.startedAt).getTime() + ctx.inputGuard.duration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-input-guard`,
            type: 'processor',
            name: 'Input Guard',
            startedAt: ctx.startedAt,
            completedAt: guardCompletedAt,
            status: 'success',
            duration: ctx.inputGuard.duration,
            data: {
              processorType: 'input-guard',
              output: {
                blocked: ctx.inputGuard.blocked,
                sanitized: ctx.inputGuard.sanitized,
                triggeredRules: ctx.inputGuard.triggeredRules || [],
              },
              config: { maxLength: 500, enabled: true },
            },
          },
          transient: true,
        });
      }

      // P0 关键词匹配 (Keyword Match) trace
      if (ctx.keywordMatch) {
        const keywordMatchCompletedAt = new Date(new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + ctx.keywordMatch.duration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-keyword-match`,
            type: 'keyword-match',
            name: 'P0: 关键词匹配',
            startedAt: new Date(new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0)).toISOString(),
            completedAt: keywordMatchCompletedAt,
            status: 'success',
            duration: ctx.keywordMatch.duration,
            data: {
              matched: ctx.keywordMatch.matched,
              keyword: ctx.keywordMatch.keyword,
              matchType: ctx.keywordMatch.matchType,
              priority: ctx.keywordMatch.priority,
              responseType: ctx.keywordMatch.responseType,
            },
          },
          transient: true,
        });
      }

      // 意图分类 (Intent Classify) trace - 从 metadata 读取
      if (intentClassifyMeta) {
        const intentDuration = getLogDuration('intent-classify-processor');
        const intentClassifyStartTime = new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + (ctx.keywordMatch?.duration || 0);
        const intentClassifyCompletedAt = new Date(intentClassifyStartTime + intentDuration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-intent-classify`,
            type: 'intent-classify',
            name: 'P1: 意图识别',
            startedAt: new Date(intentClassifyStartTime).toISOString(),
            completedAt: intentClassifyCompletedAt,
            status: 'success',
            duration: intentDuration,
            data: {
              intent: intentClassifyMeta.intent,
              method: intentClassifyMeta.method,
              confidence: intentClassifyMeta.confidence,
            },
          },
          transient: true,
        });
      }

      // User Profile Processor trace - 从 metadata 读取
      if (userProfileMeta) {
        const profileDuration = getLogDuration('user-profile-processor');
        const intentDuration = getLogDuration('intent-classify-processor');
        const profileStartTime = new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + (ctx.keywordMatch?.duration || 0) + intentDuration;
        const profileCompletedAt = new Date(profileStartTime + profileDuration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-user-profile`,
            type: 'processor',
            name: 'User Profile',
            startedAt: new Date(profileStartTime).toISOString(),
            completedAt: profileCompletedAt,
            status: 'success',
            duration: profileDuration,
            data: {
              processorType: 'user-profile',
              output: userProfileMeta.hasProfile ? {
                preferencesCount: userProfileMeta.preferencesCount || 0,
                topPreferences: userProfileMeta.topPreferences || [],
              } : {},
              config: { enabled: true },
            },
          },
          transient: true,
        });
      }

      // Semantic Recall Processor trace - 从 metadata 读取
      if (semanticRecallMeta) {
        const recallDuration = getLogDuration('semantic-recall-processor');
        const intentDuration = getLogDuration('intent-classify-processor');
        const profileDuration = getLogDuration('user-profile-processor');
        const recallStartTime = new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + (ctx.keywordMatch?.duration || 0) + intentDuration + profileDuration;
        const recallCompletedAt = new Date(recallStartTime + recallDuration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-semantic-recall`,
            type: 'processor',
            name: 'Semantic Recall',
            startedAt: new Date(recallStartTime).toISOString(),
            completedAt: recallCompletedAt,
            status: 'success',
            duration: recallDuration,
            data: {
              processorType: 'semantic-recall',
              output: {
                query: ctx.preLLMContext.userInput || '',
                resultCount: semanticRecallMeta.resultsCount || 0,
                topScore: semanticRecallMeta.avgSimilarity || 0,
              },
              config: { enabled: true },
            },
          },
          transient: true,
        });
      }

      // Token Limit Processor trace - 从 processorLogs.data 读取（token-limit 不写 metadata）
      const tokenLimitData = getLogData('token-limit-processor');
      if (tokenLimitData) {
        const tokenDuration = getLogDuration('token-limit-processor');
        const intentDuration = getLogDuration('intent-classify-processor');
        const profileDuration = getLogDuration('user-profile-processor');
        const recallDuration = getLogDuration('semantic-recall-processor');
        const tokenStartTime = new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + (ctx.keywordMatch?.duration || 0) + intentDuration + profileDuration + recallDuration;
        const tokenCompletedAt = new Date(tokenStartTime + tokenDuration).toISOString();
        const tokenSnapshot = getTokenLimitSnapshot(tokenLimitData);
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-token-limit`,
            type: 'processor',
            name: 'Token Limit',
            startedAt: new Date(tokenStartTime).toISOString(),
            completedAt: tokenCompletedAt,
            status: 'success',
            duration: tokenDuration,
            data: {
              processorType: 'token-limit',
              output: {
                truncated: tokenSnapshot.truncated,
                originalLength: tokenSnapshot.originalLength,
                finalLength: tokenSnapshot.finalLength,
              },
              config: { maxTokens: 12000, enabled: true },
            },
          },
          transient: true,
        });
      }

      writer.write({
        type: 'data-trace-step',
        data: { id: llmStepId, type: 'llm', name: 'LLM 推理', startedAt: llmStartedAt, status: 'running', data: { model: ctx.modelId, inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
        transient: true,
      });

      writer.merge(result.toUIMessageStream({
        onFinish: async () => {
          const llmCompletedAt = new Date().toISOString();
          const llmDuration = new Date(llmCompletedAt).getTime() - new Date(llmStartedAt).getTime();

          // 直接从 streamText result 获取 usage，避免依赖 onFinish 回调的执行顺序
          const usage = await result.usage;
          const inputTokens = usage?.inputTokens ?? ctx.totalUsage.promptTokens;
          const outputTokens = usage?.outputTokens ?? ctx.totalUsage.completionTokens;
          const totalTokens = (inputTokens + outputTokens) || ctx.totalUsage.totalTokens;

          writer.write({
            type: 'data-trace-step-update',
            data: { stepId: llmStepId, completedAt: llmCompletedAt, status: 'success', duration: llmDuration, data: { model: ctx.modelId, inputTokens, outputTokens, totalTokens } },
            transient: true,
          });

          for (const step of ctx.toolCallRecords) {
            writer.write({
              type: 'data-trace-step',
              data: { id: `${ctx.requestId}-tool-${step.toolCallId}`, type: 'tool', name: getToolDisplayName(step.toolName), startedAt: llmCompletedAt, completedAt: llmCompletedAt, status: 'success', duration: 0, data: { toolName: step.toolName, toolDisplayName: getToolDisplayName(step.toolName), input: step.args, output: step.result, widgetType: getToolWidgetType(step.toolName) } },
              transient: true,
            });
          }

          const completedAt = new Date().toISOString();
          const totalDuration = new Date(completedAt).getTime() - new Date(ctx.startedAt).getTime();

          // Output step
          writer.write({
            type: 'data-trace-step',
            data: { id: `${ctx.requestId}-output`, type: 'output', name: '输出', startedAt: llmCompletedAt, completedAt, status: 'success', duration: totalDuration, data: { text: ctx.aiResponseText || '', toolCallCount: ctx.toolCallRecords.length, totalDuration, totalTokens } },
            transient: true,
          });

          writer.write({
            type: 'data-trace-end',
            data: { requestId: ctx.requestId, completedAt, totalDuration, status: 'completed', output: { text: ctx.aiResponseText || null, toolCalls: ctx.toolCallRecords.map(s => ({ name: s.toolName, input: s.args, output: s.result })) } },
            transient: true,
          });
        },
      }));
    },
  });

  return createUIMessageStreamResponse({ stream });
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
    .where(eq(conversationMessages.conversationId, conversationId))
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
      return '下一步操作';
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
  params?: { turnId?: string; traceId?: string }
): {
  messageType: ConversationMessageRecord['messageType'];
  content: Record<string, unknown>;
} | null {
  if (blocks.length === 0) {
    return null;
  }

  const text = summarizeAssistantBlocks(blocks);
  const turnContext = buildTurnContextFromBlocks(blocks);

  return {
    messageType: resolveAssistantMessageTypeFromBlocks(blocks),
    content: {
      ...(text ? { text } : {}),
      primaryBlockType: resolvePrimaryBlockType(blocks),
      ...(turnContext ? { turnContext } : {}),
      blocks,
      turn: {
        ...(params?.turnId ? { turnId: params.turnId } : {}),
        ...(params?.traceId ? { traceId: params.traceId } : {}),
        status: 'completed',
        primaryBlockType: resolvePrimaryBlockType(blocks),
        ...(turnContext ? { turnContext } : {}),
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

export async function syncConversationTurnSnapshot(params: {
  conversationId: string;
  userId: string;
  userText?: string;
  blocks: GenUIBlock[];
  turnId?: string;
  traceId?: string;
  inputType?: 'text' | 'action';
  resolvedStructuredAction?: StructuredAction;
  activityId?: string;
}) {
  const assistantRecord = buildAssistantConversationSnapshot(params.blocks, {
    turnId: params.turnId,
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
    .where(eq(conversationMessages.conversationId, params.conversationId))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(4);

  const existingAssistantForTurn = params.turnId
    ? recentMessages.find((message) => {
      if (message.role !== 'assistant' || !isRecord(message.content)) {
        return false;
      }

      const turn = isRecord(message.content.turn) ? message.content.turn : null;
      return turn?.turnId === params.turnId;
    })
    : undefined;

  if (existingAssistantForTurn) {
    await db
      .update(conversationMessages)
      .set({
        messageType: assistantRecord.messageType,
        content: assistantRecord.content,
        activityId: resolvedActivityId ?? null,
        taskId: resolvedTaskId ?? null,
        embedding: null,
      })
      .where(eq(conversationMessages.id, existingAssistantForTurn.id));

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
      content: userRecord.content,
      ...(resolvedTaskId ? { taskId: resolvedTaskId } : {}),
    });
  }

  await saveMessage({
    conversationId: params.conversationId,
    userId: params.userId,
    role: 'assistant',
    messageType: assistantRecord.messageType,
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

export async function getOrCreateCurrentConversation(userId: string) {
  return getOrCreateThread(userId);
}

export async function addMessageToConversation(params: {
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  messageType: ConversationMessageRecord['messageType'];
  content: unknown;
}) {
  return saveMessage({
    conversationId: params.conversationId,
    userId: params.userId,
    role: params.role,
    messageType: params.messageType,
    content: params.content,
  });
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
  icon: string;
  title: string;
  items: Array<{
    type: 'draft' | 'suggestion' | 'explore';
    icon?: string;
    label: string;
    prompt: string;
    context?: unknown;
  }>;
}

// 社交档案 (v4.4 新增)
export interface SocialProfile {
  participationCount: number;
  activitiesCreatedCount: number;
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
}

export interface WelcomeResponse {
  greeting: string;
  subGreeting?: string;
  sections: WelcomeSection[];
  socialProfile?: SocialProfile | undefined;
  pendingActivities?: WelcomePendingActivity[] | undefined;
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
    icon: string;
    label: string;
    prompt: string;
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
    { icon: '🍜', label: '约饭局', prompt: '帮我组一个吃饭的局' },
    { icon: '🎮', label: '打游戏', prompt: '想找人一起打游戏' },
    { icon: '🏃', label: '运动', prompt: '想找人一起运动' },
    { icon: '☕', label: '喝咖啡', prompt: '想约人喝咖啡聊天' },
  ],
  quickPrompts: [
    { icon: '🗓️', text: '周末附近有什么活动？', prompt: '周末附近有什么活动' },
    { icon: '🤝', text: '帮我找个运动搭子', prompt: '帮我找个运动搭子' },
    { icon: '🎉', text: '想组个周五晚的局', prompt: '想组个周五晚的局' },
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

        const icon = getNonEmptyString(item.icon);
        const label = getNonEmptyString(item.label);
        const prompt = getNonEmptyString(item.prompt);
        if (!icon || !label || !prompt) {
          return null;
        }

        return {
          icon,
          label,
          prompt,
        };
      })
      .filter((item): item is { icon: string; label: string; prompt: string } => Boolean(item?.label && item.prompt))
    : [];

  const quickPrompts = Array.isArray(raw.quickPrompts)
    ? raw.quickPrompts
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const icon = getNonEmptyString(item.icon);
        const text = getNonEmptyString(item.text);
        const prompt = getNonEmptyString(item.prompt);
        if (!icon || !text || !prompt) {
          return null;
        }

        return {
          icon,
          text,
          prompt,
        };
      })
      .filter((item): item is QuickPrompt => Boolean(item?.text && item.prompt))
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

function parseWorkingMemorySummary(rawMemory: string | null): {
  preferencesCount: number;
  locationsCount: number;
} {
  if (!rawMemory) {
    return { preferencesCount: 0, locationsCount: 0 };
  }

  try {
    const parsed: unknown = JSON.parse(rawMemory);
    if (!isRecord(parsed)) {
      return { preferencesCount: 0, locationsCount: 0 };
    }

    return {
      preferencesCount: Array.isArray(parsed.preferences) ? parsed.preferences.length : 0,
      locationsCount: Array.isArray(parsed.frequentLocations) ? parsed.frequentLocations.length : 0,
    };
  } catch {
    return { preferencesCount: 0, locationsCount: 0 };
  }
}

function clampWelcomeTitle(title: string, maxLength = 12): string {
  const normalized = title.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1))}…`;
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
  let socialProfile: { participationCount: number; activitiesCreatedCount: number; preferenceCompleteness: number } | undefined;
  let pendingActivities: WelcomePendingActivity[] = [];
  let hasDraftActivity = false;

  if (userId) {
    const [user] = await db
      .select({
        participationCount: users.participationCount,
        activitiesCreatedCount: users.activitiesCreatedCount,
        workingMemory: users.workingMemory,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user) {
      const { preferencesCount, locationsCount } = parseWorkingMemorySummary(user.workingMemory);
      const preferenceCompleteness = Math.min(100, preferencesCount * 15 + locationsCount * 10);

      socialProfile = {
        participationCount: user.participationCount,
        activitiesCreatedCount: user.activitiesCreatedCount,
        preferenceCompleteness,
      };
    }

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
        icon: '📝',
        title: '继续上次草稿',
        items: [
          {
            type: 'draft',
            icon: '✍️',
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
    icon: '💡',
    title: welcomeUi.sectionTitles.suggestions,
    items: welcomeUi.suggestionItems.map((item) => ({
      type: 'suggestion' as const,
      icon: item.icon,
      label: item.label,
      prompt: item.prompt,
    })),
  };
  sections.push(suggestions);

  // 探索附近（有位置时显示）
  if (location) {
    const locationName = await reverseGeocode(location.lat, location.lng);
    const explore: WelcomeSection = {
      id: 'explore',
      icon: '📍',
      title: welcomeUi.sectionTitles.explore,
      items: [
        {
          type: 'explore',
          icon: '🔍',
          label: renderTemplate(welcomeUi.exploreTemplates.label, { locationName, location: locationName }),
          prompt: renderTemplate(welcomeUi.exploreTemplates.prompt, { locationName, location: locationName }),
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
  const quickPrompts = hasDraftActivity ? [] : welcomeUi.quickPrompts;

  return {
    greeting,
    subGreeting,
    sections,
    socialProfile,
    pendingActivities,
    quickPrompts,
    ui: {
      composerPlaceholder: welcomeUi.composerPlaceholder,
      bottomQuickActions: welcomeUi.bottomQuickActions,
      profileHints: welcomeUi.profileHints,
    },
  };
}


// ==========================================
// AI 内容生成 (从 Growth 迁移)
// ==========================================

import { jsonSchema } from 'ai';
import { t } from 'elysia';
import { toJsonSchema } from '@juchang/utils';
import { getQwenModelByIntent } from './models/adapters/qwen';
import type { ContentGenerationRequest, ContentGenerationResponse } from './ai.model';

// AI 输出 Schema
const NoteOutputSchema = t.Object({
  title: t.String({ description: '标题，不超过20字，含emoji' }),
  body: t.String({ description: '正文300-800字，分段结构，含emoji排版' }),
  hashtags: t.Array(t.String(), { description: '5-10个话题标签' }),
  coverImageHint: t.String({ description: '封面图片描述提示' }),
});
type NoteOutput = typeof NoteOutputSchema.static;

// 默认 Prompt 模板
const DEFAULT_SYSTEM_PROMPT = `你是"搭子观察员"，一个热爱重庆生活、擅长记录搭子故事的小红书博主。
你的风格：接地气、温暖、真实分享，像朋友聊天一样自然。
绝对禁止：营销腔、广告感、生硬推销。`;

const DEFAULT_CONTENT_PROMPT = `请为以下主题生成一篇小红书笔记：

主题：{topic}
内容类型：{contentType}

要求：
1. 标题：不超过20字，包含吸引点击的emoji和关键词
2. 正文：300-800字，分段结构（开头hook + 正文内容 + 引导互动结尾），包含适量emoji排版
3. 话题标签：5-10个，混合热门大标签和精准小标签
4. 封面图片描述：描述适合这篇笔记的封面图片风格和内容
5. 在正文末尾自然植入引导语（如"评论区聊聊"、"想加群的扣1"）
6. 使用"搭子观察员"第三人称叙事视角`;

/**
 * AI 生成内容（文案/笔记）
 * 从 Growth 模块迁移，统一归到 AI 领域
 */
export async function generateContent(
  request: ContentGenerationRequest
): Promise<ContentGenerationResponse> {
  const { topic, contentType, style, trendKeywords, count = 1 } = request;
  const batchId = crypto.randomUUID();

  const results = [];
  const generatedTitles: string[] = [];

  for (let i = 0; i < count; i++) {
    // 构建 Prompt
    let contentPrompt = DEFAULT_CONTENT_PROMPT
      .replace('{topic}', topic)
      .replace('{contentType}', contentType);

    // 趋势关键词注入
    if (trendKeywords && trendKeywords.length > 0) {
      contentPrompt += `\n\n当前热门关键词：${trendKeywords.join('、')}，请适当融入内容中。`;
    }

    // 风格提示
    if (style) {
      const styleHints: Record<string, string> = {
        'minimal': '风格要求：极简、干净、留白多',
        'cyberpunk': '风格要求：赛博朋克、未来感、霓虹色调',
        'handwritten': '风格要求：手写风、温暖、亲切',
        'xiaohongshu': '风格要求：小红书热门风格、精致生活',
        'casual': '风格要求： casual、随意、轻松',
        'professional': '风格要求：专业、简洁、高效',
      };
      if (styleHints[style]) {
        contentPrompt += `\n\n${styleHints[style]}`;
      }
    }

    // 避免重复
    if (generatedTitles.length > 0) {
      contentPrompt += `\n\n注意：以下标题已被使用，请确保你的标题与它们完全不同：\n${generatedTitles.map(t => `- ${t}`).join('\n')}`;
    }

    const fullPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${contentPrompt}`;

    const result = await runObject<NoteOutput>({
      model: getQwenModelByIntent('chat'),
      schema: jsonSchema<NoteOutput>(toJsonSchema(NoteOutputSchema)),
      prompt: fullPrompt,
    });

    generatedTitles.push(result.object.title);

    results.push({
      title: result.object.title,
      body: result.object.body,
      hashtags: result.object.hashtags,
      coverImageHint: result.object.coverImageHint,
    });
  }

  return {
    items: results,
    batchId,
  };
}

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

import { db, users, conversations, conversationMessages, eq, desc, sql, inArray, and } from '@juchang/db';
import {
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  stepCountIs,
  hasToolCall,
  type UIMessage,
} from 'ai';
import { randomUUID } from 'crypto';
import type { ProcessorLogEntry } from '@juchang/db';

// 新架构模块
import { type ClassifyResult } from './intent';
import { getOrCreateThread, saveMessage, clearUserThreads, deleteThread } from './memory';
import { resolveToolsForIntent, getToolWidgetType, getToolDisplayName } from './tools';
import { getSystemPrompt, type PromptContext, type ActivityDraftForPrompt } from './prompts';
import { getModelByIntent } from './models/router';
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
  saveHistoryProcessor,
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
  persistPartnerMatchingState,
  type PartnerMatchingState,
} from './workflow/partner-matching';
// User Action — A2UI (Action-to-UI: 结构化用户操作直接映射为 UI 响应)
import { handleUserAction, type UserAction } from './user-action';
import { getConfigValue } from './config/config.service';

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
  modelParams?: { temperature?: number; maxTokens?: number };
  /** A2UI：结构化用户操作，跳过 LLM 意图识别直接执行 */
  userAction?: UserAction;
}

export interface TraceStep {
  toolName: string;
  toolCallId: string;
  args: unknown;
  result?: unknown;
}

// ==========================================
// AI 额度管理
// ==========================================

export async function checkAIQuota(userId: string): Promise<{ hasQuota: boolean; remaining: number }> {
  const [user] = await db
    .select({ aiCreateQuotaToday: users.aiCreateQuotaToday })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return { hasQuota: false, remaining: 0 };
  return { hasQuota: user.aiCreateQuotaToday > 0, remaining: user.aiCreateQuotaToday };
}

export async function consumeAIQuota(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ aiCreateQuotaToday: users.aiCreateQuotaToday })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.aiCreateQuotaToday <= 0) return false;

  await db.update(users)
    .set({ aiCreateQuotaToday: user.aiCreateQuotaToday - 1 })
    .where(eq(users.id, userId));
  return true;
}

// ==========================================
// AI Chat 核心
// ==========================================

export async function handleChatStream(request: ChatRequest): Promise<Response> {
  return runWithTrace(async () => {
  const { messages, userId, rateLimitUserId, conversationId, location, source, draftContext, trace, modelParams, userAction } = request;
  const startTime = Date.now();

  // 0. A2UI: 检查是否为结构化 userAction（跳过 LLM 意图识别）
  if (userAction) {
    logger.info('Processing user action (A2UI)', { 
      action: userAction.action, 
      source: userAction.source,
      userId: userId || 'anon',
    });
    
    const actionResult = await handleUserAction(
      userAction,
      userId,
      location ? { lat: location[1], lng: location[0] } : undefined
    );
    
    // 如果 action 处理成功且不需要回退到 LLM
    if (actionResult.success && !actionResult.fallbackToLLM) {
      return createActionResponse(actionResult, trace);
    }
    
    // 如果需要回退到 LLM，使用 fallbackText 作为用户消息
    if (actionResult.fallbackToLLM && actionResult.fallbackText) {
      // 修改最后一条消息为 fallbackText
      const modifiedMessages = [...messages];
      if (modifiedMessages.length > 0) {
        const lastMsg = modifiedMessages[modifiedMessages.length - 1];
        if (lastMsg.role === 'user') {
          (lastMsg as any).content = actionResult.fallbackText;
          if (lastMsg.parts) {
            lastMsg.parts = [{ type: 'text', text: actionResult.fallbackText }];
          }
        }
      }
      // 继续正常的 LLM 流程
    }
    
    // 如果 action 失败且不回退，返回错误
    if (!actionResult.success && !actionResult.fallbackToLLM) {
      return createDirectResponse(actionResult.error || '操作失败', trace);
    }
  }

  // 0.1 提取最后一条用户消息（用于护栏检查）
  const conversationHistory = messages.map(m => ({
    role: m.role,
    content: (m.parts?.find((p): p is { type: 'text'; text: string } => p.type === 'text')?.text)
      || (m as unknown as { content?: string })?.content
      || '',
  }));
  const rawUserInput = conversationHistory.filter(m => m.role === 'user').pop()?.content || '';

  // 1. 频率限制检查
  const rateLimitSubject = userId || rateLimitUserId || null;
  const rateLimitResult = await checkRateLimit(rateLimitSubject, { maxRequests: 30, windowSeconds: 60 });
  if (!rateLimitResult.allowed) {
    logger.warn('Rate limit exceeded', { userId, retryAfter: rateLimitResult.retryAfter });
    return createDirectResponse('请求太频繁了，休息一下再来吧～', trace);
  }

  // 2. 输入护栏检查 (inputGuardProcessor)
  const processorLogs: ProcessorLogEntry[] = [];
  const guardContext: ProcessorContext = {
    userId,
    messages: [],
    rawUserInput,
    userInput: rawUserInput.trim().slice(0, 2000),
    systemPrompt: '',
    metadata: {},
  };
  const guardResult = await inputGuardProcessor(guardContext);
  processorLogs.push({
    processorName: inputGuardProcessor.processorName,
    executionTime: guardResult.executionTime,
    success: guardResult.success,
    data: guardResult.data,
    error: guardResult.error,
    timestamp: new Date().toISOString(),
  });

  if (!guardResult.success) {
    logger.warn('Input blocked', { userId, error: guardResult.error });
    return createDirectResponse('这个话题我帮不了你 😅', trace);
  }
  const sanitizedInput = guardResult.context.userInput;

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
    messages: conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
    rawUserInput,
    userInput: sanitizedInput,
    systemPrompt: await getSystemPrompt(promptContext),
    metadata: {},
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
      return createKeywordResponse(matchedKeyword, trace, userId, sanitizedInput);
    }
    // 降级：metadata 标记命中但无法获取完整 keyword 对象，继续后续流程
  }

  // 3. 运行 Pre-LLM 管线：intent-classify → [user-profile ∥ semantic-recall] → token-limit
  const preLLMConfigs = await buildPreLLMPipeline();
  const { context: preLLMContext, logs: pipelineLogs, success: pipelineSuccess } = await runProcessors(preLLMConfigs, keywordResult.context);
  processorLogs.push(...pipelineLogs);

  if (!pipelineSuccess) {
    logger.warn('Pre-LLM pipeline failed', { logs: pipelineLogs.filter(l => !l.success) });
    return createDirectResponse('处理请求时遇到问题，请稍后再试～', trace);
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
  if (intentResult.intent === 'partner' && userId) {
    const thread = await getOrCreateThread(userId);
    const partnerMatchingState = await recoverPartnerMatchingState(thread.id);

    if (shouldStartPartnerMatching('partner', partnerMatchingState)) {
      return handlePartnerMatchingFlow(request, partnerMatchingState, thread.id, sanitizedInput, intentResult);
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

  const uiMessages: UIMessage[] = messages.map((m, i) => ({
    id: `msg-${i}`,
    role: m.role,
    content: (m as any).content || '',
    parts: (m as any).parts || [{ type: 'text', text: (m as any).content || '' }],
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
  const selectedModel = await getModelByIntent(modelType);
  
  // 确定 modelId 用于日志记录
  const modelId = modelType === 'reasoning' ? 'qwen-plus' : 
                  modelType === 'agent' ? 'qwen3-max' : 
                  'qwen-flash';

  const result = streamText({
    model: selectedModel,
    system: systemPrompt,
    messages: aiMessages,
    tools,
    temperature: modelParams?.temperature ?? 0,
    maxOutputTokens: modelParams?.maxTokens,
    stopWhen: [stepCountIs(5), hasToolCall('askPreference')],
    onStepFinish: (step) => {
      // 记录每一步的详细信息
      const stepNumber = toolCallRecords.length + 1;
      const stepType = (step as any).stepType; // 'initial' | 'continue' | 'tool-result'

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
            args: (tc as any).input ?? (tc as any).args,
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
          existing.result = (tr as any).output ?? (tr as any).result;

          // 记录 Tool 结果日志
          logger.info('Tool result received', {
            stepNumber,
            toolName: existing.toolName,
            toolCallId: tr.toolCallId,
            hasResult: !!((tr as any).output ?? (tr as any).result),
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
      const rawUsage = usage as any;
      // 必须 mutate 而非 reassign，因为 createTracedStreamResponse 持有同一对象引用
      totalUsage.promptTokens = rawUsage.inputTokens ?? 0;
      totalUsage.completionTokens = rawUsage.outputTokens ?? 0;
      totalUsage.totalTokens = rawUsage.totalTokens ?? 0;

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
          conversationId: conversationId ?? undefined,
          activityId: (toolCallRecords.find(tc => (tc.result as any)?.activityId)?.result as any)?.activityId,
          // record-metrics-processor 数据
          metricsData: {
            modelId,
            duration,
            inputTokens: totalUsage.promptTokens,
            outputTokens: totalUsage.completionTokens,
            totalTokens: totalUsage.totalTokens,
            cacheHitTokens: rawUsage.promptCacheHitTokens,
            cacheMissTokens: rawUsage.promptCacheMissTokens,
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
        // Post-LLM: output-guard → save-history（失败时记录日志，不影响响应）
        const { logs: postLLMLogs } = await runPostLLMProcessors(
          [{ processor: outputGuardProcessor }, { processor: saveHistoryProcessor }],
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
      duration: guardResult.executionTime,
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
  }) as Promise<Response>;
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
        writer.write({ type: 'data-trace-start' as any, data: { requestId: randomUUID(), startedAt: now, intent: 'blocked', intentMethod: 'guardrail' }, transient: true });
        writer.write({ type: 'data-trace-end' as any, data: { completedAt: now, status: 'blocked', output: { text, toolCalls: [] } }, transient: true });
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
  trace: boolean | undefined,
  userId: string | null,
  userMessage: string
): Promise<Response> {
  const keywordContext = {
    keywordId: keyword.id,
    matchedAt: new Date().toISOString(),
  };
  
  // 异步保存对话历史（不阻塞响应）
  if (userId) {
    (async () => {
      try {
        const thread = await getOrCreateThread(userId);
        
        // 保存用户消息
        await saveMessage({
          conversationId: thread.id,
          userId,
          role: 'user',
          messageType: 'text',
          content: { text: userMessage },
        });
        
        // 保存 AI 响应（包含 keywordContext）
        await saveMessage({
          conversationId: thread.id,
          userId,
          role: 'assistant',
          messageType: keyword.responseType as any,
          content: {
            ...keyword.responseContent as Record<string, unknown>,
            keywordContext,
          },
        });
      } catch (err) {
        logger.error('Failed to save keyword match conversation', { error: err });
      }
    })();
  }
  
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      // 返回 widget 数据
      writer.write({
        type: 'data' as any,
        data: {
          type: keyword.responseType,
          data: keyword.responseContent,
          keywordContext,
        },
      });
      
      // 如果是文本类型，返回文本内容
      if (keyword.responseType === 'text' && typeof keyword.responseContent === 'string') {
        writer.write({ type: 'text-delta', delta: keyword.responseContent, id: randomUUID() });
      }
      
      if (trace) {
        const now = new Date().toISOString();
        writer.write({ 
          type: 'data-trace-start' as any, 
          data: { 
            requestId: randomUUID(), 
            startedAt: now, 
            intent: 'keyword_match', 
            intentMethod: 'p0_layer',
            keyword: keyword.keyword,
            matchType: keyword.matchType,
          }, 
          transient: true 
        });
        writer.write({ 
          type: 'data-trace-end' as any, 
          data: { 
            completedAt: now, 
            status: 'completed', 
            output: { 
              keywordId: keyword.id,
              responseType: keyword.responseType,
            } 
          }, 
          transient: true 
        });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/**
 * 创建 UserAction 响应 (A2UI)
 * 直接返回 action 执行结果，不经过 LLM
 */
function createActionResponse(result: import('./user-action').ActionResult, trace?: boolean): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      // 返回 action 结果作为 data
      writer.write({
        type: 'data' as any,
        data: {
          type: 'action_result',
          success: result.success,
          data: result.data,
          error: result.error,
        },
      });
      
      // 如果有导航指令，返回文本提示
      const data = result.data as Record<string, unknown> | undefined;
      if (data?.action === 'navigate') {
        writer.write({ type: 'text-delta', delta: '正在跳转...', id: randomUUID() });
      } else if (data?.action === 'share') {
        writer.write({ type: 'text-delta', delta: '准备分享...', id: randomUUID() });
      } else if (result.success) {
        writer.write({ type: 'text-delta', delta: '操作成功！', id: randomUUID() });
      }
      
      if (trace) {
        const now = new Date().toISOString();
        writer.write({ 
          type: 'data-trace-start' as any, 
          data: { 
            requestId: randomUUID(), 
            startedAt: now, 
            intent: 'user_action', 
            intentMethod: 'a2ui' 
          }, 
          transient: true 
        });
        writer.write({ 
          type: 'data-trace-end' as any, 
          data: { 
            completedAt: now, 
            status: result.success ? 'completed' : 'failed', 
            output: { actionResult: result } 
          }, 
          transient: true 
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
        writer.write({ type: 'data-trace-start' as any, data: { requestId: randomUUID(), startedAt: now, intent: _intent.intent, intentMethod: _intent.method }, transient: true });
        writer.write({ type: 'data-trace-end' as any, data: { completedAt: now, status: 'completed', output: { text, toolCalls: [] } }, transient: true });
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
  const { userId, trace } = request;

  // 创建或恢复状态
  let state = existingState || createPartnerMatchingState();

  // 如果有现有状态，尝试解析用户回答
  if (existingState) {
    const currentQuestion = getNextQuestion(existingState);
    const answer = parseUserAnswer(userMessage, currentQuestion);

    if (answer) {
      state = updatePartnerMatchingState(state, answer.field, answer.value);
      logger.debug('Partner matching state updated', { field: answer.field, value: answer.value });
    }
  }

  // 获取下一个问题
  const nextQuestion = getNextQuestion(state);

  // 如果没有更多问题，信息收集完成
  if (!nextQuestion) {
    // 持久化完成状态
    if (userId) {
      await persistPartnerMatchingState(threadId, userId, { ...state, status: 'completed' });
    }

    // 返回确认消息，让 LLM 调用 createPartnerIntent
    const confirmText = `📋 需求确认：
- 🎯 活动类型：${state.collectedPreferences.activityType || '待定'}
- ⏰ 时间：${state.collectedPreferences.timeRange || '待定'}
${state.collectedPreferences.location ? `- 📍 地点：${state.collectedPreferences.location}` : ''}

正在帮你寻找匹配的搭子... 有消息第一时间叫你 🔔`;

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'text-delta', delta: confirmText, id: randomUUID() });
        // 返回 Widget 数据让前端显示
        writer.write({
          type: 'data' as any,
          data: {
            type: 'widget_ask_preference',
            payload: {
              status: 'completed',
              preferences: state.collectedPreferences,
            },
          },
        });
        if (trace) {
          const now = new Date().toISOString();
          writer.write({ type: 'data-trace-start' as any, data: { requestId: randomUUID(), startedAt: now, intent: 'partner', intentMethod: 'partner_matching' }, transient: true });
          writer.write({ type: 'data-trace-end' as any, data: { completedAt: now, status: 'completed', output: { text: confirmText, toolCalls: [] } }, transient: true });
        }
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  // 持久化当前状态
  if (userId) {
    await persistPartnerMatchingState(threadId, userId, state);
  }

  // 返回追问
  const questionText = nextQuestion.question;
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-delta', delta: questionText, id: randomUUID() });
      // 返回 Widget 数据让前端渲染选项按钮
      writer.write({
        type: 'data' as any,
        data: {
          type: 'widget_ask_preference',
          payload: {
            questionType: nextQuestion.field,
            question: nextQuestion.question,
            options: nextQuestion.options,
            partnerMatchingState: {
              workflowId: state.workflowId,
              round: state.round,
              collected: state.collectedPreferences,
            },
          },
        },
      });
      if (trace) {
        const now = new Date().toISOString();
        writer.write({ type: 'data-trace-start' as any, data: { requestId: randomUUID(), startedAt: now, intent: 'partner', intentMethod: 'partner_matching' }, transient: true });
        writer.write({ type: 'data-trace-end' as any, data: { completedAt: now, status: 'collecting', output: { text: questionText, toolCalls: [] } }, transient: true });
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

    const activityId = toolCalls.find(tc => (tc.result as any)?.activityId)?.result as { activityId?: string } | undefined;
    let messageType = 'text';
    if (toolCalls.length > 0) {
      const widgetType = getToolWidgetType(toolCalls[toolCalls.length - 1].toolName);
      if (widgetType) messageType = widgetType;
    }

    await saveMessage({
      conversationId: threadId,
      userId,
      role: 'assistant',
      messageType,
      content: { text: assistantResponse, toolCalls: toolCalls.map(tc => ({ toolName: tc.toolName, args: tc.args, result: tc.result })) },
      activityId: activityId?.activityId,
    });
  } catch (error) {
    console.error('[AI] Failed to save conversation:', error);
  }
}

function createTracedStreamResponse(result: ReturnType<typeof streamText>, ctx: {
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

  const toolsInfo = Object.keys(ctx.tools).map(name => {
    const t = (ctx.tools as any)[name];
    let inputSchema = {};
    if (t.inputSchema?.jsonSchema) inputSchema = t.inputSchema.jsonSchema;
    else if (t.inputSchema) inputSchema = t.inputSchema;
    else if (t.parameters) inputSchema = t.parameters;
    return { name, description: t.description || '', schema: inputSchema };
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
                truncated: (tokenLimitData as any)?.truncated ?? false,
                originalLength: (tokenLimitData as any)?.originalTokens ?? (tokenLimitData as any)?.totalTokens ?? 0,
                finalLength: (tokenLimitData as any)?.truncatedTokens ?? (tokenLimitData as any)?.totalTokens ?? 0,
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

export async function getConversationMessages(conversationId: string) {
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
  messageType: string;
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

export async function getMessagesByActivityId(activityId: string) {
  const msgs = await db
    .select({
      id: conversationMessages.id,
      userId: conversationMessages.userId,
      role: conversationMessages.role,
      messageType: conversationMessages.messageType,
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.activityId, activityId))
    .orderBy(conversationMessages.createdAt);

  const userIds = [...new Set(msgs.map(m => m.userId))];
  const userNicknames = userIds.length > 0
    ? await db.select({ id: users.id, nickname: users.nickname }).from(users).where(inArray(users.id, userIds))
    : [];
  const nicknameMap = new Map(userNicknames.map(u => [u.id, u.nickname]));

  return {
    items: msgs.map(m => ({
      ...m,
      userNickname: nicknameMap.get(m.userId) || null,
      createdAt: m.createdAt.toISOString(),
    })),
    total: msgs.length,
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

function normalizeWelcomeCopyConfig(raw: unknown): WelcomeCopyConfig {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_WELCOME_COPY_CONFIG;
  }

  const config = raw as Partial<WelcomeCopyConfig> & {
    greetingTemplates?: Partial<Record<WelcomeGreetingPeriod, unknown>>;
  };

  const greetingTemplates = { ...DEFAULT_WELCOME_COPY_CONFIG.greetingTemplates };
  if (config.greetingTemplates && typeof config.greetingTemplates === 'object') {
    for (const key of Object.keys(greetingTemplates) as WelcomeGreetingPeriod[]) {
      const next = config.greetingTemplates[key];
      if (typeof next === 'string' && next.trim()) {
        greetingTemplates[key] = next.trim();
      }
    }
  }

  return {
    fallbackNickname:
      typeof config.fallbackNickname === 'string' && config.fallbackNickname.trim()
        ? config.fallbackNickname.trim()
        : DEFAULT_WELCOME_COPY_CONFIG.fallbackNickname,
    subGreeting:
      typeof config.subGreeting === 'string' && config.subGreeting.trim()
        ? config.subGreeting.trim()
        : DEFAULT_WELCOME_COPY_CONFIG.subGreeting,
    greetingTemplates,
  };
}

function normalizeWelcomeUiConfig(raw: unknown): WelcomeUiConfig {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_WELCOME_UI_CONFIG;
  }

  const config = raw as Partial<WelcomeUiConfig> & {
    composerPlaceholder?: unknown;
    sectionTitles?: Partial<Record<'suggestions' | 'explore', unknown>>;
    exploreTemplates?: Partial<Record<'label' | 'prompt', unknown>>;
    suggestionItems?: unknown;
    quickPrompts?: unknown;
    bottomQuickActions?: unknown;
    profileHints?: Partial<Record<'low' | 'medium' | 'high', unknown>>;
  };

  const suggestionItems = Array.isArray(config.suggestionItems)
    ? config.suggestionItems
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Partial<{ icon: unknown; label: unknown; prompt: unknown }>;
        if (
          typeof record.icon !== 'string' ||
          typeof record.label !== 'string' ||
          typeof record.prompt !== 'string'
        ) {
          return null;
        }
        return {
          icon: record.icon.trim(),
          label: record.label.trim(),
          prompt: record.prompt.trim(),
        };
      })
      .filter((item): item is { icon: string; label: string; prompt: string } => Boolean(item?.label && item.prompt))
    : [];

  const quickPrompts = Array.isArray(config.quickPrompts)
    ? config.quickPrompts
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Partial<{ icon: unknown; text: unknown; prompt: unknown }>;
        if (
          typeof record.icon !== 'string' ||
          typeof record.text !== 'string' ||
          typeof record.prompt !== 'string'
        ) {
          return null;
        }
        return {
          icon: record.icon.trim(),
          text: record.text.trim(),
          prompt: record.prompt.trim(),
        };
      })
      .filter((item): item is QuickPrompt => Boolean(item?.text && item.prompt))
    : [];

  const bottomQuickActions = Array.isArray(config.bottomQuickActions)
    ? config.bottomQuickActions
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
    : [];

  const profileHints = {
    low:
      typeof config.profileHints?.low === 'string' && config.profileHints.low.trim()
        ? config.profileHints.low.trim()
        : DEFAULT_WELCOME_UI_CONFIG.profileHints.low,
    medium:
      typeof config.profileHints?.medium === 'string' && config.profileHints.medium.trim()
        ? config.profileHints.medium.trim()
        : DEFAULT_WELCOME_UI_CONFIG.profileHints.medium,
    high:
      typeof config.profileHints?.high === 'string' && config.profileHints.high.trim()
        ? config.profileHints.high.trim()
        : DEFAULT_WELCOME_UI_CONFIG.profileHints.high,
  };

  const sectionTitles = {
    suggestions:
      typeof config.sectionTitles?.suggestions === 'string' && config.sectionTitles.suggestions.trim()
        ? config.sectionTitles.suggestions.trim()
        : DEFAULT_WELCOME_UI_CONFIG.sectionTitles.suggestions,
    explore:
      typeof config.sectionTitles?.explore === 'string' && config.sectionTitles.explore.trim()
        ? config.sectionTitles.explore.trim()
        : DEFAULT_WELCOME_UI_CONFIG.sectionTitles.explore,
  };

  const exploreTemplates = {
    label:
      typeof config.exploreTemplates?.label === 'string' && config.exploreTemplates.label.trim()
        ? config.exploreTemplates.label.trim()
        : DEFAULT_WELCOME_UI_CONFIG.exploreTemplates.label,
    prompt:
      typeof config.exploreTemplates?.prompt === 'string' && config.exploreTemplates.prompt.trim()
        ? config.exploreTemplates.prompt.trim()
        : DEFAULT_WELCOME_UI_CONFIG.exploreTemplates.prompt,
  };

  const composerPlaceholder =
    typeof config.composerPlaceholder === 'string' && config.composerPlaceholder.trim()
      ? config.composerPlaceholder.trim()
      : DEFAULT_WELCOME_UI_CONFIG.composerPlaceholder;

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
    output = output.replaceAll(`{${key}}`, value);
  }
  return output;
}

function renderWelcomeTemplate(template: string, nickname: string): string {
  return renderTemplate(template, {
    nickname,
    name: nickname,
  });
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

  // 社交档案（已登录用户）
  let socialProfile: { participationCount: number; activitiesCreatedCount: number; preferenceCompleteness: number } | undefined;

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
      // 计算偏好完善度
      let preferenceCompleteness = 0;
      if (user.workingMemory) {
        const memory = user.workingMemory as { preferences?: unknown[]; frequentLocations?: unknown[] };
        const preferencesCount = memory.preferences?.length || 0;
        const locationsCount = memory.frequentLocations?.length || 0;
        // 偏好完善度：偏好数量 * 15 + 常去地点 * 10，最高 100
        preferenceCompleteness = Math.min(100, preferencesCount * 15 + locationsCount * 10);
      }

      socialProfile = {
        participationCount: user.participationCount,
        activitiesCreatedCount: user.activitiesCreatedCount,
        preferenceCompleteness,
      };
    }
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

  // 快捷入口（v4.4 新增）
  const quickPrompts = welcomeUi.quickPrompts;

  return {
    greeting,
    subGreeting: welcomeCopy.subGreeting,
    sections,
    socialProfile,
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

import { generateObject, jsonSchema } from 'ai';
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

    const result = await generateObject({
      model: getQwenModelByIntent('chat'),
      schema: jsonSchema<NoteOutput>(toJsonSchema(NoteOutputSchema) as any),
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

/**
 * AI Service - v4.5 模块化架构
 * 
 * 精简的服务层，编排各模块完成 AI Chat
 * 
 * v4.5 更新：
 * - 新增 Agent 封装层 (Mastra 风格)
 * - handleChatStream/generateChat 委托给 agent/chat.ts
 * - 保留原有 handleChatStream 实现用于兼容
 * 
 * 模块依赖：
 * - agent/ - Agent 核心 (v4.5 新增)
 * - intent/ - 意图识别
 * - memory/ - 会话存储
 * - tools/ - 工具系统
 * - models/ - 模型路由
 */

// ==========================================
// v4.5 Agent 模块已废弃，功能由 Processor 架构替代
// 保留类型别名用于向后兼容
// ==========================================

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

const logger = createLogger('ai.service');

// ==========================================
// Types
// ==========================================

export interface ChatRequest {
  messages: Array<Omit<UIMessage, 'id'>>;
  userId: string | null;
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
  const { messages, userId, location, source, draftContext, trace, modelParams, userAction } = request;
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
  const rateLimitResult = await checkRateLimit(userId, { maxRequests: 30, windowSeconds: 60 });
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
  const sanitizedInput = guardContext.userInput;

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
  const selectedModel = await getModelByIntent(intentResult.intent === 'partner' ? 'reasoning' : 'chat');
  
  // 确定 modelId 用于日志记录
  const modelId = intentResult.intent === 'partner' ? 'qwen-plus' : 
                  intentResult.intent === 'create' ? 'qwen-max' : 
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
            args: (tc as any).args,
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
          existing.result = (tr as any).result;

          // 记录 Tool 结果日志
          logger.info('Tool result received', {
            stepNumber,
            toolName: existing.toolName,
            toolCallId: tr.toolCallId,
            hasResult: !!(tr as any).result,
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
      totalUsage = {
        promptTokens: rawUsage.inputTokens ?? 0,
        completionTokens: rawUsage.outputTokens ?? 0,
        totalTokens: rawUsage.totalTokens ?? 0,
      };

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
          conversationId: undefined,
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

          writer.write({
            type: 'data-trace-step-update',
            data: { stepId: llmStepId, completedAt: llmCompletedAt, status: 'success', duration: llmDuration, data: { model: ctx.modelId, inputTokens: ctx.totalUsage.promptTokens, outputTokens: ctx.totalUsage.completionTokens, totalTokens: ctx.totalUsage.totalTokens } },
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
            data: { id: `${ctx.requestId}-output`, type: 'output', name: '输出', startedAt: llmCompletedAt, completedAt, status: 'success', duration: totalDuration, data: { text: ctx.aiResponseText || '', toolCallCount: ctx.toolCallRecords.length } },
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
}

export function generateGreeting(nickname: string | null): string {
  const hour = new Date().getHours();
  const name = nickname || '朋友';

  if (hour < 6) return `夜深了，${name}～`;
  if (hour < 9) return `早上好，${name}！`;
  if (hour < 12) return `上午好，${name}！`;
  if (hour < 14) return `中午好，${name}！`;
  if (hour < 18) return `下午好，${name}！`;
  if (hour < 22) return `晚上好，${name}！`;
  return `夜深了，${name}～`;
}

export async function getWelcomeCard(
  userId: string | null,
  nickname: string | null,
  location: { lat: number; lng: number } | null
): Promise<WelcomeResponse> {
  const greeting = generateGreeting(nickname);
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
    title: '快速组局',
    items: [
      { type: 'suggestion', icon: '🍜', label: '约饭局', prompt: '帮我组一个吃饭的局' },
      { type: 'suggestion', icon: '🎮', label: '打游戏', prompt: '想找人一起打游戏' },
      { type: 'suggestion', icon: '🏃', label: '运动', prompt: '想找人一起运动' },
      { type: 'suggestion', icon: '☕', label: '喝咖啡', prompt: '想约人喝咖啡聊天' },
    ],
  };
  sections.push(suggestions);

  // 探索附近（有位置时显示）
  if (location) {
    const locationName = await reverseGeocode(location.lat, location.lng);
    const explore: WelcomeSection = {
      id: 'explore',
      icon: '📍',
      title: '探索附近',
      items: [
        {
          type: 'explore',
          icon: '🔍',
          label: `看看${locationName}有什么局`,
          prompt: `看看${locationName}附近有什么活动`,
          context: { locationName, lat: location.lat, lng: location.lng },
        },
      ],
    };
    sections.push(explore);
  }

  // 快捷入口（v4.4 新增）
  const quickPrompts = [
    { icon: '🗓️', text: '周末附近有什么活动？', prompt: '周末附近有什么活动' },
    { icon: '🤝', text: '帮我找个运动搭子', prompt: '帮我找个运动搭子' },
    { icon: '🎉', text: '想组个周五晚的局', prompt: '想组个周五晚的局' },
  ];

  return {
    greeting,
    subGreeting: '想约点什么？',
    sections,
    socialProfile,
    quickPrompts,
  };
}

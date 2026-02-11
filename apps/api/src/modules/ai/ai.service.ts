/**
 * AI Service - v4.5 模块化架构
 * 
 * 精简的服务层，编排各模块完成 AI Chat
 * 
 * v4.5 更新：
 * - 新增 Agent 封装层 (Mastra 风格)
 * - streamChat/generateChat 委托给 agent/chat.ts
 * - 保留原有 streamChat 实现用于兼容
 * 
 * 模块依赖：
 * - agent/ - Agent 核心 (v4.5 新增)
 * - intent/ - 意图识别
 * - memory/ - 会话存储
 * - tools/ - 工具系统
 * - models/ - 模型路由
 */

// ==========================================
// v4.5 Agent 模块 Re-export
// ==========================================
export {
  streamChat as agentStreamChat,
  generateChat as agentGenerateChat,
  toDataStreamResponse,
  type StreamChatResult,
  type GenerateChatResult,
} from './agent';

import { db, users, conversations, conversationMessages, aiRequests, eq, desc, sql, inArray, and } from '@juchang/db';
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
import { classifyIntent, type ClassifyResult } from './intent';
import { getOrCreateThread, saveMessage, clearUserThreads, deleteThread } from './memory';
import { getToolsByIntent, getToolWidgetType, getToolDisplayName } from './tools';
import { buildXmlSystemPrompt, type PromptContext, type ActivityDraftForPrompt } from './prompts/xiaoju-v39';
import { getModelByIntent } from './models/router';
// Guardrails
import { checkRateLimit } from './guardrails/rate-limiter';
// Observability
import { createLogger } from './observability/logger';
import {
  countAIRequest,
  recordAILatency,
  recordTokenUsage as recordMetricsTokenUsage,
  recordTokenUsageWithLog,
} from './observability/metrics';
import {
  recordConversationMetrics,
  extractConversionInfo,
} from './observability/quality-metrics';
// WorkingMemory (Enhanced)
import {
  getEnhancedUserProfile,
  buildProfilePrompt,
} from './memory/working';
// Processors (v4.6 纯函数)
import {
  sanitizeAndGuard,
  injectUserProfile,
  injectSemanticRecall,
  truncateByTokenLimit,
  saveConversationHistory,
  extractAndUpdatePreferences,
  type ToolCallTrace,
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
// Evals
import { evaluateResponseQuality } from './evals/runner';
// User Action (A2UI 风格)
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
  /** A2UI 风格：结构化用户操作，跳过 LLM 意图识别 */
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

export async function streamChat(request: ChatRequest): Promise<Response> {
  const { messages, userId, location, source, draftContext, trace, modelParams, userAction } = request;
  const startTime = Date.now();

  // 0. A2UI: 检查是否为结构化 userAction
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
      return createQuickResponse(actionResult.error || '操作失败', trace);
    }
  }

  // 0.1 提取最后一条用户消息（用于护栏检查）
  const conversationHistory = messages.map(m => ({
    role: m.role,
    content: (m.parts?.find((p): p is { type: 'text'; text: string } => p.type === 'text')?.text)
      || (m as unknown as { content?: string })?.content
      || '',
  }));
  const lastUserMessage = conversationHistory.filter(m => m.role === 'user').pop()?.content || '';

  // 1. 频率限制检查
  const rateLimitResult = checkRateLimit(userId, { maxRequests: 30, windowSeconds: 60 });
  if (!rateLimitResult.allowed) {
    logger.warn('Rate limit exceeded', { userId, retryAfter: rateLimitResult.retryAfter });
    return createQuickResponse('请求太频繁了，休息一下再来吧～', trace);
  }

  // 2. 输入护栏检查 (Processor)
  const processorLogs: ProcessorLogEntry[] = [];
  const guardStartTime = Date.now();
  const guardResult = sanitizeAndGuard(lastUserMessage, userId);
  const guardDuration = Date.now() - guardStartTime;
  
  // 记录 Input Guard Processor 日志
  processorLogs.push({
    processorName: 'input-guard',
    executionTime: guardDuration,
    success: !guardResult.blocked,
    data: {
      blocked: guardResult.blocked,
      sanitized: guardResult.sanitized,
      blockReason: guardResult.blockReason,
      triggeredRules: guardResult.triggeredRules,
    },
    timestamp: new Date().toISOString(),
  });
  
  if (guardResult.blocked) {
    logger.warn('Input blocked', { userId, reason: guardResult.blockReason, rules: guardResult.triggeredRules });
    return createQuickResponse(guardResult.suggestedResponse || '这个话题我帮不了你 😅', trace);
  }
  const sanitizedMessage = guardResult.sanitized;

  // 2.5 P0 层：全局关键词匹配（v4.8 Digital Ascension）
  let matchedKeywordId: string | null = null;
  const p0StartTime = Date.now();
  const { matchKeyword, incrementHitCount } = await import('../hot-keywords/hot-keywords.service');
  const matchedKeyword = await matchKeyword(sanitizedMessage);
  const p0Duration = Date.now() - p0StartTime;
  
  // 保存匹配的关键词 ID
  if (matchedKeyword) {
    matchedKeywordId = matchedKeyword.id;
  }
  
  // 记录 P0 Match Processor 日志
  processorLogs.push({
    processorName: 'p0-match',
    executionTime: p0Duration,
    success: true,
    data: {
      matched: !!matchedKeyword,
      keywordId: matchedKeyword?.id,
      keyword: matchedKeyword?.keyword,
      matchType: matchedKeyword?.matchType,
      priority: matchedKeyword?.priority,
      responseType: matchedKeyword?.responseType,
    },
    timestamp: new Date().toISOString(),
  });
  
  // 保存 P0 匹配数据用于 trace
  const p0MatchData = matchedKeyword ? {
    matched: true as const,
    keyword: matchedKeyword.keyword,
    matchType: matchedKeyword.matchType,
    priority: matchedKeyword.priority,
    responseType: matchedKeyword.responseType,
    duration: p0Duration,
  } : {
    matched: false as const,
    duration: p0Duration,
  };
  
  if (matchedKeyword) {
    logger.info('P0 keyword matched', { 
      keywordId: matchedKeyword.id, 
      keyword: matchedKeyword.keyword,
      matchType: matchedKeyword.matchType,
      userId: userId || 'anon',
    });
    
    // 增加命中次数（异步，不阻塞）
    incrementHitCount(matchedKeyword.id).catch(err => {
      logger.error('Failed to increment hit count', { error: err });
    });
    
    // 返回预设响应（包含 widget 和 keywordContext）
    return createKeywordResponse(matchedKeyword, trace, userId, sanitizedMessage);
  }

  // 3. 构建上下文
  const locationName = location ? await reverseGeocode(location[1], location[0]) : undefined;
  const userNickname = userId ? await getUserNickname(userId) : undefined;

  // 4. 获取用户工作记忆（增强版用户画像）
  const userProfile = userId ? await getEnhancedUserProfile(userId) : null;

  const promptContext: PromptContext = {
    currentTime: new Date(),
    userLocation: location ? { lat: location[1], lng: location[0], name: locationName } : undefined,
    userNickname,
    draftContext,
    workingMemory: userProfile ? buildProfilePrompt(userProfile) : null,
  };

  // 5. 意图分类
  const intentStartTime = Date.now();
  const intentResult = await classifyIntent(sanitizedMessage, {
    hasDraftContext: !!draftContext,
    conversationHistory,
    userId: userId || undefined,
  });
  const intentDuration = Date.now() - intentStartTime;
  
  // 记录 P1 Intent Processor 日志
  processorLogs.push({
    processorName: 'p1-intent',
    executionTime: intentDuration,
    success: true,
    data: {
      intent: intentResult.intent,
      method: intentResult.method,
      confidence: intentResult.confidence,
    },
    timestamp: new Date().toISOString(),
  });
  
  logger.info('Intent classified', { intent: intentResult.intent, method: intentResult.method });

  // 5.5 Partner Matching 检查（找搭子追问流程）
  if (intentResult.intent === 'partner' && userId) {
    const thread = await getOrCreateThread(userId);
    const partnerMatchingState = await recoverPartnerMatchingState(thread.id);

    if (shouldStartPartnerMatching('partner', partnerMatchingState)) {
      return handlePartnerMatchingFlow(request, partnerMatchingState, thread.id, sanitizedMessage, intentResult);
    }
  }

  // 6. 特殊意图快速响应
  if (intentResult.intent === 'chitchat') {
    return handleChitchat(trace, intentResult);
  }

  // 7. 获取工具集
  const userLocation = location ? { lat: location[1], lng: location[0] } : null;
  const tools = getToolsByIntent(userId, intentResult.intent, !!draftContext, userLocation);
  logger.debug('Tools selected', { tools: Object.keys(tools) });

  // 8. 构建 System Prompt + Processors 处理
  const uiMessages: UIMessage[] = messages.map((m, i) => ({
    id: `msg-${i}`,
    role: m.role,
    content: (m as any).content || '',
    parts: (m as any).parts || [{ type: 'text', text: (m as any).content || '' }],
  }));
  const aiMessages = await convertToModelMessages(uiMessages);

  // 构建基础 System Prompt
  let systemPrompt = buildXmlSystemPrompt(promptContext);

  // [Processor 1] 注入用户画像
  const userProfileStartTime = Date.now();
  systemPrompt = await injectUserProfile(systemPrompt, userId);
  const userProfileDuration = Date.now() - userProfileStartTime;
  
  // 记录 User Profile Processor 日志
  processorLogs.push({
    processorName: 'user-profile',
    executionTime: userProfileDuration,
    success: true,
    data: {
      hasProfile: !!userProfile,
      preferencesCount: userProfile?.preferences?.length || 0,
      locationsCount: userProfile?.frequentLocations?.length || 0,
    },
    timestamp: new Date().toISOString(),
  });

  // [Processor 2] 注入语义召回历史
  const semanticRecallStartTime = Date.now();
  systemPrompt = await injectSemanticRecall(systemPrompt, sanitizedMessage, userId);
  const semanticRecallDuration = Date.now() - semanticRecallStartTime;
  
  // 记录 Semantic Recall Processor 日志
  processorLogs.push({
    processorName: 'semantic-recall',
    executionTime: semanticRecallDuration,
    success: true,
    timestamp: new Date().toISOString(),
  });

  // [Processor 3] Token 限制截断
  const tokenLimitStartTime = Date.now();
  const originalPromptLength = systemPrompt.length;
  systemPrompt = truncateByTokenLimit(systemPrompt, 12000);
  const tokenLimitDuration = Date.now() - tokenLimitStartTime;
  const truncated = systemPrompt.length < originalPromptLength;
  
  // 记录 Token Limit Processor 日志
  processorLogs.push({
    processorName: 'token-limit',
    executionTime: tokenLimitDuration,
    success: true,
    data: {
      truncated,
      originalLength: originalPromptLength,
      finalLength: systemPrompt.length,
    },
    timestamp: new Date().toISOString(),
  });

  // 9. 执行 LLM 推理
  const traceSteps: TraceStep[] = [];
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let aiResponseText = '';
  
  // 根据意图选择模型
  const selectedModel = getModelByIntent(intentResult.intent === 'partner' ? 'reasoning' : 'chat');
  
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
      const stepNumber = traceSteps.length + 1;
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
        if (!traceSteps.find(s => s.toolCallId === tc.toolCallId)) {
          traceSteps.push({
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
        const existing = traceSteps.find(s => s.toolCallId === tr.toolCallId);
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
          toolCalls: traceSteps.map(s => s.toolName),
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

      // 记录指标
      countAIRequest(modelId, 'success');
      recordAILatency(modelId, duration);
      recordMetricsTokenUsage(modelId, totalUsage.promptTokens, totalUsage.completionTokens);

      // 记录 Token 使用量（日志）
      recordTokenUsageWithLog(userId, {
        inputTokens: totalUsage.promptTokens,
        outputTokens: totalUsage.completionTokens,
        totalTokens: totalUsage.totalTokens,
        cacheHitTokens: rawUsage.promptCacheHitTokens,
        cacheMissTokens: rawUsage.promptCacheMissTokens,
      }, traceSteps.map(s => ({ toolName: s.toolName })), {
        model: modelId,
        source,
        intent: intentResult.intent,
      });

      // [Processor 4] 保存对话历史
      if (userId) {
        const saveHistoryStartTime = Date.now();
        await saveConversationHistory(userId, lastUserMessage, text || '', traceSteps as ToolCallTrace[]);
        const saveHistoryDuration = Date.now() - saveHistoryStartTime;
        
        // 记录 Save History Processor 日志
        processorLogs.push({
          processorName: 'save-history',
          executionTime: saveHistoryDuration,
          success: true,
          data: {
            messagesSaved: 2, // user + assistant
          },
          timestamp: new Date().toISOString(),
        });

        // [Processor 5] 异步提取用户偏好并更新画像
        extractAndUpdatePreferences(userId, conversationHistory).then(() => {
          // 记录 Extract Preferences Processor 日志（异步）
          processorLogs.push({
            processorName: 'extract-preferences',
            executionTime: 0, // 异步执行，不计入主流程
            success: true,
            timestamp: new Date().toISOString(),
          });
        }).catch((err: Error) => {
          logger.warn('Failed to update user profile', { error: err.message });
          processorLogs.push({
            processorName: 'extract-preferences',
            executionTime: 0,
            success: false,
            error: err.message,
            timestamp: new Date().toISOString(),
          });
        });
      }
      
      // 保存 AI 请求到数据库（包含 Processor 日志）
      try {
        await db.insert(aiRequests).values({
          userId: userId || null,
          modelId,
          inputTokens: totalUsage.promptTokens,
          outputTokens: totalUsage.completionTokens,
          latencyMs: duration,
          processorLog: processorLogs,
          p0MatchKeyword: matchedKeywordId,
          input: lastUserMessage.slice(0, 1000), // 限制长度
          output: (text || '').slice(0, 1000),
        });
      } catch (err) {
        logger.error('Failed to save AI request to database', { error: err });
      }

      // 异步评估响应质量（不阻塞响应）
      evaluateResponseQuality({
        input: lastUserMessage,
        output: text || '',
        expectedIntent: intentResult.intent,
        actualToolCalls: traceSteps.map(s => s.toolName),
      }).then(evalResult => {
        if (evalResult.score < 0.6) {
          logger.warn('Low quality response detected', {
            score: evalResult.score,
            details: evalResult.details,
            input: lastUserMessage.slice(0, 50),
          });
        }
      }).catch(() => { });

      // 记录对话质量指标到数据库（异步，不阻塞响应）
      const conversionInfo = extractConversionInfo(traceSteps.map(s => ({ toolName: s.toolName, result: s.result })));
      const toolsSucceeded = traceSteps.filter(s => s.result && !(s.result as any)?.error).length;
      const toolsFailed = traceSteps.length - toolsSucceeded;

      recordConversationMetrics({
        userId: userId || undefined,
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
        intentRecognized: intentResult.intent !== 'unknown',
        toolsCalled: traceSteps.map(s => s.toolName),
        toolsSucceeded,
        toolsFailed,
        inputTokens: totalUsage.promptTokens,
        outputTokens: totalUsage.completionTokens,
        totalTokens: totalUsage.totalTokens,
        latencyMs: duration,
        activityCreated: conversionInfo.activityCreated,
        activityJoined: conversionInfo.activityJoined,
        activityId: conversionInfo.activityId,
        source,
      }).catch(() => { });
    },
  });

  // 10. 返回响应
  if (!trace) {
    return result.toUIMessageStreamResponse();
  }

  return wrapWithTrace(result, {
    requestId: randomUUID(),
    startedAt: new Date().toISOString(),
    intent: intentResult,
    systemPrompt,
    tools,
    traceSteps,
    totalUsage,
    aiResponseText,
    lastUserMessage,
    source,
    userId: userId || null,
    modelId,
    // Processor 数据
    inputGuard: {
      duration: guardDuration,
      blocked: false,
      sanitized: sanitizedMessage,
      triggeredRules: guardResult.triggeredRules || [],
    },
    p0Match: p0MatchData as {
      matched: boolean;
      keyword?: string;
      matchType?: string;
      priority?: number;
      responseType?: string;
      duration: number;
    },
    p1Intent: {
      intent: intentResult.intent,
      method: intentResult.method,
      confidence: intentResult.confidence,
      duration: intentDuration,
    },
    userProfile: {
      duration: userProfileDuration,
      profile: userProfile,
    },
    semanticRecall: {
      duration: semanticRecallDuration,
      query: sanitizedMessage,
      resultCount: 0,
      topScore: 0,
    },
    tokenLimit: {
      duration: tokenLimitDuration,
      truncated,
      originalLength: originalPromptLength,
      finalLength: systemPrompt.length,
    },
  });
}

// ==========================================
// 辅助函数
// ==========================================

function createQuickResponse(text: string, trace?: boolean): Response {
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
            ...keyword.responseContent,
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

function wrapWithTrace(result: ReturnType<typeof streamText>, ctx: {
  requestId: string;
  startedAt: string;
  intent: ClassifyResult;
  systemPrompt: string;
  tools: Record<string, unknown>;
  traceSteps: TraceStep[];
  totalUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  aiResponseText: string;
  lastUserMessage: string;
  source: string;
  userId: string | null;
  modelId: string;
  // Processor 数据
  inputGuard?: {
    duration: number;
    blocked: boolean;
    sanitized: string;
    triggeredRules?: string[];
  };
  p0Match?: {
    matched: boolean;
    keyword?: string;
    matchType?: string;
    priority?: number;
    responseType?: string;
    duration: number;
  };
  p1Intent?: {
    intent: string;
    method: string;
    confidence?: number;
    duration: number;
  };
  userProfile?: {
    duration: number;
    profile: any;
  };
  semanticRecall?: {
    duration: number;
    query?: string;
    resultCount?: number;
    topScore?: number;
  };
  tokenLimit?: {
    duration: number;
    truncated: boolean;
    originalLength: number;
    finalLength: number;
  };
}): Response {
  const llmStartedAt = new Date().toISOString();
  const llmStepId = `step-llm`;

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
        data: { id: `${ctx.requestId}-input`, type: 'input', name: '用户输入', startedAt: ctx.startedAt, completedAt: ctx.startedAt, status: 'success', duration: 0, data: { text: ctx.lastUserMessage, source: ctx.source, userId: ctx.userId } },
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
              config: {
                maxLength: 500,
                enabled: true,
              },
            },
          },
          transient: true,
        });
      }

      // P0 Match trace
      if (ctx.p0Match) {
        const p0CompletedAt = new Date(new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + ctx.p0Match.duration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-p0-match`,
            type: 'p0-match',
            name: 'P0: 关键词匹配',
            startedAt: new Date(new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0)).toISOString(),
            completedAt: p0CompletedAt,
            status: 'success',
            duration: ctx.p0Match.duration,
            data: {
              matched: ctx.p0Match.matched,
              keyword: ctx.p0Match.keyword,
              matchType: ctx.p0Match.matchType,
              priority: ctx.p0Match.priority,
              responseType: ctx.p0Match.responseType,
            },
          },
          transient: true,
        });
      }

      // P1 Intent trace
      if (ctx.p1Intent) {
        const p1StartTime = new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + (ctx.p0Match?.duration || 0);
        const p1CompletedAt = new Date(p1StartTime + ctx.p1Intent.duration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-p1-intent`,
            type: 'p1-intent',
            name: 'P1: 意图识别',
            startedAt: new Date(p1StartTime).toISOString(),
            completedAt: p1CompletedAt,
            status: 'success',
            duration: ctx.p1Intent.duration,
            data: {
              intent: ctx.p1Intent.intent,
              method: ctx.p1Intent.method,
              confidence: ctx.p1Intent.confidence,
            },
          },
          transient: true,
        });
      }

      // User Profile Processor trace
      if (ctx.userProfile) {
        const profileStartTime = new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + (ctx.p0Match?.duration || 0) + (ctx.p1Intent?.duration || 0);
        const profileCompletedAt = new Date(profileStartTime + ctx.userProfile.duration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-user-profile`,
            type: 'processor',
            name: 'User Profile',
            startedAt: new Date(profileStartTime).toISOString(),
            completedAt: profileCompletedAt,
            status: 'success',
            duration: ctx.userProfile.duration,
            data: {
              processorType: 'user-profile',
              output: ctx.userProfile.profile ? {
                preferencesCount: ctx.userProfile.profile.preferences?.length || 0,
                locationsCount: ctx.userProfile.profile.frequentLocations?.length || 0,
              } : {},
              config: {
                enabled: true,
              },
            },
          },
          transient: true,
        });
      }

      // Semantic Recall Processor trace
      if (ctx.semanticRecall) {
        const recallStartTime = new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + (ctx.p0Match?.duration || 0) + (ctx.p1Intent?.duration || 0) + (ctx.userProfile?.duration || 0);
        const recallCompletedAt = new Date(recallStartTime + ctx.semanticRecall.duration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-semantic-recall`,
            type: 'processor',
            name: 'Semantic Recall',
            startedAt: new Date(recallStartTime).toISOString(),
            completedAt: recallCompletedAt,
            status: 'success',
            duration: ctx.semanticRecall.duration,
            data: {
              processorType: 'semantic-recall',
              output: {
                query: ctx.semanticRecall.query || '',
                resultCount: ctx.semanticRecall.resultCount || 0,
                topScore: ctx.semanticRecall.topScore || 0,
              },
              config: {
                enabled: true,
              },
            },
          },
          transient: true,
        });
      }

      // Token Limit Processor trace
      if (ctx.tokenLimit) {
        const tokenStartTime = new Date(ctx.startedAt).getTime() + (ctx.inputGuard?.duration || 0) + (ctx.p0Match?.duration || 0) + (ctx.p1Intent?.duration || 0) + (ctx.userProfile?.duration || 0) + (ctx.semanticRecall?.duration || 0);
        const tokenCompletedAt = new Date(tokenStartTime + ctx.tokenLimit.duration).toISOString();
        writer.write({
          type: 'data-trace-step',
          data: {
            id: `${ctx.requestId}-token-limit`,
            type: 'processor',
            name: 'Token Limit',
            startedAt: new Date(tokenStartTime).toISOString(),
            completedAt: tokenCompletedAt,
            status: 'success',
            duration: ctx.tokenLimit.duration,
            data: {
              processorType: 'token-limit',
              output: {
                truncated: ctx.tokenLimit.truncated,
                originalLength: ctx.tokenLimit.originalLength,
                finalLength: ctx.tokenLimit.finalLength,
              },
              config: {
                maxTokens: 12000,
                enabled: true,
              },
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

          for (const step of ctx.traceSteps) {
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
            data: { id: `${ctx.requestId}-output`, type: 'output', name: '输出', startedAt: llmCompletedAt, completedAt, status: 'success', duration: totalDuration, data: { text: ctx.aiResponseText || '', toolCallCount: ctx.traceSteps.length } },
            transient: true,
          });

          writer.write({
            type: 'data-trace-end',
            data: { requestId: ctx.requestId, completedAt, totalDuration, status: 'completed', output: { text: ctx.aiResponseText || null, toolCalls: ctx.traceSteps.map(s => ({ name: s.toolName, input: s.args, output: s.result })) } },
            transient: true,
          });
        },
      }));
    },
  });

  return createUIMessageStreamResponse({ stream });
}

async function getUserNickname(userId: string): Promise<string | undefined> {
  const [user] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.nickname || undefined;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const locations = [
    { name: '观音桥', lat: 29.5630, lng: 106.5516, radius: 0.02 },
    { name: '解放碑', lat: 29.5647, lng: 106.5770, radius: 0.02 },
    { name: '南坪', lat: 29.5230, lng: 106.5516, radius: 0.02 },
    { name: '沙坪坝', lat: 29.5410, lng: 106.4550, radius: 0.02 },
  ];
  for (const loc of locations) {
    if (Math.sqrt(Math.pow(lat - loc.lat, 2) + Math.pow(lng - loc.lng, 2)) <= loc.radius) return loc.name;
  }
  return '附近';
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

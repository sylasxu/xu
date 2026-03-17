/**
 * Processor 架构类型定义 (v4.9)
 * 
 * Processor 是 AI 请求处理链中的可组合单元，用于：
 * - 输入预处理（安全检查、关键词匹配、意图分类、用户画像注入、语义检索）
 * - 输出后处理（保存历史、提取偏好）
 * - Token 限制和截断
 * 
 * 设计原则：
 * - 纯函数：每个 Processor 都是无副作用的纯函数
 * - 可组合：Processors 可以串联执行，支持条件执行和并行组
 * - 可观测：每个 Processor 记录执行时间和结果到 processorLog
 * - 类型安全：处理器间数据通过 ProcessorMetadata 命名空间传递
 */

import type { IntentType } from '../intent/types';

/**
 * 消息类型（简化版，兼容 ai 包的消息格式）
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | unknown;
}

/**
 * 处理器间共享的结构化元数据
 * 
 * 每个处理器写入自己的命名空间，通过 context.metadata 传递，
 * 禁止使用闭包变量在处理器间传递数据。
 */
export interface ProcessorMetadata {
  /** keyword-match-processor 输出 */
  keywordMatch?: {
    matched: boolean;
    keywordId?: string;
    keyword?: string;
    matchType?: string;
    priority?: number;
    responseType?: string;
  };

  /** intent-classify-processor 输出 */
  intentClassify?: {
    intent: IntentType;
    confidence: number;
    method: 'p0' | 'p1' | 'p2';
    matchedPattern?: string;
    p1Features?: string[];
    p2FewShotUsed?: boolean;
    cachedResult?: boolean;
    /** P1 代码异常时降级到 P2 的标记 */
    degraded?: boolean;
  };

  /** 请求级 AI 参数（由 /ai/chat 透传） */
  requestAi?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };

  /** user-profile-processor 输出 */
  userProfile?: {
    hasProfile: boolean;
    preferencesCount: number;
    topPreferences?: string[];
  };

  /** semantic-recall-processor 输出 */
  semanticRecall?: {
    resultsCount: number;
    avgSimilarity: number;
    rerankApplied: boolean;
    sources: ('conversations' | 'activities')[];
  };

  /** 对话历史摘要 */
  conversationSummary?: {
    recentIntents: IntentType[];
    turnCount: number;
  };

  /** 处理器间自定义共享状态（扩展性预留） */
  [key: string]: unknown;
}

/**
 * Processor 执行上下文
 * 
 * 包含 Processor 执行所需的所有信息，处理器间的数据传递
 * 必须通过 context.metadata 而非闭包变量。
 */
export interface ProcessorContext {
  /** 用户 ID（可能为 null，表示未登录用户） */
  userId: string | null;
  
  /** 当前消息列表 */
  messages: Message[];
  
  /** 原始用户输入（未经净化，用于 trace 记录和数据库保存） */
  rawUserInput: string;

  /** 净化后的用户输入（经过 input-guard 处理，用于意图分类、语义召回等后续处理） */
  userInput: string;
  
  /** 系统提示词 */
  systemPrompt: string;
  
  /** 用户画像（working memory） */
  userProfile?: string;
  
  /** 语义检索结果 */
  semanticContext?: string;
  
  /** 结构化元数据，替代原 p0MatchKeyword 等散落字段 */
  metadata: ProcessorMetadata;
}

/**
 * Processor 执行结果
 * 
 * 包含 Processor 的输出和执行信息
 */
export interface ProcessorResult {
  /** 是否成功 */
  success: boolean;
  
  /** 更新后的上下文 */
  context: ProcessorContext;
  
  /** 执行时间（毫秒） */
  executionTime: number;
  
  /** 错误信息（如果失败） */
  error?: string;
  
  /** 额外数据（用于日志和调试） */
  data?: Record<string, unknown>;
}

/**
 * Processor 函数类型
 * 
 * 所有 Processor 都是符合这个签名的纯函数
 */
export type ProcessorFn = (context: ProcessorContext) => Promise<ProcessorResult>;

/**
 * 带元数据的 Processor 函数
 */
export interface ProcessorWithMeta extends ProcessorFn {
  processorName: string;
}

/**
 * 处理器配置项
 * 
 * 用于 runProcessors 编排器，支持条件执行和并行组。
 */
export interface ProcessorConfig {
  /** 处理器函数 */
  processor: ProcessorWithMeta;
  /** 条件执行：返回 true 才执行，返回 false 时跳过 */
  condition?: (context: ProcessorContext) => boolean;
  /** 所属并行组，同组处理器使用 Promise.all 并行执行 */
  parallelGroup?: string;
}

/**
 * Processor 日志条目
 * 
 * 用于记录到 ai_requests.processorLog
 */
export interface ProcessorLogEntry {
  processorName: string;
  executionTime: number;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  timestamp: string;
}

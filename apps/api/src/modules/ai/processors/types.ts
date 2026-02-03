/**
 * Processor 架构类型定义 (v4.8)
 * 
 * Processor 是 AI 请求处理链中的可组合单元，用于：
 * - 输入预处理（安全检查、用户画像注入、语义检索）
 * - 输出后处理（保存历史、提取偏好）
 * - Token 限制和截断
 * 
 * 设计原则：
 * - 纯函数：每个 Processor 都是无副作用的纯函数
 * - 可组合：Processors 可以串联执行
 * - 可观测：每个 Processor 记录执行时间和结果
 */

/**
 * 消息类型（简化版，兼容 ai 包的消息格式）
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | unknown;
}

/**
 * Processor 执行上下文
 * 
 * 包含 Processor 执行所需的所有信息
 */
export interface ProcessorContext {
  /** 用户 ID（可能为 null，表示未登录用户） */
  userId: string | null;
  
  /** 当前消息列表 */
  messages: Message[];
  
  /** 用户输入文本（最后一条 user 消息的内容） */
  userInput: string;
  
  /** 系统提示词 */
  systemPrompt: string;
  
  /** 用户画像（working memory） */
  userProfile?: string;
  
  /** 语义检索结果 */
  semanticContext?: string;
  
  /** P0 层匹配的关键词 ID */
  p0MatchKeyword?: string;
  
  /** 其他元数据 */
  metadata?: Record<string, unknown>;
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

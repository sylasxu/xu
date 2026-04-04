/**
 * Models Module Types - 模型抽象层类型定义
 * 
 * 架构设计：
 * - Chat: Moonshot / Qwen / DeepSeek
 * - Embedding: Qwen text-embedding-v4 (主力)
 * - 未来扩展: Doubao, OpenAI 等
 */

import type { LanguageModel } from 'ai';

/**
 * 模型提供商名称
 */
export type ModelProviderName = 'deepseek' | 'qwen' | 'doubao' | 'openai' | 'moonshot';

/**
 * 模型路由键
 *
 * 按 workload 区分，而不是只按通用 intent。
 */
export type ModelRouteKey =
  | 'chat'
  | 'reasoning'
  | 'agent'
  | 'vision'
  | 'content_generation'
  | 'content_topic_suggestions'
  | 'embedding'
  | 'rerank';

/**
 * 模型用途
 */
export type ModelPurpose = 'chat' | 'embedding' | 'rerank' | 'vision';

/**
 * 模型类型
 */
export type ModelType = 'chat' | 'embedding' | 'rerank';

export type EmbedTextType = 'document' | 'query';

/**
 * 模型配置
 */
export interface ModelConfig {
  /** 提供商 */
  provider: ModelProviderName;
  /** 模型 ID */
  modelId: string;
  /** 模型类型 */
  type: ModelType;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级（数字越小优先级越高） */
  priority: number;
}

/**
 * 单个模型路由选择
 */
export interface ModelRouteSelection {
  provider: ModelProviderName;
  modelId: string;
}

/**
 * 路由配置允许兼容旧字符串和显式 provider/model 对象
 */
export type ModelRouteConfigValue = string | ModelRouteSelection;

/**
 * 模型路由映射
 */
export type ModelRouteMap = Partial<Record<ModelRouteKey, ModelRouteConfigValue>>;

/**
 * Chat 请求参数
 */
export interface ChatParams {
  /** 模型 ID（可选，默认使用主力模型） */
  modelId?: string;
  /** 系统提示词 */
  system?: string;
  /** 消息列表 */
  messages: ChatMessage[];
  /** 温度 */
  temperature?: number;
  /** 最大 Token 数 */
  maxTokens?: number;
  /** 工具列表 */
  tools?: Record<string, unknown>;
  /** 是否流式 */
  stream?: boolean;
}

/**
 * Chat 消息
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCallPart[];
}

/**
 * Tool 调用部分
 */
export interface ToolCallPart {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Chat 响应
 */
export interface ChatResponse {
  /** 响应文本 */
  text: string;
  /** Tool 调用 */
  toolCalls?: ToolCallPart[];
  /** Token 用量 */
  usage: TokenUsage;
  /** 完成原因 */
  finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error';
}

/**
 * Token 用量
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** DeepSeek 缓存 Token */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Embedding 请求参数
 */
export interface EmbedParams {
  /** 模型 ID（可选） */
  modelId?: string;
  /** 文本列表 */
  texts: string[];
  /** 文本用途：入库文档或检索查询 */
  textType?: EmbedTextType;
}

/**
 * Embedding 响应
 */
export interface EmbedResponse {
  /** 向量列表 */
  embeddings: number[][];
  /** Token 用量 */
  usage: TokenUsage;
}

/**
 * Rerank 请求参数
 */
export interface RerankParams {
  /** 模型 ID（可选） */
  modelId?: string;
  /** 查询文本 */
  query: string;
  /** 文档列表 */
  documents: string[];
  /** 返回数量 */
  topK?: number;
}

/**
 * Rerank 响应
 */
export interface RerankResponse {
  /** 重排序结果 */
  results: RerankResult[];
  /** Token 用量 */
  usage: TokenUsage;
}

/**
 * Rerank 结果项
 */
export interface RerankResult {
  /** 文档索引 */
  index: number;
  /** 相关性分数 */
  score: number;
  /** 文档内容 */
  document: string;
}

/**
 * 模型提供商接口
 */
export interface ModelProvider {
  /** 提供商名称 */
  name: ModelProviderName;
  /** 获取 Chat 模型 */
  getChatModel: (modelId?: string) => LanguageModel;
  /** 获取 Embedding（部分提供商支持） */
  embed?: (params: EmbedParams) => Promise<EmbedResponse>;
  /** 执行 Rerank（部分提供商支持） */
  rerank?: (params: RerankParams) => Promise<RerankResponse>;
  /** 检查健康状态 */
  healthCheck: () => Promise<boolean>;
}

/**
 * 降级配置
 */
export interface FallbackConfig {
  /** 主力提供商 */
  primary: ModelProviderName;
  /** 备选提供商 */
  fallback: ModelProviderName;
  /** 重试次数 */
  maxRetries: number;
  /** 重试延迟（毫秒） */
  retryDelay: number;
  /** 是否启用降级 */
  enableFallback: boolean;
}

/**
 * 默认降级配置 (v5.4: Moonshot 主力 + Qwen 备选)
 */
export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  primary: 'moonshot',
  fallback: 'qwen',
  maxRetries: 2,
  retryDelay: 1000,
  enableFallback: true,
};

/**
 * 模型 ID 常量 - 按用途分类
 */
export const MODEL_IDS = {
  // ==========================================
  // Chat 模型 (对话/Agent)
  // ==========================================

  // DeepSeek - 主力 Chat
  DEEPSEEK_CHAT: 'deepseek-chat',
  DEEPSEEK_REASONER: 'deepseek-reasoner',

  // Moonshot / Kimi - 境内主力 Chat
  MOONSHOT_KIMI_K2_32K: 'kimi-k2-32k',

  // OpenAI - 主力 Chat（可通过 OPENAI_BASE_URL 接 OpenAI 兼容网关，如 sub2api）
  OPENAI_GPT_54: 'gpt-5.4',
  OPENAI_GPT_54_MINI: 'gpt-5.4-mini',


  // Qwen3 - 分层 Chat (v4.6 新增，使用 OpenAI 兼容接口)
  // 官方文档: https://help.aliyun.com/zh/model-studio/getting-started/models
  QWEN_FLASH: 'qwen-flash',                   // 极速闲聊 (最便宜，已升级至 Qwen3)
  QWEN_PLUS: 'qwen-plus',                     // 深度思考 (推荐，已升级至 Qwen3)
  QWEN_MAX: 'qwen3-max',                      // 精准 Tool Calling (最强，Qwen3 旗舰)
  QWEN_VL_MAX: 'qwen-vl-max',                 // 视觉理解

  // ==========================================
  // Embedding 模型 (向量化)
  // ==========================================

  // Qwen - 主力 Embedding
  QWEN_EMBEDDING: 'text-embedding-v4',


  // ==========================================
  // Rerank 模型 (v4.6 新增)
  // ==========================================
  QWEN_RERANK: 'qwen3-rerank',

} as const;

/**
 * 当前使用的模型配置
 */
export const ACTIVE_MODELS = {
  /** Chat 主力模型 (日常对话) */
  CHAT_PRIMARY: MODEL_IDS.MOONSHOT_KIMI_K2_32K,
  /** Chat 备选模型 */
  CHAT_FALLBACK: MODEL_IDS.QWEN_PLUS,
  /** 深度思考模型 (找搭子/复杂匹配) */
  REASONING: MODEL_IDS.MOONSHOT_KIMI_K2_32K,
  /** Agent 模型 (Tool Calling/Generative UI) */
  AGENT: MODEL_IDS.MOONSHOT_KIMI_K2_32K,
  /** 视觉模型 (识图) */
  VISION: MODEL_IDS.QWEN_VL_MAX,
  /** Embedding 主力模型 */
  EMBEDDING_PRIMARY: MODEL_IDS.QWEN_EMBEDDING,
  /** Rerank 模型 */
  RERANK: MODEL_IDS.QWEN_RERANK,
} as const;

/**
 * 默认模型路由（代码级兜底）。
 *
 * 说明：
 * - Chat / Reasoning / Agent 默认走 Moonshot（Kimi）
 * - 内容生成与主题建议默认跟随 Moonshot 主链路
 * - Embedding / Rerank / Vision 继续走 Qwen
 */
export const DEFAULT_MODEL_ROUTE_MAP: Record<ModelRouteKey, ModelRouteSelection> = {
  chat: {
    provider: 'moonshot',
    modelId: MODEL_IDS.MOONSHOT_KIMI_K2_32K,
  },
  reasoning: {
    provider: 'moonshot',
    modelId: MODEL_IDS.MOONSHOT_KIMI_K2_32K,
  },
  agent: {
    provider: 'moonshot',
    modelId: MODEL_IDS.MOONSHOT_KIMI_K2_32K,
  },
  vision: {
    provider: 'qwen',
    modelId: MODEL_IDS.QWEN_VL_MAX,
  },
  content_generation: {
    provider: 'moonshot',
    modelId: MODEL_IDS.MOONSHOT_KIMI_K2_32K,
  },
  content_topic_suggestions: {
    provider: 'moonshot',
    modelId: MODEL_IDS.MOONSHOT_KIMI_K2_32K,
  },
  embedding: {
    provider: 'qwen',
    modelId: MODEL_IDS.QWEN_EMBEDDING,
  },
  rerank: {
    provider: 'qwen',
    modelId: MODEL_IDS.QWEN_RERANK,
  },
};

/**
 * Embedding 维度配置
 */
export const EMBEDDING_DIMENSIONS = {
  /** Qwen text-embedding-v4 */
  QWEN: 1536,
} as const;

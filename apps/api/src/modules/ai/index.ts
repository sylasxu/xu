/**
 * AI Module - 模块化 AI 系统
 * 
 * v4.5 架构：
 * - agent/ - Agent 封装层 (Mastra 风格 Processors)
 * - rag/ - RAG 语义检索
 * - intent/ - 意图识别
 * - memory/ - 记忆系统（会话存储, WorkingMemory, 兴趣向量）
 * - tools/ - 工具系统
 * - prompts/ - 提示词
 * - models/ - 模型路由
 * - workflow/ - HITL 工作流
 * - guardrails/ - 安全护栏
 * - observability/ - 可观测性
 * - evals/ - 评估系统
 */

// Intent Module
export {
  classifyIntent as classifyIntentAsync,
  classifyByRegex,
  classifyDraftContext,
  classifyIntentSync,
  intentPatterns,
  intentPriority,
  draftModifyPatterns,
  getToolsForIntent as getToolsForIntentNew,
} from './intent';

export type {
  IntentType as IntentTypeNew,
  ClassifyResult,
  ClassifyContext,
} from './intent';

// Memory Module
export * from './memory';

// Agent Module (v4.5)
export * from './agent';

// RAG Module (v4.5)
export * from './rag';

// Tools Module
export {
  TOOL_DISPLAY_NAMES,
  TOOL_WIDGET_TYPES,
  getToolDisplayName,
  getToolWidgetType,
  WidgetType,
  buildDraftWidget,
  buildExploreWidget,
  buildAskPreferenceWidget,
  buildShareWidget,
  buildErrorWidget,
  // 新版统一入口
  resolveToolsForIntent,
  getToolNamesByIntent,
  getAllTools,
  getTool,
  // Tool factories
  createActivityDraftTool,
  getDraftTool,
  refineDraftTool,
  publishActivityTool,
  exploreNearbyTool,
  askPreferenceTool,
  joinActivityTool,
  cancelActivityTool,
  getMyActivitiesTool,
  getActivityDetailTool,
  createPartnerIntentTool,
  getMyIntentsTool,
  cancelIntentTool,
  confirmMatchTool,
  // Legacy exports (deprecated)
  getAIToolsV34,
  getToolsByIntent,
  getToolNamesForIntent,
} from './tools';

// Re-export classifyIntent and IntentType from intent module for backward compatibility
export { classifyIntent, type IntentType } from './intent';

export type {
  ToolContext,
  ToolResult,
  WidgetChunk,
  ToolDefinition,
  WidgetTypeValue,
  WidgetDraftPayload,
  WidgetExplorePayload,
  WidgetAskPreferencePayload,
  WidgetSharePayload,
  WidgetErrorPayload,
} from './tools';

// Prompts Module
export * from './prompts';

// Models Module (排除与 agent 冲突的类型)
export {
  getModel,
  getChatModel,
  getEmbedding,
  getEmbeddings,
  withRetry,
  withFallback,
  DEFAULT_FALLBACK_CONFIG,
  type ModelConfig,
  type FallbackConfig,
} from './models';

// Workflow Module
export * from './workflow';

// Guardrails Module
export * from './guardrails';

// Observability Module (排除与 models 冲突的类型)
export {
  // Tracer
  createTrace,
  getCurrentTraceId,
  getCurrentSpanId,
  startSpan,
  endSpan,
  addSpanEvent,
  setSpanAttribute,
  withSpan,
  withSpanSync,
  spanToTraceData,
  recordAIRequest,
  getAIRequestTrace,
  getSpansByTraceId,
  cleanupOldTraces,
  resetTraceContext,
  // Logger
  setLogLevel,
  getLogLevel,
  debug,
  info,
  warn,
  error,
  createLogger,
  getRecentLogs,
  getLogsByTraceId,
  clearLogs,
  // Metrics
  incrementCounter,
  countAIRequest,
  countToolCall,
  setGauge,
  setActiveSessions,
  recordHistogram,
  recordAILatency,
  recordTokenUsage,
  recordToolDuration,
  getMetric,
  getMetricNames,
  getMetricSummary,
  clearMetrics,
  cleanupOldMetrics,
  recordTokenUsageWithLog,
  getTokenUsageStats,
  getTokenUsageSummary,
  getToolCallStats,
  // Types
  type SpanStatus,
  type LogLevel,
  type Span,
  type SpanEvent,
  type LogEntry,
  type MetricPoint,
  type MetricType,
  type TraceData,
  type AIRequestTrace,
  type ObservabilityConfig,
  type DailyTokenUsage,
  type TokenUsageSummary,
  type ToolStats,
} from './observability';

// Evals Module
export * from './evals';

// Legacy exports from ai.service.ts (for backward compatibility)
export {
  handleChatStream,
  checkAIQuota,
  consumeAIQuota,
  getWelcomeCard,
  generateGreeting,
  listConversations,
  getConversationMessages,
  addMessageToConversation,
  getOrCreateCurrentConversation,
  getMessagesByActivityId,
  clearConversations,
  deleteConversation,
  deleteConversationsBatch,
  type ChatRequest,
  type WelcomeResponse,
  type WelcomeSection,
} from './ai.service';

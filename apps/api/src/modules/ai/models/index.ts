/**
 * Models Module - 模型抽象层
 * 
 * 支持 OpenAI 兼容网关 / Qwen / DeepSeek 的统一模型访问
 * 
 * 使用示例：
 * ```typescript
 * import { getChatModel, getEmbeddings, withRetry } from './models';
 * 
 * // 获取默认 Chat 模型
 * const model = getChatModel();
 * 
 * // 获取指定模型
 * const reasoner = getChatModel('deepseek-reasoner');
 * 
 * // 获取 Embedding（使用 Qwen）
 * const embeddings = await getEmbeddings(['text1', 'text2']);
 * 
 * // 带重试执行
 * const result = await withRetry(() => generateText({ model, prompt: '...' }));
 * ```
 */

// Types
export type {
  ModelProviderName,
  ModelRouteKey,
  ModelRouteSelection,
  ModelRouteConfigValue,
  ModelRouteMap,
  ModelType,
  ModelConfig,
  ChatParams,
  ChatMessage,
  ChatResponse,
  TokenUsage,
  EmbedParams,
  EmbedResponse,
  RerankParams,
  RerankResponse,
  RerankResult,
  ModelProvider,
  FallbackConfig,
  ToolCallPart,
} from './types';

export { DEFAULT_FALLBACK_CONFIG, MODEL_IDS, DEFAULT_MODEL_ROUTE_MAP } from './types';

// Router
export {
  getChatModel,
  getEmbeddings,
  getEmbedding,
  getModelRouteSelection,
  getDefaultChatModel,
  setFallbackConfig,
  getFallbackConfig,
  withRetry,
  withFallback,
  checkProviderHealth,
  checkAllProvidersHealth,
  getAvailableProviders,
  parseModelRouteIdentifier,
  normalizeModelRouteSelection,
} from './router';

// Adapters
export { deepseekProvider, getDeepSeekChat, getDeepSeekReasoner } from './adapters/deepseek';
export { openaiProvider, getOpenAIChat } from './adapters/openai';
export { runText, runObject, runStream } from './runtime';

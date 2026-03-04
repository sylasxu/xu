/**
 * Models Module - 模型抽象层
 * 
 * 只支持 DeepSeek（主力）+ 智谱（备选 Embedding）
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
 * // 获取 Embedding（使用智谱）
 * const embeddings = await getEmbeddings(['text1', 'text2']);
 * 
 * // 带重试执行
 * const result = await withRetry(() => generateText({ model, prompt: '...' }));
 * ```
 */

// Types
export type {
  ModelProviderName,
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

export { DEFAULT_FALLBACK_CONFIG, MODEL_IDS } from './types';

// Router
export {
  getChatModel,
  getEmbeddings,
  getEmbedding,
  getDefaultChatModel,
  setFallbackConfig,
  getFallbackConfig,
  withRetry,
  withFallback,
  checkProviderHealth,
  checkAllProvidersHealth,
  getAvailableProviders,
} from './router';

// Adapters
export { deepseekProvider, getDeepSeekChat, getDeepSeekReasoner } from './adapters/deepseek';
export { zhipuProvider, getZhipuEmbeddings, getZhipuEmbedding } from './adapters/zhipu';

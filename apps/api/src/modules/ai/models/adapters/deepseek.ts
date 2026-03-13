/**
 * DeepSeek Adapter - DeepSeek 模型适配器（主力）
 * 
 * 支持：
 * - Chat: deepseek-chat, deepseek-reasoner
 * - Embedding: 暂不支持（由 Qwen 提供）
 * - Rerank: 暂不支持
 */

import { createDeepSeek } from '@ai-sdk/deepseek';
import type { LanguageModel } from 'ai';
import type { ModelProvider } from '../types';
import { MODEL_IDS } from '../types';

/**
 * DeepSeek Provider 实例（懒加载）
 */
let _provider: ReturnType<typeof createDeepSeek> | null = null;

function getProvider() {
  if (!_provider) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY is not set');
    }
    _provider = createDeepSeek({ apiKey });
  }
  return _provider;
}

/**
 * 获取 DeepSeek Chat 模型
 */
/**
 * 获取 DeepSeek Chat 模型
 * 注意：必须用 .chat() 而非直接调用 provider()
 * @ai-sdk/openai v3 默认走 Responses API，DeepSeek 不支持
 */
function getChatModel(modelId?: string): LanguageModel {
  const id = modelId || MODEL_IDS.DEEPSEEK_CHAT;
  return getProvider().chat(id);
}

/**
 * 健康检查
 */
async function healthCheck(): Promise<boolean> {
  try {
    // 简单检查 API Key 是否存在
    const apiKey = process.env.DEEPSEEK_API_KEY;
    return !!apiKey && apiKey.length > 0;
  } catch {
    return false;
  }
}

/**
 * DeepSeek 模型提供商
 */
export const deepseekProvider: ModelProvider = {
  name: 'deepseek',
  getChatModel,
  // DeepSeek 暂不支持 Embedding 和 Rerank
  embed: undefined,
  rerank: undefined,
  healthCheck,
};

/**
 * 获取 DeepSeek Chat 模型（便捷函数）
 */
export function getDeepSeekChat(modelId?: string): LanguageModel {
  return getChatModel(modelId);
}

/**
 * 获取 DeepSeek Reasoner 模型
 */
export function getDeepSeekReasoner(): LanguageModel {
  return getChatModel(MODEL_IDS.DEEPSEEK_REASONER);
}


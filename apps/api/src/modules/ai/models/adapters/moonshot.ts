/**
 * Moonshot Adapter - Moonshot / Kimi 模型适配器
 *
 * 支持：
 * - Chat / Agent / 内容生成: kimi-k2.5
 * - 深度思考: kimi-k2-thinking
 *
 * 配置：
 * - 环境变量: MOONSHOT_API_KEY
 * - 可选环境变量: MOONSHOT_BASE_URL（默认 https://api.moonshot.cn/v1）
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { ModelProvider } from '../types';
import { MODEL_IDS } from '../types';

const MOONSHOT_BASE_URL = process.env.MOONSHOT_BASE_URL?.trim() || 'https://api.moonshot.cn/v1';

let _provider: ReturnType<typeof createOpenAI> | null = null;

function getApiKey(): string {
  const apiKey = process.env.MOONSHOT_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('MOONSHOT_API_KEY is not set');
  }

  return apiKey;
}

function getProvider() {
  if (!_provider) {
    _provider = createOpenAI({
      apiKey: getApiKey(),
      baseURL: MOONSHOT_BASE_URL,
    });
  }

  return _provider;
}

function getChatModel(modelId?: string): LanguageModel {
  const id = modelId || MODEL_IDS.MOONSHOT_KIMI_K2_5;
  return getProvider().chat(id);
}

async function healthCheck(): Promise<boolean> {
  try {
    const apiKey = process.env.MOONSHOT_API_KEY;
    return !!apiKey && apiKey.length > 0;
  } catch {
    return false;
  }
}

export const moonshotProvider: ModelProvider = {
  name: 'moonshot',
  getChatModel,
  embed: undefined,
  rerank: undefined,
  healthCheck,
};

export function getMoonshotChat(modelId?: string): LanguageModel {
  return getChatModel(modelId);
}

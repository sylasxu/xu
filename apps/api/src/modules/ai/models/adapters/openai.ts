/**
 * OpenAI Adapter - OpenAI / OpenAI 兼容网关模型适配器
 *
 * 支持：
 * - Chat: gpt-5.4
 *
 * 配置：
 * - 环境变量: OPENAI_API_KEY
 * - 可选环境变量: OPENAI_BASE_URL（如 sub2api 的 OpenAI 兼容 /v1 地址）
 * - 可选环境变量: OPENAI_ORG_ID / OPENAI_PROJECT
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { ModelProvider } from '../types';
import { MODEL_IDS } from '../types';

let _provider: ReturnType<typeof createOpenAI> | null = null;

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  return apiKey;
}

function getProvider() {
  if (!_provider) {
    const apiKey = getApiKey();
    const baseURL = process.env.OPENAI_BASE_URL?.trim();
    const organization = process.env.OPENAI_ORG_ID?.trim();
    const project = process.env.OPENAI_PROJECT?.trim();

    _provider = createOpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(organization ? { organization } : {}),
      ...(project ? { project } : {}),
    });
  }

  return _provider;
}

function getChatModel(modelId?: string): LanguageModel {
  const id = modelId || MODEL_IDS.OPENAI_GPT_54;
  return getProvider().chat(id);
}

async function healthCheck(): Promise<boolean> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    return !!apiKey && apiKey.length > 0;
  } catch {
    return false;
  }
}

export const openaiProvider: ModelProvider = {
  name: 'openai',
  getChatModel,
  embed: undefined,
  rerank: undefined,
  healthCheck,
};

export function getOpenAIChat(modelId?: string): LanguageModel {
  return getChatModel(modelId);
}

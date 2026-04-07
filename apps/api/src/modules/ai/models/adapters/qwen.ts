/**
 * Qwen Adapter - 阿里通义千问模型适配器
 *
 * 当前仅保留 Embedding 能力：
 * - Embedding: text-embedding-v4
 *
 * 配置：
 * - 环境变量: DASHSCOPE_API_KEY
 * - 维度: 1536 (可选 64-2048)
 */

import type { LanguageModel } from 'ai';
import type { ModelProvider, EmbedResponse, EmbedParams } from '../types';
import { MODEL_IDS, EMBEDDING_DIMENSIONS } from '../types';

/**
 * 阿里云百炼 API 基础 URL (OpenAI 兼容)
 */
const DASHSCOPE_BASE_URL = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

/**
 * Qwen Embedding 模型 ID
 */
export const QWEN_EMBEDDING_MODEL = MODEL_IDS.QWEN_EMBEDDING;

/**
 * 默认向量维度
 * 1536 维：平衡语义表达和存储成本
 */
export const QWEN_EMBEDDING_DIMENSION = EMBEDDING_DIMENSIONS.QWEN;

interface QwenEmbeddingPayload {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const numbers: number[] = [];
  for (const item of value) {
    const number = readNumber(item);
    if (number === null) {
      return null;
    }
    numbers.push(number);
  }

  return numbers;
}

function readEmbeddingPayload(value: unknown): QwenEmbeddingPayload | null {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.usage)) {
    return null;
  }

  const data: QwenEmbeddingPayload['data'] = [];
  for (const item of value.data) {
    if (!isRecord(item)) {
      return null;
    }

    const embedding = readNumberArray(item.embedding);
    const index = readNumber(item.index);
    if (!embedding || index === null) {
      return null;
    }

    data.push({ embedding, index });
  }

  const promptTokens = readNumber(value.usage.prompt_tokens);
  const totalTokens = readNumber(value.usage.total_tokens);
  if (promptTokens === null || totalTokens === null) {
    return null;
  }

  return {
    data,
    usage: {
      prompt_tokens: promptTokens,
      total_tokens: totalTokens,
    },
  };
}

/**
 * 获取 DashScope API Key
 */
function getApiKey(): string {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('DASHSCOPE_API_KEY is not set');
  }
  return apiKey;
}

function getChatModel(modelId?: string): LanguageModel {
  throw new Error(`Qwen provider only supports embedding, chat model "${modelId || 'default'}" is not allowed`);
}

/**
 * Qwen Embedding（通过 OpenAI 兼容接口）
 * 
 * 使用 text-embedding-v4 模型，1536 维
 */
async function embed(params: EmbedParams): Promise<EmbedResponse> {
  const apiKey = getApiKey();
  const modelId = params.modelId || QWEN_EMBEDDING_MODEL;

  const response = await fetch(`${DASHSCOPE_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      input: params.texts,
      dimensions: QWEN_EMBEDDING_DIMENSION,
      ...(params.textType ? { text_type: params.textType } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Qwen embedding failed: ${error}`);
  }

  const data = readEmbeddingPayload(await response.json());
  if (!data) {
    throw new Error('Qwen embedding returned an invalid payload');
  }

  // 按 index 排序确保顺序正确
  const sortedData = [...data.data].sort((a, b) => a.index - b.index);

  return {
    embeddings: sortedData.map(d => d.embedding),
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: 0,
      totalTokens: data.usage.total_tokens,
    },
  };
}

/**
 * 健康检查
 */
async function healthCheck(): Promise<boolean> {
  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    return !!apiKey && apiKey.length > 0;
  } catch {
    return false;
  }
}

/**
 * Qwen 模型提供商
 */
export const qwenProvider: ModelProvider = {
  name: 'qwen',
  getChatModel,
  embed,
  healthCheck,
};

/**
 * 获取 Qwen Embedding（便捷函数）
 * 
 * 直接返回向量，使用 1536 维
 */
export async function getQwenEmbeddings(texts: string[], textType?: EmbedParams['textType']): Promise<number[][]> {
  const result = await embed({ texts, ...(textType ? { textType } : {}) });
  return result.embeddings;
}

/**
 * 获取单个文本的 Embedding
 */
export async function getQwenEmbedding(text: string, textType?: EmbedParams['textType']): Promise<number[]> {
  const result = await embed({ texts: [text], ...(textType ? { textType } : {}) });
  const embedding = result.embeddings[0];
  if (!embedding) {
    throw new Error('Qwen embedding result is empty');
  }
  return embedding;
}

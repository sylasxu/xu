/**
 * Qwen Adapter - 阿里通义千问模型适配器 (v4.6 升级)
 * 
 * 使用阿里云百炼平台的 OpenAI 兼容接口
 * 
 * 支持：
 * - Chat: qwen-flash (极速), qwen-plus (深度思考), qwen3-max (精准 Agent)
 * - Embedding: text-embedding-v4 (Qwen3-Embedding 系列)
 * - Rerank: qwen3-rerank (检索重排)
 * - Vision: qwen3-vl-plus (视觉理解)
 * 
 * 配置：
 * - 环境变量: DASHSCOPE_API_KEY
 * - 维度: 1536 (可选 64-2048)
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { ModelProvider, EmbedResponse, EmbedParams, RerankParams, RerankResponse } from '../types';
import { MODEL_IDS, EMBEDDING_DIMENSIONS, ACTIVE_MODELS } from '../types';

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

interface QwenRerankPayload {
  output: {
    results: Array<{
      index: number;
      relevance_score: number;
      document: {
        text: string;
      };
    }>;
  };
  usage: {
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

function readRerankPayload(value: unknown): QwenRerankPayload | null {
  if (!isRecord(value) || !isRecord(value.output) || !Array.isArray(value.output.results) || !isRecord(value.usage)) {
    return null;
  }

  const results: QwenRerankPayload['output']['results'] = [];
  for (const item of value.output.results) {
    if (!isRecord(item) || !isRecord(item.document)) {
      return null;
    }

    const index = readNumber(item.index);
    const relevanceScore = readNumber(item.relevance_score);
    const documentText = typeof item.document.text === 'string' ? item.document.text : null;
    if (index === null || relevanceScore === null || documentText === null) {
      return null;
    }

    results.push({
      index,
      relevance_score: relevanceScore,
      document: {
        text: documentText,
      },
    });
  }

  const totalTokens = readNumber(value.usage.total_tokens);
  if (totalTokens === null) {
    return null;
  }

  return {
    output: { results },
    usage: { total_tokens: totalTokens },
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

/**
 * 创建 Qwen OpenAI 兼容客户端
 */
function createQwenClient() {
  return createOpenAI({
    baseURL: DASHSCOPE_BASE_URL,
    apiKey: getApiKey(),
  });
}

/**
 * Qwen Chat 模型
 * 
 * 支持：
 * - qwen-flash: 极速响应，日常闲聊
 * - qwen-plus: 深度思考，复杂推理（找搭子）
 * - qwen3-max: 精准 Tool Calling，Generative UI
 * 
 * 注意：必须使用 .chat() 而非直接调用 provider()
 * @ai-sdk/openai v3 默认走 Responses API (/responses)，DashScope 不支持
 * .chat() 显式走 Chat Completions API (/chat/completions)
 */
function getChatModel(modelId?: string): LanguageModel {
  const qwen = createQwenClient();
  const id = modelId || ACTIVE_MODELS.CHAT_PRIMARY;
  return qwen.chat(id);
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
 * Qwen Rerank (v4.6 新增)
 * 
 * 使用 qwen3-rerank 对检索结果进行语义重排序
 * 
 * @param params - 重排序参数
 * @returns 重排序结果
 */
async function rerank(params: RerankParams): Promise<RerankResponse> {
  const apiKey = getApiKey();
  const modelId = params.modelId || ACTIVE_MODELS.RERANK;
  const topK = params.topK || 10;

  // 调用百炼 Rerank API
  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      input: {
        query: params.query,
        documents: params.documents,
      },
      parameters: {
        top_n: topK,
        return_documents: true,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Qwen rerank failed: ${error}`);
  }

  const data = readRerankPayload(await response.json());
  if (!data) {
    throw new Error('Qwen rerank returned an invalid payload');
  }

  return {
    results: data.output.results.map(r => ({
      index: r.index,
      score: r.relevance_score,
      document: r.document.text,
    })),
    usage: {
      inputTokens: data.usage.total_tokens,
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
  rerank,
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

/**
 * Qwen Rerank（便捷函数）
 */
export async function qwenRerank(
  query: string,
  documents: string[],
  topK: number = 10
): Promise<RerankResponse> {
  return rerank({ query, documents, topK });
}

/**
 * 按意图获取模型 (v4.6 新增)
 * 
 * @param intent - 意图类型
 * @returns 对应的 LanguageModel
 */
export function getQwenModelByIntent(intent: 'chat' | 'reasoning' | 'agent' | 'vision'): LanguageModel {
  const qwen = createQwenClient();

  switch (intent) {
    case 'chat':
      return qwen.chat(ACTIVE_MODELS.CHAT_PRIMARY);  // qwen-flash
    case 'reasoning':
      return qwen.chat(ACTIVE_MODELS.REASONING);     // qwen-plus (深度思考)
    case 'agent':
      return qwen.chat(ACTIVE_MODELS.AGENT);         // qwen3-max (Tool Calling)
    case 'vision':
      return qwen.chat(ACTIVE_MODELS.VISION);        // qwen3-vl-plus
    default:
      return qwen.chat(ACTIVE_MODELS.CHAT_PRIMARY);
  }
}

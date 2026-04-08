/**
 * Model Router - 模型路由器 (v4.6 升级)
 * 
 * 提供统一的模型访问接口，支持降级和意图路由
 * 
 * 策略 (v4.6):
 * - 主力 Chat / Reasoning / Agent / Vision: Moonshot / Kimi
 * - Embedding: Qwen text-embedding-v4
 * - Rerank: 本地轻量排序
 */

import type { LanguageModel } from 'ai';
import { moonshotProvider } from './adapters/moonshot';
import { openaiProvider } from './adapters/openai';
import { qwenProvider } from './adapters/qwen';
import type {
  ModelProvider,
  ModelProviderName,
  FallbackConfig,
  RerankResponse,
  EmbedTextType,
  ModelRouteConfigValue,
  ModelRouteKey,
  ModelRouteMap,
  ModelRouteSelection,
} from './types';
import {
  DEFAULT_FALLBACK_CONFIG,
  ACTIVE_MODELS,
  DEFAULT_MODEL_ROUTE_MAP,
  MODEL_IDS,
} from './types';
import { getConfigValue } from '../config/config.service';

/**
 * 提供商映射
 */
const providers: Partial<Record<ModelProviderName, ModelProvider>> = {
  moonshot: moonshotProvider,
  openai: openaiProvider,
  qwen: qwenProvider,
};

/**
 * 当前降级配置
 */
let fallbackConfig: FallbackConfig = { ...DEFAULT_FALLBACK_CONFIG };

function normalizeFallbackConfig(config: Partial<FallbackConfig> | null | undefined): FallbackConfig {
  const merged: FallbackConfig = {
    ...DEFAULT_FALLBACK_CONFIG,
    ...(config ?? {}),
  };

  if (merged.fallback === merged.primary) {
    return {
      ...merged,
      enableFallback: false,
    };
  }

  return merged;
}

const EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000;

const embeddingCache = new Map<string, { expiresAt: number; embedding: number[] }>();

function inferProviderFromModelId(modelId?: string): ModelProviderName | undefined {
  if (!modelId) {
    return undefined;
  }

  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith('qwen')) {
    return 'qwen';
  }

  if (normalized.startsWith('kimi')) {
    return 'moonshot';
  }

  if (normalized.startsWith('moonshot')) {
    return 'moonshot';
  }

  if (normalized.startsWith('doubao')) {
    return 'doubao';
  }

  if (
    normalized.startsWith('gpt')
    || normalized.startsWith('o1')
    || normalized.startsWith('o3')
    || normalized.startsWith('o4')
  ) {
    return 'openai';
  }

  return undefined;
}

export function shouldOmitTemperatureForModelId(modelId?: string): boolean {
  return inferProviderFromModelId(modelId) === 'moonshot';
}

function isModelProviderName(value: string): value is ModelProviderName {
  return value === 'openai' || value === 'qwen' || value === 'doubao' || value === 'moonshot';
}

export function parseModelRouteIdentifier(identifier: string): ModelRouteSelection | null {
  const normalized = identifier.trim();
  const separatorIndex = normalized.indexOf('/');

  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    return null;
  }

  const provider = normalized.slice(0, separatorIndex).trim();
  const modelId = normalized.slice(separatorIndex + 1).trim();

  if (!isModelProviderName(provider) || !modelId) {
    return null;
  }

  return {
    provider,
    modelId,
  };
}

export function normalizeModelRouteSelection(
  value: ModelRouteConfigValue | undefined | null
): ModelRouteSelection | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const explicitRoute = parseModelRouteIdentifier(value);
    if (explicitRoute) {
      return explicitRoute;
    }

    const provider = inferProviderFromModelId(value);
    if (!provider) {
      return null;
    }

    return {
      provider,
      modelId: value.trim(),
    };
  }

  const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
  const modelId = typeof value.modelId === 'string' ? value.modelId.trim() : '';

  if (!provider || !modelId || !isModelProviderName(provider)) {
    return null;
  }

  return {
    provider,
    modelId,
  };
}

const LEGACY_INTENT_ROUTE_KEYS = ['chat', 'reasoning', 'agent', 'vision'] as const;
type LegacyIntentRouteKey = typeof LEGACY_INTENT_ROUTE_KEYS[number];

function isLegacyIntentRouteKey(routeKey: ModelRouteKey): routeKey is LegacyIntentRouteKey {
  return (LEGACY_INTENT_ROUTE_KEYS as readonly string[]).includes(routeKey);
}

async function getConfiguredModelRouteMap(): Promise<ModelRouteMap> {
  return getConfigValue<ModelRouteMap>('model.route_map', {});
}

async function getLegacyIntentMap(): Promise<Record<string, unknown>> {
  return getConfigValue<Record<string, unknown>>('model.intent_map', {});
}

export async function getModelRouteSelection(routeKey: ModelRouteKey): Promise<ModelRouteSelection> {
  const routeMap = await getConfiguredModelRouteMap();
  const explicitSelection = normalizeModelRouteSelection(routeMap[routeKey]);
  if (explicitSelection) {
    return explicitSelection;
  }

  if (isLegacyIntentRouteKey(routeKey)) {
    const legacyIntentMap = await getLegacyIntentMap();
    const legacySelection = normalizeModelRouteSelection(
      legacyIntentMap[routeKey] as ModelRouteConfigValue | undefined,
    );
    if (legacySelection) {
      return legacySelection;
    }
  }

  return DEFAULT_MODEL_ROUTE_MAP[routeKey];
}

/**
 * 设置降级配置
 */
export function setFallbackConfig(config: Partial<FallbackConfig>): void {
  fallbackConfig = normalizeFallbackConfig({ ...fallbackConfig, ...config });
}

/**
 * 获取降级配置（优先从数据库加载，降级到内存/默认值）
 */
export async function getFallbackConfig(): Promise<FallbackConfig> {
  const dbConfig = await getConfigValue<Partial<FallbackConfig>>('model.fallback_config', {});
  return normalizeFallbackConfig({ ...fallbackConfig, ...dbConfig });
}

/**
 * 获取 Chat 模型（带降级）
 * 
 * @param modelId - 模型 ID（可选）
 * @param preferredProvider - 首选提供商（可选）
 */
export function getChatModel(
  modelId?: string,
  preferredProvider?: ModelProviderName,
  options?: {
    allowFallback?: boolean;
  }
): LanguageModel {
  const explicitSelection = normalizeModelRouteSelection(modelId ?? null);
  const resolvedModelId = explicitSelection?.modelId ?? modelId;
  const primary = preferredProvider || explicitSelection?.provider || inferProviderFromModelId(modelId) || fallbackConfig.primary;
  const allowFallback = options?.allowFallback ?? fallbackConfig.enableFallback;

  try {
    const provider = providers[primary];
    if (!provider) {
      throw new Error(`Provider ${primary} not found`);
    }
    return provider.getChatModel(resolvedModelId);
  } catch (error) {
    if (!allowFallback) {
      throw error;
    }

    console.warn(`[ModelRouter] ${primary} failed, falling back to ${fallbackConfig.fallback}`, error);
    const fallbackProvider = providers[fallbackConfig.fallback];
    if (!fallbackProvider) {
      throw new Error(`Fallback provider ${fallbackConfig.fallback} not found`);
    }
    return fallbackProvider.getChatModel();
  }
}

function getDefaultChatModelIdForProvider(
  provider: ModelProviderName,
  routeKey: Exclude<ModelRouteKey, 'embedding' | 'rerank'>,
): string {
  switch (provider) {
    case 'qwen':
      return MODEL_IDS.QWEN_EMBEDDING;
    case 'moonshot':
      switch (routeKey) {
        case 'reasoning':
          return MODEL_IDS.MOONSHOT_KIMI_K2_5;
        case 'vision':
          return DEFAULT_MODEL_ROUTE_MAP.vision.modelId;
        default:
          return MODEL_IDS.MOONSHOT_KIMI_K2_5;
      }
    case 'openai':
      return DEFAULT_MODEL_ROUTE_MAP.chat.modelId;
    case 'doubao':
      return DEFAULT_MODEL_ROUTE_MAP.chat.modelId;
    default:
      return DEFAULT_MODEL_ROUTE_MAP.chat.modelId;
  }
}

function normalizeEmbeddingCacheKey(modelId: string, textType: EmbedTextType, text: string): string {
  return `${modelId}::${textType}::${text.trim()}`;
}

function readCachedEmbedding(cacheKey: string): number[] | null {
  const cached = embeddingCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    embeddingCache.delete(cacheKey);
    return null;
  }

  return cached.embedding;
}

function writeCachedEmbedding(cacheKey: string, embedding: number[]): void {
  embeddingCache.set(cacheKey, {
    expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS,
    embedding,
  });
}

/**
 * 获取 Embedding（使用 Qwen text-embedding-v4）
 * 
 * v4.6: 切换主力为 Qwen
 */
export async function getEmbeddings(
  texts: string[],
  options?: { textType?: EmbedTextType }
): Promise<number[][]> {
  const selection = await getModelRouteSelection('embedding');
  const provider = providers[selection.provider];
  const textType = options?.textType ?? 'document';

  if (!provider?.embed) {
    throw new Error(`Provider ${selection.provider} does not support embedding`);
  }

  const resolved: number[][] = new Array(texts.length);
  const uncachedTexts: string[] = [];
  const uncachedIndexes: number[] = [];

  for (const [index, text] of texts.entries()) {
    const cacheKey = normalizeEmbeddingCacheKey(selection.modelId, textType, text);
    const cachedEmbedding = readCachedEmbedding(cacheKey);
    if (cachedEmbedding) {
      resolved[index] = cachedEmbedding;
      continue;
    }

    uncachedTexts.push(text);
    uncachedIndexes.push(index);
  }

  if (uncachedTexts.length > 0) {
    const result = await provider.embed({
      modelId: selection.modelId,
      texts: uncachedTexts,
      textType,
    });

    for (const [offset, embedding] of result.embeddings.entries()) {
      const targetIndex = uncachedIndexes[offset];
      if (targetIndex === undefined || !embedding) {
        continue;
      }

      resolved[targetIndex] = embedding;
      writeCachedEmbedding(
        normalizeEmbeddingCacheKey(selection.modelId, textType, texts[targetIndex]),
        embedding,
      );
    }
  }

  return resolved;
}

/**
 * 获取单个文本的 Embedding
 */
export async function getEmbedding(
  text: string,
  options?: { textType?: EmbedTextType }
): Promise<number[]> {
  const embeddings = await getEmbeddings([text], options);
  return embeddings[0];
}

/**
 * 获取默认 Chat 模型（兼容旧调用）。
 *
 * 新主链路请优先使用 resolveChatModelSelection，从 AI 配置读取默认模型。
 */
export function getDefaultChatModel(): LanguageModel {
  const selection = DEFAULT_MODEL_ROUTE_MAP.chat;
  return getChatModel(selection.modelId, selection.provider, { allowFallback: true });
}

type IntentModelType = LegacyIntentRouteKey;

export async function getModelIdByIntent(intent: IntentModelType): Promise<string> {
  const selection = await getModelRouteSelection(intent);
  return selection.modelId;
}

export async function resolveChatModelSelection(params?: {
  routeKey?: Exclude<ModelRouteKey, 'embedding' | 'rerank'>;
  intent?: IntentModelType;
  modelId?: string;
  preferredProvider?: ModelProviderName;
}): Promise<{ provider: ModelProviderName; modelId: string; model: LanguageModel }> {
  const explicitModelId = params?.modelId?.trim();
  let selection: ModelRouteSelection;

  if (explicitModelId) {
    selection = normalizeModelRouteSelection(explicitModelId)
      || (
        params?.preferredProvider
          ? {
              provider: params.preferredProvider,
              modelId: explicitModelId,
            }
          : null
      )
      || (
        inferProviderFromModelId(explicitModelId)
          ? {
              provider: inferProviderFromModelId(explicitModelId)!,
              modelId: explicitModelId,
            }
          : null
      )
      || DEFAULT_MODEL_ROUTE_MAP.chat;
  } else {
    const routeKey = params?.routeKey || params?.intent || 'chat';
    selection = await getModelRouteSelection(routeKey);
  }

  return {
    provider: selection.provider,
    modelId: selection.modelId,
    model: getChatModel(selection.modelId, params?.preferredProvider || selection.provider, { allowFallback: true }),
  };
}

export async function resolveFallbackChatModelSelection(params?: {
  routeKey?: Exclude<ModelRouteKey, 'embedding' | 'rerank'>;
  intent?: IntentModelType;
}): Promise<{ provider: ModelProviderName; modelId: string; model: LanguageModel }> {
  const routeKey = params?.routeKey || params?.intent || 'chat';
  const currentFallbackConfig = await getFallbackConfig();
  if (!currentFallbackConfig.enableFallback) {
    throw new Error('Fallback is disabled');
  }
  const provider = currentFallbackConfig.fallback;
  const modelId = getDefaultChatModelIdForProvider(provider, routeKey);

  return {
    provider,
    modelId,
    model: getChatModel(modelId, provider, { allowFallback: true }),
  };
}

/**
 * 按意图获取模型 (v4.6)
 * 
 * 通过 AI 配置 `model.intent_map` 读取意图→模型映射，配置缺失时直接失败。
 */
export async function getModelByIntent(intent: 'chat' | 'reasoning' | 'agent' | 'vision'): Promise<LanguageModel> {
  const { model } = await resolveChatModelSelection({ intent });
  return model;
}

/**
 * Rerank 检索重排
 *
 * 当前使用本地轻量排序，不再依赖外部 Qwen rerank 模型。
 */
export async function rerank(
  query: string,
  documents: string[],
  topK: number = 10
): Promise<RerankResponse> {
  const queryTokens = tokenizeForLocalRerank(query);
  const scored = documents.map((document, index) => ({
    index,
    document,
    score: computeLocalRerankScore(queryTokens, document),
  }));

  const results = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, topK));

  return {
    results,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  };
}

/**
 * 默认最大重试延迟（30 秒）
 */
const DEFAULT_MAX_RETRY_DELAY = 30_000;

/**
 * 执行带重试的操作
 * 
 * v4.6: 指数退避增加 MAX_RETRY_DELAY 上限，通过 getConfigValue 动态配置
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: {
    maxRetries?: number;
    retryDelay?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? fallbackConfig.maxRetries;
  const retryDelay = options?.retryDelay ?? fallbackConfig.retryDelay;
  const maxRetryDelay = await getConfigValue('model.max_retry_delay', DEFAULT_MAX_RETRY_DELAY);

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        options?.onRetry?.(attempt + 1, error);
        // 指数退避 + 随机抖动，受 maxRetryDelay 上限约束
        const delay = Math.min(
          retryDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5),
          maxRetryDelay,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * 执行带降级的操作
 */
export async function withFallback<T>(
  primaryOp: () => Promise<T>,
  fallbackOp: () => Promise<T>,
  options?: {
    onFallback?: (error: unknown) => void;
  }
): Promise<T> {
  if (!fallbackConfig.enableFallback) {
    return primaryOp();
  }

  try {
    return await primaryOp();
  } catch (error) {
    options?.onFallback?.(error);
    console.warn('[ModelRouter] Primary operation failed, using fallback', error);
    return fallbackOp();
  }
}

/**
 * 检查提供商健康状态
 */
export async function checkProviderHealth(
  providerName: ModelProviderName
): Promise<boolean> {
  const provider = providers[providerName];
  if (!provider) {
    return false;
  }
  return provider.healthCheck();
}

/**
 * 检查所有提供商健康状态
 * 
 * v5.4: 检查当前实际使用的 moonshot + qwen(embedding)
 */
export async function checkAllProvidersHealth(): Promise<Partial<Record<ModelProviderName, boolean>>> {
  const results = await Promise.all([
    checkProviderHealth('moonshot'),
    checkProviderHealth('qwen'),
  ]);

  return {
    moonshot: results[0],
    qwen: results[1],
  };
}

/**
 * 获取可用的提供商
 */
export async function getAvailableProviders(): Promise<ModelProviderName[]> {
  const health = await checkAllProvidersHealth();
  return (Object.entries(health) as [ModelProviderName, boolean][])
    .filter(([, healthy]) => healthy)
    .map(([name]) => name);
}

// ============ 内部工具函数 ============

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tokenizeForLocalRerank(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[\s|,.;:!?/\-_()\[\]{}，。！？、：；"'`]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function computeLocalRerankScore(queryTokens: string[], document: string): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const normalizedDocument = document.toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (normalizedDocument.includes(token)) {
      hits += 1;
    }
  }

  const coverage = hits / queryTokens.length;
  const densityBoost = Math.min(normalizedDocument.length / 120, 1);
  return coverage * 0.9 + densityBoost * 0.1;
}

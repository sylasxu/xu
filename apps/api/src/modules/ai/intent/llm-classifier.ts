/**
 * P2 LLM Few-shot 分类器
 *
 * 当 P1（Feature_Combination）置信度不足时，使用 LLM + Few-shot prompting 进行深度意图分类。
 * 维护编辑距离缓存（全局单例，跨会话共享，内存存储），避免相似输入重复调用 LLM。
 *
 * 缓存策略：
 * - 分类前检查缓存：对所有缓存 key 计算编辑距离，距离 < 3 且未过期则复用
 * - 分类后写入缓存（key = input, TTL = 5 分钟）
 * - 缓存上限 1000 条，超出时 LRU 淘汰（删除最早 timestamp 的条目）
 */

import { runText } from '../models/runtime';
import { resolveChatModelSelection } from '../models/router';
import { getConfigValue } from '../config/config.service';
import type { IntentType, ClassifyResult } from './types';

// ============================================================
// 接口定义
// ============================================================

/** Few-shot 标注样例 */
export interface FewShotExample {
  /** 用户输入 */
  input: string;
  /** 正确意图 */
  intent: IntentType;
  /** 分类理由 */
  explanation: string;
}

/** 编辑距离缓存 */
export interface EditDistanceCache {
  /** 缓存条目：key 为用户输入，value 为分类结果 + 时间戳 */
  entries: Map<string, { intent: IntentType; confidence: number; timestamp: number }>;
  /** 过期时间（毫秒） */
  ttlMs: number;
}

// ============================================================
// 默认 Few-shot 样例
// ============================================================

/** 默认内置 Few-shot 样例（覆盖主要意图） */
export const DEFAULT_FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    input: '帮我组个火锅局',
    intent: 'create',
    explanation: '用户明确要创建活动',
  },
  {
    input: '附近有什么好玩的',
    intent: 'explore',
    explanation: '用户在探索附近活动',
  },
  {
    input: '找个人一起打羽毛球',
    intent: 'partner',
    explanation: '用户想找搭子一起运动',
  },
  {
    input: '你是谁呀',
    intent: 'chitchat',
    explanation: '用户在闲聊，不涉及具体功能',
  },
  {
    input: '对，就这样发布吧',
    intent: 'confirm',
    explanation: '用户确认 AI 的提议',
  },
  {
    input: '算了不找了',
    intent: 'cancel',
    explanation: '用户取消当前操作',
  },
  {
    input: '把时间改成后天下午',
    intent: 'modify',
    explanation: '用户想修改已有信息',
  },
  {
    input: '我发过哪些活动',
    intent: 'show_activity',
    explanation: '用户想查看自己的活动历史',
  },
];

// ============================================================
// 全局单例缓存
// ============================================================

/** 全局编辑距离缓存（跨会话共享，内存存储） */
export const globalEditDistanceCache: EditDistanceCache = {
  entries: new Map(),
  ttlMs: 5 * 60 * 1000, // 5 分钟
};

// ============================================================
// 编辑距离
// ============================================================

/**
 * 计算两个字符串的 Levenshtein 编辑距离
 *
 * 使用动态规划，空间优化为 O(min(m, n))。
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // 确保 a 是较短的字符串，优化空间
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;

  // 只需要两行：前一行和当前行
  let prev = new Array(aLen + 1);
  let curr = new Array(aLen + 1);

  for (let i = 0; i <= aLen; i++) {
    prev[i] = i;
  }

  for (let j = 1; j <= bLen; j++) {
    curr[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,      // 删除
        curr[i - 1] + 1,  // 插入
        prev[i - 1] + cost // 替换
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[aLen];
}


// ============================================================
// 缓存操作
// ============================================================

/**
 * 从缓存中查找编辑距离 < 3 且未过期的匹配
 *
 * 遍历所有缓存 key，计算编辑距离，返回最近的匹配。
 */
function findCacheHit(
  input: string,
  cache: EditDistanceCache,
): { intent: IntentType; confidence: number } | null {
  const now = Date.now();

  for (const [key, entry] of cache.entries) {
    // 跳过已过期的条目
    if (now - entry.timestamp > cache.ttlMs) continue;

    if (editDistance(input, key) < 3) {
      return { intent: entry.intent, confidence: entry.confidence };
    }
  }

  return null;
}

/**
 * 写入缓存，超过 1000 条时 LRU 淘汰（删除最早 timestamp 的条目）
 */
function writeCache(
  input: string,
  intent: IntentType,
  confidence: number,
  cache: EditDistanceCache,
): void {
  // LRU 淘汰：超过 1000 条时删除最早的条目
  if (cache.entries.size >= 1000) {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of cache.entries) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      cache.entries.delete(oldestKey);
    }
  }

  cache.entries.set(input, {
    intent,
    confidence,
    timestamp: Date.now(),
  });
}

// ============================================================
// LLM Few-shot 分类
// ============================================================

/** 有效意图类型列表（用于验证 LLM 返回） */
const VALID_INTENTS: IntentType[] = [
  'create', 'explore', 'manage', 'partner', 'chitchat',
  'idle', 'unknown', 'modify', 'confirm', 'deny', 'cancel',
  'share', 'join', 'show_activity',
];

const INTENT_ALIASES: Record<string, IntentType> = {
  rent: 'create',
  create_activity: 'create',
  createactivity: 'create',
  explore_nearby: 'explore',
  explorenearby: 'explore',
  nearby: 'explore',
  find_partner: 'partner',
  findpartner: 'partner',
  partner_intent: 'partner',
  partnerintent: 'partner',
  showactivity: 'show_activity',
  get_my_activities: 'show_activity',
  getmyactivities: 'show_activity',
  chat: 'chitchat',
  casual_chat: 'chitchat',
  casualchat: 'chitchat',
  reject: 'deny',
  approve: 'confirm',
};

function normalizeIntentCandidate(value: unknown): IntentType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if ((VALID_INTENTS as string[]).includes(normalized)) {
    return normalized as IntentType;
  }

  return INTENT_ALIASES[normalized] ?? null;
}

/**
 * 构建 Few-shot prompt
 */
function buildFewShotPrompt(
  input: string,
  conversationHistory: Array<{ role: string; content: string }>,
  examples: FewShotExample[],
): string {
  // Few-shot 样例部分
  const examplesText = examples
    .map((ex) => `输入: "${ex.input}" → 意图: ${ex.intent} (${ex.explanation})`)
    .join('\n');

  // 对话历史部分（最近 3 轮 = 6 条消息）
  const recentHistory = conversationHistory.slice(-6);
  const historyText = recentHistory.length > 0
    ? recentHistory
        .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
        .join('\n')
    : '（无历史对话）';

  return `你是一个意图分类器。根据以下示例和对话历史，判断用户当前的意图。
可用意图只能是：${VALID_INTENTS.join('、')}。

示例：
${examplesText}

对话历史：
${historyText}

当前输入: ${input}

请以 JSON 格式返回：{"intent": "意图类型", "confidence": 0.0-1.0}`;
}

/**
 * LLM Few-shot 意图分类
 *
 * 流程：
 * 1. 检查编辑距离缓存，命中则直接返回
 * 2. 调用 LLM 进行 Few-shot 分类
 * 3. 将结果写入缓存
 * 4. LLM 失败时直接抛错，由上游决定是否终止请求
 *
 * @param input - 用户输入（已净化）
 * @param conversationHistory - 最近对话历史
 * @param cache - 编辑距离缓存（默认使用全局单例）
 * @returns 分类结果，method 固定为 'llm'
 */
export async function classifyByLLMFewShot(
  input: string,
  conversationHistory: Array<{ role: string; content: string }>,
  cache: EditDistanceCache = globalEditDistanceCache,
  options?: {
    modelId?: string;
  },
): Promise<ClassifyResult> {
  const shouldUseCache = !options?.modelId;

  // 1. 检查缓存
  if (shouldUseCache) {
    const cached = findCacheHit(input, cache);
    if (cached) {
      return {
        intent: cached.intent,
        confidence: cached.confidence,
        method: 'llm',
      };
    }
  }

  // 2. 加载 Few-shot 样例
  const examples = await loadFewShotExamples();

  // 3. 调用 LLM
  const prompt = buildFewShotPrompt(input, conversationHistory, examples);
  const { model, modelId } = await resolveChatModelSelection({
    intent: 'chat',
    modelId: options?.modelId,
  });

  try {
    const result = await runText({
      model,
      prompt,
      temperature: 0,
    });

    // 解析 JSON 响应
    const text = result.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn('[LLM Few-shot] 无法解析 LLM 响应:', text);
      throw new Error(`模型 ${modelId} 返回了无法解析的分类结果`);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const intent = normalizeIntentCandidate(parsed.intent);
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.7;

    if (!intent) {
      throw new Error(`模型 ${modelId} 返回了无效意图 ${String(parsed.intent)}`);
    }

    if (shouldUseCache) {
      writeCache(input, intent, confidence, cache);
    }

    return { intent, confidence, method: 'llm' };
  } catch (error) {
    console.error('[LLM Few-shot] 调用失败:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    throw new Error(`[LLM Few-shot] ${message}`);
  }
}

// ============================================================
// Few-shot 样例加载
// ============================================================

/**
 * 加载 Few-shot 样例
 *
 * 优先从数据库配置加载（通过 AI 配置模块），
 * 加载失败或无数据时降级到默认内置样例。
 */
export async function loadFewShotExamples(): Promise<FewShotExample[]> {
  return getConfigValue<FewShotExample[]>('intent.few_shot_examples', DEFAULT_FEW_SHOT_EXAMPLES);
}

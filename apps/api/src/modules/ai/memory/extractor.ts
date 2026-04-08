/**
 * LLM Preference Extractor - 使用 LLM 从对话中提取用户偏好
 * 
 * 替代简单的关键词匹配，实现"下次更懂你"的核心能力
 */

import { runObject } from '../models/runtime';
import { t } from 'elysia';
import { jsonSchema } from 'ai';
import { resolveChatModelSelection, shouldOmitTemperatureForModelId } from '../models/router';
import { toJsonSchema } from '@juchang/utils';
import { createLogger } from '../observability/logger';

const logger = createLogger('extractor');

/**
 * 偏好类别
 */
export type PreferenceCategory =
  | 'activity_type'   // 活动类型偏好（火锅、桌游、运动等）
  | 'time'            // 时间偏好（周末、晚上等）
  | 'location'        // 地点偏好（观音桥、解放碑等）
  | 'food'            // 饮食偏好（不吃辣、素食等）
  | 'social';         // 社交偏好（小规模、熟人等）

/**
 * 偏好情感
 */
export type PreferenceSentiment = 'like' | 'dislike';

/**
 * 提取的偏好项
 */
export interface ExtractedPreference {
  category: PreferenceCategory;
  value: string;
  sentiment: PreferenceSentiment;
  confidence: number;
}

/**
 * 偏好提取结果
 */
export interface PreferenceExtraction {
  preferences: ExtractedPreference[];
  frequentLocations: string[];
  identityFacts: string[];
  socialContextFacts: string[];
}

/**
 * 偏好提取结果 Schema（用于 LLM generateObject）
 */
const PreferenceExtractionSchema = t.Object({
  preferences: t.Array(t.Object({
    category: t.Union([
      t.Literal('activity_type'),
      t.Literal('time'),
      t.Literal('location'),
      t.Literal('food'),
      t.Literal('social'),
    ]),
    value: t.String({ description: '偏好的具体内容' }),
    sentiment: t.Union([t.Literal('like'), t.Literal('dislike')]),
    confidence: t.Number({ minimum: 0, maximum: 1, description: '置信度 0-1' }),
  })),
  frequentLocations: t.Array(t.String({ description: '提到的地点名称' })),
  identityFacts: t.Array(t.String({ description: '用户明确说过的个人身份线索' })),
  socialContextFacts: t.Array(t.String({ description: '用户明确提过的重要人物或关系线索' })),
});

function trimCapturedValue(value: string): string {
  return value
    .replace(/[“”"'`]/g, '')
    .replace(/[，。！？,.!?\s]+$/g, '')
    .trim();
}

function normalizeStoredFact(value: string): string {
  return value
    .replace(/[“”"'`]/g, '')
    .replace(/[，。！？,.!?\s]+$/g, '')
    .trim();
}

function appendUniqueFact(target: string[], fact: string): void {
  const normalized = normalizeStoredFact(fact);
  if (!normalized) {
    return;
  }

  if (!target.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    target.push(normalized);
  }
}

function looksLikeQuestion(content: string): boolean {
  // 以疑问词或疑问语气结尾，且包含第二人称代词
  return /[吗呢吧？?]$/.test(content) && /你|谁|什么|怎么|为什么/.test(content);
}

function extractIdentityFactsFromMessage(content: string): string[] {
  // 疑问句不参与身份事实提取，防止"你知道我是谁吗"被误解析
  if (looksLikeQuestion(content)) {
    return [];
  }

  const identityFacts: string[] = [];
  const namePatterns = [
    /我叫([^\s，。！？,.]{1,16})/g,
    /我的名字是([^\s，。！？,.]{1,16})/g,
  ];
  const locationPatterns = [
    { pattern: /我住在([^，。！？,.]{1,18})/g, format: (value: string) => `住在${trimCapturedValue(value)}` },
    { pattern: /我在([^，。！？,.]{1,18})(上班|工作)/g, format: (value: string, suffix: string) => `在${trimCapturedValue(value)}${suffix}` },
  ];
  const rolePatterns = [
    /我是(一个|个)?([^，。！？,.]{1,16})/g,
  ];

  for (const pattern of namePatterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        appendUniqueFact(identityFacts, `名字是${match[1]}`);
      }
    }
  }

  for (const { pattern, format } of locationPatterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        appendUniqueFact(identityFacts, format(match[1], match[2] || ''));
      }
    }
  }

  for (const pattern of rolePatterns) {
    for (const match of content.matchAll(pattern)) {
      const rawRole = trimCapturedValue(match[2] || '');
      if (!rawRole) {
        continue;
      }

      if (/^(想|要|来|找|准备|打算|刚|正在|不是|有点|谁|什么|哪里|怎么|为什么|多少|几)/.test(rawRole)) {
        continue;
      }

      appendUniqueFact(identityFacts, `是${rawRole}`);
    }
  }

  return identityFacts.slice(0, 4);
}

function extractSocialContextFactsFromMessage(content: string): string[] {
  const socialFacts: string[] = [];
  const patterns = [
    {
      pattern: /我喜欢一个叫([^，。！？,.]{1,12})的(女生|男生|女孩|男孩)/g,
      format: (name: string, role: string) => `喜欢一个叫${trimCapturedValue(name)}的${role}`,
    },
    {
      pattern: /(她|他)住在([^，。！？,.]{1,18})/g,
      format: (pronoun: string, value: string) => `${pronoun}住在${trimCapturedValue(value)}`,
    },
    {
      pattern: /(她|他)在([^，。！？,.]{1,18})(上班|工作)/g,
      format: (pronoun: string, value: string, suffix: string) => `${pronoun}在${trimCapturedValue(value)}${suffix}`,
    },
    {
      pattern: /(她|他)性格([^，。！？,.]{1,18})/g,
      format: (pronoun: string, value: string) => `${pronoun}性格${trimCapturedValue(value)}`,
    },
    {
      pattern: /(她|他)喜欢([^，。！？,.]{1,18})/g,
      format: (pronoun: string, value: string) => `${pronoun}喜欢${trimCapturedValue(value)}`,
    },
  ] as const;

  for (const { pattern, format } of patterns) {
    for (const match of content.matchAll(pattern)) {
      appendUniqueFact(socialFacts, format(match[1] || '', match[2] || '', match[3] || ''));
    }
  }

  return socialFacts.slice(0, 4);
}

/**
 * 使用 LLM 从对话中提取用户偏好
 * 
 * @param conversationHistory - 对话历史
 * @returns 提取的偏好
 */
export async function extractPreferencesWithLLM(
  conversationHistory: Array<{ role: string; content: string }>
): Promise<PreferenceExtraction> {
  // 只提取用户消息
  const userMessages = conversationHistory
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join('\n');

  if (!userMessages.trim()) {
    return { preferences: [], frequentLocations: [], identityFacts: [], socialContextFacts: [] };
  }

  // 消息太短，不值得调用 LLM
  if (userMessages.length < 10) {
    return { preferences: [], frequentLocations: [], identityFacts: [], socialContextFacts: [] };
  }

  try {
    const { model, modelId } = await resolveChatModelSelection({ intent: 'chat' });

    const result = await runObject<PreferenceExtraction>({
      model,
      schema: jsonSchema<PreferenceExtraction>(toJsonSchema(PreferenceExtractionSchema)),
      prompt: `分析以下用户对话，提取用户的偏好信息。

用户对话：
${userMessages}

提取规则：
1. 只提取明确表达的偏好，不要推测
2. "不吃辣"、"不喜欢"、"讨厌"等表达为 dislike
3. "喜欢"、"想吃"、"爱"、"想玩"等表达为 like
4. confidence 根据表达的明确程度设置：
   - 非常明确（"我不吃辣"）: 0.9-1.0
   - 比较明确（"想吃火锅"）: 0.7-0.9
   - 一般（"火锅也行"）: 0.5-0.7
5. 提取提到的重庆地点名称到 frequentLocations（如观音桥、解放碑、南坪等）
6. 提取用户明确说过的身份线索到 identityFacts，例如名字、住在哪、在哪里上班、是什么身份
7. 提取用户明确提过的重要人物/关系线索到 socialContextFacts，例如喜欢的人、对方住哪、对方性格
8. 如果没有明确线索，返回空数组`,
      ...(shouldOmitTemperatureForModelId(modelId) ? {} : { temperature: 0 }),
    });

    const extraction = result.object;

    logger.debug('Preferences extracted', {
      preferencesCount: extraction.preferences.length,
      locationsCount: extraction.frequentLocations.length,
      identityFactsCount: extraction.identityFacts.length,
      socialContextFactsCount: extraction.socialContextFacts.length,
    });

    return extraction;
  } catch (error) {
    logger.warn('LLM extraction failed, falling back to empty', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { preferences: [], frequentLocations: [], identityFacts: [], socialContextFacts: [] };
  }
}

/**
 * 简单的关键词提取（作为 LLM 提取的降级方案）
 * 
 * @param conversationHistory - 对话历史
 * @returns 提取的偏好
 */
export function extractPreferencesSimple(
  conversationHistory: Array<{ role: string; content: string }>
): PreferenceExtraction {
  const preferences: ExtractedPreference[] = [];
  const frequentLocations: string[] = [];
  const identityFacts: string[] = [];
  const socialContextFacts: string[] = [];

  // 地点关键词
  const locationKeywords = ['观音桥', '解放碑', '南坪', '沙坪坝', '江北', '杨家坪', '大坪', '北碚', '渝北', '九龙坡'];

  // 喜好关键词
  const likePatterns = [
    { pattern: /喜欢(.{1,10})/, category: 'activity_type' as const },
    { pattern: /想吃(.{1,10})/, category: 'food' as const },
    { pattern: /想玩(.{1,10})/, category: 'activity_type' as const },
    { pattern: /爱(.{1,6})/, category: 'activity_type' as const },
  ];

  // 不喜欢关键词
  const dislikePatterns = [
    { pattern: /不吃(.{1,6})/, category: 'food' as const },
    { pattern: /不喜欢(.{1,10})/, category: 'activity_type' as const },
    { pattern: /讨厌(.{1,6})/, category: 'activity_type' as const },
  ];

  for (const msg of conversationHistory) {
    if (msg.role !== 'user') continue;
    const content = msg.content;

    // 提取地点
    for (const loc of locationKeywords) {
      if (content.includes(loc) && !frequentLocations.includes(loc)) {
        frequentLocations.push(loc);
      }
    }

    for (const fact of extractIdentityFactsFromMessage(content)) {
      appendUniqueFact(identityFacts, fact);
    }

    for (const fact of extractSocialContextFactsFromMessage(content)) {
      appendUniqueFact(socialContextFacts, fact);
    }

    // 提取喜好
    for (const { pattern, category } of likePatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const value = match[1].trim();
        if (value && !preferences.some(p => p.value === value)) {
          preferences.push({
            category,
            value,
            sentiment: 'like',
            confidence: 0.6,
          });
        }
      }
    }

    // 提取不喜欢
    for (const { pattern, category } of dislikePatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const value = match[1].trim();
        if (value && !preferences.some(p => p.value === value)) {
          preferences.push({
            category,
            value,
            sentiment: 'dislike',
            confidence: 0.7,
          });
        }
      }
    }
  }

  return {
    preferences: preferences.slice(0, 5),
    frequentLocations: frequentLocations.slice(0, 3),
    identityFacts: identityFacts.slice(0, 4),
    socialContextFacts: socialContextFacts.slice(0, 4),
  };
}

/**
 * 智能提取偏好（优先 LLM，降级到简单提取）
 */
export async function extractPreferencesFromConversation(
  conversationHistory: Array<{ role: string; content: string }>,
  options: { useLLM?: boolean } = {}
): Promise<PreferenceExtraction> {
  const { useLLM = true } = options;

  if (useLLM) {
    try {
      return await extractPreferencesWithLLM(conversationHistory);
    } catch {
      // LLM 失败，降级到简单提取
      return extractPreferencesSimple(conversationHistory);
    }
  }

  return extractPreferencesSimple(conversationHistory);
}

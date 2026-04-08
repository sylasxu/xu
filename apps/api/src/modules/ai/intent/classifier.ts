/**
 * Intent Classifier - 意图分类器
 * 
 * 混合分类：规则优先，LLM 兜底
 */

import { runText } from '../models/runtime';
import { resolveChatModelSelection, shouldOmitTemperatureForModelId } from '../models/router';
import type { IntentType, ClassifyResult, ClassifyContext } from './types';
import { intentPatterns, intentPriority, draftModifyPatterns } from './definitions';

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
 * 混合意图分类（纯函数）
 * 
 * 1. 规则匹配（快速，无延迟）
 * 2. 草稿上下文检查
 * 3. LLM 兜底（仅在 unknown 时）
 * 
 * @param message - 用户消息
 * @param context - 分类上下文
 * @returns 分类结果
 */
export async function classifyIntent(
  message: string,
  context: ClassifyContext
): Promise<ClassifyResult> {
  // 1. 规则匹配
  const regexResult = classifyByRegex(message);
  if (regexResult.intent !== 'unknown') {
    console.log(`[Intent Regex] ${regexResult.intent}`);
    return regexResult;
  }

  // 2. 草稿上下文检查
  if (context.hasDraftContext) {
    const draftResult = classifyDraftContext(message);
    if (draftResult) {
      console.log(`[Intent Draft] ${draftResult.intent}`);
      return draftResult;
    }
  }

  // 3. LLM 兜底
  console.log('[Intent] Regex unknown, falling back to LLM...');
  return await classifyByLLM(message, context);
}

/**
 * 正则快速分类（纯函数）
 */
export function classifyByRegex(message: string): ClassifyResult {
  const lowerText = message.toLowerCase();

  // 按优先级顺序检查
  for (const intent of intentPriority) {
    const patterns = intentPatterns[intent];
    for (const pattern of patterns) {
      if (pattern.test(lowerText)) {
        return {
          intent,
          confidence: 0.9,
          method: 'regex',
          matchedPattern: pattern.source,
        };
      }
    }
  }

  return {
    intent: 'unknown',
    confidence: 0,
    method: 'regex',
  };
}

/**
 * 草稿上下文分类（纯函数）
 */
export function classifyDraftContext(message: string): ClassifyResult | null {
  const lowerText = message.toLowerCase();

  for (const pattern of draftModifyPatterns) {
    if (pattern.test(lowerText)) {
      return {
        intent: 'create',
        confidence: 0.85,
        method: 'regex',
      };
    }
  }

  return null;
}

/**
 * LLM 意图分类（异步）
 * 使用 generateText + JSON 解析替代废弃的 generateObject
 */
async function classifyByLLM(
  message: string,
  context: ClassifyContext
): Promise<ClassifyResult> {
  // 构建对话历史文本
  const conversationText = context.conversationHistory
    ?.slice(-6) // 只取最近 3 轮
    .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
    .join('\n') || `用户: ${message}`;

  const contextHint = context.hasDraftContext ? '（当前有活动草稿待确认）' : '';

  const { model, modelId } = await resolveChatModelSelection({ intent: 'chat' });

  try {
    const result = await runText({
      model,
      prompt: `你是一个意图分类器。根据对话历史，判断用户当前的意图。${contextHint}

意图类型：
- create: 用户想创建/组织/发布活动（如"帮我组一个"、"我要发布"、"创建活动"）
- explore: 用户想找活动/探索附近/询问推荐（如"想找人一起"、"附近有什么"、"推荐一下"）
- partner: 用户想找搭子/等人约/被动加入（如"找搭子"、"谁组我就去"、"等人约"）
- manage: 用户想管理活动（如"取消活动"、"撤回"）
- show_activity: 用户想查询自己的活动历史（如"我的活动"、"我发过哪些"、"历史记录"）
- modify: 用户想修改/纠正刚才的信息（如"不是明天"、"改成后天"、"不对"、"换个地方"）
- confirm: 用户确认 AI 的提问或建议（如"对"、"是的"、"没问题"、"就是这个"）
- deny: 用户拒绝 AI 的提问或建议（如"不"、"不行"、"不是"、"换一个"）
- cancel: 用户想取消当前操作或结束对话（如"算了"、"不找了"、"取消"）
- share: 用户想分享活动或生成邀请函（如"分享"、"发给好友"、"生成海报"）
- join: 用户想报名或加入活动（如"我也去"、"算我一个"、"报名"）
- chitchat: 用户在闲聊（如"你是谁"、"讲个笑话"、"无关话题"）
- idle: 用户仅是礼貌回复或暂无明确需求（如"谢谢"、"改天再说"、"先这样"）
- unknown: 无法判断

注意：
1. **优先识别流程控制意图**：如果 AI 刚问了一个问题（如时间、地点），用户的回答（“对”、“不是”、“明天”）通常属于 confirm/deny/modify，而不是新意图。
2. **区分 Modify 和 Create**：用户说 "帮我改成明天" 是 modify，说 "再组一个明天的" 是 create。
3. "解放碑"、"明天"这类短回答通常是在回答问题（Slot Filling），如果看起来是回答刚才的问题，优先 modify（或根据语境判断）。
4. 用户表示结束、告别时，分类为 cancel 或 idle。

对话历史：
${conversationText}

请以 JSON 格式返回，只返回 JSON，不要其他内容：
{"intent": "意图类型", "confidence": 0.0-1.0}`,
      ...(shouldOmitTemperatureForModelId(modelId) ? {} : { temperature: 0 }),
    });

    // 解析 JSON 响应
    const text = result.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const intent = normalizeIntentCandidate(parsed.intent);
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;

      console.log(`[Intent LLM] ${intent} (confidence: ${confidence})`);

      if (intent) {
        return { intent, confidence, method: 'llm' };
      }
    }

    console.warn('[Intent LLM] Failed to parse response:', text);
    throw new Error(`模型 ${modelId} 返回了无法解析的意图分类结果`);
  } catch (error) {
    console.error('[Intent LLM] Error:', error);
    throw error;
  }
}

/**
 * 快速同步分类（仅正则，不调用 LLM）
 */
export function classifyIntentSync(
  message: string,
  hasDraftContext: boolean
): ClassifyResult {
  const regexResult = classifyByRegex(message);

  if (regexResult.intent !== 'unknown') {
    return regexResult;
  }

  if (hasDraftContext) {
    const draftResult = classifyDraftContext(message);
    if (draftResult) {
      return draftResult;
    }
  }

  return regexResult;
}

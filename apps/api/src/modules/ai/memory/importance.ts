/**
 * Importance_Score 计算
 *
 * 为消息计算重要性分数，用于语义召回时优先返回高分消息。
 * 基础分 0.3，每个 factor +0.175，上限 1.0
 */

/** 重要性因子 */
export interface ImportanceFactors {
  /** 包含偏好表达 */
  hasPreferenceExpression: boolean;
  /** 包含工具调用结果 */
  hasToolCallResult: boolean;
  /** 包含确认/否定 */
  hasConfirmation: boolean;
  /** 包含地点提及 */
  hasLocationMention: boolean;
}

/** 偏好表达关键词 */
const PREFERENCE_KEYWORDS = ['喜欢', '不喜欢', '讨厌', '爱吃', '不吃', '想吃', '想玩', '偏好'];

/** 确认/否定关键词 */
const CONFIRMATION_KEYWORDS = ['好的', '可以', '行', '不行', '不要', '算了', '确认', '取消', '没问题', '就这样'];

/** 地点关键词 */
const LOCATION_KEYWORDS = ['观音桥', '解放碑', '南坪', '沙坪坝', '江北', '杨家坪', '大坪', '北碚', '渝北', '九龙坡'];

/**
 * 从消息内容自动检测重要性因子
 */
export function detectImportanceFactors(content: string, isToolResult = false): ImportanceFactors {
  return {
    hasPreferenceExpression: PREFERENCE_KEYWORDS.some((k) => content.includes(k)),
    hasToolCallResult: isToolResult,
    hasConfirmation: CONFIRMATION_KEYWORDS.some((k) => content.includes(k)),
    hasLocationMention: LOCATION_KEYWORDS.some((k) => content.includes(k)),
  };
}

/**
 * 计算消息的重要性分数 (0-1)
 *
 * 公式：score = 0.3 + (每个 true factor × 0.175)，上限 1.0
 *
 * @param content - 消息内容（用于自动检测，当前未使用，预留扩展）
 * @param factors - 重要性因子
 * @returns 重要性分数 0-1
 */
export function calculateImportanceScore(
  _content: string,
  factors: ImportanceFactors,
): number {
  const BASE_SCORE = 0.3;
  const FACTOR_BOOST = 0.175;

  let score = BASE_SCORE;
  if (factors.hasPreferenceExpression) score += FACTOR_BOOST;
  if (factors.hasToolCallResult) score += FACTOR_BOOST;
  if (factors.hasConfirmation) score += FACTOR_BOOST;
  if (factors.hasLocationMention) score += FACTOR_BOOST;

  return Math.min(score, 1.0);
}

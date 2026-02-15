/**
 * 时间衰减函数 - 偏好时效性计算
 *
 * 衰减分段：
 * - 0-7 天：1.0（完全有效）
 * - 7-30 天：线性衰减至 0.3
 * - 30-90 天：线性衰减至 0.1
 * - >90 天：0（完全失效）
 */

import type { EnhancedPreference } from './working';

/**
 * 计算偏好的时间衰减权重
 *
 * @param updatedAt - 偏好最后更新时间
 * @param now - 当前时间（可选，默认 Date.now()）
 * @returns 衰减权重 0-1
 */
export function calculateTemporalDecay(updatedAt: Date, now?: Date): number {
  const currentTime = now ?? new Date();
  const diffMs = currentTime.getTime() - updatedAt.getTime();
  const days = diffMs / (1000 * 60 * 60 * 24);

  if (days <= 7) return 1.0;
  if (days <= 30) return 1.0 - ((days - 7) * 0.7) / 23;
  if (days <= 90) return 0.3 - ((days - 30) * 0.2) / 60;
  return 0;
}

/**
 * 计算偏好的综合分数 = confidence × temporalDecay
 *
 * @param preference - 增强偏好项
 * @param now - 当前时间（可选）
 * @returns 综合分数 0-1
 */
export function calculatePreferenceScore(
  preference: EnhancedPreference,
  now?: Date,
): number {
  const decay = calculateTemporalDecay(preference.updatedAt, now);
  return preference.confidence * decay;
}

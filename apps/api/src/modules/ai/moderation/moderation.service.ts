/**
 * Moderation Service - 内容审核服务
 * 
 * 复用 input-guard 检测敏感词，用简单规则计算风险评分
 * 支持批量审核、结果持久化和动态配置
 */

import { db, eq, inArray, activities, aiSecurityEvents } from '@juchang/db';
import { checkInput } from '../guardrails/input-guard';
import { getConfigValue } from '../config/config.service';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ModerationResult {
  activityId: string;
  riskScore: number;
  riskLevel: RiskLevel;
  reasons: string[];
  suggestedAction: 'approve' | 'review' | 'reject';
}

/**
 * 默认风险评分规则
 */
const DEFAULT_RISK_RULES = {
  sensitiveWord: 30,
  contactInfo: 20,
  shortContent: 10,
  suspiciousPattern: 15,
};

/**
 * 默认风险等级阈值
 */
const DEFAULT_RISK_THRESHOLDS = {
  high: 50,
  medium: 25,
};

type RiskRules = typeof DEFAULT_RISK_RULES;
type RiskThresholds = typeof DEFAULT_RISK_THRESHOLDS;

/**
 * 联系方式正则
 */
const CONTACT_PATTERNS = [
  /1[3-9]\d{9}/,           // 手机号
  /微信|wx|weixin/i,       // 微信
  /QQ|扣扣/i,              // QQ
  /加我|私聊|联系我/,       // 引导私聊
];

/**
 * 可疑模式
 */
const SUSPICIOUS_PATTERNS = [
  /免费|赚钱|兼职|日结/,
  /高薪|月入|躺赚/,
  /代理|招商|加盟/,
];

/**
 * 计算风险评分（动态配置规则）
 */
export async function calculateRiskScore(title: string, description?: string | null): Promise<{
  score: number;
  reasons: string[];
}> {
  const rules: RiskRules = await getConfigValue('moderation.risk_rules', DEFAULT_RISK_RULES);
  let score = 0;
  const reasons: string[] = [];
  const content = `${title} ${description || ''}`;

  // 1. 复用 input-guard 检测敏感词
  const guardResult = await checkInput(content);
  if (guardResult.blocked) {
    score += rules.sensitiveWord;
    reasons.push('包含敏感词');
  }

  // 2. 联系方式检测
  for (const pattern of CONTACT_PATTERNS) {
    if (pattern.test(content)) {
      score += rules.contactInfo;
      reasons.push('包含联系方式');
      break;
    }
  }

  // 3. 可疑模式检测
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(content)) {
      score += rules.suspiciousPattern;
      reasons.push('疑似广告/诈骗');
      break;
    }
  }

  // 4. 内容过短
  if (content.trim().length < 10) {
    score += rules.shortContent;
    reasons.push('内容过短');
  }

  return {
    score: Math.min(score, 100),
    reasons,
  };
}

/**
 * 根据分数判断风险等级（动态阈值）
 */
async function getRiskLevel(score: number): Promise<RiskLevel> {
  const thresholds: RiskThresholds = await getConfigValue('moderation.risk_thresholds', DEFAULT_RISK_THRESHOLDS);
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}

/**
 * 根据风险等级建议操作
 */
function getSuggestedAction(level: RiskLevel): 'approve' | 'review' | 'reject' {
  switch (level) {
    case 'high': return 'reject';
    case 'medium': return 'review';
    default: return 'approve';
  }
}

/**
 * 分析单个活动内容
 */
export async function analyzeActivity(activityId: string): Promise<ModerationResult | null> {
  const activity = await db.query.activities.findFirst({
    where: eq(activities.id, activityId),
  });

  if (!activity) return null;

  const { score, reasons } = await calculateRiskScore(activity.title, activity.description);
  const riskLevel = await getRiskLevel(score);

  return {
    activityId,
    riskScore: score,
    riskLevel,
    reasons,
    suggestedAction: getSuggestedAction(riskLevel),
  };
}

/**
 * 批量分析活动内容
 */
export async function analyzeActivities(activityIds: string[]): Promise<ModerationResult[]> {
  if (activityIds.length === 0) return [];

  const activityList = await db.query.activities.findMany({
    where: inArray(activities.id, activityIds),
  });

  const results: ModerationResult[] = [];

  for (const activity of activityList) {
    const { score, reasons } = await calculateRiskScore(activity.title, activity.description);
    const riskLevel = await getRiskLevel(score);

    results.push({
      activityId: activity.id,
      riskScore: score,
      riskLevel,
      reasons,
      suggestedAction: getSuggestedAction(riskLevel),
    });
  }

  return results;
}

/**
 * 持久化审核结果到 ai_security_events 表
 */
export async function persistModerationResults(results: ModerationResult[]): Promise<number> {
  const toInsert = results.filter((r) => r.riskLevel !== 'low');
  if (toInsert.length === 0) return 0;

  const values = toInsert.map((r) => ({
    eventType: 'moderation_flagged',
    severity: r.riskLevel,
    metadata: {
      activityId: r.activityId,
      riskScore: r.riskScore,
      reasons: r.reasons,
      suggestedAction: r.suggestedAction,
    },
  }));

  await db.insert(aiSecurityEvents).values(values);
  return values.length;
}

/**
 * 直接分析文本内容（不需要 activityId）
 */
export async function analyzeContent(title: string, description?: string | null): Promise<Omit<ModerationResult, 'activityId'>> {
  const { score, reasons } = await calculateRiskScore(title, description);
  const riskLevel = await getRiskLevel(score);

  return {
    riskScore: score,
    riskLevel,
    reasons,
    suggestedAction: getSuggestedAction(riskLevel),
  };
}

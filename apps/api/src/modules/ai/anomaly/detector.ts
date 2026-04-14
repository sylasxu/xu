/**
 * Anomaly Detector - 异常检测服务
 * 
 * 实时查询检测异常用户行为，支持动态配置阈值和结果持久化
 */

import { db, sql, toTimestamp, aiSecurityEvents } from '@xu/db';
import { getConfigValue } from '../config/config.service';

export type AnomalyType = 'bulk_create' | 'frequent_cancel' | 'high_token_usage' | 'duplicate_requests';
export type Severity = 'low' | 'medium' | 'high';

export interface AnomalyUser {
  anomalyId: string;
  userId: string;
  userNickname: string | null;
  anomalyType: AnomalyType;
  severity: Severity;
  count: number;
  detectedAt: string;
}

/**
 * 默认异常检测阈值
 */
const DEFAULT_THRESHOLDS = {
  bulk_create: { count: 10, hours: 24 },
  frequent_cancel: { count: 5, days: 7 },
  high_token_usage: { totalTokens: 100000, hours: 24 },
  duplicate_requests: { count: 10, hours: 1 },
};

type AnomalyThresholds = typeof DEFAULT_THRESHOLDS;

/**
 * 获取动态阈值配置
 */
async function getThresholds(): Promise<AnomalyThresholds> {
  return getConfigValue('anomaly.thresholds', DEFAULT_THRESHOLDS);
}

/**
 * 根据数量判断严重程度
 */
function getSeverity(count: number, threshold: number): Severity {
  const ratio = count / threshold;
  if (ratio >= 3) return 'high';
  if (ratio >= 2) return 'medium';
  return 'low';
}

/**
 * 检测批量创建 - 24h 内创建超过阈值个活动
 */
export async function detectBulkCreate(): Promise<AnomalyUser[]> {
  const thresholds = await getThresholds();
  const threshold = thresholds.bulk_create;
  const since = new Date(Date.now() - threshold.hours * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT 
      a.creator_id as user_id,
      u.nickname as user_nickname,
      COUNT(*) as count
    FROM activities a
    LEFT JOIN users u ON a.creator_id = u.id
    WHERE a.created_at >= ${toTimestamp(since)}
    GROUP BY a.creator_id, u.nickname
    HAVING COUNT(*) > ${threshold.count}
    ORDER BY count DESC
  `);

  return (result as unknown as any[]).map((row) => ({
    anomalyId: `bulk_create_${row.user_id}_${Date.now()}`,
    userId: row.user_id,
    userNickname: row.user_nickname,
    anomalyType: 'bulk_create' as AnomalyType,
    severity: getSeverity(Number(row.count), threshold.count),
    count: Number(row.count),
    detectedAt: new Date().toISOString(),
  }));
}

/**
 * 检测频繁取消 - 7d 内取消超过阈值次报名
 */
export async function detectFrequentCancel(): Promise<AnomalyUser[]> {
  const thresholds = await getThresholds();
  const threshold = thresholds.frequent_cancel;
  const since = new Date(Date.now() - threshold.days * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT 
      p.user_id,
      u.nickname as user_nickname,
      COUNT(*) as count
    FROM participants p
    LEFT JOIN users u ON p.user_id = u.id
    WHERE p.status = 'quit'
      AND p.updated_at >= ${toTimestamp(since)}
    GROUP BY p.user_id, u.nickname
    HAVING COUNT(*) > ${threshold.count}
    ORDER BY count DESC
  `);

  return (result as unknown as any[]).map((row) => ({
    anomalyId: `frequent_cancel_${row.user_id}_${Date.now()}`,
    userId: row.user_id,
    userNickname: row.user_nickname,
    anomalyType: 'frequent_cancel' as AnomalyType,
    severity: getSeverity(Number(row.count), threshold.count),
    count: Number(row.count),
    detectedAt: new Date().toISOString(),
  }));
}

/**
 * 检测高 Token 消耗 - 24h 内单用户 Token 消耗超阈值
 */
export async function detectHighTokenUsage(): Promise<AnomalyUser[]> {
  const thresholds = await getThresholds();
  const threshold = thresholds.high_token_usage;
  const since = new Date(Date.now() - threshold.hours * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT 
      r.user_id,
      u.nickname as user_nickname,
      SUM(COALESCE(r.input_tokens, 0) + COALESCE(r.output_tokens, 0)) as total_tokens
    FROM ai_requests r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.created_at >= ${toTimestamp(since)}
      AND r.user_id IS NOT NULL
    GROUP BY r.user_id, u.nickname
    HAVING SUM(COALESCE(r.input_tokens, 0) + COALESCE(r.output_tokens, 0)) > ${threshold.totalTokens}
    ORDER BY total_tokens DESC
  `);

  return (result as unknown as any[]).map((row) => ({
    anomalyId: `high_token_usage_${row.user_id}_${Date.now()}`,
    userId: row.user_id,
    userNickname: row.user_nickname,
    anomalyType: 'high_token_usage' as AnomalyType,
    severity: getSeverity(Number(row.total_tokens), threshold.totalTokens),
    count: Number(row.total_tokens),
    detectedAt: new Date().toISOString(),
  }));
}

/**
 * 检测重复请求 - 1h 内相同输入超过阈值的高频重复请求
 */
export async function detectDuplicateRequests(): Promise<AnomalyUser[]> {
  const thresholds = await getThresholds();
  const threshold = thresholds.duplicate_requests;
  const since = new Date(Date.now() - threshold.hours * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT 
      r.user_id,
      u.nickname as user_nickname,
      r.input,
      COUNT(*) as count
    FROM ai_requests r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.created_at >= ${toTimestamp(since)}
      AND r.user_id IS NOT NULL
      AND r.input IS NOT NULL
    GROUP BY r.user_id, u.nickname, r.input
    HAVING COUNT(*) > ${threshold.count}
    ORDER BY count DESC
  `);

  return (result as unknown as any[]).map((row) => ({
    anomalyId: `duplicate_requests_${row.user_id}_${Date.now()}`,
    userId: row.user_id,
    userNickname: row.user_nickname,
    anomalyType: 'duplicate_requests' as AnomalyType,
    severity: getSeverity(Number(row.count), threshold.count),
    count: Number(row.count),
    detectedAt: new Date().toISOString(),
  }));
}

/**
 * 检测所有异常
 */
export async function detectAllAnomalies(): Promise<AnomalyUser[]> {
  const [bulkCreate, frequentCancel, highToken, duplicateReqs] = await Promise.all([
    detectBulkCreate(),
    detectFrequentCancel(),
    detectHighTokenUsage(),
    detectDuplicateRequests(),
  ]);

  const all = [...bulkCreate, ...frequentCancel, ...highToken, ...duplicateReqs];
  const severityOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  
  return all.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

/**
 * 持久化异常检测结果到 ai_security_events 表
 */
export async function persistAnomalyResults(anomalies: AnomalyUser[]): Promise<number> {
  if (anomalies.length === 0) return 0;

  const values = anomalies.map((a) => ({
    userId: a.userId,
    eventType: `anomaly_${a.anomalyType}`,
    severity: a.severity,
    metadata: {
      anomalyType: a.anomalyType,
      count: a.count,
      userNickname: a.userNickname,
      detectedAt: a.detectedAt,
    },
  }));

  await db.insert(aiSecurityEvents).values(values);
  return values.length;
}

/**
 * 获取异常统计
 */
export async function getAnomalyStats(): Promise<{
  total: number;
  byType: Record<AnomalyType, number>;
  bySeverity: Record<Severity, number>;
}> {
  const anomalies = await detectAllAnomalies();
  
  const byType: Record<AnomalyType, number> = {
    bulk_create: 0,
    frequent_cancel: 0,
    high_token_usage: 0,
    duplicate_requests: 0,
  };
  
  const bySeverity: Record<Severity, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const a of anomalies) {
    byType[a.anomalyType]++;
    bySeverity[a.severity]++;
  }

  return {
    total: anomalies.length,
    byType,
    bySeverity,
  };
}

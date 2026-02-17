/**
 * Metrics - 指标收集
 * 
 * 提供计数器、仪表盘、直方图等指标
 */

import type { MetricPoint, MetricType } from './types';
import { db, sql, toTimestamp } from '@juchang/db';

/**
 * 指标存储
 */
const metricsStore: Map<string, MetricPoint[]> = new Map();
const MAX_POINTS_PER_METRIC = 1000;

/**
 * 生成指标 Key
 */
function getMetricKey(name: string, labels: Record<string, string>): string {
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${name}{${labelStr}}`;
}

/**
 * 记录指标点
 */
function recordMetric(
  name: string,
  value: number,
  type: MetricType,
  labels: Record<string, string> = {}
): void {
  const key = getMetricKey(name, labels);
  const point: MetricPoint = {
    name,
    value,
    timestamp: Date.now(),
    labels,
    type,
  };
  
  let points = metricsStore.get(key);
  if (!points) {
    points = [];
    metricsStore.set(key, points);
  }
  
  points.push(point);
  
  // 限制存储数量
  if (points.length > MAX_POINTS_PER_METRIC) {
    points.shift();
  }
}

// ============ Counter（计数器） ============

/**
 * 增加计数器
 */
export function incrementCounter(
  name: string,
  value: number = 1,
  labels: Record<string, string> = {}
): void {
  recordMetric(name, value, 'counter', labels);
}

/**
 * AI 请求计数
 */
export function countAIRequest(
  modelId: string,
  status: 'success' | 'error'
): void {
  incrementCounter('ai_requests_total', 1, { model: modelId, status });
}

/**
 * Tool 调用计数
 */
export function countToolCall(
  toolName: string,
  status: 'success' | 'error'
): void {
  incrementCounter('ai_tool_calls_total', 1, { tool: toolName, status });
}

// ============ Gauge（仪表盘） ============

/**
 * 设置仪表盘值
 */
export function setGauge(
  name: string,
  value: number,
  labels: Record<string, string> = {}
): void {
  recordMetric(name, value, 'gauge', labels);
}

/**
 * 记录活跃会话数
 */
export function setActiveSessions(count: number): void {
  setGauge('ai_active_sessions', count);
}

// ============ Histogram（直方图） ============

/**
 * 记录直方图值
 */
export function recordHistogram(
  name: string,
  value: number,
  labels: Record<string, string> = {}
): void {
  recordMetric(name, value, 'histogram', labels);
}

/**
 * 记录 AI 请求延迟
 */
export function recordAILatency(
  modelId: string,
  durationMs: number
): void {
  recordHistogram('ai_request_duration_ms', durationMs, { model: modelId });
}

/**
 * 记录 Token 用量
 */
export function recordTokenUsage(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): void {
  recordHistogram('ai_input_tokens', inputTokens, { model: modelId });
  recordHistogram('ai_output_tokens', outputTokens, { model: modelId });
}

/**
 * 记录 Tool 执行时间
 */
export function recordToolDuration(
  toolName: string,
  durationMs: number
): void {
  recordHistogram('ai_tool_duration_ms', durationMs, { tool: toolName });
}

// ============ 查询接口 ============

/**
 * 获取指标数据
 */
export function getMetric(
  name: string,
  labels: Record<string, string> = {}
): MetricPoint[] {
  const key = getMetricKey(name, labels);
  return metricsStore.get(key) || [];
}

/**
 * 获取所有指标名称
 */
export function getMetricNames(): string[] {
  const names = new Set<string>();
  for (const points of metricsStore.values()) {
    if (points.length > 0) {
      names.add(points[0].name);
    }
  }
  return Array.from(names);
}

/**
 * 获取指标汇总
 */
export function getMetricSummary(name: string): {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
} | null {
  const allPoints: MetricPoint[] = [];
  
  for (const [key, points] of metricsStore.entries()) {
    if (key.startsWith(name)) {
      allPoints.push(...points);
    }
  }
  
  if (allPoints.length === 0) return null;
  
  const values = allPoints.map(p => p.value);
  const sum = values.reduce((a, b) => a + b, 0);
  
  return {
    count: values.length,
    sum,
    avg: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * 清空指标
 */
export function clearMetrics(): void {
  metricsStore.clear();
}

/**
 * 清理过期指标（保留最近 1 小时）
 */
export function cleanupOldMetrics(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  
  for (const [key, points] of metricsStore.entries()) {
    const filtered = points.filter(p => p.timestamp > cutoff);
    if (filtered.length === 0) {
      metricsStore.delete(key);
    } else {
      metricsStore.set(key, filtered);
    }
  }
}


// ============ Token Usage Metrics (从 services/metrics.ts 迁移) ============

/**
 * Token 使用量类型
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}

/**
 * 记录 Token 使用量（日志输出 + 指标记录）
 */
export function recordTokenUsageWithLog(
  userId: string | null,
  usage: TokenUsage,
  toolCalls?: Array<{ toolName: string }>,
  options?: { model?: string; source?: string; intent?: string }
): void {
  // 日志输出
  let cacheInfo = '';
  if (usage.cacheHitTokens !== undefined && usage.cacheMissTokens !== undefined) {
    const totalPromptTokens = usage.cacheHitTokens + usage.cacheMissTokens;
    const cacheHitRate = totalPromptTokens > 0 
      ? ((usage.cacheHitTokens / totalPromptTokens) * 100).toFixed(1)
      : '0';
    cacheInfo = `, Cache: ${usage.cacheHitTokens}/${totalPromptTokens} (${cacheHitRate}% hit)`;
  }
  console.log(`[AI Metrics] User: ${userId || 'anon'}, Tokens: ${usage.totalTokens}${cacheInfo}, Tools: ${toolCalls?.length || 0}`);
  
  // 指标记录
  const modelId = options?.model || 'unknown';
  recordHistogram('ai_input_tokens', usage.inputTokens, { model: modelId });
  recordHistogram('ai_output_tokens', usage.outputTokens, { model: modelId });
  
  if (usage.cacheHitTokens !== undefined) {
    recordHistogram('ai_cache_hit_tokens', usage.cacheHitTokens, { model: modelId });
  }
}

// ============ Token Usage Stats (Admin 查询用) ============

export interface DailyTokenUsage {
  date: string;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheHitRate: number;
}

export interface TokenUsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  avgTokensPerRequest: number;
  totalCacheHitTokens: number;
  totalCacheMissTokens: number;
  overallCacheHitRate: number;
}

export interface ToolStats {
  toolName: string;
  totalCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number | null;
}

/**
 * 获取每日 Token 使用统计（从 ai_requests 表聚合查询）
 */
export async function getTokenUsageStats(
  startDate: Date,
  endDate: Date
): Promise<DailyTokenUsage[]> {
  const result = await db.execute(sql`
    SELECT
      DATE(created_at) as date,
      COUNT(*)::int as total_requests,
      COALESCE(SUM(input_tokens), 0)::bigint as input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint as output_tokens
    FROM ai_requests
    WHERE created_at >= ${toTimestamp(startDate)}
      AND created_at <= ${toTimestamp(endDate)}
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `);

  return (result as unknown as any[]).map((row) => {
    const inputTokens = Number(row.input_tokens);
    const outputTokens = Number(row.output_tokens);
    return {
      date: String(row.date),
      totalRequests: Number(row.total_requests),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      cacheHitRate: 0,
    };
  });
}

/**
 * 获取 Token 使用汇总（从 ai_requests 表聚合查询）
 */
export async function getTokenUsageSummary(
  startDate: Date,
  endDate: Date
): Promise<TokenUsageSummary> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_requests,
      COALESCE(SUM(input_tokens), 0)::bigint as total_input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint as total_output_tokens
    FROM ai_requests
    WHERE created_at >= ${toTimestamp(startDate)}
      AND created_at <= ${toTimestamp(endDate)}
  `);

  const row = (result as unknown as any[])[0];
  if (!row) {
    return {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      avgTokensPerRequest: 0,
      totalCacheHitTokens: 0,
      totalCacheMissTokens: 0,
      overallCacheHitRate: 0,
    };
  }

  const totalRequests = Number(row.total_requests);
  const totalInputTokens = Number(row.total_input_tokens);
  const totalOutputTokens = Number(row.total_output_tokens);
  const totalTokens = totalInputTokens + totalOutputTokens;

  return {
    totalRequests,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    avgTokensPerRequest: totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0,
    totalCacheHitTokens: 0,
    totalCacheMissTokens: 0,
    overallCacheHitRate: 0,
  };
}

/**
 * 获取 Tool 调用统计（从 ai_tool_calls 表聚合查询）
 */
export async function getToolCallStats(
  startDate: Date,
  endDate: Date
): Promise<ToolStats[]> {
  const result = await db.execute(sql`
    SELECT
      tool_name,
      COUNT(*)::int as total_count,
      COUNT(*) FILTER (WHERE success = true)::int as success_count,
      COUNT(*) FILTER (WHERE success = false)::int as failure_count,
      AVG(duration_ms)::int as avg_duration_ms
    FROM ai_tool_calls
    WHERE created_at >= ${toTimestamp(startDate)}
      AND created_at <= ${toTimestamp(endDate)}
    GROUP BY tool_name
    ORDER BY total_count DESC
  `);

  return (result as unknown as any[]).map((row) => {
    const totalCount = Number(row.total_count);
    const successCount = Number(row.success_count);
    return {
      toolName: String(row.tool_name),
      totalCount,
      successCount,
      failureCount: Number(row.failure_count),
      successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 10000) / 100 : 0,
      avgDurationMs: row.avg_duration_ms != null ? Number(row.avg_duration_ms) : null,
    };
  });
}

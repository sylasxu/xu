/**
 * AI Metrics Service - 质量与转化指标领域服务
 */

import {
  db,
  aiConversationMetrics,
  conversations,
  sql,
  gte,
  lte,
  and,
  isNotNull,
  eq,
  toTimestamp,
} from '@juchang/db';

/**
 * 质量指标查询参数
 */
export interface QualityMetricsQuery {
  startDate: Date;
  endDate: Date;
  groupBy?: 'day' | 'hour';
}

/**
 * 质量指标响应
 */
export interface QualityMetricsResponse {
  summary: {
    totalConversations: number;
    avgQualityScore: number;
    intentRecognitionRate: number;
    toolSuccessRate: number;
  };
  daily: Array<{
    date: string;
    conversations: number;
    avgQualityScore: number;
    intentRecognitionRate: number;
    toolSuccessRate: number;
  }>;
  intentDistribution: Array<{
    intent: string;
    count: number;
    percentage: number;
  }>;
}

/**
 * 获取对话质量指标
 */
export async function getQualityMetrics(query: QualityMetricsQuery): Promise<QualityMetricsResponse> {
  const { startDate, endDate } = query;

  const [summaryResult] = await db
    .select({
      totalConversations: sql<number>`count(*)`,
      avgQualityScore: sql<number>`coalesce(avg(${aiConversationMetrics.qualityScore}), 0)`,
      intentRecognizedCount: sql<number>`sum(case when ${aiConversationMetrics.intentRecognized} = true then 1 else 0 end)`,
      totalToolsCalled: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded} + ${aiConversationMetrics.toolsFailed}), 0)`,
      totalToolsSucceeded: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded}), 0)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      lte(aiConversationMetrics.createdAt, toTimestamp(endDate))
    ));

  const total = Number(summaryResult?.totalConversations || 0);
  const intentRecognized = Number(summaryResult?.intentRecognizedCount || 0);
  const toolsCalled = Number(summaryResult?.totalToolsCalled || 0);
  const toolsSucceeded = Number(summaryResult?.totalToolsSucceeded || 0);

  const dailyResults = await db
    .select({
      date: sql<string>`date(${aiConversationMetrics.createdAt})`,
      conversations: sql<number>`count(*)`,
      avgQualityScore: sql<number>`coalesce(avg(${aiConversationMetrics.qualityScore}), 0)`,
      intentRecognizedCount: sql<number>`sum(case when ${aiConversationMetrics.intentRecognized} = true then 1 else 0 end)`,
      totalToolsCalled: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded} + ${aiConversationMetrics.toolsFailed}), 0)`,
      totalToolsSucceeded: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded}), 0)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      lte(aiConversationMetrics.createdAt, toTimestamp(endDate))
    ))
    .groupBy(sql`date(${aiConversationMetrics.createdAt})`)
    .orderBy(sql`date(${aiConversationMetrics.createdAt})`);

  const intentResults = await db
    .select({
      intent: aiConversationMetrics.intent,
      count: sql<number>`count(*)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      lte(aiConversationMetrics.createdAt, toTimestamp(endDate)),
      isNotNull(aiConversationMetrics.intent)
    ))
    .groupBy(aiConversationMetrics.intent);

  return {
    summary: {
      totalConversations: total,
      avgQualityScore: Math.round(Number(summaryResult?.avgQualityScore || 0) * 100) / 100,
      intentRecognitionRate: total > 0 ? Math.round((intentRecognized / total) * 100) / 100 : 0,
      toolSuccessRate: toolsCalled > 0 ? Math.round((toolsSucceeded / toolsCalled) * 100) / 100 : 0,
    },
    daily: dailyResults.map(d => {
      const dayTotal = Number(d.conversations);
      const dayIntentRecognized = Number(d.intentRecognizedCount);
      const dayToolsCalled = Number(d.totalToolsCalled);
      const dayToolsSucceeded = Number(d.totalToolsSucceeded);

      return {
        date: d.date,
        conversations: dayTotal,
        avgQualityScore: Math.round(Number(d.avgQualityScore) * 100) / 100,
        intentRecognitionRate: dayTotal > 0 ? Math.round((dayIntentRecognized / dayTotal) * 100) / 100 : 0,
        toolSuccessRate: dayToolsCalled > 0 ? Math.round((dayToolsSucceeded / dayToolsCalled) * 100) / 100 : 0,
      };
    }),
    intentDistribution: intentResults.map(i => ({
      intent: i.intent || 'unknown',
      count: Number(i.count),
      percentage: total > 0 ? Math.round((Number(i.count) / total) * 100) : 0,
    })),
  };
}

/**
 * 转化指标查询参数
 */
export interface ConversionMetricsQuery {
  startDate: Date;
  endDate: Date;
  intent?: string;
}

/**
 * 转化指标响应
 */
export interface ConversionMetricsResponse {
  funnel: {
    conversations: number;
    intentRecognized: number;
    toolCalled: number;
    activityCreatedOrJoined: number;
  };
  conversionRates: {
    intentToTool: number;
    toolToActivity: number;
    overall: number;
  };
  byIntent: Array<{
    intent: string;
    conversations: number;
    converted: number;
    conversionRate: number;
  }>;
}

/**
 * 获取转化率指标
 */
export async function getConversionMetrics(query: ConversionMetricsQuery): Promise<ConversionMetricsResponse> {
  const { startDate, endDate, intent } = query;

  const conditions = [
    gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
    lte(aiConversationMetrics.createdAt, toTimestamp(endDate)),
  ];
  if (intent) {
    conditions.push(eq(aiConversationMetrics.intent, intent));
  }

  const [funnelResult] = await db
    .select({
      conversations: sql<number>`count(*)`,
      intentRecognized: sql<number>`sum(case when ${aiConversationMetrics.intentRecognized} = true then 1 else 0 end)`,
      toolCalled: sql<number>`sum(case when jsonb_array_length(${aiConversationMetrics.toolsCalled}) > 0 then 1 else 0 end)`,
      activityCreatedOrJoined: sql<number>`sum(case when ${aiConversationMetrics.activityCreated} = true or ${aiConversationMetrics.activityJoined} = true then 1 else 0 end)`,
    })
    .from(aiConversationMetrics)
    .where(and(...conditions));

  const conversationsCount = Number(funnelResult?.conversations || 0);
  const intentRecognized = Number(funnelResult?.intentRecognized || 0);
  const toolCalled = Number(funnelResult?.toolCalled || 0);
  const activityCreatedOrJoined = Number(funnelResult?.activityCreatedOrJoined || 0);

  const byIntentResults = await db
    .select({
      intent: aiConversationMetrics.intent,
      conversations: sql<number>`count(*)`,
      converted: sql<number>`sum(case when ${aiConversationMetrics.activityCreated} = true or ${aiConversationMetrics.activityJoined} = true then 1 else 0 end)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      lte(aiConversationMetrics.createdAt, toTimestamp(endDate)),
      isNotNull(aiConversationMetrics.intent)
    ))
    .groupBy(aiConversationMetrics.intent);

  return {
    funnel: {
      conversations: conversationsCount,
      intentRecognized,
      toolCalled,
      activityCreatedOrJoined,
    },
    conversionRates: {
      intentToTool: intentRecognized > 0 ? Math.round((toolCalled / intentRecognized) * 100) / 100 : 0,
      toolToActivity: toolCalled > 0 ? Math.round((activityCreatedOrJoined / toolCalled) * 100) / 100 : 0,
      overall: conversationsCount > 0 ? Math.round((activityCreatedOrJoined / conversationsCount) * 100) / 100 : 0,
    },
    byIntent: byIntentResults.map(i => {
      const conv = Number(i.conversations);
      const converted = Number(i.converted);
      return {
        intent: i.intent || 'unknown',
        conversations: conv,
        converted,
        conversionRate: conv > 0 ? Math.round((converted / conv) * 100) / 100 : 0,
      };
    }),
  };
}

/**
 * Playground 统计响应
 */
export interface PlaygroundStatsResponse {
  intentDistribution: Array<{
    intent: string;
    count: number;
    percentage: number;
  }>;
  toolStats: Array<{
    toolName: string;
    totalCalls: number;
    successCount: number;
    failureCount: number;
    successRate: number;
  }>;
  recentErrors: Array<{
    timestamp: string;
    intent: string;
    toolName: string;
    errorMessage: string;
  }>;
}

/**
 * 获取 Playground 统计数据
 */
export async function getPlaygroundStats(): Promise<PlaygroundStatsResponse> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  const intentResults = await db
    .select({
      intent: aiConversationMetrics.intent,
      count: sql<number>`count(*)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      isNotNull(aiConversationMetrics.intent)
    ))
    .groupBy(aiConversationMetrics.intent);

  const totalIntents = intentResults.reduce((sum, i) => sum + Number(i.count), 0);

  const toolResults = await db
    .select({
      toolsSucceeded: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded}), 0)`,
      toolsFailed: sql<number>`coalesce(sum(${aiConversationMetrics.toolsFailed}), 0)`,
    })
    .from(aiConversationMetrics)
    .where(gte(aiConversationMetrics.createdAt, toTimestamp(startDate)));

  const totalSucceeded = Number(toolResults[0]?.toolsSucceeded || 0);
  const totalFailed = Number(toolResults[0]?.toolsFailed || 0);
  const totalCalls = totalSucceeded + totalFailed;

  return {
    intentDistribution: intentResults.map(i => ({
      intent: i.intent || 'unknown',
      count: Number(i.count),
      percentage: totalIntents > 0 ? Math.round((Number(i.count) / totalIntents) * 100) : 0,
    })),
    toolStats: [{
      toolName: 'all_tools',
      totalCalls,
      successCount: totalSucceeded,
      failureCount: totalFailed,
      successRate: totalCalls > 0 ? Math.round((totalSucceeded / totalCalls) * 100) / 100 : 0,
    }],
    recentErrors: [],
  };
}

/**
 * AI 健康度指标
 */
export interface AIHealthMetrics {
  badCaseRate: number;
  badCaseCount: number;
  totalEvaluated: number;
  toolErrorRate: number;
  errorSessionCount: number;
  totalSessions: number;
  badCaseTrend: number;
  toolErrorTrend: number;
}

/**
 * 获取 AI 健康度指标
 */
export async function getAIHealthMetrics(): Promise<AIHealthMetrics> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [thisWeekTotal] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(gte(conversations.createdAt, toTimestamp(oneWeekAgo)));

  const [thisWeekBad] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      eq(conversations.evaluationStatus, 'bad')
    ));

  const [thisWeekError] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      eq(conversations.hasError, true)
    ));

  const [thisWeekEvaluated] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      sql`${conversations.evaluationStatus} != 'unreviewed'`
    ));

  const [lastWeekBad] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(twoWeeksAgo)),
      lte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      eq(conversations.evaluationStatus, 'bad')
    ));

  const [lastWeekError] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(twoWeeksAgo)),
      lte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      eq(conversations.hasError, true)
    ));

  const [lastWeekEvaluated] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(twoWeeksAgo)),
      lte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      sql`${conversations.evaluationStatus} != 'unreviewed'`
    ));

  const [lastWeekTotal] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(twoWeeksAgo)),
      lte(conversations.createdAt, toTimestamp(oneWeekAgo))
    ));

  const totalSessions = Number(thisWeekTotal?.count || 0);
  const badCaseCount = Number(thisWeekBad?.count || 0);
  const errorSessionCount = Number(thisWeekError?.count || 0);
  const totalEvaluated = Number(thisWeekEvaluated?.count || 0);

  const badCaseRate = totalEvaluated > 0 ? badCaseCount / totalEvaluated : 0;
  const toolErrorRate = totalSessions > 0 ? errorSessionCount / totalSessions : 0;

  const lastWeekBadCount = Number(lastWeekBad?.count || 0);
  const lastWeekErrorCount = Number(lastWeekError?.count || 0);
  const lastWeekEvaluatedCount = Number(lastWeekEvaluated?.count || 0);
  const lastWeekTotalCount = Number(lastWeekTotal?.count || 0);

  const lastWeekBadRate = lastWeekEvaluatedCount > 0 ? lastWeekBadCount / lastWeekEvaluatedCount : 0;
  const lastWeekErrorRate = lastWeekTotalCount > 0 ? lastWeekErrorCount / lastWeekTotalCount : 0;

  return {
    badCaseRate,
    badCaseCount,
    totalEvaluated,
    toolErrorRate,
    errorSessionCount,
    totalSessions,
    badCaseTrend: badCaseRate - lastWeekBadRate,
    toolErrorTrend: toolErrorRate - lastWeekErrorRate,
  };
}

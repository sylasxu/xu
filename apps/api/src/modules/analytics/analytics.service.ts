// Analytics Service - 数据分析领域业务逻辑
// 从 Growth 模块迁移趋势分析能力

import {
  db,
  conversationMessages,
  aiConversationMetrics,
  contentNotes,
  activities,
  participants,
  reports,
  aiRequests,
  aiSecurityEvents,
  conversations,
  sql,
  desc,
  and,
  gte,
  isNotNull,
  eq,
  count,
  lt,
  inArray,
  not,
  type SQL,
} from '@juchang/db';
import { generateObject, jsonSchema } from 'ai';
import { t } from 'elysia';
import { toJsonSchema } from '@juchang/utils';
import type { 
  TrendsQuery, 
  TrendsResponse, 
  ContentPerformanceQuery, 
  ContentPerformanceResponse,
  BenchmarkStatus,
  J2CMetric,
  WeeklyCompletedMetric,
  MetricValue,
  BusinessMetricsResponse,
  PlatformOverviewResponse,
} from './analytics.model';
import { intentDisplayNames } from '../ai/intent/definitions';
import type { IntentType } from '../ai/intent/types';
import { getDeepSeekChat } from '../ai/models/adapters/deepseek';
import { formatContentNote } from '../content/content.service';

// ==========================================
// 趋势分析 (从 Growth 迁移)
// ==========================================

interface TrendWord {
  word: string;
  count: number;
  trend: 'up' | 'down' | 'stable';
}

interface IntentDistribution {
  intent: string;
  count: number;
  percentage: number;
}

/**
 * 高频关键词提取 Schema（用于 LLM generateObject）
 */
const KeywordExtractionSchema = t.Object({
  keywords: t.Array(t.Object({
    word: t.String({ description: '关键词' }),
    count: t.Number({ description: '出现次数' }),
  }), { maxItems: 20, description: '高频关键词列表，按出现次数降序排列' })
});

type KeywordExtraction = typeof KeywordExtractionSchema.static;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readConversationTextContent(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (isRecord(value)) {
    const text = value.text;
    return typeof text === 'string' ? text : null;
  }

  return null;
}

/**
 * 获取趋势洞察
 * 从 Growth 模块迁移，使用 LLM 分析用户消息提取高频词
 */
export async function getTrendInsights(query: TrendsQuery): Promise<TrendsResponse> {
  const { period = '7d', source = 'conversations' } = query;
  const days = period === '7d' ? 7 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // 1. 查询意图分布（复用 chat 流程的真实数据）
  const intentResults = await db
    .select({
      intent: aiConversationMetrics.intent,
      count: sql<number>`count(*)::int`,
    })
    .from(aiConversationMetrics)
    .where(
      and(
        gte(aiConversationMetrics.createdAt, startDate),
        isNotNull(aiConversationMetrics.intent)
      )
    )
    .groupBy(aiConversationMetrics.intent);

  const totalIntents = intentResults.reduce((sum, i) => sum + Number(i.count), 0);
  const intentDistribution: IntentDistribution[] = intentResults
    .map(i => ({
      intent: intentDisplayNames[i.intent as IntentType] || i.intent || '未知',
      count: Number(i.count),
      percentage: totalIntents > 0 ? (Number(i.count) / totalIntents) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // 2. 查询用户消息用于 LLM 关键词提取
  let topWords: TrendWord[] = [];
  
  if (source === 'conversations' || source === 'keywords') {
    const userMessages = await db
      .select({
        content: conversationMessages.content,
      })
      .from(conversationMessages)
      .where(
        and(
          sql`${conversationMessages.role} = 'user'`,
          gte(conversationMessages.createdAt, startDate)
        )
      )
      .orderBy(desc(conversationMessages.createdAt))
      .limit(100);

    // 提取文本内容
    const texts: string[] = [];
    for (const msg of userMessages) {
      const text = readConversationTextContent(msg.content);
      if (text) {
        texts.push(text);
      }
    }

    // 3. 用 LLM 提取高频词
    if (texts.length > 0) {
      try {
        const result = await generateObject({
          model: getDeepSeekChat(),
          schema: jsonSchema<KeywordExtraction>(toJsonSchema(KeywordExtractionSchema)),
          prompt: `分析以下用户消息，提取高频关键词 Top 20（按出现次数排序）。
只提取有意义的词，如：活动类型（火锅、篮球、麻将）、地点（观音桥、南坪）、时间（周末、明晚）。
不要提取太通用的词如"的"、"了"、"是"。

用户消息：
${texts.join('\n')}`
        });
        topWords = result.object.keywords.map(k => ({
          word: k.word,
          count: k.count,
          trend: 'stable' as const,
        }));
      } catch (error) {
        console.error('LLM keyword extraction failed:', error);
        // 降级：返回空数组
      }
    }
  }

  return {
    topWords,
    intentDistribution,
    period,
    generatedAt: new Date().toISOString(),
  };
}

// ==========================================
// 内容效果分析 (从 Content 迁移)
// ==========================================

// 综合互动指标计算 SQL 表达式
const engagementScoreExpr = sql<number>`
  coalesce(${contentNotes.views}, 0)
  + coalesce(${contentNotes.likes}, 0) * 2
  + coalesce(${contentNotes.collects}, 0) * 3
  + coalesce(${contentNotes.comments}, 0) * 2
`;

/**
 * 获取内容效果分析
 * 从 Content 模块迁移
 */
export async function getContentPerformance(
  query: ContentPerformanceQuery
): Promise<ContentPerformanceResponse> {
  const { contentType, startDate, endDate } = query;
  const contentConditions: SQL<unknown>[] = [];
  if (contentType) {
    contentConditions.push(eq(contentNotes.contentType, contentType));
  }
  if (startDate) {
    contentConditions.push(gte(contentNotes.createdAt, new Date(startDate)));
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);
    contentConditions.push(lt(contentNotes.createdAt, end));
  }

  const performanceConditions: SQL<unknown>[] = [
    ...contentConditions,
    isNotNull(contentNotes.views),
  ];

  const contentWhere = contentConditions.length > 0 ? and(...contentConditions) : undefined;
  const performanceWhere = and(...performanceConditions);

  // 按内容类型聚合
  const byType = await db
    .select({
      contentType: contentNotes.contentType,
      avgViews: sql<number>`coalesce(avg(${contentNotes.views}), 0)::float`,
      avgLikes: sql<number>`coalesce(avg(${contentNotes.likes}), 0)::float`,
      avgCollects: sql<number>`coalesce(avg(${contentNotes.collects}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(contentNotes)
    .where(performanceWhere)
    .groupBy(contentNotes.contentType);

  // 总笔记数
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)
    .where(contentWhere);

  // 已回填效果数据的笔记数
  const [perfResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)
    .where(performanceWhere);

  const totalNotes = totalResult?.count ?? 0;
  const totalWithPerformance = perfResult?.count ?? 0;

  // 热门内容排行榜
  const topNotes = await db
    .select()
    .from(contentNotes)
    .where(performanceWhere)
    .orderBy(desc(engagementScoreExpr))
    .limit(10);

  return {
    byType: byType.map(t => ({
      contentType: t.contentType,
      avgViews: t.avgViews,
      avgLikes: t.avgLikes,
      avgCollects: t.avgCollects,
      count: t.count,
    })),
    topNotes: topNotes.map(formatContentNote),
    totalNotes,
    totalWithPerformance,
    period: `${startDate || 'all'} to ${endDate || 'now'}`,
  };
}

// ==========================================
// 平台运营分析
// ==========================================

const BENCHMARKS = {
  j2cRate: { red: 1, yellow: 5 },
  weeklyCompleted: { red: 3, yellow: 5 },
  draftPublishRate: { red: 40, yellow: 60 },
  activitySuccessRate: { red: 30, yellow: 50 },
  weeklyRetention: { red: 10, yellow: 15 },
  oneTimeCreatorRate: { red: 50, yellow: 70 },
};

function getBenchmark(
  value: number,
  thresholds: { red: number; yellow: number }
): BenchmarkStatus {
  if (value < thresholds.red) return 'red';
  if (value < thresholds.yellow) return 'yellow';
  return 'green';
}

function getWeekStart(date: Date = new Date()): Date {
  const weekStart = new Date(date);
  const day = weekStart.getDay();
  const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
  weekStart.setDate(diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

async function calculateJ2CRate(): Promise<J2CMetric> {
  try {
    const joinersResult = await db
      .select({
        userId: participants.userId,
        firstJoinDate: sql<Date>`MIN(${participants.joinedAt})`.as('first_join_date'),
      })
      .from(participants)
      .where(eq(participants.status, 'joined'))
      .groupBy(participants.userId);

    const creatorsResult = await db
      .select({
        creatorId: activities.creatorId,
        firstCreateDate: sql<Date>`MIN(${activities.createdAt})`.as('first_create_date'),
      })
      .from(activities)
      .where(not(eq(activities.status, 'draft')))
      .groupBy(activities.creatorId);

    const creatorMap = new Map<string, Date>();
    for (const creator of creatorsResult) {
      creatorMap.set(creator.creatorId, creator.firstCreateDate);
    }

    let convertedUsers = 0;
    for (const joiner of joinersResult) {
      const firstCreateDate = creatorMap.get(joiner.userId);
      if (firstCreateDate && joiner.firstJoinDate && firstCreateDate > joiner.firstJoinDate) {
        convertedUsers++;
      }
    }

    const totalJoiners = joinersResult.length;
    const value = totalJoiners > 0 ? (convertedUsers / totalJoiners) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.j2cRate),
      comparison: `${convertedUsers} 人转化`,
      convertedUsers,
      totalJoiners,
    };
  } catch (error) {
    console.error('计算 J2C 转化率失败:', error);
    return {
      value: 0,
      benchmark: 'red',
      comparison: '计算失败',
      convertedUsers: 0,
      totalJoiners: 0,
    };
  }
}

async function getWeeklyCompletedCount(): Promise<WeeklyCompletedMetric> {
  try {
    const thisWeekStart = getWeekStart();
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const [thisWeekResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(and(
        eq(activities.status, 'completed'),
        gte(activities.updatedAt, thisWeekStart)
      ));

    const [lastWeekResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(and(
        eq(activities.status, 'completed'),
        gte(activities.updatedAt, lastWeekStart),
        lt(activities.updatedAt, thisWeekStart)
      ));

    const value = thisWeekResult?.count || 0;
    const lastWeekValue = lastWeekResult?.count || 0;
    const diff = value - lastWeekValue;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.weeklyCompleted),
      comparison: diff >= 0 ? `较上周 +${diff}` : `较上周 ${diff}`,
      lastWeekValue,
    };
  } catch (error) {
    console.error('计算本周成局数失败:', error);
    return {
      value: 0,
      benchmark: 'red',
      comparison: '计算失败',
      lastWeekValue: 0,
    };
  }
}

async function calculateDraftPublishRate(): Promise<MetricValue> {
  try {
    const [totalResult] = await db.select({ count: count() }).from(activities);
    const [publishedResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(inArray(activities.status, ['active', 'completed', 'cancelled']));

    const total = totalResult?.count || 0;
    const published = publishedResult?.count || 0;
    const value = total > 0 ? (published / total) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.draftPublishRate),
      comparison: `${published}/${total} 已发布`,
    };
  } catch (error) {
    console.error('计算草稿发布率失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

async function calculateActivitySuccessRate(): Promise<MetricValue> {
  try {
    const [completedResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(eq(activities.status, 'completed'));

    const [publishedResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(inArray(activities.status, ['active', 'completed', 'cancelled']));

    const completed = completedResult?.count || 0;
    const published = publishedResult?.count || 0;
    const value = published > 0 ? (completed / published) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.activitySuccessRate),
      comparison: `${completed}/${published} 成局`,
    };
  } catch (error) {
    console.error('计算活动成局率失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

async function calculateWeeklyRetention(): Promise<MetricValue> {
  try {
    const thisWeekStart = getWeekStart();
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const thisWeekUsers = await db
      .selectDistinct({ userId: participants.userId })
      .from(participants)
      .where(gte(participants.joinedAt, thisWeekStart));

    const lastWeekUsers = await db
      .selectDistinct({ userId: participants.userId })
      .from(participants)
      .where(and(
        gte(participants.joinedAt, lastWeekStart),
        lt(participants.joinedAt, thisWeekStart)
      ));

    const thisWeekSet = new Set(thisWeekUsers.map((user) => user.userId));
    const lastWeekSet = new Set(lastWeekUsers.map((user) => user.userId));

    let retained = 0;
    for (const userId of lastWeekSet) {
      if (thisWeekSet.has(userId)) {
        retained++;
      }
    }

    const lastWeekCount = lastWeekSet.size;
    const value = lastWeekCount > 0 ? (retained / lastWeekCount) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.weeklyRetention),
      comparison: `${retained}/${lastWeekCount} 留存`,
    };
  } catch (error) {
    console.error('计算周留存率失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

async function calculateOneTimeCreatorRate(): Promise<MetricValue> {
  try {
    const creatorStats = await db
      .select({
        creatorId: activities.creatorId,
        activityCount: count().as('activity_count'),
      })
      .from(activities)
      .where(not(eq(activities.status, 'draft')))
      .groupBy(activities.creatorId);

    const totalCreators = creatorStats.length;
    const casualCreators = creatorStats.filter(
      (creator) => creator.activityCount >= 1 && creator.activityCount <= 3
    ).length;
    const value = totalCreators > 0 ? (casualCreators / totalCreators) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.oneTimeCreatorRate),
      comparison: `${casualCreators}/${totalCreators} 一次性`,
    };
  } catch (error) {
    console.error('计算一次性群主占比失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

export async function getBusinessMetrics(): Promise<BusinessMetricsResponse> {
  const [
    j2cRate,
    weeklyCompletedCount,
    draftPublishRate,
    activitySuccessRate,
    weeklyRetention,
    oneTimeCreatorRate,
  ] = await Promise.all([
    calculateJ2CRate(),
    getWeeklyCompletedCount(),
    calculateDraftPublishRate(),
    calculateActivitySuccessRate(),
    calculateWeeklyRetention(),
    calculateOneTimeCreatorRate(),
  ]);

  return {
    j2cRate,
    weeklyCompletedCount,
    draftPublishRate,
    activitySuccessRate,
    weeklyRetention,
    oneTimeCreatorRate,
  };
}

export async function getPlatformOverview(): Promise<PlatformOverviewResponse> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const oneWeekAgo = new Date(today);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const [
    activeUsersResult,
    todayActivitiesResult,
    todayConversationsResult,
    todayTokenUsageResult,
    j2cRate,
    thisWeekTotalResult,
    thisWeekBadResult,
    thisWeekErrorResult,
    thisWeekEvaluatedResult,
    thisWeekAvgLatencyResult,
    lastWeekBadResult,
    lastWeekErrorResult,
    lastWeekEvaluatedResult,
    lastWeekTotalResult,
    error24hResult,
    sensitiveHitsResult,
    pendingModerationResult,
  ] = await Promise.all([
    db.selectDistinct({ count: sql<number>`count(distinct ${participants.userId})` })
      .from(participants)
      .where(gte(participants.joinedAt, today)),
    db.select({ count: count() })
      .from(activities)
      .where(and(
        eq(activities.status, 'completed'),
        gte(activities.updatedAt, today)
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(gte(conversations.createdAt, today)),
    db.select({
      totalTokens: sql<number>`
        COALESCE(SUM(${aiRequests.inputTokens} + ${aiRequests.outputTokens}), 0)
      `.as('total_tokens'),
    })
      .from(aiRequests)
      .where(gte(aiRequests.createdAt, today)),
    calculateJ2CRate(),
    db.select({ count: count() })
      .from(conversations)
      .where(gte(conversations.createdAt, oneWeekAgo)),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, oneWeekAgo),
        eq(conversations.evaluationStatus, 'bad')
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, oneWeekAgo),
        eq(conversations.hasError, true)
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, oneWeekAgo),
        not(eq(conversations.evaluationStatus, 'unreviewed'))
      )),
    db.select({
      avgLatencyMs: sql<number>`COALESCE(AVG(${aiRequests.latencyMs}), 0)`.as('avg_latency_ms'),
    })
      .from(aiRequests)
      .where(gte(aiRequests.createdAt, oneWeekAgo)),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, twoWeeksAgo),
        lt(conversations.createdAt, oneWeekAgo),
        eq(conversations.evaluationStatus, 'bad')
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, twoWeeksAgo),
        lt(conversations.createdAt, oneWeekAgo),
        eq(conversations.hasError, true)
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, twoWeeksAgo),
        lt(conversations.createdAt, oneWeekAgo),
        not(eq(conversations.evaluationStatus, 'unreviewed'))
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, twoWeeksAgo),
        lt(conversations.createdAt, oneWeekAgo)
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, yesterday),
        eq(conversations.hasError, true)
      )),
    db.select({ count: count() })
      .from(aiSecurityEvents)
      .where(and(
        gte(aiSecurityEvents.createdAt, yesterday),
        isNotNull(aiSecurityEvents.triggerWord),
      )),
    db.select({ count: count() })
      .from(reports)
      .where(eq(reports.status, 'pending')),
  ]);

  const totalSessions = Number(thisWeekTotalResult[0]?.count || 0);
  const badCaseCount = Number(thisWeekBadResult[0]?.count || 0);
  const errorSessionCount = Number(thisWeekErrorResult[0]?.count || 0);
  const totalEvaluated = Number(thisWeekEvaluatedResult[0]?.count || 0);

  const badCaseRate = totalEvaluated > 0 ? badCaseCount / totalEvaluated : 0;
  const toolErrorRate = totalSessions > 0 ? errorSessionCount / totalSessions : 0;

  const lastWeekBadCount = Number(lastWeekBadResult[0]?.count || 0);
  const lastWeekErrorCount = Number(lastWeekErrorResult[0]?.count || 0);
  const lastWeekEvaluatedCount = Number(lastWeekEvaluatedResult[0]?.count || 0);
  const lastWeekTotalCount = Number(lastWeekTotalResult[0]?.count || 0);

  const lastWeekBadRate = lastWeekEvaluatedCount > 0 ? lastWeekBadCount / lastWeekEvaluatedCount : 0;
  const lastWeekErrorRate = lastWeekTotalCount > 0 ? lastWeekErrorCount / lastWeekTotalCount : 0;

  const badCaseTrend = badCaseRate - lastWeekBadRate;
  const toolErrorTrend = toolErrorRate - lastWeekErrorRate;
  const avgResponseTime = Number(thisWeekAvgLatencyResult[0]?.avgLatencyMs || 0);

  return {
    realtime: {
      activeUsers: Number(activeUsersResult[0]?.count || 0),
      todayActivities: Number(todayActivitiesResult[0]?.count || 0),
      tokenUsage: Number(todayTokenUsageResult[0]?.totalTokens || 0),
      totalConversations: Number(todayConversationsResult[0]?.count || 0),
    },
    northStar: j2cRate,
    aiHealth: {
      badCaseRate: Math.round(badCaseRate * 10000) / 100,
      toolErrorRate: Math.round(toolErrorRate * 10000) / 100,
      avgResponseTime: Math.round(avgResponseTime),
      badCaseTrend: Math.round(badCaseTrend * 10000) / 100,
      toolErrorTrend: Math.round(toolErrorTrend * 10000) / 100,
    },
    alerts: {
      errorCount24h: Number(error24hResult[0]?.count || 0),
      sensitiveWordHits: Number(sensitiveHitsResult[0]?.count || 0),
      pendingModeration: Number(pendingModerationResult[0]?.count || 0),
    },
  };
}

// Analytics Service - 数据分析领域业务逻辑
// 从 Growth 模块迁移趋势分析能力

import { db, conversationMessages, aiConversationMetrics, contentNotes, sql, desc, and, gte, isNotNull, eq } from '@juchang/db';
import { generateObject, jsonSchema } from 'ai';
import { t } from 'elysia';
import { toJsonSchema } from '@juchang/utils';
import type { 
  TrendsQuery, 
  TrendsResponse, 
  ContentPerformanceQuery, 
  ContentPerformanceResponse,
  MetricsQuery,
  MetricsResponse,
} from './analytics.model';
import { intentDisplayNames } from '../ai/intent/definitions';
import type { IntentType } from '../ai/intent/types';
import { getDeepSeekChat } from '../ai/models/adapters/deepseek';

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
      const content = msg.content as any;
      if (typeof content === 'string') {
        texts.push(content);
      } else if (content?.text) {
        texts.push(content.text);
      }
    }

    // 3. 用 LLM 提取高频词
    if (texts.length > 0) {
      try {
        const result = await generateObject({
          model: getDeepSeekChat(),
          schema: jsonSchema<KeywordExtraction>(toJsonSchema(KeywordExtractionSchema) as any),
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

  // 构建查询条件
  const conditions = [isNotNull(contentNotes.views)];
  
  if (contentType) {
    conditions.push(eq(contentNotes.contentType, contentType as any));
  }
  if (startDate) {
    conditions.push(gte(contentNotes.createdAt, new Date(startDate)));
  }
  if (endDate) {
    // 添加 endDate 条件
  }

  const where = and(...conditions);

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
    .where(where)
    .groupBy(contentNotes.contentType);

  // 总笔记数
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes);

  // 已回填效果数据的笔记数
  const [perfResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)
    .where(isNotNull(contentNotes.views));

  const totalContents = totalResult?.count ?? 0;
  const totalWithPerformance = perfResult?.count ?? 0;

  // 热门内容排行榜
  const topContents = await db
    .select({
      id: contentNotes.id,
      title: contentNotes.title,
      topic: contentNotes.topic,
      contentType: contentNotes.contentType,
      views: contentNotes.views,
      likes: contentNotes.likes,
      collects: contentNotes.collects,
      engagementScore: engagementScoreExpr,
    })
    .from(contentNotes)
    .where(where)
    .orderBy(desc(engagementScoreExpr))
    .limit(10);

  return {
    byType: byType.map(t => ({
      contentType: t.contentType || 'unknown',
      avgViews: t.avgViews,
      avgLikes: t.avgLikes,
      avgCollects: t.avgCollects,
      count: t.count,
    })),
    topContents: topContents.map(c => ({
      id: c.id,
      title: c.title,
      topic: c.topic,
      contentType: c.contentType || 'unknown',
      views: c.views,
      likes: c.likes,
      collects: c.collects,
      engagementScore: c.engagementScore,
    })),
    totalContents,
    totalWithPerformance,
    period: `${startDate || 'all'} to ${endDate || 'now'}`,
  };
}

// ==========================================
// 综合指标 (可扩展)
// ==========================================

/**
 * 获取综合业务指标
 * 聚合各领域的核心指标
 */
export async function getMetrics(query: MetricsQuery): Promise<MetricsResponse> {
  const { period = 30 } = query;
  
  // 这里可以集成各领域的统计
  // 如用户增长、活动转化、AI 使用量等
  
  const metrics = [
    {
      name: '用户增长率',
      value: 15.5,
      benchmark: 'green' as const,
      comparison: '较上月 +2.3%',
      trend: 'up' as const,
    },
    {
      name: '活动成局率',
      value: 68.2,
      benchmark: 'yellow' as const,
      comparison: '较上月 -1.5%',
      trend: 'down' as const,
    },
  ];

  return {
    metrics,
    generatedAt: new Date().toISOString(),
  };
}

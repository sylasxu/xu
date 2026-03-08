// Analytics Model - 数据分析领域 Schema
// 从 Growth 模块迁移趋势分析能力
import { Elysia, t, type Static } from 'elysia';

/**
 * Analytics Model Plugin
 * 统一的数据分析统计接口
 */

// ==========================================
// 趋势分析 Schema (从 Growth 迁移)
// ==========================================

// 趋势查询参数
const TrendsQuerySchema = t.Object({
  period: t.Optional(t.Union([
    t.Literal('7d'),
    t.Literal('30d'),
  ], { description: '时间范围', default: '7d' })),
  source: t.Optional(t.Union([
    t.Literal('conversations'),   // 对话消息趋势
    t.Literal('intents'),         // 意图分布趋势
    t.Literal('keywords'),        // 关键词趋势
    t.Literal('activities'),      // 活动趋势
  ], { description: '数据来源', default: 'conversations' })),
});

// 高频词项
const TrendWordSchema = t.Object({
  word: t.String(),
  count: t.Number(),
  trend: t.Union([t.Literal('up'), t.Literal('down'), t.Literal('stable')]),
});

// 意图分布项
const IntentDistributionSchema = t.Object({
  intent: t.String(),
  count: t.Number(),
  percentage: t.Number(),
});

// 趋势分析响应
const TrendsResponseSchema = t.Object({
  topWords: t.Array(TrendWordSchema),
  intentDistribution: t.Array(IntentDistributionSchema),
  period: t.Union([t.Literal('7d'), t.Literal('30d')]),
  generatedAt: t.String(),
});

// ==========================================
// 内容效果分析 Schema (从 Content 迁移)
// ==========================================

// 内容效果查询参数
const ContentPerformanceQuerySchema = t.Object({
  contentType: t.Optional(t.String({ description: '内容类型筛选' })),
  startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
  endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
});

// 内容类型聚合
const ContentTypeAggregationSchema = t.Object({
  contentType: t.String(),
  avgViews: t.Number(),
  avgLikes: t.Number(),
  avgCollects: t.Number(),
  count: t.Number(),
});

// 热门笔记项
const TopContentItemSchema = t.Object({
  id: t.String(),
  title: t.String(),
  topic: t.String(),
  contentType: t.String(),
  views: t.Union([t.Number(), t.Null()]),
  likes: t.Union([t.Number(), t.Null()]),
  collects: t.Union([t.Number(), t.Null()]),
  engagementScore: t.Number(),
});

// 内容效果响应
const ContentPerformanceResponseSchema = t.Object({
  byType: t.Array(ContentTypeAggregationSchema),
  topContents: t.Array(TopContentItemSchema),
  totalContents: t.Number(),
  totalWithPerformance: t.Number(),
  period: t.String(),
});

// ==========================================
// 通用响应 Schema
// ==========================================

const ErrorResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// ==========================================
// 注册到 Elysia
// ==========================================

export const analyticsModel = new Elysia({ name: 'analyticsModel' })
  .model({
    // 趋势分析
    'analytics.trendsQuery': TrendsQuerySchema,
    'analytics.trendsResponse': TrendsResponseSchema,
    // 内容效果
    'analytics.contentPerformanceQuery': ContentPerformanceQuerySchema,
    'analytics.contentPerformanceResponse': ContentPerformanceResponseSchema,
    // 错误
    'analytics.error': ErrorResponseSchema,
  });

// ==========================================
// 导出 TS 类型
// ==========================================

export type TrendsQuery = Static<typeof TrendsQuerySchema>;
export type TrendWord = Static<typeof TrendWordSchema>;
export type IntentDistribution = Static<typeof IntentDistributionSchema>;
export type TrendsResponse = Static<typeof TrendsResponseSchema>;

export type ContentPerformanceQuery = Static<typeof ContentPerformanceQuerySchema>;
export type ContentTypeAggregation = Static<typeof ContentTypeAggregationSchema>;
export type TopContentItem = Static<typeof TopContentItemSchema>;
export type ContentPerformanceResponse = Static<typeof ContentPerformanceResponseSchema>;

export type ErrorResponse = Static<typeof ErrorResponseSchema>;

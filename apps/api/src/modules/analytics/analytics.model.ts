// Analytics Model - 数据分析领域 Schema

import { Elysia, t, type Static } from 'elysia'
import { ContentNoteResponseSchema } from '../content/content.model'
import { ContentTypeSchema } from '../content/content-type'

const TrendsQuerySchema = t.Object({
  period: t.Optional(t.Union([
    t.Literal('7d'),
    t.Literal('30d'),
  ], { description: '时间范围', default: '7d' })),
  source: t.Optional(t.Union([
    t.Literal('conversations'),
    t.Literal('intents'),
    t.Literal('keywords'),
    t.Literal('activities'),
  ], { description: '数据来源', default: 'conversations' })),
})

const TrendWordSchema = t.Object({
  word: t.String(),
  count: t.Number(),
  trend: t.Union([t.Literal('up'), t.Literal('down'), t.Literal('stable')]),
})

const IntentDistributionSchema = t.Object({
  intent: t.String(),
  count: t.Number(),
  percentage: t.Number(),
})

const TrendsResponseSchema = t.Object({
  topWords: t.Array(TrendWordSchema),
  intentDistribution: t.Array(IntentDistributionSchema),
  period: t.Union([t.Literal('7d'), t.Literal('30d')]),
  generatedAt: t.String(),
})

const ContentPerformanceQuerySchema = t.Object({
  contentType: t.Optional(ContentTypeSchema),
  startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
  endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
})

const ContentTypeAggregationSchema = t.Object({
  contentType: ContentTypeSchema,
  avgViews: t.Number(),
  avgLikes: t.Number(),
  avgCollects: t.Number(),
  count: t.Integer(),
})

const ContentPerformanceResponseSchema = t.Object({
  byType: t.Array(ContentTypeAggregationSchema),
  topNotes: t.Array(ContentNoteResponseSchema),
  totalNotes: t.Integer(),
  totalWithPerformance: t.Integer(),
  period: t.String(),
})

const BenchmarkStatusSchema = t.Union([
  t.Literal('green'),
  t.Literal('yellow'),
  t.Literal('red'),
])

const MetricValueSchema = t.Object({
  value: t.Number(),
  benchmark: BenchmarkStatusSchema,
  comparison: t.Optional(t.String()),
})

const J2CMetricSchema = t.Object({
  value: t.Number(),
  benchmark: BenchmarkStatusSchema,
  comparison: t.Optional(t.String()),
  convertedUsers: t.Number(),
  totalJoiners: t.Number(),
})

const WeeklyCompletedMetricSchema = t.Object({
  value: t.Number(),
  benchmark: BenchmarkStatusSchema,
  comparison: t.Optional(t.String()),
  lastWeekValue: t.Number(),
})

const BusinessMetricsResponseSchema = t.Object({
  j2cRate: J2CMetricSchema,
  weeklyCompletedCount: WeeklyCompletedMetricSchema,
  draftPublishRate: MetricValueSchema,
  activitySuccessRate: MetricValueSchema,
  weeklyRetention: MetricValueSchema,
  oneTimeCreatorRate: MetricValueSchema,
})

const PlatformOverviewRealtimeSchema = t.Object({
  activeUsers: t.Number(),
  todayActivities: t.Number(),
  tokenUsage: t.Number(),
  totalConversations: t.Number(),
})

const PlatformOverviewAIHealthSchema = t.Object({
  badCaseRate: t.Number(),
  toolErrorRate: t.Number(),
  avgResponseTime: t.Number(),
  badCaseTrend: t.Number(),
  toolErrorTrend: t.Number(),
})

const PlatformOverviewAlertsSchema = t.Object({
  errorCount24h: t.Number(),
  sensitiveWordHits: t.Number(),
  pendingModeration: t.Number(),
})

const PlatformOverviewResponseSchema = t.Object({
  realtime: PlatformOverviewRealtimeSchema,
  northStar: J2CMetricSchema,
  aiHealth: PlatformOverviewAIHealthSchema,
  alerts: PlatformOverviewAlertsSchema,
})

const ErrorResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
})

export const analyticsModel = new Elysia({ name: 'analyticsModel' }).model({
  'analytics.trendsQuery': TrendsQuerySchema,
  'analytics.trendsResponse': TrendsResponseSchema,
  'analytics.contentPerformanceQuery': ContentPerformanceQuerySchema,
  'analytics.contentPerformanceResponse': ContentPerformanceResponseSchema,
  'analytics.metricsResponse': BusinessMetricsResponseSchema,
  'analytics.platformOverviewResponse': PlatformOverviewResponseSchema,
  'analytics.error': ErrorResponseSchema,
})

export type TrendsQuery = Static<typeof TrendsQuerySchema>
export type TrendWord = Static<typeof TrendWordSchema>
export type IntentDistribution = Static<typeof IntentDistributionSchema>
export type TrendsResponse = Static<typeof TrendsResponseSchema>

export type ContentPerformanceQuery = Static<typeof ContentPerformanceQuerySchema>
export type ContentTypeAggregation = Static<typeof ContentTypeAggregationSchema>
export type ContentPerformanceResponse = Static<typeof ContentPerformanceResponseSchema>

export type BenchmarkStatus = Static<typeof BenchmarkStatusSchema>
export type MetricValue = Static<typeof MetricValueSchema>
export type J2CMetric = Static<typeof J2CMetricSchema>
export type WeeklyCompletedMetric = Static<typeof WeeklyCompletedMetricSchema>
export type BusinessMetricsResponse = Static<typeof BusinessMetricsResponseSchema>
export type PlatformOverviewRealtime = Static<typeof PlatformOverviewRealtimeSchema>
export type PlatformOverviewAIHealth = Static<typeof PlatformOverviewAIHealthSchema>
export type PlatformOverviewAlerts = Static<typeof PlatformOverviewAlertsSchema>
export type PlatformOverviewResponse = Static<typeof PlatformOverviewResponseSchema>

export type ErrorResponse = Static<typeof ErrorResponseSchema>

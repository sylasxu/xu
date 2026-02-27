// Dashboard Model - MVP 简化版：只保留 Admin 基础统计
import { Elysia, t, type Static } from 'elysia';
import { selectActivitySchema } from '@juchang/db';

/**
 * Dashboard Model Plugin - MVP 版本
 * 只保留 Admin 需要的基础统计接口
 */

// 基础统计数据
const DashboardStats = t.Object({
  totalUsers: t.Number(),
  totalActivities: t.Number(),
  activeActivities: t.Number(),
  todayNewUsers: t.Number(),
});

// 最近活动项（DB 字段从 @juchang/db 派生 + 聚合字段手动定义）
const RecentActivity = t.Composite([
  t.Pick(selectActivitySchema, ['id', 'title', 'status']),
  t.Object({
    creatorName: t.String(),           // 聚合字段，非 DB 列
    participantCount: t.Number(),       // 聚合字段
    createdAt: t.String(),             // 时间转 ISO 字符串
  }),
]);

// 用户增长趋势数据项
const UserGrowthItem = t.Object({
  date: t.String(),
  totalUsers: t.Number(),
  newUsers: t.Number(),
  activeUsers: t.Number(),
});

// 活动类型分布
const ActivityTypeDistribution = t.Object({
  food: t.Number(),
  sports: t.Number(),
  entertainment: t.Number(),
  boardgame: t.Number(),
  other: t.Number(),
});

// 地理分布项
const GeographicItem = t.Object({
  name: t.String(),
  users: t.Number(),
  activities: t.Number(),
});

// 错误响应
const ErrorResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// ==========================================
// 核心业务指标 (PRD 17.2-17.4)
// ==========================================

// 基准状态枚举
const BenchmarkStatus = t.Union([
  t.Literal('green'),
  t.Literal('yellow'),
  t.Literal('red'),
]);

// 单个指标的通用结构
const MetricItem = t.Object({
  value: t.Number(),
  benchmark: BenchmarkStatus,
  comparison: t.Optional(t.String()),
});

// J2C 转化率 (北极星指标)
const J2CMetric = t.Object({
  value: t.Number(),
  benchmark: BenchmarkStatus,
  comparison: t.Optional(t.String()),
  convertedUsers: t.Number(),
  totalJoiners: t.Number(),
});

// 本周成局数
const WeeklyCompletedMetric = t.Object({
  value: t.Number(),
  benchmark: BenchmarkStatus,
  comparison: t.Optional(t.String()),
  lastWeekValue: t.Number(),
});

// 业务指标聚合响应
const BusinessMetrics = t.Object({
  j2cRate: J2CMetric,
  weeklyCompletedCount: WeeklyCompletedMetric,
  draftPublishRate: MetricItem,
  activitySuccessRate: MetricItem,
  weeklyRetention: MetricItem,
  oneTimeCreatorRate: MetricItem,
});

// v4.0 搭子意向指标
const IntentMetrics = t.Object({
  activeIntents: MetricItem,      // 活跃意向数
  todayNewIntents: MetricItem,    // 今日新增
  conversionRate: MetricItem,     // 转化率 (matched / total)
  avgMatchTime: MetricItem,       // 平均匹配时长 (分钟)
});

// ==========================================
// God View 仪表盘 (Admin Cockpit Redesign)
// ==========================================

// 实时概览
const RealtimeOverview = t.Object({
  activeUsers: t.Number(),        // 今日活跃用户
  todayActivities: t.Number(),    // 今日成局数
  tokenCost: t.Number(),          // 今日 Token 消耗（元）
  totalConversations: t.Number(), // 今日对话数
});

// AI 健康度
const AIHealth = t.Object({
  badCaseRate: t.Number(),        // Bad Case 率
  toolErrorRate: t.Number(),      // Tool 错误率
  avgResponseTime: t.Number(),    // 平均响应时长 (ms)
  badCaseTrend: t.Number(),       // Bad Case 趋势（较上周）
  toolErrorTrend: t.Number(),     // Tool 错误趋势
});

// 异常警报
const Alerts = t.Object({
  errorCount24h: t.Number(),      // 24h 报错数
  sensitiveWordHits: t.Number(),  // 敏感词触发数
  pendingModeration: t.Number(),  // 待审核数
});

// God View 完整数据
const GodViewData = t.Object({
  realtime: RealtimeOverview,
  northStar: J2CMetric,           // 北极星指标：J2C 转化率
  aiHealth: AIHealth,
  alerts: Alerts,
});

// 注册到 Elysia Model Plugin
export const dashboardModel = new Elysia({ name: 'dashboardModel' })
  .model({
    'dashboard.stats': DashboardStats,
    'dashboard.recentActivities': t.Array(RecentActivity),
    'dashboard.userGrowth': t.Array(UserGrowthItem),
    'dashboard.activityTypes': ActivityTypeDistribution,
    'dashboard.geographic': t.Array(GeographicItem),
    'dashboard.businessMetrics': BusinessMetrics,
    'dashboard.intentMetrics': IntentMetrics,
    'dashboard.godView': GodViewData,
    'dashboard.error': ErrorResponse,
  });

// 导出 TS 类型
export type DashboardStats = Static<typeof DashboardStats>;
export type RecentActivity = Static<typeof RecentActivity>;
export type UserGrowthItem = Static<typeof UserGrowthItem>;
export type ActivityTypeDistribution = Static<typeof ActivityTypeDistribution>;
export type GeographicItem = Static<typeof GeographicItem>;
export type ErrorResponse = Static<typeof ErrorResponse>;
export type BenchmarkStatus = Static<typeof BenchmarkStatus>;
export type MetricItem = Static<typeof MetricItem>;
export type J2CMetric = Static<typeof J2CMetric>;
export type WeeklyCompletedMetric = Static<typeof WeeklyCompletedMetric>;
export type BusinessMetrics = Static<typeof BusinessMetrics>;
export type IntentMetrics = Static<typeof IntentMetrics>;

// God View 类型导出
export type RealtimeOverview = Static<typeof RealtimeOverview>;
export type AIHealth = Static<typeof AIHealth>;
export type Alerts = Static<typeof Alerts>;
export type GodViewData = Static<typeof GodViewData>;

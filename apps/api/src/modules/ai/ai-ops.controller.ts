// AI Ops Controller - 运营指标与安全持久化（Admin 用）
// 从 ai.controller.ts 提取，所有路由需要 Admin 权限
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAdmin, AuthError } from '../../setup';
import { aiModel, type ErrorResponse } from './ai.model';
import {
  // v4.6 Quality & Conversion Metrics
  getQualityMetrics,
  getConversionMetrics,
  getPlaygroundStats,
  // v4.6 Security Persistence
  getSensitiveWordsFromDB,
  addSensitiveWordToDB,
  deleteSensitiveWordFromDB,
  getSecurityEvents,
  getSecurityStatsFromDB,
  // v4.6: AI 健康度
  getAIHealthMetrics,
} from './ai-ops.service';

export const aiOpsController = new Elysia({ prefix: '/ops' })
  .use(basePlugins)
  .use(aiModel)
  .onBeforeHandle(async ({ jwt, headers, set }) => {
    try {
      await verifyAdmin(jwt, headers);
    } catch (error) {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { code: error.status, msg: error.message };
      }
    }
  })

  // ==========================================
  // 对话质量监控 API (v4.6)
  // ==========================================

  // 获取对话质量指标
  .get(
    '/metrics/quality',
    async ({ query, set }) => {
      try {
        const endDate = query.endDate
          ? new Date(query.endDate + 'T23:59:59')
          : new Date();
        const startDate = query.startDate
          ? new Date(query.startDate + 'T00:00:00')
          : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

        const result = await getQualityMetrics({ startDate, endDate });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取质量指标失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取对话质量指标',
        description: '获取对话质量评分、意图识别率、Tool 成功率等指标（Admin 用）。',
      },
      query: t.Object({
        startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
        endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
      }),
      response: {
        200: 'ai.qualityMetricsResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取转化率指标
  .get(
    '/metrics/conversion',
    async ({ query, set }) => {
      try {
        const endDate = query.endDate
          ? new Date(query.endDate + 'T23:59:59')
          : new Date();
        const startDate = query.startDate
          ? new Date(query.startDate + 'T00:00:00')
          : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

        const result = await getConversionMetrics({
          startDate,
          endDate,
          intent: query.intent,
        });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取转化指标失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取转化率指标',
        description: '获取对话到活动创建/报名的转化漏斗数据（Admin 用）。',
      },
      query: t.Object({
        startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
        endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
        intent: t.Optional(t.String({ description: '意图类型过滤' })),
      }),
      response: {
        200: 'ai.conversionMetricsResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取 Playground 统计
  .get(
    '/metrics/playground-stats',
    async ({ set }) => {
      try {
        const result = await getPlaygroundStats();
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取 Playground 统计失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取 Playground 统计',
        description: '获取意图分布、Tool 成功率等 Playground 调试统计（Admin 用）。',
      },
      response: {
        200: 'ai.playgroundStatsResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // v4.6: AI 健康度指标 (Dashboard)
  .get(
    '/metrics/health',
    async ({ set }) => {
      try {
        const result = await getAIHealthMetrics();
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取健康度指标失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取 AI 健康度指标',
        description: `获取 AI 健康度指标（Dashboard 用）。

返回内容：
- badCaseRate: Bad Case 占比
- toolErrorRate: Tool 错误率
- badCaseTrend: 与上周对比的趋势（正数上升，负数下降）
- toolErrorTrend: 与上周对比的趋势`,
      },
      response: {
        200: 'ai.aiHealthMetricsResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // Security 持久化 API (v4.6)
  // ==========================================

  // 获取敏感词列表（数据库）
  .get(
    '/security/sensitive-words-db',
    async ({ query, set }) => {
      try {
        const result = await getSensitiveWordsFromDB(query.page, query.limit);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取敏感词失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取敏感词列表（数据库）',
        description: '从数据库获取敏感词列表，支持分页（Admin 用）。',
      },
      query: t.Object({
        page: t.Optional(t.Number({ default: 1 })),
        limit: t.Optional(t.Number({ default: 50 })),
      }),
      response: {
        200: 'ai.opsSensitiveWordsDBResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 添加敏感词（数据库）
  .post(
    '/security/sensitive-words-db',
    async ({ body, set }) => {
      try {
        const result = await addSensitiveWordToDB(body.word, body.category, body.severity);
        if (!result.success) {
          set.status = 400;
          return { code: 400, msg: result.message } satisfies ErrorResponse;
        }
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '添加敏感词失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '添加敏感词（数据库）',
        description: '添加敏感词到数据库（Admin 用）。',
      },
      body: t.Object({
        word: t.String({ description: '敏感词' }),
        category: t.Optional(t.String({ description: '分类' })),
        severity: t.Optional(t.String({ description: '严重程度' })),
      }),
      response: {
        200: 'ai.opsAddSensitiveWordResponse',
        400: 'ai.error',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 删除敏感词（数据库）
  .delete(
    '/security/sensitive-words-db/:id',
    async ({ params, set }) => {
      try {
        const result = await deleteSensitiveWordFromDB(params.id);
        if (!result.success) {
          set.status = 404;
          return { code: 404, msg: result.message } satisfies ErrorResponse;
        }
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '删除敏感词失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '删除敏感词（数据库）',
        description: '从数据库删除敏感词（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '敏感词 ID' }),
      }),
      response: {
        200: 'ai.opsDeleteSensitiveWordResponse',
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取安全事件列表
  .get(
    '/security/events',
    async ({ query, set }) => {
      try {
        const startDate = query.startDate ? new Date(query.startDate + 'T00:00:00') : undefined;
        const endDate = query.endDate ? new Date(query.endDate + 'T23:59:59') : undefined;

        const result = await getSecurityEvents({
          startDate,
          endDate,
          eventType: query.eventType,
          page: query.page,
          limit: query.limit,
        });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取安全事件失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取安全事件列表',
        description: '获取安全拦截事件列表（Admin 用）。',
      },
      query: t.Object({
        startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
        endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
        eventType: t.Optional(t.String({ description: '事件类型' })),
        page: t.Optional(t.Number({ default: 1 })),
        limit: t.Optional(t.Number({ default: 20 })),
      }),
      response: {
        200: 'ai.securityEventsResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取安全统计（真实数据）
  .get(
    '/security/stats-db',
    async ({ query, set }) => {
      try {
        const endDate = query.endDate
          ? new Date(query.endDate + 'T23:59:59')
          : new Date();
        const startDate = query.startDate
          ? new Date(query.startDate + 'T00:00:00')
          : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

        const result = await getSecurityStatsFromDB(startDate, endDate);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取安全统计失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取安全统计（真实数据）',
        description: '从数据库获取真实的安全统计数据（Admin 用）。',
      },
      query: t.Object({
        startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
        endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
      }),
      response: {
        200: 'ai.securityStatsDBResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  );

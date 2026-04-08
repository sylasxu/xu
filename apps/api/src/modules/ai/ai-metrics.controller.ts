// AI Metrics Controller - 运营指标与安全持久化
// 从 ai.controller.ts 提取，所有路由需要 Admin 权限
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAdmin, AuthError } from '../../setup';
import { aiModel, type ErrorResponse } from './ai.model';
import {
  getSensitiveWordsFromDB,
  addSensitiveWordToDB,
  deleteSensitiveWordFromDB,
  getSecurityEvents,
  getSecurityStatsFromDB,
} from './ai.service';

const createAiMetricsController = (prefix = '') => new Elysia({ prefix })
  .use(basePlugins)
  .use(aiModel)
  .onBeforeHandle(async ({ jwt, headers, set }) => {
    try {
      await verifyAdmin(jwt, headers);
    } catch (error) {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { code: error.status, msg: error.message } satisfies ErrorResponse;
      }
    }
  })

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
        tags: ['Internal'],
        summary: '获取敏感词列表（数据库）',
        description: '从数据库获取敏感词列表，支持分页（Admin 用）。',
      },
      query: t.Object({
        page: t.Optional(t.Number({ default: 1 })),
        limit: t.Optional(t.Number({ default: 50 })),
      }),
      response: {
        200: 'ai.securitySensitiveWordsDBResponse',
        401: 'common.error',
        500: 'common.error',
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
        tags: ['Internal'],
        summary: '添加敏感词（数据库）',
        description: '添加敏感词到数据库（Admin 用）。',
      },
      body: t.Object({
        word: t.String({ description: '敏感词' }),
        category: t.Optional(t.String({ description: '分类' })),
        severity: t.Optional(t.String({ description: '严重程度' })),
      }),
      response: {
        200: 'ai.securityAddSensitiveWordResponse',
        400: 'common.error',
        401: 'common.error',
        500: 'common.error',
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
        tags: ['Internal'],
        summary: '删除敏感词（数据库）',
        description: '从数据库删除敏感词（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '敏感词 ID' }),
      }),
      response: {
        200: 'ai.securityDeleteSensitiveWordResponse',
        401: 'common.error',
        404: 'common.error',
        500: 'common.error',
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
        tags: ['Internal'],
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
        401: 'common.error',
        500: 'common.error',
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
        tags: ['Internal'],
        summary: '获取安全统计（真实数据）',
        description: '从数据库获取真实的安全统计数据（Admin 用）。',
      },
      query: t.Object({
        startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
        endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
      }),
      response: {
        200: 'ai.securityStatsDBResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  );

export const aiMetricsController = createAiMetricsController();

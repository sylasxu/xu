/**
 * Anomaly Controller - 异常检测接口
 */
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAdmin, AuthError } from '../../../setup';
import { detectAllAnomalies, getAnomalyStats } from './detector';

const AnomalyUserSchema = t.Object({
  anomalyId: t.String(),
  userId: t.String(),
  userNickname: t.Union([t.String(), t.Null()]),
  anomalyType: t.Union([t.Literal('bulk_create'), t.Literal('frequent_cancel'), t.Literal('high_token_usage'), t.Literal('duplicate_requests')]),
  severity: t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')]),
  count: t.Number(),
  detectedAt: t.String(),
});

const AnomalyListResponseSchema = t.Object({
  items: t.Array(AnomalyUserSchema),
  total: t.Number(),
});

const AnomalyStatsSchema = t.Object({
  total: t.Number(),
  byType: t.Object({
    bulk_create: t.Number(),
    frequent_cancel: t.Number(),
    high_token_usage: t.Number(),
    duplicate_requests: t.Number(),
  }),
  bySeverity: t.Object({
    high: t.Number(),
    medium: t.Number(),
    low: t.Number(),
  }),
});

export const anomalyController = new Elysia({ prefix: '/ai/anomaly' })
  .use(basePlugins)
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

  // 获取异常用户列表
  .get(
    '/users',
    async ({ query }) => {
      const anomalies = await detectAllAnomalies();
      
      // 简单分页
      const page = query.page || 1;
      const limit = query.limit || 20;
      const start = (page - 1) * limit;
      const items = anomalies.slice(start, start + limit);

      return {
        items,
        total: anomalies.length,
      };
    },
    {
      detail: {
        tags: ['AI', 'Anomaly'],
        summary: '获取异常用户列表',
        description: '实时检测并返回异常用户列表',
      },
      query: t.Object({
        page: t.Optional(t.Number({ minimum: 1, default: 1 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20 })),
      }),
      response: {
        200: AnomalyListResponseSchema,
      },
    }
  )

  // 获取异常统计
  .get(
    '/stats',
    async () => {
      return await getAnomalyStats();
    },
    {
      detail: {
        tags: ['AI', 'Anomaly'],
        summary: '获取异常统计',
        description: '获取异常检测的统计数据',
      },
      response: {
        200: AnomalyStatsSchema,
      },
    }
  )

  // 标记异常已处理（目前只是返回成功，不持久化）
  .post(
    '/users/:anomalyId/action',
    async ({ params, body }) => {
      // 简化版：不持久化处理状态，只返回成功
      // 后续可以添加 anomaly_actions 表来记录处理历史
      return {
        success: true,
        anomalyId: params.anomalyId,
        action: body.action,
        msg: body.action === 'handled' ? '已标记为已处理' : '已忽略',
      };
    },
    {
      detail: {
        tags: ['AI', 'Anomaly'],
        summary: '处理异常',
        description: '标记异常为已处理或忽略',
      },
      body: t.Object({
        action: t.Union([t.Literal('handled'), t.Literal('ignored')]),
        notes: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          anomalyId: t.String(),
          action: t.String(),
          msg: t.String(),
        }),
      },
    }
  );

// AI RAG Controller - RAG 运营管理（Admin 用）
// 从 ai.controller.ts 提取，所有路由需要 Admin 权限
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAdmin, AuthError } from '../../setup';
import { aiModel, type ErrorResponse } from './ai.model';
import {
  getRagStats,
  testRagSearch,
  rebuildActivityIndex,
  startBackfill,
  getBackfillStatus,
} from './ai.service';

export const aiRagController = new Elysia({ prefix: '/rag' })
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
  // RAG 运营 API (v4.5)
  // ==========================================

  // 获取 RAG 统计信息
  .get(
    '/stats',
    async ({ set }) => {
      try {
        const stats = await getRagStats();
        return stats;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取 RAG 统计失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-RAG'],
        summary: '获取 RAG 统计信息',
        description: '获取 RAG 索引覆盖率、未索引活动列表等统计信息（Admin 用）。',
      },
      response: {
        200: 'ai.ragStatsResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // RAG 搜索测试
  .post(
    '/search',
    async ({ body, set }) => {
      try {
        const result = await testRagSearch(body);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || 'RAG 搜索测试失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-RAG'],
        summary: 'RAG 搜索测试',
        description: '执行语义搜索测试，返回搜索结果和性能指标（Admin 用）。',
      },
      body: t.Object({
        query: t.String({ description: '搜索查询' }),
        lat: t.Optional(t.Number({ description: '纬度' })),
        lng: t.Optional(t.Number({ description: '经度' })),
        radiusKm: t.Optional(t.Number({ default: 5, description: '搜索半径（公里）' })),
        userId: t.Optional(t.String({ description: '用户 ID（用于 MaxSim 测试）' })),
        limit: t.Optional(t.Number({ default: 20, description: '返回数量限制' })),
      }),
      response: {
        200: 'ai.ragSearchResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 重建单个活动索引
  .post(
    '/rebuild/:id',
    async ({ params, set }) => {
      try {
        const result = await rebuildActivityIndex(params.id);
        if (!result.success) {
          set.status = 400;
          return { code: 400, msg: result.error || '重建索引失败' } satisfies ErrorResponse;
        }
        return { success: true, msg: '索引重建成功' };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '重建索引失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-RAG'],
        summary: '重建单个活动索引',
        description: '重新生成指定活动的向量索引（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '活动 ID' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          msg: t.String(),
        }),
        400: 'common.error',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 开始批量回填
  .post(
    '/backfill',
    async ({ set }) => {
      try {
        const result = await startBackfill();
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '启动回填失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-RAG'],
        summary: '开始批量回填',
        description: '开始批量索引所有未索引的活动（Admin 用）。',
      },
      response: {
        200: t.Object({
          started: t.Boolean(),
          message: t.String(),
        }),
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 获取回填状态
  .get(
    '/backfill/status',
    async () => {
      const status = getBackfillStatus();
      return status;
    },
    {
      detail: {
        tags: ['AI-RAG'],
        summary: '获取回填状态',
        description: '获取批量回填任务的当前状态（Admin 用）。',
      },
      response: {
        200: 'ai.ragBackfillStatusResponse',
        401: 'common.error',
      },
    }
  );

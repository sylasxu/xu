// AI Security Controller - 安全运营（敏感词、审核、违规统计）
// 从 ai.controller.ts 提取，所有路由需要 Admin 权限
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAdmin, AuthError } from '../../setup';
import { aiModel, type ErrorResponse } from './ai.model';
import {
  getSecurityOverview,
  getSensitiveWords,
  addSensitiveWord,
  deleteSensitiveWord,
  importSensitiveWords,
  getModerationQueue,
  approveModeration,
  rejectModeration,
  banModeration,
  getViolationStats,
} from './ai.service';

export const aiSecurityController = new Elysia({ prefix: '/security' })
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
  // 安全总览
  // ==========================================
  .get(
    '/overview',
    async ({ set }) => {
      try {
        const overview = await getSecurityOverview();
        return overview;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取安全总览失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '获取安全总览',
        description: '获取今日安全指标、趋势图和护栏状态（Admin 用）。',
      },
      response: {
        200: 'ai.securityOverviewResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // ==========================================
  // 敏感词管理
  // ==========================================

  // 获取敏感词列表
  .get(
    '/sensitive-words',
    async () => {
      const result = getSensitiveWords();
      return result;
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '获取敏感词列表',
        description: '获取当前敏感词库（Admin 用）。',
      },
      response: {
        200: 'ai.sensitiveWordsResponse',
        401: 'common.error',
      },
    }
  )

  // 添加敏感词
  .post(
    '/sensitive-words',
    async ({ body, set }) => {
      const result = addSensitiveWord(body.word);
      if (!result.success) {
        set.status = 400;
        return { code: 400, msg: result.message } satisfies ErrorResponse;
      }
      return result;
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '添加敏感词',
        description: '添加单个敏感词到词库（Admin 用）。',
      },
      body: t.Object({
        word: t.String({ description: '敏感词' }),
      }),
      response: {
        200: 'ai.sensitiveWordOpResponse',
        400: 'common.error',
        401: 'common.error',
      },
    }
  )

  // 删除敏感词
  .delete(
    '/sensitive-words/:word',
    async ({ params, set }) => {
      const result = deleteSensitiveWord(decodeURIComponent(params.word));
      if (!result.success) {
        set.status = 404;
        return { code: 404, msg: result.message } satisfies ErrorResponse;
      }
      return result;
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '删除敏感词',
        description: '从词库中删除指定敏感词（Admin 用）。',
      },
      params: t.Object({
        word: t.String({ description: '敏感词（URL 编码）' }),
      }),
      response: {
        200: 'ai.sensitiveWordOpResponse',
        401: 'common.error',
        404: 'common.error',
      },
    }
  )

  // 批量导入敏感词
  .post(
    '/sensitive-words/import',
    async ({ body }) => {
      const result = importSensitiveWords(body.words);
      return result;
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '批量导入敏感词',
        description: '批量导入敏感词到词库（Admin 用）。',
      },
      body: t.Object({
        words: t.Array(t.String(), { description: '敏感词列表' }),
      }),
      response: {
        200: 'ai.sensitiveWordsImportResponse',
        401: 'common.error',
      },
    }
  )

  // ==========================================
  // 审核队列
  // ==========================================

  // 获取审核队列
  .get(
    '/moderation/queue',
    async ({ query, set }) => {
      try {
        const result = await getModerationQueue(query.page, query.limit);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取审核队列失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '获取审核队列',
        description: '获取待审核内容列表（Admin 用）。',
      },
      query: t.Object({
        page: t.Optional(t.Number({ default: 1, description: '页码' })),
        limit: t.Optional(t.Number({ default: 20, description: '每页数量' })),
      }),
      response: {
        200: 'ai.moderationQueueResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 审核通过
  .post(
    '/moderation/:id/approve',
    async ({ params, set }) => {
      try {
        const result = await approveModeration(params.id);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '审核操作失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '审核通过',
        description: '将指定内容标记为审核通过（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '审核项 ID' }),
      }),
      response: {
        200: 'ai.moderationOpResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 审核拒绝
  .post(
    '/moderation/:id/reject',
    async ({ params, set }) => {
      try {
        const result = await rejectModeration(params.id);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '审核操作失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '审核拒绝',
        description: '将指定内容标记为审核拒绝（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '审核项 ID' }),
      }),
      response: {
        200: 'ai.moderationOpResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 审核拒绝并封号
  .post(
    '/moderation/:id/ban',
    async ({ params, set }) => {
      try {
        const result = await banModeration(params.id);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '审核操作失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '审核拒绝并封号',
        description: '将指定内容标记为审核拒绝，删除内容并封禁用户（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '审核项 ID' }),
      }),
      response: {
        200: 'ai.moderationOpResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // ==========================================
  // 违规统计
  // ==========================================
  .get(
    '/violations/stats',
    async ({ set }) => {
      try {
        const stats = await getViolationStats();
        return stats;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取违规统计失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Security'],
        summary: '获取违规统计',
        description: '获取违规类型分布、趋势和高频违规用户（Admin 用）。',
      },
      response: {
        200: 'ai.violationStatsResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  );

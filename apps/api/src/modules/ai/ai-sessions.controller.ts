// AI Sessions Controller - 会话管理（Admin 对话审计用）
// 从 ai.controller.ts 提取，所有路由需要 Admin 权限
import { Elysia, t } from 'elysia';
import { basePlugins } from '../../setup';
import { aiModel, type ErrorResponse } from './ai.model';
import { requireCapability } from './policy/capability';
import {
  listConversations,
  getConversationMessages,
  deleteConversation,
  deleteConversationsBatch,
  evaluateConversation,
} from './ai.service';

export const aiSessionsController = new Elysia({ prefix: '/sessions' })
  .use(basePlugins)
  .use(aiModel)
  .onBeforeHandle(async ({ jwt, headers, set }) => {
    const { error } = await requireCapability({
      capability: 'ai.session.evaluate',
      jwt,
      headers,
      set,
    });
    if (error) {
      return error;
    }
  })

  // ==========================================
  // 会话列表 v3.8 (Admin 对话审计用)
  // v4.6: 支持评估状态筛选
  // ==========================================
  .get(
    '/',
    async ({ query, set }) => {
      try {
        const result = await listConversations({
          page: query.page,
          limit: query.limit,
          userId: query.userId,
          // v4.6: 评估筛选
          evaluationStatus: query.evaluationStatus as 'unreviewed' | 'good' | 'bad' | undefined,
          hasError: query.hasError,
        });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取会话列表失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取会话列表',
        description: `获取所有会话列表（Admin 对话审计用）。每个会话代表一次完整的用户与 AI 的交互。

v4.6 新增筛选：
- evaluationStatus: 按评估状态筛选 (unreviewed/good/bad)
- hasError: 按是否有错误筛选`,
      },
      query: t.Object({
        page: t.Optional(t.Number({ minimum: 1, default: 1 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 1000, default: 20 })),
        userId: t.Optional(t.String({ description: '按用户 ID 筛选' })),
        // v4.6: 评估筛选
        evaluationStatus: t.Optional(t.Union([
          t.Literal('unreviewed'),
          t.Literal('good'),
          t.Literal('bad'),
        ], { description: '按评估状态筛选' })),
        hasError: t.Optional(t.Boolean({ description: '按是否有错误筛选' })),
      }),
      response: {
        200: 'ai.sessionListResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取会话详情（消息列表）
  .get(
    '/:id',
    async ({ params, set }) => {
      try {
        const result = await getConversationMessages(params.id);
        if (!result.conversation) {
          set.status = 404;
          return { code: 404, msg: '会话不存在' } satisfies ErrorResponse;
        }
        return {
          conversation: result.conversation,
          messages: result.messages,
        };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取会话详情失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取会话详情',
        description: '获取指定会话的所有消息（Admin 对话审计用）。',
      },
      params: t.Object({
        id: t.String({ description: '会话 ID' }),
      }),
      response: {
        200: 'ai.sessionDetailResponse',
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // v4.6: 会话评估 (Admin Command Center)
  // ==========================================
  .patch(
    '/:id/evaluate',
    async ({ params, body, set }) => {
      try {
        const result = await evaluateConversation({
          conversationId: params.id,
          status: body.status,
          tags: body.tags,
          note: body.note,
        });

        if (!result) {
          set.status = 404;
          return { code: 404, msg: '会话不存在' } satisfies ErrorResponse;
        }

        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '评估失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '评估会话',
        description: `标记会话为 Good/Bad Case（Admin 对话审计用）。

Bad Case 标签可选值：
- wrong_intent: 意图识别错误
- hallucination: AI 幻觉
- tool_error: Tool 调用错误
- bad_tone: 语气不当
- incomplete: 回复不完整`,
      },
      params: t.Object({
        id: t.String({ description: '会话 ID' }),
      }),
      body: t.Object({
        status: t.Union([t.Literal('good'), t.Literal('bad')], { description: '评估状态' }),
        tags: t.Optional(t.Array(t.String(), { description: 'Bad Case 标签' })),
        note: t.Optional(t.String({ description: '人工备注' })),
      }),
      response: {
        200: 'ai.sessionEvaluateResponse',
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 删除单个会话（Admin 用）
  .delete(
    '/:id',
    async ({ params, set }) => {
      try {
        const deleted = await deleteConversation(params.id);
        if (!deleted) {
          set.status = 404;
          return { code: 404, msg: '会话不存在' } satisfies ErrorResponse;
        }
        return { success: true as const, msg: '会话已删除' };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '删除会话失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '删除会话',
        description: '删除指定会话及其所有消息（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '会话 ID' }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          msg: t.String(),
        }),
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 批量删除会话（Admin 用）- kebab-case
  .post(
    '/batch-delete',
    async ({ body, set }) => {
      try {
        const result = await deleteConversationsBatch(body.ids);
        return { success: true as const, msg: '批量删除成功', count: result.deletedCount };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '批量删除失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '批量删除会话',
        description: '批量删除多个会话及其所有消息（Admin 用）。',
      },
      body: t.Object({
        ids: t.Array(t.String(), { description: '要删除的会话 ID 列表' }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          msg: t.String(),
          count: t.Number(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  );

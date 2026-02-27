// AI Memory Controller - Memory 运营管理（Admin 用）
// 从 ai.controller.ts 提取，所有路由需要 Admin 权限
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAdmin, AuthError } from '../../setup';
import { aiModel, type ErrorResponse } from './ai.model';
import {
  getUserMemoryProfile,
  searchUsers,
  testMaxSim,
} from './ai-ops.service';

export const aiMemoryController = new Elysia({ prefix: '/memory' })
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
  // Memory 运营 API (v4.5)
  // ==========================================

  // 搜索用户
  .get(
    '/users',
    async ({ query, set }) => {
      try {
        const results = await searchUsers(query.q || '', query.limit);
        return { users: results };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '搜索用户失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '搜索用户',
        description: '按昵称或 ID 搜索用户（Admin 用）。',
      },
      query: t.Object({
        q: t.Optional(t.String({ description: '搜索关键词（昵称或 ID）' })),
        limit: t.Optional(t.Number({ default: 10, description: '返回数量限制' })),
      }),
      response: {
        200: 'ai.memoryUsersResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取用户画像
  .get(
    '/:userId',
    async ({ params, set }) => {
      try {
        const profile = await getUserMemoryProfile(params.userId);
        if (!profile) {
          set.status = 404;
          return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
        }
        return profile;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取用户画像失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取用户画像',
        description: '获取指定用户的工作记忆和兴趣向量（Admin 用）。',
      },
      params: t.Object({
        userId: t.String({ description: '用户 ID' }),
      }),
      response: {
        200: 'ai.memoryProfileResponse',
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // MaxSim 测试
  .post(
    '/:userId/maxsim',
    async ({ params, body, set }) => {
      try {
        const result = await testMaxSim({
          userId: params.userId,
          query: body.query,
        });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || 'MaxSim 测试失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: 'MaxSim 测试',
        description: '测试用户兴趣向量与查询的 MaxSim 相似度（Admin 用）。',
      },
      params: t.Object({
        userId: t.String({ description: '用户 ID' }),
      }),
      body: t.Object({
        query: t.String({ description: '测试查询' }),
      }),
      response: {
        200: 'ai.maxSimResponse',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  );

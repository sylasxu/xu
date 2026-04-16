// User Controller - 用户管理接口 (纯 RESTful)
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAdmin, verifySelfOrAdmin, AuthError } from '../../setup';
import {
  userModel,
  UserResponseSchema,
  UserListResponseSchema,
} from './user.model';
import { type ErrorResponse } from '../../common/common.model';
import { 
  getUserById, 
  getUserList, 
  updateUser,
  deleteUser,
  getQuota,
} from './user.service';
import { getEnhancedUserProfile } from '../ai/memory/working';

export const userController = new Elysia({ prefix: '/users' })
  .use(basePlugins)
  .use(userModel)

  // 获取用户列表 (分页、搜索)
  .get(
    '/',
    async ({ query, jwt, headers, set }) => {
      try {
        await verifyAdmin(jwt, headers);
      } catch (error) {
        if (error instanceof AuthError) {
          set.status = error.status;
          return { code: error.status, msg: error.message } satisfies ErrorResponse;
        }
        set.status = 500;
        return { code: 500, msg: '鉴权失败' } satisfies ErrorResponse;
      }
      return await getUserList(query);
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '获取用户列表',
        description: '获取分页用户列表，支持按昵称或手机号搜索',
      },
      query: 'user.listQuery',
      response: {
        200: UserListResponseSchema,
        401: 'common.error',
        403: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 获取用户 AI 创建额度
  .get(
    '/:id/quota',
    async ({ params, set, jwt, headers }) => {
      try {
        await verifySelfOrAdmin(jwt, headers, params.id);
      } catch (error) {
        if (error instanceof AuthError) {
          set.status = error.status;
          return { code: error.status, msg: error.message } satisfies ErrorResponse;
        }
        set.status = 500;
        return { code: 500, msg: '鉴权失败' } satisfies ErrorResponse;
      }

      const quota = await getQuota(params.id);
      if (!quota) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }

      return quota;
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '获取用户 AI 创建额度',
        description: '获取指定用户今日剩余 AI 创建活动额度',
      },
      response: {
        200: 'user.quotaResponse',
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 获取用户详情
  .get(
    '/:id',
    async ({ params, set, jwt, headers }) => {
      try {
        await verifySelfOrAdmin(jwt, headers, params.id);
      } catch (error) {
        if (error instanceof AuthError) {
          set.status = error.status;
          return { code: error.status, msg: error.message } satisfies ErrorResponse;
        }
        set.status = 500;
        return { code: 500, msg: '鉴权失败' } satisfies ErrorResponse;
      }

      const user = await getUserById(params.id);
      if (!user) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }
      return user;
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '获取用户详情',
        description: '根据 ID 获取用户详细信息',
      },
      response: {
        200: UserResponseSchema,
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 更新用户信息
  .put(
    '/:id',
    async ({ params, body, set, jwt, headers }) => {
      try {
        await verifySelfOrAdmin(jwt, headers, params.id);
      } catch (error) {
        if (error instanceof AuthError) {
          set.status = error.status;
          return { code: error.status, msg: error.message } satisfies ErrorResponse;
        }
        set.status = 500;
        return { code: 500, msg: '鉴权失败' } satisfies ErrorResponse;
      }

      const updated = await updateUser(params.id, body);
      if (!updated) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }
      return updated;
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '更新用户信息',
        description: '更新指定用户的昵称和头像',
      },
      body: 'user.updateRequest',
      response: {
        200: UserResponseSchema,
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
      },
    }
  )

  // 删除用户
  .delete(
    '/:id',
    async ({ params, set, jwt, headers }) => {
      try {
        await verifyAdmin(jwt, headers);
      } catch (error) {
        if (error instanceof AuthError) {
          set.status = error.status;
          return { code: error.status, msg: error.message } satisfies ErrorResponse;
        }
        set.status = 500;
        return { code: 500, msg: '鉴权失败' } satisfies ErrorResponse;
      }

      const deleted = await deleteUser(params.id);
      if (!deleted) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }
      return { success: true, msg: '用户已删除' };
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '删除用户',
        description: '删除指定用户及其相关数据（硬删除）',
      },
      response: {
        200: 'user.success',
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
        500: 'common.error',
      },
    }
  )


  // 获取用户 AI 画像
  .get(
    '/:id/ai-profile',
    async ({ params, set, jwt, headers }) => {
      try {
        await verifyAdmin(jwt, headers);
      } catch (error) {
        if (error instanceof AuthError) {
          set.status = error.status;
          return { code: error.status, msg: error.message } satisfies ErrorResponse;
        }
        set.status = 500;
        return { code: 500, msg: '鉴权失败' } satisfies ErrorResponse;
      }

      const user = await getUserById(params.id);
      if (!user) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }
      
      const profile = await getEnhancedUserProfile(params.id);
      
      // 转换 sentiment: like -> positive, dislike -> negative
      const mapSentiment = (s: string): 'positive' | 'negative' | 'neutral' => {
        if (s === 'like') return 'positive';
        if (s === 'dislike') return 'negative';
        return 'neutral';
      };
      
      return {
        userId: params.id,
        preferences: profile.preferences.map(p => ({
          category: p.category,
          content: p.value,
          sentiment: mapSentiment(p.sentiment),
          confidence: p.confidence,
          updatedAt: p.updatedAt.toISOString(),
        })),
        frequentLocations: profile.frequentLocations.map(loc => ({
          name: loc,
          count: 1,
        })),
        lastAnalyzedAt: profile.lastUpdated.toISOString(),
      };
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '获取用户 AI 画像',
        description: '获取用户的 AI 提取画像，包括偏好和常去地点',
      },
      response: {
        200: t.Object({
          userId: t.String(),
          preferences: t.Array(t.Object({
            category: t.String(),
            content: t.String(),
            sentiment: t.Union([t.Literal('positive'), t.Literal('negative'), t.Literal('neutral')]),
            confidence: t.Number(),
            updatedAt: t.String(),
          })),
          frequentLocations: t.Array(t.Object({
            name: t.String(),
            count: t.Number(),
          })),
          lastAnalyzedAt: t.String(),
        }),
        404: 'common.error',
      },
    }
  );

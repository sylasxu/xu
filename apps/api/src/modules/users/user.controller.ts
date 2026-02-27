// User Controller - 用户管理接口 (纯 RESTful)
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAdmin, AuthError } from '../../setup';
import { 
  userModel, 
  UserResponseSchema,
  UserListResponseSchema,
  UserOverviewStatsSchema,
  UserGrowthResponseSchema,
  type ErrorResponse 
} from './user.model';
import { 
  getUserById, 
  getUserList, 
  updateUser,
  deleteUser,
  getQuota,
  setUserQuota,
  setUserQuotaBatch,
  getUserStats,
} from './user.service';
import { getEnhancedUserProfile } from '../ai/memory/working';

export const userController = new Elysia({ prefix: '/users' })
  .use(basePlugins)
  .use(userModel)
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

  // 获取用户统计
  .get(
    '/stats',
    async ({ query }) => {
      return await getUserStats(query);
    },
    {
      detail: {
        tags: ['Users'],
        summary: '获取用户统计',
        description: '获取用户统计数据，支持概览统计(type=overview)或增长趋势(type=growth)',
      },
      query: 'user.statsQuery',
      response: {
        200: t.Union([UserOverviewStatsSchema, UserGrowthResponseSchema]),
      },
    }
  )

  // 获取用户列表 (分页、搜索)
  .get(
    '/',
    async ({ query }) => {
      return await getUserList(query);
    },
    {
      detail: {
        tags: ['Users'],
        summary: '获取用户列表',
        description: '获取分页用户列表，支持按昵称或手机号搜索',
      },
      query: 'user.listQuery',
      response: {
        200: UserListResponseSchema,
      },
    }
  )

  // 获取用户详情
  .get(
    '/:id',
    async ({ params, set }) => {
      const user = await getUserById(params.id);
      if (!user) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }
      return user;
    },
    {
      detail: {
        tags: ['Users'],
        summary: '获取用户详情',
        description: '根据 ID 获取用户详细信息',
      },
      response: {
        200: UserResponseSchema,
        404: 'user.error',
      },
    }
  )

  // 更新用户信息
  .put(
    '/:id',
    async ({ params, body, set }) => {
      const updated = await updateUser(params.id, body);
      if (!updated) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }
      return updated;
    },
    {
      detail: {
        tags: ['Users'],
        summary: '更新用户信息',
        description: '更新指定用户的昵称和头像',
      },
      body: 'user.updateRequest',
      response: {
        200: UserResponseSchema,
        404: 'user.error',
      },
    }
  )

  // 删除用户
  .delete(
    '/:id',
    async ({ params, set }) => {
      const deleted = await deleteUser(params.id);
      if (!deleted) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }
      return { success: true, msg: '用户已删除' };
    },
    {
      detail: {
        tags: ['Users'],
        summary: '删除用户',
        description: '删除指定用户及其相关数据（硬删除）',
      },
      response: {
        200: 'user.success',
        404: 'user.error',
      },
    }
  )

  // 获取用户额度
  .get(
    '/:id/quota',
    async ({ params, set }) => {
      const quota = await getQuota(params.id);
      if (!quota) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }
      return quota;
    },
    {
      detail: {
        tags: ['Users'],
        summary: '获取用户额度',
        description: '获取指定用户今日剩余的 AI 创建额度',
      },
      response: {
        200: 'user.quotaResponse',
        404: 'user.error',
      },
    }
  )
  
  // 设置用户额度（Admin 用）
  .put(
    '/:id/quota',
    async ({ params, body, set }) => {
      const updated = await setUserQuota(params.id, body.quota);
      if (!updated) {
        set.status = 404;
        return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
      }
      return { success: true, msg: '额度已更新', quota: body.quota };
    },
    {
      detail: {
        tags: ['Users'],
        summary: '设置用户额度',
        description: '设置指定用户的 AI 创建额度（Admin 用）。设置为 999 表示无限额度。',
      },
      body: t.Object({
        quota: t.Number({ minimum: 0, maximum: 999, description: '新的额度值，999 表示无限' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          msg: t.String(),
          quota: t.Number(),
        }),
        404: 'user.error',
      },
    }
  )
  
  // 批量设置用户额度（Admin 用）
  .post(
    '/quota/batch',
    async ({ body }) => {
      const result = await setUserQuotaBatch(body.userIds, body.quota);
      return { success: true as const, msg: '批量设置额度成功', count: result.updatedCount };
    },
    {
      detail: {
        tags: ['Users'],
        summary: '批量设置用户额度',
        description: '批量设置多个用户的 AI 创建额度（Admin 用）。',
      },
      body: t.Object({
        userIds: t.Array(t.String(), { description: '用户 ID 列表' }),
        quota: t.Number({ minimum: 0, maximum: 999, description: '新的额度值' }),
      }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          msg: t.String(),
          count: t.Number(),
        }),
      },
    }
  )

  // 获取用户 AI 画像
  .get(
    '/:id/ai-profile',
    async ({ params, set }) => {
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
        tags: ['Users'],
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
        404: 'user.error',
      },
    }
  );

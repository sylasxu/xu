// Hot Keywords Controller - 热词相关接口 (v4.8 Digital Ascension)
import { Elysia } from 'elysia';
import { basePlugins, verifyAuth, verifyAdmin, AuthError } from '../../setup';
import { hotKeywordsModel, type ErrorResponse } from './hot-keywords.model';
import {
  getActiveHotKeywords,
  createKeyword,
  updateKeyword,
  deleteKeyword,
  listKeywords,
  getKeywordAnalytics,
} from './hot-keywords.service';

export const hotKeywordsController = new Elysia({ prefix: '/hot-keywords' })
  .use(basePlugins)
  .use(hotKeywordsModel)

  // ==========================================
  // 获取热词列表（小程序使用，公开接口）
  // ==========================================
  .get(
    '/',
    async ({ query, set }) => {
      try {
        const keywords = await getActiveHotKeywords(query);
        return { items: keywords, total: keywords.length };
      } catch (error: any) {
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取热词列表失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Hot Keywords'],
        summary: '获取热词列表',
        description: '获取活跃的热词列表，用于小程序 Hot Chips 显示',
      },
      query: 'hotKeywords.query',
      response: {
        200: 'hotKeywords.listResponse',
        500: 'hotKeywords.error',
      },
    }
  )

  // ==========================================
  // Admin 接口（通过 guard 保护）
  // ==========================================
  .guard(
    {
      async beforeHandle({ jwt, headers, set }) {
        try {
          await verifyAdmin(jwt, headers);
        } catch (error) {
          if (error instanceof AuthError) {
            set.status = error.status;
            return { code: error.status, msg: error.message };
          }
        }
      },
    },
    (app) =>
      app
        // ==========================================
        // Admin API：获取所有热词
        // ==========================================
        .get(
          '/all',
          async ({ query, set }) => {
            try {
              const keywords = await listKeywords(query);
              return { items: keywords, total: keywords.length };
            } catch (error: any) {
              set.status = 500;
              return {
                code: 500,
                msg: error.message || '获取热词列表失败',
              } satisfies ErrorResponse;
            }
          },
          {
            detail: {
              tags: ['Hot Keywords - Admin'],
              summary: 'Admin 获取所有热词',
              description: '获取所有热词列表，支持筛选（需要管理员权限）',
            },
            query: 'hotKeywords.adminQuery',
            response: {
              200: 'hotKeywords.adminListResponse',
              401: 'hotKeywords.error',
              403: 'hotKeywords.error',
              500: 'hotKeywords.error',
            },
          }
        )

        // ==========================================
        // Admin API：创建热词
        // ==========================================
        .post(
          '/',
          async ({ body, set, jwt, headers }) => {
            try {
              // guard 已验证 admin 权限，这里获取用户 ID
              const user = (await verifyAuth(jwt, headers))!;
              const keyword = await createKeyword(body, user.id);
              return { success: true as const, msg: '热词创建成功', id: keyword.id };
            } catch (error: any) {
              set.status = 400;
              return {
                code: 400,
                msg: error.message || '创建热词失败',
              } satisfies ErrorResponse;
            }
          },
          {
            detail: {
              tags: ['Hot Keywords - Admin'],
              summary: 'Admin 创建热词',
              description: '创建新的热词（需要管理员权限）',
            },
            body: 'hotKeywords.createRequest',
            response: {
              200: 'hotKeywords.createResponse',
              400: 'hotKeywords.error',
              401: 'hotKeywords.error',
              403: 'hotKeywords.error',
            },
          }
        )

        // ==========================================
        // Admin API：更新热词
        // ==========================================
        .patch(
          '/:id',
          async ({ params, body, set }) => {
            try {
              const keyword = await updateKeyword(params.id, body);
              return { data: keyword };
            } catch (error: any) {
              set.status = 400;
              return {
                code: 400,
                msg: error.message || '更新热词失败',
              } satisfies ErrorResponse;
            }
          },
          {
            detail: {
              tags: ['Hot Keywords - Admin'],
              summary: 'Admin 更新热词',
              description: '更新热词信息（需要管理员权限）',
            },
            params: 'hotKeywords.idParams',
            body: 'hotKeywords.updateRequest',
            response: {
              200: 'hotKeywords.updateResponse',
              400: 'hotKeywords.error',
              401: 'hotKeywords.error',
              403: 'hotKeywords.error',
            },
          }
        )

        // ==========================================
        // Admin API：删除热词
        // ==========================================
        .delete(
          '/:id',
          async ({ params, set }) => {
            try {
              await deleteKeyword(params.id);
              return { success: true as const, msg: '热词已删除' };
            } catch (error: any) {
              set.status = 400;
              return {
                code: 400,
                msg: error.message || '删除热词失败',
              } satisfies ErrorResponse;
            }
          },
          {
            detail: {
              tags: ['Hot Keywords - Admin'],
              summary: 'Admin 删除热词',
              description: '删除热词（软删除，需要管理员权限）',
            },
            params: 'hotKeywords.idParams',
            response: {
              200: 'hotKeywords.deleteResponse',
              400: 'hotKeywords.error',
              401: 'hotKeywords.error',
              403: 'hotKeywords.error',
            },
          }
        )

        // ==========================================
        // Admin API：获取热词分析
        // ==========================================
        .get(
          '/analytics',
          async ({ query, set }) => {
            try {
              const analytics = await getKeywordAnalytics(query.period);
              return { items: analytics, total: analytics.length };
            } catch (error: any) {
              set.status = 500;
              return {
                code: 500,
                msg: error.message || '获取分析数据失败',
              } satisfies ErrorResponse;
            }
          },
          {
            detail: {
              tags: ['Hot Keywords - Admin'],
              summary: 'Admin 获取热词分析',
              description: '获取热词分析数据（需要管理员权限）',
            },
            query: 'hotKeywords.analyticsQuery',
            response: {
              200: 'hotKeywords.analyticsResponse',
              401: 'hotKeywords.error',
              403: 'hotKeywords.error',
              500: 'hotKeywords.error',
            },
          }
        )
  );

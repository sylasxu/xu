// Analytics Controller - 数据分析领域路由
// 从 Growth 模块迁移趋势分析能力

import { Elysia } from 'elysia';
import { basePlugins, verifyAuth, verifyAdmin, AuthError } from '../../setup';
import { analyticsModel, type ErrorResponse } from './analytics.model';
import { 
  getTrendInsights, 
  getContentPerformance,
  getBusinessMetrics,
  getPlatformOverview,
} from './analytics.service';

export const analyticsController = new Elysia({ prefix: '/analytics' })
  .use(basePlugins)
  .use(analyticsModel)

  // ==========================================
  // 趋势分析 (从 Growth/trends 迁移)
  // ==========================================
  .get(
    '/trends',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      try {
        const result = await getTrendInsights(query);
        return result;
      } catch (error: any) {
        console.error('获取趋势分析失败:', error);
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取趋势分析失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Analytics'],
        summary: '获取趋势洞察',
        description: '分析用户高频词和意图分布趋势。从 Growth 模块迁移。',
      },
      query: 'analytics.trendsQuery',
      response: {
        200: 'analytics.trendsResponse',
        401: 'analytics.error',
        500: 'analytics.error',
      },
    }
  )

  // ==========================================
  // 内容效果分析 (从 Content/analytics 迁移)
  // ==========================================
  .get(
    '/content-performance',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      try {
        const result = await getContentPerformance(query);
        return result;
      } catch (error: any) {
        console.error('获取内容效果分析失败:', error);
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取内容效果分析失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Analytics'],
        summary: '获取内容效果分析',
        description: '分析生成内容的互动数据表现。从 Content 模块迁移。',
      },
      query: 'analytics.contentPerformanceQuery',
      response: {
        200: 'analytics.contentPerformanceResponse',
        401: 'analytics.error',
        500: 'analytics.error',
      },
    }
  )

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
        .get(
          '/metrics',
          async ({ set }) => {
            try {
              return await getBusinessMetrics();
            } catch (error: any) {
              console.error('获取业务指标失败:', error);
              set.status = 500;
              return {
                code: 500,
                msg: error.message || '获取业务指标失败',
              } satisfies ErrorResponse;
            }
          },
          {
            detail: {
              tags: ['Analytics'],
              summary: '获取业务指标',
              description: '获取平台业务指标，包括 J2C、成局率、留存率等运营数据（需要管理员权限）。',
            },
            response: {
              200: 'analytics.metricsResponse',
              401: 'analytics.error',
              403: 'analytics.error',
              500: 'analytics.error',
            },
          }
        )

        .get(
          '/platform-overview',
          async ({ set }) => {
            try {
              return await getPlatformOverview();
            } catch (error: any) {
              console.error('获取平台概览失败:', error);
              set.status = 500;
              return {
                code: 500,
                msg: error.message || '获取平台概览失败',
              } satisfies ErrorResponse;
            }
          },
          {
            detail: {
              tags: ['Analytics'],
              summary: '获取平台概览',
              description: '获取实时概览、北极星指标、AI 健康度和异常警报（需要管理员权限）。',
            },
            response: {
              200: 'analytics.platformOverviewResponse',
              401: 'analytics.error',
              403: 'analytics.error',
              500: 'analytics.error',
            },
          }
        )
  );

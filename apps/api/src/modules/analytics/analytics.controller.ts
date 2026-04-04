// Analytics Controller - 数据分析领域路由

import { Elysia } from 'elysia';
import { basePlugins, requireAuth, requireAdmin, type ErrorResponse } from '../../setup';
import { analyticsModel } from './analytics.model';
import {
  getTrendInsights,
  getBusinessMetrics,
  getPlatformOverview,
} from './analytics.service';

export const analyticsController = new Elysia({ prefix: '/analytics' })
  .use(basePlugins)
  .use(analyticsModel)

  // ==========================================
  // 公开/登录即可访问的接口
  // ==========================================
  // 趋势分析
  .guard(
    { beforeHandle: requireAuth },
    (app) =>
      app.get(
        '/trends',
        async ({ query, set }) => {
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
            description: '分析用户高频词和意图分布趋势。',
          },
          query: 'analytics.trendsQuery',
          response: {
            200: 'analytics.trendsResponse',
            401: 'common.error',
            500: 'common.error',
          },
        }
      )
  )

  // ==========================================
  // 管理员专属接口
  // ==========================================
  .guard(
    { beforeHandle: requireAdmin },
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
              401: 'common.error',
              403: 'common.error',
              500: 'common.error',
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
              401: 'common.error',
              403: 'common.error',
              500: 'common.error',
            },
          }
        )
  );

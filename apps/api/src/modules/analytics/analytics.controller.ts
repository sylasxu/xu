// Analytics Controller - 数据分析领域路由
// 从 Growth 模块迁移趋势分析能力

import { Elysia } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { analyticsModel, type ErrorResponse } from './analytics.model';
import { 
  getTrendInsights, 
  getContentPerformance,
  getMetrics,
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

  // ==========================================
  // 综合业务指标
  // ==========================================
  .get(
    '/metrics',
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
        const result = await getMetrics(query);
        return result;
      } catch (error: any) {
        console.error('获取指标失败:', error);
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取指标失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Analytics'],
        summary: '获取综合业务指标',
        description: '获取平台核心运营指标。',
      },
      query: 'analytics.metricsQuery',
      response: {
        200: 'analytics.metricsResponse',
        401: 'analytics.error',
        500: 'analytics.error',
      },
    }
  );

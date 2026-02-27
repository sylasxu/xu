// Growth Controller - BFF 聚合层
// 瘦身版本：保留旧路径兼容，但内部调用各领域服务

import { Elysia, t } from 'elysia'
import { basePlugins, verifyAuth } from '../../setup'
import { growthModel, type ErrorResponse } from './growth.model'
import { contentController } from './content.controller'

// 导入新的领域服务
import { generateContent } from '../ai/ai.service'
import { getTrendInsights } from '../analytics/analytics.service'

export const growthController = new Elysia({ prefix: '/growth' })
  .use(basePlugins)
  .use(growthModel)

  // ==========================================
  // 海报工厂 - 生成文案 (已迁移到 AI 领域)
  // 保留旧路径作为兼容层
  // ==========================================
  .post(
    '/poster/generate',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers)
      if (!user) {
        set.status = 401
        return { code: 401, msg: '未授权' } satisfies ErrorResponse
      }

      try {
        // 调用 AI 领域的内容生成能力
        const result = await generateContent({
          topic: body.text,
          contentType: 'poster',
          style: body.style,
          count: 1,
        });

        const item = result.items[0];
        return {
          headline: item.title,
          subheadline: item.hashtags.slice(0, 3).join(' '),
          body: item.body.slice(0, 100),
          cta: '点击参与',
          hashtags: item.hashtags,
        };
      } catch (error: any) {
        set.status = 500
        return { code: 500, msg: error.message || '生成失败' } satisfies ErrorResponse
      }
    },
    {
      detail: {
        tags: ['Growth'],
        summary: '生成文案 (已迁移)',
        description: '【已迁移到 /ai/generate/content】根据活动描述生成小红书风格的文案',
      },
      body: 'growth.generatePosterRequest',
      response: {
        200: 'growth.posterResult',
        401: 'growth.error',
        500: 'growth.error',
      },
    }
  )

  // ==========================================
  // 热门洞察 - 获取趋势数据 (已迁移到 Analytics 领域)
  // 保留旧路径作为兼容层
  // ==========================================
  .get(
    '/trends',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers)
      if (!user) {
        set.status = 401
        return { code: 401, msg: '未授权' } satisfies ErrorResponse
      }

      try {
        const period = (query.period || '7d') as '7d' | '30d'
        // 调用 Analytics 领域的趋势分析能力
        const result = await getTrendInsights({ period, source: 'conversations' })
        return result
      } catch (error: any) {
        set.status = 500
        return { code: 500, msg: error.message || '获取失败' } satisfies ErrorResponse
      }
    },
    {
      detail: {
        tags: ['Growth'],
        summary: '获取热门洞察 (已迁移)',
        description: '【已迁移到 /analytics/trends】统计用户高频词和意图分布',
      },
      query: t.Object({
        period: t.Optional(t.Union([
          t.Literal('7d'),
          t.Literal('30d'),
        ], { description: '时间范围', default: '7d' })),
      }),
      response: {
        200: 'growth.trendInsight',
        401: 'growth.error',
        500: 'growth.error',
      },
    }
  )

  // ==========================================
  // 挂载内容运营子路由 → /growth/content/*
  // 【注意】：新代码请直接使用 /content/* 路径
  // ==========================================
  .use(contentController)

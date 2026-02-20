/**
 * Growth Controller
 * 
 * 增长工具：海报工厂、热门洞察
 */

import { Elysia, t } from 'elysia'
import { generatePoster, getTrendInsights } from './growth.service'
import { basePlugins, verifyAuth } from '../../setup'
import { growthModel, type ErrorResponse } from './growth.model'
import { contentController } from './content.controller'

export const growthController = new Elysia({ prefix: '/growth' })
  .use(basePlugins)
  .use(growthModel)

  // 海报工厂 - 生成文案
  .post(
    '/poster/generate',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers)
      if (!user) {
        set.status = 401
        return { code: 401, msg: '未授权' } satisfies ErrorResponse
      }

      try {
        const result = await generatePoster(body.text, body.style)
        return result
      } catch (error: any) {
        set.status = 500
        return { code: 500, msg: error.message || '生成失败' } satisfies ErrorResponse
      }
    },
    {
      detail: {
        tags: ['Growth'],
        summary: '生成文案',
        description: '根据活动描述生成小红书风格的文案',
      },
      body: 'growth.generatePosterRequest',
      response: {
        200: 'growth.posterResult',
        401: 'growth.error',
        500: 'growth.error',
      },
    }
  )

  // 热门洞察 - 获取趋势数据
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
        const result = await getTrendInsights(period)
        return result
      } catch (error: any) {
        set.status = 500
        return { code: 500, msg: error.message || '获取失败' } satisfies ErrorResponse
      }
    },
    {
      detail: {
        tags: ['Growth'],
        summary: '获取热门洞察',
        description: '统计用户高频词和意图分布',
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

  // 挂载内容运营子路由 → /growth/content/*
  .use(contentController)

/**
 * Content Controller - 自媒体内容运营路由
 *
 * 6 个端点，挂载到 /growth/content/* 前缀下
 */

import { Elysia, t } from 'elysia'
import { basePlugins, verifyAuth } from '../../setup'
import {
  contentModel,
  ContentNoteResponse,
  type ContentErrorResponse,
} from './content.model'
import {
  generateNotes,
  getLibrary,
  getNoteById,
  deleteNote,
  updatePerformance,
  getAnalytics,
} from './content.service'

export const contentController = new Elysia({ prefix: '/content' })
  .use(basePlugins)
  .use(contentModel)

  // POST /growth/content/generate — 生成小红书笔记
  .post(
    '/generate',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers)
      if (!user) {
        set.status = 401
        return { code: 401, msg: '未授权' } satisfies ContentErrorResponse
      }
      try {
        const notes = await generateNotes({
          topic: body.topic,
          contentType: body.contentType,
          count: body.count ?? 1,
          trendKeywords: body.trendKeywords,
        })
        return notes
      } catch (error: any) {
        set.status = 500
        return { code: 500, msg: error.message || '生成失败' } satisfies ContentErrorResponse
      }
    },
    {
      detail: { tags: ['Content'], summary: '生成小红书笔记' },
      body: 'content.generateRequest',
      response: {
        200: t.Array(ContentNoteResponse),
        401: 'content.error',
        500: 'content.error',
      },
    },
  )

  // GET /growth/content/library — 内容库列表
  .get(
    '/library',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers)
      if (!user) {
        set.status = 401
        return { code: 401, msg: '未授权' } satisfies ContentErrorResponse
      }
      try {
        const result = await getLibrary({
          page: query.page ?? 1,
          limit: query.limit ?? 20,
          contentType: query.contentType,
          keyword: query.keyword,
        })
        return result
      } catch (error: any) {
        set.status = 500
        return { code: 500, msg: error.message || '查询失败' } satisfies ContentErrorResponse
      }
    },
    {
      detail: { tags: ['Content'], summary: '内容库列表' },
      query: 'content.libraryQuery',
      response: {
        200: 'content.libraryResponse',
        401: 'content.error',
        500: 'content.error',
      },
    },
  )

  // GET /growth/content/library/:id — 笔记详情
  .get(
    '/library/:id',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers)
      if (!user) {
        set.status = 401
        return { code: 401, msg: '未授权' } satisfies ContentErrorResponse
      }
      try {
        const note = await getNoteById(params.id)
        if (!note) {
          set.status = 404
          return { code: 404, msg: '笔记不存在' } satisfies ContentErrorResponse
        }
        return note
      } catch (error: any) {
        set.status = 500
        return { code: 500, msg: error.message || '查询失败' } satisfies ContentErrorResponse
      }
    },
    {
      detail: { tags: ['Content'], summary: '笔记详情' },
      params: t.Object({ id: t.String() }),
      response: {
        200: 'content.noteResponse',
        401: 'content.error',
        404: 'content.error',
        500: 'content.error',
      },
    },
  )

  // DELETE /growth/content/library/:id — 删除笔记
  .delete(
    '/library/:id',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers)
      if (!user) {
        set.status = 401
        return { code: 401, msg: '未授权' } satisfies ContentErrorResponse
      }
      try {
        const deleted = await deleteNote(params.id)
        if (!deleted) {
          set.status = 404
          return { code: 404, msg: '笔记不存在' } satisfies ContentErrorResponse
        }
        return { success: true }
      } catch (error: any) {
        set.status = 500
        return { code: 500, msg: error.message || '删除失败' } satisfies ContentErrorResponse
      }
    },
    {
      detail: { tags: ['Content'], summary: '删除笔记' },
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: 'content.error',
        404: 'content.error',
        500: 'content.error',
      },
    },
  )

  // PUT /growth/content/library/:id/performance — 回填效果数据
  .put(
    '/library/:id/performance',
    async ({ params, body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers)
      if (!user) {
        set.status = 401
        return { code: 401, msg: '未授权' } satisfies ContentErrorResponse
      }
      try {
        const updated = await updatePerformance(params.id, body)
        return updated
      } catch (error: any) {
        if (error.message === '笔记不存在') {
          set.status = 404
          return { code: 404, msg: '笔记不存在' } satisfies ContentErrorResponse
        }
        set.status = 500
        return { code: 500, msg: error.message || '更新失败' } satisfies ContentErrorResponse
      }
    },
    {
      detail: { tags: ['Content'], summary: '回填效果数据' },
      params: t.Object({ id: t.String() }),
      body: 'content.performanceUpdate',
      response: {
        200: 'content.noteResponse',
        401: 'content.error',
        404: 'content.error',
        500: 'content.error',
      },
    },
  )

  // GET /growth/content/analytics — 效果分析统计
  .get(
    '/analytics',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers)
      if (!user) {
        set.status = 401
        return { code: 401, msg: '未授权' } satisfies ContentErrorResponse
      }
      try {
        const analytics = await getAnalytics()
        return analytics
      } catch (error: any) {
        set.status = 500
        return { code: 500, msg: error.message || '分析失败' } satisfies ContentErrorResponse
      }
    },
    {
      detail: { tags: ['Content'], summary: '效果分析统计' },
      response: {
        200: 'content.analyticsResponse',
        401: 'content.error',
        500: 'content.error',
      },
    },
  )

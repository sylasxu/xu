// Content Controller - 内容运营领域路由
// 从 Growth/content 迁移内容库管理、AI 生成、效果追踪

import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { contentModel, type ErrorResponse, ContentNoteResponseSchema } from './content.model';
import {
  generateNotes,
  getLibrary,
  getNoteById,
  deleteNote,
  updatePerformance,
  getAnalytics,
} from './content.service';

export const contentController = new Elysia({ prefix: '/content' })
  .use(basePlugins)
  .use(contentModel)

  // ==========================================
  // AI 生成内容
  // ==========================================
  .post(
    '/generate',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }
      try {
        const notes = await generateNotes({
          topic: body.topic,
          contentType: body.contentType,
          count: body.count ?? 1,
          trendKeywords: body.trendKeywords,
        });
        return notes;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '生成失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Content'],
        summary: '生成小红书笔记',
        description: 'AI 生成小红书风格的内容笔记。从 Growth 模块迁移。',
      },
      body: 'content.generateRequest',
      response: {
        200: t.Array(ContentNoteResponseSchema),
        401: 'content.error',
        500: 'content.error',
      },
    }
  )

  // ==========================================
  // 内容库管理
  // ==========================================
  .get(
    '/library',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }
      try {
        const result = await getLibrary({
          page: query.page ?? 1,
          limit: query.limit ?? 20,
          contentType: query.contentType,
          keyword: query.keyword,
        });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '查询失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Content'],
        summary: '内容库列表',
        description: '获取生成的内容笔记列表。',
      },
      query: 'content.libraryQuery',
      response: {
        200: 'content.libraryResponse',
        401: 'content.error',
        500: 'content.error',
      },
    }
  )

  .get(
    '/library/:id',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }
      try {
        const note = await getNoteById(params.id);
        if (!note) {
          set.status = 404;
          return { code: 404, msg: '笔记不存在' } satisfies ErrorResponse;
        }
        return note;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '查询失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Content'],
        summary: '笔记详情',
        description: '根据 ID 获取内容笔记详情。',
      },
      params: t.Object({ id: t.String() }),
      response: {
        200: 'content.noteResponse',
        401: 'content.error',
        404: 'content.error',
        500: 'content.error',
      },
    }
  )

  .delete(
    '/library/:id',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }
      try {
        const deleted = await deleteNote(params.id);
        if (!deleted) {
          set.status = 404;
          return { code: 404, msg: '笔记不存在' } satisfies ErrorResponse;
        }
        return { success: true, msg: '删除成功' };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '删除失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Content'],
        summary: '删除笔记',
        description: '删除指定的内容笔记。',
      },
      params: t.Object({ id: t.String() }),
      response: {
        200: 'content.success',
        401: 'content.error',
        404: 'content.error',
        500: 'content.error',
      },
    }
  )

  // ==========================================
  // 效果数据管理
  // ==========================================
  .put(
    '/library/:id/performance',
    async ({ params, body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }
      try {
        const updated = await updatePerformance(params.id, body);
        return updated;
      } catch (error: any) {
        if (error.message === '笔记不存在') {
          set.status = 404;
          return { code: 404, msg: '笔记不存在' } satisfies ErrorResponse;
        }
        set.status = 500;
        return { code: 500, msg: error.message || '更新失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Content'],
        summary: '回填效果数据',
        description: '更新内容笔记的互动数据（浏览量、点赞数等）。',
      },
      params: t.Object({ id: t.String() }),
      body: 'content.performanceUpdate',
      response: {
        200: 'content.noteResponse',
        401: 'content.error',
        404: 'content.error',
        500: 'content.error',
      },
    }
  )

  .get(
    '/analytics',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }
      try {
        const analytics = await getAnalytics();
        return analytics;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '分析失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Content'],
        summary: '效果分析统计',
        description: '分析生成内容的互动数据表现。',
      },
      response: {
        200: 'content.analyticsResponse',
        401: 'content.error',
        500: 'content.error',
      },
    }
  );

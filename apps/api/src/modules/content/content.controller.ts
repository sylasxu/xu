// Content Controller - 内容运营领域路由

import { Elysia, t } from 'elysia';
import { basePlugins, requireAuth, type ErrorResponse } from '../../setup';
import { contentModel, ContentNoteResponseSchema } from './content.model';
import {
  generateNotes,
  generateTopicSuggestions,
  getLibrary,
  getNoteById,
  deleteNote,
  updatePerformance,
  getAnalytics,
  normalizeContentAiErrorMessage,
} from './content.service';

export const contentController = new Elysia({ prefix: '/content' })
  .use(basePlugins)
  .use(contentModel)

  // ==========================================
  // 需要登录的所有接口
  // ==========================================
  .guard(
    { beforeHandle: requireAuth },
    (app) =>
      app
        // ==========================================
        // AI 生成内容
        // ==========================================
        .post(
          '/generate',
          async ({ body, set }) => {
            try {
              const notes = await generateNotes({
                topic: body.topic,
                platform: body.platform ?? 'xiaohongshu',
                contentType: body.contentType,
                count: body.count ?? 1,
                trendKeywords: body.trendKeywords,
              });
              return notes;
            } catch (error: any) {
              set.status = 500;
              return {
                code: 500,
                msg: normalizeContentAiErrorMessage(error instanceof Error ? error.message : '生成失败'),
              } satisfies ErrorResponse;
            }
          },
          {
            detail: {
              tags: ['Content'],
              summary: '生成多平台内容',
              description: 'AI 按平台（小红书 / 抖音 / 微信）和内容类型生成内容稿。',
            },
            body: 'content.generateRequest',
            response: {
              200: t.Array(ContentNoteResponseSchema),
              401: 'common.error',
              500: 'common.error',
            },
          }
        )

        .post(
          '/topic-suggestions',
          async ({ body, set }) => {
            try {
              return await generateTopicSuggestions({
                platform: body.platform,
                contentType: body.contentType,
                seed: body.seed,
              });
            } catch (error: any) {
              set.status = 500;
              return {
                code: 500,
                msg: normalizeContentAiErrorMessage(error instanceof Error ? error.message : '主题建议生成失败'),
              } satisfies ErrorResponse;
            }
          },
          {
            detail: {
              tags: ['Content'],
              summary: '生成主题建议',
              description: 'AI 按平台和内容类型生成可直接填入的主题建议。',
            },
            body: 'content.topicSuggestionRequest',
            response: {
              200: 'content.topicSuggestionResponse',
              401: 'common.error',
              500: 'common.error',
            },
          }
        )

        // ==========================================
        // 内容库管理
        // ==========================================
        .get(
          '/library',
          async ({ query, set }) => {
            try {
              const result = await getLibrary({
                page: query.page ?? 1,
                limit: query.limit ?? 20,
                platform: query.platform,
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
              401: 'common.error',
              500: 'common.error',
            },
          }
        )

        .get(
          '/library/:id',
          async ({ params, set }) => {
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
              401: 'common.error',
              404: 'common.error',
              500: 'common.error',
            },
          }
        )

        .delete(
          '/library/:id',
          async ({ params, set }) => {
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
              401: 'common.error',
              404: 'common.error',
              500: 'common.error',
            },
          }
        )

        // ==========================================
        // 效果数据管理
        // ==========================================
        .put(
          '/library/:id/performance',
          async ({ params, body, set }) => {
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
              401: 'common.error',
              404: 'common.error',
              500: 'common.error',
            },
          }
        )

        .get(
          '/analytics',
          async ({ query, set }) => {
            try {
              const analytics = await getAnalytics(query);
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
              description: '分析生成内容的互动数据表现，支持按内容类型和时间范围筛选。',
            },
            query: 'content.analyticsQuery',
            response: {
              200: 'content.analyticsResponse',
              401: 'common.error',
              500: 'common.error',
            },
          }
        )
  );

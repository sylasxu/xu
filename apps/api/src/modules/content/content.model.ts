// Content Model - 内容运营领域 Schema
// 从 Growth/content 迁移内容库管理能力

import { Elysia, t, type Static } from 'elysia';

/**
 * Content Model Plugin
 * 自媒体内容库管理：小红书笔记生成、存储、效果追踪
 */

// ==========================================
// 内容库 Schema (从 Growth/content 迁移)
// ==========================================

// 内容笔记响应
const ContentNoteResponse = t.Object({
  id: t.String(),
  topic: t.String(),
  contentType: t.String(),
  title: t.String(),
  body: t.String(),
  hashtags: t.Array(t.String()),
  coverImageHint: t.Union([t.String(), t.Null()]),
  views: t.Union([t.Number(), t.Null()]),
  likes: t.Union([t.Number(), t.Null()]),
  collects: t.Union([t.Number(), t.Null()]),
  comments: t.Union([t.Number(), t.Null()]),
  newFollowers: t.Union([t.Number(), t.Null()]),
  batchId: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

// 生成内容请求
const GenerateContentRequest = t.Object({
  topic: t.String({ minLength: 1, maxLength: 200, description: '内容主题' }),
  contentType: t.Union([
    t.Literal('xiaohongshu'),
    t.Literal('weibo'),
    t.Literal('zhihu'),
  ], { description: '内容平台类型', default: 'xiaohongshu' }),
  count: t.Optional(t.Number({ minimum: 1, maximum: 5, default: 1, description: '生成数量' })),
  trendKeywords: t.Optional(t.Array(t.String(), { description: '趋势关键词' })),
});

// 内容库列表查询
const ContentLibraryQuery = t.Object({
  page: t.Optional(t.Number({ minimum: 1, default: 1, description: '页码' })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 50, default: 20, description: '每页数量' })),
  contentType: t.Optional(t.String({ description: '内容类型筛选' })),
  keyword: t.Optional(t.String({ description: '关键词搜索（topic/body）' })),
});

// 内容库列表响应
const ContentLibraryResponse = t.Object({
  items: t.Array(ContentNoteResponse),
  total: t.Number(),
  page: t.Number(),
  limit: t.Number(),
}, { description: '内容库列表响应' });

// 回填效果数据请求
const PerformanceUpdateRequest = t.Object({
  views: t.Optional(t.Number({ minimum: 0, description: '浏览量' })),
  likes: t.Optional(t.Number({ minimum: 0, description: '点赞数' })),
  collects: t.Optional(t.Number({ minimum: 0, description: '收藏数' })),
  comments: t.Optional(t.Number({ minimum: 0, description: '评论数' })),
  newFollowers: t.Optional(t.Number({ minimum: 0, description: '新增粉丝' })),
});

// 内容效果分析响应
const ContentAnalyticsResponse = t.Object({
  byType: t.Array(t.Object({
    contentType: t.String(),
    avgViews: t.Number(),
    avgLikes: t.Number(),
    avgCollects: t.Number(),
    count: t.Number(),
  })),
  topNotes: t.Array(ContentNoteResponse),
  totalNotes: t.Number(),
  totalWithPerformance: t.Number(),
});

// ==========================================
// 通用响应 Schema
// ==========================================

const ErrorResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
});

const SuccessResponseSchema = t.Object({
  success: t.Boolean(),
  msg: t.String(),
});

// ==========================================
// 注册到 Elysia
// ==========================================

export const contentModel = new Elysia({ name: 'contentModel' })
  .model({
    // 内容库
    'content.noteResponse': ContentNoteResponse,
    'content.generateRequest': GenerateContentRequest,
    'content.libraryQuery': ContentLibraryQuery,
    'content.libraryResponse': ContentLibraryResponse,
    'content.performanceUpdate': PerformanceUpdateRequest,
    'content.analyticsResponse': ContentAnalyticsResponse,
    // 通用
    'content.error': ErrorResponseSchema,
    'content.success': SuccessResponseSchema,
  });

// ==========================================
// 导出 TS 类型
// ==========================================

export type ContentNoteResponse = Static<typeof ContentNoteResponse>;
export type GenerateContentRequest = Static<typeof GenerateContentRequest>;
export type ContentLibraryQuery = Static<typeof ContentLibraryQuery>;
export type ContentLibraryResponse = Static<typeof ContentLibraryResponse>;
export type PerformanceUpdateRequest = Static<typeof PerformanceUpdateRequest>;
export type ContentAnalyticsResponse = Static<typeof ContentAnalyticsResponse>;
export type ErrorResponse = Static<typeof ErrorResponseSchema>;
export type SuccessResponse = Static<typeof SuccessResponseSchema>;

// 导出 Schema 供 controller 使用
export { ContentNoteResponse as ContentNoteResponseSchema };

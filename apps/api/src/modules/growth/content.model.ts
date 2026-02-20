/**
 * Content Model - TypeBox schemas for 自媒体内容运营
 * Response schemas derived from @juchang/db selectContentNoteSchema
 */

import { selectContentNoteSchema } from '@juchang/db'
import { Elysia, t, type Static } from 'elysia'

// ==========================================
// 请求 Schema（手动定义，非 DB 字段）
// ==========================================

export const GenerateRequest = t.Object({
  topic: t.String({ minLength: 1, maxLength: 200 }),
  contentType: t.Union([
    t.Literal('activity_recruit'),
    t.Literal('buddy_story'),
    t.Literal('local_guide'),
    t.Literal('product_seed'),
  ]),
  count: t.Integer({ minimum: 1, maximum: 5, default: 1 }),
  trendKeywords: t.Optional(t.Array(t.String())),
})

// 效果数据回填 Schema（手动定义，部分字段更新）
export const PerformanceUpdateRequest = t.Object({
  views: t.Optional(t.Integer({ minimum: 0 })),
  likes: t.Optional(t.Integer({ minimum: 0 })),
  collects: t.Optional(t.Integer({ minimum: 0 })),
  comments: t.Optional(t.Integer({ minimum: 0 })),
  newFollowers: t.Optional(t.Integer({ minimum: 0 })),
})

// 分页 + 筛选参数（手动定义）
export const LibraryQuery = t.Object({
  page: t.Optional(t.Integer({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
  contentType: t.Optional(t.Union([
    t.Literal('activity_recruit'),
    t.Literal('buddy_story'),
    t.Literal('local_guide'),
    t.Literal('product_seed'),
  ])),
  keyword: t.Optional(t.String()),
})

// ==========================================
// 响应 Schema（从 DB 派生）
// ==========================================

export const ContentNoteResponse = selectContentNoteSchema

export const LibraryResponse = t.Object({
  data: t.Array(selectContentNoteSchema),
  total: t.Integer(),
})

// ==========================================
// 分析响应（Admin 特有类型，手动定义）
// ==========================================

export const AnalyticsResponse = t.Object({
  byType: t.Array(t.Object({
    contentType: t.String(),
    avgViews: t.Number(),
    avgLikes: t.Number(),
    avgCollects: t.Number(),
    count: t.Integer(),
  })),
  topNotes: t.Array(selectContentNoteSchema),
  totalNotes: t.Integer(),
  totalWithPerformance: t.Integer(),
})

// ==========================================
// 错误响应
// ==========================================

export const ContentErrorResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
})

export type ContentErrorResponse = Static<typeof ContentErrorResponse>

// ==========================================
// Model Plugin
// ==========================================

export const contentModel = new Elysia({ name: 'content.model' })
  .model({
    'content.generateRequest': GenerateRequest,
    'content.performanceUpdate': PerformanceUpdateRequest,
    'content.libraryQuery': LibraryQuery,
    'content.noteResponse': ContentNoteResponse,
    'content.libraryResponse': LibraryResponse,
    'content.analyticsResponse': AnalyticsResponse,
    'content.error': ContentErrorResponse,
  })

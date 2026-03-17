// Content Model - 内容运营领域 Schema

import {
  insertContentNoteSchema,
  selectContentNoteSchema,
} from '@juchang/db'
import { Elysia, t, type Static } from 'elysia'
import { ContentTypeSchema } from './content-type'

const ContentNoteResponseSchema = t.Composite([
  t.Pick(selectContentNoteSchema, [
    'id',
    'topic',
    'contentType',
    'title',
    'body',
    'hashtags',
    'coverImageHint',
    'views',
    'likes',
    'collects',
    'comments',
    'newFollowers',
    'batchId',
  ]),
  t.Object({
    createdAt: t.String(),
    updatedAt: t.String(),
  }),
])

const GenerateContentRequestSchema = t.Composite([
  t.Pick(insertContentNoteSchema, ['topic', 'contentType']),
  t.Object({
    count: t.Optional(t.Integer({ minimum: 1, maximum: 5, default: 1, description: '生成数量' })),
    trendKeywords: t.Optional(t.Array(t.String(), { description: '趋势关键词' })),
  }),
])

const ContentLibraryQuerySchema = t.Object({
  page: t.Optional(t.Integer({ minimum: 1, default: 1, description: '页码' })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 50, default: 20, description: '每页数量' })),
  contentType: t.Optional(ContentTypeSchema),
  keyword: t.Optional(t.String({ description: '关键词搜索（topic/body）' })),
})

const ContentLibraryResponseSchema = t.Object({
  items: t.Array(ContentNoteResponseSchema),
  total: t.Integer(),
  page: t.Integer(),
  limit: t.Integer(),
})

const PerformanceUpdateRequestSchema = t.Object({
  views: t.Optional(t.Integer({ minimum: 0, description: '浏览量' })),
  likes: t.Optional(t.Integer({ minimum: 0, description: '点赞数' })),
  collects: t.Optional(t.Integer({ minimum: 0, description: '收藏数' })),
  comments: t.Optional(t.Integer({ minimum: 0, description: '评论数' })),
  newFollowers: t.Optional(t.Integer({ minimum: 0, description: '新增粉丝' })),
})

const ContentAnalyticsResponseSchema = t.Object({
  byType: t.Array(t.Object({
    contentType: ContentTypeSchema,
    avgViews: t.Number(),
    avgLikes: t.Number(),
    avgCollects: t.Number(),
    count: t.Integer(),
  })),
  topNotes: t.Array(ContentNoteResponseSchema),
  totalNotes: t.Integer(),
  totalWithPerformance: t.Integer(),
})

const ErrorResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
})

const SuccessResponseSchema = t.Object({
  success: t.Boolean(),
  msg: t.String(),
})

export const contentModel = new Elysia({ name: 'contentModel' }).model({
  'content.noteResponse': ContentNoteResponseSchema,
  'content.generateRequest': GenerateContentRequestSchema,
  'content.libraryQuery': ContentLibraryQuerySchema,
  'content.libraryResponse': ContentLibraryResponseSchema,
  'content.performanceUpdate': PerformanceUpdateRequestSchema,
  'content.analyticsResponse': ContentAnalyticsResponseSchema,
  'content.error': ErrorResponseSchema,
  'content.success': SuccessResponseSchema,
})

export type ContentNoteResponse = Static<typeof ContentNoteResponseSchema>
export type GenerateContentRequest = Static<typeof GenerateContentRequestSchema>
export type ContentLibraryQuery = Static<typeof ContentLibraryQuerySchema>
export type ContentLibraryResponse = Static<typeof ContentLibraryResponseSchema>
export type PerformanceUpdateRequest = Static<typeof PerformanceUpdateRequestSchema>
export type ContentAnalyticsResponse = Static<typeof ContentAnalyticsResponseSchema>
export type ErrorResponse = Static<typeof ErrorResponseSchema>
export type SuccessResponse = Static<typeof SuccessResponseSchema>

export { ContentNoteResponseSchema }

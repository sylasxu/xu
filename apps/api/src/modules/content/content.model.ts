// Content Model - 内容运营领域 Schema

import { ErrorResponseSchema, type ErrorResponse } from "../../common/common.model";
import {
  insertContentNoteSchema,
  selectContentNoteSchema,
} from '@xu/db'
import { Elysia, t, type Static } from 'elysia'
import { ContentTypeSchema } from './content-type'
import { ContentPlatformSchema } from './content-platform'

const PublishCheckStatusSchema = t.Union([
  t.Literal('ready'),
  t.Literal('review'),
  t.Literal('rewrite'),
])

const PublishCheckSchema = t.Object({
  status: PublishCheckStatusSchema,
  summary: t.String(),
  issues: t.Array(t.String(), { maxItems: 3 }),
})

const TrafficScriptSchema = t.Object({
  commentPrompt: t.String(),
  dmReply: t.String(),
  wechatHandoff: t.String(),
})

const ContentNoteResponseSchema = t.Composite([
  t.Pick(selectContentNoteSchema, [
    'id',
    'topic',
    'platform',
    'contentType',
    'title',
    'body',
    'hashtags',
    'coverText',
    'coverImageHint',
    'views',
    'likes',
    'collects',
    'comments',
    'newFollowers',
    'batchId',
  ]),
  t.Object({
    publishCheck: PublishCheckSchema,
    trafficScript: TrafficScriptSchema,
    createdAt: t.String(),
    updatedAt: t.String(),
  }),
])

const GenerateContentRequestSchema = t.Composite([
  t.Pick(insertContentNoteSchema, ['topic', 'platform', 'contentType']),
  t.Object({
    count: t.Optional(t.Integer({ minimum: 1, maximum: 3, default: 1, description: '生成数量' })),
    trendKeywords: t.Optional(t.Array(t.String(), { description: '趋势关键词' })),
  }),
])

const TopicSuggestionRequestSchema = t.Object({
  platform: ContentPlatformSchema,
  contentType: ContentTypeSchema,
  seed: t.Optional(t.String({ minLength: 1, maxLength: 120, description: '可选的补充方向' })),
})

const TopicSuggestionResponseSchema = t.Object({
  items: t.Array(t.String({ minLength: 6, maxLength: 60 }), {
    minItems: 3,
    maxItems: 3,
    description: 'AI 推荐的主题建议',
  }),
})

const ContentLibraryQuerySchema = t.Object({
  page: t.Optional(t.Integer({ minimum: 1, default: 1, description: '页码' })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 50, default: 20, description: '每页数量' })),
  platform: t.Optional(ContentPlatformSchema),
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

const ContentAnalyticsQuerySchema = t.Object({
  contentType: t.Optional(ContentTypeSchema),
  startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
  endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
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
  pendingPerformanceCount: t.Integer(),
  highPerformingCount: t.Integer(),
  newFollowersTotal: t.Integer(),
})

const SuccessResponseSchema = t.Object({
  success: t.Boolean(),
  msg: t.String(),
})

export const contentModel = new Elysia({ name: 'contentModel' }).model({
  'content.noteResponse': ContentNoteResponseSchema,
  'content.generateRequest': GenerateContentRequestSchema,
  'content.topicSuggestionRequest': TopicSuggestionRequestSchema,
  'content.topicSuggestionResponse': TopicSuggestionResponseSchema,
  'content.libraryQuery': ContentLibraryQuerySchema,
  'content.libraryResponse': ContentLibraryResponseSchema,
  'content.performanceUpdate': PerformanceUpdateRequestSchema,
  'content.analyticsQuery': ContentAnalyticsQuerySchema,
  'content.analyticsResponse': ContentAnalyticsResponseSchema,
  'content.error': ErrorResponseSchema,
  'content.success': SuccessResponseSchema,
  'common.error': ErrorResponseSchema,
})

export type ContentNoteResponse = Static<typeof ContentNoteResponseSchema>
export type GenerateContentRequest = Static<typeof GenerateContentRequestSchema>
export type TopicSuggestionRequest = Static<typeof TopicSuggestionRequestSchema>
export type TopicSuggestionResponse = Static<typeof TopicSuggestionResponseSchema>
export type ContentLibraryQuery = Static<typeof ContentLibraryQuerySchema>
export type ContentLibraryResponse = Static<typeof ContentLibraryResponseSchema>
export type PerformanceUpdateRequest = Static<typeof PerformanceUpdateRequestSchema>
export type ContentAnalyticsQuery = Static<typeof ContentAnalyticsQuerySchema>
export type ContentAnalyticsResponse = Static<typeof ContentAnalyticsResponseSchema>
export type SuccessResponse = Static<typeof SuccessResponseSchema>

export { ContentNoteResponseSchema }

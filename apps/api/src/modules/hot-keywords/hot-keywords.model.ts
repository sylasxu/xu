// Hot Keywords Model - TypeBox schemas (v4.8 Digital Ascension)
import { Elysia, t, type Static } from 'elysia';
import { ErrorResponseSchema, type ErrorResponse } from "../../common/common.model";
import { selectGlobalKeywordSchema } from '@juchang/db';

/**
 * Hot Keywords Model Plugin (v4.8 Digital Ascension)
 * 
 * 接口：
 * - GET /hot-keywords - 获取热词列表（默认简版；detail=true 时返回完整字段）
 * - POST /hot-keywords - 创建热词（需要管理员权限）
 * - PATCH /hot-keywords/:id - 更新热词（需要管理员权限）
 * - DELETE /hot-keywords/:id - 删除热词（需要管理员权限）
 * - GET /hot-keywords/analytics - 获取热词分析数据（需要管理员权限）
 */

// ==========================================
// 从 DB Schema 派生响应 Schema（遵循项目规范）
// ==========================================

// 全局关键词响应 Schema（从 DB 派生）
// 注意：drizzle-typebox 生成的 timestamp 字段是 Date 类型
// API 响应中需要转换为 ISO 字符串，所以这里重新定义时间字段
const GlobalKeywordResponse = t.Composite([
  t.Pick(selectGlobalKeywordSchema, [
    'id',
    'keyword',
    'matchType',
    'responseType',
    'responseContent',
    'priority',
    'isActive',
    'hitCount',
    'conversionCount',
    'createdBy',
  ]),
  t.Object({
    // 时间字段转换为 ISO 字符串
    validFrom: t.Union([t.String(), t.Null()]),
    validUntil: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
    updatedAt: t.String(),
  }),
]);

// 热词列表项（简化版，用于 Hot Chips 显示）
// 从 DB Schema 派生
const HotKeywordListItem = t.Pick(selectGlobalKeywordSchema, [
  'id',
  'keyword',
  'responseType',
  'priority',
  'hitCount',
]);

const HotKeywordListEntry = t.Composite([
  HotKeywordListItem,
  t.Partial(
    t.Pick(GlobalKeywordResponse, [
      'matchType',
      'responseContent',
      'validFrom',
      'validUntil',
      'isActive',
      'conversionCount',
      'createdBy',
      'createdAt',
      'updatedAt',
    ])
  ),
]);

// ==========================================
// 创建/更新 Schema（从 DB insertSchema 派生）
// ==========================================

// 创建热词请求 - 手动定义（因为需要额外的验证规则）
// 这是允许的，因为 insertSchema 不包含 minLength/maxLength 等验证
const CreateGlobalKeywordRequest = t.Object({
  keyword: t.String({ minLength: 1, maxLength: 100, description: '关键词文本' }),
  matchType: t.Union([
    t.Literal('exact'),
    t.Literal('prefix'),
    t.Literal('fuzzy'),
  ], { description: '匹配方式' }),
  responseType: t.Union([
    t.Literal('widget_explore'),
    t.Literal('widget_draft'),
    t.Literal('widget_ask_preference'),
    t.Literal('text'),
  ], { description: '响应类型' }),
  responseContent: t.Any({ description: '预设响应内容（JSON）' }),
  priority: t.Optional(t.Number({ default: 0, description: '优先级（数字越大越优先）' })),
  validFrom: t.Optional(t.Union([t.String(), t.Null()], { description: '生效时间（ISO 格式）' })),
  validUntil: t.Optional(t.Union([t.String(), t.Null()], { description: '失效时间（ISO 格式）' })),
});

// 更新热词请求
const UpdateGlobalKeywordRequest = t.Partial(
  t.Composite([
    CreateGlobalKeywordRequest,
    t.Object({
      isActive: t.Boolean({ description: '是否启用' }),
    }),
  ])
);

// ==========================================
// 查询参数 Schema（通用辅助类型，允许手动定义）
// ==========================================

// 热词列表查询参数
const HotKeywordsQuery = t.Object({
  limit: t.Optional(t.Number({ minimum: 1, maximum: 10, default: 5, description: '返回数量' })),
  lat: t.Optional(t.Number({ description: '纬度（可选）' })),
  lng: t.Optional(t.Number({ description: '经度（可选）' })),
  timeRange: t.Optional(t.Union([
    t.Literal('morning'),
    t.Literal('afternoon'),
    t.Literal('evening'),
    t.Literal('night'),
  ], { description: '时间范围过滤' })),
  detail: t.Optional(t.Boolean({ description: '是否返回完整管理字段（需要管理员权限）' })),
  isActive: t.Optional(t.Boolean({ description: '状态筛选' })),
  matchType: t.Optional(t.Union([
    t.Literal('exact'),
    t.Literal('prefix'),
    t.Literal('fuzzy'),
  ], { description: '匹配方式筛选' })),
  responseType: t.Optional(t.Union([
    t.Literal('widget_explore'),
    t.Literal('widget_draft'),
    t.Literal('widget_ask_preference'),
    t.Literal('text'),
  ], { description: '响应类型筛选' })),
});

// 热词分析查询参数
const KeywordAnalyticsQuery = t.Object({
  period: t.Optional(t.Union([
    t.Literal('7d'),
    t.Literal('30d'),
  ], { default: '7d', description: '时间周期' })),
});

// ==========================================
// 响应 Schema
// ==========================================

// 热词列表响应
const HotKeywordsResponse = t.Object({
  items: t.Array(HotKeywordListEntry),
  total: t.Number(),
});

// 创建热词响应
const CreateKeywordResponse = t.Object({
  success: t.Literal(true),
  msg: t.String(),
  id: t.String(),
});

// 更新热词响应
const UpdateKeywordResponse = t.Object({
  data: GlobalKeywordResponse,
});

// 删除热词响应
const DeleteKeywordResponse = t.Object({
  success: t.Literal(true),
  msg: t.String(),
});

// 热词分析项（运营分析辅助类型）
const KeywordAnalyticsItem = t.Object({
  keyword: t.String(),
  hitCount: t.Number(),
  conversionCount: t.Number(),
  conversionRate: t.Number({ description: '转化率（百分比）' }),
  trend: t.Union([
    t.Literal('up'),
    t.Literal('down'),
    t.Literal('stable'),
  ], { description: '趋势' }),
});

// 热词分析响应
const KeywordAnalyticsResponse = t.Object({
  items: t.Array(KeywordAnalyticsItem),
  total: t.Number(),
});

// ==========================================
// 路径参数
// ==========================================

const IdParams = t.Object({
  id: t.String({ format: 'uuid', description: '热词ID' }),
});

// ==========================================
// ==========================================
// 注册到 Elysia
// ==========================================

export const hotKeywordsModel = new Elysia({ name: 'hotKeywordsModel' })
  .model({
    // 响应 Schema
    'hotKeywords.keywordResponse': GlobalKeywordResponse,
    'hotKeywords.listItem': HotKeywordListItem,
    'hotKeywords.listEntry': HotKeywordListEntry,
    'hotKeywords.listResponse': HotKeywordsResponse,
    'hotKeywords.createResponse': CreateKeywordResponse,
    'hotKeywords.updateResponse': UpdateKeywordResponse,
    'hotKeywords.deleteResponse': DeleteKeywordResponse,
    'hotKeywords.analyticsItem': KeywordAnalyticsItem,
    'hotKeywords.analyticsResponse': KeywordAnalyticsResponse,
    
    // 请求 Schema
    'hotKeywords.createRequest': CreateGlobalKeywordRequest,
    'hotKeywords.updateRequest': UpdateGlobalKeywordRequest,
    
    // 查询参数 Schema
    'hotKeywords.query': HotKeywordsQuery,
    'hotKeywords.analyticsQuery': KeywordAnalyticsQuery,
    
    // 路径参数
    'hotKeywords.idParams': IdParams,
    
    // 错误响应
    'common.error': ErrorResponseSchema,
  });

// ==========================================
// 导出 TS 类型
// ==========================================

export type GlobalKeywordResponse = Static<typeof GlobalKeywordResponse>;
export type HotKeywordListItem = Static<typeof HotKeywordListItem>;
export type HotKeywordListEntry = Static<typeof HotKeywordListEntry>;
export type CreateGlobalKeywordRequest = Static<typeof CreateGlobalKeywordRequest>;
export type UpdateGlobalKeywordRequest = Static<typeof UpdateGlobalKeywordRequest>;
export type HotKeywordsQuery = Static<typeof HotKeywordsQuery>;
export type KeywordAnalyticsQuery = Static<typeof KeywordAnalyticsQuery>;
export type HotKeywordsResponse = Static<typeof HotKeywordsResponse>;
export type CreateKeywordResponse = Static<typeof CreateKeywordResponse>;
export type UpdateKeywordResponse = Static<typeof UpdateKeywordResponse>;
export type DeleteKeywordResponse = Static<typeof DeleteKeywordResponse>;
export type KeywordAnalyticsItem = Static<typeof KeywordAnalyticsItem>;
export type KeywordAnalyticsResponse = Static<typeof KeywordAnalyticsResponse>;
export type IdParams = Static<typeof IdParams>;

// Activity Model - TypeBox schemas (MVP 简化版 + v3.2 附近搜索)
import { Elysia, t, type Static } from 'elysia';

/**
 * Activity Model Plugin (MVP 简化版 + v3.2 附近搜索)
 * 
 * MVP 接口：
 * - GET /activities/user/:userId - 获取指定用户相关的活动
 * - GET /activities/:id - 获取活动详情
 * - POST /activities - 创建活动
 * - PATCH /activities/:id/status - 更新状态
 * - DELETE /activities/:id - 删除活动
 * - POST /activities/:id/join - 报名
 * - POST /activities/:id/quit - 退出
 * 
 * v3.2 新增：
 * - GET /activities/nearby - 附近活动搜索
 */

// 创建者信息（简化版）
const CreatorInfo = t.Object({
  id: t.String(),
  nickname: t.Union([t.String(), t.Null()]),
  avatarUrl: t.Union([t.String(), t.Null()]),
});

// 参与者信息（简化版）
const ParticipantInfo = t.Object({
  id: t.String(),
  userId: t.String(),
  status: t.String(),
  joinedAt: t.Union([t.String(), t.Null()]),
  user: t.Union([CreatorInfo, t.Null()]),
});

// 活动详情响应（包含 isArchived 计算字段）
const ActivityDetailResponse = t.Object({
  id: t.String(),
  creatorId: t.String(),
  title: t.String(),
  description: t.Union([t.String(), t.Null()]),
  location: t.Tuple([t.Number(), t.Number()]), // [lng, lat]
  locationName: t.String(),
  address: t.Union([t.String(), t.Null()]),
  locationHint: t.String(),
  startAt: t.String(),
  type: t.String(),
  maxParticipants: t.Number(),
  currentParticipants: t.Number(),
  status: t.String(),
  createdAt: t.String(),
  updatedAt: t.String(),
  // 计算字段
  isArchived: t.Boolean({ description: '群聊是否已归档 (startAt + 24h < now)' }),
  // Chat Tool Mode 字段 (v4.8)
  groupOpenId: t.Union([t.String(), t.Null()], { description: '群聊标识' }),
  dynamicMessageId: t.Union([t.String(), t.Null()], { description: '微信动态消息ID' }),
  // 关联数据
  creator: t.Union([CreatorInfo, t.Null()]),
  participants: t.Array(ParticipantInfo),
});

// 活动列表项（简化版）
const ActivityListItem = t.Object({
  id: t.String(),
  title: t.String(),
  description: t.Union([t.String(), t.Null()]),
  location: t.Tuple([t.Number(), t.Number()]),
  locationName: t.String(),
  locationHint: t.String(),
  startAt: t.String(),
  type: t.String(),
  maxParticipants: t.Number(),
  currentParticipants: t.Number(),
  status: t.String(),
  isArchived: t.Boolean(),
  creator: t.Union([CreatorInfo, t.Null()]),
});

// 我的活动列表响应
const MyActivitiesResponse = t.Object({
  data: t.Array(ActivityListItem),
  total: t.Number(),
});

// 我的活动查询参数
const MyActivitiesQuery = t.Object({
  type: t.Optional(t.Union([
    t.Literal('created'),
    t.Literal('joined'),
  ], { description: '筛选类型：created=我发布的, joined=我参与的' })),
});

// 活动列表查询参数（分页 + 筛选）
const ActivitiesListQuery = t.Object({
  page: t.Optional(t.Number({ minimum: 1, default: 1, description: '页码' })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20, description: '每页数量' })),
  status: t.Optional(t.String({ description: '状态筛选，逗号分隔' })),
  type: t.Optional(t.String({ description: '类型筛选，逗号分隔' })),
  search: t.Optional(t.String({ description: '搜索关键词' })),
  creatorId: t.Optional(t.String({ description: '创建者ID筛选' })),
});

// 活动列表响应
const ActivitiesListResponse = t.Object({
  data: t.Array(ActivityListItem),
  total: t.Number(),
  page: t.Number(),
  pageSize: t.Number(),
});

// ==========================================
// 附近活动搜索 (v3.2 新增)
// ==========================================

// 附近活动查询参数
const NearbyActivitiesQuery = t.Object({
  lat: t.Number({ description: '纬度' }),
  lng: t.Number({ description: '经度' }),
  keyword: t.Optional(t.String({
    minLength: 1,
    maxLength: 50,
    description: '关键词（按标题/地点名称/位置备注模糊匹配）',
  })),
  type: t.Optional(t.Union([
    t.Literal('food'),
    t.Literal('entertainment'),
    t.Literal('sports'),
    t.Literal('boardgame'),
    t.Literal('other'),
  ], { description: '活动类型筛选' })),
  radius: t.Optional(t.Number({ 
    minimum: 100, 
    maximum: 50000, 
    default: 5000, 
    description: '搜索半径（米），默认 5000m' 
  })),
  limit: t.Optional(t.Number({ 
    minimum: 1, 
    maximum: 50, 
    default: 20, 
    description: '返回数量，默认 20' 
  })),
});

// 附近活动列表项（包含距离）
const NearbyActivityItem = t.Object({
  id: t.String(),
  title: t.String(),
  description: t.Union([t.String(), t.Null()]),
  lat: t.Number(),
  lng: t.Number(),
  locationName: t.String(),
  locationHint: t.String(),
  startAt: t.String(),
  type: t.String(),
  maxParticipants: t.Number(),
  currentParticipants: t.Number(),
  status: t.String(),
  distance: t.Number({ description: '距离（米）' }),
  creator: t.Union([CreatorInfo, t.Null()]),
});

// 附近活动响应
const NearbyActivitiesResponse = t.Object({
  data: t.Array(NearbyActivityItem),
  total: t.Number(),
  center: t.Object({
    lat: t.Number(),
    lng: t.Number(),
  }),
  radius: t.Number(),
});

// ==========================================
// v5.0: 公开活动详情（无需认证）
// ==========================================

// 公开活动参与者信息（仅头像+昵称）
const PublicParticipantInfo = t.Object({
  nickname: t.Union([t.String(), t.Null()]),
  avatarUrl: t.Union([t.String(), t.Null()]),
});

// 公开活动讨论区消息预览
const PublicMessagePreview = t.Object({
  senderNickname: t.Union([t.String(), t.Null()]),
  senderAvatar: t.Union([t.String(), t.Null()]),
  content: t.String(),
  createdAt: t.String(),
});

// 公开活动详情响应（排除敏感字段）
const PublicActivityResponse = t.Object({
  id: t.String(),
  title: t.String(),
  description: t.Union([t.String(), t.Null()]),
  startAt: t.String(),
  locationName: t.String(),
  locationHint: t.String(),
  type: t.String(),
  status: t.String(),
  maxParticipants: t.Number(),
  currentParticipants: t.Number(),
  theme: t.String(),
  themeConfig: t.Union([t.Any(), t.Null()]),
  isArchived: t.Boolean(),
  creator: t.Object({
    nickname: t.Union([t.String(), t.Null()]),
    avatarUrl: t.Union([t.String(), t.Null()]),
  }),
  participants: t.Array(PublicParticipantInfo),
  recentMessages: t.Array(PublicMessagePreview),
});

// ==========================================
// 创建活动相关
// ==========================================

// 创建活动请求
const CreateActivityRequest = t.Object({
  title: t.String({ maxLength: 100, description: '活动标题' }),
  description: t.Optional(t.String({ description: '活动描述' })),
  location: t.Tuple([t.Number(), t.Number()], { description: '位置坐标 [lng, lat]' }),
  locationName: t.String({ maxLength: 100, description: '地点名称' }),
  address: t.Optional(t.String({ maxLength: 255, description: '详细地址' })),
  locationHint: t.String({ maxLength: 100, description: '位置提示（重庆地形必填）' }),
  startAt: t.String({ description: '开始时间 ISO 格式' }),
  type: t.Union([
    t.Literal('food'),
    t.Literal('entertainment'),
    t.Literal('sports'),
    t.Literal('boardgame'),
    t.Literal('other'),
  ], { description: '活动类型' }),
  maxParticipants: t.Optional(t.Number({ minimum: 2, maximum: 50, default: 4, description: '最大参与人数' })),
});

// 发布草稿请求 (v3.2 新增)
const PublishDraftRequest = t.Object({
  title: t.Optional(t.String({ maxLength: 100, description: '活动标题（可选更新）' })),
  description: t.Optional(t.String({ description: '活动描述（可选更新）' })),
  location: t.Optional(t.Tuple([t.Number(), t.Number()], { description: '位置坐标 [lng, lat]（可选更新）' })),
  locationName: t.Optional(t.String({ maxLength: 100, description: '地点名称（可选更新）' })),
  address: t.Optional(t.String({ maxLength: 255, description: '详细地址（可选更新）' })),
  locationHint: t.Optional(t.String({ maxLength: 100, description: '位置提示（可选更新）' })),
  startAt: t.Optional(t.String({ description: '开始时间 ISO 格式（可选更新）' })),
  type: t.Optional(t.Union([
    t.Literal('food'),
    t.Literal('entertainment'),
    t.Literal('sports'),
    t.Literal('boardgame'),
    t.Literal('other'),
  ], { description: '活动类型（可选更新）' })),
  maxParticipants: t.Optional(t.Number({ minimum: 2, maximum: 50, description: '最大参与人数（可选更新）' })),
});

// 更新活动状态请求
const UpdateStatusRequest = t.Object({
  status: t.Union([
    t.Literal('completed'),
    t.Literal('cancelled'),
  ], { description: '目标状态' }),
});

// 路径参数
const IdParams = t.Object({
  id: t.String({ format: 'uuid', description: '活动ID' }),
});

// 错误响应
const ErrorResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// 成功响应
const SuccessResponse = t.Object({
  success: t.Boolean(),
  msg: t.Optional(t.String()),
});

// 创建活动响应
const CreateActivityResponse = t.Object({
  id: t.String(),
  msg: t.String(),
});

// ==========================================
// 活动统计 (新增)
// ==========================================

// 活动统计查询参数
const ActivityStatsQuerySchema = t.Object({
  type: t.Optional(t.Union([
    t.Literal('overview'),      // 概览统计
    t.Literal('distribution'),  // 类型分布
  ], { default: 'overview', description: '统计类型' })),
});

// 活动概览统计
const ActivityOverviewStatsSchema = t.Object({
  totalActivities: t.Number({ description: '总活动数' }),
  activeActivities: t.Number({ description: '进行中的活动' }),
  completedActivities: t.Number({ description: '已成局的活动' }),
  draftActivities: t.Number({ description: '草稿数' }),
  todayCompleted: t.Number({ description: '今日成局数' }),
});

// 活动类型分布
const ActivityTypeDistributionSchema = t.Object({
  food: t.Number(),
  sports: t.Number(),
  entertainment: t.Number(),
  boardgame: t.Number(),
  other: t.Number(),
});

// 注册到 Elysia
export const activityModel = new Elysia({ name: 'activityModel' })
  .model({
    'activity.detailResponse': ActivityDetailResponse,
    'activity.listItem': ActivityListItem,
    'activity.myActivitiesResponse': MyActivitiesResponse,
    'activity.myActivitiesQuery': MyActivitiesQuery,
    // 活动列表
    'activity.listQuery': ActivitiesListQuery,
    'activity.listResponse': ActivitiesListResponse,
    // v3.2 附近搜索
    'activity.nearbyQuery': NearbyActivitiesQuery,
    'activity.nearbyItem': NearbyActivityItem,
    'activity.nearbyResponse': NearbyActivitiesResponse,
    // v5.0 公开活动详情
    'activity.publicResponse': PublicActivityResponse,
    // 创建活动
    'activity.createRequest': CreateActivityRequest,
    'activity.publishDraftRequest': PublishDraftRequest,
    'activity.updateStatusRequest': UpdateStatusRequest,
    'activity.createResponse': CreateActivityResponse,
    'activity.idParams': IdParams,
    'activity.error': ErrorResponse,
    'activity.success': SuccessResponse,
    // 活动统计
    'activity.statsQuery': ActivityStatsQuerySchema,
    'activity.overviewStats': ActivityOverviewStatsSchema,
    'activity.typeDistribution': ActivityTypeDistributionSchema,
  });

// 导出 TS 类型
export type CreatorInfo = Static<typeof CreatorInfo>;
export type ParticipantInfo = Static<typeof ParticipantInfo>;
export type ActivityDetailResponse = Static<typeof ActivityDetailResponse>;
export type ActivityListItem = Static<typeof ActivityListItem>;
export type MyActivitiesResponse = Static<typeof MyActivitiesResponse>;
export type MyActivitiesQuery = Static<typeof MyActivitiesQuery>;
export type ActivitiesListQuery = Static<typeof ActivitiesListQuery>;
export type ActivitiesListResponse = Static<typeof ActivitiesListResponse>;
export type NearbyActivitiesQuery = Static<typeof NearbyActivitiesQuery>;
export type NearbyActivityItem = Static<typeof NearbyActivityItem>;
export type NearbyActivitiesResponse = Static<typeof NearbyActivitiesResponse>;
export type PublicActivityResponse = Static<typeof PublicActivityResponse>;
export type CreateActivityRequest = Static<typeof CreateActivityRequest>;
export type PublishDraftRequest = Static<typeof PublishDraftRequest>;
export type UpdateStatusRequest = Static<typeof UpdateStatusRequest>;
export type IdParams = Static<typeof IdParams>;
export type ErrorResponse = Static<typeof ErrorResponse>;
export type SuccessResponse = Static<typeof SuccessResponse>;
export type CreateActivityResponse = Static<typeof CreateActivityResponse>;
// 活动统计类型
export type ActivityStatsQuery = Static<typeof ActivityStatsQuerySchema>;
export type ActivityOverviewStats = Static<typeof ActivityOverviewStatsSchema>;
export type ActivityTypeDistribution = Static<typeof ActivityTypeDistributionSchema>;
// 导出 Schema 供 controller 使用
export { ActivityOverviewStatsSchema, ActivityTypeDistributionSchema };

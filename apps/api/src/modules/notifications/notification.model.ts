// Notification Model - 通知与消息中心
import { Elysia, t, type Static } from 'elysia';
import { selectNotificationSchema } from '@juchang/db';

/**
 * Notification Model Plugin
 * 按 userId 显式查询通知
 */

// 通知列表查询参数（按 userId 显式查询）
const NotificationListQuery = t.Object({
  page: t.Optional(t.Number({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 50, default: 20 })),
  type: t.Optional(t.String({ description: '通知类型筛选' })),
  userId: t.String({ 
    format: 'uuid',
    description: '目标用户ID（请求方必须具备访问该用户通知的权限）' 
  }),
});

// 通知列表响应
const NotificationListResponse = t.Object({
  items: t.Array(selectNotificationSchema),
  total: t.Number(),
  page: t.Number(),
  totalPages: t.Number(),
});

// 待确认匹配查询参数（显式 userId）
const MatchPendingQuery = t.Object({
  userId: t.String({
    format: 'uuid',
    description: '目标用户ID（请求方必须具备访问该用户匹配信息的权限）',
  }),
});

const MatchPendingRequestMode = t.Union([
  t.Literal('auto_match'),
  t.Literal('connect'),
  t.Literal('group_up'),
], { description: '这条待确认匹配的来源模式' });

// 待确认匹配项
const MatchPendingItem = t.Object({
  id: t.String({ format: 'uuid', description: '匹配 ID' }),
  activityType: t.String({ description: '活动类型' }),
  typeName: t.String({ description: '活动类型中文名' }),
  requestMode: MatchPendingRequestMode,
  matchScore: t.Number({ description: '匹配分' }),
  commonTags: t.Array(t.String(), { description: '共同标签' }),
  locationHint: t.String({ description: '地点提示' }),
  confirmDeadline: t.String({ description: '确认截止时间 ISO' }),
  taskId: t.Union([t.String({ format: 'uuid' }), t.Null()], {
    description: '关联任务 ID（用于恢复同一条找搭子任务）',
  }),
  isTempOrganizer: t.Boolean({ description: '是否当前用户可确认/取消' }),
});

const MatchPendingDetailQuery = t.Object({
  userId: t.String({
    format: 'uuid',
    description: '目标用户ID（请求方必须具备访问该用户匹配详情的权限）',
  }),
});

const MatchPendingMember = t.Object({
  userId: t.String({ format: 'uuid', description: '成员用户 ID' }),
  nickname: t.Union([t.String(), t.Null()], { description: '成员昵称' }),
  avatarUrl: t.Union([t.String(), t.Null()], { description: '成员头像' }),
  isTempOrganizer: t.Boolean({ description: '是否临时召集人' }),
  locationHint: t.String({ description: '成员偏好的地点提示' }),
  timePreference: t.Union([t.String(), t.Null()], { description: '成员时间偏好' }),
  tags: t.Array(t.String(), { description: '成员偏好标签' }),
  intentSummary: t.String({ description: '成员意向摘要' }),
});

const MatchPendingIcebreaker = t.Object({
  content: t.String({ description: '最近一次系统破冰文案' }),
  createdAt: t.String({ description: '破冰文案创建时间 ISO' }),
});

const MatchPendingDetailResponse = t.Object({
  id: t.String({ format: 'uuid', description: '匹配 ID' }),
  activityType: t.String({ description: '活动类型' }),
  typeName: t.String({ description: '活动类型中文名' }),
  requestMode: MatchPendingRequestMode,
  matchScore: t.Number({ description: '匹配分' }),
  commonTags: t.Array(t.String(), { description: '共同偏好标签' }),
  locationHint: t.String({ description: '匹配中心地点提示' }),
  confirmDeadline: t.String({ description: '确认截止时间 ISO' }),
  isTempOrganizer: t.Boolean({ description: '当前用户是否临时召集人' }),
  organizerUserId: t.String({ format: 'uuid', description: '临时召集人用户 ID' }),
  organizerNickname: t.Union([t.String(), t.Null()], { description: '临时召集人昵称' }),
  nextActionOwner: t.Union([t.Literal('self'), t.Literal('organizer')], {
    description: '当前需要谁来推进',
  }),
  nextActionText: t.String({ description: '当前下一步提示' }),
  members: t.Array(MatchPendingMember, { description: '匹配成员摘要' }),
  icebreaker: t.Union([MatchPendingIcebreaker, t.Null()], { description: '最近一条系统破冰文案' }),
});

// 待确认匹配响应
const MatchPendingResponse = t.Object({
  items: t.Array(MatchPendingItem),
});

// 消息中心聚合查询参数（显式 userId）
const MessageCenterQuery = t.Object({
  userId: t.String({
    format: 'uuid',
    description: '目标用户ID（请求方必须具备访问该用户消息中心的权限）',
  }),
  notificationPage: t.Optional(t.Number({ minimum: 1, default: 1 })),
  notificationLimit: t.Optional(t.Number({ minimum: 1, maximum: 50, default: 20 })),
  chatPage: t.Optional(t.Number({ minimum: 1, default: 1 })),
  chatLimit: t.Optional(t.Number({ minimum: 1, maximum: 50, default: 20 })),
});

const MessageCenterChatItem = t.Object({
  activityId: t.String({ format: 'uuid' }),
  activityTitle: t.String(),
  activityImage: t.Union([t.String(), t.Null()]),
  lastMessage: t.Union([t.String(), t.Null()]),
  lastMessageTime: t.Union([t.String(), t.Null()]),
  unreadCount: t.Number(),
  isArchived: t.Boolean(),
  participantCount: t.Number(),
});

const MessageCenterChatActivities = t.Object({
  items: t.Array(MessageCenterChatItem),
  total: t.Number(),
  page: t.Number(),
  totalPages: t.Number(),
  totalUnread: t.Number(),
});

const MessageCenterResponse = t.Object({
  systemNotifications: NotificationListResponse,
  pendingMatches: t.Array(MatchPendingItem),
  unreadNotificationCount: t.Number({ description: '通知区未读总数（系统未读 + 待确认匹配）' }),
  chatActivities: MessageCenterChatActivities,
  totalUnread: t.Number({ description: '消息中心未读总数（通知区 + 群聊区）' }),
});

// 未读数量响应
const UnreadCountResponse = t.Object({
  count: t.Number(),
});

// 路径参数
const IdParams = t.Object({
  id: t.String({ format: 'uuid' }),
});

// 错误响应
const ErrorResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// 成功响应
const SuccessResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
});

const MatchActionResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
  activityId: t.Optional(t.String({ format: 'uuid' })),
});

// 注册到 Elysia Model Plugin
export const notificationModel = new Elysia({ name: 'notificationModel' })
  .model({
    'notification.listQuery': NotificationListQuery,
    'notification.listResponse': NotificationListResponse,
    'notification.matchPendingQuery': MatchPendingQuery,
    'notification.matchPendingItem': MatchPendingItem,
    'notification.matchPendingResponse': MatchPendingResponse,
    'notification.matchPendingDetailQuery': MatchPendingDetailQuery,
    'notification.matchPendingMember': MatchPendingMember,
    'notification.matchPendingIcebreaker': MatchPendingIcebreaker,
    'notification.matchPendingRequestMode': MatchPendingRequestMode,
    'notification.matchPendingDetailResponse': MatchPendingDetailResponse,
    'notification.messageCenterQuery': MessageCenterQuery,
    'notification.messageCenterChatItem': MessageCenterChatItem,
    'notification.messageCenterChatActivities': MessageCenterChatActivities,
    'notification.messageCenterResponse': MessageCenterResponse,
    'notification.unreadCount': UnreadCountResponse,
    'notification.response': selectNotificationSchema,
    'notification.idParams': IdParams,
    'notification.error': ErrorResponse,
    'notification.success': SuccessResponse,
    'notification.matchActionResponse': MatchActionResponse,
  });

// 导出 TS 类型
export type NotificationListQuery = Static<typeof NotificationListQuery>;
export type NotificationListResponse = Static<typeof NotificationListResponse>;
export type MatchPendingQuery = Static<typeof MatchPendingQuery>;
export type MatchPendingItem = Static<typeof MatchPendingItem>;
export type MatchPendingResponse = Static<typeof MatchPendingResponse>;
export type MatchPendingDetailQuery = Static<typeof MatchPendingDetailQuery>;
export type MatchPendingMember = Static<typeof MatchPendingMember>;
export type MatchPendingIcebreaker = Static<typeof MatchPendingIcebreaker>;
export type MatchPendingRequestMode = Static<typeof MatchPendingRequestMode>;
export type MatchPendingDetailResponse = Static<typeof MatchPendingDetailResponse>;
export type MessageCenterQuery = Static<typeof MessageCenterQuery>;
export type MessageCenterChatItem = Static<typeof MessageCenterChatItem>;
export type MessageCenterChatActivities = Static<typeof MessageCenterChatActivities>;
export type MessageCenterResponse = Static<typeof MessageCenterResponse>;
export type UnreadCountResponse = Static<typeof UnreadCountResponse>;
export type IdParams = Static<typeof IdParams>;
export type ErrorResponse = Static<typeof ErrorResponse>;
export type SuccessResponse = Static<typeof SuccessResponse>;
export type MatchActionResponse = Static<typeof MatchActionResponse>;

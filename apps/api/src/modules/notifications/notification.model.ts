// Notification Model - 通知与消息中心
import { Elysia, t, type Static } from 'elysia';
import { ErrorResponseSchema, type ErrorResponse } from "../../common/common.model";
import { selectNotificationSchema } from '@xu/db';

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
  matchReasonTitle: t.String({ description: '匹配理由标题' }),
  matchReasonText: t.String({ description: '匹配理由说明' }),
  deadlineHint: t.String({ description: '确认截止前的处理提示' }),
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
  lastMessageSenderId: t.Union([t.String(), t.Null()]),
  lastMessageSenderNickname: t.Union([t.String(), t.Null()]),
  unreadCount: t.Number(),
  responseNeeded: t.Boolean(),
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

const MessageCenterActionItemAction = t.Object({
  kind: t.Union([
    t.Literal('prompt'),
    t.Literal('open_discussion'),
    t.Literal('open_activity'),
  ]),
  label: t.String({ description: '动作按钮文案' }),
  prompt: t.Optional(t.String({ description: '需要发回聊天流的提示词' })),
  activityId: t.Optional(t.String({ format: 'uuid', description: '关联活动 ID' })),
  activityMode: t.Optional(t.Union([
    t.Literal('review'),
    t.Literal('rebook'),
    t.Literal('kickoff'),
  ])),
  entry: t.Optional(t.String({ description: '入口标识' })),
});

const MessageCenterActionItem = t.Object({
  id: t.String({ description: '任务卡 ID' }),
  type: t.Union([
    t.Literal('activity_reminder'),
    t.Literal('post_activity_follow_up'),
    t.Literal('discussion_reply'),
    t.Literal('draft_continue'),
    t.Literal('recruiting_follow_up'),
  ]),
  title: t.String({ description: '任务卡标题' }),
  summary: t.String({ description: '任务卡摘要' }),
  statusLabel: t.String({ description: '当前状态标签' }),
  updatedAt: t.String({ description: '最近更新时间 ISO' }),
  activityId: t.Union([t.String({ format: 'uuid' }), t.Null()], { description: '关联活动 ID' }),
  notificationId: t.Optional(t.String({ format: 'uuid', description: '关联通知 ID，用于点击承接后标记已读' })),
  badge: t.Optional(t.String({ description: '右上角角标' })),
  primaryAction: MessageCenterActionItemAction,
});

const MessageCenterUi = t.Object({
  title: t.String({ description: '消息中心标题' }),
  description: t.String({ description: '消息中心副文案' }),
  visitorTitle: t.String({ description: '未登录占位标题' }),
  visitorDescription: t.String({ description: '未登录占位说明' }),
  summaryTitle: t.String({ description: '未读摘要标题' }),
  actionInboxSectionTitle: t.String({ description: '待处理任务分区标题' }),
  actionInboxDescription: t.String({ description: '待处理任务分区说明' }),
  actionInboxEmpty: t.String({ description: '待处理任务空状态文案' }),
  pendingMatchesTitle: t.String({ description: '待确认匹配分区标题' }),
  pendingMatchesEmpty: t.String({ description: '待确认匹配空状态文案' }),
  requestAuthHint: t.String({ description: '未登录查看消息中心提示' }),
  loadFailedText: t.String({ description: '消息中心加载失败文案' }),
  markReadSuccess: t.String({ description: '标记已读成功提示' }),
  markReadFailed: t.String({ description: '标记已读失败提示' }),
  pendingDetailAuthHint: t.String({ description: '未登录查看匹配详情提示' }),
  pendingDetailLoadFailed: t.String({ description: '匹配详情加载失败文案' }),
  actionFailed: t.String({ description: '匹配操作失败文案' }),
  followUpFailed: t.String({ description: '跟进动作失败文案' }),
  refreshLabel: t.String({ description: '刷新按钮说明' }),
  systemSectionTitle: t.String({ description: '系统跟进分区标题' }),
  systemEmpty: t.String({ description: '系统通知空状态文案' }),
  feedbackPositiveLabel: t.String({ description: '活动后正向反馈按钮文案' }),
  feedbackNeutralLabel: t.String({ description: '活动后一般反馈按钮文案' }),
  feedbackNegativeLabel: t.String({ description: '活动后负向反馈按钮文案' }),
  reviewActionLabel: t.String({ description: '活动复盘按钮文案' }),
  rebookActionLabel: t.String({ description: '活动再约按钮文案' }),
  kickoffActionLabel: t.String({ description: '群聊开场按钮文案' }),
  markReadActionLabel: t.String({ description: '标记已读按钮文案' }),
  chatSummarySectionTitle: t.String({ description: '群聊摘要分区标题' }),
  chatSummaryDescription: t.String({ description: '群聊摘要说明文案' }),
  chatSummaryEmpty: t.String({ description: '群聊摘要空状态文案' }),
  chatSummaryFallbackMessage: t.String({ description: '群聊摘要默认消息文案' }),
});

const MessageCenterResponse = t.Object({
  actionItems: t.Array(MessageCenterActionItem),
  systemNotifications: NotificationListResponse,
  pendingMatches: t.Array(MatchPendingItem),
  unreadNotificationCount: t.Number({ description: '通知区未读总数（系统未读 + 待确认匹配）' }),
  chatActivities: MessageCenterChatActivities,
  totalUnread: t.Number({ description: '消息中心未读总数（通知区 + 群聊区）' }),
  ui: MessageCenterUi,
});

// 未读数量响应
const UnreadCountResponse = t.Object({
  count: t.Number(),
});

// 路径参数
const IdParams = t.Object({
  id: t.String({ format: 'uuid' }),
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
    'notification.messageCenterActionItemAction': MessageCenterActionItemAction,
    'notification.messageCenterActionItem': MessageCenterActionItem,
    'notification.messageCenterUi': MessageCenterUi,
    'notification.messageCenterChatItem': MessageCenterChatItem,
    'notification.messageCenterChatActivities': MessageCenterChatActivities,
    'notification.messageCenterResponse': MessageCenterResponse,
    'notification.unreadCount': UnreadCountResponse,
    'notification.response': selectNotificationSchema,
    'notification.idParams': IdParams,
    'common.error': ErrorResponseSchema,
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
export type MessageCenterActionItemAction = Static<typeof MessageCenterActionItemAction>;
export type MessageCenterActionItem = Static<typeof MessageCenterActionItem>;
export type MessageCenterUi = Static<typeof MessageCenterUi>;
export type MessageCenterChatItem = Static<typeof MessageCenterChatItem>;
export type MessageCenterChatActivities = Static<typeof MessageCenterChatActivities>;
export type MessageCenterResponse = Static<typeof MessageCenterResponse>;
export type UnreadCountResponse = Static<typeof UnreadCountResponse>;
export type IdParams = Static<typeof IdParams>;
export type SuccessResponse = Static<typeof SuccessResponse>;
export type MatchActionResponse = Static<typeof MatchActionResponse>;

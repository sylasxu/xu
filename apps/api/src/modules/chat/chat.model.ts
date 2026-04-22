// Chat Model - TypeBox schemas (MVP 简化版)
import { Elysia, t, type Static } from 'elysia';
import { ErrorResponseSchema, type ErrorResponse } from "../../common/common.model";

/**
 * Chat Model Plugin (MVP 简化版)
 * 
 * MVP 接口：
 * - GET /chat/:activityId/messages - 获取消息列表（轮询）
 * - POST /chat/:activityId/messages - 发送消息
 * - WS /chat/:activityId/ws - WebSocket 实时通讯
 */

// 消息响应
export const ChatMessageResponseSchema = t.Object({
  id: t.String(),
  activityId: t.String(),
  senderId: t.Union([t.String(), t.Null()]),
  parentId: t.Union([t.String(), t.Null()]),
  senderNickname: t.Union([t.String(), t.Null()]),
  senderAvatarUrl: t.Union([t.String(), t.Null()]),
  type: t.String(),
  content: t.String(),
  createdAt: t.String(),
});

// 消息列表查询参数
const MessageListQuery = t.Object({
  since: t.Optional(t.String({ description: '上次获取的最后一条消息ID，用于增量获取' })),
  before: t.Optional(t.String({ description: '最早一条消息ID，用于加载更早历史消息' })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 50, description: '获取数量' })),
});

const MessageListResponse = t.Object({
  messages: t.Array(ChatMessageResponseSchema),
  isArchived: t.Boolean({ description: '群聊是否已归档' }),
  historyCursor: t.Union([t.String(), t.Null()], { description: '下一页更早历史消息游标' }),
  hasMoreHistory: t.Boolean({ description: '是否还有更早历史消息' }),
});

// 聊天活动列表查询参数（显式 userId）
const ChatActivitiesQuery = t.Object({
  userId: t.String({ format: 'uuid', description: '目标用户ID（普通用户仅可传本人）' }),
  page: t.Optional(t.Number({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 50, default: 20 })),
});

// 聊天活动项
const ChatActivityItemSchema = t.Object({
  activityId: t.String({ format: 'uuid' }),
  activityTitle: t.String(),
  activityImage: t.Union([t.String(), t.Null()]),
  lastMessage: t.Union([t.String(), t.Null()]),
  lastMessageTime: t.Union([t.String(), t.Null()]),
  lastMessageSenderId: t.Union([t.String(), t.Null()]),
  lastMessageSenderNickname: t.Union([t.String(), t.Null()]),
  unreadCount: t.Number(),
  isArchived: t.Boolean(),
  participantCount: t.Number(),
});

// 聊天活动列表响应
const ChatActivitiesResponse = t.Object({
  items: t.Array(ChatActivityItemSchema),
  total: t.Number(),
  page: t.Number(),
  totalPages: t.Number(),
  totalUnread: t.Number({ description: '群聊未读总数（服务端统计）' }),
});

// 发送消息请求
const SendMessageRequest = t.Object({
  content: t.String({ minLength: 1, maxLength: 2000, description: '消息内容' }),
  parentId: t.Optional(t.String({ format: 'uuid', description: '回复的父消息 ID' })),
});

// 发送消息响应
const SendMessageResponse = t.Object({
  id: t.String(),
  msg: t.String(),
});

// 路径参数
const ActivityIdParams = t.Object({
  activityId: t.String({ format: 'uuid', description: '活动ID' }),
});


// ==========================================
// WebSocket 消息类型 (v4.7)
// ==========================================

// 客户端 -> 服务端
export const WsClientMessageSchema = t.Union([
  t.Object({
    type: t.Literal('message'),
    content: t.String({ maxLength: 500 }),
    parentId: t.Optional(t.String({ format: 'uuid' })),
  }),
  t.Object({
    type: t.Literal('ping'),
  }),
]);

// 服务端 -> 客户端
export const WsServerMessageSchema = t.Object({
  type: t.Union([
    t.Literal('message'),   // 新消息
    t.Literal('history'),   // 历史消息
    t.Literal('online'),    // 在线人数
    t.Literal('join'),      // 用户加入
    t.Literal('leave'),     // 用户离开
    t.Literal('error'),     // 错误
    t.Literal('pong'),      // 心跳响应
  ]),
  data: t.Unknown(),
  ts: t.Number(),
});

// WebSocket 错误码
export const WsErrorCodes = {
  UNAUTHORIZED: 4001,       // 未授权
  NOT_PARTICIPANT: 4003,    // 未报名
  NOT_FOUND: 4004,          // 活动不存在
  HEARTBEAT_TIMEOUT: 4008,  // 心跳超时
  ARCHIVED: 4010,           // 已归档
  CONTENT_VIOLATION: 4022,  // 内容违规
  RATE_LIMITED: 4029,       // 频率限制
} as const;

// 举报消息请求
export const ReportMessageRequest = t.Object({
  messageId: t.String({ format: 'uuid', description: '消息ID' }),
  reason: t.String({ minLength: 1, maxLength: 500, description: '举报原因' }),
});

// 注册到 Elysia Model Plugin
export const chatModel = new Elysia({ name: 'chatModel' })
  .model({
    'chat.messageResponse': ChatMessageResponseSchema,
    'chat.messageListQuery': MessageListQuery,
    'chat.messageListResponse': MessageListResponse,
    'chat.activitiesQuery': ChatActivitiesQuery,
    'chat.activityItem': ChatActivityItemSchema,
    'chat.activitiesResponse': ChatActivitiesResponse,
    'chat.sendMessageRequest': SendMessageRequest,
    'chat.sendMessageResponse': SendMessageResponse,
    'chat.activityIdParams': ActivityIdParams,
    'common.error': ErrorResponseSchema,
    'chat.wsClientMessage': WsClientMessageSchema,
    'chat.wsServerMessage': WsServerMessageSchema,
    'chat.reportMessageRequest': ReportMessageRequest,
  });

// 导出 TS 类型
export type ChatMessageResponse = Static<typeof ChatMessageResponseSchema>;
export type MessageListQuery = Static<typeof MessageListQuery>;
export type MessageListResponse = Static<typeof MessageListResponse>;
export type ChatActivitiesQuery = Static<typeof ChatActivitiesQuery>;
export type ChatActivityItem = Static<typeof ChatActivityItemSchema>;
export type ChatActivitiesResponse = Static<typeof ChatActivitiesResponse>;
export type SendMessageRequest = Static<typeof SendMessageRequest>;
export type SendMessageResponse = Static<typeof SendMessageResponse>;
export type ActivityIdParams = Static<typeof ActivityIdParams>;
export type WsClientMessage = Static<typeof WsClientMessageSchema>;
export type WsServerMessage = Static<typeof WsServerMessageSchema>;
export type ReportMessageRequest = Static<typeof ReportMessageRequest>;

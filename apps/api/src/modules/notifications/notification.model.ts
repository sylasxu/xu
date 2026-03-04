// Notification Model - MVP 简化版 + Admin 扩展
import { Elysia, t, type Static } from 'elysia';
import { selectNotificationSchema } from '@juchang/db';

/**
 * Notification Model Plugin - MVP 版本 + Admin 扩展
 * 按 userId 显式查询通知
 */

// 通知列表查询参数（扩展支持 Admin 模式）
const NotificationListQuery = t.Object({
  page: t.Optional(t.Number({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 50, default: 20 })),
  type: t.Optional(t.String({ description: '通知类型筛选' })),
  userId: t.String({ 
    format: 'uuid',
    description: '目标用户ID（普通用户仅可传本人）' 
  }),
});

// 通知列表响应
const NotificationListResponse = t.Object({
  items: t.Array(selectNotificationSchema),
  total: t.Number(),
  page: t.Number(),
  totalPages: t.Number(),
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

// 注册到 Elysia Model Plugin
export const notificationModel = new Elysia({ name: 'notificationModel' })
  .model({
    'notification.listQuery': NotificationListQuery,
    'notification.listResponse': NotificationListResponse,
    'notification.unreadCount': UnreadCountResponse,
    'notification.response': selectNotificationSchema,
    'notification.idParams': IdParams,
    'notification.error': ErrorResponse,
    'notification.success': SuccessResponse,
  });

// 导出 TS 类型
export type NotificationListQuery = Static<typeof NotificationListQuery>;
export type NotificationListResponse = Static<typeof NotificationListResponse>;
export type UnreadCountResponse = Static<typeof UnreadCountResponse>;
export type IdParams = Static<typeof IdParams>;
export type ErrorResponse = Static<typeof ErrorResponse>;
export type SuccessResponse = Static<typeof SuccessResponse>;

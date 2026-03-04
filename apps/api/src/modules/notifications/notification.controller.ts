// Notification Controller - MVP 简化版 + Admin 扩展
import { Elysia } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { notificationModel, type ErrorResponse } from './notification.model';
import { 
  getNotifications, 
  getNotificationsByUserId,
  markAsRead, 
  getUnreadCount 
} from './notification.service';

export const notificationController = new Elysia({ prefix: '/notifications' })
  .use(basePlugins)
  .use(notificationModel)

  // 获取通知列表（按 userId 查询）
  .get(
    '/',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const { userId } = query;
      if (!userId) {
        set.status = 400;
        return { code: 400, msg: '缺少 userId 参数' } satisfies ErrorResponse;
      }

      if (user.role !== 'admin' && user.id !== userId) {
        set.status = 403;
        return { code: 403, msg: '无权限访问该用户通知' } satisfies ErrorResponse;
      }

      if (user.role === 'admin') {
        const result = await getNotificationsByUserId(userId, query);
        return result;
      }

      const result = await getNotifications(user.id, query);
      return result;
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '获取通知列表',
        description: `按 userId 获取通知列表（普通用户仅可查询本人，Admin 可查询任意用户）。`,
      },
      query: 'notification.listQuery',
      response: {
        200: 'notification.listResponse',
        400: 'notification.error',
        403: 'notification.error',
        401: 'notification.error',
      },
    }
  )

  // 获取未读通知数量
  .get(
    '/unread-count',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const result = await getUnreadCount(user.id);
      return result;
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '获取未读通知数量',
      },
      response: {
        200: 'notification.unreadCount',
        401: 'notification.error',
      },
    }
  )

  // 标记通知为已读
  .post(
    '/:id/read',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const success = await markAsRead(params.id, user.id);
      if (!success) {
        set.status = 404;
        return { code: 404, msg: '通知不存在' } satisfies ErrorResponse;
      }

      return { code: 200, msg: '已标记为已读' };
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '标记通知为已读',
      },
      params: 'notification.idParams',
      response: {
        200: 'notification.success',
        401: 'notification.error',
        404: 'notification.error',
      },
    }
  );

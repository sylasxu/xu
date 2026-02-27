// Notification Controller - MVP 简化版 + Admin 扩展
import { Elysia } from 'elysia';
import { basePlugins, verifyAuth, verifyAdmin, AuthError } from '../../setup';
import { notificationModel, type ErrorResponse } from './notification.model';
import { 
  getNotifications, 
  getAllNotifications,
  getNotificationsByUserId,
  markAsRead, 
  getUnreadCount 
} from './notification.service';

export const notificationController = new Elysia({ prefix: '/notifications' })
  .use(basePlugins)
  .use(notificationModel)

  // 获取通知列表（支持显式的 scope 参数）
  .get(
    '/',
    async ({ query, set, jwt, headers }) => {
      const { scope = 'mine', userId } = query;

      // scope=all 或 userId 参数需要 Admin 权限
      if (scope === 'all' || userId) {
        try {
          await verifyAdmin(jwt, headers);
        } catch (error) {
          if (error instanceof AuthError) {
            set.status = error.status;
            return { code: error.status, msg: error.message } satisfies ErrorResponse;
          }
          set.status = 500;
          return { code: 500, msg: '服务器错误' } satisfies ErrorResponse;
        }

        // Admin 查指定用户的通知
        if (userId) {
          const result = await getNotificationsByUserId(userId, query);
          return result;
        }

        // Admin 查所有用户的通知
        const result = await getAllNotifications(query);
        return result;
      }

      // scope=mine（默认）：普通用户查自己的通知
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const result = await getNotifications(user.id, query);
      return result;
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '获取通知列表',
        description: `获取通知列表，支持显式的 scope 参数区分模式：
- scope=mine（默认）：获取当前用户的通知
- scope=all：获取所有用户的通知（需 Admin 权限）
- userId 参数：获取指定用户的通知（需 Admin 权限）`,
      },
      query: 'notification.listQuery',
      response: {
        200: 'notification.listResponse',
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

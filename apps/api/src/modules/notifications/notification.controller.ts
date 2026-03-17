// Notification Controller - 通知与消息中心接口
import { Elysia } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { notificationModel, type ErrorResponse } from './notification.model';
import { 
  getMessageCenterData,
  getNotifications, 
  getPendingMatches,
  getPendingMatchDetail,
  markAsRead, 
  getUnreadCount,
  confirmPendingMatch,
  cancelPendingMatch,
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

      const result = await getNotifications(userId, query);
      return result;
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '获取通知列表',
        description: '按 userId 获取通知列表，请求方需对目标用户具备访问权限。',
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

  // 获取消息中心聚合数据（单接口，按 userId 显式查询）
  .get(
    '/message-center',
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
        return { code: 403, msg: '无权限访问该用户消息中心' } satisfies ErrorResponse;
      }

      const result = await getMessageCenterData(userId, query);
      return result;
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '获取消息中心聚合数据',
        description: '单接口返回系统通知、待确认匹配、通知未读、群聊列表及总未读统计。',
      },
      query: 'notification.messageCenterQuery',
      response: {
        200: 'notification.messageCenterResponse',
        400: 'notification.error',
        403: 'notification.error',
        401: 'notification.error',
      },
    }
  )

  // 获取待确认匹配（按 userId 显式查询）
  .get(
    '/pending-matches',
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
        return { code: 403, msg: '无权限访问该用户匹配信息' } satisfies ErrorResponse;
      }

      const result = await getPendingMatches(userId);
      return result;
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '获取待确认匹配',
        description: '按 userId 获取待确认的搭子匹配卡片（用于确认/取消）。',
      },
      query: 'notification.matchPendingQuery',
      response: {
        200: 'notification.matchPendingResponse',
        400: 'notification.error',
        403: 'notification.error',
        401: 'notification.error',
      },
    }
  )

  // 获取单个待确认匹配详情（按 userId 显式查询）
  .get(
    '/pending-matches/:id',
    async ({ params, query, set, jwt, headers }) => {
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
        return { code: 403, msg: '无权限访问该用户匹配详情' } satisfies ErrorResponse;
      }

      try {
        return await getPendingMatchDetail(userId, params.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : '获取详情失败';
        if (/找不到/.test(message)) {
          set.status = 404;
        } else if (/不在/.test(message)) {
          set.status = 403;
        } else if (/处理过/.test(message)) {
          set.status = 400;
        } else {
          set.status = 500;
        }

        return { code: set.status as number, msg: message } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '获取待确认匹配详情',
        description: '按 userId 获取 pending match 的成员摘要、共同偏好、当前下一步和最近破冰文案。',
      },
      params: 'notification.idParams',
      query: 'notification.matchPendingDetailQuery',
      response: {
        200: 'notification.matchPendingDetailResponse',
        400: 'notification.error',
        401: 'notification.error',
        403: 'notification.error',
        404: 'notification.error',
        500: 'notification.error',
      },
    }
  )

  // 确认待处理匹配
  .post(
    '/pending-matches/:id/confirm',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        return await confirmPendingMatch(user.id, params.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : '确认失败';
        if (/找不到/.test(message)) {
          set.status = 404;
        } else if (/只有/.test(message) || /你不在/.test(message)) {
          set.status = 403;
        } else {
          set.status = 400;
        }
        return { code: set.status as number, msg: message } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '确认待处理匹配',
        description: '由临时召集人确认 pending match，确认成功后直接转成活动。',
      },
      params: 'notification.idParams',
      response: {
        200: 'notification.matchActionResponse',
        400: 'notification.error',
        401: 'notification.error',
        403: 'notification.error',
        404: 'notification.error',
      },
    }
  )

  // 取消待处理匹配
  .post(
    '/pending-matches/:id/cancel',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        return await cancelPendingMatch(user.id, params.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : '取消失败';
        if (/找不到/.test(message)) {
          set.status = 404;
        } else if (/只有/.test(message) || /你不在/.test(message)) {
          set.status = 403;
        } else {
          set.status = 400;
        }
        return { code: set.status as number, msg: message } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Notifications'],
        summary: '取消待处理匹配',
        description: '由临时召集人取消 pending match，相关意向继续保留为 active。',
      },
      params: 'notification.idParams',
      response: {
        200: 'notification.matchActionResponse',
        400: 'notification.error',
        401: 'notification.error',
        403: 'notification.error',
        404: 'notification.error',
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

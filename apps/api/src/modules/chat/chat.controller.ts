// Chat Controller - 群聊消息接口 (MVP 简化版)
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { chatModel, ChatMessageResponseSchema, type ErrorResponse } from './chat.model';
import { getChatActivities, getMessages, sendMessage } from './chat.service';
import { handleWsUpgrade, handleWsMessage, handleWsClose, startHeartbeatChecker } from './chat.ws';
import { createReport } from '../reports/report.service';
import type { ReportReason } from '../reports/report.model';

// 启动心跳检测
startHeartbeatChecker(10000);

export const chatController = new Elysia({ prefix: '/chat' })
  .use(basePlugins)
  .use(chatModel)

  // 获取用户活动群聊列表（显式 userId）
  .get(
    '/activities',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      const { userId } = query;
      if (!userId) {
        set.status = 400;
        return {
          code: 400,
          msg: '缺少 userId 参数',
        } satisfies ErrorResponse;
      }

      if (user.role !== 'admin' && user.id !== userId) {
        set.status = 403;
        return {
          code: 403,
          msg: '无权限访问该用户群聊',
        } satisfies ErrorResponse;
      }

      const result = await getChatActivities(userId, query);
      return result;
    },
    {
      detail: {
        tags: ['Chat'],
        summary: '获取活动群聊列表',
        description: '按 userId 获取用户参与的活动群聊列表，包含最近消息预览和人数信息。',
      },
      query: 'chat.activitiesQuery',
      response: {
        200: 'chat.activitiesResponse',
        400: 'chat.error',
        401: 'chat.error',
        403: 'chat.error',
      },
    }
  )

  // 获取消息列表（轮询）
  .get(
    '/:activityId/messages',
    async ({ params, query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      try {
        const result = await getMessages(params.activityId, user.id, query);
        return result;
      } catch (error: any) {
        set.status = 400;
        return {
          code: 400,
          msg: error.message || '获取消息失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Chat'],
        summary: '获取消息列表',
        description: '获取活动群聊的消息列表，支持增量获取（轮询）。返回 isArchived 标识群聊是否已归档。',
      },
      params: 'chat.activityIdParams',
      query: 'chat.messageListQuery',
      response: {
        200: t.Object({
          messages: t.Array(ChatMessageResponseSchema),
          isArchived: t.Boolean({ description: '群聊是否已归档' }),
        }),
        400: 'chat.error',
        401: 'chat.error',
      },
    }
  )

  // 发送消息
  .post(
    '/:activityId/messages',
    async ({ params, body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      try {
        const result = await sendMessage(params.activityId, user.id, body);
        return {
          id: result.id,
          msg: '发送成功',
        };
      } catch (error: any) {
        set.status = 400;
        return {
          code: 400,
          msg: error.message || '发送消息失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Chat'],
        summary: '发送消息',
        description: '在活动群聊中发送文本消息。群聊归档后无法发送。',
      },
      params: 'chat.activityIdParams',
      body: 'chat.sendMessageRequest',
      response: {
        200: 'chat.sendMessageResponse',
        400: 'chat.error',
        401: 'chat.error',
      },
    }
  )

  // 举报消息
  .post(
    '/:activityId/report',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      try {
        await createReport({
          type: 'message',
          targetId: body.messageId,
          reason: body.reason as ReportReason,
        }, user.id);
        return { msg: '举报成功' };
      } catch (error: any) {
        set.status = 400;
        return {
          code: 400,
          msg: error.message || '举报失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Chat'],
        summary: '举报消息',
        description: '举报活动讨论区中的违规消息',
      },
      params: 'chat.activityIdParams',
      body: 'chat.reportMessageRequest',
      response: {
        200: t.Object({ msg: t.String() }),
        400: 'chat.error',
        401: 'chat.error',
      },
    }
  )

  // WebSocket 实时通讯
  .ws('/:activityId/ws', {
    body: t.String(),
    query: t.Object({
      token: t.String({ description: 'JWT Token' }),
    }),
    
    async open(ws) {
      const activityId = (ws.data as any).params?.activityId;
      const token = (ws.data as any).query?.token;
      
      if (!activityId || !token) {
        ws.close(4000, 'Missing parameters');
        return;
      }

      await handleWsUpgrade(ws as any, activityId, token);
    },

    async message(ws, message) {
      await handleWsMessage(ws as any, message);
    },

    async close(ws) {
      await handleWsClose(ws as any);
    },
  });

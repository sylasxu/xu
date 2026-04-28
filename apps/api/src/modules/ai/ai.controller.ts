// AI Controller - vNext 统一 AI Chat 接口 (GenUI Protocol)
// 只承载 AI 领域能力路由，鉴权差异通过 capability 控制，子领域通过 .use() 挂载
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth, verifyAdmin, AuthError } from '../../setup';
import { aiModel, type ErrorResponse } from './ai.model';
import {
  clearConversations,
  getTokenUsageStats,
  getTokenUsageSummary,
  getToolCallStats,
  getWelcomeCard,
  getActivityConversationMessages,
  listConversationMessages,
  listCurrentAgentTaskSnapshots,
  listUserConversations,
  markJoinTaskDiscussionEntered,
  normalizeAiProviderErrorMessage,
  recordJoinTaskAuthGateFromDomain,
  resolveCurrentTaskHomeState,
  streamAiChatResponse,
} from './ai.service';
import type { GenUIRequest } from '@xu/genui-contract';
import { db, users, activities, eq } from '@xu/db';

import { aiSessionsController } from './ai-sessions.controller';
import { aiSecurityController } from './ai-security.controller';
import { aiMetricsController } from './ai-metrics.controller';
import { configController } from './config/config.controller';
import { moderationController } from './moderation/moderation.controller';

export const aiController = new Elysia({ prefix: '/ai' })
  .use(basePlugins)
  .use(aiModel)

  // ==========================================
  // 欢迎卡片 (v3.4 新增)
  // ==========================================
  .get(
    '/welcome',
    async ({ query, jwt, headers }) => {
      // 尝试获取用户身份（可选认证）
      const authResult = await verifyAuth(jwt, headers);

      // 如果已登录，获取用户昵称
      let userId: string | null = null;
      let nickname: string | null = null;

      if (authResult) {
        userId = authResult.id;
        // 从数据库获取用户昵称
        const [user] = await db
          .select({ nickname: users.nickname })
          .from(users)
          .where(eq(users.id, authResult.id))
          .limit(1);
        nickname = user?.nickname || null;
      }

      // 解析位置参数
      const location = (query.lat !== undefined && query.lng !== undefined)
        ? { lat: query.lat, lng: query.lng }
        : null;

      // 获取欢迎卡片数据
      const welcomeCard = await getWelcomeCard(
        userId,
        nickname,
        location
      );

      return welcomeCard;
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取欢迎卡片',
        description: `获取个性化的欢迎卡片数据，包含问候语和快捷操作按钮。

支持两种模式：
- 已登录：返回个性化问候语和基于用户偏好的快捷按钮
- 未登录：返回通用问候语和默认快捷按钮

位置参数可选，传入后可生成"探索附近"按钮。`,
      },
      query: 'ai.welcomeQuery',
      response: {
        200: 'ai.welcomeResponse',
      },
    }
  )

  // ==========================================
  // 统一对话运行时入口
  // - 单一 GenUI 协议：conversationId + input + context
  // - 全链路走 Processor/Intent/RAG/Tools 工作流
  // - 始终返回 SSE 事件流
  // ==========================================
  .post(
    '/chat',
    async ({ body, set, jwt, headers, request: rawRequest }) => {
      try {
        const viewer = await verifyAuth(jwt, headers);
        const request = body as GenUIRequest;
        return await streamAiChatResponse(request, {
          viewer,
          requestAbortSignal: rawRequest.signal,
        });
      } catch (error: any) {
        if (
          error instanceof Error
          && (error.message === '无权限访问该会话' || error.message === '会话与用户不匹配')
        ) {
          set.status = 403;
          return { code: 403, msg: '无权限访问该会话' } satisfies ErrorResponse;
        }
        console.error('AI Chat 失败:', error);
        set.status = 500;
        return {
          code: 500,
          msg: normalizeAiProviderErrorMessage(error instanceof Error ? error.message : 'AI 服务暂时不可用'),
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: 'AI 对话',
        description: `统一的对话运行时入口：\n\n- 请求体固定为 conversationId + input + context\n- 全部请求统一走 Processor / Intent / RAG / Tools 主链路\n- 始终返回 GenUI SSE 事件序列\n- response-complete 事件携带完整 response envelope`,
      },
      body: 'ai.chatRequest',
    }
  )

  .post(
    '/tasks/discussion-entered',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      await markJoinTaskDiscussionEntered({
        userId: user.id,
        activityId: body.activityId,
        entry: typeof body.entry === 'string' ? body.entry : undefined,
        source: 'discussion_page',
      });

      return {
        code: 200,
        msg: '已记录进入讨论区',
      };
    },
    {
      detail: {
        tags: ['AI'],
        summary: '标记进入活动讨论区',
        description: '小程序进入讨论区后回写 join_activity 任务阶段，用于持续推进同一条 agent 任务链。',
      },
      body: 'ai.discussionEnteredRequest',
      response: {
        200: 'ai.discussionEnteredResponse',
        401: 'common.error',
      },
    }
  )

  .post(
    '/tasks/join-auth-gate',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const task = await recordJoinTaskAuthGateFromDomain({
        userId: user.id,
        activityId: body.activityId,
        activityTitle: body.activityTitle,
        startAt: body.startAt,
        locationName: body.locationName,
        entry: body.entry,
        source: body.source,
        authMode: body.authMode,
        originalText: body.originalText,
      });

      return {
        code: 200,
        msg: '已记录报名待恢复动作',
        taskId: task?.id ?? null,
      };
    },
    {
      detail: {
        tags: ['AI'],
        summary: '记录报名 Auth Gate',
        description: '活动详情页直连报名被登录或手机号闸门打断时，写入同一条 join_activity 任务，避免离开页面后丢动作。',
      },
      body: 'ai.joinAuthGateRequest',
      response: {
        200: 'ai.joinAuthGateResponse',
        401: 'common.error',
      },
    }
  )

  .get(
    '/tasks/current',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未登录' } satisfies ErrorResponse;
      }

      const items = await listCurrentAgentTaskSnapshots(user.id);
      const homeState = resolveCurrentTaskHomeState(items);

      return {
        items,
        homeState: homeState.homeState,
        primaryTaskId: homeState.primaryTaskId,
        serverTime: new Date().toISOString(),
      };
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取当前 Agent 任务',
        description: '返回当前用户仍在推进中的 agent 任务快照，用于首页持续承接“这件事现在到哪了”。',
      },
      response: {
        200: 'ai.currentTasksResponse',
        401: 'common.error',
      },
    }
  )

  // ==========================================
  // 对话历史管理 (v3.2 新增，v3.5 重构为显式参数)
  // ==========================================

  // 获取用户会话列表（分页）
  .get(
    '/conversations',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      try {
        if (user.role !== 'admin' && user.id !== query.userId) {
          set.status = 403;
          return {
            code: 403,
            msg: '无权限访问该用户会话',
          } satisfies ErrorResponse;
        }

        return await listUserConversations(query);
      } catch (error: any) {
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取会话列表失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取用户 AI 会话列表',
        description: `获取指定用户的 AI 会话列表。

- userId 必传，普通用户仅可查询本人
- 返回值固定为会话集合，不再混用消息明细`,
      },
      query: 'ai.conversationsQuery',
      response: {
        200: 'ai.conversationsResponse',
        401: 'common.error',
        403: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 获取指定会话的消息列表
  .get(
    '/conversations/:conversationId/messages',
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
        if (user.role !== 'admin' && user.id !== query.userId) {
          set.status = 403;
          return {
            code: 403,
            msg: '无权限访问该用户会话',
          } satisfies ErrorResponse;
        }

        return await listConversationMessages({
          ...query,
          conversationId: params.conversationId,
        });
      } catch (error: any) {
        if (error instanceof Error && error.message === '会话不存在') {
          set.status = 404;
          return {
            code: 404,
            msg: error.message,
          } satisfies ErrorResponse;
        }

        if (error instanceof Error && error.message === '会话与用户不匹配') {
          set.status = 403;
          return {
            code: 403,
            msg: '无权限访问该会话',
          } satisfies ErrorResponse;
        }

        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取对话消息失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取指定 AI 会话消息',
        description: `获取指定会话的消息历史。

- conversationId 通过路径显式指定
- userId 必传，普通用户仅可查询本人
- 支持按 role / messageType / cursor 分页过滤`,
      },
      params: 'ai.conversationIdParams',
      query: 'ai.conversationMessagesQuery',
      response: {
        200: 'ai.conversationMessagesResponse',
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 获取活动关联的 AI 对话消息
  .get(
    '/activities/:activityId/messages',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      const [activity] = await db
        .select({ creatorId: activities.creatorId })
        .from(activities)
        .where(eq(activities.id, params.activityId))
        .limit(1);

      if (!activity) {
        set.status = 404;
        return {
          code: 404,
          msg: '活动不存在',
        } satisfies ErrorResponse;
      }

      if (user.role !== 'admin' && activity.creatorId !== user.id) {
        set.status = 403;
        return {
          code: 403,
          msg: '无权限访问该活动的 AI 对话记录',
        } satisfies ErrorResponse;
      }

      try {
        return await getActivityConversationMessages(params.activityId);
      } catch (error: any) {
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取活动关联 AI 对话失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取活动关联 AI 对话消息',
        description: '按 activityId 获取与该活动关联的 AI 对话消息，用于查看活动创建/修改过程中的 AI 记录。',
      },
      params: 'ai.activityConversationMessageParams',
      response: {
        200: 'ai.activityConversationMessagesResponse',
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 清空对话历史（开始新对话）
  .delete(
    '/conversations',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      try {
        const result = await clearConversations(user.id);
        return {
          success: true as const,
          msg: '对话已清空',
          deletedCount: result.deletedCount,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '清空对话失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '清空对话历史',
        description: '清空当前用户的所有对话历史，开始新对话。',
      },
      response: {
        200: 'ai.clearConversationsResponse',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // ==========================================
  // Admin 路由（通过 capability 鉴权）
  // ==========================================
  .guard(
    {
      async beforeHandle({ jwt, headers, set }) {
        try {
          await verifyAdmin(jwt, headers);
        } catch (error) {
          if (error instanceof AuthError) {
            set.status = error.status;
            return { code: error.status, msg: error.message } satisfies ErrorResponse;
          }
        }
      },
    },
    (app) => app
      // Token 使用统计 (v3.4 新增)
      .get(
        '/metrics/usage',
        async ({ query }) => {
          // 解析日期范围，默认最近 30 天
          const endDate = query.endDate
            ? new Date(query.endDate + 'T23:59:59')
            : new Date();
          const startDate = query.startDate
            ? new Date(query.startDate + 'T00:00:00')
            : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

          const [summary, daily, toolCalls] = await Promise.all([
            getTokenUsageSummary(startDate, endDate),
            getTokenUsageStats(startDate, endDate),
            getToolCallStats(startDate, endDate),
          ]);

          return { summary, daily, toolCalls };
        },
        {
          detail: {
            tags: ['AI'],
            summary: '获取 Token 使用统计',
            description: `获取 AI Token 使用统计数据（Admin 用）。

返回内容：
- summary: 汇总数据（总请求数、总 Token 数、平均每次请求 Token 数）
- daily: 每日统计数据
- toolCalls: Tool 调用统计`,
          },
          query: 'ai.metricsUsageQuery',
          response: {
            200: 'ai.metricsUsageResponse',
          },
        }
      )

  )

  // ==========================================
  // 挂载子领域 controller
  // ==========================================
  .use(configController)
  .use(moderationController)
  .use(aiSessionsController)
  .use(aiSecurityController)
  .use(aiMetricsController);

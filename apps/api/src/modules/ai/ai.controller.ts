// AI Controller - vNext 统一 AI Chat 接口 (GenUI Protocol)
// 只承载 AI 领域能力路由，鉴权差异通过 capability 控制，子领域通过 .use() 挂载
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth, verifyAdmin, AuthError } from '../../setup';
import { aiModel, type ErrorResponse } from './ai.model';
import {
  clearConversations,
  getWelcomeCard,
  listUserConversations,
  listConversationMessages,
  getActivityConversationMessages,
  addMessageToConversation,
  getOrCreateCurrentConversation,
  syncConversationTurnSnapshot,
} from './ai.service';
import { getSystemPrompt, getPromptTemplateConfig, getPromptTemplateMetadata } from './prompts';
import {
  getTokenUsageStats,
  getTokenUsageSummary,
  getToolCallStats,
} from './observability/metrics';
import {
  listCurrentAgentTaskSnapshots,
  syncCreateTaskFromChatTurn,
  markJoinTaskDiscussionEntered,
  syncPartnerTaskFromChatTurn,
  syncJoinTaskFromChatTurn,
} from './task-runtime/agent-task.service';
import type { GenUIRequest } from '@juchang/genui-contract';
import { db, users, activities, eq } from '@juchang/db';
import {
  buildAiChatTurn,
  createAiChatBridgeStreamResponse,
} from './ai-chat-gateway.service';
import { applyAiChatTurnPolicies } from './ai-chat-policy.service';
import { normalizeAiProviderErrorMessage } from './models/provider-error';

// 子领域 controller
import { aiSessionsController } from './ai-sessions.controller';
import { aiRagController } from './ai-rag.controller';
import { aiMemoryController } from './ai-memory.controller';
import { aiSecurityController } from './ai-security.controller';
import { aiMetricsController } from './ai-metrics.controller';

function resolveConversationUserText(input: GenUIRequest['input']): string {
  if (input.type === 'text') {
    return input.text.trim();
  }

  if (typeof input.displayText === 'string' && input.displayText.trim()) {
    return input.displayText.trim();
  }

  const params = input.params && typeof input.params === 'object' ? input.params : null;
  const candidates = params
    ? [params.location, params.value, params.activityType, params.type, params.slot, params.title]
    : [];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return input.action.trim();
}

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
  // 统一 AI Chat Gateway
  // - 单一 GenUI 协议：conversationId + input + context (+ stream)
  // - 全链路走 Processor/Intent/RAG/Tools 工作流
  // ==========================================
  .post(
    '/chat',
    async ({ body, set, jwt, headers, request: rawRequest }) => {
      try {
        const viewer = await verifyAuth(jwt, headers);
        const request = body as GenUIRequest & { stream?: boolean };

        if (request.stream) {
          return createAiChatBridgeStreamResponse(request, {
            viewer,
            requestAbortSignal: rawRequest.signal,
          });
        }

        const result = await buildAiChatTurn(request, { viewer });
        const normalized = applyAiChatTurnPolicies({
          request,
          viewer,
          envelope: result.envelope,
          traces: result.traces,
          resolvedStructuredAction: result.resolvedStructuredAction,
          executionPath: result.executionPath,
        });
        const responseTraces = [
          ...normalized.traces,
          {
            stage: 'controller_response_ready',
            detail: {
              executionPath: result.executionPath,
              structuredAction: result.resolvedStructuredAction?.action || null,
              stream: false,
              authenticated: !!viewer,
              blockCount: normalized.envelope.turn.blocks.length,
            },
          },
        ];

        if (viewer) {
          await syncJoinTaskFromChatTurn({
            userId: viewer.id,
            conversationId: normalized.envelope.conversationId,
            request,
            blocks: normalized.envelope.turn.blocks,
          });
          await syncPartnerTaskFromChatTurn({
            userId: viewer.id,
            conversationId: normalized.envelope.conversationId,
            request,
            blocks: normalized.envelope.turn.blocks,
          });
          await syncCreateTaskFromChatTurn({
            userId: viewer.id,
            conversationId: normalized.envelope.conversationId,
            request,
            blocks: normalized.envelope.turn.blocks,
          });
          await syncConversationTurnSnapshot({
            conversationId: normalized.envelope.conversationId,
            userId: viewer.id,
            userText: resolveConversationUserText(request.input),
            blocks: normalized.envelope.turn.blocks,
            turnId: normalized.envelope.turn.turnId,
            traceId: normalized.envelope.traceId,
            inputType: request.input.type,
            resolvedStructuredAction: result.resolvedStructuredAction,
            activityId: typeof request.context?.activityId === 'string' ? request.context.activityId : undefined,
          });
        }

        return normalized.envelope;
      } catch (error: any) {
        if (error instanceof Error && error.message === '无权限访问该会话') {
          set.status = 403;
          return { code: 403, msg: error.message } satisfies ErrorResponse;
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
        summary: 'AI 对话（Chat Gateway）',
        description: `统一的 GenUI Chat 网关：\n\n- 请求体固定为 conversationId + input + context\n- 全部请求统一走 AI Workflow（Processor/Intent/RAG/Tools）\n- stream=false 返回 GenUI turn envelope\n- stream=true 返回 GenUI SSE 事件序列`,
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
        401: 'ai.error',
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

      return {
        items: await listCurrentAgentTaskSnapshots(user.id),
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
        401: 'ai.error',
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
        401: 'ai.error',
        403: 'ai.error',
        500: 'ai.error',
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
        401: 'ai.error',
        403: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
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
        401: 'ai.error',
        403: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 添加用户消息
  .post(
    '/conversations',
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
        // 获取或创建当前会话
        const { id: conversationId } = await getOrCreateCurrentConversation(user.id);

        // 添加消息到会话
        const result = await addMessageToConversation({
          conversationId,
          userId: user.id,
          role: 'user',
          messageType: 'text',
          content: { text: body.content },
        });

        return {
          success: true as const,
          msg: '消息已添加',
          id: result.id,
        };
      } catch (error: any) {
        set.status = 400;
        return {
          code: 400,
          msg: error.message || '添加消息失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '添加用户消息到对话',
        description: '将用户发送的文本消息添加到对话历史中。',
      },
      body: 'ai.addMessageRequest',
      response: {
        200: 'ai.addMessageResponse',
        400: 'ai.error',
        401: 'ai.error',
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
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // AI 内容生成
  // ==========================================
  .post(
    '/generate/content',
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
        const { generateContent } = await import('./ai.service');
        const result = await generateContent(body);
        return result;
      } catch (error: any) {
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '生成失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: 'AI 生成内容',
        description: '根据主题生成海报文案、小红书笔记等社交媒体内容。',
      },
      body: 'ai.contentGenerationRequest',
      response: {
        200: 'ai.contentGenerationResponse',
        401: 'ai.error',
        500: 'ai.error',
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
            return { code: error.status, msg: error.message };
          }
        }
      },
    },
    (app) => app
      // DeepSeek 余额查询 (Admin Playground 用)
      .get(
        '/balance',
        async ({ set }) => {
          const apiKey = process.env.DEEPSEEK_API_KEY;

          if (!apiKey) {
            set.status = 500;
            return { code: 500, msg: 'DeepSeek API Key 未配置' };
          }

          try {
            const response = await fetch('https://api.deepseek.com/user/balance', {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!response.ok) {
              set.status = response.status;
              return { code: response.status, msg: '余额查询失败' };
            }

            const data = await response.json();
            return data;
          } catch (error: any) {
            set.status = 500;
            return { code: 500, msg: error.message || '余额查询失败' };
          }
        },
        {
          detail: {
            tags: ['AI'],
            summary: '查询 DeepSeek 余额',
            description: '查询 DeepSeek API 账户余额（Admin Playground 用）',
          },
          response: {
            200: t.Object({
              is_available: t.Boolean(),
              balance_infos: t.Array(t.Object({
                currency: t.String(),
                total_balance: t.String(),
                granted_balance: t.String(),
                topped_up_balance: t.String(),
              })),
            }),
            500: 'ai.error',
          },
        }
      )

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

      // Prompt 查看（DB 必需配置）
      .get(
        '/prompts/current',
        async () => {
          const promptConfig = await getPromptTemplateConfig();
          const metadata = getPromptTemplateMetadata(promptConfig);
          const content = await getSystemPrompt({
            currentTime: new Date(),
            userLocation: { lat: 29.5630, lng: 106.5516, name: '观音桥' },
            userNickname: '示例用户',
          });

          return {
            version: metadata.version,
            description: metadata.description,
            lastModified: metadata.lastModified,
            features: metadata.features,
            content,
          };
        },
        {
          detail: {
            tags: ['AI'],
            summary: '获取当前 System Prompt',
            description: `获取当前激活的 System Prompt 信息（Admin 用）。

Prompt 存储于 ai_configs 中，此接口返回当前生效模板。
缺少关键配置时服务会在启动阶段直接失败，避免静默降级。`,
          },
          response: {
            200: 'ai.promptInfoResponse',
          },
        }
      )
  )

  // ==========================================
  // 挂载子领域 controller
  // ==========================================
  .use(aiSessionsController)
  .use(aiRagController)
  .use(aiMemoryController)
  .use(aiSecurityController)
  .use(aiMetricsController);

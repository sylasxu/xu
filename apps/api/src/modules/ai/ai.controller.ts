// AI Controller - vNext 统一 AI Chat 接口 (GenUI Protocol)
// 瘦身后只保留用户端路由 + 少量 Admin 路由，子领域通过 .use() 挂载
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth, verifyAdmin, AuthError } from '../../setup';
import { aiModel, type ErrorResponse, type ConversationMessageType } from './ai.model';
import {
  checkAIQuota,
  consumeAIQuota,
  clearConversations,
  getWelcomeCard,
  // v3.8：两层会话结构
  listConversations,
  getMessagesByActivityId,
  addMessageToConversation,
  getOrCreateCurrentConversation,
} from './ai.service';
import { getSystemPrompt, FALLBACK_METADATA } from './prompts';
import {
  getTokenUsageStats,
  getTokenUsageSummary,
  getToolCallStats,
} from './observability/metrics';
import type { GenUIRequest } from '@juchang/genui-contract';
import { db, users, eq } from '@juchang/db';
import {
  buildAiChatTurn,
  buildAiChatStreamEvents,
  createAiChatSSEStreamResponse,
} from './ai-chat-gateway.service';
import { applyAiChatTurnPolicies } from './ai-chat-policy.service';

// 子领域 controller
import { aiSessionsController } from './ai-sessions.controller';
import { aiRagController } from './ai-rag.controller';
import { aiMemoryController } from './ai-memory.controller';
import { aiSecurityController } from './ai-security.controller';
import { aiMetricsController } from './ai-metrics.controller';

const chatInputTextSchema = t.Object({
  type: t.Literal('text'),
  text: t.String(),
});

const chatInputActionSchema = t.Object({
  type: t.Literal('action'),
  action: t.String(),
  actionId: t.String(),
  params: t.Optional(t.Record(t.String(), t.Any())),
  displayText: t.Optional(t.String()),
});

const chatContextSchema = t.Optional(
  t.Object(
    {
      client: t.Optional(
        t.Union([t.Literal('web'), t.Literal('miniprogram'), t.Literal('admin')])
      ),
      locale: t.Optional(t.String()),
      timezone: t.Optional(t.String()),
      platformVersion: t.Optional(t.String()),
      lat: t.Optional(t.Number()),
      lng: t.Optional(t.Number()),
    },
    { additionalProperties: true }
  )
);

const chatBodySchema = t.Object(
  {
    conversationId: t.Optional(t.String()),
    input: t.Union([chatInputTextSchema, chatInputActionSchema]),
    context: chatContextSchema,
    stream: t.Optional(t.Boolean()),
  },
  { additionalProperties: true }
);

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
    async ({ body, set, jwt, headers }) => {
      try {
        const viewer = await verifyAuth(jwt, headers);
        const request = body as GenUIRequest & { stream?: boolean };
        const client = request.context?.client;

        const shouldConsumeQuota = Boolean(viewer) && client !== 'admin' && viewer?.role !== 'admin';
        if (shouldConsumeQuota && viewer) {
          const quota = await checkAIQuota(viewer.id);
          if (!quota.hasQuota) {
            set.status = 403;
            return { code: 403, msg: 'AI 额度不足，今日已用完' } satisfies ErrorResponse;
          }

          const consumed = await consumeAIQuota(viewer.id);
          if (!consumed) {
            set.status = 403;
            return { code: 403, msg: 'AI 额度扣减失败' } satisfies ErrorResponse;
          }
        }

        const result = await buildAiChatTurn(request, { viewer });
        const normalized = applyAiChatTurnPolicies({
          request,
          viewer,
          envelope: result.envelope,
          traces: result.traces,
        });

        if (request.stream) {
          const events = buildAiChatStreamEvents(normalized.envelope, normalized.traces);
          return createAiChatSSEStreamResponse(events);
        }

        return normalized.envelope;
      } catch (error: any) {
        console.error('AI Chat 失败:', error);
        if (error instanceof Error && error.message === '无权限访问该会话') {
          set.status = 403;
          return { code: 403, msg: error.message } satisfies ErrorResponse;
        }
        set.status = 500;
        return { code: 500, msg: error.message || 'AI 服务暂时不可用' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: 'AI 对话（Chat Gateway）',
        description: `统一的 GenUI Chat 网关：\n\n- 请求体固定为 conversationId + input + context\n- 全部请求统一走 AI Workflow（Processor/Intent/RAG/Tools）\n- stream=false 返回 GenUI turn envelope\n- stream=true 返回 GenUI SSE 事件序列`,
      },
      body: chatBodySchema,
    }
  )

  // ==========================================
  // 对话历史管理 (v3.2 新增，v3.5 重构为显式参数)
  // ==========================================

  // 获取对话历史（分页）
  // 显式参数模式：
  // - userId：按用户 ID 查询该用户会话
  // - activityId：按活动 ID 查询关联消息
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

      const { userId, activityId } = query;

      try {
        // 如果指定了 activityId，查询关联此活动的消息
        if (activityId) {
          const result = await getMessagesByActivityId(activityId);
          return {
            items: result.items.map(m => ({
              id: m.id,
              userId: m.userId,
              userNickname: m.userNickname,
              role: m.role,
              type: m.messageType as ConversationMessageType,
              content: m.content,
              activityId: activityId,
              createdAt: m.createdAt,
            })),
            total: result.total,
            hasMore: false,
            cursor: null,
          };
        }

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
            msg: '无权限访问该用户会话',
          } satisfies ErrorResponse;
        }

        const result = await listConversations({ userId, limit: query.limit });
        return {
          items: result.items,
          total: result.total,
          hasMore: false,
          cursor: null,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取对话历史失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取 AI 对话历史',
        description: `获取对话历史，使用显式 ID 参数：
- userId 参数：获取指定用户的对话（普通用户仅可查本人）
- activityId 参数：获取关联某活动的对话消息`,
      },
      query: 'ai.conversationsQuery',
      response: {
        200: 'ai.conversationsResponse',
        400: 'ai.error',
        403: 'ai.error',
        401: 'ai.error',
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
  // AI 内容生成 (从 Growth 迁移)
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
        description: '根据主题生成海报文案、小红书笔记等社交媒体内容。从 Growth 模块迁移。',
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

      // Prompt 查看 (v3.6 - 代码即配置)
      .get(
        '/prompts/current',
        async () => {
          const content = await getSystemPrompt({
            currentTime: new Date(),
            userLocation: { lat: 29.5630, lng: 106.5516, name: '观音桥' },
            userNickname: '示例用户',
          });

          return {
            version: FALLBACK_METADATA.version,
            description: FALLBACK_METADATA.description,
            lastModified: FALLBACK_METADATA.lastModified,
            features: FALLBACK_METADATA.features,
            content,
          };
        },
        {
          detail: {
            tags: ['AI'],
            summary: '获取当前 System Prompt',
            description: `获取当前激活的 System Prompt 信息（Admin 用）。

Prompt 通过 Git 版本控制，此接口为只读查看。
修改 Prompt 需要通过代码提交。`,
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

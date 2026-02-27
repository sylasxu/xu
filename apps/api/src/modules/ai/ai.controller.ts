// AI Controller - v3.4 统一 AI Chat 接口 (Data Stream Protocol)
// 瘦身后只保留用户端路由 + 少量 Admin 路由，子领域通过 .use() 挂载
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth, verifyAdmin, AuthError } from '../../setup';
import { aiModel, type ErrorResponse, type ConversationMessageType } from './ai.model';
import {
  checkAIQuota,
  consumeAIQuota,
  handleChatStream,
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
import { db, users, eq } from '@juchang/db';

// 子领域 controller
import { aiSessionsController } from './ai-sessions.controller';
import { aiRagController } from './ai-rag.controller';
import { aiMemoryController } from './ai-memory.controller';
import { aiSecurityController } from './ai-security.controller';
import { aiOpsController } from './ai-ops.controller';

/**
 * Message Part Schema
 * AI SDK v6 的 UIMessage.parts 包含多种类型：
 * - text: 文本内容
 * - step-start: 步骤开始标记
 * - tool-{toolName}: 动态 Tool UI 部分
 * - tool-invocation: Tool 调用（旧格式）
 * 
 * 使用宽松的 schema 接受所有格式，API 层只需要提取有用信息
 */
const messagePartSchema = t.Object({
  type: t.String(),
}, { additionalProperties: true });

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
  // 统一 AI Chat 接口 - Data Stream Protocol
  // 小程序和 Admin 都用这个接口
  // ==========================================
  .post(
    '/chat',
    async ({ body, set, jwt, headers }) => {
      // 解析请求参数
      const { messages: rawMessages, source = 'miniprogram', mockUserId, mockLocation, trace } = body;

      // 直接传递消息给 service，让 AI SDK 的 convertToModelMessages 处理格式转换
      // 支持两种格式：
      // 1. 简单格式：{ role, content }
      // 2. Parts 格式：{ role, content, parts: [...] }（AI SDK UIMessage 格式）
      const messages = rawMessages.map(m => ({
        role: m.role,
        content: m.content || m.text || '',
        ...(m.parts && { parts: m.parts }),
      }));

      // 获取用户身份
      const user = await verifyAuth(jwt, headers);

      // Admin 可以 mock 用户（用于测试）
      const effectiveUserId = (source === 'admin' && mockUserId) ? mockUserId : user?.id || null;
      const effectiveLocation = mockLocation || body.location;

      // 有真实用户时检查额度（Admin 不消耗额度）
      if (user && source !== 'admin') {
        const quota = await checkAIQuota(user.id);
        if (!quota.hasQuota) {
          set.status = 403;
          return { code: 403, msg: 'AI 额度不足，今日已用完' } satisfies ErrorResponse;
        }

        const consumed = await consumeAIQuota(user.id);
        if (!consumed) {
          set.status = 403;
          return { code: 403, msg: 'AI 额度扣减失败' } satisfies ErrorResponse;
        }
      }

      try {
        // 获取 Data Stream Response (v3.7 支持模型参数, v4.7 支持 userAction)
        const response = await handleChatStream({
          messages: messages as any, // AI SDK UIMessage 格式
          userId: effectiveUserId,
          location: effectiveLocation,
          source,
          draftContext: body.draftContext,
          trace: trace ?? false,
          modelParams: body.modelParams,
          userAction: body.userAction as any,
        });

        return response;
      } catch (error: any) {
        console.error('AI Chat 失败:', error);
        set.status = 500;
        return { code: 500, msg: error.message || 'AI 服务暂时不可用' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: 'AI 对话（Data Stream）',
        description: `统一的 AI 对话接口，返回 Vercel AI SDK Data Stream 格式。
        
小程序和 Admin 都使用此接口：
- 小程序：传 JWT Token，正常消耗额度
- Admin：传 source='admin'，可 mock 用户测试，不消耗额度

v3.5 新增：
- trace：执行追踪，返回详细的执行步骤数据

Data Stream 格式：
- 0:"text" - 文本增量
- 9:{...} - Tool Call
- a:{...} - Tool Result  
- d:{...} - 完成信息（含 usage）`,
      },
      body: t.Object({
        messages: t.Array(t.Object({
          role: t.Union([t.Literal('user'), t.Literal('assistant')]),
          // 支持 content 或 text（简单文本格式）
          content: t.Optional(t.String()),
          text: t.Optional(t.String()),
          // 支持 parts 格式（包含 Tool 调用历史）
          parts: t.Optional(t.Array(messagePartSchema)),
        }, { additionalProperties: true })), // AI SDK 会添加 id 等字段
        location: t.Optional(t.Tuple([t.Number(), t.Number()])),
        source: t.Optional(t.Union([t.Literal('miniprogram'), t.Literal('admin')])),
        mockUserId: t.Optional(t.String()),
        mockLocation: t.Optional(t.Tuple([t.Number(), t.Number()])),
        // 草稿上下文
        draftContext: t.Optional(t.Object({
          activityId: t.String(),
          currentDraft: t.Object({
            title: t.String(),
            type: t.String(),
            locationName: t.String(),
            locationHint: t.String(),
            startAt: t.String(),
            maxParticipants: t.Number(),
          }),
        })),
        // v3.5 新增：执行追踪
        trace: t.Optional(t.Boolean({
          default: false,
          description: '是否返回执行追踪数据（Admin Playground 调试用）'
        })),
        // v3.7 新增：模型参数
        modelParams: t.Optional(t.Object({
          temperature: t.Optional(t.Number({ minimum: 0, maximum: 2, description: '温度参数，0-2' })),
          maxTokens: t.Optional(t.Number({ minimum: 1, maximum: 8192, description: '最大输出 Token 数' })),
        })),
        // v4.7 新增：A2UI 结构化用户操作
        userAction: t.Optional(t.Object({
          action: t.String({ description: 'Action 类型，如 join_activity, explore_nearby' }),
          payload: t.Record(t.String(), t.Any(), { description: 'Action 参数' }),
          source: t.Optional(t.String({ description: '来源 Widget 类型' })),
          originalText: t.Optional(t.String({ description: '原始文本（用于回退）' })),
        }, { description: '结构化用户操作，跳过 LLM 意图识别直接执行' })),
      }, { additionalProperties: true }), // AI SDK useChat 会添加 id, trigger 等字段
    }
  )

  // ==========================================
  // 对话历史管理 (v3.2 新增，v3.5 重构为显式参数)
  // ==========================================

  // 获取对话历史（分页）
  // 支持显式的 scope 参数区分模式：
  // - scope=mine（默认）：查当前用户的对话
  // - scope=all：查所有用户的对话（需 Admin 权限）
  // - userId 参数：查指定用户的对话（需 Admin 权限）
  // - activityId 参数：查关联某活动的对话消息
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

      const { scope = 'mine', userId, activityId } = query;

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

        // 如果指定了 userId，Admin 查指定用户的对话
        if (userId) {
          // TODO: 添加 Admin 角色验证
          const result = await listConversations({ userId, limit: query.limit });
          return {
            items: result.items,
            total: result.total,
            hasMore: false,
            cursor: null,
          };
        }

        // scope=all：Admin 查所有用户的对话
        if (scope === 'all') {
          // TODO: 添加 Admin 角色验证
          const result = await listConversations({ limit: query.limit });
          return {
            items: result.items,
            total: result.total,
            hasMore: false,
            cursor: null,
          };
        }

        // scope=mine（默认）：查当前用户的对话
        const result = await listConversations({ userId: user.id, limit: query.limit });
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
        description: `获取对话历史，支持显式的 scope 参数区分模式：
- scope=mine（默认）：获取当前用户的对话
- scope=all：获取所有用户的对话（需 Admin 权限）
- userId 参数：获取指定用户的对话（需 Admin 权限）
- activityId 参数：获取关联某活动的对话消息`,
      },
      query: 'ai.conversationsQuery',
      response: {
        200: 'ai.conversationsResponse',
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
  // Admin 路由（需要 verifyAdmin 权限）
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
  .use(aiOpsController);

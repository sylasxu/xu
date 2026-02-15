// AI Controller - v3.4 统一 AI Chat 接口 (Data Stream Protocol)
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { aiModel, type ErrorResponse, type ConversationMessageType } from './ai.model';
import {
  checkAIQuota,
  consumeAIQuota,
  handleChatStream,
  clearConversations,
  getWelcomeCard,
  // v3.8：两层会话结构
  listConversations,
  getConversationMessages,
  deleteConversation,
  deleteConversationsBatch,
  getMessagesByActivityId,
  addMessageToConversation,
  getOrCreateCurrentConversation,
  // v4.6: 会话评估
  evaluateConversation,
} from './ai.service';
import { getPromptInfo, buildXmlSystemPrompt } from './prompts/xiaoju-v38';
import {
  getTokenUsageStats,
  getTokenUsageSummary,
  getToolCallStats,
} from './observability/metrics';
import { db, users, eq } from '@juchang/db';
// v4.5 AI Ops 运营 API
import {
  // RAG
  getRagStats,
  testRagSearch,
  rebuildActivityIndex,
  startBackfill,
  getBackfillStatus,
  // Memory
  getUserMemoryProfile,
  searchUsers,
  testMaxSim,
  // Security
  getSecurityOverview,
  getSensitiveWords,
  addSensitiveWord,
  deleteSensitiveWord,
  importSensitiveWords,
  getModerationQueue,
  approveModeration,
  rejectModeration,
  banModeration,
  getViolationStats,
  // v4.6 Quality & Conversion Metrics
  getQualityMetrics,
  getConversionMetrics,
  getPlaygroundStats,
  // v4.6 Security Persistence
  getSensitiveWordsFromDB,
  addSensitiveWordToDB,
  deleteSensitiveWordFromDB,
  getSecurityEvents,
  getSecurityStatsFromDB,
  // v4.6: AI 健康度
  getAIHealthMetrics,
} from './ai-ops.service';

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
  // DeepSeek 余额查询 (Admin Playground 用)
  // ==========================================
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
          return { error: 'AI 额度不足，今日已用完' };
        }

        const consumed = await consumeAIQuota(user.id);
        if (!consumed) {
          set.status = 403;
          return { error: 'AI 额度扣减失败' };
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
        return { error: error.message || 'AI 服务暂时不可用' };
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
            items: [],
            total: result.total,
            hasMore: false,
            cursor: null,
            sessions: result.items,
          };
        }

        // scope=all：Admin 查所有用户的对话
        if (scope === 'all') {
          // TODO: 添加 Admin 角色验证
          const result = await listConversations({ limit: query.limit });
          return {
            items: [],
            total: result.total,
            hasMore: false,
            cursor: null,
            sessions: result.items,
          };
        }

        // scope=mine（默认）：查当前用户的对话
        const result = await listConversations({ userId: user.id, limit: query.limit });
        return {
          items: [],
          total: result.total,
          hasMore: false,
          cursor: null,
          sessions: result.items,
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
          id: result.id,
          msg: '消息已添加',
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
          success: true,
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
  // Token 使用统计 (v3.4 新增)
  // ==========================================
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

  // ==========================================
  // Prompt 查看 (v3.6 - 代码即配置)
  // ==========================================
  .get(
    '/prompts/current',
    async () => {
      const info = getPromptInfo();
      const content = buildXmlSystemPrompt({
        currentTime: new Date(),
        userLocation: { lat: 29.5630, lng: 106.5516, name: '观音桥' },
        userNickname: '示例用户',
      });

      return {
        ...info,
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

  // ==========================================
  // 会话列表 v3.8 (Admin 对话审计用)
  // v4.6: 支持评估状态筛选
  // ==========================================
  .get(
    '/sessions',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await listConversations({
          page: query.page,
          limit: query.limit,
          userId: query.userId,
          // v4.6: 评估筛选
          evaluationStatus: query.evaluationStatus as 'unreviewed' | 'good' | 'bad' | undefined,
          hasError: query.hasError,
        });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取会话列表失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取会话列表',
        description: `获取所有会话列表（Admin 对话审计用）。每个会话代表一次完整的用户与 AI 的交互。

v4.6 新增筛选：
- evaluationStatus: 按评估状态筛选 (unreviewed/good/bad)
- hasError: 按是否有错误筛选`,
      },
      query: t.Object({
        page: t.Optional(t.Number({ minimum: 1, default: 1 })),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 1000, default: 20 })),
        userId: t.Optional(t.String({ description: '按用户 ID 筛选' })),
        // v4.6: 评估筛选
        evaluationStatus: t.Optional(t.Union([
          t.Literal('unreviewed'),
          t.Literal('good'),
          t.Literal('bad'),
        ], { description: '按评估状态筛选' })),
        hasError: t.Optional(t.Boolean({ description: '按是否有错误筛选' })),
      }),
      response: {
        200: t.Object({
          items: t.Array(t.Object({
            id: t.String(),
            userId: t.String(),
            userNickname: t.Union([t.String(), t.Null()]),
            title: t.Union([t.String(), t.Null()]),
            messageCount: t.Number(),
            lastMessageAt: t.String(),
            createdAt: t.String(),
            // v4.6: 评估字段
            evaluationStatus: t.Union([
              t.Literal('unreviewed'),
              t.Literal('good'),
              t.Literal('bad'),
            ]),
            evaluationTags: t.Array(t.String()),
            evaluationNote: t.Union([t.String(), t.Null()]),
            hasError: t.Boolean(),
          })),
          total: t.Number(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取会话详情（消息列表）
  .get(
    '/sessions/:id',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await getConversationMessages(params.id);
        if (!result.conversation) {
          set.status = 404;
          return { code: 404, msg: '会话不存在' } satisfies ErrorResponse;
        }
        return {
          conversation: result.conversation,
          messages: result.messages,
        };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取会话详情失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '获取会话详情',
        description: '获取指定会话的所有消息（Admin 对话审计用）。',
      },
      params: t.Object({
        id: t.String({ description: '会话 ID' }),
      }),
      response: {
        200: t.Object({
          conversation: t.Object({
            id: t.String(),
            userId: t.String(),
            userNickname: t.Union([t.String(), t.Null()]),
            title: t.Union([t.String(), t.Null()]),
            messageCount: t.Number(),
            lastMessageAt: t.String(),
            createdAt: t.String(),
            // v4.6: 评估字段
            evaluationStatus: t.Union([
              t.Literal('unreviewed'),
              t.Literal('good'),
              t.Literal('bad'),
            ]),
            evaluationTags: t.Array(t.String()),
            evaluationNote: t.Union([t.String(), t.Null()]),
            hasError: t.Boolean(),
          }),
          messages: t.Array(t.Object({
            id: t.String(),
            role: t.Union([t.Literal('user'), t.Literal('assistant')]),
            messageType: t.String(),
            content: t.Any(),
            activityId: t.Union([t.String(), t.Null()]),
            createdAt: t.String(),
          })),
        }),
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // v4.6: 会话评估 (Admin Command Center)
  // ==========================================
  .patch(
    '/sessions/:id/evaluate',
    async ({ params, body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await evaluateConversation({
          conversationId: params.id,
          status: body.status,
          tags: body.tags,
          note: body.note,
        });

        if (!result) {
          set.status = 404;
          return { code: 404, msg: '会话不存在' } satisfies ErrorResponse;
        }

        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '评估失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '评估会话',
        description: `标记会话为 Good/Bad Case（Admin 对话审计用）。

Bad Case 标签可选值：
- wrong_intent: 意图识别错误
- hallucination: AI 幻觉
- tool_error: Tool 调用错误
- bad_tone: 语气不当
- incomplete: 回复不完整`,
      },
      params: t.Object({
        id: t.String({ description: '会话 ID' }),
      }),
      body: t.Object({
        status: t.Union([t.Literal('good'), t.Literal('bad')], { description: '评估状态' }),
        tags: t.Optional(t.Array(t.String(), { description: 'Bad Case 标签' })),
        note: t.Optional(t.String({ description: '人工备注' })),
      }),
      response: {
        200: t.Object({
          id: t.String(),
          userId: t.String(),
          userNickname: t.Union([t.String(), t.Null()]),
          title: t.Union([t.String(), t.Null()]),
          messageCount: t.Number(),
          lastMessageAt: t.String(),
          createdAt: t.String(),
          evaluationStatus: t.Union([
            t.Literal('unreviewed'),
            t.Literal('good'),
            t.Literal('bad'),
          ]),
          evaluationTags: t.Array(t.String()),
          evaluationNote: t.Union([t.String(), t.Null()]),
          hasError: t.Boolean(),
        }),
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 删除单个会话（Admin 用）
  .delete(
    '/sessions/:id',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const deleted = await deleteConversation(params.id);
        if (!deleted) {
          set.status = 404;
          return { code: 404, msg: '会话不存在' } satisfies ErrorResponse;
        }
        return { success: true, msg: '会话已删除' };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '删除会话失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '删除会话',
        description: '删除指定会话及其所有消息（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '会话 ID' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          msg: t.String(),
        }),
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 批量删除会话（Admin 用）
  .post(
    '/sessions/batchDelete',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await deleteConversationsBatch(body.ids);
        return { success: true, deletedCount: result.deletedCount };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '批量删除失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI'],
        summary: '批量删除会话',
        description: '批量删除多个会话及其所有消息（Admin 用）。',
      },
      body: t.Object({
        ids: t.Array(t.String(), { description: '要删除的会话 ID 列表' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          deletedCount: t.Number(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // RAG 运营 API (v4.5)
  // ==========================================

  // 获取 RAG 统计信息
  .get(
    '/rag/stats',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const stats = await getRagStats();
        return stats;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取 RAG 统计失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取 RAG 统计信息',
        description: '获取 RAG 索引覆盖率、未索引活动列表等统计信息（Admin 用）。',
      },
      response: {
        200: t.Object({
          totalActivities: t.Number(),
          indexedActivities: t.Number(),
          coverageRate: t.Number(),
          embeddingModel: t.String(),
          embeddingDimensions: t.Number(),
          lastIndexedAt: t.Union([t.String(), t.Null()]),
          unindexedActivities: t.Array(t.Object({
            id: t.String(),
            title: t.String(),
            createdAt: t.String(),
          })),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // RAG 搜索测试
  .post(
    '/rag/search',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await testRagSearch(body);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || 'RAG 搜索测试失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: 'RAG 搜索测试',
        description: '执行语义搜索测试，返回搜索结果和性能指标（Admin 用）。',
      },
      body: t.Object({
        query: t.String({ description: '搜索查询' }),
        lat: t.Optional(t.Number({ description: '纬度' })),
        lng: t.Optional(t.Number({ description: '经度' })),
        radiusKm: t.Optional(t.Number({ default: 5, description: '搜索半径（公里）' })),
        userId: t.Optional(t.String({ description: '用户 ID（用于 MaxSim 测试）' })),
        limit: t.Optional(t.Number({ default: 20, description: '返回数量限制' })),
      }),
      response: {
        200: t.Object({
          results: t.Array(t.Object({
            activityId: t.String(),
            title: t.String(),
            type: t.String(),
            locationName: t.String(),
            startAt: t.String(),
            similarity: t.Number(),
            distance: t.Union([t.Number(), t.Null()]),
            finalScore: t.Number(),
            maxSimBoost: t.Number(),
          })),
          performance: t.Object({
            embeddingTimeMs: t.Number(),
            searchTimeMs: t.Number(),
            totalTimeMs: t.Number(),
          }),
          query: t.String(),
          totalResults: t.Number(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 重建单个活动索引
  .post(
    '/rag/rebuild/:id',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await rebuildActivityIndex(params.id);
        if (!result.success) {
          set.status = 400;
          return { code: 400, msg: result.error || '重建索引失败' } satisfies ErrorResponse;
        }
        return { success: true, msg: '索引重建成功' };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '重建索引失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '重建单个活动索引',
        description: '重新生成指定活动的向量索引（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '活动 ID' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          msg: t.String(),
        }),
        400: 'ai.error',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 开始批量回填
  .post(
    '/rag/backfill',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await startBackfill();
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '启动回填失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '开始批量回填',
        description: '开始批量索引所有未索引的活动（Admin 用）。',
      },
      response: {
        200: t.Object({
          started: t.Boolean(),
          message: t.String(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取回填状态
  .get(
    '/rag/backfill/status',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const status = getBackfillStatus();
      return status;
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取回填状态',
        description: '获取批量回填任务的当前状态（Admin 用）。',
      },
      response: {
        200: t.Object({
          status: t.Union([
            t.Literal('idle'),
            t.Literal('running'),
            t.Literal('completed'),
            t.Literal('failed'),
          ]),
          total: t.Number(),
          processed: t.Number(),
          success: t.Number(),
          failed: t.Number(),
          errors: t.Array(t.Object({
            id: t.String(),
            error: t.String(),
          })),
          startedAt: t.Union([t.String(), t.Null()]),
          completedAt: t.Union([t.String(), t.Null()]),
        }),
        401: 'ai.error',
      },
    }
  )

  // ==========================================
  // Memory 运营 API (v4.5)
  // ==========================================

  // 搜索用户
  .get(
    '/memory/users',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const results = await searchUsers(query.q || '', query.limit);
        return { users: results };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '搜索用户失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '搜索用户',
        description: '按昵称或 ID 搜索用户（Admin 用）。',
      },
      query: t.Object({
        q: t.Optional(t.String({ description: '搜索关键词（昵称或 ID）' })),
        limit: t.Optional(t.Number({ default: 10, description: '返回数量限制' })),
      }),
      response: {
        200: t.Object({
          users: t.Array(t.Object({
            id: t.String(),
            nickname: t.Union([t.String(), t.Null()]),
            phoneNumber: t.Union([t.String(), t.Null()]),
          })),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取用户画像
  .get(
    '/memory/:userId',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const profile = await getUserMemoryProfile(params.userId);
        if (!profile) {
          set.status = 404;
          return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
        }
        return profile;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取用户画像失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取用户画像',
        description: '获取指定用户的工作记忆和兴趣向量（Admin 用）。',
      },
      params: t.Object({
        userId: t.String({ description: '用户 ID' }),
      }),
      response: {
        200: t.Object({
          userId: t.String(),
          nickname: t.Union([t.String(), t.Null()]),
          preferences: t.Array(t.Object({
            category: t.String(),
            value: t.String(),
            sentiment: t.Union([t.Literal('like'), t.Literal('dislike'), t.Literal('neutral')]),
            confidence: t.Number(),
          })),
          frequentLocations: t.Array(t.String()),
          interestVectors: t.Array(t.Object({
            activityId: t.String(),
            activityTitle: t.String(),
            participatedAt: t.String(),
            feedback: t.Union([t.String(), t.Null()]),
          })),
          lastUpdated: t.Union([t.String(), t.Null()]),
        }),
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // MaxSim 测试
  .post(
    '/memory/:userId/maxsim',
    async ({ params, body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await testMaxSim({
          userId: params.userId,
          query: body.query,
        });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || 'MaxSim 测试失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: 'MaxSim 测试',
        description: '测试用户兴趣向量与查询的 MaxSim 相似度（Admin 用）。',
      },
      params: t.Object({
        userId: t.String({ description: '用户 ID' }),
      }),
      body: t.Object({
        query: t.String({ description: '测试查询' }),
      }),
      response: {
        200: t.Object({
          query: t.String(),
          maxSimScore: t.Number(),
          matchedVector: t.Union([
            t.Object({
              activityId: t.String(),
              activityTitle: t.String(),
              similarity: t.Number(),
            }),
            t.Null(),
          ]),
          allVectors: t.Array(t.Object({
            activityId: t.String(),
            activityTitle: t.String(),
            similarity: t.Number(),
          })),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // Security 运营 API (v4.5)
  // ==========================================

  // 获取安全总览
  .get(
    '/security/overview',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const overview = await getSecurityOverview();
        return overview;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取安全总览失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取安全总览',
        description: '获取今日安全指标、趋势图和护栏状态（Admin 用）。',
      },
      response: {
        200: t.Object({
          today: t.Object({
            inputBlocked: t.Number(),
            outputBlocked: t.Number(),
            pendingModeration: t.Number(),
            sensitiveWordsCount: t.Number(),
          }),
          trend: t.Array(t.Object({
            date: t.String(),
            blocked: t.Number(),
            violations: t.Number(),
          })),
          guardrailStatus: t.Object({
            inputGuard: t.Boolean(),
            outputGuard: t.Boolean(),
            rateLimiter: t.Boolean(),
          }),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取敏感词列表
  .get(
    '/security/sensitive-words',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const result = getSensitiveWords();
      return result;
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取敏感词列表',
        description: '获取当前敏感词库（Admin 用）。',
      },
      response: {
        200: t.Object({
          words: t.Array(t.String()),
          total: t.Number(),
        }),
        401: 'ai.error',
      },
    }
  )

  // 添加敏感词
  .post(
    '/security/sensitive-words',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const result = addSensitiveWord(body.word);
      if (!result.success) {
        set.status = 400;
        return { code: 400, msg: result.message } satisfies ErrorResponse;
      }
      return result;
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '添加敏感词',
        description: '添加单个敏感词到词库（Admin 用）。',
      },
      body: t.Object({
        word: t.String({ description: '敏感词' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        400: 'ai.error',
        401: 'ai.error',
      },
    }
  )

  // 删除敏感词
  .delete(
    '/security/sensitive-words/:word',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const result = deleteSensitiveWord(decodeURIComponent(params.word));
      if (!result.success) {
        set.status = 404;
        return { code: 404, msg: result.message } satisfies ErrorResponse;
      }
      return result;
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '删除敏感词',
        description: '从词库中删除指定敏感词（Admin 用）。',
      },
      params: t.Object({
        word: t.String({ description: '敏感词（URL 编码）' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        401: 'ai.error',
        404: 'ai.error',
      },
    }
  )

  // 批量导入敏感词
  .post(
    '/security/sensitive-words/import',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      const result = importSensitiveWords(body.words);
      return result;
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '批量导入敏感词',
        description: '批量导入敏感词到词库（Admin 用）。',
      },
      body: t.Object({
        words: t.Array(t.String(), { description: '敏感词列表' }),
      }),
      response: {
        200: t.Object({
          success: t.Number(),
          skipped: t.Number(),
        }),
        401: 'ai.error',
      },
    }
  )

  // 获取审核队列
  .get(
    '/security/moderation/queue',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await getModerationQueue(query.page, query.limit);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取审核队列失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取审核队列',
        description: '获取待审核内容列表（Admin 用）。',
      },
      query: t.Object({
        page: t.Optional(t.Number({ default: 1, description: '页码' })),
        limit: t.Optional(t.Number({ default: 20, description: '每页数量' })),
      }),
      response: {
        200: t.Object({
          items: t.Array(t.Object({
            id: t.String(),
            contentType: t.Union([t.Literal('input'), t.Literal('output')]),
            content: t.String(),
            userId: t.String(),
            userNickname: t.Union([t.String(), t.Null()]),
            reason: t.String(),
            createdAt: t.String(),
            status: t.Union([t.Literal('pending'), t.Literal('approved'), t.Literal('rejected')]),
          })),
          total: t.Number(),
          pendingCount: t.Number(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 审核通过
  .post(
    '/security/moderation/:id/approve',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await approveModeration(params.id);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '审核操作失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '审核通过',
        description: '将指定内容标记为审核通过（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '审核项 ID' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 审核拒绝
  .post(
    '/security/moderation/:id/reject',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await rejectModeration(params.id);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '审核操作失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '审核拒绝',
        description: '将指定内容标记为审核拒绝（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '审核项 ID' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 审核拒绝并封号
  .post(
    '/security/moderation/:id/ban',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await banModeration(params.id);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '审核操作失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '审核拒绝并封号',
        description: '将指定内容标记为审核拒绝，删除内容并封禁用户（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '审核项 ID' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取违规统计
  .get(
    '/security/violations/stats',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const stats = await getViolationStats();
        return stats;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取违规统计失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取违规统计',
        description: '获取违规类型分布、趋势和高频违规用户（Admin 用）。',
      },
      response: {
        200: t.Object({
          total: t.Number(),
          avgReviewTimeMinutes: t.Number(),
          byType: t.Array(t.Object({
            type: t.String(),
            count: t.Number(),
            percentage: t.Number(),
          })),
          trend: t.Array(t.Object({
            date: t.String(),
            count: t.Number(),
          })),
          topUsers: t.Array(t.Object({
            userId: t.String(),
            nickname: t.Union([t.String(), t.Null()]),
            count: t.Number(),
          })),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // 对话质量监控 API (v4.6)
  // ==========================================

  // 获取对话质量指标
  .get(
    '/ops/metrics/quality',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const endDate = query.endDate
          ? new Date(query.endDate + 'T23:59:59')
          : new Date();
        const startDate = query.startDate
          ? new Date(query.startDate + 'T00:00:00')
          : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

        const result = await getQualityMetrics({ startDate, endDate });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取质量指标失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取对话质量指标',
        description: '获取对话质量评分、意图识别率、Tool 成功率等指标（Admin 用）。',
      },
      query: t.Object({
        startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
        endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
      }),
      response: {
        200: t.Object({
          summary: t.Object({
            totalConversations: t.Number(),
            avgQualityScore: t.Number(),
            intentRecognitionRate: t.Number(),
            toolSuccessRate: t.Number(),
          }),
          daily: t.Array(t.Object({
            date: t.String(),
            conversations: t.Number(),
            avgQualityScore: t.Number(),
            intentRecognitionRate: t.Number(),
            toolSuccessRate: t.Number(),
          })),
          intentDistribution: t.Array(t.Object({
            intent: t.String(),
            count: t.Number(),
            percentage: t.Number(),
          })),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取转化率指标
  .get(
    '/ops/metrics/conversion',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const endDate = query.endDate
          ? new Date(query.endDate + 'T23:59:59')
          : new Date();
        const startDate = query.startDate
          ? new Date(query.startDate + 'T00:00:00')
          : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

        const result = await getConversionMetrics({
          startDate,
          endDate,
          intent: query.intent,
        });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取转化指标失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取转化率指标',
        description: '获取对话到活动创建/报名的转化漏斗数据（Admin 用）。',
      },
      query: t.Object({
        startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
        endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
        intent: t.Optional(t.String({ description: '意图类型过滤' })),
      }),
      response: {
        200: t.Object({
          funnel: t.Object({
            conversations: t.Number(),
            intentRecognized: t.Number(),
            toolCalled: t.Number(),
            activityCreatedOrJoined: t.Number(),
          }),
          conversionRates: t.Object({
            intentToTool: t.Number(),
            toolToActivity: t.Number(),
            overall: t.Number(),
          }),
          byIntent: t.Array(t.Object({
            intent: t.String(),
            conversations: t.Number(),
            converted: t.Number(),
            conversionRate: t.Number(),
          })),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取 Playground 统计
  .get(
    '/ops/metrics/playground-stats',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await getPlaygroundStats();
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取 Playground 统计失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取 Playground 统计',
        description: '获取意图分布、Tool 成功率等 Playground 调试统计（Admin 用）。',
      },
      response: {
        200: t.Object({
          intentDistribution: t.Array(t.Object({
            intent: t.String(),
            count: t.Number(),
            percentage: t.Number(),
          })),
          toolStats: t.Array(t.Object({
            toolName: t.String(),
            totalCalls: t.Number(),
            successCount: t.Number(),
            failureCount: t.Number(),
            successRate: t.Number(),
          })),
          recentErrors: t.Array(t.Object({
            timestamp: t.String(),
            intent: t.String(),
            toolName: t.String(),
            errorMessage: t.String(),
          })),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // Security 持久化 API (v4.6)
  // ==========================================

  // 获取敏感词列表（数据库）
  .get(
    '/ops/security/sensitive-words-db',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await getSensitiveWordsFromDB(query.page, query.limit);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取敏感词失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取敏感词列表（数据库）',
        description: '从数据库获取敏感词列表，支持分页（Admin 用）。',
      },
      query: t.Object({
        page: t.Optional(t.Number({ default: 1 })),
        limit: t.Optional(t.Number({ default: 50 })),
      }),
      response: {
        200: t.Object({
          words: t.Array(t.Object({
            id: t.String(),
            word: t.String(),
            category: t.Union([t.String(), t.Null()]),
            severity: t.Union([t.String(), t.Null()]),
            isActive: t.Union([t.Boolean(), t.Null()]),
            createdAt: t.String(),
          })),
          total: t.Number(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 添加敏感词（数据库）
  .post(
    '/ops/security/sensitive-words-db',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await addSensitiveWordToDB(body.word, body.category, body.severity);
        if (!result.success) {
          set.status = 400;
          return { code: 400, msg: result.message } satisfies ErrorResponse;
        }
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '添加敏感词失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '添加敏感词（数据库）',
        description: '添加敏感词到数据库（Admin 用）。',
      },
      body: t.Object({
        word: t.String({ description: '敏感词' }),
        category: t.Optional(t.String({ description: '分类' })),
        severity: t.Optional(t.String({ description: '严重程度' })),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          id: t.Optional(t.String()),
        }),
        400: 'ai.error',
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 删除敏感词（数据库）
  .delete(
    '/ops/security/sensitive-words-db/:id',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await deleteSensitiveWordFromDB(params.id);
        if (!result.success) {
          set.status = 404;
          return { code: 404, msg: result.message } satisfies ErrorResponse;
        }
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '删除敏感词失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '删除敏感词（数据库）',
        description: '从数据库删除敏感词（Admin 用）。',
      },
      params: t.Object({
        id: t.String({ description: '敏感词 ID' }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        401: 'ai.error',
        404: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取安全事件列表
  .get(
    '/ops/security/events',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const startDate = query.startDate ? new Date(query.startDate + 'T00:00:00') : undefined;
        const endDate = query.endDate ? new Date(query.endDate + 'T23:59:59') : undefined;

        const result = await getSecurityEvents({
          startDate,
          endDate,
          eventType: query.eventType,
          page: query.page,
          limit: query.limit,
        });
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取安全事件失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取安全事件列表',
        description: '获取安全拦截事件列表（Admin 用）。',
      },
      query: t.Object({
        startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
        endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
        eventType: t.Optional(t.String({ description: '事件类型' })),
        page: t.Optional(t.Number({ default: 1 })),
        limit: t.Optional(t.Number({ default: 20 })),
      }),
      response: {
        200: t.Object({
          items: t.Array(t.Object({
            id: t.String(),
            userId: t.Union([t.String(), t.Null()]),
            eventType: t.String(),
            triggerWord: t.Union([t.String(), t.Null()]),
            severity: t.Union([t.String(), t.Null()]),
            createdAt: t.String(),
          })),
          total: t.Number(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // 获取安全统计（真实数据）
  .get(
    '/ops/security/stats-db',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const endDate = query.endDate
          ? new Date(query.endDate + 'T23:59:59')
          : new Date();
        const startDate = query.startDate
          ? new Date(query.startDate + 'T00:00:00')
          : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

        const result = await getSecurityStatsFromDB(startDate, endDate);
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取安全统计失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取安全统计（真实数据）',
        description: '从数据库获取真实的安全统计数据（Admin 用）。',
      },
      query: t.Object({
        startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
        endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
      }),
      response: {
        200: t.Object({
          totalEvents: t.Number(),
          eventsByType: t.Array(t.Object({
            eventType: t.String(),
            count: t.Number(),
          })),
          eventsByDay: t.Array(t.Object({
            date: t.String(),
            count: t.Number(),
          })),
          topTriggerWords: t.Array(t.Object({
            word: t.String(),
            count: t.Number(),
          })),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // v4.6: AI 健康度指标 (Dashboard)
  // ==========================================
  .get(
    '/ops/metrics/health',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await getAIHealthMetrics();
        return result;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取健康度指标失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Ops'],
        summary: '获取 AI 健康度指标',
        description: `获取 AI 健康度指标（Dashboard 用）。

返回内容：
- badCaseRate: Bad Case 占比
- toolErrorRate: Tool 错误率
- badCaseTrend: 与上周对比的趋势（正数上升，负数下降）
- toolErrorTrend: 与上周对比的趋势`,
      },
      response: {
        200: t.Object({
          badCaseRate: t.Number(),
          badCaseCount: t.Number(),
          totalEvaluated: t.Number(),
          toolErrorRate: t.Number(),
          errorSessionCount: t.Number(),
          totalSessions: t.Number(),
          badCaseTrend: t.Number(),
          toolErrorTrend: t.Number(),
        }),
        401: 'ai.error',
        500: 'ai.error',
      },
    }
  )

  // ==========================================
  // AI Ops 运营接口 (v4.5)
  // ==========================================
  .group('/ops', (app) => app
    // Security Moderation
    .group('/security', (bp) => bp
      // 获取审核队列
      .get(
        '/moderation/queue',
        async ({ query, set, jwt, headers }) => {
          const user = await verifyAuth(jwt, headers);
          if (!user) {
            set.status = 401;
            return { code: 401, msg: '未授权' } satisfies ErrorResponse;
          }

          try {
            const page = query.page ? parseInt(query.page) : 1;
            const limit = query.limit ? parseInt(query.limit) : 20;
            return await getModerationQueue(page, limit);
          } catch (error: any) {
            set.status = 500;
            return { code: 500, msg: error.message || '获取审核队列失败' } satisfies ErrorResponse;
          }
        },
        {
          detail: {
            tags: ['AI Ops'],
            summary: '获取审核队列',
            description: '获取待审核的内容列表',
          },
          query: t.Object({
            page: t.Optional(t.String()),
            limit: t.Optional(t.String()),
          }),
        }
      )

      // 审核通过
      .post(
        '/moderation/:id/approve',
        async ({ params, set, jwt, headers }) => {
          const user = await verifyAuth(jwt, headers);
          if (!user) {
            set.status = 401;
            return { code: 401, msg: '未授权' } satisfies ErrorResponse;
          }

          try {
            return await approveModeration(params.id);
          } catch (error: any) {
            set.status = 500;
            return { code: 500, msg: error.message || '操作失败' } satisfies ErrorResponse;
          }
        },
        {
          detail: {
            tags: ['AI Ops'],
            summary: '审核通过',
          },
          params: t.Object({
            id: t.String(),
          }),
        }
      )

      // 审核拒绝
      .post(
        '/moderation/:id/reject',
        async ({ params, set, jwt, headers }) => {
          const user = await verifyAuth(jwt, headers);
          if (!user) {
            set.status = 401;
            return { code: 401, msg: '未授权' } satisfies ErrorResponse;
          }

          try {
            return await rejectModeration(params.id);
          } catch (error: any) {
            set.status = 500;
            return { code: 500, msg: error.message || '操作失败' } satisfies ErrorResponse;
          }
        },
        {
          detail: {
            tags: ['AI Ops'],
            summary: '审核拒绝',
          },
          params: t.Object({
            id: t.String(),
          }),
        }
      )

      // 审核拒绝并封号
      .post(
        '/moderation/:id/ban',
        async ({ params, set, jwt, headers }) => {
          const user = await verifyAuth(jwt, headers);
          if (!user) {
            set.status = 401;
            return { code: 401, msg: '未授权' } satisfies ErrorResponse;
          }

          try {
            return await banModeration(params.id);
          } catch (error: any) {
            set.status = 500;
            return { code: 500, msg: error.message || '操作失败' } satisfies ErrorResponse;
          }
        },
        {
          detail: {
            tags: ['AI Ops'],
            summary: '审核拒绝并封号',
          },
          params: t.Object({
            id: t.String(),
          }),
        }
      )
    )
  );

// AI Model - v4.6 Chat-First: AI 解析 + 对话历史管理 + Admin 运营 Schema
import { Elysia, t, type Static } from 'elysia';
import { selectConversationSchema, selectMessageSchema } from '@juchang/db';

/**
 * AI Model Plugin - v3.3 Chat-First (行业标准命名)
 * 
 * 功能：
 * - AI Chat 统一网关（GenUI 协议）
 * - 对话历史管理（GET/POST/DELETE /ai/conversations）
 */

// ==========================================
// AI Chat 协议 Schema
// ==========================================

const GenericObjectSchema = t.Object({}, { additionalProperties: true });

const ChatInputTextSchema = t.Object({
  type: t.Literal('text'),
  text: t.String({ minLength: 1, description: '用户输入文本' }),
});

const ChatInputActionSchema = t.Object({
  type: t.Literal('action'),
  action: t.String({ minLength: 1, description: '结构化动作名称' }),
  actionId: t.String({ minLength: 1, description: '动作唯一 ID' }),
  params: t.Optional(GenericObjectSchema),
  displayText: t.Optional(t.String({ description: '用户侧展示文本' })),
}, { additionalProperties: true });

const ChatFollowUpModeSchema = t.Union([
  t.Literal('review'),
  t.Literal('rebook'),
  t.Literal('kickoff'),
]);

const GenUIBlockTypeSchema = t.Union([
  t.Literal('text'),
  t.Literal('choice'),
  t.Literal('entity-card'),
  t.Literal('list'),
  t.Literal('form'),
  t.Literal('cta-group'),
  t.Literal('alert'),
]);

const TurnContextChoiceOptionSchema = t.Object({
  label: t.String({ minLength: 1 }),
  action: t.String({ minLength: 1 }),
  params: t.Optional(GenericObjectSchema),
  value: t.Optional(t.String()),
}, { additionalProperties: false });

const TurnContextListItemSchema = t.Object({
  title: t.String({ minLength: 1 }),
  action: t.String({ minLength: 1 }),
  params: t.Optional(GenericObjectSchema),
  aliases: t.Optional(t.Array(t.String({ minLength: 1 }), { maxItems: 8 })),
}, { additionalProperties: false });

const TurnContextCtaItemSchema = t.Object({
  label: t.String({ minLength: 1 }),
  action: t.String({ minLength: 1 }),
  params: t.Optional(GenericObjectSchema),
}, { additionalProperties: false });

const TurnContextSchema = t.Union([
  t.Object({
    kind: t.Literal('choice'),
    question: t.Optional(t.String()),
    options: t.Array(TurnContextChoiceOptionSchema, { minItems: 1, maxItems: 12 }),
  }, { additionalProperties: false }),
  t.Object({
    kind: t.Literal('list'),
    title: t.Optional(t.String()),
    items: t.Array(TurnContextListItemSchema, { minItems: 1, maxItems: 12 }),
  }, { additionalProperties: false }),
  t.Object({
    kind: t.Literal('cta-group'),
    items: t.Array(TurnContextCtaItemSchema, { minItems: 1, maxItems: 12 }),
  }, { additionalProperties: false }),
]);

const ChatTransientTurnSchema = t.Object({
  role: t.Union([
    t.Literal('user'),
    t.Literal('assistant'),
  ]),
  text: t.String({ minLength: 1 }),
  primaryBlockType: t.Optional(t.Union([GenUIBlockTypeSchema, t.Null()])),
  turnContext: t.Optional(TurnContextSchema),
}, { additionalProperties: false });

const ChatContextSchema = t.Object({
  client: t.Optional(t.Union([
    t.Literal('web'),
    t.Literal('miniprogram'),
    t.Literal('admin'),
  ])),
  locale: t.Optional(t.String()),
  timezone: t.Optional(t.String()),
  platformVersion: t.Optional(t.String()),
  lat: t.Optional(t.Number()),
  lng: t.Optional(t.Number()),
  activityId: t.Optional(t.String({ minLength: 1, description: '关联活动 ID，用于活动后 follow-up 等承接场景' })),
  followUpMode: t.Optional(ChatFollowUpModeSchema),
  entry: t.Optional(t.String({ description: '触发入口标识，如 message_center_post_activity' })),
  transientTurns: t.Optional(t.Array(ChatTransientTurnSchema, {
    maxItems: 12,
    description: '匿名用户当前页临时上下文，不会服务端持久化',
  })),
}, { additionalProperties: true });

const ChatAiSchema = t.Object({
  model: t.Optional(t.String({ minLength: 1, description: '本轮 AI 使用的模型 ID，如 qwen-plus / deepseek-chat' })),
  temperature: t.Optional(t.Number({ minimum: 0, maximum: 2, description: '采样温度，默认 0' })),
  maxTokens: t.Optional(t.Number({ minimum: 1, description: '最大输出 Token 数' })),
}, { additionalProperties: false });

const ChatRequestSchema = t.Object({
  conversationId: t.Optional(t.String({ minLength: 1, description: '会话 ID，可选续聊' })),
  input: t.Union([ChatInputTextSchema, ChatInputActionSchema]),
  context: t.Optional(ChatContextSchema),
  ai: t.Optional(ChatAiSchema),
  stream: t.Optional(t.Boolean({ description: 'true 时返回 GenUI SSE 事件流' })),
});

const GenUIReplacePolicySchema = t.Union([
  t.Literal('append'),
  t.Literal('replace'),
  t.Literal('ignore-if-exists'),
]);

const GenUITurnStatusSchema = t.Union([
  t.Literal('streaming'),
  t.Literal('completed'),
  t.Literal('error'),
]);

const GenUIChoiceOptionSchema = t.Object({
  label: t.String(),
  action: t.String(),
  params: t.Optional(GenericObjectSchema),
}, { additionalProperties: true });

const GenUICtaItemSchema = t.Object({
  label: t.String(),
  action: t.String(),
  params: t.Optional(GenericObjectSchema),
}, { additionalProperties: true });

const GenUITextBlockSchema = t.Object({
  blockId: t.String({ minLength: 1 }),
  type: t.Literal('text'),
  content: t.String(),
  dedupeKey: t.Optional(t.String()),
  replacePolicy: t.Optional(GenUIReplacePolicySchema),
  meta: t.Optional(GenericObjectSchema),
}, { additionalProperties: true });

const GenUIChoiceBlockSchema = t.Object({
  blockId: t.String({ minLength: 1 }),
  type: t.Literal('choice'),
  question: t.String(),
  options: t.Array(GenUIChoiceOptionSchema),
  dedupeKey: t.Optional(t.String()),
  replacePolicy: t.Optional(GenUIReplacePolicySchema),
  meta: t.Optional(GenericObjectSchema),
}, { additionalProperties: true });

const GenUIEntityCardBlockSchema = t.Object({
  blockId: t.String({ minLength: 1 }),
  type: t.Literal('entity-card'),
  title: t.String(),
  fields: GenericObjectSchema,
  dedupeKey: t.Optional(t.String()),
  replacePolicy: t.Optional(GenUIReplacePolicySchema),
  meta: t.Optional(GenericObjectSchema),
}, { additionalProperties: true });

const GenUIListBlockSchema = t.Object({
  blockId: t.String({ minLength: 1 }),
  type: t.Literal('list'),
  title: t.Optional(t.String()),
  items: t.Array(GenericObjectSchema),
  center: t.Optional(t.Object({
    lat: t.Number(),
    lng: t.Number(),
    name: t.String(),
  }, { additionalProperties: true })),
  semanticQuery: t.Optional(t.String()),
  fetchConfig: t.Optional(GenericObjectSchema),
  interaction: t.Optional(GenericObjectSchema),
  preview: t.Optional(GenericObjectSchema),
  dedupeKey: t.Optional(t.String()),
  replacePolicy: t.Optional(GenUIReplacePolicySchema),
  meta: t.Optional(GenericObjectSchema),
}, { additionalProperties: true });

const GenUIFormBlockSchema = t.Object({
  blockId: t.String({ minLength: 1 }),
  type: t.Literal('form'),
  title: t.Optional(t.String()),
  schema: GenericObjectSchema,
  initialValues: t.Optional(GenericObjectSchema),
  dedupeKey: t.Optional(t.String()),
  replacePolicy: t.Optional(GenUIReplacePolicySchema),
  meta: t.Optional(GenericObjectSchema),
}, { additionalProperties: true });

const GenUICtaGroupBlockSchema = t.Object({
  blockId: t.String({ minLength: 1 }),
  type: t.Literal('cta-group'),
  items: t.Array(GenUICtaItemSchema),
  dedupeKey: t.Optional(t.String()),
  replacePolicy: t.Optional(GenUIReplacePolicySchema),
  meta: t.Optional(GenericObjectSchema),
}, { additionalProperties: true });

const GenUIAlertBlockSchema = t.Object({
  blockId: t.String({ minLength: 1 }),
  type: t.Literal('alert'),
  level: t.Union([
    t.Literal('info'),
    t.Literal('warning'),
    t.Literal('error'),
    t.Literal('success'),
  ]),
  message: t.String(),
  dedupeKey: t.Optional(t.String()),
  replacePolicy: t.Optional(GenUIReplacePolicySchema),
  meta: t.Optional(GenericObjectSchema),
}, { additionalProperties: true });

const GenUIBlockSchema = t.Union([
  GenUITextBlockSchema,
  GenUIChoiceBlockSchema,
  GenUIEntityCardBlockSchema,
  GenUIListBlockSchema,
  GenUIFormBlockSchema,
  GenUICtaGroupBlockSchema,
  GenUIAlertBlockSchema,
]);

const ChatTurnEnvelopeSchema = t.Object({
  traceId: t.String({ minLength: 1 }),
  conversationId: t.String({ minLength: 1 }),
  turn: t.Object({
    turnId: t.String({ minLength: 1 }),
    role: t.Literal('assistant'),
    status: GenUITurnStatusSchema,
    blocks: t.Array(GenUIBlockSchema),
    turnContext: t.Optional(TurnContextSchema),
  }),
});

// ==========================================
// 对话历史相关 Schema (v3.3 行业标准命名)
// ==========================================

// 消息角色 (使用 assistant 符合 OpenAI 标准)
const ConversationRole = t.Union([
  t.Literal('user'),
  t.Literal('assistant'),
]);

// 消息类型
const ConversationMessageType = t.Union([
  t.Literal('text'),
  t.Literal('user_action'),
  t.Literal('widget_dashboard'),
  t.Literal('widget_launcher'),
  t.Literal('widget_action'),
  t.Literal('widget_draft'),
  t.Literal('widget_share'),
  t.Literal('widget_explore'),
  t.Literal('widget_error'),
  t.Literal('widget_ask_preference'),  // v3.5 多轮对话偏好询问卡片
]);

// 获取用户会话列表查询参数（显式 userId）
const ConversationsQuery = t.Object({
  cursor: t.Optional(t.String({ description: '分页游标（上一页最后一条会话的 ID）' })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20, description: '获取数量' })),
  userId: t.String({ description: '目标用户 ID（普通用户仅可传本人）' }),
});

// 获取指定会话消息查询参数（显式 userId + 会话 ID）
const ConversationMessagesQuery = t.Object({
  cursor: t.Optional(t.String({ description: '分页游标（上一页最后一条消息的 ID）' })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20, description: '获取数量' })),
  userId: t.String({ description: '目标用户 ID（普通用户仅可传本人）' }),
  messageType: t.Optional(ConversationMessageType),
  role: t.Optional(t.Union([t.Literal('user'), t.Literal('assistant')], { description: '按角色筛选' })),
});

const ConversationIdParams = t.Object({
  conversationId: t.String({ description: '会话 ID' }),
});

const ActivityConversationMessageParams = t.Object({
  activityId: t.String({ format: 'uuid', description: '活动 ID' }),
});

// 对话消息响应（DB 派生基础字段 + API 展示字段）
const ConversationMessageItem = t.Composite([
  t.Pick(selectMessageSchema, ['id', 'userId', 'activityId']),
  t.Object({
    userNickname: t.Union([t.String(), t.Null()], { description: '用户昵称' }),
    role: ConversationRole,
    type: ConversationMessageType,
    content: t.Any({ description: 'JSONB 内容，根据 type 不同结构不同' }),
    createdAt: t.String(),
  }),
]);

// 对话列表项（listConversations 返回的会话级数据）- 从 DB 派生
const ConversationListItem = t.Composite([
  t.Pick(selectConversationSchema, [
    'id', 'userId', 'title', 'messageCount',
    'evaluationStatus', 'evaluationTags', 'evaluationNote', 'hasError',
  ]),
  t.Object({
    userNickname: t.Union([t.String(), t.Null()], { description: '用户昵称（JOIN 字段）' }),
    lastMessageAt: t.String({ description: '最后消息时间（ISO 字符串）' }),
    createdAt: t.String({ description: '创建时间（ISO 字符串）' }),
  }),
]);

// 获取用户会话列表响应
const ConversationsResponse = t.Object({
  items: t.Array(ConversationListItem),
  total: t.Number({ description: '总数量' }),
  hasMore: t.Boolean({ description: '是否还有更多会话' }),
  cursor: t.Union([t.String(), t.Null()], { description: '下一页游标' }),
});

// 获取指定会话消息响应
const ConversationMessagesResponse = t.Object({
  conversationId: t.String({ description: '会话 ID' }),
  items: t.Array(ConversationMessageItem),
  total: t.Number({ description: '总数量' }),
  hasMore: t.Boolean({ description: '是否还有更多消息' }),
  cursor: t.Union([t.String(), t.Null()], { description: '下一页游标' }),
});

const ActivityConversationMessagesResponse = t.Object({
  activityId: t.String({ format: 'uuid', description: '活动 ID' }),
  items: t.Array(ConversationMessageItem),
  total: t.Number({ description: '关联消息总数' }),
});

// 添加用户消息请求
const AddMessageRequest = t.Object({
  content: t.String({ minLength: 1, maxLength: 2000, description: '消息内容' }),
});

// 添加用户消息响应
const AddMessageResponse = t.Object({
  success: t.Literal(true),
  msg: t.String(),
  id: t.String(),
});

// 清空对话响应
const ClearConversationsResponse = t.Object({
  success: t.Literal(true),
  msg: t.String(),
  deletedCount: t.Number({ description: '删除的消息数量' }),
});

// 错误响应
const ErrorResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// ==========================================
// Welcome Card 相关 Schema (v3.10 重构 - 分组结构)
// ==========================================

// 快捷项类型
const QuickItemType = t.Union([
  t.Literal('draft'),        // 继续草稿
  t.Literal('suggestion'),   // 快速组局建议
  t.Literal('explore'),      // 探索附近
]);

// 快捷项
const QuickItem = t.Object({
  type: QuickItemType,
  icon: t.Optional(t.String({ description: 'Emoji 图标' })),
  label: t.String({ description: '显示文案' }),
  prompt: t.String({ description: '点击后发送的 prompt' }),
  context: t.Optional(t.Any({ description: '附加上下文数据' })),
});

// 分组
const WelcomeSection = t.Object({
  id: t.String({ description: '分组 ID' }),
  icon: t.String({ description: '分组图标 Emoji' }),
  title: t.String({ description: '分组标题' }),
  items: t.Array(QuickItem),
});

// Welcome Card 响应 (v4.4 重构 - 增加社交档案)
const SocialProfile = t.Object({
  participationCount: t.Number({ description: '参与活动数' }),
  activitiesCreatedCount: t.Number({ description: '发起活动数' }),
  preferenceCompleteness: t.Number({ description: '偏好完善度 0-100' }),
});

const WelcomePendingActivity = t.Object({
  id: t.String({ description: '活动 ID' }),
  title: t.String({ description: '活动标题' }),
  type: t.String({ description: '活动类型' }),
  startAt: t.String({ description: '开始时间 ISO' }),
  locationName: t.String({ description: '地点名称' }),
  locationHint: t.String({ description: '地点提示' }),
  currentParticipants: t.Number({ description: '当前参与人数' }),
  maxParticipants: t.Number({ description: '人数上限' }),
  status: t.String({ description: '活动状态' }),
});

const WelcomeResponse = t.Object({
  greeting: t.String({ description: '问候语' }),
  subGreeting: t.Optional(t.String({ description: '副标题' })),
  sections: t.Array(WelcomeSection, { description: '分组列表' }),
  socialProfile: t.Optional(SocialProfile),
  pendingActivities: t.Optional(t.Array(WelcomePendingActivity, { description: '待参加活动列表（最多 3 个）' })),
  quickPrompts: t.Array(t.Object({
    icon: t.String(),
    text: t.String(),
    prompt: t.String(),
  }), { description: '快捷入口' }),
  ui: t.Optional(t.Object({
    composerPlaceholder: t.String({ description: '输入框占位文案' }),
    bottomQuickActions: t.Array(t.String(), { description: '底部快捷操作标签' }),
    profileHints: t.Object({
      low: t.String({ description: '偏好完善度较低时文案' }),
      medium: t.String({ description: '偏好完善度中等时文案' }),
      high: t.String({ description: '偏好完善度较高时文案' }),
    }),
  })),
});

// Welcome Card 查询参数
const WelcomeQuery = t.Object({
  lat: t.Optional(t.Number({ description: '用户纬度' })),
  lng: t.Optional(t.Number({ description: '用户经度' })),
});

// ==========================================
// Metrics 相关 Schema (v4.0 更新 - 完整监控)
// ==========================================

// Token 使用统计查询参数
const MetricsUsageQuery = t.Object({
  startDate: t.Optional(t.String({ description: '开始日期 YYYY-MM-DD' })),
  endDate: t.Optional(t.String({ description: '结束日期 YYYY-MM-DD' })),
});

// 每日 Token 使用统计 (v4.0 更新 - 增加缓存命中)
const DailyTokenUsage = t.Object({
  date: t.String(),
  totalRequests: t.Number(),
  inputTokens: t.Number(),
  outputTokens: t.Number(),
  totalTokens: t.Number(),
  cacheHitTokens: t.Number(),
  cacheMissTokens: t.Number(),
  cacheHitRate: t.Number(),
});

// Token 使用汇总 (v4.0 更新 - 增加缓存命中)
const TokenUsageSummary = t.Object({
  totalRequests: t.Number(),
  totalInputTokens: t.Number(),
  totalOutputTokens: t.Number(),
  totalTokens: t.Number(),
  avgTokensPerRequest: t.Number(),
  totalCacheHitTokens: t.Number(),
  totalCacheMissTokens: t.Number(),
  overallCacheHitRate: t.Number(),
});

// Tool 调用统计 (v4.0 更新 - 完整统计)
const ToolCallStats = t.Object({
  toolName: t.String(),
  totalCount: t.Number(),
  successCount: t.Number(),
  failureCount: t.Number(),
  successRate: t.Number(),
  avgDurationMs: t.Union([t.Number(), t.Null()]),
});

// Metrics 响应
const MetricsUsageResponse = t.Object({
  summary: TokenUsageSummary,
  daily: t.Array(DailyTokenUsage),
  toolCalls: t.Array(ToolCallStats),
});

// ==========================================
// Prompt 相关 Schema (v3.4 新增)
// ==========================================

// Prompt 信息响应
const PromptInfoResponse = t.Object({
  version: t.String(),
  lastModified: t.String(),
  description: t.String(),
  features: t.Array(t.String()),
  content: t.String({ description: '当前 System Prompt 内容' }),
});

// ==========================================
// Sessions 子 Controller Schema (v4.6)
// 会话管理 - Admin 对话审计
// ==========================================

// 会话列表响应
const SessionListResponse = t.Object({
  items: t.Array(ConversationListItem),
  total: t.Number(),
});

// 会话消息项（从 DB 派生 + content 覆盖为 t.Any）
const SessionMessageItem = t.Composite([
  t.Pick(selectMessageSchema, ['id', 'role', 'messageType', 'activityId']),
  t.Object({
    content: t.Any({ description: 'JSONB 内容' }),
    createdAt: t.String(),
  }),
]);

// 会话详情响应
const SessionDetailResponse = t.Object({
  conversation: ConversationListItem,
  messages: t.Array(SessionMessageItem),
});

// 会话评估响应（返回更新后的会话）
const SessionEvaluateResponse = ConversationListItem;

// ==========================================
// RAG 子 Controller Schema (v4.5)
// RAG 运营管理 - AI 特有聚合类型
// ==========================================

// RAG 统计响应
const RagStatsResponse = t.Object({
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
});

// RAG 搜索结果项
const RagSearchResultItem = t.Object({
  activityId: t.String(),
  title: t.String(),
  type: t.String(),
  locationName: t.String(),
  startAt: t.String(),
  similarity: t.Number(),
  distance: t.Union([t.Number(), t.Null()]),
  finalScore: t.Number(),
  maxSimBoost: t.Number(),
});

// RAG 搜索响应
const RagSearchResponse = t.Object({
  results: t.Array(RagSearchResultItem),
  performance: t.Object({
    embeddingTimeMs: t.Number(),
    searchTimeMs: t.Number(),
    totalTimeMs: t.Number(),
  }),
  query: t.String(),
  totalResults: t.Number(),
});

// RAG 回填状态响应
const RagBackfillStatusResponse = t.Object({
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
});

// ==========================================
// Memory 子 Controller Schema (v4.5)
// Memory 运营管理 - AI 特有聚合类型
// ==========================================

// 用户搜索结果项
const MemoryUserItem = t.Object({
  id: t.String(),
  nickname: t.Union([t.String(), t.Null()]),
  phoneNumber: t.Union([t.String(), t.Null()]),
});

// 用户搜索响应
const MemoryUsersResponse = t.Object({
  users: t.Array(MemoryUserItem),
});

// 用户偏好项
const MemoryPreferenceItem = t.Object({
  category: t.String(),
  value: t.String(),
  sentiment: t.Union([t.Literal('like'), t.Literal('dislike'), t.Literal('neutral')]),
  confidence: t.Number(),
});

// 兴趣向量项
const MemoryInterestVectorItem = t.Object({
  activityId: t.String(),
  activityTitle: t.String(),
  participatedAt: t.String(),
  feedback: t.Union([t.String(), t.Null()]),
});

// 用户画像响应
const MemoryProfileResponse = t.Object({
  userId: t.String(),
  nickname: t.Union([t.String(), t.Null()]),
  preferences: t.Array(MemoryPreferenceItem),
  frequentLocations: t.Array(t.String()),
  interestVectors: t.Array(MemoryInterestVectorItem),
  lastUpdated: t.Union([t.String(), t.Null()]),
});

// MaxSim 向量匹配项
const MaxSimVectorItem = t.Object({
  activityId: t.String(),
  activityTitle: t.String(),
  similarity: t.Number(),
});

// MaxSim 测试响应
const MaxSimResponse = t.Object({
  query: t.String(),
  maxSimScore: t.Number(),
  matchedVector: t.Union([MaxSimVectorItem, t.Null()]),
  allVectors: t.Array(MaxSimVectorItem),
});

// ==========================================
// Security 子 Controller Schema (v4.5)
// 安全运营 - AI 特有聚合类型
// ==========================================

// 安全总览响应
const SecurityOverviewResponse = t.Object({
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
});

// 敏感词列表响应（内存版）
const SensitiveWordsResponse = t.Object({
  words: t.Array(t.String()),
  total: t.Number(),
});

// 敏感词操作响应
const SensitiveWordOpResponse = t.Object({
  success: t.Boolean(),
  message: t.String(),
});

// 批量导入敏感词响应
const SensitiveWordsImportResponse = t.Object({
  success: t.Number(),
  skipped: t.Number(),
});

// 审核队列项
const ModerationQueueItem = t.Object({
  id: t.String(),
  contentType: t.Union([t.Literal('input'), t.Literal('output')]),
  content: t.String(),
  userId: t.String(),
  userNickname: t.Union([t.String(), t.Null()]),
  reason: t.String(),
  createdAt: t.String(),
  status: t.Union([t.Literal('pending'), t.Literal('approved'), t.Literal('rejected')]),
});

// 审核队列响应
const ModerationQueueResponse = t.Object({
  items: t.Array(ModerationQueueItem),
  total: t.Number(),
  pendingCount: t.Number(),
});

// 审核操作响应
const ModerationOpResponse = t.Object({
  success: t.Boolean(),
  message: t.String(),
});

// 违规统计响应
const ViolationStatsResponse = t.Object({
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
});

// ==========================================
// AI 内容生成 Schema (从 Growth 迁移)
// ==========================================

// 内容生成请求
const ContentGenerationRequest = t.Object({
  topic: t.String({ description: '内容主题/描述', minLength: 1, maxLength: 500 }),
  contentType: t.Union([
    t.Literal('poster'),        // 海报文案
    t.Literal('social-note'),   // 小红书笔记
    t.Literal('social-post'),   // 社交媒体帖子
  ], { description: '内容类型' }),
  style: t.Optional(t.Union([
    t.Literal('minimal'),       // 极简
    t.Literal('cyberpunk'),     // 赛博朋克
    t.Literal('handwritten'),   // 手写风
    t.Literal('xiaohongshu'),   // 小红书风格
    t.Literal('casual'),        //  casual
    t.Literal('professional'),  // 专业
  ], { default: 'minimal', description: '文案风格' })),
  trendKeywords: t.Optional(t.Array(t.String(), { description: '趋势关键词' })),
  count: t.Optional(t.Number({ minimum: 1, maximum: 5, default: 1, description: '生成数量' })),
});

// 内容生成响应项
const GeneratedContentItem = t.Object({
  title: t.String({ description: '标题' }),
  body: t.String({ description: '正文内容' }),
  hashtags: t.Array(t.String(), { description: '话题标签' }),
  coverImageHint: t.Optional(t.String({ description: '封面图片描述' })),
  cta: t.Optional(t.String({ description: '行动号召' })),
});

// 内容生成响应
const ContentGenerationResponse = t.Object({
  items: t.Array(GeneratedContentItem),
  batchId: t.String({ description: '批次ID' }),
});

// ==========================================
// Metrics 子 Controller Schema (v4.6)
// 指标聚合 - AI 特有类型
// ==========================================

// 对话质量指标响应
const QualityMetricsResponse = t.Object({
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
});

// 转化率指标响应
const ConversionMetricsResponse = t.Object({
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
});

// Playground 统计响应
const PlaygroundStatsResponse = t.Object({
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
});

// AI 健康度指标响应
const AIHealthMetricsResponse = t.Object({
  badCaseRate: t.Number(),
  badCaseCount: t.Number(),
  totalEvaluated: t.Number(),
  toolErrorRate: t.Number(),
  errorSessionCount: t.Number(),
  totalSessions: t.Number(),
  badCaseTrend: t.Number(),
  toolErrorTrend: t.Number(),
});

// Security 敏感词项（数据库版）
const SecuritySensitiveWordItem = t.Object({
  id: t.String(),
  word: t.String(),
  category: t.Union([t.String(), t.Null()]),
  severity: t.Union([t.String(), t.Null()]),
  isActive: t.Union([t.Boolean(), t.Null()]),
  createdAt: t.String(),
});

// Security 敏感词列表响应（数据库版）
const SecuritySensitiveWordsDBResponse = t.Object({
  words: t.Array(SecuritySensitiveWordItem),
  total: t.Number(),
});

// Security 添加敏感词响应
const SecurityAddSensitiveWordResponse = t.Object({
  success: t.Boolean(),
  message: t.String(),
  id: t.Optional(t.String()),
});

// Security 删除敏感词响应
const SecurityDeleteSensitiveWordResponse = t.Object({
  success: t.Boolean(),
  message: t.String(),
});

// 安全事件项
const SecurityEventItem = t.Object({
  id: t.String(),
  userId: t.Union([t.String(), t.Null()]),
  eventType: t.String(),
  triggerWord: t.Union([t.String(), t.Null()]),
  severity: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});

// 安全事件列表响应
const SecurityEventsResponse = t.Object({
  items: t.Array(SecurityEventItem),
  total: t.Number(),
});

// 安全统计响应（数据库版）
const SecurityStatsDBResponse = t.Object({
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
});

// 注册到 Elysia
export const aiModel = new Elysia({ name: 'aiModel' })
  .model({
    // AI Chat 协议
    'ai.chatRequest': ChatRequestSchema,
    'ai.chatTurnEnvelope': ChatTurnEnvelopeSchema,
    // 用户对话消息
    'ai.conversationsQuery': ConversationsQuery,
    'ai.conversationsResponse': ConversationsResponse,
    'ai.conversationIdParams': ConversationIdParams,
    'ai.conversationMessagesQuery': ConversationMessagesQuery,
    'ai.conversationMessagesResponse': ConversationMessagesResponse,
    'ai.conversationMessageItem': ConversationMessageItem,
    'ai.activityConversationMessageParams': ActivityConversationMessageParams,
    'ai.activityConversationMessagesResponse': ActivityConversationMessagesResponse,
    'ai.addMessageRequest': AddMessageRequest,
    'ai.addMessageResponse': AddMessageResponse,
    'ai.clearConversationsResponse': ClearConversationsResponse,
    // Welcome Card (v3.4 新增)
    'ai.welcomeQuery': WelcomeQuery,
    'ai.welcomeResponse': WelcomeResponse,
    // Metrics (v3.4 新增)
    'ai.metricsUsageQuery': MetricsUsageQuery,
    'ai.metricsUsageResponse': MetricsUsageResponse,
    // Prompt (v3.4 新增)
    'ai.promptInfoResponse': PromptInfoResponse,
    // 通用
    'ai.error': ErrorResponse,
    // ==========================================
    // Sessions (v4.6 - Admin 对话审计)
    // ==========================================
    'ai.sessionListItem': ConversationListItem,
    'ai.sessionListResponse': SessionListResponse,
    'ai.sessionMessageItem': SessionMessageItem,
    'ai.sessionDetailResponse': SessionDetailResponse,
    'ai.sessionEvaluateResponse': SessionEvaluateResponse,
    // ==========================================
    // RAG (v4.5 - RAG 运营)
    // ==========================================
    'ai.ragStatsResponse': RagStatsResponse,
    'ai.ragSearchResponse': RagSearchResponse,
    'ai.ragBackfillStatusResponse': RagBackfillStatusResponse,
    // ==========================================
    // Memory (v4.5 - Memory 运营)
    // ==========================================
    'ai.memoryUsersResponse': MemoryUsersResponse,
    'ai.memoryProfileResponse': MemoryProfileResponse,
    'ai.maxSimResponse': MaxSimResponse,
    // ==========================================
    // Security (v4.5 - 安全运营)
    // ==========================================
    'ai.securityOverviewResponse': SecurityOverviewResponse,
    'ai.sensitiveWordsResponse': SensitiveWordsResponse,
    'ai.sensitiveWordOpResponse': SensitiveWordOpResponse,
    'ai.sensitiveWordsImportResponse': SensitiveWordsImportResponse,
    'ai.moderationQueueResponse': ModerationQueueResponse,
    'ai.moderationOpResponse': ModerationOpResponse,
    'ai.violationStatsResponse': ViolationStatsResponse,
    // ==========================================
    // Metrics & Security (v4.6 - 指标与安全持久化)
    // ==========================================
    'ai.qualityMetricsResponse': QualityMetricsResponse,
    'ai.conversionMetricsResponse': ConversionMetricsResponse,
    'ai.playgroundStatsResponse': PlaygroundStatsResponse,
    'ai.aiHealthMetricsResponse': AIHealthMetricsResponse,
    'ai.securitySensitiveWordsDBResponse': SecuritySensitiveWordsDBResponse,
    'ai.securityAddSensitiveWordResponse': SecurityAddSensitiveWordResponse,
    'ai.securityDeleteSensitiveWordResponse': SecurityDeleteSensitiveWordResponse,
    'ai.securityEventsResponse': SecurityEventsResponse,
    'ai.securityStatsDBResponse': SecurityStatsDBResponse,
    // ==========================================
    // AI 内容生成 (从 Growth 迁移)
    // ==========================================
    'ai.contentGenerationRequest': ContentGenerationRequest,
    'ai.contentGenerationResponse': ContentGenerationResponse,
});

// 导出 TS 类型
export type ChatInputText = Static<typeof ChatInputTextSchema>;
export type ChatInputAction = Static<typeof ChatInputActionSchema>;
export type ChatRequest = Static<typeof ChatRequestSchema>;
export type GenUIBlock = Static<typeof GenUIBlockSchema>;
export type ChatTurnEnvelope = Static<typeof ChatTurnEnvelopeSchema>;
export type ConversationRole = Static<typeof ConversationRole>;
export type ConversationMessageType = Static<typeof ConversationMessageType>;
export type ConversationsQuery = Static<typeof ConversationsQuery>;
export type ConversationMessagesQuery = Static<typeof ConversationMessagesQuery>;
export type ConversationIdParams = Static<typeof ConversationIdParams>;
export type ActivityConversationMessageParams = Static<typeof ActivityConversationMessageParams>;
export type ConversationMessageItem = Static<typeof ConversationMessageItem>;
export type ConversationsResponse = Static<typeof ConversationsResponse>;
export type ConversationMessagesResponse = Static<typeof ConversationMessagesResponse>;
export type ActivityConversationMessagesResponse = Static<typeof ActivityConversationMessagesResponse>;
export type AddMessageRequest = Static<typeof AddMessageRequest>;
export type AddMessageResponse = Static<typeof AddMessageResponse>;
export type ClearConversationsResponse = Static<typeof ClearConversationsResponse>;
export type ErrorResponse = Static<typeof ErrorResponse>;

// Welcome Card 类型导出 (v3.4 新增)
export type WelcomeResponse = Static<typeof WelcomeResponse>;
export type WelcomeQuery = Static<typeof WelcomeQuery>;
export type WelcomePendingActivity = Static<typeof WelcomePendingActivity>;

// Metrics 类型导出 (v3.4 新增)
export type MetricsUsageQuery = Static<typeof MetricsUsageQuery>;
export type DailyTokenUsage = Static<typeof DailyTokenUsage>;
export type TokenUsageSummary = Static<typeof TokenUsageSummary>;
export type ToolCallStats = Static<typeof ToolCallStats>;
export type MetricsUsageResponse = Static<typeof MetricsUsageResponse>;

// Prompt 类型导出 (v3.4 新增)
export type PromptInfoResponse = Static<typeof PromptInfoResponse>;

// AI 内容生成类型导出 (从 Growth 迁移)
export type ContentGenerationRequest = Static<typeof ContentGenerationRequest>;
export type GeneratedContentItem = Static<typeof GeneratedContentItem>;
export type ContentGenerationResponse = Static<typeof ContentGenerationResponse>;

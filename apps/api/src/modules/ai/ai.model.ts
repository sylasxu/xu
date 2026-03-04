// AI Model - v4.6 Chat-First: AI 解析 + 对话历史管理 + Admin 运营 Schema
import { Elysia, t, type Static } from 'elysia';
import { selectConversationSchema, selectMessageSchema } from '@juchang/db';

/**
 * AI Model Plugin - v3.3 Chat-First (行业标准命名)
 * 
 * 功能：
 * - AI 解析（魔法输入框）
 * - 对话历史管理（GET/POST/DELETE /ai/conversations）
 * - SSE 事件类型（创建场景 + 探索场景）
 */

// ==========================================
// AI 解析相关 Schema
// ==========================================

// AI 解析请求
const AIParseRequest = t.Object({
  text: t.String({ 
    description: '用户输入的自然语言文本',
    minLength: 2,
    maxLength: 500,
  }),
  location: t.Optional(t.Tuple([t.Number(), t.Number()], {
    description: '用户当前位置 [lng, lat]',
  })),
});

// AI 解析响应（SSE 流式返回的最终结果）
const AIParseResponse = t.Object({
  parsed: t.Object({
    title: t.Optional(t.String()),
    description: t.Optional(t.String()),
    type: t.Optional(t.String()),
    startAt: t.Optional(t.String()),
    endAt: t.Optional(t.String()),
    location: t.Optional(t.Tuple([t.Number(), t.Number()])),
    locationName: t.Optional(t.String()),
    address: t.Optional(t.String()),
    locationHint: t.Optional(t.String({ description: '重庆地形位置备注' })),
    maxParticipants: t.Optional(t.Number()),
    feeType: t.Optional(t.String()),
    estimatedCost: t.Optional(t.Number()),
  }),
  confidence: t.Number({ minimum: 0, maximum: 1 }),
  suggestions: t.Array(t.String()),
});

// ==========================================
// SSE 事件类型 (v3.2 新增探索场景)
// ==========================================

// SSE 事件类型枚举
const SSEEventType = t.Union([
  // 通用事件
  t.Literal('thinking'),    // AI 思考中
  t.Literal('chunk'),       // 流式文本块
  t.Literal('error'),       // 错误
  t.Literal('done'),        // 完成
  // 创建场景事件
  t.Literal('location'),    // 定位到位置
  t.Literal('draft'),       // 返回活动草稿
  // 探索场景事件 (v3.2 新增)
  t.Literal('searching'),   // 搜索中
  t.Literal('explore'),     // 返回探索结果
]);

// 探索结果项
const ExploreResultItem = t.Object({
  id: t.String(),
  title: t.String(),
  type: t.String(),
  lat: t.Number(),
  lng: t.Number(),
  locationName: t.String(),
  distance: t.Number({ description: '距离（米）' }),
  startAt: t.String(),
  currentParticipants: t.Number(),
  maxParticipants: t.Number(),
  score: t.Optional(t.Number({ description: '匹配分数 0-1' })),
  matchReason: t.Optional(t.String({ description: '推荐理由' })),
});

// 探索响应数据
const ExploreResponseData = t.Object({
  center: t.Object({
    lat: t.Number(),
    lng: t.Number(),
    name: t.String(),
  }),
  results: t.Array(ExploreResultItem),
  title: t.String({ description: '如：为你找到观音桥附近的 5 个热门活动' }),
});

// 活动草稿数据
const ActivityDraftData = t.Object({
  title: t.String(),
  description: t.Optional(t.String()),
  type: t.Union([
    t.Literal('food'),
    t.Literal('entertainment'),
    t.Literal('sports'),
    t.Literal('boardgame'),
    t.Literal('other'),
  ]),
  startAt: t.String(),
  location: t.Tuple([t.Number(), t.Number()]),
  locationName: t.String(),
  address: t.Optional(t.String()),
  locationHint: t.String(),
  maxParticipants: t.Number(),
  activityId: t.String({ description: '创建的 draft 活动 ID' }),
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
  t.Literal('widget_dashboard'),
  t.Literal('widget_launcher'),
  t.Literal('widget_action'),
  t.Literal('widget_draft'),
  t.Literal('widget_share'),
  t.Literal('widget_explore'),
  t.Literal('widget_error'),
  t.Literal('widget_ask_preference'),  // v3.5 多轮对话偏好询问卡片
]);

// 对话消息响应
const ConversationMessage = t.Object({
  id: t.String(),
  userId: t.String(),
  role: ConversationRole,
  type: ConversationMessageType,
  content: t.Any({ description: 'JSONB 内容，根据 type 不同结构不同' }),
  activityId: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});

// 获取对话历史查询参数 (增强版 - 按显式 ID 查询)
const ConversationsQuery = t.Object({
  // 分页参数
  cursor: t.Optional(t.String({ description: '分页游标（上一页最后一条消息的 ID）' })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20, description: '获取数量' })),
  // 查询参数：按用户 ID 获取会话列表（activityId 查询可不传）
  userId: t.Optional(t.String({ description: '目标用户ID；查询会话列表时必传' })),
  activityId: t.Optional(t.String({ description: '按关联活动 ID 筛选' })),
  messageType: t.Optional(t.String({ description: '按消息类型筛选' })),
  role: t.Optional(t.Union([t.Literal('user'), t.Literal('assistant')], { description: '按角色筛选' })),
});

// 对话消息响应 (增强版 - 包含用户信息)
const ConversationMessageWithUser = t.Object({
  id: t.String(),
  userId: t.String(),
  userNickname: t.Union([t.String(), t.Null()], { description: '用户昵称' }),
  role: ConversationRole,
  type: ConversationMessageType,
  content: t.Any({ description: 'JSONB 内容，根据 type 不同结构不同' }),
  activityId: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});

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

// 获取对话历史响应 (增强版)
// items 可以是消息列表（activityId 查询）或会话列表（userId 查询）
const ConversationsResponse = t.Object({
  items: t.Union([t.Array(ConversationMessageWithUser), t.Array(ConversationListItem)]),
  total: t.Number({ description: '总数量' }),
  hasMore: t.Boolean({ description: '是否还有更多消息' }),
  cursor: t.Union([t.String(), t.Null()], { description: '下一页游标' }),
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

const WelcomeResponse = t.Object({
  greeting: t.String({ description: '问候语' }),
  subGreeting: t.Optional(t.String({ description: '副标题' })),
  sections: t.Array(WelcomeSection, { description: '分组列表' }),
  socialProfile: t.Optional(SocialProfile),
  quickPrompts: t.Array(t.Object({
    icon: t.String(),
    text: t.String(),
    prompt: t.String(),
  }), { description: '快捷入口' }),
  ui: t.Optional(t.Object({
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
// Ops 子 Controller Schema (v4.6)
// 运营指标 - AI 特有聚合类型
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

// Ops 敏感词项（数据库版）
const OpsSensitiveWordItem = t.Object({
  id: t.String(),
  word: t.String(),
  category: t.Union([t.String(), t.Null()]),
  severity: t.Union([t.String(), t.Null()]),
  isActive: t.Union([t.Boolean(), t.Null()]),
  createdAt: t.String(),
});

// Ops 敏感词列表响应（数据库版）
const OpsSensitiveWordsDBResponse = t.Object({
  words: t.Array(OpsSensitiveWordItem),
  total: t.Number(),
});

// Ops 添加敏感词响应
const OpsAddSensitiveWordResponse = t.Object({
  success: t.Boolean(),
  message: t.String(),
  id: t.Optional(t.String()),
});

// Ops 删除敏感词响应
const OpsDeleteSensitiveWordResponse = t.Object({
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
    // AI 解析
    'ai.parseRequest': AIParseRequest,
    'ai.parseResponse': AIParseResponse,
    // SSE 事件类型 (v3.2 新增)
    'ai.sseEventType': SSEEventType,
    'ai.exploreResultItem': ExploreResultItem,
    'ai.exploreResponseData': ExploreResponseData,
    'ai.activityDraftData': ActivityDraftData,
    // 对话历史 (v3.2 新增)
    'ai.conversationMessage': ConversationMessage,
    'ai.conversationsQuery': ConversationsQuery,
    'ai.conversationsResponse': ConversationsResponse,
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
    // Ops (v4.6 - 运营指标)
    // ==========================================
    'ai.qualityMetricsResponse': QualityMetricsResponse,
    'ai.conversionMetricsResponse': ConversionMetricsResponse,
    'ai.playgroundStatsResponse': PlaygroundStatsResponse,
    'ai.aiHealthMetricsResponse': AIHealthMetricsResponse,
    'ai.opsSensitiveWordsDBResponse': OpsSensitiveWordsDBResponse,
    'ai.opsAddSensitiveWordResponse': OpsAddSensitiveWordResponse,
    'ai.opsDeleteSensitiveWordResponse': OpsDeleteSensitiveWordResponse,
    'ai.securityEventsResponse': SecurityEventsResponse,
    'ai.securityStatsDBResponse': SecurityStatsDBResponse,
    // ==========================================
    // AI 内容生成 (从 Growth 迁移)
    // ==========================================
    'ai.contentGenerationRequest': ContentGenerationRequest,
    'ai.contentGenerationResponse': ContentGenerationResponse,
  });

// 导出 TS 类型
export type AIParseRequest = Static<typeof AIParseRequest>;
export type AIParseResponse = Static<typeof AIParseResponse>;
export type SSEEventType = Static<typeof SSEEventType>;
export type ExploreResultItem = Static<typeof ExploreResultItem>;
export type ExploreResponseData = Static<typeof ExploreResponseData>;
export type ActivityDraftData = Static<typeof ActivityDraftData>;
export type ConversationRole = Static<typeof ConversationRole>;
export type ConversationMessageType = Static<typeof ConversationMessageType>;
export type ConversationMessage = Static<typeof ConversationMessage>;
export type ConversationsQuery = Static<typeof ConversationsQuery>;
export type ConversationsResponse = Static<typeof ConversationsResponse>;
export type AddMessageRequest = Static<typeof AddMessageRequest>;
export type AddMessageResponse = Static<typeof AddMessageResponse>;
export type ClearConversationsResponse = Static<typeof ClearConversationsResponse>;
export type ErrorResponse = Static<typeof ErrorResponse>;

// Welcome Card 类型导出 (v3.4 新增)
export type WelcomeResponse = Static<typeof WelcomeResponse>;
export type WelcomeQuery = Static<typeof WelcomeQuery>;

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

# Design Document: Chat Tool Mode Integration

## Overview

本设计文档描述了 Chat Tool Mode Integration 功能的技术实现方案。该功能旨在解决 4 个核心技术债，并全面集成 Chat Tool Mode 作为 P0 核心能力，确保产品架构与 PRD v4.8 和 TAD v4.6 的最新理念对齐。

**核心目标**：
1. 重构 Processor 架构，使所有 Processor 在 AI Playground 流程图中可见
2. 统一模型路由，移除硬编码模型名称，使用 getModelByIntent() 函数
3. 完善 P0 层热词管理 UI，支持运营人员实时配置全局关键词
4. 实现 Chat Tool Mode 核心能力（Skyline、动态消息、系统通知、半屏交互）

**技术栈**：
- 后端：Elysia + TypeBox + Drizzle ORM
- 前端 Admin：Vite + React 19 + TanStack Router + Eden Treaty
- 前端小程序：Native WeChat + Skyline + Zustand Vanilla
- AI：Qwen3 (flash/plus/max) + Vercel AI SDK

## Architecture

### 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     聚场 (JuChang) 系统架构                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 小程序主包   │  │ Chat Tool    │  │ Admin 后台   │          │
│  │ (WebView)    │  │ 分包(Skyline)│  │ (React SPA)  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └─────────────────┴─────────────────┘                   │
│                           │                                      │
│                           ▼                                      │
│         ┌─────────────────────────────────────┐                 │
│         │      Elysia API Gateway             │                 │
│         │  ┌───────────────────────────────┐  │                 │
│         │  │ /hot-keywords (P0 Layer)      │  │                 │
│         │  │ /ai (Processor Pipeline)      │  │                 │
│         │  │ /activities (CRUD + Join)     │  │                 │
│         │  │ /wechat (Chat Tool APIs)      │  │                 │
│         │  └───────────────────────────────┘  │                 │
│         └─────────────────┬───────────────────┘                 │
│                           │                                      │
│                           ▼                                      │
│         ┌─────────────────────────────────────┐                 │
│         │   PostgreSQL + PostGIS + pgvector   │                 │
│         │  ┌───────────────────────────────┐  │                 │
│         │  │ global_keywords (热词表)      │  │                 │
│         │  │ activities (活动表)           │  │                 │
│         │  │ conversations (对话表)        │  │                 │
│         │  │ ai_requests (AI 请求日志)     │  │                 │
│         │  └───────────────────────────────┘  │                 │
│         └─────────────────────────────────────┘                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```


### 架构分层

| 层级 | 职责 | 组件 |
|------|------|------|
| **表现层** | 用户交互、UI 渲染 | 小程序主包、Chat Tool 分包、Admin 后台 |
| **API 层** | 路由、认证、参数验证 | Elysia Controllers |
| **业务层** | 核心业务逻辑 | Service 纯函数 |
| **AI 层** | 意图识别、模型路由、Processor 管道 | AI Module (Processors + Models + Tools) |
| **数据层** | 数据持久化、查询 | Drizzle ORM + PostgreSQL |

### 核心设计决策

**1. Processor 架构重构**

**问题**：当前 save-history 和 extract-preferences 在 onFinish 回调中异步执行，导致 AI Playground 流程图无法显示这些节点。

**解决方案**：
- 将所有 Processor 移到主流程中同步执行
- 使用 Vercel AI SDK 的 middleware 机制注入 Processor
- 每个 Processor 返回执行结果，供 AI Playground 可视化

**技术实现**：
```typescript
// 旧架构（v4.5）
const result = await streamText({
  model,
  messages,
  tools,
  onFinish: async (result) => {
    // ❌ 异步执行，流程图看不到
    await saveConversationHistory(result);
    await extractAndUpdatePreferences(result);
  },
});

// 新架构（v4.6）
const result = await streamText({
  model,
  messages,
  tools,
  experimental_transform: compose(
    // ✅ 同步执行，流程图可见
    inputGuardProcessor(),
    userProfileProcessor(userId),
    semanticRecallProcessor(userId),
    tokenLimitProcessor(),
  ),
  onFinish: async (result) => {
    // 仅保留必须异步的操作
    await saveHistoryProcessor(result);
    await extractPreferencesProcessor(result);
  },
});
```

**2. 模型路由统一**

**问题**：代码中存在硬编码的模型名称（如 'qwen-flash'），导致模型切换困难。

**解决方案**：
- 创建 getModelByIntent() 函数，根据意图选择模型
- 移除所有硬编码模型名称
- 支持模型降级和重试

**技术实现**：
```typescript
// apps/api/src/modules/ai/models/router.ts

export function getModelByIntent(intent: 'chat' | 'reasoning' | 'agent' | 'vision'): LanguageModel {
  switch (intent) {
    case 'chat':
      return qwen('qwen-flash');      // 极速闲聊
    case 'reasoning':
      return qwen('qwen-plus');       // 深度推理
    case 'agent':
      return qwen('qwen-max');        // Tool Calling
    case 'vision':
      return qwen('qwen-vl-max');     // 视觉理解
  }
}

// 使用示例
const model = getModelByIntent('agent');
const result = await streamText({ model, messages, tools });
```

**3. P0 层热词管理**

**问题**：热词管理 UI 不完整，运营人员无法实时配置全局关键词。

**解决方案**：
- 完善 Admin 后台热词管理界面
- 支持 CRUD 操作、有效期配置、匹配方式选择
- 提供热词分析（命中率、转化率、趋势图）

**数据流**：
```
运营人员 → Admin UI → Eden Treaty → /hot-keywords/admin API → DB
                                                              ↓
用户输入 → P0 Layer → matchKeyword() → 缓存/DB → 返回预设响应
```

**4. Chat Tool Mode 核心能力**

**问题**：Chat Tool Mode 仅有基本实现，缺少动态消息、系统通知、半屏交互等核心能力。

**解决方案**：
- 使用 Skyline 渲染引擎创建独立分包
- 实现动态消息更新（setChatToolMsg）
- 实现系统通知（群内事件自动冒泡）
- 实现混合通知策略（Chat Tool Mode 系统消息 + 服务通知）

**技术实现**：
```typescript
// 动态消息更新
await wx.setChatToolMsg({
  activityId: activity.dynamicMessageId,
  subtitle: `${activity.currentParticipants}人已参与`,
});

// 系统通知
await wx.sendChatToolSystemMessage({
  groupOpenId: activity.groupOpenId,
  content: `${user.nickname} 已参与 ${creator.nickname} 发布的 ${activity.title}`,
});
```


## Components and Interfaces

### 1. Processor 架构组件

#### 1.1 Processor 接口定义

```typescript
// apps/api/src/modules/ai/processors/types.ts

export interface ProcessorContext {
  userId: string | null;
  conversationId?: string;
  userLocation?: { lat: number; lng: number };
  timestamp: Date;
}

export interface ProcessorResult {
  processorName: string;
  executionTime: number;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export type Processor = (
  context: ProcessorContext,
  input: any
) => Promise<ProcessorResult>;
```

#### 1.2 Processor 实现

**Input Guard Processor**
```typescript
// apps/api/src/modules/ai/processors/input-guard.ts

export function inputGuardProcessor(): Processor {
  return async (context, input) => {
    const startTime = Date.now();
    
    // 敏感词检测
    const hasSensitiveWords = await checkSensitiveWords(input);
    if (hasSensitiveWords) {
      return {
        processorName: 'input-guard',
        executionTime: Date.now() - startTime,
        success: false,
        error: '输入包含敏感词',
      };
    }
    
    // 注入攻击检测
    const hasInjection = detectInjection(input);
    if (hasInjection) {
      return {
        processorName: 'input-guard',
        executionTime: Date.now() - startTime,
        success: false,
        error: '输入包含非法字符',
      };
    }
    
    return {
      processorName: 'input-guard',
      executionTime: Date.now() - startTime,
      success: true,
      data: { sanitized: input },
    };
  };
}
```

**User Profile Processor**
```typescript
// apps/api/src/modules/ai/processors/user-profile.ts

export function userProfileProcessor(userId: string | null): Processor {
  return async (context, input) => {
    const startTime = Date.now();
    
    if (!userId) {
      return {
        processorName: 'user-profile',
        executionTime: Date.now() - startTime,
        success: true,
        data: { profile: null },
      };
    }
    
    const user = await getUserById(userId);
    const profile = user?.workingMemory as EnhancedUserProfile | null;
    
    return {
      processorName: 'user-profile',
      executionTime: Date.now() - startTime,
      success: true,
      data: { profile },
    };
  };
}
```

**Semantic Recall Processor**
```typescript
// apps/api/src/modules/ai/processors/semantic-recall.ts

export function semanticRecallProcessor(userId: string | null): Processor {
  return async (context, input) => {
    const startTime = Date.now();
    
    if (!userId) {
      return {
        processorName: 'semantic-recall',
        executionTime: Date.now() - startTime,
        success: true,
        data: { activities: [] },
      };
    }
    
    // 语义检索用户参与过的活动
    const activities = await searchUserActivities(userId, input, { limit: 3 });
    
    return {
      processorName: 'semantic-recall',
      executionTime: Date.now() - startTime,
      success: true,
      data: { activities },
    };
  };
}
```

**Token Limit Processor**
```typescript
// apps/api/src/modules/ai/processors/token-limit.ts

export function tokenLimitProcessor(maxTokens: number = 4000): Processor {
  return async (context, input) => {
    const startTime = Date.now();
    
    const tokenCount = estimateTokens(input);
    
    if (tokenCount > maxTokens) {
      const truncated = truncateToTokenLimit(input, maxTokens);
      return {
        processorName: 'token-limit',
        executionTime: Date.now() - startTime,
        success: true,
        data: { truncated: true, original: tokenCount, final: maxTokens },
      };
    }
    
    return {
      processorName: 'token-limit',
      executionTime: Date.now() - startTime,
      success: true,
      data: { truncated: false, tokenCount },
    };
  };
}
```

**Save History Processor**
```typescript
// apps/api/src/modules/ai/processors/save-history.ts

export function saveHistoryProcessor(result: any): Processor {
  return async (context, input) => {
    const startTime = Date.now();
    
    if (!context.userId) {
      return {
        processorName: 'save-history',
        executionTime: Date.now() - startTime,
        success: true,
        data: { saved: false, reason: 'no-user' },
      };
    }
    
    await saveConversationMessage({
      conversationId: context.conversationId,
      userId: context.userId,
      role: 'assistant',
      content: result.text,
      activityId: result.activityId,
    });
    
    return {
      processorName: 'save-history',
      executionTime: Date.now() - startTime,
      success: true,
      data: { saved: true },
    };
  };
}
```

**Extract Preferences Processor**
```typescript
// apps/api/src/modules/ai/processors/extract-preferences.ts

export function extractPreferencesProcessor(result: any): Processor {
  return async (context, input) => {
    const startTime = Date.now();
    
    if (!context.userId) {
      return {
        processorName: 'extract-preferences',
        executionTime: Date.now() - startTime,
        success: true,
        data: { extracted: false, reason: 'no-user' },
      };
    }
    
    const preferences = await extractPreferencesFromConversation(
      context.userId,
      result.messages
    );
    
    if (preferences.length > 0) {
      await updateEnhancedUserProfile(context.userId, { preferences });
    }
    
    return {
      processorName: 'extract-preferences',
      executionTime: Date.now() - startTime,
      success: true,
      data: { extracted: preferences.length, preferences },
    };
  };
}
```

### 2. 模型路由组件

#### 2.1 模型路由接口

```typescript
// apps/api/src/modules/ai/models/types.ts

export type ModelIntent = 'chat' | 'reasoning' | 'agent' | 'vision';

export interface ModelConfig {
  provider: 'qwen' | 'deepseek';
  modelId: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ModelRouterOptions {
  intent: ModelIntent;
  fallback?: boolean;
  retries?: number;
}
```

#### 2.2 模型路由实现

```typescript
// apps/api/src/modules/ai/models/router.ts

export function getModelByIntent(intent: ModelIntent): LanguageModel {
  const config = MODEL_CONFIGS[intent];
  
  switch (config.provider) {
    case 'qwen':
      return qwen(config.modelId);
    case 'deepseek':
      return deepseek(config.modelId);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

const MODEL_CONFIGS: Record<ModelIntent, ModelConfig> = {
  chat: {
    provider: 'qwen',
    modelId: 'qwen-flash',
    maxTokens: 2000,
    temperature: 0.7,
  },
  reasoning: {
    provider: 'qwen',
    modelId: 'qwen-plus',
    maxTokens: 4000,
    temperature: 0.5,
  },
  agent: {
    provider: 'qwen',
    modelId: 'qwen-max',
    maxTokens: 4000,
    temperature: 0.3,
  },
  vision: {
    provider: 'qwen',
    modelId: 'qwen-vl-max',
    maxTokens: 4000,
    temperature: 0.5,
  },
};

// 带降级的模型调用
export async function callWithFallback(
  intent: ModelIntent,
  params: any
): Promise<any> {
  try {
    const model = getModelByIntent(intent);
    return await streamText({ model, ...params });
  } catch (error) {
    // 降级到 DeepSeek
    const fallbackModel = deepseek('deepseek-chat');
    return await streamText({ model: fallbackModel, ...params });
  }
}
```


### 3. P0 层热词管理组件

#### 3.1 热词数据模型

```typescript
// packages/db/src/schema/global_keywords.ts (已存在)

export const globalKeywords = pgTable('global_keywords', {
  id: uuid('id').primaryKey().defaultRandom(),
  keyword: varchar('keyword', { length: 100 }).notNull(),
  matchType: matchTypeEnum('match_type').notNull(),
  responseType: responseTypeEnum('response_type').notNull(),
  responseContent: jsonb('response_content').notNull(),
  priority: integer('priority').default(0).notNull(),
  validFrom: timestamp('valid_from'),
  validUntil: timestamp('valid_until'),
  isActive: boolean('is_active').default(true).notNull(),
  hitCount: integer('hit_count').default(0).notNull(),
  conversionCount: integer('conversion_count').default(0).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const matchTypeEnum = pgEnum('match_type', ['exact', 'prefix', 'fuzzy']);
export const responseTypeEnum = pgEnum('response_type', [
  'widget_explore',
  'widget_draft',
  'widget_launcher',
  'widget_action',
  'widget_ask_preference',
  'text',
]);
```

#### 3.2 热词匹配逻辑

```typescript
// apps/api/src/modules/hot-keywords/hot-keywords.service.ts

export async function matchKeyword(userInput: string): Promise<GlobalKeywordResponse | null> {
  const normalizedInput = userInput.trim().toLowerCase();
  
  // 尝试从缓存获取
  const cacheKey = `hot_kw:match:${normalizedInput}`;
  const cached = await getCache(cacheKey);
  if (cached) return cached;

  const now = new Date();
  
  // 获取所有活跃的关键词（按优先级和长度排序）
  const activeKeywords = await db
    .select()
    .from(globalKeywords)
    .where(
      and(
        eq(globalKeywords.isActive, true),
        sql`(${globalKeywords.validFrom} IS NULL OR ${globalKeywords.validFrom} <= ${toTimestamp(now)})`,
        sql`(${globalKeywords.validUntil} IS NULL OR ${globalKeywords.validUntil} >= ${toTimestamp(now)})`
      )
    )
    .orderBy(
      desc(globalKeywords.priority),
      sql`length(${globalKeywords.keyword}) DESC`
    );

  // 匹配逻辑
  for (const kw of activeKeywords) {
    const normalizedKeyword = kw.keyword.toLowerCase();
    
    let matched = false;
    switch (kw.matchType) {
      case 'exact':
        matched = normalizedInput === normalizedKeyword;
        break;
      case 'prefix':
        matched = normalizedInput.startsWith(normalizedKeyword);
        break;
      case 'fuzzy':
        matched = normalizedInput.includes(normalizedKeyword);
        break;
    }

    if (matched) {
      await setCache(cacheKey, kw);
      return kw;
    }
  }

  return null;
}
```

#### 3.3 Admin 热词管理 UI 组件

**热词列表组件**
```typescript
// apps/admin/src/features/hot-keywords/components/hot-keywords-list.tsx

export function HotKeywordsList() {
  const { data, isLoading } = useHotKeywords();
  
  return (
    <DataTable
      columns={hotKeywordsColumns}
      data={data?.data || []}
      loading={isLoading}
      searchKey="keyword"
      filterOptions={[
        { key: 'isActive', label: '状态', options: ['活跃', '已停用'] },
        { key: 'matchType', label: '匹配方式', options: ['完全匹配', '前缀匹配', '模糊匹配'] },
      ]}
    />
  );
}
```

**热词表单组件**
```typescript
// apps/admin/src/features/hot-keywords/components/hot-keyword-form.tsx

export function HotKeywordForm({ keyword, onSuccess }: HotKeywordFormProps) {
  const form = useForm({
    defaultValues: keyword || {
      keyword: '',
      matchType: 'exact',
      responseType: 'widget_explore',
      responseContent: {},
      priority: 0,
    },
  });
  
  const mutation = keyword 
    ? useUpdateKeyword(keyword.id)
    : useCreateKeyword();
  
  const onSubmit = (data: HotKeywordFormData) => {
    mutation.mutate(data, {
      onSuccess: () => {
        toast.success(keyword ? '热词已更新' : '热词已创建');
        onSuccess?.();
      },
    });
  };
  
  return (
    <Form {...form}>
      <FormField name="keyword" label="关键词" required />
      <FormField name="matchType" label="匹配方式" type="select" options={matchTypeOptions} />
      <FormField name="responseType" label="响应类型" type="select" options={responseTypeOptions} />
      <FormField name="responseContent" label="响应内容" type="json" />
      <FormField name="priority" label="优先级" type="number" />
      <FormField name="validFrom" label="生效时间" type="datetime" />
      <FormField name="validUntil" label="失效时间" type="datetime" />
      <Button type="submit" loading={mutation.isPending}>
        {keyword ? '更新' : '创建'}
      </Button>
    </Form>
  );
}
```

**热词分析组件**
```typescript
// apps/admin/src/features/hot-keywords/components/hot-keywords-analytics.tsx

export function HotKeywordsAnalytics() {
  const { data } = useKeywordAnalytics({ period: '7d' });
  
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>热词命中率 Top 10</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart
            data={data?.data || []}
            xKey="keyword"
            yKey="hitCount"
            height={300}
          />
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>转化率分析</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>关键词</TableHead>
                <TableHead>命中次数</TableHead>
                <TableHead>转化次数</TableHead>
                <TableHead>转化率</TableHead>
                <TableHead>趋势</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.data.map((item) => (
                <TableRow key={item.keyword}>
                  <TableCell>{item.keyword}</TableCell>
                  <TableCell>{item.hitCount}</TableCell>
                  <TableCell>{item.conversionCount}</TableCell>
                  <TableCell>{item.conversionRate.toFixed(2)}%</TableCell>
                  <TableCell>
                    <TrendBadge trend={item.trend} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 4. Chat Tool Mode 组件

#### 4.1 小程序分包配置

```json
// apps/miniprogram/app.json

{
  "subPackages": [
    {
      "root": "packageChatTool",
      "name": "chatTool",
      "pages": [
        "pages/activity-detail/index"
      ],
      "independent": true,
      "componentFramework": "glass-easel",
      "renderer": "skyline"
    }
  ],
  "chatTools": [
    {
      "root": "packageChatTool",
      "entryPagePath": "pages/activity-detail/index",
      "desc": "群内快速组局",
      "scopes": ["scope.userLocation"]
    }
  ]
}
```

#### 4.2 动态消息 API

```typescript
// apps/api/src/modules/wechat/wechat.service.ts

export async function createDynamicMessage(activityId: string): Promise<string> {
  const activity = await getActivityById(activityId);
  
  const response = await fetch('https://api.weixin.qq.com/cgi-bin/message/custom/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      touser: activity.groupOpenId,
      msgtype: 'miniprogrampage',
      miniprogrampage: {
        title: activity.title,
        pagepath: `packageChatTool/pages/activity-detail/index?id=${activityId}`,
        thumb_media_id: activity.coverImageId,
      },
    }),
  });
  
  const data = await response.json();
  return data.activity_id; // 微信返回的动态消息 ID
}

export async function updateDynamicMessage(
  activityId: string,
  dynamicMessageId: string,
  subtitle: string
): Promise<void> {
  await fetch('https://api.weixin.qq.com/cgi-bin/message/custom/updatemsg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      activity_id: dynamicMessageId,
      target_state: 1,
      template_info: {
        parameter_list: [
          {
            name: 'member_count',
            value: subtitle,
          },
        ],
      },
    }),
  });
}

export async function sendSystemNotification(
  groupOpenId: string,
  content: string
): Promise<void> {
  await fetch('https://api.weixin.qq.com/cgi-bin/message/custom/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      touser: groupOpenId,
      msgtype: 'text',
      text: {
        content,
      },
    }),
  });
}
```

#### 4.3 活动详情页双模式适配

```typescript
// apps/miniprogram/packageChatTool/pages/activity-detail/index.ts

Page({
  data: {
    isChatToolMode: false,
    activity: null,
  },
  
  onLoad(options: { id: string }) {
    // 检测当前模式
    const apiCategory = wx.getApiCategory();
    const isChatToolMode = apiCategory === 'chatTool';
    
    this.setData({ isChatToolMode });
    
    // 加载活动详情
    this.loadActivity(options.id);
  },
  
  async loadActivity(id: string) {
    const activity = await api.activities.getById({ params: { id } });
    this.setData({ activity });
  },
  
  async handleJoin() {
    const { activity, isChatToolMode } = this.data;
    
    // 报名活动
    await api.activities.join({ params: { id: activity.id } });
    
    if (isChatToolMode && activity.dynamicMessageId) {
      // 更新动态消息
      await wx.setChatToolMsg({
        activityId: activity.dynamicMessageId,
        subtitle: `${activity.currentParticipants + 1}人已参与`,
      });
      
      // 发送系统通知
      const user = useUserStore.getState().user;
      await api.wechat.sendSystemNotification({
        groupOpenId: activity.groupOpenId,
        content: `${user.nickname} 已参与 ${activity.creator.nickname} 发布的 ${activity.title}`,
      });
    }
    
    // 刷新活动详情
    this.loadActivity(activity.id);
  },
});
```

#### 4.4 Hot Chips 组件

```typescript
// apps/miniprogram/components/hot-chips/index.ts

Component({
  data: {
    chips: [],
  },
  
  lifetimes: {
    async attached() {
      await this.loadHotChips();
    },
  },
  
  methods: {
    async loadHotChips() {
      const location = await wx.getLocation({ type: 'wgs84' });
      
      const response = await api.hotKeywords.getActive({
        query: {
          limit: 5,
          lat: location.latitude,
          lng: location.longitude,
        },
      });
      
      this.setData({ chips: response.data });
    },
    
    handleChipTap(e: any) {
      const { keyword } = e.currentTarget.dataset;
      
      // 触发父组件的发送消息事件
      this.triggerEvent('send', { keyword });
      
      // 记录点击事件
      api.hotKeywords.incrementHitCount({ params: { id: keyword.id } });
    },
  },
});
```

### 5. AI Playground 流程图组件

#### 5.1 流程图数据结构

```typescript
// apps/admin/src/features/ai-ops/types/flow.ts

export interface FlowNode {
  id: string;
  type: 'input' | 'processor' | 'p0' | 'p1' | 'llm' | 'tool' | 'output';
  label: string;
  status: 'pending' | 'running' | 'success' | 'error';
  data: Record<string, unknown>;
  executionTime?: number;
  timestamp: Date;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
```

#### 5.2 流程图构建器

```typescript
// apps/admin/src/features/ai-ops/components/flow/utils/flow-builder.ts

export function buildFlowGraph(executionLog: AIExecutionLog): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  
  // 1. Input 节点
  nodes.push({
    id: 'input',
    type: 'input',
    label: '用户输入',
    status: 'success',
    data: { message: executionLog.input },
    timestamp: executionLog.startTime,
  });
  
  let prevNodeId = 'input';
  
  // 2. Processor 节点
  executionLog.processors.forEach((processor, index) => {
    const nodeId = `processor-${index}`;
    nodes.push({
      id: nodeId,
      type: 'processor',
      label: processor.name,
      status: processor.success ? 'success' : 'error',
      data: processor.data,
      executionTime: processor.executionTime,
      timestamp: processor.timestamp,
    });
    
    edges.push({
      id: `${prevNodeId}-${nodeId}`,
      source: prevNodeId,
      target: nodeId,
    });
    
    prevNodeId = nodeId;
  });
  
  // 3. P0 Match 节点（如果有）
  if (executionLog.p0Match) {
    const nodeId = 'p0-match';
    nodes.push({
      id: nodeId,
      type: 'p0',
      label: 'P0 热词匹配',
      status: 'success',
      data: { keyword: executionLog.p0Match.keyword },
      timestamp: executionLog.p0Match.timestamp,
    });
    
    edges.push({
      id: `${prevNodeId}-${nodeId}`,
      source: prevNodeId,
      target: nodeId,
    });
    
    prevNodeId = nodeId;
  }
  
  // 4. P1 Intent 节点
  if (executionLog.intent) {
    const nodeId = 'p1-intent';
    nodes.push({
      id: nodeId,
      type: 'p1',
      label: 'P1 意图识别',
      status: 'success',
      data: { intent: executionLog.intent },
      timestamp: executionLog.intentTimestamp,
    });
    
    edges.push({
      id: `${prevNodeId}-${nodeId}`,
      source: prevNodeId,
      target: nodeId,
    });
    
    prevNodeId = nodeId;
  }
  
  // 5. LLM 节点
  const llmNodeId = 'llm';
  nodes.push({
    id: llmNodeId,
    type: 'llm',
    label: executionLog.model,
    status: 'success',
    data: {
      inputTokens: executionLog.inputTokens,
      outputTokens: executionLog.outputTokens,
    },
    executionTime: executionLog.llmExecutionTime,
    timestamp: executionLog.llmStartTime,
  });
  
  edges.push({
    id: `${prevNodeId}-${llmNodeId}`,
    source: prevNodeId,
    target: llmNodeId,
  });
  
  prevNodeId = llmNodeId;
  
  // 6. Tool Calls 节点
  executionLog.toolCalls.forEach((tool, index) => {
    const nodeId = `tool-${index}`;
    nodes.push({
      id: nodeId,
      type: 'tool',
      label: tool.name,
      status: tool.success ? 'success' : 'error',
      data: tool.result,
      executionTime: tool.executionTime,
      timestamp: tool.timestamp,
    });
    
    edges.push({
      id: `${prevNodeId}-${nodeId}`,
      source: prevNodeId,
      target: nodeId,
    });
    
    prevNodeId = nodeId;
  });
  
  // 7. Output 节点
  nodes.push({
    id: 'output',
    type: 'output',
    label: 'AI 响应',
    status: 'success',
    data: { response: executionLog.output },
    timestamp: executionLog.endTime,
  });
  
  edges.push({
    id: `${prevNodeId}-output`,
    source: prevNodeId,
    target: 'output',
  });
  
  return { nodes, edges };
}
```


#### 5.3 流程图渲染组件

```typescript
// apps/admin/src/features/ai-ops/components/flow/flow-canvas.tsx

export function FlowCanvas({ executionLog }: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  
  useEffect(() => {
    const flowGraph = buildFlowGraph(executionLog);
    
    // 使用 Dagre 自动布局
    const layoutedGraph = getLayoutedElements(flowGraph.nodes, flowGraph.edges);
    
    setNodes(layoutedGraph.nodes);
    setEdges(layoutedGraph.edges);
  }, [executionLog]);
  
  const onNodeClick = (event: React.MouseEvent, node: Node) => {
    setSelectedNode(node.data as FlowNode);
  };
  
  return (
    <div className="flex h-full">
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      
      {selectedNode && (
        <NodeDetailDrawer
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
```

## Data Models

### 1. 数据库 Schema 更新

#### 1.1 activities 表新增字段

```typescript
// packages/db/src/schema/activities.ts

export const activities = pgTable('activities', {
  // ... 现有字段
  
  // Chat Tool Mode 字段 (v4.8 新增)
  groupOpenId: varchar('group_openid', { length: 128 }),  // 群聊标识
  dynamicMessageId: varchar('dynamic_message_id', { length: 128 }),  // 微信动态消息 ID
});
```

**迁移脚本**：
```sql
-- 添加 Chat Tool Mode 字段
ALTER TABLE activities 
ADD COLUMN group_openid VARCHAR(128),
ADD COLUMN dynamic_message_id VARCHAR(128);

-- 添加索引
CREATE INDEX idx_activities_group_openid ON activities(group_openid);
```

#### 1.2 participants 表新增字段

```typescript
// packages/db/src/schema/participants.ts

export const participants = pgTable('participants', {
  // ... 现有字段
  
  // Chat Tool Mode 字段 (v4.8 新增)
  groupOpenId: varchar('group_openid', { length: 128 }),  // 群成员标识
});
```

**迁移脚本**：
```sql
-- 添加群成员标识字段
ALTER TABLE participants 
ADD COLUMN group_openid VARCHAR(128);
```

#### 1.3 notifications 表新增字段

```typescript
// packages/db/src/schema/notifications.ts

export const notifications = pgTable('notifications', {
  // ... 现有字段
  
  // 通知类型字段 (v4.8 新增)
  notificationType: notificationTypeEnum('notification_type').default('service_notification').notNull(),
});

export const notificationTypeEnum = pgEnum('notification_type', [
  'system_message',        // Chat Tool Mode 系统消息
  'service_notification',  // 服务通知
]);
```

**迁移脚本**：
```sql
-- 创建通知类型枚举
CREATE TYPE notification_type AS ENUM ('system_message', 'service_notification');

-- 添加通知类型字段
ALTER TABLE notifications 
ADD COLUMN notification_type notification_type DEFAULT 'service_notification' NOT NULL;
```

#### 1.4 ai_requests 表新增字段

```typescript
// packages/db/src/schema/ai_requests.ts

export const aiRequests = pgTable('ai_requests', {
  // ... 现有字段
  
  // Processor 执行日志 (v4.6 新增)
  processorLog: jsonb('processor_log').$type<ProcessorResult[]>(),
  
  // P0 层匹配结果 (v4.8 新增)
  p0MatchKeyword: varchar('p0_match_keyword', { length: 100 }),
});
```

**迁移脚本**：
```sql
-- 添加 Processor 日志字段
ALTER TABLE ai_requests 
ADD COLUMN processor_log JSONB,
ADD COLUMN p0_match_keyword VARCHAR(100);

-- 添加索引
CREATE INDEX idx_ai_requests_p0_match ON ai_requests(p0_match_keyword);
```

### 2. TypeBox Schema 派生

#### 2.1 热词 Schema

```typescript
// apps/api/src/modules/hot-keywords/hot-keywords.model.ts

import { selectGlobalKeywordSchema, insertGlobalKeywordSchema } from '@juchang/db';

// ✅ 从 DB 派生响应 Schema
const GlobalKeywordResponse = t.Object({
  id: t.String(),
  keyword: t.String(),
  matchType: t.Union([t.Literal('exact'), t.Literal('prefix'), t.Literal('fuzzy')]),
  responseType: t.Union([
    t.Literal('widget_explore'),
    t.Literal('widget_draft'),
    t.Literal('widget_launcher'),
    t.Literal('widget_action'),
    t.Literal('widget_ask_preference'),
    t.Literal('text'),
  ]),
  responseContent: t.Any(),
  priority: t.Number(),
  validFrom: t.Union([t.String(), t.Null()]),
  validUntil: t.Union([t.String(), t.Null()]),
  isActive: t.Boolean(),
  hitCount: t.Number(),
  conversionCount: t.Number(),
  createdBy: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  updatedAt: t.String(),
});

// ✅ 从 DB 派生创建 Schema
const CreateGlobalKeywordRequest = t.Object({
  keyword: t.String({ minLength: 1, maxLength: 100 }),
  matchType: t.Union([t.Literal('exact'), t.Literal('prefix'), t.Literal('fuzzy')]),
  responseType: t.Union([
    t.Literal('widget_explore'),
    t.Literal('widget_draft'),
    t.Literal('widget_launcher'),
    t.Literal('widget_action'),
    t.Literal('widget_ask_preference'),
    t.Literal('text'),
  ]),
  responseContent: t.Any(),
  priority: t.Optional(t.Number({ default: 0 })),
  validFrom: t.Optional(t.Union([t.String(), t.Null()])),
  validUntil: t.Optional(t.Union([t.String(), t.Null()])),
});
```

#### 2.2 活动 Schema 更新

```typescript
// apps/api/src/modules/activities/activities.model.ts

import { selectActivitySchema } from '@juchang/db';

// ✅ 从 DB 派生，包含新增字段
const ActivityResponse = t.Object({
  id: t.String(),
  title: t.String(),
  // ... 其他字段
  groupOpenId: t.Union([t.String(), t.Null()]),
  dynamicMessageId: t.Union([t.String(), t.Null()]),
});
```

### 3. API 接口定义

#### 3.1 热词管理 API

```typescript
// apps/api/src/modules/hot-keywords/hot-keywords.controller.ts

export const hotKeywordsController = new Elysia({ prefix: '/hot-keywords' })
  .use(basePlugins)
  .use(hotKeywordsModel)
  
  // 小程序获取热词列表
  .get('/', async ({ query }) => {
    const keywords = await getActiveHotKeywords(query);
    return { data: keywords };
  }, {
    query: 'hotKeywords.query',
    response: { 200: 'hotKeywords.listResponse' },
  })
  
  // Admin 获取所有热词
  .get('/admin', async ({ query, jwt, headers }) => {
    const user = await verifyAuth(jwt, headers);
    if (!user) {
      set.status = 401;
      return { code: 401, msg: '未授权' };
    }
    
    const keywords = await listKeywords(query);
    return { data: keywords };
  }, {
    query: 'hotKeywords.adminQuery',
    response: { 200: 'hotKeywords.adminListResponse', 401: 'hotKeywords.error' },
  })
  
  // Admin 创建热词
  .post('/admin', async ({ body, jwt, headers }) => {
    const user = await verifyAuth(jwt, headers);
    if (!user) {
      set.status = 401;
      return { code: 401, msg: '未授权' };
    }
    
    const keyword = await createKeyword(body, user.id);
    return { data: keyword };
  }, {
    body: 'hotKeywords.createRequest',
    response: { 200: 'hotKeywords.createResponse', 401: 'hotKeywords.error' },
  })
  
  // Admin 更新热词
  .patch('/admin/:id', async ({ params, body, jwt, headers }) => {
    const user = await verifyAuth(jwt, headers);
    if (!user) {
      set.status = 401;
      return { code: 401, msg: '未授权' };
    }
    
    const keyword = await updateKeyword(params.id, body);
    return { data: keyword };
  }, {
    params: 'hotKeywords.idParams',
    body: 'hotKeywords.updateRequest',
    response: { 200: 'hotKeywords.updateResponse', 401: 'hotKeywords.error' },
  })
  
  // Admin 删除热词
  .delete('/admin/:id', async ({ params, jwt, headers }) => {
    const user = await verifyAuth(jwt, headers);
    if (!user) {
      set.status = 401;
      return { code: 401, msg: '未授权' };
    }
    
    await deleteKeyword(params.id);
    return { success: true };
  }, {
    params: 'hotKeywords.idParams',
    response: { 200: 'hotKeywords.deleteResponse', 401: 'hotKeywords.error' },
  })
  
  // Admin 获取热词分析
  .get('/admin/analytics', async ({ query, jwt, headers }) => {
    const user = await verifyAuth(jwt, headers);
    if (!user) {
      set.status = 401;
      return { code: 401, msg: '未授权' };
    }
    
    const analytics = await getKeywordAnalytics(query.period);
    return { data: analytics };
  }, {
    query: 'hotKeywords.analyticsQuery',
    response: { 200: 'hotKeywords.analyticsResponse', 401: 'hotKeywords.error' },
  });
```

#### 3.2 WeChat Chat Tool API

```typescript
// apps/api/src/modules/wechat/wechat.controller.ts

export const wechatController = new Elysia({ prefix: '/wechat' })
  .use(basePlugins)
  .use(wechatModel)
  
  // 创建动态消息
  .post('/dynamic-message', async ({ body, jwt, headers }) => {
    const user = await verifyAuth(jwt, headers);
    if (!user) {
      set.status = 401;
      return { code: 401, msg: '未授权' };
    }
    
    const dynamicMessageId = await createDynamicMessage(body.activityId);
    return { data: { dynamicMessageId } };
  }, {
    body: 'wechat.createDynamicMessageRequest',
    response: { 200: 'wechat.createDynamicMessageResponse', 401: 'wechat.error' },
  })
  
  // 更新动态消息
  .patch('/dynamic-message/:activityId', async ({ params, body, jwt, headers }) => {
    const user = await verifyAuth(jwt, headers);
    if (!user) {
      set.status = 401;
      return { code: 401, msg: '未授权' };
    }
    
    await updateDynamicMessage(params.activityId, body.dynamicMessageId, body.subtitle);
    return { success: true };
  }, {
    params: 'wechat.activityIdParams',
    body: 'wechat.updateDynamicMessageRequest',
    response: { 200: 'wechat.updateDynamicMessageResponse', 401: 'wechat.error' },
  })
  
  // 发送系统通知
  .post('/system-notification', async ({ body, jwt, headers }) => {
    const user = await verifyAuth(jwt, headers);
    if (!user) {
      set.status = 401;
      return { code: 401, msg: '未授权' };
    }
    
    await sendSystemNotification(body.groupOpenId, body.content);
    return { success: true };
  }, {
    body: 'wechat.sendSystemNotificationRequest',
    response: { 200: 'wechat.sendSystemNotificationResponse', 401: 'wechat.error' },
  });
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: All Processors Visible in Flow Graph

*For any* AI request execution, all processors (including save-history and extract-preferences) must appear as nodes in the AI Playground flow graph.

**Validates: Requirements 1.1, 1.2**

**Rationale**: This ensures complete visibility of the AI processing pipeline, enabling developers to debug and optimize each step. By moving processors from async onFinish callbacks to the main execution flow, we can track their execution in real-time.

### Property 2: Processor Execution Order

*For any* AI request, all processors must execute synchronously in the main flow before the onFinish callback, ensuring deterministic execution order.

**Validates: Requirements 1.5**

**Rationale**: Synchronous execution guarantees that processors run in a predictable order and their results are available for visualization. This prevents race conditions and ensures the flow graph accurately reflects the execution sequence.

### Property 3: Model Router Intent Mapping

*For any* AI intent type (chat, reasoning, agent, vision), calling getModelByIntent() must return the correct model without hardcoded model names.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

**Rationale**: Centralizing model selection in a single function eliminates hardcoded model names throughout the codebase, making it easy to switch models or add fallback strategies.

### Property 4: No Hardcoded Model Names

*For any* code file in the AI module (excluding model router configuration), there must be no hardcoded model name strings (e.g., 'qwen-flash', 'deepseek-chat').

**Validates: Requirements 2.5**

**Rationale**: This ensures all model selection goes through the router, maintaining a single source of truth for model configuration.

### Property 5: Hot Keyword CRUD Operations

*For any* hot keyword, creating/updating/deleting through the Admin API must correctly persist changes to the database and invalidate the cache.

**Validates: Requirements 3.2, 3.3, 3.4**

**Rationale**: This ensures data consistency between the Admin UI, database, and cache layers. Soft delete (isActive=false) preserves historical data for analytics.

### Property 6: P0 Layer Keyword Matching

*For any* user input that matches an active hot keyword (exact/prefix/fuzzy), the P0 layer must return the preset response without calling the LLM.

**Validates: Requirements 3.6**

**Rationale**: P0 layer provides instant responses for known keywords, reducing latency and AI costs. This is critical for the Digital Ascension strategy where keywords drive traffic from offline channels.

### Property 7: Dynamic Message Update Timing

*For any* activity state change (user joins, status updates), the dynamic message API must be called and complete within 500ms.

**Validates: Requirements 8.1, 8.2, 8.5**

**Rationale**: Real-time card updates in group chats require sub-second latency to maintain the illusion of instant synchronization. 500ms provides a buffer for network latency while keeping the experience snappy.

### Property 8: Chat Tool Mode Identifier Storage

*For any* activity created via Chat Tool Mode, the database must store both groupOpenId and dynamicMessageId fields.

**Validates: Requirements 8.3, 8.4**

**Rationale**: These identifiers are essential for updating dynamic messages and sending system notifications. Without them, we cannot maintain the connection between the activity and the group chat.

### Property 9: System Message for In-Group Events

*For any* activity event where groupOpenId exists (user joins, match confirmed), a system message must be sent to the group chat.

**Validates: Requirements 9.1, 9.2**

**Rationale**: System messages provide free, unlimited group notifications that create social proof and drive engagement. They're only sent when the event occurs within a group context.

### Property 10: Service Notification for Cross-Group Events

*For any* activity event where groupOpenId is null or users are in different groups (cross-group join, activity reminder, cancellation), a service notification must be sent to affected users.

**Validates: Requirements 9.6, 9.7, 9.8, 9.9**

**Rationale**: Service notifications ensure users are notified of important events even when they're not in the same group. This covers scenarios like joining from朋友圈, activity reminders, and cancellations.

### Property 11: Notification Strategy Decision

*For any* notification event, the system must choose between system message and service notification based on the presence of groupOpenId and user relationships.

**Validates: Requirements 9.11**

**Rationale**: The decision logic ensures we use the most appropriate notification method: system messages for in-group social proof, service notifications for private/cross-group reliability.

### Property 12: Flow Graph Real-Time Updates

*For any* AI Playground execution, the flow graph data structure must update in real-time as each node (processor, P0, P1, LLM, tool) completes execution.

**Validates: Requirements 10.1, 10.6**

**Rationale**: Real-time updates enable developers to observe the AI execution pipeline as it happens, making it easier to identify bottlenecks and debug issues.

### Property 13: Hot Chip Click Tracking

*For any* Hot Chip click event, the system must increment the hitCount for that keyword in the database.

**Validates: Requirements 6.5**

**Rationale**: Tracking clicks enables analytics on keyword effectiveness, helping operators optimize the keyword strategy over time.

### Property 14: Conversion Tracking

*For any* user who joins or creates an activity within 30 minutes of receiving a P0 keyword response, the system must increment the conversionCount for that keyword.

**Validates: Requirements 6.5**

**Rationale**: Conversion tracking measures the effectiveness of keywords in driving actual user actions, providing ROI data for the Digital Ascension strategy.

## Error Handling

### 1. P0 Layer Fallback

**Scenario**: P0 keyword matching fails (database error, cache miss)

**Handling**:
```typescript
try {
  const keyword = await matchKeyword(userInput);
  if (keyword) {
    return createKeywordResponse(keyword);
  }
} catch (error) {
  logger.error({ error, userInput }, 'P0 layer failed, falling back to P1');
  // 降级到 P1 层 NLP 意图识别
}

// 继续 P1 层处理
const intent = await classifyIntent(userInput);
```

**Rationale**: P0 layer failures should not block user requests. Graceful degradation to P1 ensures users always get a response, even if it's slower.

### 2. Model Router Fallback

**Scenario**: Primary model (Qwen) fails or times out

**Handling**:
```typescript
export async function callWithFallback(intent: ModelIntent, params: any): Promise<any> {
  try {
    const model = getModelByIntent(intent);
    return await streamText({ model, ...params });
  } catch (error) {
    logger.warn({ error, intent }, 'Primary model failed, using fallback');
    
    // 降级到 DeepSeek
    const fallbackModel = deepseek('deepseek-chat');
    return await streamText({ model: fallbackModel, ...params });
  }
}
```

**Rationale**: Model failures are inevitable (rate limits, outages). Having a fallback provider ensures high availability.

### 3. Dynamic Message Update Failure

**Scenario**: WeChat setChatToolMsg API fails

**Handling**:
```typescript
try {
  await updateDynamicMessage(activityId, dynamicMessageId, subtitle);
} catch (error) {
  logger.error({ error, activityId }, 'Dynamic message update failed');
  
  // 不阻塞主流程，记录失败但继续
  // 用户刷新页面时会看到最新状态
}
```

**Rationale**: Dynamic message updates are a nice-to-have enhancement. Failures should not prevent users from joining activities. The activity state is still updated in the database, so users see correct data when they refresh.

### 4. System Notification Failure

**Scenario**: WeChat system message API fails

**Handling**:
```typescript
try {
  await sendSystemNotification(groupOpenId, content);
} catch (error) {
  logger.error({ error, groupOpenId }, 'System notification failed, falling back to service notification');
  
  // 降级到服务通知
  await sendServiceNotification(userId, {
    type: 'activity_join',
    activityId,
    content,
  });
}
```

**Rationale**: If system messages fail, we fall back to service notifications to ensure users are still notified. This maintains reliability at the cost of requiring user authorization.

### 5. Processor Execution Failure

**Scenario**: A processor (e.g., semantic-recall) fails

**Handling**:
```typescript
export function semanticRecallProcessor(userId: string | null): Processor {
  return async (context, input) => {
    const startTime = Date.now();
    
    try {
      const activities = await searchUserActivities(userId, input, { limit: 3 });
      
      return {
        processorName: 'semantic-recall',
        executionTime: Date.now() - startTime,
        success: true,
        data: { activities },
      };
    } catch (error) {
      logger.error({ error, userId }, 'Semantic recall failed');
      
      return {
        processorName: 'semantic-recall',
        executionTime: Date.now() - startTime,
        success: false,
        error: error.message,
        data: { activities: [] },  // 返回空数组，不阻塞流程
      };
    }
  };
}
```

**Rationale**: Processor failures should not crash the entire AI pipeline. Each processor returns a result object with success/error status, allowing the flow to continue and the failure to be visualized in the flow graph.

### 6. Cache Failure Handling

**Scenario**: Redis cache is unavailable

**Handling**:
```typescript
async function getCache(key: string): Promise<any | null> {
  try {
    const cached = memoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    return null;
  } catch (error) {
    logger.warn({ error, key }, 'Cache read failed, falling back to database');
    return null;  // 降级到数据库查询
  }
}
```

**Rationale**: Cache failures should not break the application. We gracefully degrade to database queries, accepting higher latency over complete failure.

## Testing Strategy

### 1. Unit Testing

**Focus Areas**:
- Processor 纯函数逻辑
- 模型路由选择逻辑
- 热词匹配算法（exact/prefix/fuzzy）
- 通知策略决策逻辑

**Example**:
```typescript
describe('matchKeyword', () => {
  it('should match exact keyword', async () => {
    const result = await matchKeyword('仙女山');
    expect(result).toBeDefined();
    expect(result.keyword).toBe('仙女山');
    expect(result.matchType).toBe('exact');
  });
  
  it('should match prefix keyword', async () => {
    const result = await matchKeyword('仙女山攻略');
    expect(result).toBeDefined();
    expect(result.keyword).toBe('仙女山');
    expect(result.matchType).toBe('prefix');
  });
  
  it('should return null for no match', async () => {
    const result = await matchKeyword('随机文本');
    expect(result).toBeNull();
  });
});
```

### 2. Integration Testing

**Focus Areas**:
- P0 层 → P1 层降级流程
- 动态消息 API 调用
- 系统通知发送
- Admin API CRUD 操作

**Example**:
```typescript
describe('P0 to P1 fallback', () => {
  it('should fall back to P1 when P0 fails', async () => {
    // Mock P0 layer failure
    jest.spyOn(hotKeywordsService, 'matchKeyword').mockRejectedValue(new Error('DB error'));
    
    const response = await request(app)
      .post('/ai/chat')
      .send({ messages: [{ role: 'user', content: '仙女山' }] });
    
    expect(response.status).toBe(200);
    expect(response.body.intent).toBeDefined();  // P1 layer handled it
  });
});
```

### 3. End-to-End Testing

**Focus Areas**:
- 完整的 Chat Tool Mode 流程（分享 → 点击 → 报名 → 通知）
- Admin 热词管理完整流程（创建 → 编辑 → 删除 → 分析）
- AI Playground 流程图可视化

**Example**:
```typescript
describe('Chat Tool Mode E2E', () => {
  it('should complete full join flow with notifications', async () => {
    // 1. 创建活动
    const activity = await createActivity({ groupOpenId: 'test-group' });
    
    // 2. 用户报名
    await joinActivity(activity.id, userId);
    
    // 3. 验证动态消息更新
    expect(updateDynamicMessageMock).toHaveBeenCalledWith(
      activity.id,
      activity.dynamicMessageId,
      '2人已参与'
    );
    
    // 4. 验证系统通知发送
    expect(sendSystemNotificationMock).toHaveBeenCalledWith(
      'test-group',
      expect.stringContaining('已参与')
    );
  });
});
```

### 4. Performance Testing

**Focus Areas**:
- P0 层响应时间 < 500ms
- 动态消息更新时间 < 500ms
- AI Playground 流程图渲染时间 < 1s

**Example**:
```typescript
describe('Performance', () => {
  it('should match keyword within 500ms', async () => {
    const start = Date.now();
    await matchKeyword('仙女山');
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500);
  });
});
```

### 5. Manual Testing Checklist

**Processor 架构**:
- [ ] AI Playground 显示所有 Processor 节点
- [ ] 点击 Processor 节点显示详细信息
- [ ] 流程图实时更新节点状态

**模型路由**:
- [ ] 所有 AI 调用使用 getModelByIntent()
- [ ] 代码中无硬编码模型名称
- [ ] 模型降级正常工作

**P0 层热词**:
- [ ] Admin 可以创建/编辑/删除热词
- [ ] 热词匹配正确（exact/prefix/fuzzy）
- [ ] 热词分析显示命中率和转化率
- [ ] 小程序 Hot Chips 显示热词

**Chat Tool Mode**:
- [ ] 群聊卡片以半屏模式打开
- [ ] 报名后卡片实时更新参与人数
- [ ] 群聊中显示系统通知
- [ ] 跨群报名发送服务通知


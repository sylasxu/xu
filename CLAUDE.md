---
inclusion: always
---
# xu 项目规范

## 🎯 核心哲学

1. **Single Source of Truth**: `@xu/db` 是绝对的数据源
2. **Zero Redundancy**: 禁止手动重复定义 TypeBox Schema，必须从 DB 派生
3. **Spec-First & SDK-Driven**: Eden Treaty (Admin) / Orval SDK (小程序)
4. **Dual-Track Architecture**: API (Elysia + JWT) + Admin (Vite SPA)

---

## 📚 文档规范

### PRD 和 TAD 是项目总纲

`docs/PRD.md` 和 `docs/TAD.md` 是项目的**完整总纲文档**：

- **PRD (产品需求文档)**：包含所有产品功能、用户体验、设计规范的完整描述
- **TAD (技术架构文档)**：包含所有技术架构、数据库设计、API 设计的完整描述

**规则**：
- ❌ 禁止精简或删除已有内容
- ❌ 禁止只写"新增"或"变更"的增量内容
- ✅ 任何人看这两个文档就能完整理解整个产品和技术架构
- ✅ 新功能必须完整写入对应章节，而非追加到末尾
- ✅ 版本号更新时，保留所有历史功能描述

**文档结构**：
- PRD：产品哲学 → 核心功能 → 用户体验 → 视觉设计 → 成功指标 → 术语表
- TAD：技术栈 → 目录结构 → 数据库 Schema → API 设计 → 正确性属性

---

## 🚨 单向数据流原则

```
正确：需求 → PRD → TAD → DB Schema → API → 前端
错误：前端需要字段 → 反向修改 DB Schema ❌
```

**新增字段流程**：PRD → TAD → DB Schema → `bun run db:push` → API → 前端

> 需要保留迁移历史时，再补 `bun run db:generate` / `bun run db:migrate`；日常本地联调默认以 `db:push` 同步 Schema。

---

## 🏗️ Monorepo 结构

### @xu/db (数据源)
- **Tech**: Drizzle ORM (PostgreSQL + PostGIS + pgvector) + `drizzle-typebox`
- **Schema 以 `packages/db/src/schema` 中的 `pgTable(...)` 定义为准**，当前已包含用户、活动、搭子、通知、AI 观测、配置、安全、内容运营等多类真源表
- **Schema 规范**:
  ```typescript
  export const users = pgTable("users", { ... });
  export const insertUserSchema = createInsertSchema(users);
  export const selectUserSchema = createSelectSchema(users);
  export type User = typeof users.$inferSelect;
  ```

### apps/api (业务网关)
- **Tech**: ElysiaJS + TypeBox
- **模块与对外门面以 `apps/api/src/index.ts` 当前注册结果为准**；主流程域长期收口在 `auth / ai / activities / participants / chat / notifications / content`
- **AI 模块结构**:
  - `ai.service.ts` - 核心入口
  - `processors/` - Processor 纯函数 (input-guard, user-profile, semantic-recall, token-limit, save-history, extract-preferences)
  - `models/` - 模型路由 (Moonshot / Kimi 主力，Qwen 仅保留 embedding)
  - `rag/` - 语义检索 + Rerank
- **文件结构**: `*.controller.ts` / `*.service.ts` (纯函数) / `*.model.ts`
- **AI 顶层纯化规则**:
  - `apps/api/src/modules/ai` 顶层只保留主门面：`ai.controller.ts`、`ai.model.ts`、`ai.service.ts`
  - `ai.controller.ts` 只能直接依赖 `ai.service.ts`，不要再直接 import `runtime/`、`workflow/`、`task-runtime/`、`prompts/`、`observability/metrics` 等实现细节
  - 对话主链实现统一下沉到子目录，例如 `runtime/`、`workflow/`、`task-runtime/`
  - 禁止在 AI 顶层继续新增并列 `*.service.ts`，除 `ai.service.ts` 外一律下沉到明确子域目录
  - 禁止重新引入 `Gateway`、`Turn` 这类过时主链语义作为顶层文件或主入口命名；优先使用 `request`、`response`、`runtime`、`recentMessages`
- **用户态查询规则**: 统一按 `userId` 显式查询，禁止 `mine/me/scope` 语义接口
- **客户端无关原则**:
  - API 必须先按“没有任何客户端消费”来设计，表达稳定的领域能力，而不是为 H5 / Admin / 小程序定制接口
  - 禁止为同一领域能力新增 `admin/*`、`web/*`、`h5/*`、`miniprogram/*` 风格的后端模块、service、route、DTO
  - 当不同客户端有差异化消费方式时，统一通过同一领域接口的显式参数或上下文标记承接，例如 `client`、`entry`、`userId`、`activityId`
  - Admin/H5/小程序的差异，优先体现在鉴权、字段裁剪、响应组装或前端消费层，不体现在后端按端分叉的领域建模
  - 只有“该能力本身就是独立领域”时，才允许独立模块，例如 reports、wechat callback；不得因为某个端要用就反向拆后端
- **禁止**: `export namespace`、class Service、手动定义 DB 表 Schema

---

## 🔧 AI Processor 规范

**Processor 必须是纯函数，禁止使用 class**：

```typescript
// ❌ 禁止使用 class
export class MyProcessor implements Processor {
  name = 'my-processor';
  async execute(context: ProcessorContext): Promise<ProcessorResult> { ... }
}

// ✅ 必须使用纯函数
export async function myProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();
  
  try {
    // 处理逻辑
    return {
      success: true,
      context: updatedContext,
      executionTime: Date.now() - startTime,
      data: { ... },
    };
  } catch (error) {
    return {
      success: false,
      context,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

// 添加元数据
myProcessor.processorName = 'my-processor';
```

**Processor 设计原则**：
- 纯函数：无副作用，相同输入产生相同输出
- 可组合：通过 `runProcessors()` 串联执行
- 可观测：记录执行时间和结果到 `processorLog`
- 容错：失败时返回 `success: false`，不抛出异常

### apps/admin (管理后台)
- **Tech**: Vite + React 19 + TanStack Router + Eden Treaty
- **禁止**: Zod、zodResolver
- **信息架构优先按领域组织**: Admin 默认按 `概览 / 内容 / 组局 / 风控 / AI / 设置` 分组，而不是按角色或临时工作流拆菜单
- **瘦身方式**: 通过稳定分组、明确命名、页内 tabs 收口复杂度；`热词` 收到 `内容工作台` 内部，`AI 配置` 收到 `AI Playground` 工作区内；不要靠隐藏真实能力或额外造一套“开发后台 / 运营后台”

### apps/miniprogram (小程序)
- **Tech**: Native WeChat + TypeScript + Zustand Vanilla + LESS
- **禁止**: `wx.request` (使用 Orval SDK)
- **运行时边界**:
  - 小程序不能依赖 Monorepo 里的跨端运行时实现，不要抽公共前端运行时代码给小程序复用
  - 小程序只能消费 Orval 生成 SDK、生成协议类型、静态常量；具体的流处理、状态机、页面交互必须在 `apps/miniprogram` 内显式实现

## 🚫 类型逃逸与抽象命名

- **禁止新增任何 `helper/helpers` 命名的文件、目录、函数**。`helper` 不是抽象理由，这类命名会掩盖真实职责，也容易演变成类型逃逸和万能胶水层
- **禁止用“封一个 helper 再统一处理”来回避类型错误**。遇到协议、JSON、SSE、Storage、SDK 响应等不确定输入，必须在消费边界直接做显式校验、显式分支、显式失败
- **允许抽取的前提**：抽取后的名字必须直指领域或协议职责，例如 `parseGenUIStreamEvent`、`readWelcomePayload`、`buildPartnerMatchResult`；禁止 `eventHelper`、`typeHelper`、`responseHelper`、`commonHelper`
- **禁止用 `as any`、`as unknown as`、宽泛 `Record<string, unknown>`、魔法默认值 来伪装“类型已解决”**
- **如果类型没跑通，优先改模型、协议、SDK、消费分支本身，不要靠通用包装层把问题藏起来**

---

## 🔁 当前主流程规则 (v5.3)

- **Visitor-First + Action-Gated Auth**：浏览、欢迎卡、附近探索可先体验；报名、发布、找搭子确认等写入动作统一先登录 + 绑定手机号
- **找搭子 / 组局 Agent 是主引擎**：产品主线优先围绕 `find_partner / create_activity / join_activity` 收口；内容工作台负责把真实需求翻成外部分发内容
- **内容生成主入口统一**：当前只允许 `POST /content/generate` 与 `POST /content/topic-suggestions`；旧 AI 内容路由已删除，禁止恢复兼容别名
- **`/ai/chat` 统一协议**：请求体固定为 `conversationId? + input + context`，统一返回 SSE 事件流；`response-complete` 事件携带完整 response envelope，禁止继续使用旧 `messages[]` / `scene` / 非流式主响应
- **报名成功统一链路**：活动详情、半屏详情、地图探索、AI 推荐卡报名成功后，统一走 `join_success -> discussion -> quick starters`
- **真实结果驱动 Memory**：`join` 只算轻信号；强反馈来自 `confirm-fulfillment`、`rebook-follow-up` 等真实社交结果

## 🚫 Schema 派生规则

**数据展示 Schema（selectSchema）：**
```typescript
// ❌ 禁止手动定义
const userSchema = t.Object({ id: t.String(), nickname: t.String() });

// ✅ 必须从 DB 派生
import { selectUserSchema } from '@xu/db';
const userSchema = t.Pick(selectUserSchema, ['id', 'nickname']);
```

**表单验证 Schema（insertSchema）：**
```typescript
// ❌ 禁止手动定义表单字段
const formSchema = t.Object({
  nickname: t.String({ minLength: 1, maxLength: 50 }),
});

// ✅ 从 DB 派生，Pick 需要的字段
import { insertUserSchema } from '@xu/db';
const formSchema = t.Pick(insertUserSchema, ['nickname', 'avatarUrl']);
```

**允许手动定义的 Schema：**
- 分页参数、错误响应等通用辅助类型
- 登录表单（phone + code，非 DB 字段）
- Admin 特有类型（无对应 DB 表）

---

## 🤖 AI Tools 规范

**必须使用 TypeBox，禁止 Zod**：

```typescript
import { t } from 'elysia';
import { tool, jsonSchema } from 'ai';
import { toJsonSchema } from '@xu/utils';

const myToolSchema = t.Object({
  title: t.String({ description: '活动标题' }),
});

type MyToolParams = typeof myToolSchema.static;

export function myTool(userId: string | null) {
  return tool({
    description: '工具描述',
    parameters: jsonSchema<MyToolParams>(toJsonSchema(myToolSchema)),
    execute: async (params) => { ... },
  });
}
```

---

## 🛠️ 开发命令

**使用 Bun，禁止 npm/yarn**：

```bash
bun install          # 安装依赖
bun run dev          # 启动服务
bun run db:push      # 同步 Schema 到数据库
bun run db:migrate   # 需要保留迁移历史时执行
bun run gen:api      # 生成 Orval SDK
bunx <package>       # 执行包命令
```

## 🧪 测试与回归规范

- **测试栈统一使用 Bun First**：默认使用 `bun test`、`bun scripts/*.ts`、`bunx tsc`；禁止为了测试主链路额外引入 Jest / Vitest 作为默认方案
- **API 集成测试优先走 Elysia 原生方式**：对路由、鉴权、参数校验、响应结构、状态流转的测试，优先直接调用 `app.handle(new Request(...))`，不要先起一层自定义测试服务器
- **结果导向回归保留为 Bun 脚本**：`sandbox-regression`、`five-user-smoke`、`genui/chat regression` 这类脚本属于产品验收，不要硬塞回通用单测抽象
- **SSE / 流式 / 协议契约必须保留黑盒验证**：像 `/ai/chat` 的 SSE 顺序、`[DONE]`、GenUI blocks、真实 HTTP 头与流式分块，必须至少有一层真实 HTTP / curl 回归，不能只靠内存态测试
- **新增需求必须补对应回归**：只要改动影响 PRD / TAD 里的用户旅程、AI 对话、动作闸门、分享承接、post-activity 等流程，必须同步补一条能证明链路没断的测试或回归脚本
- **测试分层要清楚**：
  - `bun test` 负责业务规则、服务函数、API 集成
  - `bun scripts/*.ts` 负责多用户流程、结果漏斗、发布前验收
  - 黑盒 HTTP 回归负责流式协议、多端 GenUI 契约、真实 transport 边界
- **内部自测默认流程**：
  - 改 API 或业务规则后先跑：`bun run test:api`
  - 改用户主流程后至少加跑：`bun run regression:flow`
  - 改 `/ai/chat`、SSE、GenUI blocks、多端流解析后至少加跑：`bun run regression:protocol`
  - 准备收口一个迭代时统一跑：`bun run release:gate`
  - 内部自测必须覆盖两条关键 AI 主流程：
    - `create_activity -> edit_draft/save_draft_settings -> confirm_publish`
    - `find_partner -> search_partners -> opt_in_partner_pool`

---

## 🗣️ 语气规范

| ❌ 太装逼 | ✅ 接地气 |
|----------|----------|
| "已为您构建全息活动契约" | "帮你把局组好了！" |
| "正在解析您的意图向量..." | "收到，正在帮你整理..." |
| "今日配额已耗尽。" | "今天的 AI 额度用完了，明天再来吧～" |

---

## 📋 数据库 Schema 速查

**枚举**:
- `activityStatusEnum`: draft, active, completed, cancelled
- `conversationRoleEnum`: user, assistant
- `conversationMessageTypeEnum`: text, user_action, widget_dashboard, widget_launcher, widget_action, widget_draft, widget_share, widget_explore, widget_error, widget_ask_preference
- `partnerIntentStatusEnum`: active, matched, expired, cancelled
- `intentMatchOutcomeEnum`: pending, confirmed, expired, cancelled

**主链与支撑表速查**：
| 表 | 核心字段 |
|---|---------|
| users | id, wxOpenId, phoneNumber, nickname, avatarUrl, aiCreateQuotaToday |
| activities | id, creatorId, title, location, locationHint, startAt, type, status, groupOpenId, dynamicMessageId |
| participants | id, activityId, userId, status |
| conversations | id, userId, title, messageCount, lastMessageAt (会话) |
| conversation_messages | id, conversationId, userId, role, messageType, content, activityId (消息) |
| activity_messages | id, activityId, senderId, messageType, content |
| notifications | id, userId, type, title, isRead, activityId |
| partner_intents | id, userId, activityType, scenarioType, locationHint, destinationText, timeText, status |
| intent_matches | id, activityType, scenarioType, centerLocationHint, destinationText, tempOrganizerId, outcome |
| match_messages | id, matchId, senderId, content |
| agent_tasks | id, userId, taskType, currentStage, status, partnerIntentId, intentMatchId |
| agent_task_events | id, taskId, eventType, eventPayload, createdAt |
| ai_requests | id, userId, modelId, inputTokens, outputTokens, latencyMs |
| ai_tool_calls | id, requestId, toolName, durationMs, success |

**AI 对话持久化 (v3.9)**:
- 有登录用户的 AI 对话自动保存到 `conversation_messages` 表
- Tool 返回的 `activityId` 自动关联到消息
- 支持按 `activityId` 查询关联的对话历史

**AI 模型配置**:
- **主力**: Moonshot / Kimi（默认统一走 `kimi-k2.5`，避免 thinking/tool-call 兼容问题）
- **Embedding**: Qwen text-embedding-v4 (1536 维，Qwen 仅保留这一项)
- **Rerank**: 本地轻量排序（不走外部 Qwen 模型）

---

## ✅ 正确性属性 (CP)

### 数据一致性
- **CP-1**: `currentParticipants` = participants 表中 `status='joined'` 的记录数
- **CP-4**: 每日创建活动次数 ≤ `aiCreateQuotaToday` (默认 3)
- **CP-8**: `locationHint` 不能为空

### 认证规则
- **CP-9**: 未绑定手机号的用户不能发布/报名活动
- **CP-11**: 未登录用户可以浏览对话、查看详情、探索附近

### AI 对话
- **CP-20**: AI 对话自动持久化 - 有 userId 时保存到 conversation_messages
- **CP-21**: Tool 返回的 activityId 自动关联到 AI 响应消息

### 找搭子
- **CP-23**: 同一用户同一场景在同一时间只能保留一个 active 意向
- **CP-24**: 意向 24h 自动过期
- **CP-25**: 匹配只在同场景、无明显冲突且达到搜索评分阈值时创建
- **CP-26**: Temp_Organizer 是最早创建意向的用户

---

## 🚫 Spec 任务规范

- ❌ 禁止包含测试任务
- ✅ 只包含功能实现任务（数据库、API、前端）

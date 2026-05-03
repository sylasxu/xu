# xu

**Agent-driven social activity product built with Bun, Elysia, Next.js, Native WeChat Mini Program, and GenUI blocks.**

xu 是一个围绕状态首页、Agent Runtime、GenUI blocks 和多端客户端构建的组局产品。README 面向外部展示和技术沟通：先展示核心界面，再说明工程架构、启动方式和质量门禁。产品定义、用户痛点和主流程细节见 [PRD](./docs/PRD.md)。

## Screenshots

> 将最新截图放到 `docs/assets/readme/` 后，下面 5 张图会自动成为 README 第一屏展示。

| Home Chat | Activity Detail | Partner Flow | Admin Overview | Admin AI Ops |
|-----------|-----------------|--------------|----------------|--------------|
| ![xu home chat](./docs/assets/readme/home-chat.png) | ![xu activity detail](./docs/assets/readme/activity-detail.png) | ![xu partner flow](./docs/assets/readme/partner-flow.png) | ![xu admin overview](./docs/assets/readme/admin-overview.png) | ![xu admin ai ops](./docs/assets/readme/admin-ai-ops.png) |

## Engineering Highlights

- Unified `/ai/chat` SSE runtime: text, structured actions, task context, and GenUI blocks share one protocol.
- Database-first domain model: Drizzle schema in `@xu/db` is the single source of truth.
- Multi-client architecture: Web/H5, Native WeChat Mini Program, Admin, and API consume the same domain capabilities.
- Agent task runtime: long user journeys are tracked as recoverable tasks instead of disconnected page actions.
- Scenario-first regression: product flows are validated by matrix + artifacts + coverage, not only unit tests.

## 技术概览

- Runtime：Bun
- Monorepo：Turborepo workspaces
- API：Elysia + TypeBox + JWT
- DB：PostgreSQL + PostGIS + Drizzle ORM
- Admin：Vite + React + TanStack Router + Eden Treaty
- Web/H5：Next.js App Router + Tailwind + AI SDK Elements
- Mini Program：微信原生小程序 + TypeScript + Zustand Vanilla + Orval SDK
- GenUI：`packages/genui-contract` 维护界面块协议

## 架构原则

- `@xu/db` 是单一数据真源，Schema 从 Drizzle 表定义派生。
- API 按领域能力建模，不按 H5 / Admin / 小程序拆后端模块。
- `/ai/chat` 是统一 SSE 协议入口，请求体固定为 `conversationId? + input + context`。
- Web 对话主轴继续使用 `components/ai-elements/*`，不重写消息流协议。
- 小程序只消费 Orval 生成 SDK 和协议类型，不复用 Web 运行时。
- 用户可见业务文案优先支持“入库 + 后端下发”，前端只保留中性兜底。

## 仓库结构

这是一个基于 Bun + Turborepo 的 monorepo：

- `apps/api`
  Elysia API，负责对话、结构化动作、活动、搭子、通知等领域能力。
- `apps/admin`
  极简 Admin，当前按概览、内容、组局、风控、AI、设置分组；内容工作台内部承接选题、出稿、配置和效果回填。
- `apps/miniprogram`
  微信原生小程序，是微信内低摩擦完成动作的主承接端。
- `apps/web`
  Web / H5 入口，`/chat` 是首页主路由，承接状态首页、对话、详情与分享态。
- `packages/db`
  Drizzle ORM 数据源，是整个项目的单一数据真源。
- `docs/PRD.md`
  完整产品需求文档。
- `docs/TAD.md`
  完整技术架构文档。

## 快速开始

### 前置要求

- Bun `>= 1.3.4`
- Docker
- 微信开发者工具

### 一键启动

```bash
bun run setup
bun run dev
```

`bun run setup` 会做这些事：

- 初始化环境变量
- 安装依赖
- 启动数据库容器
- 执行 `db:push`

### 手动启动

```bash
bun run env:init
bun install
bun run docker:up
bun run db:push
bun run dev
```

### 小程序启动

小程序不通过命令行热启动，使用微信开发者工具打开 [apps/miniprogram](apps/miniprogram) 即可。

如果 API 契约有更新，先执行：

```bash
bun run gen:api      # 全量生成
bun run gen:api:mp   # 只生成小程序 Orval SDK
```

## 常用命令

```bash
# 开发
bun run dev            # 启动 api + admin + web
bun run dev:api        # 仅启动 API
bun run dev:admin      # 仅启动 Admin
bun run dev:web        # 仅启动 Web
bun run dev:mp         # 提示你去微信开发者工具打开小程序目录
bun run dev:full       # API + 自动 SDK 生成链路

# 数据库
bun run db:push
bun run db:generate
bun run db:migrate
bun run db:studio
bun run db:reset

# 协议 / 代码生成
bun run gen:api
bun run gen:api:mp
bun run gen:genui-contract

# 质量检查
bun run test:api
bun run type-check
bun run arch:check
bun run regression:matrix
bun run regression:flow
bun run regression:flow:extended
bun run regression:protocol
bun run regression:coverage
bun run release:gate
```

## 本地服务地址

- API: [http://localhost:3000](http://localhost:3000)
- OpenAPI: [http://localhost:3000/openapi/json](http://localhost:3000/openapi/json)
- Admin: [http://localhost:1113](http://localhost:1113)
- Web: [http://localhost:1114](http://localhost:1114)

## 怎么理解这套实现

这套实现的主干：

- 用户输入进入 `/ai/chat`
- 后端把文本或 action 规范化成统一请求语义
- Runtime 解析结构化动作、任务状态和上下文
- Processor 管线执行护栏、画像、召回和指标记录
- Tool / Workflow / Model Router 推进领域动作
- 最终以 SSE + GenUI blocks 返回 Web、小程序或后台

产品语义详见 PRD；这里重点关注工程上如何保证多轮对话、任务状态、多端协议和数据库状态一致。

## AI 模块主链路

### 1. 入口层：统一对话入口规范化输入

```text
用户输入
  -> 对话运行时（Chat Runtime）
  -> 处理管线（Processing Pipeline：护栏、画像、召回、意图分类）
  -> Action 快速出口 / 工具 / 工作流 / 模型路由
  -> 任务运行时 / 持久化（Task Runtime / Persistence）
  -> 界面块 / 流式响应（UI Blocks / Stream Response）
```

这一层把 `text / action / context` 收成同一套请求语义，并始终走同一条 SSE 主链返回结果。

核心模块：

- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/runtime/chat-response.ts`
- `apps/api/src/modules/ai/ai.controller.ts`
- `apps/api/src/modules/ai/ai.model.ts`

### 2. 理解层：统一上下文加载，Action 作为快速出口
所有请求先经过同一套上下文加载和 Processor 管线（护栏、画像、召回、意图分类）。
结构化动作不是独立分支，而是在统一链路末端的一个快速出口：
若存在 `structuredAction` 且执行成功，用轻量 LLM（Voice 层，~50 字）生成人味回复后直接返回，不走完整 LLM 推理。

当前主动作包括：

- `explore_nearby`：探索附近有什么局
- `find_partner`：进入找搭子主链
- `search_partners`：先按条件搜索搭子结果
- `create_activity`：开始组一个新局
- `join_activity`：报名参加一个局
- `publish_draft`：把草稿正式发布出去

核心模块：

- `apps/api/src/modules/ai/user-action/`
- `apps/api/src/modules/ai/workflow/`
- `apps/api/src/modules/ai/suggestions/`

### 3. 处理层：Processor 管线负责护栏、画像和召回
请求在执行前会经过一条显式处理链，当前包括：

- 输入护栏
- 关键词匹配（补充信号，不主导主链）
- 意图分流
- 用户画像注入
- 语义召回
- Token 限制
- 输出护栏
- 指标记录与请求持久化

核心模块：

- `apps/api/src/modules/ai/processors/`
- `apps/api/src/modules/ai/processors/pipeline.ts`
- `apps/api/src/modules/ai/rag/`

### 4. 执行层：工具、工作流和模型路由一起决定怎么把事办下去
这一层根据场景决定：

- Action 快速出口（轻量 LLM Voice 层）
- 走工具调用
- 走工作流
- 走哪一个模型

核心模块：

- `apps/api/src/modules/ai/tools/`
- `apps/api/src/modules/ai/workflow/`
- `apps/api/src/modules/ai/models/`
- `apps/api/src/modules/ai/ai.service.ts`

### 5. 状态层：任务运行时、会话持久化和记忆负责续接
这一层负责把“上一轮说到哪”“这件事做到哪”接住，主要记录三类状态：

- 会话历史：说过什么
- 任务状态：这件事推进到哪一阶段
- 用户记忆：明确表达过的偏好和上下文

核心模块：

- `apps/api/src/modules/ai/task-runtime/`
- `apps/api/src/modules/ai/memory/`
- `packages/db/src/schema/`

### 6. 输出层：SSE 和界面块协议把结果返回给多端
输出不只是文本，还会带着结构化界面块一起返回，比如：

- 活动结果卡
- 搭子结果卡
- 偏好追问
- 草稿卡
- 下一步 CTA

核心模块：

- `packages/genui-contract/`
- `apps/api/src/modules/ai/runtime/chat-response.ts`
- `apps/miniprogram/src/stores/chat.ts`
- `apps/web/app/chat/`

### 7. 保障层：数据库真源、契约生成和回归一起兜底
这一层保证整条链路长期可维护：

- 数据结构来自 `@xu/db`
- API 契约围绕领域能力定义
- 小程序通过 Orval SDK 消费协议
- Admin 通过 Eden Treaty 调用 API
- 流式协议和用户主流程都有单独回归

常用质量命令：

```bash
bun run test:api
bun run type-check
bun run regression:matrix
bun run regression:flow
bun run regression:flow:extended
bun run regression:protocol
bun run regression:coverage
```

## 文档入口

- [产品需求文档 PRD](./docs/PRD.md)
- [技术架构文档 TAD](./docs/TAD.md)
- [测试分层与发布门禁](./docs/agent-guides/TEST-LAYERS.md)

## 开发约定

项目当前有几条非常重要的约定：

- `@xu/db` 是单一数据真源
- Schema 从数据库派生，避免手写重复协议
- API 按领域建模，不按客户端拆后端接口
- 小程序使用 Orval 生成 SDK，不直接手写 `wx.request`
- 日常本地联调以 `bun run db:push` 为主

更多协作与编码规范见：

- [AGENTS.md](AGENTS.md)

## 许可证

MIT

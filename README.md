# xu

**群主分身型组局 agent。**

你不用先想清楚该点哪个页面，只要把一个模糊想法说出来：

- 今天有什么想玩的
- 周末想找个轻松局
- 想认识附近同频的人
- 帮我写个不尴尬的邀约

xu 会尽量把这些碎片化需求接住，帮你找人、凑局、开口、续上同一件事。

## 现在可以直接体验什么

当前版本已经重点打通了几条最核心的主场景：

- 找局
  例如“附近有没有局”“观音桥附近有什么活动”“这个我能直接报吗”
- 找搭子
  例如“有没有饭搭子”“帮我找个羽毛球搭子”“观音桥饭搭子有没有”
- 自己组局
  例如“我想组个局”“帮我组一个周五晚的桌游局”
- 补位与快速成局
  例如“麻将三缺一有没有人”“差一个能不能帮我找”
- 对话式续接
  用户不用每轮都重说一遍，系统会尽量沿着上一件事继续往下接

## 项目在做什么

xu 要解决的，不是“做一个新社交平台”，而是把群聊里那些高频、碎片化、口语化的需求整理成可执行的产品流程：

- 找局：附近有没有活动，这个局我能不能直接报
- 找搭子：有没有饭搭子、球搭子、桌游搭子
- 组局：我想自己发一个局，帮我先整理成草稿
- 承接后续：报名之后、讨论区里、活动结束后还能继续接

对外，它是一个群主分身型组局 agent。
对内，它把“找局 / 找搭子 / 组局 / 活动后续上”当成主流程，用状态首页、任务状态和会话上下文，把同一件事持续往下推进；内容工作台负责把这些真实需求翻成可外部分发的内容。

当前这轮收口的核心标准也很明确：

- 首页是不是状态首页，而不是活动广场或空白聊天壳
- agent 能不能把 `找局 / 组局 / 找搭子 / 活动后续上` 稳定接住
- 报名、讨论区、活动后 follow-up 这些后续承接是不是同一条任务在往下走

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
bun run gen:api
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
bun run gen:genui-contract

# 质量检查
bun run test
bun run type-check
bun run arch:check
bun run regression:flow
bun run regression:protocol
```

## 本地服务地址

- API: [http://localhost:3000](http://localhost:3000)
- OpenAPI: [http://localhost:3000/openapi/json](http://localhost:3000/openapi/json)
- Admin: [http://localhost:1113](http://localhost:1113)
- Web: [http://localhost:1114](http://localhost:1114)

## 怎么理解这套实现

这套实现的主干其实很简单：

- 用户从对话入口表达“找局 / 找搭子 / 组局 / 报名”这类目标
- 后端先把自然语言收敛成结构化动作或明确执行路径
- 请求再经过处理链、工具、工作流和模型路由推进
- 最后以 SSE + 界面块的形式回到 Web、小程序和后台

真正的难点不在接模型，而在把“附近有没有局”“观音桥饭搭子有没有”“我来组一个”这类口语化表达稳定地落到真实业务动作上，并且让同一件事能在多轮对话、多端承接和任务状态里继续往下走。

## AI 模块主链路

### 1. 入口层：统一对话入口规范化输入

```text
用户输入
  -> 对话运行时
  -> 动作推断
  -> 处理管线
  -> 工具 / 工作流 / 模型路由
  -> 任务运行时 / 持久化
  -> 界面块 / 流式响应
```

这一层把 `text / action / context` 收成同一套请求语义，并始终走同一条 SSE 主链返回结果。

核心模块：

- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/runtime/chat-response.ts`
- `apps/api/src/modules/ai/ai.controller.ts`
- `apps/api/src/modules/ai/ai.model.ts`

### 2. 理解层：结构化动作优先，意图识别兜底
这一层先判断能不能直接落成结构化动作、是不是在续接已有任务、是否只缺一个关键信息。

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

- 直接走结构化动作
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
bun run test
bun run type-check
bun run regression:flow
bun run regression:flow:extended
bun run regression:protocol
```

## 文档入口

- [产品需求文档 PRD](./docs/PRD.md)
- [技术架构文档 TAD](./docs/TAD.md)

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

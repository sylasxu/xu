# 聚场 (JuChang)

聚场是一个面向线下社交场景的 AI 组局助手。

用户不用先学会点哪个页面，而是可以直接说：

- 附近有没有局
- 观音桥饭搭子有没有
- 我想组个局
- 麻将三缺一有没有人

系统会继续帮用户找活动、找搭子、整理草稿、报名活动，并把后续动作接下去。

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

聚场要解决的，不是“做一个社交工具”，而是把群聊里那些高频、碎片化、口语化的需求真正接住：

- 找局：附近有没有活动，这个局我能不能直接报
- 找搭子：有没有饭搭子、球搭子、桌游搭子
- 组局：我想自己发一个局，帮我先整理成草稿
- 承接后续：报名之后、讨论区里、活动结束后还能继续接

对外，聚场是“组局助手”。
对内，系统会用持续任务、结构化动作和工作记忆，把同一件事尽量连续地推进到结果。

## 仓库结构

这是一个基于 Bun + Turborepo 的 monorepo：

- `apps/api`
  Elysia API，负责 AI Chat、结构化动作、活动、搭子、通知等领域能力。
- `apps/admin`
  运营后台，负责活动运营、AI Ops、内容与安全管理。
- `apps/miniprogram`
  微信原生小程序，是当前最核心的用户端。
- `apps/web`
  Web / H5 入口，承接邀请页和 Web Chat 等场景。
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

小程序不通过命令行热启动，使用微信开发者工具打开 [apps/miniprogram](/Users/sylas/Documents/GitHub/juchang/apps/miniprogram) 即可。

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
```

## 本地服务地址

- API: [http://localhost:3000](http://localhost:3000)
- OpenAPI: [http://localhost:3000/openapi/json](http://localhost:3000/openapi/json)
- Admin: [http://localhost:5173](http://localhost:5173)
- Web: [http://localhost:1114](http://localhost:1114)

## 技术概览

如果从开发视角快速理解，聚场当前的主干可以概括为：

- Chat-First
  首页从对话进入，而不是从货架、地图或表单进入。
- Structured Action
  用户的一句话会优先被翻译成“找局 / 找搭子 / 组局 / 报名”等领域动作。
- Processor Pipeline
  AI 请求会经过输入护栏、关键词命中、意图分流、画像注入、语义召回等处理器。
- Working Memory
  系统会记住用户明确表达过的偏好、地点和部分身份线索，但不会乱编。
- Generative UI
  对话不是只回文字，还会返回活动结果卡、搭子结果卡、偏好追问、草稿卡等界面块。

简单说，用户看到的是一个会接话、会接事的组局助手；系统内部则用领域动作、处理器管线和任务上下文把这件事稳稳接住。

如果你想快速理解项目，不需要先读完整源码，建议先看下面两份总纲文档。

## 为什么这套技术实现不只是“套了个 AI 聊天壳”

如果从面试或技术交流视角看，聚场的难点不在“接一个大模型”，而在于怎么把自然语言稳定地落到真实业务动作上。

这个项目当前主要解决了几类工程问题：

- 自然语言到领域动作的转换
  用户说的是“附近有没有局”“观音桥饭搭子有没有”“麻将三缺一有没有人”，系统内部要把它们收敛成 `explore_nearby`、`find_partner`、`search_partners`、`create_activity` 等明确动作，而不是只回一段文本。
- 单轮聊天到连续任务的转换
  用户不会每轮都把信息说完整，所以系统要能把“周末也可以”“那就观音桥”“我来组一个”理解成同一件事的后续推进，而不是全新问题。
- 结构化能力和自然语言体验之间的平衡
  内部需要有 Processor、结构化动作、任务上下文、工作记忆；但对外回复又不能像规则引擎播报，必须保留“像一个组局助手在接话”的感觉。
- 多端一致性
  同一个领域能力需要同时服务 API、小程序、Admin、Web，而不是每个端各写一套后端接口。

## 技术亮点

### 1. Chat Runtime 不是直接把用户输入丢给 LLM

Chat 主链路大致是：

```text
用户输入
  -> Chat Gateway
  -> Structured Action Inference
  -> Processor Pipeline
  -> Tool / Workflow / LLM
  -> Generative UI / Stream Response
```

这意味着系统会先判断：

- 这句话能不能直接落成结构化动作
- 当前是不是在续接一条已有任务
- 是否需要补问一个关键条件
- 是否应该直接返回结果卡，而不是继续闲聊

核心模块：

- `apps/api/src/modules/ai/ai-chat-gateway.service.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/user-action/`
- `apps/api/src/modules/ai/processors/`

### 2. Processor Pipeline 负责“稳定理解”，不把复杂逻辑全塞进 prompt

AI 请求会经过一条显式处理链，当前包括但不限于：

- 输入护栏
- 关键词命中
- 意图分流
- 用户画像注入
- 语义召回
- 输出护栏
- 指标记录与请求持久化

这让系统具备几个优点：

- 易观察：每一步都能 trace
- 易回归：可以针对某一层补回归，而不是整条链路只能黑盒试
- 易演进：新增能力时，不需要把所有逻辑都塞进一份系统 prompt

### 3. Structured Action + Generative UI，让聊天真正“办事”

聚场不是“聊完再跳页面”，而是把聊天直接接到业务能力：

- `explore_nearby`
- `find_partner`
- `search_partners`
- `create_activity`
- `join_activity`
- `publish_draft`

这些动作的结果不会只变成一句话，而会继续生成：

- 活动结果卡
- 搭子结果卡
- 偏好追问
- 活动草稿卡
- 下一步 CTA

也就是说，对话本身就是界面组织方式，而不只是输入方式。

### 4. Database-First + Contract-Driven，保证多端一致

这个仓库很强调“数据库是单一数据真源”：

- 数据结构来自 `@juchang/db`
- API 契约围绕领域能力定义
- 小程序通过 Orval SDK 消费协议
- Admin 通过 Eden Treaty 调用 API

这样做的好处是：

- 避免前后端各写一份类型
- 避免为了某个页面反向拆后端接口
- 更适合持续演进多端场景

### 5. Working Memory 不是“假装记住你”，而是记录明确事实

系统会记住用户明确表达过的内容，比如：

- 偏好
- 常去地点
- 部分身份线索
- 部分社交关系线索

但不会乱编、不会脑补。这样设计的目标不是“做一个会装懂的聊天机器人”，而是做一个在真实社交场景里越来越懂你的助手。

### 6. 工程质量依赖回归，而不是只靠人工点点看

当前项目已经有比较明确的回归思路：

- `bun test` 负责业务规则、服务函数、API 集成
- `scripts/*.ts` 负责多用户流程和结果导向回归
- 流式协议用真实 SSE / HTTP 回归验证

常用质量命令：

```bash
bun run test
bun run type-check
bun run regression:flow
bun run regression:protocol
```

如果从工程完成度来看，这套系统更像一个“任务型 AI 产品后端”，而不是一个只有 prompt 和聊天框的 demo。

## 文档入口

- [产品需求文档 PRD](./docs/PRD.md)
- [技术架构文档 TAD](./docs/TAD.md)

如果你主要关心 Chat 架构，建议重点阅读：

- [docs/PRD.md](/Users/sylas/Documents/GitHub/juchang/docs/PRD.md)
  关注“第一性用户场景”和“核心业务流程”
- [docs/TAD.md](/Users/sylas/Documents/GitHub/juchang/docs/TAD.md)
  关注 AI 模块、Structured Action、Agent Task Runtime、数据库与协议设计

## 开发约定

项目当前有几条非常重要的约定：

- `@juchang/db` 是单一数据真源
- Schema 从数据库派生，避免手写重复协议
- API 按领域建模，不按客户端拆后端接口
- 小程序使用 Orval 生成 SDK，不直接手写 `wx.request`
- 日常本地联调以 `bun run db:push` 为主

更多协作与编码规范见：

- [AGENTS.md](/Users/sylas/Documents/GitHub/juchang/AGENTS.md)

## 许可证

MIT

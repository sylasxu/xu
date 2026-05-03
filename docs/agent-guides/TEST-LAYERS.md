# 测试分层与发布门禁

## 目标

把“改完要跑什么”收敛成固定分层，避免每次靠记忆挑脚本，也避免把所有东西都塞进一层测试。

## 分层命令

### 1. API 规则层

```bash
bun run test:api
```

职责：

- `apps/api` 的 `bun test`
- 服务函数、业务规则、路由级集成测试
- Elysia 原生 `app.handle(new Request(...))` 请求验证

适用改动：

- controller / model / service
- 鉴权、参数校验、响应结构
- 查询参数、状态流转、权限边界

### 2. 用户流程回归层

```bash
bun run regression:flow
```

职责：

- `sandbox-regression --suite core`

覆盖主链路：

- 发起活动草稿 -> 保存设置 -> 确认发布
- 报名与满员限制
- 退出后重报
- 找搭子搜索 -> 继续帮我留意
- 讨论区消息
- 通知流转
- 游客/登录态 AI 会话权限

扩展入口：

```bash
bun run regression:flow:extended
```

扩展层覆盖：

- 长对话链路
- transient context
- 多意图切换
- 匿名长对话
- 错误恢复
- rapid-fire 连发

手动冒烟工具：

```bash
bun run smoke:five-users
```

说明：

- `five-user-smoke` 保留为人工联调和演示用冒烟工具
- 它不再进入默认发布门禁，避免和 `sandbox-regression` 重复验证同一条主链路

适用改动：

- 活动、报名、讨论区、通知
- 发局主链、找搭子最小闭环
- Visitor-First / Action-Gated Auth
- AI 会话持久化、会话权限、报名成功承接链路

### 3. 协议与流式回归层

```bash
bun run regression:protocol
```

职责：

- `chat-regression --suite core`

覆盖重点：

- `/ai/chat` SSE 顺序
- `[DONE]` 与真实 HTTP 头
- GenUI blocks 结构
- Web / Mini 渲染契约一致性
- 优先复用 `GENUI_CHAT_API_URL` 指向的服务；未提供时默认打本地 `http://127.0.0.1:1996/ai/chat`
- 运行前需确保 API 与数据库已就绪；协议回归不负责自动拉起依赖

专项快照入口：

```bash
bun run regression:protocol:snapshot
```

扩展协议入口：

```bash
bun run regression:protocol:extended
```

说明：

- 默认协议门禁只保留 SSE、GenUI blocks、基础连续链路和关键 guardrails
- snapshot 仍保留，但不再和默认协议门禁强绑定
- 长对话、匿名长链、多意图切换、rapid-fire 等高成本协议场景移到 `regression:protocol:extended`
- 只有改 GenUI 固定输出、回放快照或比对渲染基线时，再单独加跑

适用改动：

- `/ai/chat`
- 流式网关
- GenUI block 协议
- Web / Mini 的流解析和渲染协议

### 4. 发布门禁层

```bash
bun run release:gate
```

职责：

- `arch:check`
- `type-check`
- `test:api`
- `regression:flow`
- `regression:protocol`

建议使用时机：

- 合并前
- 提测前
- 影响主流程、AI 协议、多端承接时

## 当前脚本归属

- [five-user-smoke.ts](../../scripts/five-user-smoke.ts)：手动联调和演示用冒烟工具
- [sandbox-regression.ts](../../scripts/sandbox-regression.ts)：用户流程回归层
- [chat-regression.ts](../../scripts/chat-regression.ts)：协议与流式回归层
- [flow-regression.ts](../../scripts/flow-regression.ts)：流程回归统一入口
- [release-gate.ts](../../scripts/release-gate.ts)：发布门禁统一入口
- [regression-scenario-matrix.ts](../../scripts/regression-scenario-matrix.ts)：PRD 场景矩阵真源（场景 id -> 主域 / 分支长度 / 用户心路 / 信任风险 / 长流程编号 / 对应 PRD）
- [scenario-matrix-report.ts](../../scripts/scenario-matrix-report.ts)：输出当前场景矩阵概览
- [identity-memory-regression.ts](../../scripts/identity-memory-regression.ts)：身份记忆专项回归（同样输出 artifact）

## 产物与矩阵

这里的判断标准要固定下来：

- 主流程验收优先看“真实用户目标场景是否跑通”，不是先看测试条数
- 同一个需求如果只补了单测、却没有覆盖对应的用户旅程回归，不算真正验收完成
- `matrix + artifact + coverage` 的组合，目标是回答“最近一次到底跑到了哪些产品域、哪些分支”，而不是制造新的测试术语

```bash
bun run regression:matrix
```

用途：

- 查看当前回归脚本已经登记了哪些产品场景
- 按 `layer / domain / suite / branchLength / userMindsets / trustRisks / longFlowIds` 快速盘点覆盖面
- 作为后续补 PRD 场景与覆盖率报告的真源入口

矩阵里的用户心路字段用于把 PRD 痛点固定到验收口径里：

- `userMindsets`：用户当时的心理状态，例如先试试看、登录被打断、报名后怕冷场、异步等待、跨任务回来
- `trustRisks`：这条链路最容易伤害信任的风险，例如过早登录、任务丢失、隐私暴露、消息断裂、角色不清
- `dropOffPoints`：用户最可能离开的节点，例如首页、详情页、auth gate、讨论区、消息中心、待确认匹配、活动后反馈
- `expectedFeeling`：这条回归真正要证明的用户体感
- `longFlowIds`：长流程编号，用来追踪端到端心路，而不是只看孤立功能点

`sandbox-regression`、`chat-regression` 和 `identity-memory-regression` 现在都会额外输出结构化 artifact 到：

```bash
.artifacts/regression/sandbox-regression/
.artifacts/regression/chat-regression/
.artifacts/regression/identity-memory-regression/
```

这些 artifact 是本地复盘产物，用来回答“最近一次到底跑到了哪些产品场景”。默认不提交，收口或 commit 前应清理或保持未跟踪。

artifact 包含：

- 本次运行的 suite、开始/结束时间、总耗时
- 每个 scenario 的 pass/fail、耗时、details、error
- 对应的矩阵元信息：`domain / userGoal / prdSections / branchLength / primarySurface / userMindsets / trustRisks / dropOffPoints / longFlowIds`

这层的目标不是替代终端日志，而是把“跑过了哪些产品场景”沉淀成可复盘产物。

覆盖报告入口：

```bash
bun run regression:coverage
```

用途：

- 汇总矩阵里按 `domain / runner` 登记的场景数
- 汇总矩阵里按 `userMindsets / trustRisks / longFlowIds` 登记的产品验收断点
- 对照最近一次 `sandbox-regression` / `chat-regression` / `identity-memory-regression` artifact
- 快速看“哪些主域、用户心路、信任风险、长流程最近一次跑到了，哪些还没跑到”

当前这份 coverage 还是第一版：

- 它能回答“最近一次 artifact 触达了哪些 domain / 用户心路 / 信任风险 / 长流程”
- 还不能回答“PRD 全量覆盖率百分比”
- 后续继续补 state seed / H5 黑盒 / 多端视觉断点后，再升级成真正的产品覆盖报告

## 开发者测试决策表

改代码时按这张表决定写什么测试、跑哪条命令，不要凭记忆挑。

| 改了什么 | 写什么测试 | 跑哪条命令 | 是否要更新矩阵 |
|---------|-----------|-----------|--------------|
| Controller / Service 纯函数、参数校验、状态机分支 | `bun test` 或 `vitest`（见下方运行器规则） | `bun run test:api` | 否 |
| 数据库 Schema 变更 | `bun test` 集成测试验证字段流转 | `bun run test:api` | 否 |
| 新增/修改用户可见流程（报名、讨论、通知、找搭子） | 补 `sandbox-regression` 场景 | `bun run regression:flow` | **是** |
| 修改 AI 对话主链、Action handler、Processor | 补 `sandbox-regression` 场景 | `bun run regression:flow` | **是** |
| 修改 SSE / GenUI block 协议、流式结构 | 补 `chat-regression` 场景 | `bun run regression:protocol` | **是** |
| 修改找搭子匹配算法、任务运行时 | 补 `ten-user-world` 对应 Phase | `bun run regression:ten-user` | 否（世界脚本是聚合场景） |
| 新增身份记忆/画像相关逻辑 | 补 `identity-memory-regression` | `bun run regression:identity-memory` | 否 |
| 修改 shared 工具、常量、通用类型 | 跑全量单测 + 一条核心流程回归 | `bun run test:api && bun run regression:flow` | 视影响面 |
| 准备合并/提测/发版 | 跑发布门禁 | `bun run release:gate` | 否 |

**关键原则**：同一个需求如果只补了单测、却没有覆盖对应的用户旅程回归，不算验收完成。

## 测试运行器选择规则

`apps/api` 的测试文件混用 `bun:test` 和 `vitest`，选择规则如下：

| 场景 | 运行器 | 原因 |
|------|--------|------|
| 纯函数、算法、业务规则、workflow 状态机 | `bun:test` | 不需要生命周期钩子和模块 mock，Bun 原生最快 |
| 需要 `beforeAll` / `afterEach` 清理数据库 | `vitest` | bun:test 的生命周期钩子支持不完善 |
| 需要 `vi.mock()` / `vi.fn()` 模拟模块 | `vitest` | bun:test 没有内置 mock 框架 |
| Elysia 路由集成测试、DB 真实写入 | `vitest` | 需要生命周期确保每次测试后清理数据 |

**默认优先 `bun:test`**。只有当测试需要生命周期钩子或模块 mock 时，才降级到 `vitest`。

## 新增回归场景 Checklist

补回归不是"加一段代码就行"，必须完成以下步骤：

1. **判断影响域**：改了什么？影响的是用户旅程、协议契约、还是纯内部规则？
2. **选择 runner**：
   - 用户旅程 → `sandbox-regression.ts` 新增 `scenarioXxx` 函数
   - 协议契约 → `chat-regression.ts` 新增 check
   - 交叉用户世界 → `ten-user-world.ts` 新增 Phase
3. **写断言**：不要只测"没报错"，要测"用户目标达成"
   - 报名成功 → 验证 `joinResult === 'joined'` + 讨论区可见
   - 活动发布 → 验证 `publicActivity.status === 'active'`
   - 找搭子匹配 → 验证 `pendingMatches` 生成 + 确认后 `find_partner` 任务收口
4. **更新矩阵**：在 `regression-scenario-matrix.ts` 中补一条 `ScenarioMatrixEntry`
   - 必须填写 `domain`、`userMindsets`、`trustRisks`、`dropOffPoints`、`longFlowIds`
   - 不要只写功能描述，要写"用户当时在想什么、怕什么"
5. **本地验证**：
   ```bash
   bun run regression:flow --scenario xxx
   ```
   或
   ```bash
   bun run regression:protocol --scenario xxx
   ```
6. **跑 artifact**：确认 `.artifacts/regression/` 下生成了正确产物
7. **跑全量门禁**：`bun run release:gate` 通过后再提交

## 使用建议

- 只改 API 规则，先跑 `bun run test:api`
- 改报名、讨论、通知、AI 会话等用户旅程，至少加跑 `bun run regression:flow`
- 改多用户交叉状态（报名竞争、消息聚合、匹配密度），加跑 `bun run regression:ten-user`
- 内部自测收口至少确认两条主流程回归通过：
  - `create_activity -> edit_draft/save_draft_settings -> confirm_publish`
  - `find_partner -> search_partners -> opt_in_partner_pool`
- 只有改长对话、复杂追问、跨意图切换等高波动 AI 体验时，再加跑 `bun run regression:flow:extended`
- 改 `/ai/chat`、SSE、GenUI blocks、多端解析，至少加跑 `bun run regression:protocol`
- 准备收口一个迭代时，跑 `bun run release:gate`

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

## 使用建议

- 只改 API 规则，先跑 `bun run test:api`
- 改报名、讨论、通知、AI 会话等用户旅程，至少加跑 `bun run regression:flow`
- 内部自测收口至少确认两条主流程回归通过：
  - `create_activity -> edit_draft/save_draft_settings -> confirm_publish`
  - `find_partner -> search_partners -> opt_in_partner_pool`
- 只有改长对话、复杂追问、跨意图切换等高波动 AI 体验时，再加跑 `bun run regression:flow:extended`
- 改 `/ai/chat`、SSE、GenUI blocks、多端解析，至少加跑 `bun run regression:protocol`
- 准备收口一个迭代时，跑 `bun run release:gate`

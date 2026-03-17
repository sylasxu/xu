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

- `sandbox-regression`
- `five-user-smoke --cleanup`

覆盖主链路：

- 发起活动
- 报名与满员限制
- 退出后重报
- 讨论区消息
- 通知流转
- 游客/登录态 AI 会话权限

适用改动：

- 活动、报名、讨论区、通知
- Visitor-First / Action-Gated Auth
- AI 会话持久化、会话权限、报名成功承接链路

### 3. 协议与流式回归层

```bash
bun run regression:protocol
```

职责：

- `chat-full-regression`
- `genui-turns-regression`
- `genui-parity-regression`
- `genui-turns-snapshot`

覆盖重点：

- `/ai/chat` SSE 顺序
- `[DONE]` 与真实 HTTP 头
- GenUI blocks 结构
- Web / Mini 渲染契约一致性
- 固定快照场景
- 优先复用 `GENUI_CHAT_API_URL` 指向的服务；未提供且本地目标不可用时，自动拉起本地 API 再执行黑盒回归

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

- [FIVE-USER-SMOKE.md](/Users/sylas/Documents/GitHub/juchang/docs/agent-guides/FIVE-USER-SMOKE.md)：用户流程回归层
- [SANDBOX-REGRESSION.md](/Users/sylas/Documents/GitHub/juchang/docs/agent-guides/SANDBOX-REGRESSION.md)：用户流程回归层
- [chat-curl-regression.ts](/Users/sylas/Documents/GitHub/juchang/scripts/chat-curl-regression.ts)：协议与流式回归层
- [flow-regression.ts](/Users/sylas/Documents/GitHub/juchang/scripts/flow-regression.ts)：流程回归统一入口
- [release-gate.ts](/Users/sylas/Documents/GitHub/juchang/scripts/release-gate.ts)：发布门禁统一入口

## 使用建议

- 只改 API 规则，先跑 `bun run test:api`
- 改报名、讨论、通知、AI 会话等用户旅程，至少加跑 `bun run regression:flow`
- 改 `/ai/chat`、SSE、GenUI blocks、多端解析，至少加跑 `bun run regression:protocol`
- 准备收口一个迭代时，跑 `bun run release:gate`

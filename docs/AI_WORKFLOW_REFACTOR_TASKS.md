# AI Workflow 重构任务单（最终版）

## 0. 目标与原则（硬约束）

1. `ai.service` 保持为统一编排总线（入口、串联、trace、actorContext）。
2. 关键子域保持模块化：`processors/`、`memory/`、`rag/`、`tools/`、`guardrails/`、`workflow/`。
3. 禁止按消费端命名 Service（如 `admin/ops/web/mp`）。
4. 不为拆分而拆分，不新增 `ai-content.service.ts`、`ai-conversation.service.ts`。
5. Controller 不关心消费端；权限统一通过 `actorContext + capability` 判断。
6. 对外 API 路径与返回结构保持兼容。

---

## 1. 现状问题（本次重构范围）

- 命名语义不纯：`ai-ops.service.ts` / `ai-ops.controller.ts` 带消费端含义。
- Controller 鉴权分散：多处重复 `verifyAdmin` 逻辑，策略边界不统一。
- Chat Gateway 与 Policy 存在 GenUI block 构建重复实现。
- 输入护栏存在双实现口径：`processors/input-guard.ts` 与 `guardrails/input-guard.ts`。
- `ai.service` 作为总线是正确方向，但尚未形成“统一能力导出 + 统一策略入口”。

---

## 2. 分阶段任务（只做必要重构）

## Phase A：命名去端化 + 入口稳定（低风险）

### A-1 去掉 `ops` 聚合命名（按领域回归）
- **旧文件**
  - `apps/api/src/modules/ai/ai-ops.service.ts`
  - `apps/api/src/modules/ai/ai-ops.controller.ts`
- **新文件**
  - `apps/api/src/modules/ai/rag/rag.service.ts`
  - `apps/api/src/modules/ai/memory/memory.service.ts`
  - `apps/api/src/modules/ai/security/security.service.ts`
  - `apps/api/src/modules/ai/observability/ai-metrics.service.ts`
  - `apps/api/src/modules/ai/ai-metrics.controller.ts`（由 `ai-ops.controller.ts` 演进）
- **改动要点**
  - 不做“换汤不换药”重命名，不引入 `governance` 这类泛化词。
  - 先按领域迁移函数（RAG/Memory/Security/Metrics），再删除 `ai-ops.service.ts`。
  - `ai-ops.controller.ts` 收敛为指标类控制器并重命名为 `ai-metrics.controller.ts`；旧路径可保留兼容。
- **权限点**
  - 仅迁移，不新增权限语义。
- **风险**：低
- **完成定义**
  - 项目编译通过，`ops` 聚合命名从 service 层移除。

### A-2 `ai.service` 增加总线导出收口
- **触达文件**
  - `apps/api/src/modules/ai/ai.service.ts`
- **改动要点**
  - 统一导出 Chat、Session、RAG、Memory、Security、Metrics、Welcome、Content 相关入口函数。
  - Controller 后续优先从 `ai.service` 引用，不直接散落引用多个内部文件。
- **权限点**
  - 只透传 `actorContext`，不在命名层体现端差异。
- **风险**：中
- **完成定义**
  - `ai.service` 成为稳定门面，调用路径清晰。

---

## Phase B：策略收敛（中风险）

### B-1 引入统一 `actorContext`
- **新增文件**
  - `apps/api/src/modules/ai/policy/actor-context.ts`
- **改动要点**
  - 标准化上下文：`userId`、`role`、`scopes`、`source`。
  - 所有 AI Controller 进入 service 前统一构造 actorContext。
- **权限点**
  - 上下文标准化，不引入端命名。
- **风险**：中
- **完成定义**
  - 控制层与业务层上下文结构一致。

### B-2 引入 capability 策略判断
- **新增文件**
  - `apps/api/src/modules/ai/policy/capability.ts`
- **触达文件**
  - `apps/api/src/modules/ai/ai.controller.ts`
  - `apps/api/src/modules/ai/ai-sessions.controller.ts`
  - `apps/api/src/modules/ai/ai-rag.controller.ts`
  - `apps/api/src/modules/ai/ai-memory.controller.ts`
  - `apps/api/src/modules/ai/ai-security.controller.ts`
  - `apps/api/src/modules/ai/ai-metrics.controller.ts`
  - `apps/api/src/modules/ai/config/config.controller.ts`
- **改动要点**
  - 用 capability 判断替代重复 `verifyAdmin` 分叉。
  - 角色/权限由策略决定，Controller 不硬编码消费端逻辑。
- **权限点（建议）**
  - `ai.chat.invoke`
  - `ai.session.read.self` / `ai.session.read.any`
  - `ai.session.evaluate`
  - `ai.retrieval.index.rebuild`
  - `ai.security.word.write`
  - `ai.config.write`
  - `ai.metrics.read`
- **风险**：中
- **完成定义**
  - 鉴权语义统一，Controller 逻辑收敛。

---

## Phase C：模块去重与口径统一（中风险）

### C-1 GenUI block 工厂去重
- **新增文件**
  - `apps/api/src/modules/ai/shared/genui-blocks.ts`
- **触达文件**
  - `apps/api/src/modules/ai/ai-chat-gateway.service.ts`
  - `apps/api/src/modules/ai/ai-chat-policy.service.ts`
- **改动要点**
  - 抽离重复的 `createChoiceBlock`、`createEntityCardBlock`、`createCtaGroupBlock`、`createAlertBlock`、`pushBlock`。
- **权限点**
  - 无（纯函数组件）。
- **风险**：低
- **完成定义**
  - 两处重复 helper 删除，行为一致。

### C-2 输入护栏单一事实源
- **触达文件**
  - `apps/api/src/modules/ai/processors/input-guard.ts`
  - `apps/api/src/modules/ai/guardrails/input-guard.ts`
  - `apps/api/src/modules/ai/ai.service.ts`
- **改动要点**
  - `inputGuardProcessor` 复用 `guardrails/checkInput`，避免双维护词库与规则。
  - 保持 Processor 输出结构不变（兼容日志与 trace）。
- **权限点**
  - 无新增，仅规则统一。
- **风险**：中
- **完成定义**
  - Chat 与 Moderation 的输入拦截口径一致。

---

## Phase D：入口与文档收尾（低风险）

### D-1 应用入口更新
- **触达文件**
  - `apps/api/src/index.ts`
  - `apps/api/src/modules/ai/ai.controller.ts`
- **改动要点**
  - 更新引用为 `ai-metrics.controller`，并删除 `ai-ops` 命名引用。
  - 保持挂载顺序与现有行为一致。
- **风险**：低
- **完成定义**
  - 服务启动成功，AI 路由完整挂载。

### D-2 架构文档同步
- **触达文件**
  - `docs/TAD.md`
- **改动要点**
  - 将 AI 模块章节更新为：`ai.service 总线 + 子域模块化 + actorContext/capability`。
  - 明确禁止消费端命名 service。
- **风险**：低
- **完成定义**
  - 文档与代码结构一致。

---

## 3. 不做项（本轮明确排除）

1. 不新增 `ai-content.service.ts`、`ai-conversation.service.ts`。
2. 不拆散 `ai.service` 为多个平级编排 service。
3. 不修改 DB Schema，不引入迁移任务。
4. 不更改对外 API 协议结构。

---

## 4. 执行顺序建议（最小扰动）

1. Phase A（先命名与总线收口）
2. Phase B（再策略统一）
3. Phase C（最后去重与护栏口径统一）
4. Phase D（入口和文档收尾）

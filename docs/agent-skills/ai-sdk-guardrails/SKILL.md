# Skill: AI SDK Guardrails

## 适用场景

当任务涉及以下任一情况时使用本 skill：

- 修改 `apps/api/src/modules/ai/**`
- 使用 `ai` 包（`generateText` / `generateObject` / tools / stream）
- 变更 tool schema、SSE 输出、模型调用参数

## 目标

在不破坏现有业务的前提下，降低 AI SDK 升级与接口漂移风险。

## 执行清单

1. 先做 API 形态核对（当前写法 vs 推荐写法）
   - tools 优先 `inputSchema`
   - 兼容层允许读取 `parameters`，但新代码不新增旧写法
2. 明确生成模式
   - 结构化输出优先 `generateText + output`（新代码）
   - 历史 `generateObject` 仅在“本次任务触达且收益明确”时顺带收敛
3. 流式输出对齐
   - 后端统一 `toUIMessageStreamResponse`
   - 前端/客户端消费协议保持兼容，不引入私有分叉
4. 参数与终止条件
   - 使用 `maxOutputTokens`
   - 使用 `stopWhen: stepCountIs(n)` 或项目既有约束
5. 回归最小验证
   - 至少验证 1 条流式对话
   - 至少验证 1 条带工具调用的对话

## 不要做

- 不在本次任务无关范围内大面积替换全部 AI 调用
- 不新引入与现有 `TypeBox + toJsonSchema` 体系冲突的 schema 方案
- 不改变 `/ai/chat` 协议字段语义

## 仓库内快速检查命令

```bash
rg -n "generateObject|parameters:|inputSchema|toUIMessageStreamResponse|stepCountIs|maxOutputTokens" apps/api/src
```

## 产出标准

- 改动可解释：说明“为什么这次改、为什么没全量改”
- 兼容性可验证：至少给出一条实际验证命令或日志依据

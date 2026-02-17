# 实施任务：AI 模块全面优化

## Phase 1：P0 稳定性修复

- [x] 1. Tracer 并发安全修复（需求 1）
  - [x] 1.1 重写 `tracer.ts`：用 AsyncLocalStorage 替换全局变量 `currentTraceId` / `currentSpanId`，实现 `runWithTrace()` 包装函数
    - 文件：`apps/api/src/modules/ai/observability/tracer.ts`
  - [x] 1.2 为 spanStore / traceStore 添加 MAX_STORE_SIZE（默认 10000）淘汰机制，超限时删除最早条目
    - 文件：`apps/api/src/modules/ai/observability/tracer.ts`
  - [x] 1.3 添加定时清理任务（5 分钟间隔），清理超过 1 小时的过期 Span 和 Trace 数据
    - 文件：`apps/api/src/modules/ai/observability/tracer.ts`
  - [x] 1.4 更新 `ai.service.ts` 中的 Tracer 调用方式，使用 `runWithTrace()` 包装请求处理逻辑
    - 文件：`apps/api/src/modules/ai/ai.service.ts`

- [x] 2. Metrics 真实数据查询（需求 2）
  - [x] 2.1 重写 `getTokenUsageStats`：从 ai_requests 表按日期聚合查询真实 Token 使用数据，替换当前返回空数组的实现
    - 文件：`apps/api/src/modules/ai/observability/metrics.ts`
  - [x] 2.2 重写 `getToolCallStats`：从 ai_tool_calls 表聚合查询真实工具调用成功率和耗时数据
    - 文件：`apps/api/src/modules/ai/observability/metrics.ts`
  - [x] 2.3 升级 `calculateQualityScore` 为四维加权评分，权重通过 `getConfigValue('quality.score_weights', { intent: 0.3, tool: 0.3, latency: 0.2, length: 0.2 })` 动态配置
    - 文件：`apps/api/src/modules/ai/observability/quality-metrics.ts`

## Phase 2：P1 架构优化

- [x] 3. Model Router 健康检查与动态配置（需求 3）
  - [x] 3.1 修复 `checkAllProvidersHealth`：检查 qwen + deepseek（替换当前错误检查的 zhipu）
    - 文件：`apps/api/src/modules/ai/models/router.ts`
  - [x] 3.2 为 `withRetry` 的指数退避添加 MAX_RETRY_DELAY 上限，通过 `getConfigValue('model.max_retry_delay', 30000)` 动态配置
    - 文件：`apps/api/src/modules/ai/models/router.ts`
  - [x] 3.3 将 `getModelByIntent` 改为通过 `getConfigValue('model.intent_map', DEFAULT_MAP)` 读取映射，支持后台动态切换意图→模型路由
    - 文件：`apps/api/src/modules/ai/models/router.ts`

- [x] 4. RAG 批量索引、索引清理与动态配置（需求 4）
  - [x] 4.1 重写 `indexActivities`：将逐条 Embedding 调用改为批量 API 调用（按 batchSize 分批，一次 API 生成多条 Embedding）
    - 文件：`apps/api/src/modules/ai/rag/search.ts`
  - [x] 4.2 新增 `onActivityStatusChange`：活动状态变为 completed/cancelled 时将 embedding 字段设为 NULL
    - 文件：`apps/api/src/modules/ai/rag/search.ts`
  - [x] 4.3 增强 `generateMatchReason`：使用包含距离、时间、类型匹配等具体信息的模板替换当前笼统文案
    - 文件：`apps/api/src/modules/ai/rag/search.ts`
  - [x] 4.4 将 RAG 搜索参数（defaultLimit、defaultThreshold、MAXSIM_BOOST_RATIO）改为通过 `getConfigValue('rag.search_options', DEFAULT_RAG_CONFIG)` 动态配置
    - 文件：`apps/api/src/modules/ai/rag/search.ts`、`apps/api/src/modules/ai/rag/types.ts`

- [x] 5. Tools 超时保护、指标记录与动态配置（需求 5）
  - [x] 5.1 在 `executor.ts` 中实现 `withTimeout` 和 `executeToolWithMetrics`：超时阈值通过 `getConfigValue('tools.timeouts', DEFAULT_TIMEOUTS)` 动态配置（默认查询类 5s / 写入类 10s），执行结果写入 ai_tool_calls 表
    - 文件：`apps/api/src/modules/ai/tools/executor.ts`
  - [x] 5.2 将 `INTENT_TOOL_MAP` 改为通过 `getConfigValue('tools.intent_map', INTENT_TOOL_MAP)` 动态配置，支持后台调整意图→工具映射
    - 文件：`apps/api/src/modules/ai/tools/registry.ts`
  - [x] 5.3 清理废弃函数（getToolNamesForIntent、getToolsForIntent、getAllTools），将调用方迁移到 getToolNamesByIntent / resolveToolsForIntent
    - 文件：`apps/api/src/modules/ai/tools/registry.ts`
    - 关联文件：所有引用废弃函数的调用方

- [x] 6. Guardrails 动态配置、动态敏感词与 Output Guard 激活（需求 6）
  - [x] 6.1 将 InputGuardConfig / OutputGuardConfig / RateLimitConfig 的默认值改为通过 `getConfigValue` 动态配置：`guardrails.input_config`、`guardrails.output_config`、`guardrails.rate_limit`
    - 文件：`apps/api/src/modules/ai/guardrails/input-guard.ts`、`apps/api/src/modules/ai/guardrails/output-guard.ts`、`apps/api/src/modules/ai/guardrails/rate-limiter.ts`
  - [x] 6.2 在 `input-guard.ts` 中集成 ai_sensitive_words 表动态加载（5 分钟内存缓存），与硬编码基础列表合并检测
    - 文件：`apps/api/src/modules/ai/guardrails/input-guard.ts`
  - [x] 6.3 新建 `output-guard.ts` Processor 纯函数，封装已有的 checkOutput/sanitizeOutput 为 Post-LLM Processor
    - 文件：`apps/api/src/modules/ai/processors/output-guard.ts`
  - [x] 6.4 在 ai.service.ts 的 Post-LLM 阶段注册并调用 outputGuardProcessor
    - 文件：`apps/api/src/modules/ai/ai.service.ts`

- [x] 7. ai.service.ts 主入口重构（需求 13）
  - [x] 7.1 新建 `record-metrics.ts` Processor：从 onFinish 中提取指标记录逻辑（countAIRequest、recordAILatency、recordTokenUsage）
    - 文件：`apps/api/src/modules/ai/processors/record-metrics.ts`
  - [x] 7.2 新建 `persist-request.ts` Processor：从 onFinish 中提取 ai_requests 表写入逻辑
    - 文件：`apps/api/src/modules/ai/processors/persist-request.ts`
  - [x] 7.3 新建 `evaluate-quality.ts` Processor：从 onFinish 中提取质量评估和 conversationMetrics 记录逻辑
    - 文件：`apps/api/src/modules/ai/processors/evaluate-quality.ts`
  - [x] 7.4 重构 ai.service.ts 的 onFinish：替换内联逻辑为 runProcessors([recordMetricsProcessor, persistRequestProcessor, evaluateQualityProcessor])
    - 文件：`apps/api/src/modules/ai/ai.service.ts`
  - [x] 7.5 将辅助函数迁移出 ai.service.ts：getUserNickname → users.service.ts，reverseGeocode → utils/geo.ts
    - 文件：`apps/api/src/modules/ai/ai.service.ts`
    - 关联文件：对应的目标 service 文件
  - [x] 7.6 重构 `createTracedStreamResponse`：从 ProcessorContext.metadata 读取各处理器数据，移除手动 findLogDuration/findLogData 提取
    - 文件：`apps/api/src/modules/ai/ai.service.ts`

## Phase 3：P2 功能增强

- [x] 8. Evals 数据集扩展、持久化与动态配置（需求 7）
  - [x] 8.1 扩展评估数据集到至少 20 个样本，覆盖所有主要意图类型（chat、create、explore、partner、query 等）
    - 文件：`apps/api/src/modules/ai/evals/runner.ts`
  - [x] 8.2 实现评估结果持久化：将运行 ID、各维度得分、总分写入 ai_eval_samples 表
    - 文件：`apps/api/src/modules/ai/evals/runner.ts`
  - [x] 8.3 在 `scorers.ts` 中增加中文输出质量检测维度：非空检查、长度合理性、乱码/截断检测
    - 文件：`apps/api/src/modules/ai/evals/scorers.ts`
  - [x] 8.4 将评估配置（通过阈值、并发数、超时）改为通过 `getConfigValue('evals.run_config', DEFAULT_EVAL_CONFIG)` 动态配置
    - 文件：`apps/api/src/modules/ai/evals/runner.ts`

- [x] 9. Workflow 定时清理（需求 8）
  - [x] 9.1 在 `workflow.ts` 模块初始化时启动定时清理任务（5 分钟间隔），调度已有的 `cleanupExpiredWorkflows` 函数
    - 文件：`apps/api/src/modules/ai/workflow/workflow.ts`
  - [x] 9.2 为 workflowStore 添加条目上限（默认 1000），超限时自动淘汰最早的过期条目
    - 文件：`apps/api/src/modules/ai/workflow/workflow.ts`

- [x] 10. Prompts 版本化管理（需求 9）
  - [x] 10.1 在 `index.ts` 中实现版本注册表（PROMPT_REGISTRY Map），注册 v38 和 v39
    - 文件：`apps/api/src/modules/ai/prompts/index.ts`
  - [x] 10.2 实现 `getSystemPrompt` 函数：通过 `getConfigValue('prompts.active_version', 'v39')` 动态加载对应版本，支持后台一键切换/回滚
    - 文件：`apps/api/src/modules/ai/prompts/index.ts`
  - [x] 10.3 更新 ai.service.ts 中的 Prompt 加载逻辑，调用 `getSystemPrompt(ctx)` 替换硬编码导入
    - 文件：`apps/api/src/modules/ai/ai.service.ts`

- [x] 11. Agent 废弃模块清理（需求 10）
  - [x] 11.1 扫描所有 agent 模块引用，将必要的类型定义迁移到 `processors/types.ts`
    - 文件：`apps/api/src/modules/ai/processors/types.ts`
    - 扫描范围：`apps/api/src/modules/ai/agent/types.ts`、所有 `from './agent'` 引用
  - [x] 11.2 确认 agent 模块中的功能已被 Processor 架构完全替代后，删除 `agent/` 目录
    - 删除目录：`apps/api/src/modules/ai/agent/`
  - [x] 11.3 更新 `index.ts` 移除 agent 相关导出，确保外部模块不受影响
    - 文件：`apps/api/src/modules/ai/index.ts`

- [x] 12. Anomaly AI 异常检测扩展与动态配置（需求 11）
  - [x] 12.1 新增 `detectHighTokenUsage`：从 ai_requests 表查询 24h 内单用户 Token 消耗超阈值的异常用户
    - 文件：`apps/api/src/modules/ai/anomaly/detector.ts`
  - [x] 12.2 新增 `detectDuplicateRequests`：检测 1h 内相同输入超过阈值的高频重复请求
    - 文件：`apps/api/src/modules/ai/anomaly/detector.ts`
  - [x] 12.3 将所有异常检测阈值（含已有的 bulk_create、frequent_cancel 和新增的 AI 阈值）统一改为通过 `getConfigValue('anomaly.thresholds', DEFAULT_THRESHOLDS)` 动态配置
    - 文件：`apps/api/src/modules/ai/anomaly/detector.ts`
  - [x] 12.4 实现异常检测结果持久化到 ai_security_events 表
    - 文件：`apps/api/src/modules/ai/anomaly/detector.ts`

- [x] 13. Moderation 批量审核、结果持久化与动态配置（需求 12）
  - [x] 13.1 新增 `analyzeActivities` 批量分析接口，接受活动 ID 列表并返回每个活动的审核结果
    - 文件：`apps/api/src/modules/ai/moderation/moderation.service.ts`
  - [x] 13.2 实现审核结果持久化：将风险评分、触发规则、建议操作写入 ai_security_events 表
    - 文件：`apps/api/src/modules/ai/moderation/moderation.service.ts`
  - [x] 13.3 将风险评分规则（RISK_RULES）和风险等级阈值改为通过 `getConfigValue('moderation.risk_rules', DEFAULT_RULES)` 动态配置
    - 文件：`apps/api/src/modules/ai/moderation/moderation.service.ts`

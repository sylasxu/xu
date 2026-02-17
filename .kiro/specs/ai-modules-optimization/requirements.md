# 需求文档：AI 模块全面优化

## 简介

对聚场 AI 系统中 12 个模块进行系统性评估和优化。优先修复并发安全等严重 bug，再进行架构优化和功能增强。所有涉及动态配置的模块统一通过现有的 AI_Config 服务（`config.service.ts` 的 `getConfigValue`）读取配置。

**自我复盘结论**：砍掉了 Workflow 数据库持久化（短生命周期工作流不值得新建表）、RAG 四阶段搜索抽象（当前搜索够用）、完整 Circuit Breaker（流量不大，简单 fallback 足够）、Guardrails 微信 msgSecCheck 集成（不适合放在请求关键路径）。保留真正有价值的修复和优化。

## 术语表

- **Tracer**: 分布式追踪模块，负责记录请求链路中的 Span 和 Trace
- **AsyncLocalStorage**: Node.js/Bun 内置的异步上下文存储，可在异步调用链中安全传递上下文
- **Processor**: AI 管线中的纯函数处理单元，通过 `runProcessors()` 串联执行
- **RAG**: Retrieval-Augmented Generation，语义检索增强生成
- **Model_Router**: 模型路由器，根据意图选择合适的 LLM 模型
- **Guardrails**: 安全护栏，包含输入检测、输出过滤、频率限制
- **Eval_Runner**: 评估运行器，执行 AI 响应质量评估
- **Workflow_Engine**: 基于状态机的工作流引擎，管理多步骤交互流程
- **AI_Config**: 数据库驱动的 AI 配置系统（`ai_configs` 表 + `config.service.ts`），已支持缓存（30s TTL）、版本管理和回滚
- **Quality_Score**: 对话质量评分，综合意图置信度、工具成功率、响应延迟、输出合理性
- **ai_sensitive_words**: 已存在的敏感词数据库表，支持分类、严重程度和启用状态管理

## 需求

### 需求 1：Tracer 并发安全修复（P0）

**用户故事：** 作为系统运维人员，我希望追踪系统在并发请求下能正确隔离上下文，以便准确定位每个请求的链路信息。

#### 验收标准

1. WHEN 多个并发请求同时创建 Trace, THE Tracer SHALL 使用 AsyncLocalStorage 隔离每个请求的 traceId 和 spanId，确保请求间互不覆盖
2. WHEN spanStore 或 traceStore 中的条目数量超过配置上限（默认 10000 条）, THE Tracer SHALL 自动淘汰最早的条目，防止内存无限增长
3. WHEN Tracer 模块初始化时, THE Tracer SHALL 启动定时清理任务（默认每 5 分钟），自动清理超过 1 小时的过期数据
4. WHEN 一个 Span 结束时, THE Tracer SHALL 通过 AsyncLocalStorage 恢复到正确的父 Span 上下文

### 需求 2：Metrics 真实数据查询（P0）

**用户故事：** 作为产品运营人员，我希望 Admin 后台能查到真实的 Token 和 Tool 统计数据，以便评估 AI 服务质量。

#### 验收标准

1. WHEN Admin 后台查询 Token 使用统计时, THE Metrics 模块 SHALL 从 ai_requests 数据库表聚合查询并返回真实的每日统计数据（当前 getTokenUsageStats 返回空数组）
2. WHEN Admin 后台查询 Tool 调用统计时, THE Metrics 模块 SHALL 从 ai_tool_calls 数据库表聚合查询并返回真实的工具调用成功率和耗时数据（当前 getToolCallStats 返回空数组）
3. WHEN 计算对话质量评分时, THE Quality_Score SHALL 综合意图置信度（0.3）、工具成功率（0.3）、响应延迟合理性（0.2）、输出长度合理性（0.2）四个维度加权计算（当前只有两个维度）

### 需求 3：Model Router 健康检查修复（P1）

**用户故事：** 作为系统运维人员，我希望模型路由器能准确检测实际使用的提供商健康状态，以便保障 AI 服务可用性。

#### 验收标准

1. WHEN 执行健康检查时, THE Model_Router SHALL 检查实际使用的提供商（qwen 和 deepseek），而非检查未使用的 zhipu
2. WHEN withRetry 执行指数退避时, THE Model_Router SHALL 将延迟上限限制在 30 秒内（当前无上限）
3. WHEN 意图到模型的映射需要调整时, THE Model_Router SHALL 通过 `getConfigValue('model.intent_map', DEFAULT_MAP)` 读取映射配置，支持动态切换（当前 getModelByIntent 硬编码）

### 需求 4：RAG 批量索引与索引清理（P1）

**用户故事：** 作为开发者，我希望 RAG 模块能高效批量索引且在活动结束时自动清理索引，以便维护索引一致性。

#### 验收标准

1. WHEN 批量索引活动时, THE RAG 模块 SHALL 将同一批次内的 Embedding 生成请求合并为一次批量 API 调用（当前 indexActivities 逐条调用 indexActivity，每条单独请求 Embedding）
2. WHEN 活动状态从 active 变更为 completed 或 cancelled 时, THE RAG 模块 SHALL 自动将该活动的 embedding 字段设为 NULL（搜索查询已有 `isNotNull(activities.embedding)` 过滤条件）
3. WHEN generateMatchReason 被调用时, THE RAG 模块 SHALL 使用包含距离、时间、类型匹配等具体信息的模板生成理由（当前只基于 score 阈值生成笼统文案）

### 需求 5：Tools 超时保护与指标记录（P1）

**用户故事：** 作为开发者，我希望工具系统有超时保护和指标收集，以便提升工具调用的可靠性和可观测性。

#### 验收标准

1. WHEN 工具执行时间超过配置的超时阈值（查询类 5 秒、写入类 10 秒）时, THE Tools 模块 SHALL 中断执行并返回超时错误
2. WHEN 工具执行完成（成功或失败）时, THE Tools 模块 SHALL 将执行时间、成功状态、工具名称记录到 ai_tool_calls 数据库表（表已存在但未写入数据）
3. WHEN 废弃函数（getToolNamesForIntent、getToolsForIntent、getAllTools）存在时, THE Tools 模块 SHALL 移除这些函数并将调用方迁移到 getToolNamesByIntent 和 resolveToolsForIntent

### 需求 6：Guardrails 动态敏感词与 Output Guard（P1）

**用户故事：** 作为内容安全运营人员，我希望敏感词列表可以从数据库动态加载且 Output Guard 被实际启用，以便及时应对新的安全风险。

#### 验收标准

1. WHEN 执行输入检测时, THE Guardrails 模块 SHALL 从 ai_sensitive_words 数据库表加载启用状态的敏感词（带 5 分钟内存缓存），与硬编码的基础列表合并后进行检测（ai_sensitive_words 表和 ai-ops.service.ts 中的加载逻辑已存在，但 input-guard.ts 未集成）
2. WHEN AI 生成响应文本后, THE Guardrails 模块 SHALL 在 Post-LLM 阶段以 Processor 纯函数形式对输出执行 Output Guard 检查（output-guard.ts 的 checkOutput/sanitizeOutput 已实现但未被调用）

### 需求 7：Evals 数据集扩展与持久化（P2）

**用户故事：** 作为 AI 产品经理，我希望评估系统有更丰富的数据集和持久化的评估结果，以便追踪 AI 质量变化趋势。

#### 验收标准

1. WHEN 运行评估时, THE Eval_Runner SHALL 使用至少 20 个评估样本覆盖主要意图类型（当前只有 5 个样本）
2. WHEN 评估完成后, THE Eval_Runner SHALL 将评估结果（运行 ID、各维度得分、总分）持久化到 ai_eval_samples 数据库表（表已存在但未写入数据）
3. WHEN 评估响应质量时, THE Eval_Runner SHALL 增加中文输出质量检测维度：输出非空、长度合理、不含乱码或截断（当前 evaluateResponseQuality 评分过于简单）

### 需求 8：Workflow 定时清理（P2）

**用户故事：** 作为开发者，我希望过期工作流能被自动清理，以便防止内存泄漏。

**自我复盘**：原需求要求新建 workflow_states 表做数据库持久化。但 draft-flow 30 分钟过期、match-flow 也是短生命周期，服务重启丢失影响极小。新建表 + 重写引擎的成本远大于收益。只需加上定时清理即可。

#### 验收标准

1. WHEN Workflow 模块初始化时, THE Workflow_Engine SHALL 启动定时清理任务（默认每 5 分钟），自动清理过期工作流（当前 cleanupExpiredWorkflows 已实现但未被调度）
2. WHEN workflowStore 中的条目数量超过上限（默认 1000）时, THE Workflow_Engine SHALL 自动淘汰最早的过期条目

### 需求 9：Prompts 版本化管理（P2）

**用户故事：** 作为 AI 工程师，我希望 Prompt 版本可以通过配置动态切换，以便快速迭代和回滚。

#### 验收标准

1. WHEN 系统需要加载 System Prompt 时, THE Prompts 模块 SHALL 根据 `getConfigValue('prompts.active_version', 'v39')` 加载对应的 Prompt 模板（当前 index.ts 硬编码导出 xiaoju-v39）
2. WHEN 新的 Prompt 版本注册时, THE Prompts 模块 SHALL 通过版本注册表（代码内 Map）管理所有可用版本，支持按版本号精确加载

### 需求 10：Agent 废弃模块清理（P2）

**用户故事：** 作为开发者，我希望废弃的 Agent 模块被安全移除，以便减少代码复杂度和维护负担。

#### 验收标准

1. WHEN 清理 Agent 模块前, THE 系统 SHALL 确认 ai.service.ts 和 index.ts 中的 agent 引用都有对应的替代方案（ai.service.ts 引用 streamChat/generateChat 类型，index.ts 做 re-export）
2. WHEN Agent 模块被移除后, THE 系统 SHALL 确保所有原有功能通过 ai.service.ts 和 Processor 架构正常运行
3. WHEN 存在外部模块依赖 Agent 导出的类型定义时, THE 系统 SHALL 将必要的类型定义迁移到 processors/types.ts 或对应的新模块中

### 需求 11：Anomaly AI 异常检测扩展（P2）

**用户故事：** 作为系统运维人员，我希望异常检测能覆盖 AI 相关的异常行为，以便及时发现滥用。

#### 验收标准

1. WHEN 检测异常时, THE Anomaly 模块 SHALL 增加 AI 相关检测规则：异常高 Token 消耗（单用户 24h 超过阈值）和高频重复请求（相同输入 1h 超过阈值）
2. WHEN 异常检测阈值需要调整时, THE Anomaly 模块 SHALL 通过 `getConfigValue('anomaly.thresholds', DEFAULT_THRESHOLDS)` 读取阈值配置（当前硬编码）
3. WHEN 检测到异常时, THE Anomaly 模块 SHALL 将检测结果持久化到 ai_security_events 数据库表（表已存在）

### 需求 12：Moderation 批量审核与结果持久化（P2）

**用户故事：** 作为内容安全运营人员，我希望内容审核支持批量分析和结果持久化，以便更高效地处理违规内容。

#### 验收标准

1. WHEN 需要批量审核活动时, THE Moderation 模块 SHALL 支持批量分析接口，接受活动 ID 列表并返回每个活动的审核结果（当前只有单个 analyzeActivity）
2. WHEN 审核完成后, THE Moderation 模块 SHALL 将审核结果（风险评分、触发规则、建议操作）持久化到 ai_security_events 数据库表（当前无持久化）
3. WHEN 风险评分规则需要调整时, THE Moderation 模块 SHALL 通过 `getConfigValue('moderation.risk_rules', DEFAULT_RULES)` 读取评分权重配置（当前硬编码 RISK_RULES）

### 需求 13：ai.service.ts 主入口重构（P1）

**用户故事：** 作为开发者，我希望 ai.service.ts 的 onFinish 回调职责清晰、逻辑解耦，以便更容易维护和扩展。

#### 验收标准

1. WHEN AI 请求完成时, THE ai.service.ts SHALL 将 onFinish 中的逻辑拆分为独立的 Post-LLM Processor 纯函数：recordMetricsProcessor（指标记录）、persistRequestProcessor（请求持久化）、evaluateQualityProcessor（质量评估）
2. WHEN Post-LLM Processor 执行失败时, THE ai.service.ts SHALL 记录错误日志但不影响其他 Processor 的执行和响应返回
3. WHEN 辅助函数（getUserNickname、reverseGeocode、listConversations 等）被调用时, THE ai.service.ts SHALL 从独立的 service 模块导入这些函数，而非在 ai.service.ts 中内联定义
4. WHEN createTracedStreamResponse 构建追踪响应时, THE ai.service.ts SHALL 直接从 ProcessorContext.metadata 读取各处理器的数据，而非手动从 processorLogs 数组提取

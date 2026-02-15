# 实施计划：AI 核心系统增强

## 概述

本计划将 AI 核心系统增强拆分为 4 个阶段，按依赖关系递进实施：语义命名重构（基础）→ 处理器架构增强 → [意图分类增强 ∥ 记忆系统增强 ∥ AI 配置模块]（并行）→ Playground 调试增强。阶段 3 完成后，意图分类、记忆系统和配置模块互不依赖，可并行推进；Playground 依赖前三者的数据结构和 API，放在最后。

## Tasks

- [x] 1. 语义命名重构（需求 5）
  - [x] 1.1 重命名 ai.service.ts 核心函数和变量
    - 将 `streamChat` 重命名为 `handleChatStream`
    - 将 `createQuickResponse` 重命名为 `createDirectResponse`
    - 将 `wrapWithTrace` 重命名为 `createTracedStreamResponse`
    - 将 `traceSteps` 重命名为 `toolCallRecords`
    - 将 `lastUserMessage` 重命名为 `rawUserInput`（原始输入，用于 trace/DB），将 `sanitizedMessage` 重命名为 `sanitizedInput`（净化后输入，用于后续处理），`ProcessorContext.userInput` 明确存储 sanitizedInput
    - 将 P0 阶段变量前缀从 `p0*` 改为 `keyword*`（如 `keywordMatchStartTime`、`keywordMatchDuration`、`keywordMatchData`）
    - 将 P1 阶段计时变量前缀改为 `intentClassify*`（如 `intentClassifyStartTime`、`intentClassifyDuration`），`intentResult` 保持不变（它是分类结果，不是阶段变量）
    - 代码注释中首次出现缩写时提供完整展开（如 `A2UI (Action-to-UI: 结构化用户操作直接映射为 UI 响应)`）
    - 更新 ai.controller.ts 中对重命名函数的引用
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.10, 5.11, 5.12, 5.14_

  - [x] 1.2 重命名 memory 模块类型和函数，统一 Processor 后缀
    - 在 `memory/types.ts` 中将 `Thread` 重命名为 `ConversationThread`，`ThreadMessage` 重命名为 `ConversationThreadMessage`
    - 将 `SimpleMessage` 重命名为 `RecalledMessage`
    - 在 `memory/extractor.ts` 中将 `extractPreferences` 重命名为 `extractPreferencesFromConversation`
    - 为所有现有 Processor 纯函数统一添加 `Processor` 后缀：
      - `processors/input-guard.ts`：`inputGuard` → `inputGuardProcessor`
      - `processors/user-profile.ts`：`userProfile` → `userProfileProcessor`
      - `processors/semantic-recall.ts`：`semanticRecall` → `semanticRecallProcessor`
      - `processors/token-limit.ts`：`tokenLimit` → `tokenLimitProcessor`
      - `processors/save-history.ts`：`saveHistory` → `saveHistoryProcessor`
      - `processors/extract-preferences.ts`：`extractPreferences` → `extractPreferencesProcessor`
    - 更新 `processors/index.ts` 导出和所有引用这些类型和函数的文件
    - _需求: 5.7, 5.8, 5.9, 5.13_

  - [x] 1.3 合并工具解析函数并清理旧版包装函数
    - 将 `tools/index.ts` 的 `getToolsByIntent` 和 `tools/registry.ts` 的 `getToolsForIntent` 合并为 `resolveToolsForIntent`，统一放在 `tools/registry.ts`
    - 将 `intent/router.ts` 的 `getToolsForIntent` 和 `tools/registry.ts` 的 `getToolNamesForIntent` 合并为单一函数 `getToolNamesByIntent`，放在 `tools/registry.ts`，`intent/router.ts` 中的原函数删除或转发
    - 删除旧版包装函数 `injectUserProfile` 和 `injectSemanticRecall`（已被标准 Processor 替代，实际删除在任务 3.6 重构完成后执行）
    - 更新 ai.service.ts 和其他引用处
    - _需求: 5.5, 5.6, 5.13_

- [x] 2. 检查点 - 语义命名重构完成
  - 确保所有重命名后的引用正确，无编译错误，请用户确认是否有疑问。

- [x] 3. 处理器架构增强（需求 1）
  - [x] 3.1 增强 ProcessorContext 和 ProcessorMetadata 类型
    - 在 `processors/types.ts` 中定义 `ProcessorMetadata` 接口（包含 `keywordMatch`、`intentClassify`、`userProfile`、`semanticRecall`、`conversationSummary` 等命名空间）
    - 更新 `ProcessorContext` 的 `metadata` 字段类型为 `ProcessorMetadata`
    - 定义 `ProcessorConfig` 接口（包含 `processor`、`condition`、`parallelGroup` 字段）
    - 更新现有处理器的类型引用
    - _需求: 1.1_

  - [x] 3.2 增强 runProcessors 编排器
    - 重构 `processors/index.ts` 中的 `runProcessors` 函数，支持 `ProcessorConfig[]` 输入
    - 实现条件执行逻辑：`condition` 返回 `false` 时跳过处理器，记录到 `skipped` 数组
    - 实现并行组执行：相同 `parallelGroup` 的连续处理器使用 `Promise.all` 并行执行
    - 实现并行组 context 合并策略：`systemPrompt` 按声明顺序拼接，`metadata` 浅合并
    - 返回值增加 `skipped` 字段
    - _需求: 1.2, 1.3, 1.4, 1.5_

  - [x] 3.3 实现 Pre-LLM / Post-LLM / Async 三阶段失败策略
    - Pre-LLM 阶段：任一处理器 `success: false` 时停止后续执行，返回 `createDirectResponse`
    - Post-LLM 阶段：处理器失败时记录日志但继续执行后续处理器
    - Async 阶段：使用 `Promise.allSettled` 异步并行执行，失败静默记录日志
    - _需求: 1.6, 1.7, 1.8_

  - [x] 3.4 新增 keyword-match-processor
    - 创建 `processors/keyword-match.ts`，将 `handleChatStream` 中内联的 P0 关键词匹配逻辑提取为标准 Processor
    - 符合 `ProcessorFn` 签名，设置 `processorName = 'keyword-match-processor'`
    - 命中时将匹配数据写入 `context.metadata.keywordMatch`
    - 作为独立预检查步骤在 `runProcessors` 管线之前执行（P0 命中后直接返回 `createDirectResponse`）
    - _需求: 1.9_

  - [x] 3.5 新增 intent-classify-processor
    - 创建 `processors/intent-classify.ts`，将内联的意图分类逻辑提取为标准 Processor
    - 符合 `ProcessorFn` 签名，设置 `processorName = 'intent-classify-processor'`
    - 仅处理 P1 和 P2 层（P0 由 keyword-match-processor 处理）
    - 将分类结果写入 `context.metadata.intentClassify`
    - 配置条件执行：`condition: (ctx) => !ctx.metadata.keywordMatch?.matched`
    - _需求: 1.9_

  - [x] 3.6 重构 user-profile-processor 和 semantic-recall-processor 为标准 ProcessorFn
    - 确保 `processors/user-profile.ts` 和 `processors/semantic-recall.ts` 符合 `ProcessorFn` 签名
    - 配置为并行组 `parallelGroup: 'inject'`
    - 输出分别写入 `context.metadata.userProfile` 和 `context.metadata.semanticRecall`
    - _需求: 1.10_

  - [x] 3.7 创建处理器管线注册表和工厂函数
    - 创建 `processors/pipeline.ts`，实现 `registerProcessor` 和 `buildPreLLMPipeline` 函数
    - 内置处理器按设计文档顺序注册：intent-classify → [user-profile ∥ semantic-recall] → token-limit
    - 支持动态注册自定义 Processor
    - _需求: 1.2, 1.6_

  - [x] 3.8 重构 handleChatStream Pre-LLM 阶段
    - 将 `handleChatStream` 中 LLM 调用之前的内联逻辑替换为管线调用
    - 流程：keyword-match-processor（预检查）→ `runProcessors(preLLMConfigs)` → LLM 推理
    - 所有处理器间数据通过 `context.metadata` 传递，禁止闭包变量
    - 记录每个处理器的执行日志到 `processorLog`
    - _需求: 1.2, 1.5, 1.6, 1.9_

  - [x] 3.9 重构 handleChatStream Post-LLM 和 Async 阶段
    - 将 LLM 推理之后的内联逻辑替换为 `runProcessors(postLLMConfigs)` 调用
    - 实现 Async 阶段：使用 `Promise.allSettled` 异步并行执行后台处理器（save-history、extract-preferences 等）
    - 确保 handleChatStream 无残留内联处理逻辑，所有阶段均通过管线编排
    - _需求: 1.6, 1.7, 1.8_

- [x] 4. 检查点 - 处理器架构增强完成
  - 确保所有处理器通过 runProcessors 编排执行，handleChatStream 无内联处理逻辑，请用户确认是否有疑问。

- [x] 5. 意图分类增强（需求 2）— 可与任务 7、9 并行
  - [x] 5.1 实现 Feature_Combination 规则引擎
    - 创建 `intent/feature-combination.ts`
    - 定义 `FeatureSignal`、`FeatureCombinationRule` 接口
    - 实现 `classifyByFeatureCombination` 函数，置信度公式：`min(baseConfidence + hitCount × signalBoost, maxConfidence)`
    - 定义 `DEFAULT_FEATURE_RULES` 默认规则集（覆盖 create、explore、partner、chitchat 等意图）
    - 实现 `loadFeatureRules` 函数支持外部配置加载
    - 修复贪婪正则：确保"想"、"约"等通用词不会错误匹配
    - _需求: 2.1, 2.6_

  - [x] 5.2 实现 P2 LLM Few-shot 分类器
    - 创建 `intent/llm-classifier.ts`
    - 定义 `FewShotExample` 接口和 `DEFAULT_FEW_SHOT_EXAMPLES`（5-8 个标注样例）
    - 实现 `classifyByLLMFewShot` 函数，使用 Few-shot prompting 替代长规则描述
    - 实现 `editDistance` 函数和 `EditDistanceCache`（全局单例，TTL 5 分钟，缓存上限 1000 条 LRU 淘汰）
    - 分类前检查缓存：编辑距离 < 3 且未过期则复用
    - 实现 `loadFewShotExamples` 函数支持从数据库加载
    - _需求: 2.4_

  - [x] 5.3 实现三层漏斗级联逻辑
    - 在 `intent-classify-processor` 中集成 P1（Feature_Combination）和 P2（LLM Few-shot）
    - P1 置信度 ≥ 0.7 直接返回；< 0.7 升级到 P2
    - P1 代码异常时降级到 P2，标记 `metadata.intentClassify.degraded: true`
    - P1 和 P2 均无法确定时，降级到对话历史最近有效意图，最终兜底 `unknown`
    - 传递最近 3 轮对话（6 条消息）作为分类上下文
    - _需求: 2.2, 2.3, 2.5, 2.8_

  - [x] 5.4 实现意图分类 Trace 记录
    - 分类完成后记录分类方法（P0/P1/P2）、匹配模式、置信度和耗时到 `toolCallRecords`
    - 扩展 `ClassifyResult` 类型，增加 `p1Features` 字段
    - _需求: 2.7_

- [x] 6. 检查点 - 并行阶段各模块完成
  - 意图分类：确保三层漏斗 P0→P1→P2 级联正确，贪婪正则已修复
  - 记忆系统：确保时间衰减、偏好冲突处理、语义召回增强均正常工作
  - 配置模块：确保配置 CRUD、缓存加载、版本回滚、Admin 编辑器均正常工作
  - 请用户确认是否有疑问。

- [x] 7. 记忆系统增强（需求 3）— 可与任务 5、9 并行
  - [x] 7.1 实现时间衰减函数和偏好评分
    - 创建 `memory/temporal-decay.ts`
    - 实现 `calculateTemporalDecay` 函数（0-7天: 1.0, 7-30天: 线性→0.3, 30-90天: 线性→0.1, >90天: 0）
    - 实现 `calculatePreferenceScore` 函数（`confidence × temporalDecay`）
    - _需求: 3.1_

  - [x] 7.2 扩展 EnhancedPreference 并实现偏好合并逻辑
    - 在 `memory/working.ts` 中为 `EnhancedPreference` 新增 `mentionCount` 字段（初始值 1）
    - 在 `mergeEnhancedPreferences` 中实现矛盾偏好冲突处理：通过 `category + value` 匹配，`sentiment` 不同时覆盖情感标签，旧偏好 `confidence` 降低 50%
    - 实现 mentionCount 累加：同一偏好再次提及时 `mentionCount + 1`，`confidence + 0.1`（上限 1.0）
    - _需求: 3.2, 3.3, 3.7_

  - [x] 7.3 实现偏好清理策略
    - 在 `saveEnhancedUserProfile` 中增加清理逻辑：偏好数量 > 30 时，移除 `confidence < 0.2` 且 `updatedAt` 超过 30 天的偏好
    - _需求: 3.4_

  - [x] 7.4 实现偏好信号前置检查
    - 创建 `memory/preference-signal.ts`
    - 定义 `PREFERENCE_SIGNAL_KEYWORDS` 关键词列表（"喜欢"、"不吃"等）
    - 实现 `hasPreferenceSignal` 函数，仅检测到偏好信号时才触发 LLM 提取
    - 在 `extract-preferences-processor` 中集成前置检查
    - _需求: 3.8_

  - [x] 7.5 实现 Importance_Score 计算
    - 创建 `memory/importance.ts`
    - 定义 `ImportanceFactors` 接口
    - 实现 `calculateImportanceScore` 函数（基础分 0.3，每个 factor +0.175，上限 1.0）
    - 在消息保存到 `conversation_messages` 时计算并存储 Importance_Score
    - _需求: 3.9_

  - [x] 7.6 增强 semantic-recall-processor
    - 扩展搜索范围：同时搜索 `conversation_messages` 表和 `activities` 表
    - 将相似度阈值从 0.7 降低至 0.5
    - 合并结果后使用 `qwen3-rerank` 进行重排序，返回 top-K 结果（K=5）
    - 优先返回高 Importance_Score 的消息
    - _需求: 3.5_

  - [x] 7.7 增强画像 Prompt 构建
    - 修改 `buildProfilePrompt` 函数，按 `confidence × temporalDecay` 综合分数降序排列偏好
    - 排除综合分数为 0（超过 90 天）的偏好
    - _需求: 3.6, 3.11_

  - [x] 7.8 实现 Post-Activity Flow 兴趣向量更新
    - 在用户参与活动并给出正面反馈时，自动更新 InterestVector
    - 确保 MaxSim 个性化推荐策略使用最新的用户兴趣数据
    - _需求: 3.10_

- [x] 9. AI 参数配置模块 - 数据库与 API（需求 6）— 可与任务 5、7 并行
  - [x] 9.1 新增 ai_configs 和 ai_config_history 数据库表
    - 在 `packages/db/src/schema/` 中创建 `ai-configs.ts`
    - 定义 `aiConfigs` 表（id, configKey, configValue, category, description, version, updatedAt, updatedBy, createdAt）
    - 定义 `aiConfigHistory` 表（id, configKey, configValue, version, updatedAt, updatedBy, createdAt）
    - 导出 `insertAiConfigSchema` 和 `selectAiConfigSchema`
    - 在 `schema/index.ts` 中导出新表
    - 执行 `bun run db:generate` 和 `bun run db:migrate`
    - _需求: 6.1_

  - [x] 9.2 实现配置加载服务（config.service.ts）
    - 创建 `apps/api/src/modules/ai/config/config.service.ts`
    - 实现内存缓存（TTL 30 秒）
    - 实现 `getConfigValue<T>(configKey, defaultValue)` 函数（缓存优先 → 数据库 → 默认值降级）
    - 实现 `setConfigValue(configKey, configValue, updatedBy)` 函数（写数据库 + 刷新缓存 + 自动递增版本号）
    - 实现 `getConfigHistory(configKey)` 函数
    - 配置加载失败或格式非法时降级到代码默认值并记录错误日志
    - _需求: 6.7, 6.8, 6.9, 6.10_

  - [x] 9.3 实现配置 API 端点（config.controller.ts）
    - 创建 `apps/api/src/modules/ai/config/config.controller.ts`
    - `GET /ai/configs` — 获取所有配置（按 category 分组）
    - `GET /ai/configs/:configKey` — 获取单个配置
    - `PUT /ai/configs/:configKey` — 更新配置（自动递增版本号，保存历史）
    - `GET /ai/configs/:configKey/history` — 获取变更历史
    - `POST /ai/configs/:configKey/rollback` — 回滚到指定版本
    - _需求: 6.7, 6.9_

  - [x] 9.4 集成配置加载到现有模块
    - `intent/feature-combination.ts`：通过 `getConfigValue('intent.feature_rules', DEFAULT_FEATURE_RULES)` 加载规则
    - `intent/llm-classifier.ts`：通过 `getConfigValue` 加载 Few-shot 样例和置信度阈值
    - `models/router.ts`：通过 `getConfigValue` 加载降级策略配置
    - `processors/pipeline.ts`：通过 `getConfigValue` 加载管线配置
    - _需求: 6.8, 6.9_

- [x] 10. AI 参数配置模块 - Admin 前端（需求 6）
  - [x] 10.1 创建 AI 配置管理页面框架
    - 在 `apps/admin/src/features/ai-ops/` 下创建 `ai-config.tsx` 页面
    - 使用 Tab 按类别分组展示：意图分类、记忆系统、模型路由、处理器管线
    - 通过 Eden Treaty 调用配置 API
    - _需求: 6.2_

  - [x] 10.2 实现 Feature_Combination 规则编辑器
    - 创建 `components/config/feature-rules-editor.tsx`
    - 支持新增、修改、删除意图分类规则（intent、signals、baseConfidence、signalBoost、maxConfidence）
    - 保存时校验规则格式合法性
    - _需求: 6.3_

  - [x] 10.3 实现 Few-shot 样例编辑器
    - 创建 `components/config/few-shot-editor.tsx`
    - 支持新增、修改、删除标注样例（input、intent、explanation）
    - 限制样例数量在 5-8 个之间
    - _需求: 6.4_

  - [x] 10.4 实现模型路由和处理器管线配置编辑器
    - 创建 `components/config/model-router-editor.tsx`：配置意图→模型映射、降级策略、重试参数
    - 创建 `components/config/pipeline-editor.tsx`：调整处理器执行顺序、启用/禁用处理器、配置并行组
    - _需求: 6.5, 6.6_

  - [x] 10.5 实现配置版本历史和回滚
    - 在配置编辑页面中展示变更历史列表（版本号、修改时间、修改人）
    - 支持点击回滚到任意历史版本
    - _需求: 6.7_

- [x] 11. Playground 调试增强（需求 4）
  - [x] 11.1 实现处理器瀑布图组件
    - 创建 `components/playground/waterfall-view.tsx`
    - 以瀑布图形式展示每个处理器的名称、执行时间条形图、输入摘要和输出摘要
    - 点击节点触发 `onProcessorClick` 打开详情 Drawer
    - _需求: 4.1_

  - [x] 11.2 实现处理器节点 Drawer 详情面板（含参数配置）
    - 增强现有 `playground-drawer.tsx` 或创建 `processor-detail-drawer.tsx`
    - 展示处理器完整输入数据、输出数据
    - 为可配置处理器展示参数表单：semantic-recall-processor（相似度阈值、top-K、rerank 开关）、token-limit-processor（最大 Token 数）、intent-classify-processor（P1→P2 升级阈值、Edit_Distance_Cache TTL）、extract-preferences-processor（前置关键词规则开关、LLM 提取开关）
    - 参数值从数据库加载，修改后通过配置 API 实时保存
    - 下次请求使用更新后的参数值
    - _需求: 4.2, 4.11, 4.12, 4.13_

  - [x] 11.3 实现 Tool Calls 时间线组件
    - 创建 `components/playground/tool-calls-timeline.tsx`
    - 以时间线形式展示每个 Tool 的名称、输入参数、返回结果和执行耗时
    - 点击可展开完整的输入输出 JSON
    - _需求: 4.4_

  - [x] 11.4 实现意图分类 Trace 展示
    - 在 Playground 中展示分类层级（P0_Layer/P1_Layer/P2_Layer）、匹配模式、置信度分数和分类耗时
    - 可集成到瀑布图的 intent-classify-processor 节点详情中
    - _需求: 4.3_

  - [x] 11.5 实现 System Prompt Diff 查看器
    - 创建 `components/playground/system-prompt-diff.tsx`
    - 展示最终组装的完整系统提示词
    - 高亮标注各注入段落来源（user-profile、semantic-recall、working-memory）
    - 支持与基础 System Prompt（未注入数据的原始模板）的 diff 对比视图
    - _需求: 4.5_

  - [x] 11.6 实现 Memory Inspector 组件
    - 创建 `components/playground/memory-inspector.tsx`
    - 展示当前用户的 Working Memory 内容
    - 包括每个偏好的类别、情感、置信度、mentionCount 和最后更新时间
    - _需求: 4.6_

  - [x] 11.7 增强 Session Stats Bar 预估成本
    - 在现有 `session-stats-bar.tsx` 中增加预估成本字段
    - 基于模型定价和 Token 用量计算：qwen-flash/qwen-plus/qwen-max 各有不同单价
    - _需求: 4.7_

  - [x] 11.8 实现意图分类 A/B 对比组件
    - 创建 `components/playground/intent-ab-compare.tsx`
    - 对同一输入分别展示 P0 关键词匹配、P1 规则引擎和 P2 LLM 的分类结果及置信度
    - _需求: 4.8_

  - [x] 11.9 实现用户画像模拟组件
    - 创建 `components/playground/profile-simulator.tsx`
    - 支持手动编辑 EnhancedUserProfile（偏好列表、置信度、时间衰减权重）
    - 以模拟画像重新执行请求，观察个性化效果差异
    - _需求: 4.9_

  - [x] 11.10 实现会话回放组件
    - 创建 `components/playground/session-replay.tsx`
    - 支持选择历史会话（ConversationThread），按时间顺序逐条回放消息
    - 展示每条消息对应的 Trace 数据（意图分类、工具调用、处理器执行链路）
    - _需求: 4.10_

- [x] 12. 最终检查点 - 全部功能完成
  - 确保所有 6 个需求的功能实现完整，各模块间集成正确，请用户确认是否有疑问。

## 备注

- 任务按依赖关系排序：语义命名（基础）→ 处理器架构 → [意图分类 ∥ 记忆系统 ∥ 配置模块]（并行）→ Playground
- 任务 5、7、9-10 互不依赖，均依赖任务 3（处理器架构），可并行推进
- 任务 3.8 / 3.9 将 handleChatStream 拆分为 Pre-LLM 和 Post-LLM/Async 两步重构
- 所有 Processor 必须是纯函数，禁止 class，符合 `ProcessorFn` 签名
- 所有 TypeBox Schema 从 `@juchang/db` 派生，禁止手动重复定义
- 使用 Bun 执行所有命令，禁止 npm/yarn
- 检查点用于阶段性验证，确保增量正确性

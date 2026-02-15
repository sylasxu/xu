# 需求文档：AI 核心系统增强

## 简介

聚场（JuChang）是一个基于微信小程序的个人社交 Agent，使用 AI 帮助用户组织社交活动。当前 AI 系统已具备基础的处理器架构、意图分类、记忆系统和调试工具，但在可组合性、分类精度、记忆时效性和调试可观测性方面存在明显短板。本需求旨在对四个核心 AI 子系统进行全面增强，使其达到生产级水准。

## 术语表

- **Processor（处理器）**：AI 请求处理链中的可组合纯函数单元，用于输入预处理和输出后处理
- **ProcessorContext（处理器上下文）**：在处理器之间传递的状态对象，包含用户信息、消息、系统提示词等
- **runProcessors（处理器编排器）**：按顺序执行多个处理器并收集日志的编排函数
- **Intent（意图）**：用户消息所表达的目的，如 create、explore、partner、chitchat 等
- **ClassifyResult（分类结果）**：意图分类的输出，包含意图类型、置信度和分类方法
- **Working_Memory（工作记忆）**：存储在 users.workingMemory 字段中的用户偏好画像
- **EnhancedUserProfile（增强用户画像）**：包含分类偏好、置信度和时间戳的结构化用户画像
- **Semantic_Recall（语义召回）**：基于 pgvector 向量相似度搜索相关历史对话的机制
- **Temporal_Decay（时间衰减）**：偏好权重随时间递减的机制，使近期偏好优先于旧偏好
- **Playground（调试场）**：Admin 后台的 AI 调试工具，支持流程追踪和可视化
- **Trace（追踪）**：AI 请求的完整执行链路数据，包含每个步骤的输入输出和耗时
- **P0_Layer（P0 层）**：全局关键词匹配层，优先级最高，匹配到直接返回预设响应
- **P1_Layer（P1 层）**：意图分类层，通过正则规则引擎判断用户意图
- **P2_Layer（P2 层）**：LLM 意图分类层，当 P1 层置信度不足时调用 LLM 进行深度分类
- **Async_Processor（异步处理器）**：不阻塞用户响应的后台处理器，如偏好提取、质量评估等
- **Feature_Combination（特征组合）**：P1 层使用的多维特征匹配策略，综合关键词、句式结构、上下文等多个信号判断意图
- **Importance_Score（重要性分数）**：对话消息的重要程度评分，用于语义召回时优先返回高价值消息
- **Few-shot_Prompting**：在 LLM 分类时提供少量标注样例作为上下文，替代冗长的规则描述
- **Edit_Distance_Cache（编辑距离缓存）**：对编辑距离小于阈值的相似输入复用已有分类结果的缓存策略
- **AI_Config_Module（AI 配置模块）**：Admin 后台的 AI 参数在线配置管理模块，支持意图分类规则、Few-shot 样例、模型路由和处理器管线的可配置化

## 需求

### 需求 1：处理器架构增强

**用户故事：** 作为 AI 系统开发者，我希望处理器架构支持条件执行、并行执行和依赖管理，以便减少不必要的计算开销并提升响应速度。

#### 验收标准

1. THE ProcessorContext SHALL 通过 `metadata` 字段携带意图分类结果、关键词匹配数据、对话历史摘要和处理器间共享状态，所有处理器间的数据传递必须通过 `context.metadata` 而非闭包变量
2. WHEN ai.service.ts 的 `handleChatStream` 函数处理请求时，THE Processor_Orchestrator SHALL 通过 runProcessors 函数统一编排所有 pre-LLM 处理器，替代当前的手动内联调用
3. WHEN 处理器声明了条件执行规则时，THE Processor_Orchestrator SHALL 根据当前 ProcessorContext 中的意图和状态跳过不满足条件的处理器
4. WHEN 多个处理器之间无数据依赖时，THE Processor_Orchestrator SHALL 支持并行执行这些处理器（如 user-profile 和 semantic-recall 可并行）
5. WHEN 处理器执行完成时，THE Processor_Orchestrator SHALL 记录每个处理器的名称、执行时间、成功状态和输出数据到 processorLog
6. THE Processor_Architecture SHALL 区分三个执行阶段：pre-LLM 处理器（input-guard-processor、keyword-match-processor、intent-classify-processor、user-profile-processor、semantic-recall-processor、token-limit-processor）、post-LLM 处理器（save-history-processor）和 async 处理器（extract-preferences-processor、quality-eval-processor），async 处理器不阻塞用户响应
7. IF 任一 pre-LLM 处理器执行失败，THEN THE Processor_Orchestrator SHALL 停止后续 pre-LLM 处理器执行并返回错误响应（通过 `createDirectResponse`）
8. IF 任一 post-LLM 处理器执行失败，THEN THE Processor_Orchestrator SHALL 记录错误日志但继续执行后续 post-LLM 处理器，保证用户响应不受影响
9. THE Processor_Architecture SHALL 将当前 `handleChatStream` 中内联的关键词匹配逻辑和意图分类逻辑重构为标准 Processor（keyword-match-processor、intent-classify-processor），使其符合 ProcessorFn 签名并纳入 runProcessors 编排
10. WHEN `injectUserProfileProcessor` 和 `injectSemanticRecallProcessor` 被注册到处理器管线时，THE Processor_Architecture SHALL 确保它们符合 ProcessorFn 签名（接收 ProcessorContext，返回 ProcessorResult），而非当前的独立函数形式

### 需求 2：意图分类增强

**用户故事：** 作为 AI 系统开发者，我希望意图分类更精准、更高效，以便减少误分类导致的错误工具调用和用户体验下降。

#### 验收标准

1. WHEN P1_Layer 规则引擎匹配到意图时，THE Intent_Classifier SHALL 使用特征组合（Feature_Combination）策略，综合关键词、句式结构和上下文信号返回差异化的置信度（高特异性组合如"帮我组+活动类型"返回 0.95，单一低特异性词如"想"返回 0.6）
2. WHEN P1_Layer 规则引擎返回低置信度结果（低于 0.7）时，THE Intent_Classifier SHALL 升级到 P2_Layer，使用 LLM 分类器进行深度确认
3. WHEN 对话历史中存在上下文时，THE Intent_Classifier SHALL 将最近 3 轮对话作为分类上下文，检测意图连续性和意图转换
4. WHEN P2_Layer LLM 分类器被调用时，THE Intent_Classifier SHALL 使用 Few-shot_Prompting（提供 5-8 个标注样例）替代当前的长规则描述 prompt，并缓存编辑距离小于 3 的相似输入的分类结果（跨会话，内存缓存，TTL 5 分钟），避免重复调用
5. WHEN P1_Layer 和 P2_Layer 均无法确定意图时，THE Intent_Classifier SHALL 基于对话历史中最近的有效意图作为降级结果，而非固定返回 explore
6. THE Intent_Classifier SHALL 修复当前贪婪正则模式，确保"想"和"约"等通用词不会将所有输入错误匹配为 explore 意图
7. WHEN 意图分类完成时，THE Intent_Classifier SHALL 记录分类方法（P0/P1/P2）、匹配的模式、置信度和耗时到 `toolCallRecords` 中，供 Trace 系统使用
8. THE Intent_Classifier SHALL 遵循三层漏斗架构：P0 层（关键词匹配，由 keyword-match-processor 处理）→ P1 层（特征组合规则引擎）→ P2 层（LLM Few-shot 分类），每层仅在上层未产生高置信度结果时触发

### 需求 3：记忆系统增强

**用户故事：** 作为用户，我希望 AI 能记住我的偏好并随时间更新，以便获得越来越个性化的推荐。

#### 验收标准

1. WHEN 计算偏好权重时，THE Memory_System SHALL 对每个偏好应用时间衰减函数，使 7 天内的偏好保持全权重（1.0），7-30 天的偏好权重线性衰减至 0.3，30-90 天的偏好权重线性衰减至 0.1，超过 90 天的偏好权重固定为 0
2. WHEN 用户表达与已有偏好矛盾的新偏好时（如已有"喜欢火锅"后说"最近不想吃火锅"），THE Memory_System SHALL 将新偏好覆盖旧偏好的情感标签，并将旧偏好的置信度降低 50%
3. WHEN 同一偏好被用户多次提及时，THE Memory_System SHALL 累加该偏好的 mentionCount 并提升置信度（每次提及增加 0.1，上限 1.0）
4. WHEN 用户画像中的偏好数量超过 30 条时，THE Memory_System SHALL 执行合并清理，移除置信度低于 0.2 且超过 30 天未更新的偏好
5. WHEN 语义召回被触发时，THE Semantic_Recall SHALL 同时搜索 conversation_messages 表和 activities 表，将相似度阈值从当前的 0.7 降低至 0.5，并对合并结果使用 qwen3-rerank 进行重排序后返回 top-K 结果
6. WHEN 构建用户画像 Prompt 时，THE Memory_System SHALL 按置信度乘以时间衰减权重的综合分数降序排列偏好，优先展示高分偏好
7. THE EnhancedUserProfile SHALL 为每个偏好存储 mentionCount（提及次数）字段，初始值为 1
8. WHEN `extractPreferencesFromConversation` 被调用时，THE Memory_System SHALL 先执行关键词前置规则判断（检测"喜欢"、"不吃"等明确偏好关键词），仅当检测到偏好信号时才调用 LLM 提取，避免每次对话都触发 LLM 调用
9. WHEN 对话消息被保存到 conversation_messages 表时，THE Memory_System SHALL 为每条消息计算 Importance_Score（基于是否包含偏好表达、工具调用结果、确认/否定等信号），语义召回时优先返回高 Importance_Score 的消息
10. WHEN 用户参与活动并给出正面反馈时，THE Memory_System SHALL 通过 Post-Activity Flow 自动更新兴趣向量（InterestVector），确保 MaxSim 个性化推荐策略使用最新的用户兴趣数据
11. WHEN 偏好的时间衰减权重为 0（超过 90 天）时，THE Memory_System SHALL 将其从用户画像 Prompt 中排除，不注入 LLM

### 需求 4：Playground 调试增强

**用户故事：** 作为 AI 系统开发者，我希望 Playground 不仅提供完整的处理器管线可视化，还能在每个处理器节点的 Drawer 中直接调整关键参数并持久化到数据库，以便快速定位 AI 响应质量问题并实时调优各模块行为。

#### 验收标准

1. WHEN Trace 数据包含处理器执行信息时，THE Playground SHALL 以瀑布图形式展示每个处理器的名称、执行时间、输入摘要和输出摘要
2. WHEN 用户点击瀑布图中的某个处理器节点时，THE Playground SHALL 在 Drawer 面板中展示该处理器的完整输入数据、输出数据，以及该处理器的可配置参数表单（参数值从数据库加载，修改后实时保存）
3. WHEN Trace 数据包含意图分类信息时，THE Playground SHALL 展示分类层级（P0_Layer/P1_Layer/P2_Layer）、匹配的模式、置信度分数和分类耗时
4. WHEN Trace 数据包含 Tool 调用信息（`toolCallRecords`）时，THE Playground SHALL 以时间线形式展示每个 Tool 的名称、输入参数、返回结果和执行耗时
5. WHEN 用户选择 System Prompt 查看器时，THE Playground SHALL 展示最终组装的完整系统提示词，并高亮标注各注入段落的来源（用户画像、语义召回、工作记忆等），支持与基础 System Prompt（未注入任何 Processor 数据的原始模板）的 diff 对比视图，高亮显示各 Processor 注入的内容段落
6. WHEN 用户选择 Memory Inspector 时，THE Playground SHALL 展示当前用户的 Working Memory 内容，包括每个偏好的类别、情感、置信度、mentionCount 和最后更新时间
7. WHEN 一次请求完成时，THE Playground SHALL 在 Session Stats Bar 中展示本次请求的预估成本（基于模型定价和 Token 用量计算）
8. WHEN 用户选择意图分类 A/B 对比时，THE Playground SHALL 支持对同一输入分别展示 P0_Layer 关键词匹配、P1_Layer 规则引擎和 P2_Layer LLM 的分类结果及置信度，便于对比三层漏斗的决策路径
9. WHEN 用户选择用户画像模拟时，THE Playground SHALL 支持手动编辑完整的 EnhancedUserProfile（包括偏好列表、置信度、时间衰减权重），并以模拟画像重新执行请求，观察个性化效果差异
10. WHEN 用户选择会话回放时，THE Playground SHALL 支持选择历史会话（`ConversationThread`），按时间顺序逐条回放消息，并展示每条消息对应的 Trace 数据（意图分类、工具调用、处理器执行链路）
11. WHEN 用户在处理器节点 Drawer 中修改参数时，THE Playground SHALL 将配置持久化到数据库（ai_playground_configs 表），包括处理器名称、参数 key-value、修改人和修改时间，下次打开 Playground 时自动加载最新配置
12. THE Playground SHALL 为以下处理器提供可配置参数面板：semantic-recall-processor（相似度阈值、top-K 数量、rerank 开关）、token-limit-processor（最大 Token 数）、intent-classify-processor（P1_Layer→P2_Layer 升级置信度阈值、Edit_Distance_Cache TTL）、extract-preferences-processor（前置关键词规则开关、LLM 提取开关）
13. WHEN 用户在处理器 Drawer 中修改参数并保存后，THE Playground SHALL 在下一次请求中使用更新后的参数值执行对应处理器，实现实时调优效果

### 需求 5：语义命名与代码清晰度

**用户故事：** 作为 AI 系统开发者，我希望代码中的命名准确反映其语义和职责，以便降低认知负担、减少误解，并使新成员能快速理解代码意图。

#### 背景

当前 AI 模块存在以下命名问题类别：
- 函数名过于泛化，无法表达实际职责
- 同一数据在不同阶段使用不同变量名，缺乏命名一致性
- 多个模块中存在近似同名函数，职责边界模糊
- 类型别名与 DB 表名不一致，造成概念混淆
- 临时变量使用缩写前缀（p0、p1），可读性差

#### 验收标准

1. WHEN ai.service.ts 中的主入口函数被调用时，THE Function_Name SHALL 从 `streamChat` 重命名为 `handleChatStream`，以明确表达"处理聊天流式请求"的完整语义
2. WHEN 用户输入经过 input-guard 处理后，THE Variable_Naming SHALL 明确区分两个变量：`rawUserInput`（原始用户输入，用于 trace 记录和数据库保存）和 `sanitizedInput`（经过净化处理后的输入，用于意图分类、语义召回等后续处理），`ProcessorContext.userInput` 字段明确存储净化后的输入（即 sanitizedInput），消除当前 `lastUserMessage` 和 `sanitizedMessage` 混用的歧义
3. WHEN P0 关键词匹配阶段的变量被声明时，THE Variable_Naming SHALL 使用语义化前缀 `keyword*`（如 `keywordMatchStartTime`、`keywordMatchDuration`、`keywordMatchData`）替代当前的缩写前缀 `p0*`（如 `p0StartTime`、`p0Duration`、`p0MatchData`）
4. WHEN P1 意图分类阶段的变量被声明时，THE Variable_Naming SHALL 使用语义化前缀 `intentClassify*`（如 `intentClassifyStartTime`、`intentClassifyDuration`）替代当前的缩写前缀或不一致命名
5. WHEN tools/index.ts 中的 `getToolsByIntent` 和 tools/registry.ts 中的 `getToolsForIntent` 同时存在时，THE Module_Boundary SHALL 合并为单一入口函数 `resolveToolsForIntent`，消除两个近似同名函数（`getToolsByIntent` vs `getToolsForIntent`）导致的调用歧义
6. WHEN intent/router.ts 中的 `getToolsForIntent` 和 tools/registry.ts 中的 `getToolNamesForIntent` 同时存在且功能重叠时，THE Module_Boundary SHALL 将两者合并为单一入口函数 `getToolNamesByIntent`，放在 `tools/registry.ts` 中，`intent/router.ts` 中的 `getToolsForIntent` 删除或转发到 `getToolNamesByIntent`，以区分其返回值（字符串数组）与 `resolveToolsForIntent` 返回实例化工具对象的函数
7. WHEN memory/types.ts 中定义会话类型别名时，THE Type_Naming SHALL 将 `Thread` 重命名为 `ConversationThread`，将 `ThreadMessage` 重命名为 `ConversationThreadMessage`，与数据库表名 `conversations` / `conversation_messages` 保持一致，消除 Thread vs Conversation 的概念分裂
8. WHEN memory/types.ts 中定义简化消息类型时，THE Type_Naming SHALL 将 `SimpleMessage` 重命名为 `RecalledMessage`，准确表达其用途为"语义召回的历史消息片段"
9. WHEN memory/extractor.ts 中的 `extractPreferences` 函数与 processors/extract-preferences.ts 中的同名 Processor 共存时，THE Module_Boundary SHALL 将 extractor.ts 中的函数重命名为 `extractPreferencesFromConversation`，消除跨模块的名称冲突
10. WHEN ai.service.ts 中的 `traceSteps` 数组存储 Tool 调用记录时，THE Variable_Naming SHALL 重命名为 `toolCallRecords`，准确反映其内容为"工具调用记录"而非泛化的"追踪步骤"
11. WHEN ai.service.ts 中的 `createQuickResponse` 函数被调用时，THE Function_Name SHALL 重命名为 `createDirectResponse`，明确表达"不经过 LLM 的直接响应"语义，而非模糊的"快速响应"
12. WHEN ai.service.ts 中的 `wrapWithTrace` 函数被调用时，THE Function_Name SHALL 重命名为 `createTracedStreamResponse`，明确表达"创建带追踪数据的流式响应"的完整语义
13. THE Naming_Convention SHALL 为所有 Processor 纯函数统一添加 `Processor` 后缀，包括现有处理器（`inputGuard` → `inputGuardProcessor`、`userProfile` → `userProfileProcessor`、`semanticRecall` → `semanticRecallProcessor`、`tokenLimit` → `tokenLimitProcessor`、`saveHistory` → `saveHistoryProcessor`、`extractPreferences` → `extractPreferencesProcessor`）和新增处理器（`keywordMatchProcessor`、`intentClassifyProcessor`），旧版包装函数 `injectUserProfile` 和 `injectSemanticRecall` 在处理器架构重构（需求 1）完成后删除而非重命名
14. WHEN 代码注释中使用缩写（如 `A2UI`）时，THE Comment_Standard SHALL 在首次出现处提供完整展开（如 `A2UI (Action-to-UI: 结构化用户操作直接映射为 UI 响应)`），后续可使用缩写

### 需求 6：AI 参数配置模块

**用户故事：** 作为 AI 系统运维人员，我希望关键 AI 参数（意图分类规则、Few-shot 样例、模型路由配置、处理器管线配置）可以通过 Admin 后台在线编辑并即时生效，以便无需发版即可调优 AI 行为。

#### 验收标准

1. THE AI_Config_Module SHALL 新增 `ai_configs` 数据库表，存储所有可配置的 AI 参数，每条记录包含配置键（config_key）、配置值（config_value，JSONB）、版本号（version）、更新时间（updated_at）和更新人（updated_by）
2. WHEN Admin 用户访问 AI 配置管理页面时，THE AI_Config_Module SHALL 展示所有可配置项的当前值，按类别分组（意图分类、记忆系统、模型路由、处理器管线）
3. WHEN Admin 用户编辑 Feature_Combination 规则时，THE AI_Config_Module SHALL 提供规则编辑器，支持新增、修改、删除意图分类规则（包括 intent、signals、baseConfidence、signalBoost、maxConfidence），并在保存时校验规则格式合法性
4. WHEN Admin 用户编辑 Few-shot 样例时，THE AI_Config_Module SHALL 提供样例编辑器，支持新增、修改、删除标注样例（包括 input、intent、explanation），并限制样例数量在 5-8 个之间
5. WHEN Admin 用户编辑模型路由配置时，THE AI_Config_Module SHALL 支持配置各意图对应的模型（chat/reasoning/agent）、降级策略（enableFallback、fallbackProvider）和重试参数（maxRetries、retryDelay）
6. WHEN Admin 用户编辑处理器管线配置时，THE AI_Config_Module SHALL 支持调整 Pre-LLM 处理器的执行顺序、启用/禁用单个处理器、配置并行组
7. WHEN 配置被保存时，THE AI_Config_Module SHALL 自动递增版本号，记录变更历史，并支持回滚到任意历史版本
8. WHEN 配置被更新时，THE AI_Config_Module SHALL 通过内存缓存（TTL 30 秒）使新配置在 API 服务中即时生效，无需重启服务
9. THE AI_Config_Module SHALL 提供 API 端点供 AI 服务在运行时加载最新配置，替代硬编码的默认值
10. IF 配置加载失败或配置值格式非法，THEN THE AI_Config_Module SHALL 降级到代码中的默认配置，并记录错误日志

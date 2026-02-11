# 需求文档：Admin AI Playground 重构

## 简介

Admin AI Playground 是聚场管理后台的 AI 调试工具，用于可视化 AI 对话的完整执行管线（Input → P0 匹配 → P1 意图识别 → Processors → LLM → Tools → Output）。当前实现存在大量死代码（~20 个文件未使用）、功能缺失（对话历史不可见、节点跳转未实现、统计面板永远为 null）、模型配置过时（硬编码 DeepSeek）等问题。本次重构参考 Mastra Playground 模式，采用全屏 Flow Graph + Drawer 交互的架构，以灰度优先、良好间距的视觉风格打造世界级调试面板。

## 术语表

- **Playground**: Admin 后台的 AI 调试沙盒页面，路由 `/_authenticated/ai-ops/playground`
- **Trace**: AI 请求的完整执行追踪数据，通过 SSE 事件（`data-trace-start`、`data-trace-step`、`data-trace-step-update`、`data-trace-end`）从后端 `wrapWithTrace` 函数流式传输
- **Flow_Graph**: 基于 `@xyflow/react`（ReactFlow）的全屏流程图画布，展示 AI 执行管线的所有节点
- **Pipeline_Node**: Flow Graph 中的单个处理步骤节点，对应后端 `data-trace-step` 事件中的一个步骤
- **Processor**: AI 管线中的纯函数处理器（input-guard, user-profile, semantic-recall, token-limit, save-history, extract-preferences）
- **P0_Match**: 全局关键词匹配层（v4.8 Digital Ascension），命中后直接返回预设响应，不经过 LLM
- **P1_Intent**: 意图识别层，通过正则或 LLM 分类用户意图（create, explore, manage, partner, idle, chitchat）
- **Drawer**: 右侧抽屉面板（基于 shadcn Sheet），承载对话交互、配置设置、节点详情三种视图
- **Mock_Settings**: 模拟设置，用于配置测试用户身份（anonymous/logged_in/with_phone）和位置
- **Session_Stats**: 会话统计，展示累计 Token 消耗、耗时、费用等
- **Layered_Layout**: 分层布局算法，将管线节点按处理阶段分层排列，同层节点并排

## 需求

### Requirement 1: 清理死代码和孤立组件

**User Story:** 作为开发者，我希望移除所有未使用的组件、hooks、类型和空文件，以便降低维护成本并消除代码混乱。

#### Acceptance Criteria

1. THE Playground SHALL 删除以下孤立组件文件（经代码审计确认零引用）：
   - `components/playground/playground-chat.tsx`（700+ 行，未被 playground-layout 引用）
   - `components/playground/playground-context.tsx`（未被任何文件引用）
   - `components/playground/floating-controls.tsx`（未被任何文件引用）
   - `components/execution-trace/` 整个目录（8 个文件：trace-panel, trace-timeline, trace-step, trace-step-input, trace-step-llm, trace-step-output, trace-step-prompt, trace-step-tool）
   - `types/flow-trace.ts`（空文件）
   - `hooks/use-split-view.ts`（未被任何文件引用）
   - `playground/intent-distribution-panel.tsx`（仅在 playground/index.ts 导出，未被任何文件导入）
   - `playground/tool-success-panel.tsx`（仅在 playground/index.ts 导出，未被任何文件导入）
   - `playground/index.ts`（仅导出上述两个死组件）
   - `constants.ts`（根级别，未被任何文件引用）
   - `types.ts`（根级别，未被任何文件引用）
   - `welcome-preview/` 空目录
2. THE Playground SHALL 精简 `types/trace.ts` 和 `types/flow.ts` 中未被使用的类型定义（如 `MemoryContext`、`RAGSearchResult` 等后端不发送的类型）
3. WHEN 死代码被清理后，THE Playground SHALL 保持正常编译且无未使用的导入

### Requirement 2: 全屏 Flow Graph 画布与分层布局

**User Story:** 作为管理员，我希望页面主体是全屏流程图画布，所有管线节点按处理阶段分层预渲染，一屏内可以看到完整管线走势。

#### Acceptance Criteria

1. THE Flow_Graph SHALL 占据整个页面作为主视觉，Header 以透明浮层形式叠加在画布上方
2. THE Flow_Graph SHALL 在初始状态下预渲染完整管线的所有 Pipeline_Node
3. THE Layered_Layout SHALL 将管线节点按以下 7 层分组排列：
   - 第 1 层：Input（用户输入）
   - 第 2 层：Input Guard + P0 Match（并排，快速过滤阶段）
   - 第 3 层：P1 Intent（意图识别，决定后续走向）
   - 第 4 层：User Profile + Semantic Recall + Token Limit（并排，Context 增强阶段）
   - 第 5 层：LLM（核心推理）
   - 第 6 层：Tool(s)（可能多个工具调用，横向展开）
   - 第 7 层：Output（最终输出）
4. WHEN 初始状态下所有 Pipeline_Node 未执行时，THE Flow_Graph SHALL 将节点显示为 pending 状态（灰色/虚线样式）
5. THE Flow_Graph SHALL 支持画布缩放和平移操作
6. THE Layered_Layout SHALL 确保完整管线在一屏内可见（总高度不超过视口高度）

### Requirement 3: 节点实时状态流转与视觉反馈

**User Story:** 作为管理员，我希望在 AI 处理请求时看到节点依次亮起，以便实时追踪执行进度。

#### Acceptance Criteria

1. WHEN 后端返回 `data-trace-step` 事件时，THE Pipeline_Node SHALL 依次从 pending 状态流转为 running 状态（微妙的脉冲动画）
2. WHEN 步骤的 status 字段变为 `success` 时，THE Pipeline_Node SHALL 从 running 状态流转为 success（边框加深/实线）；WHEN status 为 `error` 时流转为 error（红色边框）
3. WHEN Pipeline_Node 状态变化时，THE Flow_Graph SHALL 同步更新该节点到下游节点的连线样式（pending 虚线灰色 → running 实线动画 → success 实线深色 → error 实线红色）
4. WHEN P0_Match 步骤的 `data.matched` 为 true 时，THE Flow_Graph SHALL 将 P0 Match 节点标记为 success 并将后续 P1 到 LLM 的节点标记为 skipped 状态（半透明），直接连接到 Output 节点
5. WHEN 多轮对话进行时，THE Flow_Graph SHALL 提供轮次选择器，允许切换查看不同轮次的 Trace 状态

### Requirement 4: 视觉设计规范（灰度优先 + 良好间距）

**User Story:** 作为管理员，我希望调试面板的视觉风格克制、专业，以灰度为主色调，以便长时间使用不疲劳且信息层次清晰。

#### Acceptance Criteria

1. THE Playground SHALL 采用灰度优先的配色方案：节点背景使用 `bg-card`/`bg-muted`，边框使用 `border`/`border-muted`，文字使用 `text-foreground`/`text-muted-foreground`
2. THE Playground SHALL 仅在以下场景使用彩色：error 状态使用 `destructive` 红色、running 状态使用 `primary` 蓝色的微妙脉冲、success 状态仅加深边框不使用绿色
3. THE Pipeline_Node SHALL 使用统一的圆角卡片样式，节点之间保持至少 24px 的间距，层与层之间保持至少 48px 的间距
4. THE Drawer SHALL 内部各区块之间保持 16-24px 的间距，使用 `separator` 分隔不同信息区域
5. THE Playground SHALL 所有文字使用系统字体栈，代码/JSON 内容使用等宽字体（font-mono）
6. THE Pipeline_Node SHALL 在节点卡片内显示：节点名称（主标题）、关键指标（如耗时 ms）以小字展示在名称下方

### Requirement 5: Drawer 交互系统（对话 + 配置 + 节点详情）

**User Story:** 作为管理员，我希望通过右侧 Drawer 完成所有交互操作（发消息、配置参数、查看节点详情），以便保持 Flow Graph 画布的沉浸感。

#### Acceptance Criteria

1. THE Drawer SHALL 支持三种视图模式：对话视图（chat）、配置视图（settings）、节点详情视图（node-detail）
2. WHEN 用户点击 Flow_Graph 中的 Pipeline_Node 时，THE Drawer SHALL 自动打开并切换到节点详情视图
3. WHEN Drawer 处于对话视图时，THE Drawer SHALL 使用 `@ai-sdk/react` 的 `useChat` hook 显示完整的对话历史（用户消息气泡 + AI 回复气泡）、消息输入框、发送按钮
4. WHEN AI 调用 Tool 时，THE Drawer SHALL 在对话视图中渲染对应的 Tool 结果卡片（exploreNearby 显示活动列表、publishActivity 显示成功提示、createPartnerIntent 显示意向信息、askPreference 显示选项按钮）
5. WHEN Drawer 处于配置视图时，THE Drawer SHALL 显示 Mock 设置（用户身份三选一、位置预设列表：观音桥/解放碑/南坪/沙坪坝）、模型选择（qwen-flash/qwen-plus/qwen-max）、Temperature（0-2）和 MaxTokens（256-8192）参数、Trace 开关
6. THE Drawer SHALL 提供视图切换按钮，允许在三种视图之间自由切换
7. WHEN 对话区为空时，THE Drawer SHALL 在对话视图中显示欢迎状态和快捷操作入口（从 `/ai/welcome` API 获取，使用 Eden Treaty `unwrap(api.ai.welcome.get({}))` 调用）
8. THE Drawer SHALL 提供清空对话、停止生成功能按钮

### Requirement 6: 更新模型配置支持 Qwen3

**User Story:** 作为管理员，我希望 Playground 的模型配置反映实际生产环境使用的 Qwen3 模型，以便测试结果与生产一致。

#### Acceptance Criteria

1. THE Playground SHALL 将 `ModelParams` 类型中的 model 字段从 `'deepseek'` 更新为支持 `'qwen-flash' | 'qwen-plus' | 'qwen-max'`
2. THE Playground SHALL 默认使用 `qwen-flash` 模型
3. THE Playground SHALL 在画布浮层状态栏中显示当前使用的模型名称
4. THE Playground SHALL 更新费用计算逻辑，从 DeepSeek 定价（$0.14/$0.28 per M tokens）更新为 Qwen3 定价
5. THE Playground SHALL 更新 `DEFAULT_MODEL_PARAMS` 常量和 `calculateSessionStats` 函数中的模型引用

### Requirement 7: 节点详情面板（对齐后端 Trace API 数据颗粒度）

**User Story:** 作为管理员，我希望点击流程图节点后能在 Drawer 中看到该步骤的关键调试信息，以便精确定位 AI 行为问题。

> 注：以下每个节点的展示字段严格对齐后端 `wrapWithTrace` 函数实际发送的 `data-trace-step` 数据。标注 `[前端计算]` 的字段由前端从已有数据推导，标注 `[需后端增强]` 的字段需要后端在 Requirement 8 中补充。

#### Acceptance Criteria

1. WHEN 用户点击 Input 节点时，THE Drawer SHALL 显示：原始输入文本（`data.text`）、字符数（`[前端计算]` text.length）
2. WHEN 用户点击 Input Guard 节点时，THE Drawer SHALL 显示：是否被拦截（`data.output.blocked`）、净化后文本（`data.output.sanitized`）、最大长度配置（`data.config.maxLength`）、执行耗时（`duration` ms）
3. WHEN 用户点击 P0 Match 节点时，THE Drawer SHALL 显示：是否命中（`data.matched`）、命中的关键词（`data.keyword`）、匹配类型（`data.matchType`：exact/prefix/fuzzy）、优先级（`data.priority`）、预设响应类型（`data.responseType`）、执行耗时（`duration` ms）
4. WHEN 用户点击 P1 Intent 节点时，THE Drawer SHALL 显示：识别的意图类型（`data.intent`，使用 `INTENT_DISPLAY_NAMES` 映射中文）、识别方法（`data.method`：regex/llm，使用 `INTENT_METHOD_NAMES` 映射）、置信度分数（`data.confidence`）、执行耗时（`duration` ms）
5. WHEN 用户点击 User Profile 节点时，THE Drawer SHALL 显示：用户偏好数量（`data.output.preferencesCount`）、常去地点数量（`data.output.locationsCount`）、执行耗时（`duration` ms）
6. WHEN 用户点击 Semantic Recall 节点时，THE Drawer SHALL 显示：是否启用（`data.config.enabled`）、执行耗时（`duration` ms）、`[需后端增强]` 搜索查询（`data.output.query`）、召回结果数量（`data.output.resultCount`）、最高相似度（`data.output.topScore`）
7. WHEN 用户点击 Token Limit 节点时，THE Drawer SHALL 显示：是否发生截断（`data.output.truncated`）、原始 Prompt 长度（`data.output.originalLength` 字符）、截断后长度（`data.output.finalLength` 字符）、最大 Token 限制值（`data.config.maxTokens`）、执行耗时（`duration` ms）
8. WHEN 用户点击 LLM 节点时，THE Drawer SHALL 显示：模型名称（`data.model`，`[需后端增强]` 从硬编码 'qwen' 改为实际模型 ID）、输入 Token 数（`data.inputTokens`）、输出 Token 数（`data.outputTokens`）、总 Token 数（`data.totalTokens`）、执行耗时（`duration` ms）、生成速度（`[前端计算]` outputTokens / duration * 1000 tokens/s）、完整 System Prompt（从 `data-trace-start` 事件的 `systemPrompt` 字段获取，可展开查看的代码块）
9. WHEN 用户点击 Tool 节点时，THE Drawer SHALL 显示：工具名称（`data.toolName`，使用 `TOOL_DISPLAY_NAMES` 映射中文名）、输入参数（`data.input`，JSON 可折叠查看器）、输出结果（`data.output`，JSON 可折叠查看器）、Widget 类型（`data.widgetType`）
10. WHEN 用户点击 Output 节点时，THE Drawer SHALL 显示：AI 回复全文（从 `data-trace-end` 事件的 `output.text` 获取）、Tool 调用列表（从 `output.toolCalls` 获取，显示工具名 + 输入/输出摘要）、总耗时（`data-trace-end` 的 `totalDuration` ms）、总 Token 数（`[前端计算]` 从 LLM 步骤累加）、费用估算（`[前端计算]` 根据模型定价和 Token 数计算）
11. IF Pipeline_Node 执行出错，THEN THE Drawer SHALL 在节点详情中以红色高亮显示错误信息（`step.error` 字段）

### Requirement 8: 后端 Trace 数据增强

**User Story:** 作为开发者，我希望后端 `wrapWithTrace` 函数发送更完整的 Trace 数据，以便前端能展示更丰富的调试信息。

#### Acceptance Criteria

1. WHEN 发送 Input 步骤的 trace 数据时，THE API SHALL 在 `data` 中增加 `source`（'admin' | 'miniprogram'）和 `userId`（string | null）字段
2. WHEN 发送 Input Guard 步骤的 trace 数据时，THE API SHALL 在 `data.output` 中增加 `triggeredRules` 数组字段（触发的规则名称列表，从 `guardResult.triggeredRules` 获取）
3. WHEN 发送 LLM 步骤的 trace 数据时，THE API SHALL 将 `data.model` 从硬编码的 `'qwen'` 更新为实际使用的模型 ID（`modelId` 变量的值：`'qwen-flash'`、`'qwen-plus'`、`'qwen-max'`）
4. WHEN 发送 Semantic Recall 步骤的 trace 数据时，THE API SHALL 在 `data.output` 中增加 `query`（搜索查询文本）、`resultCount`（结果数量）、`topScore`（最高相似度分数）字段
5. WHEN 发送 Tool 步骤的 trace 数据时，THE API SHALL 在 `data` 中增加 `toolDisplayName` 字段（使用 `getToolDisplayName(step.toolName)` 获取中文名称）
6. WHEN LLM 推理完成后，THE API SHALL 在 `data-trace-step-update` 中为 Output 步骤发送一个 type 为 `'output'` 的 `data-trace-step` 事件，包含 `data.text`（AI 回复全文）和 `data.toolCallCount`（Tool 调用数量）

### Requirement 9: 会话统计展示

**User Story:** 作为管理员，我希望看到当前调试会话的累计统计信息，以便评估 AI 的性能和成本。

#### Acceptance Criteria

1. THE Playground SHALL 在画布底部以紧凑浮层状态栏形式展示：当前模型名称、累计轮次数、总 Token 消耗（inputTokens + outputTokens）、总耗时、费用估算
2. WHEN 每轮对话完成时（收到 `data-trace-end` 事件），THE Session_Stats SHALL 从 LLM 步骤的 `data.inputTokens` 和 `data.outputTokens` 累加更新统计数据
3. THE Session_Stats SHALL 根据当前选择的模型（qwen-flash/qwen-plus/qwen-max）和累计的 inputTokens/outputTokens 计算对应的费用

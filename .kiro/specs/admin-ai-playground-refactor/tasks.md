# Implementation Plan: Admin AI Playground 重构

## Overview

按照"清理 → 类型重构 → 后端增强 → 前端核心组件 → 集成联调"的顺序，增量推进重构。每个任务都在前一个任务的基础上构建，确保无孤立代码。

## Tasks

- [x] 1. 清理死代码
  - [x] 1.1 删除孤立的前端组件文件
    - 删除 `components/playground/playground-chat.tsx`
    - 删除 `components/playground/playground-context.tsx`
    - 删除 `components/playground/floating-controls.tsx`
    - 删除 `components/execution-trace/` 整个目录（8 个文件）
    - 删除 `types/flow-trace.ts`
    - 删除 `hooks/use-split-view.ts`
    - 删除 `playground/intent-distribution-panel.tsx`、`playground/tool-success-panel.tsx`、`playground/index.ts`
    - 删除 `constants.ts`（根级别）、`types.ts`（根级别）
    - 删除 `welcome-preview/` 空目录
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 精简类型定义文件
    - 从 `types/trace.ts` 移除未使用的类型：`MemoryContext`、`RAGSearchResult`、`ExtendedTraceStepData`、`ProcessorStepData`、`P0MatchStepData`、`P1IntentStepData`
    - 更新 `ModelParams` 类型：model 字段从 `'deepseek'` 改为 `'qwen-flash' | 'qwen-plus' | 'qwen-max'`
    - 更新 `DEFAULT_MODEL_PARAMS`：model 默认值改为 `'qwen-flash'`
    - 更新 `calculateSessionStats` 和费用计算逻辑：从 DeepSeek 定价改为 Qwen3 定价（`QWEN_PRICE` 对象）
    - 确保所有引用这些类型的文件编译通过
    - _Requirements: 1.2, 6.1, 6.2, 6.4, 6.5_

- [x] 2. Checkpoint - 确保清理后编译通过
  - 确保所有文件编译通过，无未使用的导入，ask the user if questions arise.

- [x] 3. 后端 Trace 数据增强
  - [x] 3.1 增强 `wrapWithTrace` 函数中的 Input 步骤
    - 在 `apps/api/src/modules/ai/ai.service.ts` 的 `wrapWithTrace` 函数中
    - Input 步骤的 `data` 增加 `source`（从 `request.source` 获取）和 `userId`（从 `request.userId` 获取）字段
    - _Requirements: 8.1_

  - [x] 3.2 增强 Input Guard、LLM、Semantic Recall、Tool、Output 步骤
    - Input Guard 步骤：`data.output` 增加 `triggeredRules` 字段（从 `guardResult.triggeredRules` 获取）
    - LLM 步骤：`data.model` 从硬编码 `'qwen'` 改为 `modelId` 变量（实际模型 ID）
    - Semantic Recall 步骤：`data.output` 增加 `query`、`resultCount`、`topScore` 字段（需要从 `injectSemanticRecall` 函数返回值中获取）
    - Tool 步骤：`data` 增加 `toolDisplayName` 字段（使用 `getToolDisplayName(step.toolName)`）
    - 在 `data-trace-end` 之前新增一个 type 为 `'output'` 的 `data-trace-step`，包含 `data.text` 和 `data.toolCallCount`
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 4. 重构分层布局算法
  - [x] 4.1 实现 `buildStaticPipeline` 函数
    - 在 `components/flow/utils/flow-builder.ts` 中重写
    - 定义 `PIPELINE_LAYERS` 配置（7 层分组）
    - 实现 `buildStaticPipeline()` 函数：根据配置生成所有节点（pending 状态）和连线（虚线灰色）
    - 计算节点位置：同层节点水平居中排列，层间距 ≥48px，节点间距 ≥24px
    - 确保总高度适配视口
    - _Requirements: 2.2, 2.3, 2.4, 2.6_

  - [x] 4.2 实现 `applyTraceToGraph` 函数
    - 在 `components/flow/utils/flow-builder.ts` 中新增
    - 输入：静态 FlowGraphData + ExecutionTrace
    - 逻辑：遍历 trace.steps，通过 type + processorType 匹配节点，更新节点状态和 data
    - P0 命中逻辑：当 P0 Match 的 `data.matched === true` 时，将 P1 到 LLM 的节点标记为 `skipped`
    - Tool 节点动态处理：根据 trace 中的 tool steps 数量动态添加/更新 Tool 节点
    - 更新连线样式：根据源节点状态设置边的样式
    - 更新节点 subtitle：从 step data 中提取关键指标（如耗时、Token 数）
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5. 重构 Pipeline Node 组件
  - [x] 5.1 创建统一的 BaseNode 组件
    - 重写 `components/flow/nodes/base-node.tsx`
    - 灰度优先样式：pending（灰色虚线）、running（primary 脉冲）、success（边框加深）、error（红色边框）、skipped（半透明虚线）
    - 节点卡片内显示：名称（主标题）+ subtitle（关键指标，小字 text-muted-foreground）
    - 统一圆角、间距、字体
    - _Requirements: 4.1, 4.2, 4.3, 4.6_

  - [x] 5.2 更新各类型节点组件
    - 更新 `input-node.tsx`、`p0-match-node.tsx`、`p1-intent-node.tsx`、`processor-node.tsx`、`llm-node.tsx`、`tool-node.tsx`、`output-node.tsx`
    - 每个节点组件继承 BaseNode 样式，仅定义 subtitle 的提取逻辑
    - 移除旧的内联样式，统一使用 Tailwind class
    - _Requirements: 4.6_

- [x] 6. 重构 FlowGraph 组件
  - [x] 6.1 重写 `flow-graph.tsx`
    - 使用 `buildStaticPipeline()` 生成初始节点
    - 使用 `applyTraceToGraph()` 根据 trace 更新节点状态
    - 注册所有自定义节点类型
    - 配置 ReactFlow：fitView、缩放、平移、禁止节点拖拽
    - 画布背景使用 `bg-background`
    - _Requirements: 2.1, 2.5_

  - [x] 6.2 重写 `flow-trace-panel.tsx`
    - 接收 `traces` 和 `selectedRound` props
    - 根据 selectedRound 选择对应的 trace 传给 FlowGraph
    - 处理节点点击事件，回调给父组件
    - _Requirements: 3.5_

- [x] 7. Checkpoint - 确保 Flow Graph 渲染正常
  - 确保所有节点正确渲染，编译通过，ask the user if questions arise.

- [x] 8. 重构 Drawer 交互系统
  - [x] 8.1 重写 PlaygroundDrawer 主组件
    - 重写 `components/playground/unified-drawer.tsx` 为 `playground-drawer.tsx`
    - 三种视图模式：chat / settings / node-detail
    - 顶部视图切换按钮（Tab 样式）
    - 使用 shadcn Sheet 组件，宽度 480px
    - 灰度优先样式，区块间 16-24px 间距，separator 分隔
    - _Requirements: 5.1, 5.6, 4.4_

  - [x] 8.2 实现 ChatView（对话视图）
    - 消息列表：用户消息气泡 + AI 回复气泡
    - Tool 结果卡片渲染：exploreNearby（活动列表）、publishActivity（成功提示）、createPartnerIntent（意向信息）、askPreference（选项按钮）
    - 消息输入框 + 发送按钮（Enter 发送，Shift+Enter 换行）
    - 空状态：从 `/ai/welcome` API 获取欢迎数据，使用 `unwrap(api.ai.welcome.get({}))`
    - 清空对话、停止生成按钮
    - _Requirements: 5.3, 5.4, 5.7, 5.8_

  - [x] 8.3 实现 SettingsView（配置视图）
    - Mock 设置：用户身份 Select（anonymous/logged_in/with_phone）+ 位置 Select（观音桥/解放碑/南坪/沙坪坝）
    - 模型选择：Select（qwen-flash/qwen-plus/qwen-max）
    - Temperature Slider（0-2）+ MaxTokens Input（256-8192）
    - Trace 开关 Switch
    - _Requirements: 5.5, 6.3_

  - [x] 8.4 实现 NodeDetailView（节点详情视图）
    - 根据节点 type 渲染对应的详情内容
    - Input：输入文本 + 字符数
    - Input Guard：拦截状态 + 净化文本 + 配置 + 耗时
    - P0 Match：命中状态 + 关键词 + 匹配类型 + 优先级 + 响应类型 + 耗时
    - P1 Intent：意图类型（中文映射）+ 方法 + 置信度 + 耗时
    - User Profile：偏好数量 + 地点数量 + 耗时
    - Semantic Recall：启用状态 + 耗时（+ 后端增强后的 query/resultCount/topScore）
    - Token Limit：截断状态 + 原始/截断后长度 + 限制值 + 耗时
    - LLM：模型名 + Token 数 + 耗时 + 生成速度（前端计算）+ System Prompt（可展开代码块）
    - Tool：工具名（中英文）+ 输入/输出 JSON 查看器 + Widget 类型
    - Output：回复全文 + Tool 调用列表 + 总耗时 + 总 Token + 费用估算
    - Error 状态：红色高亮错误信息
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11_

- [x] 9. 重构 useExecutionTrace Hook
  - 更新 `hooks/use-execution-trace.ts`
  - ModelParams 使用新的 Qwen3 类型
  - 新增 `systemPrompt` 状态（从 `data-trace-start` 事件的 systemPrompt 字段保存）
  - 新增 `sessionStats` 计算属性（使用更新后的 `calculateSessionStats`）
  - 保持现有的 traces 追加模式和多轮管理逻辑
  - _Requirements: 6.1, 6.2, 9.2_

- [x] 10. 实现浮层组件
  - [x] 10.1 实现 SessionStatsBar
    - 画布底部固定浮层，半透明背景
    - 显示：模型名称 | 轮次数 | Token 消耗 | 耗时 | 费用
    - 紧凑单行布局，使用 text-xs text-muted-foreground
    - _Requirements: 9.1, 9.3_

  - [x] 10.2 实现 RoundSelector
    - 画布左侧或顶部浮层
    - 显示轮次列表（Round 1, Round 2, ...），当前选中高亮
    - 点击切换查看不同轮次的 trace
    - _Requirements: 3.5_

- [x] 11. 重写 PlaygroundLayout 主组件
  - 重写 `components/playground/playground-layout.tsx`
  - 编排所有子组件：FlowGraph + PlaygroundDrawer + SessionStatsBar + RoundSelector
  - 管理状态：drawerOpen、drawerView、selectedNodeId、selectedRound、mockSettings、traceEnabled
  - 使用 `useChat` hook 管理对话（transport 配置 source=admin, trace=traceEnabled, modelParams）
  - 使用重构后的 `useExecutionTrace` hook 管理 trace
  - 处理 `onData` 回调：解析 SSE 事件，分发给 trace hook
  - 节点点击 → 打开 Drawer node-detail 视图
  - Header 透明浮层（pointer-events-none）
  - _Requirements: 2.1, 5.2_

- [x] 12. Final checkpoint - 完整功能验证
  - 确保所有组件编译通过，功能正常，ask the user if questions arise.

## Notes

- 任务按依赖顺序排列：清理 → 类型 → 后端 → 布局算法 → 节点组件 → FlowGraph → Drawer → Hook → 浮层 → 主组件
- 每个任务引用具体的 Requirements 编号
- 后端增强（Task 3）可以与前端重构并行开发

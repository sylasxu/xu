# Implementation Plan: Playground Node Detail Redesign

## Overview

重构 AI Playground 右侧 Drawer 面板：移除三 Tab 结构，改为基于节点类型的动态内容渲染；统一节点标题中文化；增强各节点详情卡片内容。所有改动集中在 `apps/admin/src/features/ai-ops/` 目录下的前端组件。

## Tasks

- [x] 1. 节点标题中文化
  - [x] 1.1 在 `apps/admin/src/features/ai-ops/types/flow.ts` 中新增 `NODE_CHINESE_LABELS` 常量映射，覆盖所有 10 种节点类型的中文标题
    - 映射: user-input→用户输入, input-guard→输入安全检查, keyword-match→关键词快捷匹配, intent-classify→意图识别, user-profile→用户画像, semantic-recall→语义记忆召回, token-limit→上下文窗口, llm→模型推理, tool→工具调用, final-output→最终响应
    - 新增 `getNodeChineseLabel(type: string): string` 辅助函数
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 1.2 更新 `apps/admin/src/features/ai-ops/types/flow.ts` 中的 `PROCESSOR_DISPLAY_NAMES`，将所有值改为中文
    - input-guard→输入安全检查, user-profile→用户画像, working-memory→工作记忆, semantic-recall→语义记忆召回, token-limit→上下文窗口, save-history→保存历史, extract-preferences→提取偏好
    - _Requirements: 2.2_
  - [x] 1.3 更新 `apps/admin/src/features/ai-ops/components/flow/utils/flow-builder.ts` 中 `PIPELINE_LAYERS` 的所有 label 为中文
    - L2: Input Guard→输入安全检查, P0 匹配→关键词快捷匹配
    - L3: P1 意图→意图识别
    - L4: User Profile→用户画像, Semantic Recall→语义记忆召回, Token Limit→上下文窗口
    - L5: LLM 推理→模型推理
    - L6: Tool 调用→工具调用
    - L7: 输出→最终响应
    - _Requirements: 2.1_

- [x] 2. Drawer 状态管理简化
  - [x] 2.1 在 `apps/admin/src/features/ai-ops/components/playground/playground-layout.tsx` 中移除 `DrawerView` 类型引用和 `drawerView` / `setDrawerView` 状态
    - 删除 `import { type DrawerView }` 和 `useState<DrawerView>('chat')`
    - 修改 `handleNodeClick` 回调：仅设置 `selectedNode` 和 `setDrawerOpen(true)`，不再设置 `drawerView`
    - 更新 `PlaygroundDrawer` 的 props 传递：移除 `view` / `onViewChange` props
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. PlaygroundDrawer 重构
  - [x] 3.1 重构 `apps/admin/src/features/ai-ops/components/playground/playground-drawer.tsx`
    - 删除 `DrawerView` 类型导出和 `VIEW_TITLES` 常量
    - 移除 Props 中的 `view` / `onViewChange`
    - 移除 SheetHeader 中的 Tabs/TabsList/TabsTrigger 组件
    - 新增 DrawerHeader 子组件：显示中文节点标题（使用 `getNodeChineseLabel`）+ StatusBadge + 耗时
    - 内容区根据 `selectedNode.data.type` 分支：`user-input` 渲染 UserInputNodePanel，其他渲染 NodeDetailView
    - 无选中节点时显示空状态提示
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 3.2 在 `apps/admin/src/features/ai-ops/components/playground/playground-drawer.tsx` 中新增 `UserInputNodePanel` 组件
    - 平铺三个区域：InputDetailSection（输入文本预览 + 字符数 + source Badge + userId）、ChatView（嵌入）、SettingsView（嵌入）
    - 各区域之间使用 Separator 分隔
    - 接收并透传 Chat 和 Settings 相关 props
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 4. NodeDetailView 重构
  - [x] 4.1 重构 `apps/admin/src/features/ai-ops/components/playground/node-detail-view.tsx`
    - 移除 `NodeHeader` 组件（已提升到 DrawerHeader）
    - 移除顶层 `NodeDetailView` 中的 NodeHeader 渲染和 Separator
    - 保留 `NodeContent` 路由和所有 Detail 子组件
    - 移除 `NodeDetailViewProps` 中不再需要的 `node` prop，改为直接接收 `data: FlowNodeData`
    - _Requirements: 1.1, 1.2_
  - [x] 4.2 增强 `IntentClassifyDetail`（原 P1IntentDetail）：将置信度数字替换为 Progress 组件 + 百分比文本
    - 使用 shadcn Progress 组件，value 为 `confidence * 100`
    - _Requirements: 7.2_
  - [x] 4.3 增强 `TokenLimitDetail`：新增原始/截断长度对比条
    - 使用两个并排的 Progress 条或 div 宽度百分比展示 originalLength vs finalLength 的对比
    - _Requirements: 10.2_
  - [x] 4.4 增强 `ToolDetail`：新增评估结果展示区块
    - 当 `evaluation` 数据存在时，显示 score、passed 状态 Badge、issues 列表
    - 使用 CollapsibleSection 包裹
    - _Requirements: 12.3_
  - [x] 4.5 增强 `OutputDetail`（重命名为 FinalOutputDetail）：确保总费用和调用次数统计完整展示
    - 确认 totalDuration、totalTokens、totalCost、toolCallCount 四项统计均有渲染
    - _Requirements: 13.3_

- [x] 5. Checkpoint
  - 确保所有改动编译通过，Drawer 在点击不同节点时正确渲染对应内容。如有问题请反馈。

## Notes

- 所有改动仅涉及前端组件，无数据库或 API 变更
- 使用 shadcn/ui 组件（Badge, Separator, Sheet, Progress）
- 遵循 React 19 composition patterns，无 boolean prop explosion
- 中文 UI 标签贯穿流程图和 Drawer

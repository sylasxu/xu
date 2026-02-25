# Requirements Document

## Introduction

AI Playground 右侧 Drawer 的节点详情面板重新设计。当前的三 Tab 结构（对话/配置/节点）存在产品设计缺陷：所有节点共享相同的三个 Tab，但只有"节点"Tab 包含节点特定内容，"对话"和"配置"是 Playground 级别的全局功能，与具体节点无关。此外，节点标题使用英文且描述不够直观，节点详情内容过于扁平，缺乏视觉层次。

本次重设计将移除三 Tab 结构，改为根据节点类型动态渲染不同内容：用户输入节点展示对话区、配置区和输入详情的平铺布局；其他节点仅展示该节点的 Trace 数据和特定属性。同时将所有节点标题统一为中文，并为每种节点类型设计更丰富的详情卡片内容。

## Glossary

- **Drawer**: 右侧滑出面板，使用 shadcn Sheet 组件实现，宽度 480px
- **Flow_Graph**: 画布上的 AI 处理管线流程图，包含 7 层静态节点
- **Node**: 流程图中的单个处理节点，每个节点有类型、状态、标签等属性
- **Node_Detail_Panel**: Drawer 中展示节点详情的面板区域
- **Trace_Data**: AI 请求执行过程中各节点产生的追踪数据
- **PIPELINE_LAYERS**: flow-builder.ts 中定义的 7 层静态管线配置
- **PROCESSOR_DISPLAY_NAMES**: flow.ts 中定义的 Processor 类型到显示名称的映射
- **Chat_Area**: 对话区域，包含消息列表和输入框
- **Settings_Area**: 配置区域，包含模拟设置、模型参数和 Trace 开关
- **CollapsibleSection**: 可折叠的内容区块组件

## Requirements

### Requirement 1: 移除三 Tab 结构

**User Story:** 作为管理员，我希望 Drawer 不再使用三 Tab 切换，而是根据所选节点类型直接展示对应内容，以减少不必要的交互步骤。

#### Acceptance Criteria

1. WHEN a user clicks any node on the Flow_Graph, THE Drawer SHALL open and display content specific to that node type without any tab navigation
2. WHEN the Drawer is open, THE Drawer SHALL display a header containing the Chinese node title, a status Badge, and the execution duration
3. WHEN a user clicks the "用户输入" node, THE Drawer SHALL render the Chat_Area, Settings_Area, and input detail section as flat vertically-stacked sections separated by visual dividers
4. WHEN a user clicks any node other than "用户输入", THE Drawer SHALL render only that node's Trace_Data and type-specific attributes

### Requirement 2: 节点标题中文化

**User Story:** 作为管理员，我希望流程图和 Drawer 中的节点标题全部使用中文，以便快速理解每个节点的功能。

#### Acceptance Criteria

1. THE PIPELINE_LAYERS configuration SHALL use Chinese labels for all node entries: "用户输入", "输入安全检查", "关键词快捷匹配", "意图识别", "用户画像", "语义记忆召回", "上下文窗口", "模型推理", "工具调用", "最终响应"
2. THE PROCESSOR_DISPLAY_NAMES mapping SHALL use Chinese labels: "输入安全检查" for input-guard, "用户画像" for user-profile, "语义记忆召回" for semantic-recall, "上下文窗口" for token-limit
3. WHEN a node is displayed in the Drawer header, THE Node_Detail_Panel SHALL show the Chinese label as the title

### Requirement 3: Drawer 状态管理简化

**User Story:** 作为开发者，我希望 Drawer 的状态管理更简洁，移除不再需要的 DrawerView 类型，简化为打开/关闭和选中节点两个状态。

#### Acceptance Criteria

1. THE playground-layout SHALL manage Drawer state using only an open/close boolean and a selected FlowNode reference
2. WHEN a node is clicked on the Flow_Graph, THE playground-layout SHALL set the selected node and open the Drawer
3. WHEN the Drawer is closed, THE playground-layout SHALL retain the selected node state so reopening shows the last viewed node

### Requirement 4: 用户输入节点详情

**User Story:** 作为管理员，我希望点击"用户输入"节点时看到完整的对话区、配置区和输入详情，以便在一个面板中完成调试操作。

#### Acceptance Criteria

1. WHEN the "用户输入" node is selected, THE Node_Detail_Panel SHALL display the input text preview with character count
2. WHEN the "用户输入" node is selected, THE Node_Detail_Panel SHALL display a source Badge indicating the request origin and the userId if available
3. WHEN the "用户输入" node is selected, THE Node_Detail_Panel SHALL embed the Chat_Area component allowing message sending and viewing
4. WHEN the "用户输入" node is selected, THE Node_Detail_Panel SHALL embed the Settings_Area component for mock settings, model parameters, and trace toggle

### Requirement 5: 输入安全检查节点详情

**User Story:** 作为管理员，我希望查看输入安全检查节点的拦截状态和触发规则，以便排查内容安全问题。

#### Acceptance Criteria

1. WHEN the "输入安全检查" node is selected, THE Node_Detail_Panel SHALL display a block status Badge showing "通过" or "拦截"
2. WHEN the input-guard has triggered rules, THE Node_Detail_Panel SHALL display the list of triggered rule names as Badges
3. WHEN the input text was sanitized, THE Node_Detail_Panel SHALL display the sanitized text content

### Requirement 6: 关键词快捷匹配节点详情

**User Story:** 作为管理员，我希望查看关键词匹配节点的命中状态和匹配详情，以便调试 P0 快捷响应。

#### Acceptance Criteria

1. WHEN the "关键词快捷匹配" node is selected, THE Node_Detail_Panel SHALL display a hit/miss status Badge
2. WHEN a keyword was matched, THE Node_Detail_Panel SHALL display the matched keyword, match type, and response type

### Requirement 7: 意图识别节点详情

**User Story:** 作为管理员，我希望查看意图识别节点的识别结果和置信度，以便调试意图分类逻辑。

#### Acceptance Criteria

1. WHEN the "意图识别" node is selected, THE Node_Detail_Panel SHALL display the intent type as a Badge
2. WHEN confidence data is available, THE Node_Detail_Panel SHALL display a confidence progress bar with percentage value
3. WHEN the "意图识别" node is selected, THE Node_Detail_Panel SHALL display the classification method (P1 规则 or P2 LLM)

### Requirement 8: 用户画像节点详情

**User Story:** 作为管理员，我希望查看用户画像节点加载的偏好和位置数据概况。

#### Acceptance Criteria

1. WHEN the "用户画像" node is selected, THE Node_Detail_Panel SHALL display the preference count and top preference tags if available
2. WHEN location data is available, THE Node_Detail_Panel SHALL display the location count

### Requirement 9: 语义记忆召回节点详情

**User Story:** 作为管理员，我希望查看语义召回节点的检索结果和相似度评分，以便调试 RAG 效果。

#### Acceptance Criteria

1. WHEN the "语义记忆召回" node is selected, THE Node_Detail_Panel SHALL display the result count and top similarity score
2. WHEN rerank was performed, THE Node_Detail_Panel SHALL display the rerank status
3. WHEN data source information is available, THE Node_Detail_Panel SHALL display the data sources used

### Requirement 10: 上下文窗口节点详情

**User Story:** 作为管理员，我希望查看上下文截断节点的截断状态和长度对比，以便了解上下文管理效果。

#### Acceptance Criteria

1. WHEN the "上下文窗口" node is selected, THE Node_Detail_Panel SHALL display the truncation status Badge
2. WHEN truncation data is available, THE Node_Detail_Panel SHALL display a visual comparison of original length versus truncated length
3. WHEN the "上下文窗口" node is selected, THE Node_Detail_Panel SHALL display the token limit value

### Requirement 11: 模型推理节点详情

**User Story:** 作为管理员，我希望查看 LLM 推理节点的模型信息、Token 用量和生成速度，以便监控模型性能。

#### Acceptance Criteria

1. WHEN the "模型推理" node is selected, THE Node_Detail_Panel SHALL display the model name, token usage breakdown (input/output/total), and generation speed
2. WHEN cost data is available, THE Node_Detail_Panel SHALL display the estimated cost
3. WHEN a system prompt was used, THE Node_Detail_Panel SHALL display the system prompt in a CollapsibleSection

### Requirement 12: 工具调用节点详情

**User Story:** 作为管理员，我希望查看工具调用节点的工具名称、输入输出和评估结果，以便调试 Tool 执行。

#### Acceptance Criteria

1. WHEN the "工具调用" node is selected, THE Node_Detail_Panel SHALL display the tool name and widget type
2. WHEN the "工具调用" node is selected, THE Node_Detail_Panel SHALL display input parameters and output result in CollapsibleSection components with JSON formatting
3. WHEN evaluation data is available, THE Node_Detail_Panel SHALL display the evaluation score and any issues found

### Requirement 13: 最终响应节点详情

**User Story:** 作为管理员，我希望查看最终响应节点的完整 AI 回复和汇总统计，以便全面了解本次请求的处理结果。

#### Acceptance Criteria

1. WHEN the "最终响应" node is selected, THE Node_Detail_Panel SHALL display the full AI reply text
2. WHEN tool calls were made, THE Node_Detail_Panel SHALL display a tool call summary list
3. WHEN the "最终响应" node is selected, THE Node_Detail_Panel SHALL display total duration, total tokens, estimated cost, and tool call count

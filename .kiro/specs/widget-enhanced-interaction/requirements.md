# 需求文档：增强型 Generative UI Widget 系统

## 简介

当前聚场 AI 对话中的 Widget 系统采用"自包含"模式——Chat API 在流式响应中返回完整数据，前端直接渲染。这种模式在数据量小（3-5 张活动卡片）时运行良好，但在以下场景中存在瓶颈：

- 数据量大（20+ 条活动需要 Swiper 浏览）时，嵌入聊天流的 payload 过大
- 数据需要实时性（如报名人数、活动状态变化）
- 用户需要在 Widget 内深度交互（浏览详情、报名、分享）而不离开对话界面

本需求通过在现有 `WidgetChunk` 类型上增加可选的 `fetchConfig` 和 `interaction` 层，实现"引用式"数据获取模式，使 Widget 组件能够自主拉取数据并支持丰富的卡内交互。

**核心设计决策**：不新增 Widget 类型，不修改数据库枚举，仅扩展现有 `WidgetChunk` 接口。

## 术语表

- **Widget_System**：聚场 AI 对话中的结构化 UI 组件系统，负责渲染 Tool 返回的可视化数据
- **WidgetChunk**：Tool 返回的结构化 UI 数据块，包含 `messageType` 和 `payload`
- **Self_Contained_Mode（自包含模式）**：现有模式，Chat API 返回完整数据在 `payload` 中，前端直接渲染
- **Reference_Mode（引用模式）**：新增模式，Chat API 返回最小参数在 `fetchConfig` 中，前端 Widget 自主调用 API 获取数据
- **FetchConfig**：引用模式的配置对象，包含数据源标识和查询参数
- **WidgetDataSource**：预定义的 API 数据源枚举，映射到具体的 Orval SDK 调用
- **WidgetAction**：Widget 卡内操作定义，描述用户可在 Widget 内执行的动作（报名、分享等）
- **Interaction_Config**：交互配置对象，描述 Widget 的交互能力（Swiper、半屏详情、操作按钮等）
- **Half_Screen_Detail**：半屏弹出详情面板，用户点击卡片时在对话界面内展示活动详情
- **Widget_Data_Fetcher**：小程序端的数据获取工具，根据 `WidgetDataSource` 映射到对应的 Orval SDK API 调用
- **Action_Handler**：小程序端的集中式操作处理器，处理 Widget 内的用户操作并更新 Widget 状态

## 需求

### 需求 1：WidgetChunk 类型扩展

**用户故事**：作为 API 开发者，我希望扩展 WidgetChunk 接口以支持引用式数据获取和交互配置，使 Tool 能够灵活选择数据传递方式。

#### 验收标准

1. THE Widget_System SHALL 在 `WidgetChunk` 接口中支持可选的 `fetchConfig` 字段，包含 `source`（WidgetDataSource 枚举值）和 `params`（查询参数）
2. THE Widget_System SHALL 在 `WidgetChunk` 接口中支持可选的 `interaction` 字段，包含 `swipeable`（是否支持滑动）、`halfScreenDetail`（是否支持半屏详情）和 `actions`（WidgetAction 数组）
3. THE Widget_System SHALL 定义 `WidgetDataSource` 枚举，包含以下数据源：`nearby_activities`、`activity_detail`、`my_activities`、`partner_intents_nearby`、`activity_participants`
4. THE Widget_System SHALL 定义 `WidgetAction` 类型，包含 `type`（操作类型：`join`、`cancel`、`share`、`detail`、`publish`、`confirm_match`）、`label`（显示文本）和 `params`（操作参数）
5. WHEN `fetchConfig` 存在时，THE Widget_System SHALL 在 `payload` 中支持可选的 `preview` 字段，用于在数据加载前提供即时预览
6. WHEN `fetchConfig` 不存在时，THE Widget_System SHALL 保持现有自包含模式的行为完全不变

### 需求 2：exploreNearby Tool 引用模式支持

**用户故事**：作为 AI 系统，我希望 exploreNearby Tool 在结果数量较多时自动切换到引用模式，减少聊天流中的数据传输量。

#### 验收标准

1. WHEN exploreNearby 搜索结果数量超过阈值（5 条）时，THE exploreNearby_Tool SHALL 返回 `fetchConfig` 而非完整活动数据，`fetchConfig.source` 为 `nearby_activities`，`fetchConfig.params` 包含搜索中心点、半径和筛选条件
2. WHEN exploreNearby 搜索结果数量不超过阈值时，THE exploreNearby_Tool SHALL 保持现有自包含模式，在 `payload` 中返回完整活动数据
3. WHEN 使用引用模式时，THE exploreNearby_Tool SHALL 在 `payload.preview` 中包含结果总数和第一条活动的摘要信息，用于即时预览
4. WHEN 使用引用模式时，THE exploreNearby_Tool SHALL 在 `interaction` 中设置 `swipeable: true` 和 `halfScreenDetail: true`，并包含 `join` 和 `share` 操作

### 需求 3：Widget 数据获取器

**用户故事**：作为小程序开发者，我希望有一个统一的数据获取工具，根据 `WidgetDataSource` 自动调用对应的 Orval SDK API，简化 Widget 组件的数据加载逻辑。

#### 验收标准

1. THE Widget_Data_Fetcher SHALL 将每个 `WidgetDataSource` 枚举值映射到对应的 Orval SDK API 调用
2. WHEN Widget_Data_Fetcher 发起数据请求时，THE Widget_Data_Fetcher SHALL 管理加载状态（loading、success、error）
3. IF 数据请求失败，THEN THE Widget_Data_Fetcher SHALL 返回错误信息，Widget 组件回退显示 `payload.preview` 中的预览数据
4. THE Widget_Data_Fetcher SHALL 使用 Orval SDK 发起所有 API 请求，禁止使用 `wx.request`

### 需求 4：增强型 Explore Widget

**用户故事**：作为用户，我希望在对话中浏览活动时能够左右滑动查看更多活动、点击查看详情、直接报名，而不需要离开对话界面。

#### 验收标准

1. WHEN `interaction.swipeable` 为 true 时，THE Explore_Widget SHALL 以水平 Swiper 模式展示活动卡片，支持左右滑动浏览
2. WHEN `interaction.swipeable` 为 false 或不存在时，THE Explore_Widget SHALL 保持现有的垂直列表展示模式
3. WHEN `interaction.halfScreenDetail` 为 true 且用户点击活动卡片时，THE Explore_Widget SHALL 在对话界面内弹出半屏面板展示活动详情，通过 `activity_detail` 数据源获取详情数据
4. WHEN `interaction.actions` 包含操作按钮时，THE Explore_Widget SHALL 在每张活动卡片上渲染对应的操作按钮（如"报名"、"分享"）
5. WHEN `fetchConfig` 存在时，THE Explore_Widget SHALL 先显示加载骨架屏，然后通过 Widget_Data_Fetcher 获取完整数据后渲染
6. WHEN `fetchConfig` 存在且 `payload.preview` 包含预览数据时，THE Explore_Widget SHALL 在加载期间显示预览数据而非空白骨架屏

### 需求 5：Widget 操作处理器

**用户故事**：作为用户，我希望点击 Widget 内的操作按钮（报名、分享等）后，操作能够立即执行并更新按钮状态，无需离开对话界面。

#### 验收标准

1. WHEN 用户点击 `join` 类型的 WidgetAction 时，THE Action_Handler SHALL 调用报名 API，成功后将按钮文本更新为"已报名"并禁用按钮
2. WHEN 用户点击 `share` 类型的 WidgetAction 时，THE Action_Handler SHALL 触发微信分享功能，传递活动信息
3. WHEN 用户点击 `detail` 类型的 WidgetAction 时，THE Action_Handler SHALL 触发半屏详情面板展示活动详情
4. IF 操作执行失败，THEN THE Action_Handler SHALL 显示错误提示并恢复按钮到可点击状态
5. WHILE 操作正在执行中，THE Action_Handler SHALL 将对应按钮显示为加载状态，防止重复点击
6. THE Action_Handler SHALL 使用 Orval SDK 发起所有 API 请求，禁止使用 `wx.request`

### 需求 6：向后兼容性

**用户故事**：作为系统维护者，我希望所有现有 Widget 的行为在增强后保持完全不变，确保零回归风险。

#### 验收标准

1. THE Widget_System SHALL 保持所有现有 Widget 类型（widget_draft、widget_explore、widget_share、widget_action、widget_ask_preference、widget_dashboard、widget_launcher、widget_error）的现有行为完全不变
2. WHEN WidgetChunk 不包含 `fetchConfig` 字段时，THE Widget_System SHALL 按照现有自包含模式处理，前端直接从 `payload` 渲染数据
3. THE Widget_System SHALL 保持 `conversationMessageTypeEnum` 数据库枚举不变，不新增任何 Widget 类型
4. THE Widget_System SHALL 保持现有 `TOOL_WIDGET_TYPES` 映射不变

### 需求 7：操作结果卡片（ActionResult with resultPayload）

**用户故事**：作为用户，我希望在 Widget 内点击操作按钮（如"报名"）后，看到一张结构化的操作结果卡片（标题、摘要、详情、下一步操作），而不仅仅是按钮状态变化，让操作反馈更清晰、更有引导性。

#### 验收标准

1. THE Action_Handler SHALL 在操作成功时返回可选的 `resultPayload` 字段，包含 `title`（结果标题）、`summary`（结果摘要）、`details`（键值对详情数组）和 `nextAction`（下一步操作建议，可选的 WidgetAction）
2. WHEN `resultPayload` 存在时，THE Explore_Widget SHALL 在操作按钮下方渲染一张结构化结果卡片，展示 title、summary、details 列表和 nextAction 按钮
3. WHEN `resultPayload` 不存在时，THE Explore_Widget SHALL 保持现有行为（仅更新按钮状态为"已报名"等）
4. THE resultPayload.details SHALL 为 `{ label: string; value: string }[]` 格式，用于展示操作结果的关键信息（如活动名称、时间、地点等）
5. WHEN `resultPayload.nextAction` 存在时，THE Explore_Widget SHALL 在结果卡片底部渲染一个可点击的引导按钮（如"查看活动详情"、"分享给朋友"）

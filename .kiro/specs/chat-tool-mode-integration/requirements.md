# Requirements Document: Chat Tool Mode Integration

## Introduction

聚场 (JuChang) 是一个 Personal Social Agent，核心定位是"微信群的外挂"。本需求文档旨在解决当前存在的 4 个核心技术债，并全面集成 Chat Tool Mode 作为 P0 核心能力，确保产品架构与 PRD v4.8 和 TAD v4.6 的最新理念对齐。

## Glossary

- **System**: 聚场 (JuChang) 小程序及后端 API
- **Processor**: AI 处理管道中的纯函数模块，负责输入/输出处理
- **P0_Layer**: 全局关键词匹配层，最高优先级的意图识别
- **P1_Layer**: NLP 意图识别层，使用 LLM 进行语义理解
- **P2_Layer**: 兜底引导层，当 P0/P1 都无法识别时的回退策略
- **Chat_Tool_Mode**: 微信聊天工具模式，基于 Skyline 的半屏交互能力
- **Dynamic_Message**: 动态消息，群聊卡片可实时更新状态
- **System_Notification**: 系统通知，用户操作后群里自动冒泡的官方消息
- **Hot_Keywords**: 全局关键词（热词），P0 层的核心数据
- **Model_Router**: 模型路由器，根据意图选择最合适的 AI 模型
- **AI_Playground**: Admin 后台的 AI 调试工具，支持流程图可视化
- **Flow_Graph**: 流程图，可视化展示 AI 执行链路的每一个步骤

## Requirements

### Requirement 1: Processor 架构重构

**User Story:** 作为开发者，我希望 AI Playground 能够完整显示所有 Processor 节点，以便调试和优化 AI 处理流程。

#### Acceptance Criteria

1. WHEN save-history Processor 执行时，THE System SHALL 在 AI Playground 流程图中显示该节点
2. WHEN extract-preferences Processor 执行时，THE System SHALL 在 AI Playground 流程图中显示该节点
3. WHEN 用户点击 Processor 节点时，THE System SHALL 在右侧抽屉中显示该 Processor 的输入输出数据
4. WHEN 用户点击 Processor 节点时，THE System SHALL 在右侧抽屉中显示该 Processor 的配置项和性能指标
5. THE System SHALL 确保所有 Processor 在主流程中同步执行，而非在 onFinish 中异步执行

### Requirement 2: 模型路由统一

**User Story:** 作为开发者，我希望所有 AI 调用都通过统一的模型路由，以便根据意图选择最合适的模型，避免硬编码。

#### Acceptance Criteria

1. WHEN AI 需要进行闲聊时，THE System SHALL 调用 getModelByIntent('chat') 获取 qwen-flash 模型
2. WHEN AI 需要进行深度推理时，THE System SHALL 调用 getModelByIntent('reasoning') 获取 qwen-plus 模型
3. WHEN AI 需要进行 Tool Calling 时，THE System SHALL 调用 getModelByIntent('agent') 获取 qwen-max 模型
4. WHEN AI 需要进行视觉理解时，THE System SHALL 调用 getModelByIntent('vision') 获取 qwen-vl-max 模型
5. THE System SHALL 移除所有硬编码的模型名称（如 'qwen-flash'）

### Requirement 3: P0 层热词管理界面

**User Story:** 作为运营人员，我希望在 Admin 后台管理全局关键词，以便实时配置热词和响应内容，支持 Digital Ascension 战略。

#### Acceptance Criteria

1. WHEN 运营人员访问热词管理页面时，THE System SHALL 显示所有热词列表，包括关键词、匹配方式、响应类型、有效期、命中次数
2. WHEN 运营人员添加新热词时，THE System SHALL 允许配置关键词、匹配方式（完全匹配/前缀匹配/模糊匹配）、响应类型（Widget_Explore/Widget_Draft/文本）、响应内容、有效期
3. WHEN 运营人员编辑热词时，THE System SHALL 允许修改所有配置项
4. WHEN 运营人员删除热词时，THE System SHALL 将热词标记为已删除，而非物理删除
5. WHEN 运营人员查看热词统计时，THE System SHALL 显示热词命中率、转化率、时间趋势图
6. WHEN 用户输入匹配热词时，THE System SHALL 在 P0 层直接返回预设内容，无需调用 LLM

### Requirement 4: Chat Tool Mode 核心能力实现

**User Story:** 作为用户，我希望在微信群聊中点击活动卡片后，能够在半屏模式下完成报名，无需跳出群聊，体验更流畅。

#### Acceptance Criteria

1. WHEN 用户在群聊中点击活动卡片时，THE System SHALL 以半屏模式打开活动详情页
2. WHEN 用户在半屏模式下报名活动时，THE System SHALL 更新群聊卡片的辅标题（如"3人已参与"）
3. WHEN 用户在半屏模式下报名活动时，THE System SHALL 在群聊中发送系统通知（如"alex 已参与 cindy 发布的 火锅局"）
4. WHEN 用户下滑半屏页面时，THE System SHALL 关闭详情页并返回群聊
5. WHEN 用户在半屏模式下点击报名按钮时，THE System SHALL 显示巨大的固定按钮，强调行动召唤
6. THE System SHALL 使用 Skyline 渲染引擎实现半屏交互
7. THE System SHALL 创建独立分包（packageChatTool）用于 Chat Tool Mode
8. THE System SHALL 在 app.json 中配置 chatTools 入口

### Requirement 5: 活动详情页双模式适配

**User Story:** 作为用户，我希望活动详情页能够根据进入方式自动适配不同的布局，在普通模式下显示完整导航栏，在 Chat Tool Mode 下显示半屏布局。

#### Acceptance Criteria

1. WHEN 用户从首页/列表/探索进入活动详情页时，THE System SHALL 显示全屏布局和标准导航栏
2. WHEN 用户从群聊卡片进入活动详情页时，THE System SHALL 显示半屏布局，无顶部导航栏
3. WHEN 用户在 Chat Tool Mode 下查看活动详情时，THE System SHALL 显示巨大的报名按钮
4. WHEN 用户在普通模式下查看活动详情时，THE System SHALL 显示中等大小的报名按钮
5. THE System SHALL 通过 wx.getApiCategory() 判断当前模式

### Requirement 6: Hot Chips 组件实现

**User Story:** 作为用户，我希望在首页输入框上方看到可点击的热词胶囊，以便快速触发常用功能，降低输入门槛。

#### Acceptance Criteria

1. WHEN 用户进入首页时，THE System SHALL 在输入框上方显示 Hot Chips 组件
2. WHEN 用户点击 Hot Chip 时，THE System SHALL 自动发送该关键词到 AI
3. THE System SHALL 显示最多 3-5 个 Hot Chips，支持横向滚动
4. THE System SHALL 根据热度排序、时间相关、地理位置、运营推荐等策略动态配置 Hot Chips
5. THE System SHALL 记录 Hot Chip 的曝光、点击、转化事件

### Requirement 7: PRD 和 TAD 文档更新

**User Story:** 作为开发者，我希望 PRD 和 TAD 文档与最新的产品理念和技术架构保持一致，以便团队成员理解产品方向。

#### Acceptance Criteria

1. WHEN 开发者查看 PRD 时，THE System SHALL 确保 Chat Tool Mode 描述完整且准确
2. WHEN 开发者查看 TAD 时，THE System SHALL 确保 Processor 架构、模型路由、P0 层描述完整且准确
3. THE System SHALL 确保 PRD 和 TAD 中的版本号、更新日期、核心概念保持一致
4. THE System SHALL 确保 PRD 和 TAD 中的术语表包含所有新增术语
5. THE System SHALL 确保 PRD 和 TAD 中的流程图、架构图与实际实现一致

### Requirement 8: 动态消息 API 集成

**User Story:** 作为开发者，我希望后端提供动态消息更新 API，以便在用户报名后实时更新群聊卡片状态。

#### Acceptance Criteria

1. WHEN 用户报名活动时，THE System SHALL 调用微信 setChatToolMsg API 更新卡片辅标题
2. WHEN 活动状态变化时（如取消、完成），THE System SHALL 调用微信 setChatToolMsg API 更新卡片状态
3. THE System SHALL 在 activities 表中存储 activity_id（微信动态消息 ID）
4. THE System SHALL 在 activities 表中存储 group_openid（群聊标识）
5. THE System SHALL 确保动态消息更新在 500ms 内完成

### Requirement 9: 混合通知策略（Chat Tool Mode 系统消息 + 服务通知）

**User Story:** 作为用户，我希望在群聊中看到群内事件的系统消息，同时也能通过服务通知收到跨群/私密事件的提醒，确保不遗漏任何重要信息。

#### Acceptance Criteria

**Chat Tool Mode 系统消息（群内事件）**：

1. WHEN 用户在 Chat Tool Mode 下报名活动时，THE System SHALL 在群聊中发送系统消息（如"alex 已参与 cindy 发布的 火锅局"）
2. WHEN 找搭子匹配成功且双方都在同一个群时，THE System SHALL 在群聊中发送系统消息（如"系统已为 alex 和 bob 匹配成功"）
3. THE System SHALL 在 activities 表中存储 groupOpenId（群聊标识）
4. THE System SHALL 在 participants 表中存储 groupOpenId（群成员标识）
5. THE System SHALL 确保系统消息在 1s 内发送完成

**服务通知（跨群/私密事件）**：

6. WHEN 用户从群外渠道（朋友圈、私聊）报名活动时，THE System SHALL 发送服务通知给活动创建者（如"有新人报名了你的火锅局"）
7. WHEN 找搭子匹配成功且双方不在同一个群时，THE System SHALL 分别发送服务通知给双方（如"找到搭子啦！有人也想今晚吃火锅"）
8. WHEN 活动即将开始（提前 1 小时）时，THE System SHALL 发送服务通知给所有参与者（如"你参与的火锅局 1 小时后开始"）
9. WHEN 活动创建者取消活动时，THE System SHALL 发送服务通知给所有参与者（如"cindy 取消了火锅局"）
10. THE System SHALL 在 notifications 表中记录所有通知的发送状态（成功/失败）和通知类型（system_message/service_notification）

**通知策略决策逻辑**：

11. THE System SHALL 根据以下规则选择通知方式：
    - 如果事件发生在群内（groupOpenId 存在）→ 使用 Chat Tool Mode 系统消息
    - 如果事件涉及跨群用户或群外用户 → 使用服务通知
    - 如果需要确保触达所有人（活动提醒、取消）→ 使用服务通知

**注意事项**：
- **Chat Tool Mode 系统消息**：无需用户授权，无次数限制，所有群成员可见，具有社交裂变效果
- **服务通知**：需要用户授权（一次性订阅），有次数限制，私密通知，确保触达

### Requirement 10: AI Playground 流程图可视化

**User Story:** 作为开发者，我希望 AI Playground 支持流程图可视化，以便直观地看到 AI 执行链路的每一个步骤。

#### Acceptance Criteria

1. WHEN 开发者在 AI Playground 中发送消息时，THE System SHALL 实时显示流程图，包含所有执行节点
2. WHEN 开发者点击流程图节点时，THE System SHALL 在右侧抽屉中显示节点详情
3. THE System SHALL 支持以下节点类型：Input、Input Guard、P0 Match、P1 Intent、User Profile、Semantic Recall、Token Limit、LLM、Tool Calls、Output
4. THE System SHALL 使用不同颜色表示节点状态：灰色（pending）、蓝色（running）、绿色（success）、红色（error）
5. THE System SHALL 使用 @xyflow/react 和 Dagre 自动布局流程图
6. THE System SHALL 支持流式更新，实时显示节点状态变化

## Correctness Properties

### CP-27: Processor 架构完整性
FOR ALL AI 请求，所有 Processor（包括 save-history 和 extract-preferences）必须在主流程中同步执行，AI Playground 流程图必须显示所有 Processor 节点。

### CP-28: 模型路由一致性
FOR ALL AI 调用，必须通过 getModelByIntent() 函数选择模型，禁止硬编码模型名称。

### CP-29: P0 层优先级
FOR ALL 用户输入，必须先尝试 P0 层全局关键词匹配，匹配成功则直接返回预设内容，无需调用 LLM。

### CP-30: Chat Tool Mode 半屏交互
FOR ALL 从群聊卡片进入的活动详情页，必须以半屏模式显示，无顶部导航栏，支持下滑关闭。

### CP-31: 动态消息实时更新
FOR ALL 用户报名操作，群聊卡片的辅标题必须在 500ms 内更新为最新的参与人数。

### CP-32: 通知及时性
FOR ALL 关键事件（活动报名、找搭子匹配成功、活动取消、活动即将开始），通知必须在 1s 内发送完成（Chat Tool Mode 系统消息或服务通知）。

### CP-33: 通知策略决策
FOR ALL 通知发送，必须根据事件类型和用户关系选择正确的通知方式：群内事件使用 Chat Tool Mode 系统消息，跨群/私密事件使用服务通知。

### CP-34: Hot Chips 动态配置
FOR ALL Hot Chips 显示，必须根据后端配置的热词库动态生成，支持热度排序、时间相关、地理位置等策略。

### CP-35: 流程图节点完整性
FOR ALL AI Playground 执行，流程图必须显示从 Input 到 Output 的完整执行链路，包括所有 Processor、P0/P1/P2 层、LLM、Tool Calls 节点。

### CP-36: 双模式自动适配
FOR ALL 活动详情页访问，必须根据 wx.getApiCategory() 的返回值自动适配普通模式或 Chat Tool Mode。

### CP-37: 热词匹配准确性
FOR ALL 用户输入，如果匹配到 P0 层热词（完全匹配/前缀匹配/模糊匹配），必须返回预设的响应内容，匹配逻辑必须准确无误。

## Success Metrics

| 指标 | 说明 | 目标 |
|------|------|------|
| Processor 节点显示率 | AI Playground 流程图中显示所有 Processor 节点的比例 | 100% |
| 模型路由覆盖率 | 使用 getModelByIntent() 的 AI 调用比例 | 100% |
| P0 层命中率 | 用户输入匹配到 P0 层热词的比例 | ≥ 30% |
| Chat Tool Mode 使用率 | 从群聊进入的活动详情页比例 | ≥ 60% |
| 动态消息更新成功率 | 动态消息在 500ms 内更新成功的比例 | ≥ 95% |
| 系统消息发送成功率 | Chat Tool Mode 系统消息在 1s 内发送成功的比例 | ≥ 95% |
| 服务通知发送成功率 | 服务通知在 1s 内发送成功的比例 | ≥ 90% |
| 服务通知授权率 | 用户授权服务通知的比例 | ≥ 60% |
| Hot Chips 点击率 | 用户点击 Hot Chips 的比例 | ≥ 20% |
| 流程图可视化准确率 | 流程图节点与实际执行链路一致的比例 | 100% |
| 半屏报名转化率 | Chat Tool Mode 下的报名转化率 | ≥ 25% |
| 热词管理界面使用率 | 运营人员使用热词管理界面的频率 | ≥ 3 次/周 |

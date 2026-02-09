# Requirements Document

## Introduction

v5.0 版本包含两大核心方向：

1. **H5 Web 应用 + 主题系统**：`apps/web` (Next.js) 提供跨平台活动邀请函 `/invite/:id` 和小聚对话 `/chat`，支撑 Digital Ascension 战略（PRD 0.4），让聚场的活动链接能在抖音、小红书、直播间、线下海报等微信外平台传播。
2. **活动全生命周期补全**：修复当前活动生命周期"后半段空白"问题，补全报名→讨论→活动前→活动后→反馈的完整闭环。

## Glossary

- **H5_Invitation**: 活动邀请函 H5 页面，URL 格式 `https://juchang.app/invite/{activityId}`
- **Theme_System**: 活动主题系统，为每个活动分配视觉主题（动态背景 + 配色 + 文字效果）
- **ThemeConfig**: 主题配置 JSON，存储 React Bits Background Studio 导出的动态背景参数
- **OG_Tags**: Open Graph 标签，社交平台分享时展示标题、描述、图片的 HTML meta 标签
- **React_Bits**: 开源 React 动效库，提供 Aurora、Ballpit、Particles 等动态背景组件
- **Background_Studio**: React Bits 在线工具 (https://reactbits.dev/tools/background-studio)
- **Preset_Theme**: 预设主题，6 种内置主题（aurora、party、minimal、neon、warm、sport）
- **AI_Elements**: Vercel AI SDK Elements (https://elements.ai-sdk.dev)，copy-paste 模式安装
- **Eden_Treaty**: Elysia 类型安全 HTTP 客户端，apps/web 中所有 API 调用统一使用
- **Post_Activity_Flow**: 活动后流程，活动结束后自动触发的反馈收集和 AI 跟进

## Requirements

### Requirement 1: 数据库 Schema 扩展 - 活动主题字段

**User Story:** As a 开发者, I want to 在 activities 表中添加主题相关字段, so that 每个活动可以拥有独立的视觉主题配置。

#### Acceptance Criteria

1. THE activities 表 SHALL 新增 `theme` 字段（varchar(20)，默认值 "auto"，notNull）
2. THE activities 表 SHALL 新增 `themeConfig` 字段（jsonb，nullable）
3. THE `theme` 字段 SHALL 支持以下值：auto, aurora, party, minimal, neon, warm, sport, custom
4. WHEN `theme` = "auto" THEN THE System SHALL 根据活动类型自动分配预设主题
5. WHEN `theme` = "custom" THEN THE `themeConfig` 字段 SHALL 包含完整的 Background Studio 配置
6. THE selectActivitySchema 和 insertActivitySchema SHALL 自动包含新字段

### Requirement 2: 数据库 Schema 扩展 - 通知类型扩展

**User Story:** As a 开发者, I want to 扩展通知类型枚举, so that 系统能支持新人报名通知所有参与者、活动后反馈推送、活动前提醒等新通知场景。

#### Acceptance Criteria

1. THE notificationTypeEnum SHALL 新增 `new_participant` 类型（有新人报名，通知所有已报名参与者）
2. THE notificationTypeEnum SHALL 新增 `post_activity` 类型（活动结束后反馈推送）
3. THE notificationTypeEnum SHALL 新增 `activity_reminder` 类型（活动前 1 小时提醒）
4. THE 新增枚举值 SHALL 通过 `bun run db:push` 同步到数据库

### Requirement 3: 活动主题预设映射

**User Story:** As a 活动发起者, I want to 活动自动获得匹配的视觉主题, so that 邀请函看起来更有吸引力。

#### Acceptance Criteria

1. THE System SHALL 定义 6 种预设主题：aurora（极光）、party（派对）、minimal（简约）、neon（霓虹）、warm（暖色）、sport（运动）
2. WHEN AI 创建活动且 theme = "auto" THEN THE System SHALL 根据活动类型自动映射主题
3. THE 映射规则 SHALL 为：food → warm, entertainment → party, sports → sport, boardgame → neon, other → minimal
4. EACH 预设主题 SHALL 包含：background 组件配置、colorScheme 配色方案、可选的 textEffect

### Requirement 4: 公开活动详情 API（含讨论区预览）

**User Story:** As a H5 页面或小程序详情页, I want to 获取活动详情及最近讨论消息, so that 任何人都能感受到活动的社交氛围。

#### Acceptance Criteria

1. THE API SHALL 提供 `GET /activities/:id/public` 端点，无需 JWT 认证
2. THE 响应 SHALL 包含活动基础信息（title, description, startAt, locationName, locationHint, type, status）
3. THE 响应 SHALL 包含参与者信息（currentParticipants, maxParticipants, 参与者头像+昵称列表，最多 10 人）
4. THE 响应 SHALL 包含主题信息（theme, themeConfig）
5. THE 响应 SHALL 包含发起人基础信息（nickname, avatarUrl）
6. THE 响应 SHALL 包含最近 3 条讨论区消息预览（senderId, senderNickname, senderAvatar, content, createdAt）
7. THE 响应 SHALL NOT 包含敏感信息（creatorId, location 精确坐标, phoneNumber）
8. IF 活动不存在 THEN THE API SHALL 返回 404

### Requirement 5: 报名后自动跳转讨论区 + 系统消息 [P0]

**User Story:** As a 刚报名的用户, I want to 报名成功后自动进入讨论区并看到欢迎消息, so that 我能立刻融入活动社交氛围。

#### Acceptance Criteria

1. WHEN 用户报名成功 THEN THE API SHALL 向活动讨论区发送系统消息 "XX 刚刚加入了！"
2. WHEN 用户报名成功 THEN THE 小程序 SHALL 自动跳转到活动讨论区页面
3. THE 讨论区 SHALL 显示"打个招呼吧"的引导提示
4. THE 系统消息 SHALL 使用 activity_messages 表，messageType 为 `system`

### Requirement 6: 新人报名通知所有参与者 [P0]

**User Story:** As a 已报名的参与者, I want to 收到"XX 也来了！"的通知, so that 我能感受到活动的热度和社交氛围。

#### Acceptance Criteria

1. WHEN 有新用户报名活动 THEN THE System SHALL 向所有已报名参与者（不含新加入者和创建者）发送 `new_participant` 通知
2. THE 通知内容 SHALL 为 "XX 也来了！「活动标题」又多了一位小伙伴"
3. THE 原有的 `join` 通知（通知创建者）SHALL 保持不变
4. THE 通知 SHALL 异步发送，不阻塞报名主流程

### Requirement 7: 活动详情页嵌入讨论区预览 [P1]

**User Story:** As a 浏览活动的用户, I want to 在详情页直接看到最近的讨论消息, so that 不用跳转就能感受到活动氛围。

#### Acceptance Criteria

1. THE 小程序活动详情页 SHALL 在参与者列表下方展示最近 2-3 条讨论区消息
2. THE 讨论区预览 SHALL 显示发送者头像、昵称和消息内容
3. THE 讨论区预览 SHALL 包含"查看更多"入口，点击跳转到完整讨论区
4. THE 讨论区预览数据 SHALL 来自 `GET /activities/:id/public` 端点的 recentMessages 字段

### Requirement 8: Post-Activity Flow - 活动后自动流程 [P1]

**User Story:** As a 活动参与者, I want to 活动结束后收到小聚的跟进消息, so that 我能分享感受并被推荐下一次活动。

#### Acceptance Criteria

1. THE System SHALL 在活动 startAt + 2h 后自动将活动状态从 `active` 更新为 `completed`
2. WHEN 活动自动完成 THEN THE System SHALL 向所有参与者发送 `post_activity` 通知："火锅局结束了吗？玩得怎么样？"
3. THE 通知 SHALL 引导用户进入 AI 对话，小聚主动收集反馈（emoji 评分 + 一句话）
4. THE 反馈数据 SHALL 写入用户 workingMemory，用于优化下次推荐
5. THE 定时任务 SHALL 注册到 scheduler.ts，每 5 分钟检查一次

### Requirement 9: 分享卡片优化 [P2]

**User Story:** As a 分享活动的用户, I want to 分享卡片显示"已有X人报名", so that 制造 FOMO 吸引更多人点击。

#### Acceptance Criteria

1. THE 微信分享卡片标题 SHALL 包含报名人数信息（如 "已有3人报名，还差2人！"）
2. THE 分享卡片 SHALL 使用活动主题对应的配色风格
3. THE H5 邀请函 OG 标签 SHALL 同样包含报名人数信息

### Requirement 10: 活动前提醒优化 [P2]

**User Story:** As a 已报名的参与者, I want to 活动前 1 小时收到提醒, so that 我不会忘记参加活动。

#### Acceptance Criteria

1. THE System SHALL 在活动 startAt - 1h 时向所有参与者发送 `activity_reminder` 通知
2. THE 通知内容 SHALL 包含活动标题、时间、地点和讨论区入口
3. THE 定时任务 SHALL 注册到 scheduler.ts

### Requirement 11: apps/web 项目搭建 (Next.js)

**User Story:** As a 开发者, I want to 在 monorepo 中创建基于 Next.js 的 H5 Web 应用, so that 聚场拥有跨平台的 Web 入口。

#### Acceptance Criteria

1. THE apps/web SHALL 使用 Next.js + React + Tailwind CSS 技术栈
2. THE apps/web SHALL 在 monorepo 中注册为 `@juchang/web` workspace
3. THE apps/web SHALL 支持两个路由：`/invite/:id`（活动邀请函）、`/chat`（小聚对话）
4. THE apps/web SHALL 统一使用 Eden Treaty 调用所有 API 端点
5. THE turbo.json SHALL 包含 web 应用的 dev 和 build 任务配置
6. THE Next.js SHALL 不使用 API Routes，所有数据请求走 Elysia API

### Requirement 12: H5 活动邀请函页面 (`/invite/:id`)

**User Story:** As a 用户, I want to 通过链接查看精美的活动邀请函, so that 我可以了解活动详情并决定是否参与。

**策略决策（v5.0）**：H5 邀请函为只读展示页，不包含报名功能。所有报名操作收敛到小程序内完成。理由：聚场的流量模型是"外部曝光 → 微信内转化"，H5 的核心 KPI 是制造 FOMO（主题背景 + 社交氛围 + 报名人数），激发用户去微信内参与。加 H5 登录态会显著增加复杂度（JWT 管理、手机号验证 UI、非微信用户通知策略），拖慢交付。v5.1 根据 H5→小程序转化率数据决定是否加 H5 轻量 RSVP（手机号登录）。

#### Acceptance Criteria

1. THE `/invite/:id` 页面 SHALL 使用 Next.js SSR 渲染，自动生成 OG meta 标签
2. THE 页面 SHALL 展示活动完整信息（标题、描述、时间、地点、参与人数）
3. THE 页面 SHALL 根据活动 theme/themeConfig 渲染对应的 React Bits 动态背景
4. THE 页面 SHALL 展示发起人头像和昵称
5. THE 页面 SHALL 展示参与者头像列表和最近讨论消息预览
6. THE 页面 SHALL 包含"打开小程序"引导，微信内使用 URL Scheme 跳转，非微信显示小程序码
7. THE 页面 SHALL 适配移动端和桌面端（响应式设计）
8. THE 页面 SHALL 在活动已结束时显示"活动已结束"状态
9. THE SSR 生成的 OG 标签 SHALL 包含：og:title、og:description、og:image、og:url
10. THE 页面 SHALL NOT 包含任何报名/RSVP 功能，仅为只读展示

### Requirement 13: H5 小聚对话页面 (`/chat`)

**User Story:** As a 用户, I want to 在 H5 网页上与小聚对话, so that 即使不在小程序内也能使用 AI 助理功能。

#### Acceptance Criteria

1. THE `/chat` 页面 SHALL 使用 AI SDK Elements 组件（Conversation、Message、Reasoning、PromptInput）
2. THE 页面 SHALL 通过 Eden Treaty 调用 Elysia API 的 `POST /ai/chat` 端点（流式响应）
3. THE 页面 SHALL 支持流式文本渲染和 Reasoning（思考过程）展示
4. THE 页面 SHALL 作为小程序的降级方案，在小程序不可用时承接用户
5. THE 页面 SHALL 适配移动端和桌面端

### Requirement 14: 微信环境检测与跳转

**User Story:** As a 微信内用户, I want to 点击链接后能跳转到小程序, so that 我可以在小程序内完成报名。

#### Acceptance Criteria

1. WHEN 用户在微信内打开 H5 链接 THEN THE System SHALL 提供"打开小程序"按钮
2. THE "打开小程序"按钮 SHALL 使用微信 URL Scheme 或 wx-open-launch-weapp 标签跳转
3. WHEN 用户在非微信环境打开链接 THEN THE System SHALL 显示小程序码供用户扫码
4. THE 小程序跳转路径 SHALL 为 `subpackages/activity/detail/index?id={activityId}`

### Requirement 15: AI 创建活动自动分配主题

**User Story:** As a 活动发起者, I want to AI 创建活动时自动分配合适的视觉主题, so that 我不需要手动选择主题。

#### Acceptance Criteria

1. WHEN AI 调用 createActivityDraft Tool THEN THE System SHALL 根据活动类型自动设置 theme 字段
2. THE theme 自动映射 SHALL 遵循 Requirement 3 的映射规则
3. THE themeConfig SHALL 使用对应预设主题的默认配置

### Requirement 16: 更新 PRD/TAD 文档

**User Story:** As a 开发者, I want to 更新项目文档, so that 文档与代码保持一致。

#### Acceptance Criteria

1. THE PRD.md SHALL 新增 "H5 Web 应用" 章节，描述跨平台分享策略和 `/chat` 降级方案
2. THE PRD.md SHALL 新增 "活动主题系统" 章节
3. THE PRD.md SHALL 新增 "活动全生命周期" 章节，描述 Post-Activity Flow 和反馈收集
4. THE TAD.md SHALL 新增 "apps/web 架构" 章节
5. THE TAD.md SHALL 更新数据库 Schema 章节（theme、themeConfig、新通知类型）
6. THE TAD.md SHALL 更新技术栈表（Next.js、AI SDK Elements）
7. THE TAD.md SHALL 更新正确性属性（新增 CP-27 ~ CP-31）

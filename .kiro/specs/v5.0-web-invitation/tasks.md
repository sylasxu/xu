# Implementation Plan: v5.0 Web Invitation + Theme System + Lifecycle

## Overview

本实现计划按照两条原则排列：
1. **单向数据流**：DB Schema → API → 前端
2. **优先级驱动**：P0（闭环体验）→ P1（社交氛围 + 留存）→ P2（增长优化）→ Web 应用

开发顺序：DB 变更 → API 扩展（通知 + 定时任务 + 公开端点）→ 小程序修复（P0）→ Web 项目搭建 → 邀请函页面 → 对话页面 → 文档更新

## Tasks

- [x] 1. 数据库 Schema 扩展
  - [x] 1.1 activities 表新增 theme 和 themeConfig 字段
    - 修改 `packages/db/src/schema/activities.ts`
    - 在文件顶部定义并导出 `ThemeConfig` 接口
    - 在 `status` 字段之后新增：
      - `theme: varchar("theme", { length: 20 }).default("auto").notNull()`
      - `themeConfig: jsonb("theme_config").$type<ThemeConfig>()`
    - 确保 `insertActivitySchema` 和 `selectActivitySchema` 自动包含新字段
    - _Requirements: 1.1, 1.2, 1.3, 1.6_

  - [x] 1.2 notificationTypeEnum 新增 3 种通知类型
    - 修改 `packages/db/src/schema/enums.ts`
    - 在 notificationTypeEnum 数组中新增：`new_participant`、`post_activity`、`activity_reminder`
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.3 执行数据库同步
    - 运行 `bun run db:push` 同步 Schema 变更
    - _Requirements: 1.1, 1.2, 2.4_

- [x] 2. Checkpoint - 数据库变更验证
  - 确认 activities 表包含 theme 和 themeConfig 字段
  - 确认 notification_type 枚举包含 new_participant、post_activity、activity_reminder

- [x] 3. API 扩展 - 通知服务 + 报名流程
  - [x] 3.1 通知服务新增 3 个通知函数
    - 修改 `apps/api/src/modules/notifications/notification.service.ts`
    - 更新 `NOTIFICATION_TYPES` 常量数组，新增 `new_participant`、`post_activity`、`activity_reminder`
    - 新增 `notifyNewParticipant(activityId, activityTitle, newMemberName, newMemberId, creatorId)` 函数
      - 查询所有 joined 参与者，排除新加入者和创建者，逐个创建 `new_participant` 通知
    - 新增 `notifyPostActivity(activityId, activityTitle)` 函数
      - 查询所有 joined 参与者，创建 `post_activity` 通知
    - 新增 `notifyActivityReminder(activityId, activityTitle, locationName)` 函数
      - 查询所有 joined 参与者，创建 `activity_reminder` 通知
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.2, 10.1, 10.2_

  - [x] 3.2 报名流程扩展 - 系统消息 + 全员通知
    - 修改 `apps/api/src/modules/activities/activity.service.ts` 的 `joinActivity` 函数
    - 报名成功后，查询新加入者昵称
    - 插入系统消息到 activity_messages 表（messageType: 'system', content: "XX 刚刚加入了！"）
    - 调用 `notifyNewParticipant` 通知所有已报名参与者
    - 修复现有 `notifyJoin` 调用，传入真实用户昵称（替换 'someone'）
    - 所有新增操作异步执行，不阻塞主流程
    - _Requirements: 5.1, 5.4, 6.1, 6.2, 6.3, 6.4_

  - [x] 3.3 创建主题预设配置文件
    - 新建 `apps/api/src/modules/activities/theme-presets.ts`
    - 定义 `ACTIVITY_TYPE_THEME_MAP`（活动类型 → 预设主题名称映射）
    - 定义 `PRESET_THEMES`（6 种预设主题的 ThemeConfig）
    - 实现 `resolveThemeConfig(theme, themeConfig, activityType)` 纯函数
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.4 新增公开活动详情端点（含讨论区预览）
    - 在 `apps/api/src/modules/activities/activity.service.ts` 新增 `getPublicActivityById` 函数
      - 查询活动基础信息 + 发起人 nickname/avatarUrl（leftJoin users）
      - 查询参与者列表（最多 10 人，nickname + avatarUrl）
      - 查询最近 3 条 activity_messages（含发送者信息）
      - 排除敏感字段（creatorId, location 精确坐标, phoneNumber）
      - 返回 theme、themeConfig、participants、recentMessages
    - 在 `apps/api/src/modules/activities/activity.controller.ts` 注册 `GET /:id/public` 路由，无需 JWT
    - 在 `apps/api/src/modules/activities/activity.model.ts` 从 selectActivitySchema 派生 PublicActivitySchema
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 4. API 扩展 - 定时任务
  - [x] 4.1 创建 Post-Activity 自动完成任务
    - 新建 `apps/api/src/jobs/post-activity.ts`
    - 实现 `processPostActivity` 函数：查找 startAt + 2h < now 且 active 的活动，更新为 completed，调用 notifyPostActivity
    - _Requirements: 8.1, 8.2, 8.5_

  - [x] 4.2 创建活动前提醒任务
    - 新建 `apps/api/src/jobs/activity-reminder.ts`
    - 实现 `processActivityReminder` 函数：查找 startAt - 1h < now < startAt 且 active 的活动，调用 notifyActivityReminder
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 4.3 注册新任务到调度器
    - 修改 `apps/api/src/jobs/scheduler.ts`
    - 导入 processPostActivity 和 processActivityReminder
    - 注册两个新任务（均为每 5 分钟执行）
    - 替换现有空的 `updateActivityStatuses` 为 `processPostActivity`（或保留并新增）
    - _Requirements: 8.5, 10.3_

  - [x] 4.4 AI Tool 集成 - 自动分配主题
    - 修改 `apps/api/src/modules/ai/tools/activity-tools.ts`
    - 在 createActivityDraft 的 execute 中，根据活动类型调用 ACTIVITY_TYPE_THEME_MAP 设置 theme
    - 设置 themeConfig 为对应预设主题的默认配置
    - _Requirements: 15.1, 15.2, 15.3_

- [x] 5. Checkpoint - API 验证
  - 确认 `GET /activities/:id/public` 返回正确数据（含 participants、recentMessages）
  - 确认 joinActivity 后 activity_messages 表有系统消息
  - 确认 AI 创建活动时 theme 字段被正确设置

- [x] 6. 小程序修复 [P0]
  - [x] 6.1 报名后自动跳转讨论区
    - 修改 `apps/miniprogram/subpackages/activity/detail/index.ts` 的 `onConfirmJoin` 方法
    - 报名成功后，设置 participantStatus 为 'joined'（而非 'pending'）
    - 使用 setTimeout(800ms) 在 toast 显示后自动跳转到讨论区页面
    - _Requirements: 5.2_

  - [x] 6.2 活动详情页嵌入讨论区预览
    - 修改 `apps/miniprogram/subpackages/activity/detail/index.ts`
    - 在 loadActivityDetail 中额外调用公开端点获取 recentMessages（或复用现有数据）
    - 新增 recentMessages 到 PageData 接口
    - _Requirements: 7.1, 7.4_

  - [x] 6.3 活动详情页讨论区预览 UI
    - 修改 `apps/miniprogram/subpackages/activity/detail/index.wxml`
    - 在参与者列表下方新增讨论区预览区域
    - 显示最近 2-3 条消息（头像 + 昵称 + 内容）
    - 包含"查看更多"入口，点击调用 onEnterChat
    - 修改 `apps/miniprogram/subpackages/activity/detail/index.less` 添加样式
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 6.4 分享卡片优化
    - 修改 `apps/miniprogram/subpackages/activity/detail/index.ts` 的 `onShareAppMessage` 方法
    - 标题格式改为包含报名人数："已有X人报名，还差Y人！| 活动标题"
    - _Requirements: 9.1_

- [x] 7. Checkpoint - 小程序修复验证
  - 确认报名成功后自动跳转讨论区
  - 确认详情页显示讨论区预览
  - 确认分享卡片包含报名人数

- [x] 8. apps/web 项目搭建
  - [x] 8.1 初始化 Next.js 项目
    - 在 `apps/web/` 目录创建 Next.js 项目
    - 配置 `package.json`（name: `@juchang/web`，使用 bun）
    - 配置 `next.config.ts`
    - 配置 `tsconfig.json`（继承 `@juchang/ts-config`）
    - 配置 `tailwind.config.ts`
    - _Requirements: 11.1, 11.2_

  - [x] 8.2 配置 monorepo 集成
    - 更新根 `turbo.json` 添加 web 应用的 dev/build 任务
    - 确认根 `package.json` 的 workspaces 已包含 `apps/web`（glob `apps/*` 已覆盖）
    - _Requirements: 11.5_

  - [x] 8.3 配置 Eden Treaty 客户端
    - 新建 `apps/web/lib/eden.ts`
    - 配置 Eden Treaty 指向 Elysia API（`NEXT_PUBLIC_API_URL` 环境变量）
    - 所有 API 调用统一通过此客户端
    - _Requirements: 11.4_

  - [x] 8.4 安装 AI SDK Elements
    - 从 https://elements.ai-sdk.dev 复制所需组件（conversation, message, reasoning, prompt-input）
    - 组件文件放入 `apps/web/components/ai-elements/`
    - _Requirements: 13.1_

  - [x] 8.5 创建根布局和基础路由
    - 创建 `apps/web/app/layout.tsx`（根布局，全局样式和字体）
    - 创建 `apps/web/app/page.tsx`（首页，重定向到 /chat）
    - 创建 `/invite/[id]/page.tsx` 和 `/chat/page.tsx` 占位页面
    - _Requirements: 11.3, 11.6_

- [x] 9. Checkpoint - 项目搭建验证
  - 确认 `bun run dev --filter=@juchang/web` 能正常启动 Next.js 开发服务器
  - 确认路由可访问

- [x] 10. H5 邀请函页面
  - [x] 10.1 创建微信环境检测工具
    - 新建 `apps/web/lib/wechat.ts`
    - 实现 `isWechatBrowser()` 和 `getMiniProgramUrl(activityId)` 函数
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 10.2 创建主题配置文件
    - 新建 `apps/web/lib/themes.ts`
    - 复制预设主题配置（与 API 端 theme-presets.ts 保持同步）
    - 实现 `resolveThemeConfig` 函数，导出 ThemeConfig 类型
    - _Requirements: 3.1, 3.4_

  - [x] 10.3 创建 React Bits 动态背景渲染器
    - 新建 `apps/web/components/invite/theme-background.tsx`
    - 使用 `next/dynamic` 动态导入 React Bits 组件（ssr: false）
    - 根据 ThemeConfig.background.component 渲染对应组件
    - _Requirements: 12.3_

  - [x] 10.4 创建活动信息卡片组件
    - 新建 `apps/web/components/invite/activity-card.tsx`
    - 展示活动标题、描述、时间、地点、参与人数
    - 展示发起人头像和昵称、参与者头像列表
    - 根据 themeConfig.colorScheme 适配文字颜色
    - 活动已结束/已取消时显示对应状态
    - Mobile-first：卡片 `max-w-lg mx-auto`，移动端全宽，桌面端居中
    - _Requirements: 12.2, 12.4, 12.5, 12.8_

  - [x] 10.5 创建讨论区预览组件
    - 新建 `apps/web/components/invite/discussion-preview.tsx`
    - 展示最近 2-3 条讨论消息（头像 + 昵称 + 内容）
    - _Requirements: 12.5_

  - [x] 10.6 创建微信跳转引导组件
    - 新建 `apps/web/components/invite/wechat-redirect.tsx`
    - 微信内显示"打开小程序"按钮
    - 非微信显示小程序码
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 10.7 实现邀请函 SSR 页面
    - 实现 `apps/web/app/invite/[id]/page.tsx`
    - 实现 `generateMetadata` 函数生成 OG 标签（含报名人数 FOMO 文案）
    - 通过 Eden Treaty 调用 `GET /activities/:id/public` 获取数据
    - 组合 ThemeBackground + ActivityCard + DiscussionPreview + WechatRedirect
    - 活动不存在时显示 404
    - Mobile-first 响应式：内容区 `max-w-lg mx-auto`，移动端全宽，桌面端居中
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6, 12.7, 12.8, 12.9, 9.3_

- [x] 11. Checkpoint - 邀请函页面验证
  - 确认 `/invite/:id` 页面正常渲染
  - 确认 OG 标签正确生成（含报名人数）
  - 确认动态背景正常显示
  - 确认讨论区预览正常显示

- [x] 12. H5 小聚对话页面
  - [x] 12.1 实现对话页面
    - 实现 `apps/web/app/chat/page.tsx`
    - 通过 Eden Treaty 调用 Elysia `POST /ai/chat` 端点
    - 使用 AI SDK Elements 的 Conversation、Message、Reasoning、PromptInput 组件
    - 支持流式文本渲染和 Reasoning 展示
    - Mobile-first 响应式：容器 `max-w-2xl mx-auto`，移动端全宽，桌面端居中
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 13. Checkpoint - 对话页面验证
  - 确认 `/chat` 页面能正常与 AI 对话
  - 确认流式响应和 Reasoning 展示正常

- [x] 14. 文档更新
  - [x] 14.1 更新 PRD.md
    - 新增 "H5 Web 应用" 章节（跨平台分享策略、`/invite/:id` 邀请函、`/chat` 降级方案）
    - 新增 "活动主题系统" 章节（6 种预设主题、活动类型映射、自定义主题）
    - 新增 "活动全生命周期" 章节（Post-Activity Flow、反馈收集、活动前提醒、报名后跳转讨论区）
    - 更新术语表
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 14.2 更新 TAD.md
    - 新增 "apps/web 架构" 章节（Next.js 技术选型、AI SDK Elements、Eden Treaty、目录结构）
    - 更新技术栈表（新增 Next.js、AI SDK Elements、React Bits）
    - 更新数据库 Schema 章节（activities 新增 theme/themeConfig、notificationTypeEnum 新增 3 种类型）
    - 更新目录结构（新增 apps/web）
    - 更新 API 接口列表（新增 GET /activities/:id/public）
    - 更新定时任务列表（新增 post-activity、activity-reminder）
    - 新增正确性属性 CP-27 ~ CP-31
    - _Requirements: 16.4, 16.5, 16.6, 16.7_

- [x] 15. Final Checkpoint
  - 确认所有页面正常工作
  - 确认文档与代码一致
  - 确认所有 P0 流程闭环（报名→讨论区→系统消息→全员通知）

## Notes

- 任务按优先级排列：DB → API（P0 通知+报名扩展）→ 小程序修复（P0）→ Web 项目 → 文档
- Next.js 不使用 API Routes，所有数据请求走 Elysia API
- AI SDK Elements 使用 copy-paste 模式安装（类似 shadcn/ui）
- React Bits 组件必须使用 `dynamic import` + `ssr: false`
- Eden Treaty 统一用于所有 API 调用（包括 AI 对话），不使用 useChat 直连
- 预设主题配置在 API 端和 Web 端各维护一份（API 端用于创建时分配，Web 端用于渲染）
- 使用 `bun run db:push` 同步 Schema，不使用 db:migrate
- 所有新增通知操作异步执行，不阻塞主流程

### v5.1 预留项（根据 v5.0 数据决定）

- **H5 轻量 RSVP**：如果 H5→小程序转化率低于 10%，在 H5 邀请函上加手机号登录 + 轻量报名。需要在 apps/web 加登录态管理 + 手机号验证 UI，非微信用户通知走短信而非微信服务通知。
- **主题编辑器**：在 Admin 后台或小程序活动确认页加"选择主题"步骤，用 React Bits Background Studio (https://reactbits.dev/tools/background-studio) 做可视化配置，导出 JSON 存到 themeConfig 字段，H5 邀请函渲染时读取。当前 v5.0 先跑通 6 个预设主题 + AI 自动分配。

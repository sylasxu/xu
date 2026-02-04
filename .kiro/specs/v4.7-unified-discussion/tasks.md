# Implementation Plan: v4.7 Unified Discussion

## Overview

本实现计划按照以下顺序执行：
1. Phase 1: 数据库清理（移除 Chat Tool Mode 相关字段）
2. Phase 2: API 模块清理与扩展
3. Phase 3: 活动讨论区 WebSocket 实现
4. Phase 4: AI 海报生成模块
5. Phase 5: 小程序讨论区页面
6. Phase 6: 文档更新

## Tasks

- [x] 1. 数据库 Schema 清理
  - [x] 1.1 移除 activities 表的 groupOpenId 和 dynamicMessageId 字段
    - 修改 `packages/db/src/schema/activities.ts`
    - 移除 `groupOpenId: varchar("group_openid", { length: 128 })`
    - 移除 `dynamicMessageId: varchar("dynamic_message_id", { length: 128 })`
    - _Requirements: 1.3_
  
  - [x] 1.2 移除 participants 表的 groupOpenId 字段
    - 修改 `packages/db/src/schema/participants.ts`
    - 移除 `groupOpenId: varchar("group_openid", { length: 128 })`
    - _Requirements: 1.4_
  
  - [x] 1.3 移除 notifications 表的 notificationMethod 字段
    - 修改 `packages/db/src/schema/notifications.ts`
    - 移除 `notificationMethod` 字段
    - _Requirements: 1.5, 9.3_
  
  - [x] 1.4 移除 notificationMethodEnum 枚举
    - 修改 `packages/db/src/schema/enums.ts`
    - 移除 `notificationMethodEnum` 定义
    - _Requirements: 1.5_
  
  - [x] 1.5 执行数据库同步
    - 运行 `bun run db:push` 同步 Schema 变更
    - _Requirements: 1.3, 1.4, 1.5_

- [ ] 2. Checkpoint - 数据库变更验证
  - 确保数据库同步成功，检查表结构是否正确

- [x] 3. wechat 模块清理与扩展
  - [x] 3.1 移除 Chat Tool Mode 相关函数
    - 修改 `apps/api/src/modules/wechat/wechat.service.ts`
    - 移除 `updateDynamicMessage` 函数
    - 移除 `sendGroupSystemMessage` 函数
    - _Requirements: 1.1, 1.2_
  
  - [x] 3.2 新增客服消息发送函数
    - 在 `wechat.service.ts` 中新增 `sendCustomerMessage` 函数
    - 调用微信客服消息 API
    - _Requirements: 6.1_
  
  - [x] 3.3 新增小程序码生成函数
    - 在 `wechat.service.ts` 中新增 `generateQRCode` 函数
    - 调用微信 getwxacode API
    - _Requirements: 2.4_

- [x] 4. chat 模块 WebSocket 扩展
  - [x] 4.1 创建连接池管理模块
    - 新建 `apps/api/src/modules/chat/connection-pool.ts`
    - 实现 `addConnection`, `removeConnection`, `getConnectionsByActivity`, `broadcastToActivity`, `getOnlineCount` 纯函数
    - _Requirements: 3.1, 4.1_
  
  - [x] 4.2 扩展 chat.model.ts 添加 WebSocket 消息类型
    - 新增 `WsClientMessageSchema` 定义
    - 新增 `WsServerMessageSchema` 定义
    - _Requirements: 4.1, 4.2_
  
  - [x] 4.3 创建 WebSocket 处理器
    - 新建 `apps/api/src/modules/chat/chat.ws.ts`
    - 实现 `handleWsUpgrade` 函数（验证 token、检查参与状态、加入连接池、发送历史消息）
    - 实现 `handleWsMessage` 函数（内容安全检测、持久化、广播）
    - 实现 `handleWsClose` 函数（清理连接、广播在线人数）
    - _Requirements: 3.1, 3.3, 3.4, 4.1, 4.2, 5.1_
  
  - [x] 4.4 在 chat.controller.ts 中注册 WebSocket 路由
    - 使用 Elysia 的 `.ws()` 方法注册 `/chat/:activityId/ws` 端点
    - 连接 WebSocket 处理器
    - _Requirements: 3.1_
  
  - [x] 4.5 新增消息举报端点
    - 在 `chat.controller.ts` 中新增 `POST /chat/:activityId/report` 端点
    - 复用 reports 模块的 `createReport` 函数
    - _Requirements: 5.5, 5.6_

- [ ] 5. Checkpoint - WebSocket 功能验证
  - 确保 WebSocket 连接、消息发送、广播功能正常

- [x] 6. poster 模块实现
  - [x] 6.1 创建 poster.model.ts
    - 新建 `apps/api/src/modules/poster/poster.model.ts`
    - 定义 `PosterStyleSchema`, `GeneratePosterRequestSchema`, `GeneratePosterResponseSchema`
    - _Requirements: 2.5_
  
  - [x] 6.2 创建 poster.service.ts
    - 新建 `apps/api/src/modules/poster/poster.service.ts`
    - 实现 `generatePoster` 函数
    - 实现 `generateBackground` 函数（调用千问 VL）
    - 实现 `composePoster` 函数（Puppeteer 渲染）
    - _Requirements: 2.1, 2.2, 2.3, 2.6_
  
  - [x] 6.3 创建 poster.controller.ts
    - 新建 `apps/api/src/modules/poster/poster.controller.ts`
    - 实现 `POST /poster/generate` 端点
    - _Requirements: 2.1_
  
  - [x] 6.4 创建海报 HTML 模板
    - 新建 `apps/api/src/modules/poster/templates/simple.html`
    - 新建 `apps/api/src/modules/poster/templates/vibrant.html`
    - 新建 `apps/api/src/modules/poster/templates/artistic.html`
    - _Requirements: 2.5_
  
  - [x] 6.5 注册 poster 模块到主应用
    - 在 `apps/api/src/index.ts` 中导入并注册 `posterController`
    - _Requirements: 2.1_

- [ ] 7. Checkpoint - 海报生成功能验证
  - 确保海报生成 API 正常工作

- [x] 8. 小程序讨论区页面
  - [x] 8.1 创建讨论区状态管理
    - 新建 `apps/miniprogram/src/stores/discussion.ts`
    - 实现 `DiscussionState` 接口和 store
    - _Requirements: 8.2_
  
  - [x] 8.2 创建讨论区页面结构
    - 新建 `apps/miniprogram/subpackages/activity/discussion/index.wxml`
    - 新建 `apps/miniprogram/subpackages/activity/discussion/index.json`
    - _Requirements: 8.1, 8.3_
  
  - [x] 8.3 实现讨论区页面逻辑
    - 新建 `apps/miniprogram/subpackages/activity/discussion/index.ts`
    - 实现 WebSocket 连接管理
    - 实现消息发送和接收
    - _Requirements: 8.2, 8.5_
  
  - [x] 8.4 实现讨论区页面样式
    - 新建 `apps/miniprogram/subpackages/activity/discussion/index.less`
    - 实现消息列表、输入框、在线人数样式
    - _Requirements: 8.3, 8.4, 8.6_
  
  - [x] 8.5 创建消息项组件
    - 新建 `apps/miniprogram/subpackages/activity/discussion/components/message-item/`
    - 实现消息气泡、头像、昵称、时间显示
    - _Requirements: 8.4_
  
  - [x] 8.6 在活动详情页添加讨论区入口
    - 修改 `apps/miniprogram/subpackages/activity/detail/index.wxml`
    - 添加"进入讨论区"按钮
    - _Requirements: 8.1_
  
  - [x] 8.7 更新 app.json 注册讨论区页面
    - 在 subpackages 中注册 `activity/discussion/index`
    - _Requirements: 8.1_

- [ ] 9. Checkpoint - 小程序讨论区验证
  - 确保小程序讨论区页面正常工作

- [x] 10. 文档更新
  - [x] 10.1 更新 PRD.md
    - 移除 "1.4 微信聊天工具模式" 章节
    - 新增 "活动讨论区" 章节
    - 新增 "AI 海报生成" 章节
    - 新增 "合规性" 章节
    - 更新通知策略章节
    - _Requirements: 10.1, 10.2, 10.3, 10.7, 11.1, 11.2_
  
  - [x] 10.2 更新 TAD.md
    - 移除 Chat Tool Mode 相关技术实现章节
    - 新增 "WebSocket 架构" 章节
    - 新增 "AI 海报技术实现" 章节
    - 新增 "内容安全集成" 章节
    - 更新数据库 Schema 章节（移除 Chat Tool Mode 字段）
    - 更新 API 模块设计章节
    - _Requirements: 10.4, 10.5, 10.6, 10.7_

- [ ] 11. Final Checkpoint
  - 确保所有功能正常工作
  - 确保文档与代码一致

## Notes

- 任务按依赖顺序排列，数据库变更优先
- 每个 Checkpoint 用于验证阶段性成果
- 复用现有 chat.service.ts 的 `getMessages`、`sendMessage` 函数
- WebSocket 连接池使用纯函数设计，无 class
- 海报生成使用千问 VL + Puppeteer 组合

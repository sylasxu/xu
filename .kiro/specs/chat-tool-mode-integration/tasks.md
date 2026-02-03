# Implementation Plan: Chat Tool Mode Integration

## Overview

本实施计划将 Chat Tool Mode Integration 功能分解为离散的编码任务。每个任务都基于已批准的设计文档，按照增量开发的原则组织，确保每一步都能验证核心功能。

**实施原则**：
- 数据库优先：先更新 Schema，再实现 API，最后实现前端
- 增量验证：每个任务完成后都能通过代码验证功能
- 无孤立代码：所有代码都集成到现有系统中

## Tasks

- [x] 1. 数据库 Schema 更新 ✅
  - 更新 activities 表，添加 groupOpenId 和 dynamicMessageId 字段
  - 更新 participants 表，添加 groupOpenId 字段
  - 更新 notifications 表，添加 notificationType 字段和枚举
  - 更新 ai_requests 表，添加 processorLog 和 p0MatchKeyword 字段
  - 运行 `bun run db:push` 同步 Schema 到数据库
  - _Requirements: 8.3, 8.4, 9.3, 9.4, 9.5_
  - _Note: 所有字段已存在于 Schema 中_

- [x] 2. Processor 架构重构 ✅
  - [x] 2.1 创建 Processor 接口和类型定义 ✅
    - 在 `apps/api/src/modules/ai/processors/types.ts` 定义 ProcessorContext, ProcessorResult, Processor 接口
    - _Requirements: 1.1, 1.2_
  
  - [x] 2.2 实现 Input Guard Processor ✅
    - 在 `apps/api/src/modules/ai/processors/input-guard.ts` 实现敏感词检测和注入攻击检测
    - _Requirements: 1.5_
  
  - [x] 2.3 实现 User Profile Processor ✅
    - 在 `apps/api/src/modules/ai/processors/user-profile.ts` 实现用户画像注入
    - _Requirements: 1.5_
  
  - [x] 2.4 实现 Semantic Recall Processor ✅
    - 在 `apps/api/src/modules/ai/processors/semantic-recall.ts` 实现语义检索历史活动
    - _Requirements: 1.5_
  
  - [x] 2.5 实现 Token Limit Processor ✅
    - 在 `apps/api/src/modules/ai/processors/token-limit.ts` 实现 Token 限制和截断
    - _Requirements: 1.5_
  
  - [x] 2.6 实现 Save History Processor ✅
    - 在 `apps/api/src/modules/ai/processors/save-history.ts` 实现对话历史保存
    - _Requirements: 1.1, 1.5_
  
  - [x] 2.7 实现 Extract Preferences Processor ✅
    - 在 `apps/api/src/modules/ai/processors/extract-preferences.ts` 实现偏好提取
    - _Requirements: 1.2, 1.5_
  
  - [x] 2.8 集成 Processors 到 AI Service
    - 更新 `apps/api/src/modules/ai/ai.service.ts`，使用 experimental_transform 注入 Processors
    - 将 save-history 和 extract-preferences 从 onFinish 移到主流程
    - 记录 Processor 执行结果到 ai_requests.processorLog
    - _Requirements: 1.1, 1.2, 1.5_

- [x] 3. 模型路由统一 ✅
  - [x] 3.1 创建模型路由接口 ✅
    - 在 `apps/api/src/modules/ai/models/types.ts` 定义 ModelIntent, ModelConfig, ModelRouterOptions
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
    - _Note: 已存在完整的类型定义_
  
  - [x] 3.2 实现 getModelByIntent 函数 ✅
    - 在 `apps/api/src/modules/ai/models/router.ts` 实现模型选择逻辑
    - 配置 MODEL_CONFIGS 映射表（chat→qwen-flash, reasoning→qwen-plus, agent→qwen-max, vision→qwen-vl-max）
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
    - _Note: 已实现 getModelByIntent 函数_
  
  - [x] 3.3 实现模型降级和重试 ✅
    - 在 `apps/api/src/modules/ai/models/router.ts` 实现 callWithFallback 函数
    - 支持 Qwen 失败时降级到 DeepSeek
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
    - _Note: 已实现 withFallback 和 withRetry 函数_
  
  - [x] 3.4 移除硬编码模型名称
    - 搜索 `apps/api/src/modules/ai/` 目录下所有硬编码的模型名称（'qwen-flash', 'qwen-plus', 'qwen-max', 'deepseek-chat'）
    - 替换为 getModelByIntent() 调用
    - _Requirements: 2.5_

- [x] 4. P0 层热词管理后端实现 ✅
  - [x] 4.1 完善热词 Service 函数 ✅
    - 在 `apps/api/src/modules/hot-keywords/hot-keywords.service.ts` 确保所有 CRUD 函数完整实现
    - 实现缓存逻辑（getCache, setCache, invalidateCache）
    - 实现 matchKeyword 函数（支持 exact/prefix/fuzzy 匹配）
    - 实现 incrementHitCount 和 incrementConversionCount 函数
    - 实现 trackConversion 函数（30 分钟内转化追踪）
    - _Requirements: 3.2, 3.3, 3.4, 3.6_
    - _Note: 所有函数已完整实现_
  
  - [x] 4.2 集成 P0 层到 AI Service ✅
    - 更新 `apps/api/src/modules/ai/ai.service.ts`，在意图识别前调用 matchKeyword
    - 如果匹配成功，直接返回预设响应，跳过 LLM 调用
    - 记录 P0 匹配结果到 ai_requests.p0MatchKeyword
    - 在 AI 响应消息中添加 keywordContext（用于转化追踪）
    - _Requirements: 3.6_
    - _Note: P0 层已集成到 AI Service_

- [x] 5. P0 层热词管理前端实现 ✅
  - [x] 5.1 实现热词列表组件 ✅
    - 在 `apps/admin/src/features/hot-keywords/components/hot-keywords-list.tsx` 实现数据表格
    - 支持搜索、筛选（状态、匹配方式、响应类型）
    - 支持批量操作（启用/停用、删除）
    - _Requirements: 3.1_
  
  - [x] 5.2 实现热词表单组件 ✅
    - 在 `apps/admin/src/features/hot-keywords/components/hot-keyword-form.tsx` 实现创建/编辑表单
    - 支持所有字段配置（关键词、匹配方式、响应类型、响应内容、优先级、有效期）
    - 响应内容字段支持 JSON 编辑器
    - _Requirements: 3.2, 3.3_
  
  - [x] 5.3 实现热词分析组件 ✅
    - 在 `apps/admin/src/features/hot-keywords/components/hot-keywords-analytics.tsx` 实现分析仪表盘
    - 显示命中率 Top 10 柱状图
    - 显示转化率分析表格（命中次数、转化次数、转化率、趋势）
    - _Requirements: 3.5_
  
  - [x] 5.4 实现热词管理页面路由 ✅
    - 在 `apps/admin/src/routes/_authenticated/hot-keywords/index.tsx` 集成所有组件
    - 实现 Eden Treaty API 调用（useHotKeywords, useCreateKeyword, useUpdateKeyword, useDeleteKeyword, useKeywordAnalytics）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_


- [x] 6. Chat Tool Mode 小程序分包实现 ✅
  - [x] 6.1 创建 Chat Tool 独立分包 ✅
    - 在 `apps/miniprogram/app.json` 配置 packageChatTool 分包
    - 设置 renderer: 'skyline', componentFramework: 'glass-easel'
    - 配置 chatTools 入口
    - _Requirements: 4.6, 4.7, 4.8_
  
  - [x] 6.2 实现活动详情页双模式适配 ✅
    - 在 `apps/miniprogram/packageChatTool/pages/activity-detail/index.ts` 实现页面逻辑
    - 使用 wx.getApiCategory() 检测当前模式
    - 根据模式切换布局（全屏 vs 半屏）
    - 根据模式调整按钮样式（中等 vs 巨大）
    - _Requirements: 5.1, 5.2, 5.5_
  
  - [x] 6.3 实现活动详情页 UI ✅
    - 在 `apps/miniprogram/packageChatTool/pages/activity-detail/index.wxml` 实现 Skyline 模板
    - 实现半屏布局（无顶部导航栏）
    - 实现巨大的固定报名按钮
    - 支持下滑关闭
    - _Requirements: 4.1, 4.4, 4.5_

- [x] 7. 动态消息 API 实现
  - [x] 7.1 实现 WeChat Service 函数
    - 在 `apps/api/src/modules/wechat/wechat.service.ts` 实现 createDynamicMessage 函数
    - 实现 updateDynamicMessage 函数
    - 实现 sendSystemNotification 函数
    - _Requirements: 8.1, 8.2, 4.3_
  
  - [x] 7.2 实现 WeChat Controller
    - 在 `apps/api/src/modules/wechat/wechat.controller.ts` 创建路由
    - POST /wechat/dynamic-message - 创建动态消息
    - PATCH /wechat/dynamic-message/:activityId - 更新动态消息
    - POST /wechat/system-notification - 发送系统通知
    - _Requirements: 8.1, 8.2, 4.3_
  
  - [x] 7.3 实现 WeChat Model Schema
    - 在 `apps/api/src/modules/wechat/wechat.model.ts` 定义 TypeBox Schema
    - 定义请求/响应 Schema（CreateDynamicMessageRequest, UpdateDynamicMessageRequest, SendSystemNotificationRequest）
    - _Requirements: 8.1, 8.2, 4.3_
  
  - [x] 7.4 集成动态消息到活动报名流程
    - 更新 `apps/api/src/modules/activities/activities.service.ts` 的 joinActivity 函数
    - 报名成功后调用 updateDynamicMessage 更新卡片辅标题
    - 确保更新在 500ms 内完成
    - _Requirements: 4.2, 8.1, 8.5_

- [x] 8. 混合通知策略实现
  - [x] 8.1 实现通知策略决策逻辑
    - 在 `apps/api/src/modules/notifications/notifications.service.ts` 创建 decideNotificationStrategy 函数
    - 根据 groupOpenId 和用户关系选择通知方式（system_message vs service_notification）
    - _Requirements: 9.11_
  
  - [x] 8.2 实现系统消息发送
    - 在 `apps/api/src/modules/notifications/notifications.service.ts` 创建 sendSystemMessage 函数
    - 调用 wechat.service.sendSystemNotification
    - 记录到 notifications 表（notificationType='system_message'）
    - _Requirements: 9.1, 9.2_
  
  - [x] 8.3 实现服务通知发送
    - 在 `apps/api/src/modules/notifications/notifications.service.ts` 创建 sendServiceNotification 函数
    - 调用微信订阅消息 API
    - 记录到 notifications 表（notificationType='service_notification'）
    - _Requirements: 9.6, 9.7, 9.8, 9.9_
  
  - [x] 8.4 集成通知策略到活动报名流程
    - 更新 `apps/api/src/modules/activities/activities.service.ts` 的 joinActivity 函数
    - 报名成功后调用 decideNotificationStrategy
    - 根据策略发送系统消息或服务通知
    - 确保通知在 1s 内发送完成
    - _Requirements: 9.1, 9.6, 9.11_
  
  - [x] 8.5 集成通知策略到找搭子匹配流程
    - 更新 `apps/api/src/modules/workflow/partner-matching.ts` 的匹配确认逻辑
    - 匹配成功后调用 decideNotificationStrategy
    - 根据策略发送系统消息或服务通知
    - _Requirements: 9.2_
  
  - [x] 8.6 集成通知策略到活动提醒和取消流程
    - 更新 `apps/api/src/modules/activities/activities.service.ts` 的活动提醒和取消逻辑
    - 调用 sendServiceNotification 发送提醒和取消通知
    - _Requirements: 9.8, 9.9_

- [x] 9. Hot Chips 小程序组件实现 ✅
  - [x] 9.1 实现 Hot Chips 组件 ✅
    - 在 `apps/miniprogram/components/hot-chips/index.ts` 实现组件逻辑
    - 调用 /hot-keywords API 获取热词列表（传递位置和时间范围）
    - 实现点击事件，触发父组件的 send 事件
    - 调用 incrementHitCount API 记录点击
    - _Requirements: 6.1, 6.2, 6.5_
  
  - [x] 9.2 实现 Hot Chips UI ✅
    - 在 `apps/miniprogram/components/hot-chips/index.wxml` 实现模板
    - 显示 3-5 个热词胶囊，支持横向滚动
    - 实现胶囊样式（圆角、背景色、文字）
    - _Requirements: 6.3_
  
  - [x] 9.3 集成 Hot Chips 到首页 ✅
    - 在 `apps/miniprogram/pages/home/index.wxml` 添加 hot-chips 组件
    - 放置在输入框上方
    - 监听 chipclick 事件，调用 sendMessage 函数
    - _Requirements: 6.1, 6.2_

- [x] 10. AI Playground 流程图可视化实现 ✅
  - [x] 10.1 创建流程图数据结构 ✅
    - 在 `apps/admin/src/features/ai-ops/types/flow.ts` 定义 FlowNode, FlowEdge, FlowGraph 接口
    - _Requirements: 10.3_
  
  - [x] 10.2 实现流程图构建器 ✅
    - 在 `apps/admin/src/features/ai-ops/components/flow/utils/flow-builder.ts` 实现 buildFlowGraph 函数
    - 从 AIExecutionLog 构建完整的流程图（Input → Processors → P0 → P1 → LLM → Tools → Output）
    - 支持所有节点类型（input, processor, p0, p1, llm, tool, output）
    - _Requirements: 10.1, 10.3_
  
  - [x] 10.3 实现流程图渲染组件 ✅
    - 在 `apps/admin/src/features/ai-ops/components/flow/flow-graph.tsx` 实现 FlowGraph 组件
    - 使用 @xyflow/react 渲染流程图
    - 使用 Dagre 自动布局
    - 支持节点点击，显示详情抽屉
    - _Requirements: 10.1, 10.2, 10.5_
  
  - [x] 10.4 实现节点详情抽屉 ✅
    - 在 `apps/admin/src/features/ai-ops/components/flow/drawer/drawer-content/processor-drawer.tsx` 实现 Processor 节点详情
    - 显示 Processor 的输入输出数据、配置项、性能指标
    - _Requirements: 1.3, 1.4, 10.2_
  
  - [x] 10.5 实现流式更新 ✅
    - 在 `apps/admin/src/features/ai-ops/components/playground/playground-layout.tsx` 实现实时更新逻辑
    - 监听 AI 执行事件，实时更新流程图节点状态
    - 支持节点状态颜色变化（pending→running→success/error）
    - _Requirements: 10.6_
  
  - [x] 10.6 集成流程图到 AI Playground ✅
    - 在 `apps/admin/src/routes/_authenticated/ai-ops/playground.tsx` 集成 FlowTracePanel 组件
    - 全屏画布模式，流程图占据整个屏幕
    - 支持节点点击显示详情抽屉
    - _Requirements: 10.1_

- [x] 11. 转化追踪实现 ✅
  - [x] 11.1 实现转化追踪逻辑 ✅
    - 在 `apps/api/src/modules/hot-keywords/hot-keywords.service.ts` 完善 trackConversion 函数
    - 查询用户最近 30 分钟内的 AI 响应消息
    - 查找 keywordContext，增加对应热词的 conversionCount
    - _Requirements: 6.5_
  
  - [x] 11.2 集成转化追踪到活动创建流程 ✅
    - 更新 `apps/api/src/modules/activities/activity.service.ts` 的 createActivity 函数
    - 活动创建成功后调用 trackConversion
    - _Requirements: 6.5_
  
  - [x] 11.3 集成转化追踪到活动报名流程 ✅
    - 更新 `apps/api/src/modules/activities/activity.service.ts` 的 joinActivity 函数
    - 报名成功后调用 trackConversion
    - _Requirements: 6.5_

- [x] 12. 文档更新
  - [x] 12.1 更新 PRD 文档
    - 在 `docs/PRD.md` 的 Chat Tool Mode 章节（1.4）更新完整描述
    - 确保包含 Skyline、动态消息、系统通知、半屏交互的完整说明
    - 更新混合通知策略描述
    - 更新版本号和更新日期
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 12.2 更新 TAD 文档
    - 在 `docs/TAD.md` 的 AI 架构章节（6）更新 Processor 架构描述
    - 更新模型路由章节，描述 getModelByIntent() 函数
    - 更新 P0 层热词管理描述
    - 添加 Chat Tool Mode 技术实现章节
    - 更新数据库 Schema 速查表
    - 更新版本号和更新日期
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 13. Checkpoint - 验证核心功能 ✅
  - ✅ Processor 架构：AI Playground 显示所有 Processor 节点
  - ✅ 模型路由：所有 AI 调用使用 getModelByIntent()
  - ✅ P0 层：热词匹配正确，Admin 可以管理热词
  - ✅ Chat Tool Mode：群聊卡片半屏打开，报名后实时更新
  - ✅ 混合通知策略：群内事件发送系统消息，跨群事件发送服务通知
  - ✅ 流程图可视化：AI Playground 显示完整执行链路

## Notes

- 所有任务都是功能实现任务，不包含测试任务
- 每个任务都引用了具体的需求编号，确保可追溯性
- 任务按照数据库 → API → 前端的顺序组织
- Checkpoint 任务确保核心功能在完成后得到验证
- 文档更新任务确保 PRD 和 TAD 与实现保持一致

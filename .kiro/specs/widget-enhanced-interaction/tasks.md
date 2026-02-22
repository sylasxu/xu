# 实现计划：增强型 Generative UI Widget 系统

## 概述

在现有 Widget 系统上增加引用模式（fetchConfig + interaction），当前只增强 explore Widget。改动集中在 API 层协议定义 + Tool 增强 + 小程序端数据获取/操作处理/组件增强。

## 任务

- [x] 0. 文档更新：PRD 和 TAD 写入 Gen UI 架构设计
  - [x] 0.1 更新 `docs/PRD.md` 的 3.3 节「Widget 类型 (Generative UI)」
    - 在现有 Widget 类型表格后新增「Gen UI 数据架构」小节
    - 描述两种数据模式（自包含 vs 引用）、WidgetChunk 扩展字段（fetchConfig、interaction）
    - 描述操作结果卡片（ActionResult with resultPayload）的产品设计
    - 描述端到端数据流：Tool → SSE → Chat Store → Widget 渲染
    - _Requirements: 全局文档规范_

  - [x] 0.2 更新 `docs/TAD.md` 的 6.5 节「工具系统 (Tool System)」
    - 在现有工具类型表格后新增「Widget 协议层」小节
    - 写入 WidgetChunk 扩展接口定义（fetchConfig、interaction）
    - 写入 WidgetDataSource、WidgetActionType、WidgetAction、WidgetFetchConfig、WidgetInteraction 类型定义
    - 写入 ActionResult、ActionResultPayload 类型定义
    - 写入 Widget Data Fetcher 和 Action Handler 的技术设计
    - 写入引用模式阈值切换逻辑（exploreNearby > 5 条）
    - _Requirements: 全局文档规范_

- [x] 1. API 层：Widget 协议和类型定义
  - [x] 1.1 创建 `apps/api/src/modules/ai/tools/widget-protocol.ts`
    - 定义 `WidgetDataSource` 类型（5 个数据源）
    - 定义 `WidgetActionType` 类型（6 个操作类型）
    - 定义 `WidgetAction`、`WidgetFetchConfig`、`WidgetInteraction` 接口
    - 定义对应的 TypeBox Schema（`WidgetFetchConfigSchema`、`WidgetActionSchema`、`WidgetInteractionSchema`）
    - 导出所有类型和 Schema
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 扩展 `apps/api/src/modules/ai/tools/types.ts` 中的 `WidgetChunk` 接口
    - 从 `widget-protocol.ts` 导入 `WidgetFetchConfig` 和 `WidgetInteraction`
    - 在 `WidgetChunk` 接口上新增可选字段 `fetchConfig?: WidgetFetchConfig` 和 `interaction?: WidgetInteraction`
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

- [x] 2. API 层：exploreNearby Tool 引用模式
  - [x] 2.1 修改 `apps/api/src/modules/ai/tools/explore-nearby.ts`
    - 从 `widget-protocol.ts` 导入类型
    - 新增 `REFERENCE_MODE_THRESHOLD = 5` 常量
    - 在 `execute` 函数中增加阈值判断：结果 > 5 条时返回 `fetchConfig`（source: nearby_activities）+ `preview`（total + firstItem）+ `interaction`（swipeable + halfScreenDetail + join/share actions），`explore.results` 为空数组
    - 结果 ≤ 5 条时保持现有返回格式不变
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 3. 检查点 — API 层完成
  - 确认 widget-protocol.ts 类型定义正确
  - 确认 WidgetChunk 扩展向后兼容
  - 确认 exploreNearby 阈值逻辑正确
  - 如有问题请提出

- [x] 4. 小程序层：数据获取和操作处理工具
  - [x] 4.1 创建 `apps/miniprogram/src/utils/widget-fetcher.ts`
    - 定义 `FetchState` 类型和 `FetchResult` 接口
    - 实现 `fetchWidgetData(source, params)` 函数
    - 实现 `nearby_activities` 数据源处理器（调用 `getActivitiesNearby`）
    - 实现 `activity_detail` 数据源处理器（调用 `getActivitiesId`）
    - 处理错误情况（未知数据源、API 失败）
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.2 创建 `apps/miniprogram/src/utils/widget-actions.ts`
    - 定义 `ActionState` 类型和 `ActionResult` 接口
    - 定义 `ActionResultDetail` 和 `ActionResultPayload` 接口
    - 实现 `executeWidgetAction(actionType, params)` 函数
    - 实现 `join` 操作处理器（调用 `postParticipants`），成功时返回 `resultPayload`（含活动名称、时间、地点 + "查看活动详情" nextAction）
    - 处理错误情况（未知操作类型、API 失败）
    - _Requirements: 5.1, 5.4, 5.6, 7.1, 7.4_

- [x] 5. 小程序层：Chat Store 修改
  - [x] 5.1 修改 `apps/miniprogram/src/stores/chat.ts` 的 `onToolResult` 回调
    - 在 `widget_explore` 分支中，从 `result.result` 读取 `fetchConfig`、`interaction`、`preview` 字段
    - 将这三个字段作为 `widgetData` 的属性传递给 Widget 组件
    - 不存在时传 null，确保向后兼容
    - _Requirements: 6.1, 6.2_

- [x] 6. 小程序层：半屏详情组件
  - [x] 6.1 创建 `apps/miniprogram/components/half-screen-detail/` 组件
    - 创建 index.ts、index.wxml、index.less、index.json 四个文件
    - Properties: `visible`（Boolean）、`activityId`（String）
    - 当 visible=true 且 activityId 有值时，通过 `fetchWidgetData('activity_detail', { id })` 获取详情
    - 渲染活动标题、描述、时间、地点、参与人数
    - 底部固定操作栏（报名/分享按钮，使用 `executeWidgetAction`）
    - 从底部滑入动画，覆盖 ~70% 屏幕，点击遮罩或下滑关闭
    - 加载失败降级：关闭半屏，跳转详情页
    - _Requirements: 4.3, 5.1, 5.2, 5.3_

- [x] 7. 小程序层：增强 Explore Widget
  - [x] 7.1 修改 `apps/miniprogram/components/widget-explore/index.ts`
    - 新增 properties: `fetchConfig`、`interaction`、`preview`
    - 新增 data: `fetchState`、`fetchedResults`、`swiperMode`、`activeIndex`、`actionStates`、`halfScreenVisible`、`halfScreenActivityId`、`actionResults`（存储 resultPayload）
    - 实现引用模式逻辑：有 fetchConfig 时调用 `fetchWidgetData` 获取数据，先显示 preview
    - 实现 Swiper 模式切换：根据 `interaction.swipeable` 设置 `swiperMode`
    - 实现半屏详情触发：根据 `interaction.halfScreenDetail` 决定点击行为
    - 实现卡内操作按钮：根据 `interaction.actions` 渲染按钮，调用 `executeWidgetAction`
    - 实现操作按钮状态管理：idle → loading → success/idle
    - 实现操作结果卡片渲染：当 `ActionResult.resultPayload` 存在时，在按钮下方渲染结构化结果卡片（title、summary、details 列表、nextAction 按钮）
    - 保持无 fetchConfig 时的现有行为完全不变
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.4, 5.5, 7.2, 7.3, 7.5_

  - [x] 7.2 修改 `apps/miniprogram/components/widget-explore/index.wxml`
    - 新增 Swiper 模式模板（`wx:if="{{swiperMode}}"`）：使用 `<swiper>` 组件水平展示活动卡片
    - 新增引用模式加载状态：骨架屏 / preview 预览
    - 新增卡内操作按钮渲染（根据 interaction.actions）
    - 新增操作结果卡片模板：当 `actionResults[activityId]` 存在时，渲染 title、summary、details 列表和 nextAction 按钮
    - 新增半屏详情组件引用（`<half-screen-detail>`）
    - 保持现有垂直列表模板不变（`wx:else`）
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 7.2, 7.5_

  - [x] 7.3 修改 `apps/miniprogram/components/widget-explore/index.less`
    - 新增 Swiper 模式样式（卡片宽度、间距、指示器）
    - 新增操作按钮样式（idle、loading、success 三种状态）
    - 新增操作结果卡片样式（圆角卡片、title/summary 排版、details 列表、nextAction 按钮）
    - 新增骨架屏/加载状态样式
    - 使用 Design Token，禁止魔法数字
    - _Requirements: 4.1, 4.4, 4.5, 7.2_

  - [x] 7.4 修改 `apps/miniprogram/components/widget-explore/index.json`
    - 注册 `half-screen-detail` 组件依赖
    - _Requirements: 4.3_

- [x] 8. 小程序层：页面集成
  - [x] 8.1 修改 `apps/miniprogram/pages/home/index.wxml`
    - 在 `<widget-explore>` 标签上新增 `fetchConfig`、`interaction`、`preview` 三个 property 绑定
    - _Requirements: 4.5, 4.6_

  - [x] 8.2 修改 `apps/miniprogram/pages/home/index.json`
    - 注册 `half-screen-detail` 组件（如果在 home 页面级别需要）
    - _Requirements: 4.3_

- [x] 9. 最终检查点
  - 确认所有文件修改完成
  - 确认自包含模式（结果 ≤ 5 条）行为不变
  - 确认引用模式（结果 > 5 条）完整流程：preview → 加载 → Swiper 渲染 → 卡内操作
  - 确认半屏详情弹出和降级逻辑
  - 如有问题请提出

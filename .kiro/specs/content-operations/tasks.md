# 实现计划：自媒体内容运营中心

## 概述

在现有 growth 模块基础上扩展，新增小红书笔记 AI 生成、内容库管理、效果数据回填与分析功能。技术栈：Drizzle ORM + ElysiaJS + React 19 + Eden Treaty + Qwen AI。

## 任务

- [x] 1. 数据库层：新增 content_notes 表
  - [x] 1.1 创建 `packages/db/src/schema/content-notes.ts`，定义 `contentTypeEnum` 和 `content_notes` 表（含笔记内容字段和效果数据字段），导出 `insertContentNoteSchema`、`selectContentNoteSchema`、`ContentNote` 类型
    - _Requirements: 1.7, 2.3, 4.2_
  - [x] 1.2 在 `packages/db/src/schema/index.ts` 中添加 `export * from "./content-notes"` 导出
    - _Requirements: 1.7_
  - [x] 1.3 执行 `bun run db:push` 同步 Schema 到数据库
    - _Requirements: 1.7_

- [x] 2. API Model 层：定义 TypeBox Schema
  - [x] 2.1 创建 `apps/api/src/modules/growth/content.model.ts`，定义请求/响应 Schema（GenerateRequest、PerformanceUpdateRequest、LibraryQuery、AnalyticsResponse），响应 Schema 从 `@juchang/db` 的 `selectContentNoteSchema` 派生，注册为 Elysia model plugin
    - _Requirements: 10.1, 10.2, 10.5, 10.6_

- [x] 3. API Service 层：核心业务逻辑
  - [x] 3.1 创建 `apps/api/src/modules/growth/content.service.ts`，实现 `generateNotes` 纯函数：通过 `getConfigValue` 读取 Prompt 模板，调用 `generateObject`（Qwen 模型 + NoteOutputSchema）生成笔记，支持批量生成（循环生成 count 篇，每篇传入已生成标题避免重复），生成后批量入库（共享 batchId）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 8.1, 8.2_
  - [x] 3.2 在 `content.service.ts` 中实现 `getTopPerformingNotes` 纯函数：查询已回填效果数据的笔记，按综合互动指标排序返回前 N 条，供 AI 优化生成时作为参考
    - _Requirements: 6.1, 6.2_
  - [x] 3.3 在 `content.service.ts` 中实现 AI 优化逻辑：`generateNotes` 内部调用 `getTopPerformingNotes`，当已回填记录 ≥ 3 条时将高表现笔记标题和风格特征注入 Prompt，否则使用默认模板
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 3.4 在 `content.service.ts` 中实现 `getLibrary` 纯函数：支持分页（page/limit）、内容类型筛选、关键词搜索（topic 或 body 模糊匹配），按 createdAt 降序返回
    - _Requirements: 3.1, 3.2, 3.3, 10.2_
  - [x] 3.5 在 `content.service.ts` 中实现 `getNoteById`、`deleteNote`、`updatePerformance` 纯函数
    - _Requirements: 3.4, 3.5, 4.2, 4.3, 10.3, 10.4, 10.5_
  - [x] 3.6 在 `content.service.ts` 中实现 `getAnalytics` 纯函数：按内容类型聚合平均浏览量/点赞数/收藏数，生成排行榜（≥5 条已回填记录时按综合互动指标排序）
    - _Requirements: 5.1, 5.2, 5.3, 10.6_

- [x] 4. API Controller 层：路由注册
  - [x] 4.1 创建 `apps/api/src/modules/growth/content.controller.ts`，注册 6 个端点（POST generate、GET library、GET library/:id、DELETE library/:id、PUT library/:id/performance、GET analytics），所有端点需 verifyAuth 认证，使用 content.model 的 Schema 定义 body/query/response
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - [x] 4.2 在 `apps/api/src/modules/growth/growth.controller.ts` 中挂载 content controller（`.use(contentController)`），确保路由前缀为 `/growth/content/*`
    - _Requirements: 10.1_

- [x] 5. Checkpoint - 确保 API 层完整可用
  - 确保所有 API 端点可正常调用，数据库读写正常，ask the user if questions arise.

- [x] 6. Admin 前端：数据层与 Hooks
  - [x] 6.1 创建 `apps/admin/src/features/content-ops/data/schema.ts`，定义前端类型接口（ContentNote、GenerateRequest、PerformanceUpdate、ContentFilters、AnalyticsData）
    - _Requirements: 1.1, 4.1, 5.1_
  - [x] 6.2 创建 `apps/admin/src/features/content-ops/hooks/use-content.ts`，实现 Eden Treaty hooks：`useGenerateNotes`（POST generate）、`useContentLibrary`（GET library 带分页筛选）、`useContentDetail`（GET library/:id）、`useDeleteNote`（DELETE）、`useUpdatePerformance`（PUT performance）、`useContentAnalytics`（GET analytics）
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 7. Admin 前端：内容生成页
  - [x] 7.1 创建 `apps/admin/src/features/content-ops/components/content-generate.tsx`，实现内容生成页面：主题输入框、内容类型选择、生成数量选择（1-5）、热门关键词推荐列表（调用现有 GET /growth/trends）、点击关键词自动填入、生成按钮、生成结果展示（每篇笔记卡片含标题/正文预览/标签）
    - _Requirements: 1.1, 2.1, 9.1, 9.2, 9.3_
  - [x] 7.2 在生成结果卡片中实现一键复制功能：标题复制、正文复制、话题标签复制（"#标签1 #标签2" 格式）、全文复制（标题+正文+标签组合），使用 `navigator.clipboard.writeText` + toast 成功提示
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 8. Admin 前端：内容库页
  - [x] 8.1 创建 `apps/admin/src/features/content-ops/components/content-library.tsx`，实现内容库列表页面：表格展示（标题、内容类型、浏览量、点赞数、创建时间）、内容类型筛选下拉、关键词搜索框、分页控件、删除操作
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.4_
  - [x] 8.2 创建 `apps/admin/src/features/content-ops/components/content-detail.tsx`，实现笔记详情页面：完整展示标题、正文、话题标签、封面图片描述提示、效果数据，含一键复制按钮
    - _Requirements: 3.4, 7.1, 7.2, 7.3, 7.4_
  - [x] 8.3 创建 `apps/admin/src/features/content-ops/components/performance-form.tsx`，实现效果数据回填表单：浏览量、点赞数、收藏数、评论数、涨粉数输入框，支持新增和更新
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 9. Admin 前端：效果分析页
  - [x] 9.1 创建 `apps/admin/src/features/content-ops/components/content-analytics.tsx`，实现效果分析页面：按内容类型的平均指标卡片、内容表现排行榜表格、总笔记数和已回填数统计
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 10. Admin 路由注册与导航
  - [x] 10.1 创建 `apps/admin/src/features/content-ops/index.tsx` 导出所有组件
    - _Requirements: 全部前端需求_
  - [x] 10.2 创建 Admin 路由文件：`apps/admin/src/routes/_authenticated/growth/content.tsx`（内容生成）、`library.tsx`（内容库）、`analytics.tsx`（效果分析），注册到 TanStack Router
    - _Requirements: 全部前端需求_
  - [x] 10.3 在 Admin 侧边栏导航中添加"内容运营"菜单项，包含"内容生成"、"内容库"、"效果分析"三个子菜单
    - _Requirements: 全部前端需求_

- [x] 11. Prompt 模板初始化
  - [x] 11.1 在 `content.service.ts` 中定义默认 Prompt 模板常量（包含品牌调性"搭子观察员"、小红书平台规则、输出格式要求），作为 `getConfigValue` 的 fallback 默认值
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 12. 最终 Checkpoint
  - 确保所有功能端到端可用，ask the user if questions arise.

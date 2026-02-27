# Implementation Plan: API Refactor

## Overview

按优先级渐进式重构：P0 安全加固 → P1 命名规范 → P2 响应格式统一 → P3 Schema 派生修复 → 前端适配。每个阶段完成后确保 API 可正常运行。

## Tasks

- [x] 1. P0 安全：创建 `verifyAdmin` 中间件和统一响应工具
  - [x] 1.1 在 `apps/api/src/setup.ts` 中新增 `verifyAdmin` 函数和 `AuthError` 类
    - `verifyAdmin` 验证 JWT + admin 角色，失败抛出 `AuthError`
    - `AuthError` 包含 `status` (401/403) 和 `message` 字段
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 1.2 新建 `apps/api/src/lib/response.ts`，定义统一响应 Schema 工厂
    - `ListResponseSchema(itemSchema)` → `{ items, total }`
    - `ErrorResponseSchema` → `{ code, msg }`
    - `SuccessResponseSchema` → `{ success, msg }`
    - `CreateSuccessResponseSchema` → `{ success, msg, id }`
    - `BatchSuccessResponseSchema` → `{ success, msg, count }`
    - _Requirements: 7.1, 8.1, 8.2, 8.3, 8.4, 9.1_

- [x] 2. P0 安全：Dashboard 模块权限加固
  - [x] 2.1 在 `dashboard.controller.ts` 顶层添加 `onBeforeHandle` 调用 `verifyAdmin`
    - 所有 Dashboard 路由自动受保护
    - 未认证返回 401，非 admin 返回 403
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. P0 安全：AI 模块拆分与权限加固
  - [x] 3.1 从 `ai.controller.ts` 提取 sessions 路由到 `ai-sessions.controller.ts`
    - 包含 GET /sessions, GET /sessions/:id, PATCH /sessions/:id/evaluate, DELETE /sessions/:id, POST /sessions/batch-delete
    - 顶层添加 `verifyAdmin` guard
    - _Requirements: 3.1, 18.1, 18.4_
  - [x] 3.2 从 `ai.controller.ts` 提取 RAG 路由到 `ai-rag.controller.ts`
    - 包含 GET /rag/stats, POST /rag/search, POST /rag/rebuild/:id, POST /rag/backfill, GET /rag/backfill/status
    - 顶层添加 `verifyAdmin` guard
    - _Requirements: 3.3, 18.1, 18.4_
  - [x] 3.3 从 `ai.controller.ts` 提取 Memory 路由到 `ai-memory.controller.ts`
    - 包含 GET /memory/users, GET /memory/:userId, POST /memory/:userId/maxsim
    - 顶层添加 `verifyAdmin` guard
    - _Requirements: 3.3, 18.1, 18.4_
  - [x] 3.4 从 `ai.controller.ts` 提取 Security 路由到 `ai-security.controller.ts`
    - 包含所有 /security/* 路由（overview, sensitive-words, moderation, violations）
    - 顶层添加 `verifyAdmin` guard
    - _Requirements: 3.3, 18.1, 18.4_
  - [x] 3.5 从 `ai.controller.ts` 提取 Ops 路由到 `ai-ops.controller.ts`
    - 包含 /ops/metrics/*, /ops/security/* 路由
    - 删除与 ai-security.controller.ts 重复的路由
    - 顶层添加 `verifyAdmin` guard
    - _Requirements: 3.3, 17.1, 17.2, 18.1, 18.4_
  - [x] 3.6 瘦身 `ai.controller.ts`，只保留用户端路由并挂载子 controller
    - 保留 /ai/chat, /ai/welcome, /ai/conversations, /ai/balance, /ai/metrics/usage, /ai/prompts/current
    - 对 /ai/balance, /ai/metrics/usage, /ai/prompts/current 添加 `verifyAdmin` guard
    - 通过 `.use()` 挂载 5 个子 controller
    - _Requirements: 3.2, 18.2, 18.3_

- [x] 4. P0 安全：Reports 模块权限加固
  - [x] 4.1 在 `report.controller.ts` 中对 GET / (列表)、GET /:id (详情)、PATCH /:id (更新) 添加 `verifyAdmin` guard
    - 保持 POST / (用户提交举报) 使用 `verifyAuth`
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 5. P0 安全：Users 模块权限加固
  - [x] 5.1 在 `user.controller.ts` 中对所有路由添加 `verifyAdmin` guard
    - GET /, GET /:id, PUT /:id, DELETE /:id, GET /:id/quota, PUT /:id/quota, POST /quota/batch, GET /:id/ai-profile
    - _Requirements: 15.1, 15.2, 15.3_

- [x] 6. P0 安全：Notifications 模块条件权限加固
  - [x] 6.1 在 `notification.controller.ts` 的 GET / handler 中，当 scope=all 或 userId 参数存在时调用 `verifyAdmin`
    - scope=mine（默认）保持 `verifyAuth`
    - _Requirements: 16.1, 16.2_

- [x] 7. Checkpoint - P0 安全加固完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. P1 命名：URL 路径 kebab-case 修正
  - [x] 8.1 在 `dashboard.controller.ts` 中将 `/userGrowth` 改为 `/user-growth`，`/activityTypes` 改为 `/activity-types`
    - _Requirements: 5.1, 5.2_
  - [x] 8.2 在 `ai-sessions.controller.ts` 中将 `/batchDelete` 改为 `/batch-delete`（已在拆分时完成，验证即可）
    - _Requirements: 5.3_
  - [x] 8.3 在 `notification.controller.ts` 中将 `/unreadCount` 改为 `/unread-count`
    - _Requirements: 5.4_

- [x] 9. P1 命名：Hot-Keywords Admin 路径规范化
  - [x] 9.1 在 `hot-keywords.controller.ts` 中重构 Admin 路由
    - 将 `GET /admin` 改为 `GET /all`
    - 将 `POST /admin` 改为 `POST /`
    - 将 `PATCH /admin/:id` 改为 `PATCH /:id`
    - 将 `DELETE /admin/:id` 改为 `DELETE /:id`
    - 将 `GET /admin/analytics` 改为 `GET /analytics`
    - 对所有 Admin 路由使用 Elysia `.guard()` 包裹 `verifyAdmin`
    - 保持 `GET /` 为公开接口
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 10. Checkpoint - P1 命名规范完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. P2 响应格式：统一列表响应
  - [x] 11.1 修改 `hot-keywords.controller.ts` 和 `hot-keywords.model.ts`，将 `{ data: [...] }` 改为 `{ items: [...], total }` 格式
    - 更新 HotKeywordsResponse、AdminHotKeywordsResponse、CreateKeywordResponse、UpdateKeywordResponse
    - _Requirements: 7.1, 7.4_
  - [x] 11.2 修改 `ai-sessions.controller.ts`，将 sessions 列表响应统一为 `{ items, total }` 格式
    - 移除 `{ sessions: [...] }` 包装
    - _Requirements: 7.1, 7.4_
  - [x] 11.3 修改 `ai.controller.ts` 中 conversations 列表响应，统一为 `{ items, total }` 格式
    - 移除 `{ sessions: [...] }` 包装
    - _Requirements: 7.1, 7.4_
  - [x] 11.4 修改 `report.controller.ts` 和 `report.model.ts`，确保列表响应为 `{ items, total }` 格式
    - _Requirements: 7.1_
  - [x] 11.5 修改 `notification.controller.ts` 和 `notification.model.ts`，确保列表响应为 `{ items, total }` 格式
    - _Requirements: 7.1_

- [x] 12. P2 响应格式：统一操作成功和错误响应
  - [x] 12.1 修改各 controller 中的 create 操作响应为 `{ success: true, msg, id }`
    - hot-keywords create、report create 等
    - _Requirements: 8.1_
  - [x] 12.2 修改各 controller 中的 delete 操作响应为 `{ success: true, msg }`
    - 确保所有 delete 返回统一格式
    - _Requirements: 8.3_
  - [x] 12.3 修改各 controller 中的 batch 操作响应为 `{ success: true, msg, count }`
    - ai sessions batch-delete、users quota/batch 等
    - _Requirements: 8.4_
  - [x] 12.4 审查所有 controller 的错误响应，确保统一使用 `{ code, msg }` 格式
    - 移除不一致的错误格式（如 `{ error: "..." }`）
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 13. Checkpoint - P2 响应格式统一完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. P3 Schema 派生：Dashboard Model 修复
  - [x] 14.1 修改 `dashboard.model.ts`，将 RecentActivity 中的 DB 字段改为从 `@juchang/db` 派生
    - 使用 `t.Pick(selectActivitySchema, ['id', 'title', 'status'])` + `t.Composite` 扩展聚合字段
    - 保持 DashboardStats、MetricItem、BenchmarkStatus、GodViewData 等聚合类型手动定义
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 15. P3 Schema 派生：AI Model Schema 提取
  - [x] 15.1 将 `ai.controller.ts` 和子 controller 中的内联 `t.Object(...)` Schema 提取到 `ai.model.ts`
    - 会话列表项 Schema 从 `selectConversationSchema` 派生
    - 消息 Schema 从 `selectMessageSchema` 派生
    - 保持 RAG stats、Security overview 等 AI 特有聚合类型手动定义
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 16. Checkpoint - P3 Schema 派生修复完成
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. 前端适配：Admin Eden Treaty 更新
  - [x] 17.1 更新 `apps/admin/src/hooks/use-dashboard.ts` 中的 API 调用路径
    - `api.dashboard.userGrowth` → `api.dashboard['user-growth']`
    - `api.dashboard.activityTypes` → `api.dashboard['activity-types']`
    - _Requirements: 13.1_
  - [x] 17.2 更新 `apps/admin/src/hooks/use-conversations.ts` 中的 API 调用路径
    - sessions batchDelete → batch-delete
    - _Requirements: 13.1_
  - [x] 17.3 更新 Admin hooks 中的列表数据解析逻辑
    - 将 `response.data` 或 `response.sessions` 改为 `response.items`
    - _Requirements: 13.2_
  - [x] 17.4 更新 Hot-Keywords 相关 hooks 的 API 调用路径
    - `/hot-keywords/admin` → `/hot-keywords/all`
    - `/hot-keywords/admin/:id` → `/hot-keywords/:id`
    - `/hot-keywords/admin/analytics` → `/hot-keywords/analytics`
    - _Requirements: 13.1_
  - [x] 17.5 更新 Notifications 相关 hooks 的 API 调用路径
    - `unreadCount` → `unread-count`
    - _Requirements: 13.1_

- [x] 18. 前端适配：小程序 Orval SDK 重新生成
  - [x] 18.1 运行 `bun run gen:api` 重新生成小程序 Orval SDK
    - 验证小程序端使用的接口（`GET /hot-keywords`, `POST /reports`, `GET /activities/*`）仍正常
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 19. Final checkpoint - 全部重构完成
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 按 P0 → P1 → P2 → P3 顺序执行，每个阶段有 checkpoint
- 不引入 `/admin` 路径前缀，保持按领域组织路由
- AI controller 拆分为 5 个子 controller，通过 `.use()` 挂载
- Service 层纯函数不需要修改，只改 controller 层路由和 model 层 Schema
- 前端适配在 API 变更后同步进行

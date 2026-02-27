# Requirements Document

## Introduction

聚场 (JuChang) API 层经过多个版本迭代，积累了安全漏洞、命名不一致、响应格式混乱、Schema 手动定义等技术债务。本次重构旨在系统性地修复这些问题，提升 API 的安全性、一致性和可维护性。重构按优先级分为 P0（安全）、P1（命名规范）、P2（响应结构）、P3（Schema 派生）四个层级。

## Glossary

- **API_Gateway**: 聚场 ElysiaJS API 服务，作为所有客户端请求的统一入口
- **Admin_Endpoint**: 仅供管理后台 (Admin SPA) 调用的接口，需要管理员权限验证
- **Public_Endpoint**: 无需认证即可访问的接口（如活动详情、附近搜索）
- **Auth_Middleware**: 基于 JWT 的认证中间件，验证请求者身份和权限
- **verifyAdmin**: 统一的 Admin 权限验证中间件，验证请求者具有管理员角色
- **Response_Envelope**: 统一的 API 响应格式结构
- **Schema_Derivation**: 从 `@juchang/db` 的 Drizzle Schema 派生 TypeBox Schema 的模式
- **kebab-case**: URL 路径命名规范，单词间用连字符连接（如 `user-growth`）
- **camelCase**: 当前部分 URL 使用的命名方式（如 `userGrowth`），需要修正

## Requirements

### Requirement 1: Admin 权限验证中间件

**User Story:** As a 系统管理员, I want 所有 Admin 接口都经过统一的权限验证, so that 未授权用户无法访问管理功能，消除安全漏洞。

#### Acceptance Criteria

1. THE API_Gateway SHALL provide a reusable `verifyAdmin` middleware that validates both JWT authentication and admin role
2. WHEN a request reaches an Admin_Endpoint without a valid JWT token, THEN THE API_Gateway SHALL return HTTP 401 with `{ code: 401, msg: "未授权" }`
3. WHEN a request reaches an Admin_Endpoint with a valid JWT but non-admin role, THEN THE API_Gateway SHALL return HTTP 403 with `{ code: 403, msg: "无管理员权限" }`
4. WHEN the `verifyAdmin` middleware is applied, THE API_Gateway SHALL extract the user identity and make it available to the route handler

### Requirement 2: Dashboard 模块 Admin 权限加固

**User Story:** As a 系统管理员, I want Dashboard 所有接口都需要 Admin 权限验证, so that 平台运营数据不会被未授权用户访问。

#### Acceptance Criteria

1. WHEN a request reaches any Dashboard endpoint (`/dashboard/*`), THE API_Gateway SHALL verify the requester has admin privileges using `verifyAdmin` middleware
2. WHEN an unauthenticated user requests Dashboard data, THEN THE API_Gateway SHALL reject the request with HTTP 401
3. WHEN a non-admin user requests Dashboard data, THEN THE API_Gateway SHALL reject the request with HTTP 403

### Requirement 3: AI 模块 Admin 接口权限加固

**User Story:** As a 系统管理员, I want AI 模块中所有 Admin 专用接口都需要权限验证, so that AI 运营数据和操作不会被未授权用户访问。

#### Acceptance Criteria

1. WHEN a request reaches AI sessions endpoints (`/ai/sessions`, `/ai/sessions/:id`, `/ai/sessions/:id/evaluate`, `/ai/sessions/batch-delete`), THE API_Gateway SHALL verify admin privileges using `verifyAdmin` middleware
2. WHEN a request reaches AI metrics endpoints (`/ai/metrics/usage`, `/ai/prompts/current`, `/ai/balance`), THE API_Gateway SHALL verify admin privileges using `verifyAdmin` middleware
3. WHEN a request reaches AI Ops endpoints (`/ai/rag/*`, `/ai/memory/*`, `/ai/security/*`, `/ai/ops/*`), THE API_Gateway SHALL verify admin privileges using `verifyAdmin` middleware
4. IF an unauthenticated or non-admin user requests any AI Admin endpoint, THEN THE API_Gateway SHALL reject the request with the appropriate HTTP status code (401 or 403)

### Requirement 4: Reports 模块 Admin 权限加固

**User Story:** As a 系统管理员, I want Reports 列表和详情接口需要 Admin 权限验证, so that 举报数据不会被普通用户访问。

#### Acceptance Criteria

1. WHEN a request reaches `GET /reports` (列表) or `GET /reports/:id` (详情), THE API_Gateway SHALL verify admin privileges using `verifyAdmin` middleware
2. WHEN an unauthenticated user requests report list or detail, THEN THE API_Gateway SHALL reject the request with HTTP 401
3. WHEN a non-admin user requests report list or detail, THEN THE API_Gateway SHALL reject the request with HTTP 403

### Requirement 5: URL 路径 kebab-case 统一

**User Story:** As a 开发者, I want 所有 URL 路径统一使用 kebab-case 命名, so that API 命名风格一致，符合 RESTful 最佳实践。

> 设计决策：URL 路径使用 kebab-case 是 RESTful API 业界公认的最佳实践（Google API Design Guide、GitHub API、Stripe API 均采用）。原因：URL 在 RFC 7230 中建议大小写不敏感，kebab-case 避免了大小写歧义。项目中大部分路径已是 kebab-case（`/hot-keywords`、`/intent-metrics`、`/content-security`），仅少数遗留 camelCase 需修正。

#### Acceptance Criteria

1. THE API_Gateway SHALL rename `GET /dashboard/userGrowth` to `GET /dashboard/user-growth`
2. THE API_Gateway SHALL rename `GET /dashboard/activityTypes` to `GET /dashboard/activity-types`
3. THE API_Gateway SHALL rename `POST /ai/sessions/batchDelete` to `POST /ai/sessions/batch-delete`
4. THE API_Gateway SHALL rename `GET /notifications/unreadCount` to `GET /notifications/unread-count`
5. WHEN a client requests a renamed endpoint using the old camelCase path, THE API_Gateway SHALL return HTTP 404 (no backward compatibility aliases)

### Requirement 6: Hot-Keywords Admin 路径规范化

**User Story:** As a 开发者, I want Hot-Keywords Admin 接口去除路径中的 `admin` 段, so that 路径按领域组织而非按客户端类型组织。

#### Acceptance Criteria

1. THE API_Gateway SHALL change `GET /hot-keywords/admin` to `GET /hot-keywords/all` for admin listing
2. THE API_Gateway SHALL change `POST /hot-keywords/admin` to `POST /hot-keywords` for creating keywords
3. THE API_Gateway SHALL change `PATCH /hot-keywords/admin/:id` to `PATCH /hot-keywords/:id` for updating keywords
4. THE API_Gateway SHALL change `DELETE /hot-keywords/admin/:id` to `DELETE /hot-keywords/:id` for deleting keywords
5. THE API_Gateway SHALL change `GET /hot-keywords/admin/analytics` to `GET /hot-keywords/analytics` for analytics
6. THE API_Gateway SHALL protect all admin hot-keywords routes with `verifyAdmin` middleware
7. THE API_Gateway SHALL keep `GET /hot-keywords` as a public endpoint for miniprogram

### Requirement 7: 统一列表响应格式

**User Story:** As a 开发者, I want 所有列表接口返回统一的分页结构, so that 前端可以用统一的逻辑处理分页数据。

#### Acceptance Criteria

1. THE API_Gateway SHALL return all list endpoints with the structure `{ items: [...], total: number }`
2. WHEN a list endpoint supports cursor-based pagination, THE API_Gateway SHALL include `hasMore: boolean` and `cursor: string | null` fields
3. WHEN a list endpoint supports offset-based pagination, THE API_Gateway SHALL accept `page` and `limit` query parameters
4. THE API_Gateway SHALL remove inconsistent wrapper patterns (e.g., `{ data: [...] }`, `{ sessions: [...] }`, bare arrays)

### Requirement 8: 统一操作成功响应格式

**User Story:** As a 开发者, I want 所有写操作接口返回统一的成功响应格式, so that 前端可以用统一的逻辑处理操作结果。

#### Acceptance Criteria

1. WHEN a create operation succeeds, THE API_Gateway SHALL return `{ success: true, msg: "...", id: "..." }` with the created resource ID
2. WHEN an update operation succeeds, THE API_Gateway SHALL return the updated resource object directly
3. WHEN a delete operation succeeds, THE API_Gateway SHALL return `{ success: true, msg: "..." }`
4. WHEN a batch operation succeeds, THE API_Gateway SHALL return `{ success: true, msg: "...", count: number }` with the affected count

### Requirement 9: 统一错误响应格式

**User Story:** As a 开发者, I want 所有错误响应使用统一的格式, so that 前端可以用统一的逻辑处理错误。

#### Acceptance Criteria

1. THE API_Gateway SHALL return all error responses with the structure `{ code: number, msg: string }`
2. WHEN a resource is not found, THE API_Gateway SHALL return HTTP 404 with `{ code: 404, msg: "..." }`
3. WHEN request validation fails, THE API_Gateway SHALL return HTTP 400 with `{ code: 400, msg: "..." }`
4. WHEN authentication fails, THE API_Gateway SHALL return HTTP 401 with `{ code: 401, msg: "未授权" }`
5. WHEN authorization fails, THE API_Gateway SHALL return HTTP 403 with `{ code: 403, msg: "无管理员权限" }`

### Requirement 10: Dashboard Model Schema 派生修复

**User Story:** As a 开发者, I want Dashboard model 中可从 DB 派生的 Schema 使用 `@juchang/db` 派生, so that 消除手动重复定义，保持 Single Source of Truth。

#### Acceptance Criteria

1. WHEN the Dashboard model defines schemas that reference DB table fields (e.g., activity id, title, status, user nickname), THE API_Gateway SHALL derive those fields from `@juchang/db` select schemas using `t.Pick`
2. THE API_Gateway SHALL keep manually defined schemas for aggregation types that have no corresponding DB table (e.g., MetricItem, BenchmarkStatus, GodViewData)
3. WHEN a schema field corresponds to a DB column, THE API_Gateway SHALL use the DB-derived type instead of manually defining `t.String()` or `t.Number()`

### Requirement 11: Hot-Keywords Model Schema 派生修复

**User Story:** As a 开发者, I want Hot-Keywords model 中的 Schema 使用 `@juchang/db` 派生, so that 消除手动重复定义。

#### Acceptance Criteria

1. WHEN the Hot-Keywords model defines schemas that reference the hot_keywords DB table fields, THE API_Gateway SHALL derive those fields from `@juchang/db` select/insert schemas
2. THE API_Gateway SHALL keep manually defined schemas for query parameters and analytics types that have no corresponding DB columns

### Requirement 12: AI Controller 内联 Schema 清理

**User Story:** As a 开发者, I want AI controller 中大量内联定义的 TypeBox Schema 提取到 model 文件并尽可能从 DB 派生, so that 代码更整洁且符合项目规范。

#### Acceptance Criteria

1. THE API_Gateway SHALL extract all inline `t.Object(...)` schema definitions from `ai.controller.ts` into `ai.model.ts`
2. WHEN an inline schema references DB table fields (e.g., conversation id, userId, messageType), THE API_Gateway SHALL derive those fields from `@juchang/db` select schemas
3. THE API_Gateway SHALL keep manually defined schemas for AI-specific aggregation types (e.g., RAG stats, security overview, quality metrics)

### Requirement 13: Admin 前端适配

**User Story:** As a 前端开发者, I want Admin 前端代码同步更新以匹配新的 API 路径和响应格式, so that Admin 管理后台在重构后正常工作。

#### Acceptance Criteria

1. WHEN API paths are changed (kebab-case, hot-keywords path normalization), THE Admin frontend SHALL update all Eden Treaty API calls to use the new paths
2. WHEN response formats are unified, THE Admin frontend SHALL update data parsing logic to match the new `{ items, total }` list format
3. WHEN the Admin frontend uses Eden Treaty, THE Admin frontend SHALL regenerate type definitions after API changes

### Requirement 14: 小程序 SDK 适配

**User Story:** As a 前端开发者, I want 小程序 Orval SDK 同步更新以匹配新的 API 路径和响应格式, so that 小程序在重构后正常工作。

#### Acceptance Criteria

1. WHEN API paths are changed, THE Miniprogram SHALL regenerate Orval SDK using `bun run gen:api`
2. WHEN response formats are unified, THE Miniprogram SHALL update data parsing logic to match the new list format
3. WHEN user-facing endpoints remain unchanged (e.g., `GET /hot-keywords`, `POST /reports`), THE Miniprogram SHALL verify these endpoints still work correctly

### Requirement 15: Users 模块 Admin 接口权限加固

**User Story:** As a 系统管理员, I want Users 模块中的 Admin 操作（额度设置、用户列表、AI 画像）需要权限验证, so that 用户管理操作受到保护。

#### Acceptance Criteria

1. WHEN a request reaches user admin endpoints (`GET /users`, `PUT /users/:id/quota`, `POST /users/quota/batch`, `GET /users/:id/ai-profile`, `DELETE /users/:id`), THE API_Gateway SHALL verify admin privileges using `verifyAdmin` middleware
2. WHEN an unauthenticated user requests user admin endpoints, THEN THE API_Gateway SHALL reject the request with HTTP 401
3. WHEN a non-admin user requests user admin endpoints, THEN THE API_Gateway SHALL reject the request with HTTP 403

### Requirement 16: Notifications 模块 Admin 权限加固

**User Story:** As a 系统管理员, I want Notifications 模块中 scope=all 和 userId 查询需要 Admin 权限验证, so that 其他用户的通知数据不会被未授权访问。

#### Acceptance Criteria

1. WHEN a request to `GET /notifications` includes `scope=all` or `userId` parameter, THE API_Gateway SHALL verify admin privileges using `verifyAdmin` middleware
2. WHEN a non-admin user requests notifications with `scope=all`, THEN THE API_Gateway SHALL reject the request with HTTP 403

### Requirement 17: AI Controller 重复路由清理

**User Story:** As a 开发者, I want 清理 AI controller 中重复注册的路由, so that 消除代码冗余和潜在的路由冲突。

#### Acceptance Criteria

1. THE API_Gateway SHALL remove duplicate route registrations in `ai.controller.ts` where the same endpoint is defined both as a standalone route and inside the `/ops` group (e.g., `/security/moderation/queue` and `/ops/security/moderation/queue`)
2. WHEN duplicate routes exist, THE API_Gateway SHALL keep only the `/ai/ops/*` prefixed version and remove the standalone version

### Requirement 18: AI Controller 按子领域拆分

**User Story:** As a 开发者, I want AI controller 按子领域拆分为多个 controller 文件, so that 每个文件职责清晰、体量合理。

#### Acceptance Criteria

1. THE API_Gateway SHALL split `ai.controller.ts` into separate sub-controllers: `ai-sessions.controller.ts`, `ai-rag.controller.ts`, `ai-memory.controller.ts`, `ai-security.controller.ts`, `ai-ops.controller.ts`
2. THE API_Gateway SHALL keep core user-facing routes (`/ai/chat`, `/ai/welcome`, `/ai/conversations`) in `ai.controller.ts`
3. WHEN sub-controllers are created, THE API_Gateway SHALL mount them under the `/ai` prefix via Elysia `.use()` in `ai.controller.ts`
4. WHEN sub-controllers contain admin-only routes, THE API_Gateway SHALL apply `verifyAdmin` guard at the sub-controller level

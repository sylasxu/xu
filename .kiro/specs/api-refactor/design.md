# Design Document: API Refactor

## Overview

本次重构对聚场 API 层进行系统性改进，涵盖安全加固、命名规范化、响应格式统一和 Schema 派生修复四个维度。核心策略是：

1. 创建统一的 `verifyAdmin` 中间件，一次性解决所有 Admin 接口的权限漏洞
2. 创建独立的 `admin.controller.ts` 作为所有 Admin 路由的统一入口，实现 `/admin/*` 前缀
3. 在各模块 controller 中修正 camelCase URL 为 kebab-case
4. 统一响应格式为 `{ items, total }` / `{ success, msg }` / `{ code, msg }`
5. 将 Dashboard model 中可派生的 Schema 改为从 `@juchang/db` 派生
6. 将 AI controller 中的内联 Schema 提取到 model 文件

重构采用渐进式策略：先修安全（P0），再改命名（P1），然后统一格式（P2），最后修 Schema（P3），每一步都同步更新前端。

## Architecture

### 当前架构问题

```
apps/api/src/index.ts
  ├── authController        (/auth/*)         ✅ 正常
  ├── userController        (/users/*)        ❌ Admin 接口无权限验证
  ├── activityController    (/activities/*)   ✅ 正常
  ├── aiController          (/ai/*)           ❌ Admin 接口混在用户接口中，部分无权限
  ├── participantController (/participants/*) ✅ 正常
  ├── chatController        (/chat/*)         ✅ 正常
  ├── dashboardController   (/dashboard/*)    ❌ 全部无权限验证
  ├── notificationController(/notifications/*) ❌ scope=all 无 Admin 验证
  ├── reportController      (/reports/*)      ❌ GET 列表/详情无权限验证
  ├── growthController      (/growth/*)       ✅ 有 verifyAuth
  ├── hotKeywordsController (/hot-keywords/*) ⚠️ Admin 路径不规范
  ├── moderationController  (/moderation/*)   ✅ 有 verifyAuth
  ├── anomalyController     (/anomaly/*)      ✅ 有 verifyAuth
  └── configController      (/ai/config/*)    ✅ 有 verifyAuth
```

### 重构后架构

```
apps/api/src/index.ts
  ├── authController        (/auth/*)              ✅ 不变
  ├── userController        (/users/*)             ✅ 加 verifyAdmin guard
  ├── activityController    (/activities/*)         ✅ 不变
  ├── aiController          (/ai/*)                ✅ Admin 路由加 verifyAdmin
  ├── participantController (/participants/*)       ✅ 不变
  ├── chatController        (/chat/*)              ✅ 不变
  ├── dashboardController   (/dashboard/*)         ✅ 全局 verifyAdmin guard
  ├── notificationController(/notifications/*)      ✅ scope=all 加 Admin 验证
  ├── hotKeywordsController (/hot-keywords/*)       ✅ Admin 路由加 verifyAdmin
  ├── reportController      (/reports/*)            ✅ Admin 路由加 verifyAdmin
  ├── growthController      (/growth/*)             ✅ 不变（已有 verifyAuth）
  ├── moderationController  (/moderation/*)         ✅ 不变
  ├── anomalyController     (/anomaly/*)            ✅ 不变
  └── configController      (/ai/config/*)          ✅ 不变
```

**核心变化**：
- 保持按领域组织，不引入 `/admin` 前缀
- 每个 controller 内部通过 `verifyAdmin` 保护需要管理员权限的路由
- URL 路径只做 kebab-case 修正，不做前缀迁移
- Hot-Keywords Admin 路由从 `/hot-keywords/admin/*` 改为 `/hot-keywords/*`（通过 Elysia guard 区分权限）

### 设计决策

**为什么不用 `/admin` 前缀？**

API 是领域模型的表达，不是前端的附庸。按客户端类型组织路由（`/admin/*`）违反了领域驱动设计原则。正确的做法是：
- 路由按领域组织：`/users`, `/activities`, `/ai`, `/dashboard`
- 权限通过中间件控制：`verifyAdmin` 在需要的路由上加 guard
- 检验标准：换一个前端框架，API 不需要改

**为什么 Dashboard 不需要 `/admin` 前缀？**

Dashboard 本身就是一个领域概念（运营数据聚合），它的所有接口天然需要管理员权限。在 controller 顶层加一个 `verifyAdmin` guard 即可，不需要改路径。

**Hot-Keywords Admin 路由怎么处理？**

当前 `/hot-keywords/admin/*` 的问题不是缺少 `/admin` 前缀，而是路径中嵌入了客户端类型。正确做法：
- `GET /hot-keywords` — 公开接口，小程序获取热词列表
- `GET /hot-keywords/all` — Admin 获取所有热词（需 verifyAdmin）
- `POST /hot-keywords` — Admin 创建热词（需 verifyAdmin）
- `PATCH /hot-keywords/:id` — Admin 更新热词（需 verifyAdmin）
- `DELETE /hot-keywords/:id` — Admin 删除热词（需 verifyAdmin）
- `GET /hot-keywords/analytics` — Admin 获取分析（需 verifyAdmin）

**AI Controller 如何瘦身？**

`ai.controller.ts` 2300+ 行的问题不是因为 Admin 接口混在里面，而是因为所有 AI 子领域（RAG、Memory、Security、Ops）都塞在一个文件里。正确的拆分方式是按 AI 子领域拆分：

```
apps/api/src/modules/ai/
├── ai.controller.ts           # 核心 AI 对话（/ai/chat, /ai/welcome, /ai/conversations）
├── ai-sessions.controller.ts  # 会话管理（/ai/sessions/*）
├── ai-rag.controller.ts       # RAG 运营（/ai/rag/*）
├── ai-memory.controller.ts    # Memory 运营（/ai/memory/*）
├── ai-security.controller.ts  # 安全运营（/ai/security/*）
├── ai-ops.controller.ts       # Ops 指标（/ai/ops/*）
├── ai.service.ts
├── ai-ops.service.ts
├── ai.model.ts
└── ...
```

每个子 controller 内部加 `verifyAdmin` guard，然后在 `index.ts` 中挂载。这样既保持了领域组织，又解决了文件过大的问题。

## Components and Interfaces

### 1. `verifyAdmin` 中间件

```typescript
// apps/api/src/setup.ts - 新增

/**
 * Admin 权限验证中间件
 * 验证 JWT + admin 角色
 */
export async function verifyAdmin(
  jwt: any,
  headers: Record<string, string | undefined>
): Promise<{ id: string; role: string }> {
  const user = await verifyAuth(jwt, headers);
  if (!user) {
    throw new AuthError(401, '未授权');
  }
  if (user.role !== 'admin') {
    throw new AuthError(403, '无管理员权限');
  }
  return user;
}

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
```

### 2. 各 Controller 加 `verifyAdmin` Guard

各模块 controller 在需要管理员权限的路由上使用 `verifyAdmin`：

```typescript
// 方式一：整个 controller 都需要 admin 权限（如 Dashboard）
export const dashboardController = new Elysia({ prefix: '/dashboard' })
  .use(basePlugins)
  .use(dashboardModel)
  .onBeforeHandle(async ({ jwt, headers, set }) => {
    try {
      await verifyAdmin(jwt, headers);
    } catch (error) {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { code: error.status, msg: error.message };
      }
    }
  })
  .get('/stats', dashboardStatsHandler)
  .get('/user-growth', dashboardUserGrowthHandler)  // kebab-case
  // ...

// 方式二：部分路由需要 admin 权限（如 Hot-Keywords）
export const hotKeywordsController = new Elysia({ prefix: '/hot-keywords' })
  .use(basePlugins)
  .use(hotKeywordsModel)
  // 公开接口
  .get('/', getActiveHotKeywordsHandler)
  // Admin 接口（通过 guard 保护）
  .guard(
    {
      async beforeHandle({ jwt, headers, set }) {
        try { await verifyAdmin(jwt, headers); }
        catch (error) {
          if (error instanceof AuthError) {
            set.status = error.status;
            return { code: error.status, msg: error.message };
          }
        }
      },
    },
    (app) => app
      .get('/all', adminListHandler)
      .post('/', adminCreateHandler)
      .patch('/:id', adminUpdateHandler)
      .delete('/:id', adminDeleteHandler)
      .get('/analytics', adminAnalyticsHandler)
  );
```

### 3. AI Controller 按子领域拆分

```typescript
// apps/api/src/modules/ai/ai-sessions.controller.ts
export const aiSessionsController = new Elysia({ prefix: '/sessions' })
  .use(basePlugins)
  .onBeforeHandle(adminGuard)  // 全部需要 admin
  .get('/', sessionsListHandler)
  .get('/:id', sessionDetailHandler)
  .patch('/:id/evaluate', sessionEvaluateHandler)
  .delete('/:id', sessionDeleteHandler)
  .post('/batch-delete', sessionBatchDeleteHandler);  // kebab-case

// apps/api/src/modules/ai/ai.controller.ts - 瘦身后
export const aiController = new Elysia({ prefix: '/ai' })
  .use(basePlugins)
  .use(aiModel)
  // 用户端接口
  .get('/welcome', welcomeHandler)
  .post('/chat', chatHandler)
  .get('/conversations', conversationsHandler)
  .post('/conversations', addMessageHandler)
  .delete('/conversations', clearConversationsHandler)
  // 挂载子领域 controller
  .use(aiSessionsController)
  .use(aiRagController)
  .use(aiMemoryController)
  .use(aiSecurityController)
  .use(aiOpsController);
```

### 3. 统一响应格式

```typescript
// apps/api/src/lib/response.ts - 新建

import { t } from 'elysia';

// 统一列表响应
export const ListResponse = <T extends TSchema>(itemSchema: T) =>
  t.Object({
    items: t.Array(itemSchema),
    total: t.Number(),
  });

// 统一成功响应
export const SuccessResponse = t.Object({
  success: t.Literal(true),
  msg: t.String(),
});

// 统一创建成功响应
export const CreateSuccessResponse = t.Object({
  success: t.Literal(true),
  msg: t.String(),
  id: t.String(),
});

// 统一批量操作响应
export const BatchSuccessResponse = t.Object({
  success: t.Literal(true),
  msg: t.String(),
  count: t.Number(),
});

// 统一错误响应
export const ErrorResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
});
```

### 4. URL 路径变更映射

只做 kebab-case 修正和 Hot-Keywords Admin 路径规范化，不做 `/admin` 前缀迁移：

| 模块 | 旧路径 | 新路径 | 变更类型 |
|------|--------|--------|----------|
| Dashboard | `GET /dashboard/userGrowth` | `GET /dashboard/user-growth` | kebab-case |
| Dashboard | `GET /dashboard/activityTypes` | `GET /dashboard/activity-types` | kebab-case |
| AI Sessions | `POST /ai/sessions/batchDelete` | `POST /ai/sessions/batch-delete` | kebab-case |
| Notifications | `GET /notifications/unreadCount` | `GET /notifications/unread-count` | kebab-case |
| Hot Keywords | `GET /hot-keywords/admin` | `GET /hot-keywords/all` | 去除 admin 路径段 |
| Hot Keywords | `POST /hot-keywords/admin` | `POST /hot-keywords` | 去除 admin 路径段 |
| Hot Keywords | `PATCH /hot-keywords/admin/:id` | `PATCH /hot-keywords/:id` | 去除 admin 路径段 |
| Hot Keywords | `DELETE /hot-keywords/admin/:id` | `DELETE /hot-keywords/:id` | 去除 admin 路径段 |
| Hot Keywords | `GET /hot-keywords/admin/analytics` | `GET /hot-keywords/analytics` | 去除 admin 路径段 |

其他所有路径保持不变，仅通过 `verifyAdmin` 中间件加权限控制。

### 5. 保持不变的接口

除了上表中的 kebab-case 修正和 Hot-Keywords 路径规范化外，所有其他接口路径保持不变。权限控制通过 `verifyAdmin` 中间件实现，不改变 URL。

## Data Models

### 统一响应 Schema（新建 `apps/api/src/lib/response.ts`）

```typescript
import { t, type TSchema } from 'elysia';

// 列表响应工厂
export function ListResponseSchema<T extends TSchema>(itemSchema: T) {
  return t.Object({
    items: t.Array(itemSchema),
    total: t.Number(),
  });
}

// 带游标的列表响应工厂
export function CursorListResponseSchema<T extends TSchema>(itemSchema: T) {
  return t.Object({
    items: t.Array(itemSchema),
    total: t.Number(),
    hasMore: t.Boolean(),
    cursor: t.Union([t.String(), t.Null()]),
  });
}

// 统一错误响应
export const ErrorResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// 统一成功响应
export const SuccessResponseSchema = t.Object({
  success: t.Literal(true),
  msg: t.String(),
});

// 创建成功响应
export const CreateSuccessResponseSchema = t.Intersect([
  SuccessResponseSchema,
  t.Object({ id: t.String() }),
]);

// 批量操作成功响应
export const BatchSuccessResponseSchema = t.Intersect([
  SuccessResponseSchema,
  t.Object({ count: t.Number() }),
]);
```

### Dashboard Model Schema 派生修复

```typescript
// apps/api/src/modules/dashboard/dashboard.model.ts - 修改

import { selectActivitySchema, selectUserSchema } from '@juchang/db';

// ❌ 旧：手动定义
const RecentActivity = t.Object({
  id: t.String(),
  title: t.String(),
  creatorName: t.String(),
  participantCount: t.Number(),
  status: t.String(),
  createdAt: t.String(),
});

// ✅ 新：从 DB 派生 + 扩展
const RecentActivity = t.Composite([
  t.Pick(selectActivitySchema, ['id', 'title', 'status']),
  t.Object({
    creatorName: t.String(),           // 聚合字段，非 DB 列
    participantCount: t.Number(),       // 聚合字段
    createdAt: t.String(),             // 时间转 ISO 字符串
  }),
]);

// 保持手动定义的 Schema（无对应 DB 表）：
// - DashboardStats（聚合统计）
// - MetricItem, BenchmarkStatus（业务指标）
// - GodViewData, AIHealth, Alerts（God View 聚合）
```

### AI Controller 内联 Schema 提取

AI controller 中约有 30+ 个内联 `t.Object(...)` 定义需要提取到 `ai.model.ts`。对于引用 DB 字段的 Schema，改为从 `@juchang/db` 派生：

```typescript
// apps/api/src/modules/ai/ai.model.ts - 新增 Schema

import { selectConversationSchema, selectMessageSchema } from '@juchang/db';

// 会话列表项（从 DB 派生）
export const SessionListItem = t.Composite([
  t.Pick(selectConversationSchema, [
    'id', 'userId', 'title', 'messageCount',
    'evaluationStatus', 'evaluationTags', 'evaluationNote', 'hasError',
  ]),
  t.Object({
    userNickname: t.Union([t.String(), t.Null()]),  // JOIN 字段
    lastMessageAt: t.String(),                       // 时间转字符串
    createdAt: t.String(),
  }),
]);

// 保持手动定义的 Schema（AI 特有聚合类型）：
// - RAG stats, search results
// - Security overview, violation stats
// - Quality metrics, conversion metrics
// - Memory profile, MaxSim results
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, many acceptance criteria across Requirements 1-4 and 15-16 are logically redundant (they all test the same admin auth behavior on different endpoints). After reflection, the following non-redundant properties remain:

### Property 1: Admin endpoints reject unauthenticated requests

*For any* endpoint that requires admin privileges (Dashboard, AI sessions/metrics/rag/memory/security/ops, Users management, Reports admin, Hot-Keywords admin, Growth content), a request without a valid JWT token should receive HTTP 401 with response body containing `code: 401` and `msg` string.

**Validates: Requirements 1.2, 2.2, 3.4, 4.2, 15.2**

### Property 2: Admin endpoints reject non-admin users

*For any* endpoint that requires admin privileges, a request with a valid JWT but non-admin role should receive HTTP 403 with response body containing `code: 403` and `msg` string.

**Validates: Requirements 1.3, 2.3, 4.3, 15.3**

### Property 3: Old camelCase URLs return 404

*For any* renamed URL path (from camelCase to kebab-case), requesting the old camelCase path should return HTTP 404.

**Validates: Requirements 5.5**

### Property 4: Hot-Keywords old admin paths return 404

*For any* old Hot-Keywords admin path (`/hot-keywords/admin/*`), requesting it should return HTTP 404, while the new path (`/hot-keywords/*` with appropriate verbs) should be accessible.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

### Property 5: List responses have unified structure

*For any* list endpoint response, the response body should contain an `items` array and a `total` number field, with no other wrapper patterns like `{ data: [...] }` or `{ sessions: [...] }`.

**Validates: Requirements 7.1, 7.4**

### Property 6: Error responses have unified structure

*For any* error response (HTTP 4xx or 5xx), the response body should contain a `code` number and `msg` string.

**Validates: Requirements 9.1**

### Property 7: Notifications scope=all requires admin privileges

*For any* request to `GET /notifications` with `scope=all` or `userId` parameter, if the requester is not an admin, the response should be HTTP 403.

**Validates: Requirements 16.1**

## Error Handling

### 统一错误处理策略

1. **AuthError 异常类**：`verifyAdmin` 抛出 `AuthError(status, msg)`，由 `onBeforeHandle` 捕获并返回统一格式
2. **业务错误**：各 handler 内部 catch 后返回 `{ code, msg }` 格式
3. **Elysia 验证错误**：Elysia 自动处理 TypeBox 验证失败，返回 422

### 错误码映射

| HTTP Status | 含义 | 触发条件 |
|-------------|------|----------|
| 400 | 请求参数错误 | 业务逻辑验证失败 |
| 401 | 未授权 | 无 JWT 或 JWT 无效 |
| 403 | 无权限 | JWT 有效但非 admin 角色 |
| 404 | 资源不存在 | 查询结果为空 |
| 422 | 数据验证失败 | TypeBox Schema 验证失败 |
| 500 | 服务器错误 | 未预期的异常 |

### Admin Guard 错误处理流程

```
请求 → onBeforeHandle → verifyAdmin()
  ├── 无 JWT → throw AuthError(401, '未授权')
  ├── JWT 无效 → throw AuthError(401, '未授权')
  ├── 非 admin → throw AuthError(403, '无管理员权限')
  └── admin ✓ → 继续执行 handler
```

## Testing Strategy

### 双轨测试方法

- **Unit tests**: 验证具体的 handler 行为、Schema 验证、错误处理
- **Property tests**: 验证跨所有 Admin 端点的通用属性（认证、响应格式）

### Property-Based Testing 配置

- **库**: `fast-check`（项目已安装）
- **最小迭代次数**: 100 次
- **标签格式**: `Feature: api-refactor, Property {number}: {property_text}`

### 测试重点

1. **Admin 认证属性 (Property 1-2)**: 生成随机 Admin 端点路径 + 随机 JWT payload，验证认证行为
2. **URL 重命名属性 (Property 3)**: 枚举所有重命名的 URL，验证旧路径返回 404
3. **路径迁移属性 (Property 4)**: 枚举所有迁移的端点，验证新路径可访问
4. **响应格式属性 (Property 5-6)**: 对所有列表/错误端点，验证响应结构符合规范
5. **Notifications 权限属性 (Property 7)**: 生成随机非 admin 用户，验证 scope=all 被拒绝

### 前端适配验证

- Admin: 更新 Eden Treaty 调用路径后，运行 TypeScript 类型检查确保无编译错误
- 小程序: 重新生成 Orval SDK (`bun run gen:api`)，运行类型检查

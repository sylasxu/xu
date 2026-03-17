---
inclusion: fileMatch
fileMatchPattern: "apps/api/**/*.ts"
---

# API 层设计规范

## 🎯 核心原则

### API 是领域模型的表达，不是前端的附庸

```
✅ 正确：按功能领域组织 → auth/, users/, activities/, chat/, ai/
❌ 错误：按页面组织 → home/, profile/
❌ 错误：按客户端组织 → admin/, miniprogram/
```

**检验标准**：换一个前端框架，API 需要改吗？需要改 = 设计有问题

### 显式参数设计

```typescript
// ❌ 隐式行为
GET /notifications  // 无 JWT 返回所有，有 JWT 返回当前用户的

// ✅ 显式参数
GET /notifications?userId=xxx    // 按 userId 查询（普通用户仅可传本人）
GET /ai/conversations?userId=xxx // 按 userId 查询会话
GET /activities/user/:userId     // 按 userId 查询活动
```

### 禁止 `mine/me/scope` 语义路由

```typescript
// ❌ 禁止
GET /activities/{self-route}
GET /activities/{implicit-current-user}
GET /ai/conversations?{implicit-scope}=all
GET /notifications?{implicit-scope}=current

// ✅ 统一
GET /activities/user/:userId
GET /ai/conversations?userId=...
GET /notifications?userId=...
```

### 客户端无关 API 设计

```typescript
// ❌ 禁止：按客户端拆后端能力
modules/admin/activities/
modules/web/chat/
GET /admin/activities/:id
POST /h5/join

// ✅ 正确：先设计领域接口，再用显式参数承接差异
GET /activities/:id
GET /activities/:id?view=public
POST /ai/chat
// body: { conversationId?, input, context: { client, entry, ... } }
```

**设计准则**：
- API 先按“没有任何客户端消费”来设计，表达稳定的领域能力，而不是为某个端量身定制
- 禁止因为 Admin / H5 / 小程序的消费差异，单独新增同义的模块、service、route、schema
- 多端差异统一通过同一接口内的显式参数、上下文、鉴权和字段裁剪处理
- Admin-only 是权限语义，不是建模语义；除非能力本身就是独立领域（如 analytics、dashboard、wechat callback），否则不要按端拆后端

### 禁止 `helper/helpers` 抽象逃逸

```typescript
// ❌ 禁止：helper 命名掩盖真实职责
tools/helpers/match.ts
function responseHelper(value: unknown) {}

// ✅ 正确：按领域或协议直命名
tools/partner-match.ts
function parseGenUIStreamEvent(value: unknown) {}
function buildIntentCompareResult(value: unknown) {}
```

**规则**：
- 禁止新增 `helper/helpers` 命名的目录、文件、函数
- 类型错误必须在协议边界、数据边界、领域边界直接解决，不能靠 helper 包一层再 `as any`
- 对 `JSON.parse`、SSE chunk、第三方 SDK 返回值，只允许用明确命名的领域解析函数或显式分支处理

---

## 📁 模块职责

| 模块 | 职责 | 不包含 |
|------|------|--------|
| auth | 微信登录、手机号绑定、Token | 用户资料管理 |
| users | 用户 CRUD、额度、统计 | - |
| activities | 活动 CRUD、报名、附近搜索 | 群聊消息 |
| chat | 活动群聊消息 | AI 对话历史 |
| ai | AI 解析、对话历史、工具调用、语义检索 | - |
| participants | 报名管理 | - |
| notifications | 通知推送 | - |
| reports | 举报处理 | - |
| content-security | 内容安全检测 | - |
| feedbacks | 用户反馈 | - |
| transactions | 额度交易记录 | - |
| upload | 文件上传 | - |
| wechat | 微信回调 | - |

---

## 📐 Controller 模式

```typescript
// 文件结构
modules/{module}/
├── {module}.controller.ts  # Elysia 路由
├── {module}.service.ts     # 纯函数业务逻辑
└── {module}.model.ts       # TypeBox Schema

// Controller 规范
export const userController = new Elysia({ prefix: '/users' })
  .use(basePlugins)
  .use(userModel)
  .get('/', handler, { detail, query, response })

// 错误处理
if (!user) {
  set.status = 404;
  return { code: 404, msg: '用户不存在' } satisfies ErrorResponse;
}

// Service 规范 - 纯函数
export async function getUserById(id: string) {
  return await db.query.users.findFirst({ where: eq(users.id, id) });
}
```

---

## 📊 Schema 派生

```typescript
import { selectUserSchema, insertUserSchema } from '@juchang/db';

// 选择字段
const UserResponseSchema = t.Pick(selectUserSchema, ['id', 'nickname', 'avatarUrl']);

// 排除敏感字段
const PublicUserSchema = t.Omit(selectUserSchema, ['wxOpenId', 'phoneNumber']);

// 扩展字段
const UserWithStatsSchema = t.Intersect([
  t.Pick(selectUserSchema, ['id', 'nickname']),
  t.Object({ activityCount: t.Number() }),
]);
```

---

## 🔐 认证模式

```typescript
// 公开端点
GET /activities/:id      // 活动详情
GET /activities/nearby   // 附近活动

// 需要认证
POST /activities         // 创建活动
POST /ai/chat            // AI 对话

// 认证检查
const user = await verifyAuth(jwt, headers);
if (!user) {
  set.status = 401;
  return { code: 401, msg: '未授权' } satisfies ErrorResponse;
}
```

---

## 📅 SQL 日期参数

```typescript
import { db, sql, toTimestamp } from '@juchang/db';

// ❌ 错误：直接传递 Date
const result = await db.execute(sql`
  SELECT * FROM table WHERE created_at >= ${startDate}
`);

// ✅ 正确：使用 toTimestamp
const result = await db.execute(sql`
  SELECT * FROM table WHERE created_at >= ${toTimestamp(startDate)}
`);
```

---

## 🛠️ 数据库命令

```bash
# ✅ 正确：使用 db:push 同步 Schema 到数据库
bun run db:push

# ❌ 禁止：不要使用 db:migrate
# bun run db:migrate  ← 不要用这个！
```

**原因**：开发阶段使用 `db:push` 更快捷，直接同步 Schema 变更到数据库。

---

## 🧪 API 测试与回归

- **默认使用 `bun test`**：API 的单测、服务函数测试、路由集成测试默认走 Bun，禁止为了常规 API 测试再引入 Jest / Vitest 作为主方案
- **路由集成优先走 Elysia 原生 `app.handle(new Request(...))`**：鉴权、参数校验、响应结构、状态流转，优先直接打应用实例，不要为例行集成测试额外起一层测试服务器
- **流式协议必须保留黑盒验证**：`/ai/chat`、SSE、GenUI blocks、`[DONE]`、真实 header 和 chunk 顺序，至少保留一层真实 HTTP / curl 回归，不能只靠内存态断言
- **产品链路改动必须补回归**：只要改到报名、讨论、AI 对话、动作闸门、分享承接、post-activity 等主流程，必须同步补一条能证明链路没断的 `bun scripts/*.ts` 或对应回归
- **禁止测试魔法**：不要用脱离真实协议的 mock shape、类型断言、兜底数据让测试“看起来通过”；测试里暴露出契约问题，就该回头修接口、类型和流程本身

---

## ✅ Checklist

- [ ] 端点表达领域能力，不是前端需求
- [ ] 不按 H5 / Admin / 小程序拆分同义后端接口
- [ ] 使用显式参数控制行为
- [ ] Schema 从 `@juchang/db` 派生
- [ ] Service 是纯函数
- [ ] 错误返回 `ErrorResponse` 格式
- [ ] SQL Date 参数使用 `toTimestamp()`
- [ ] 路由集成测试优先使用 `app.handle(new Request(...))`
- [ ] 流式协议和主流程改动已补黑盒或脚本回归

# 5 个测试账号业务跑通清单

## 目标

用 Admin 超级验证码准备 5 个已绑手机号的测试账号，然后一次性跑通：

1. 发起人创建活动
2. 其余 4 人报名
3. 讨论区出现报名系统消息
4. 参与者发送讨论消息
5. 参与者群聊列表能看到该活动

## 前置条件

- 已执行 `bun install`
- 数据库可用
- 根目录 `.env` 已配置
- 当前环境不是 `production`
- Admin 白名单手机号和超级验证码已在 `.env` 中配置
  - `ADMIN_PHONE_WHITELIST`
  - `ADMIN_SUPER_CODE`
  - 脚本会先读取 `SMOKE_ADMIN_PHONE` / `SMOKE_ADMIN_CODE`，再调用 `POST /auth/login` 换受保护 JWT

## 一键执行

```bash
bun run smoke:five-users
```

如果你希望验收完自动把这次活动标记为取消：

```bash
bun run smoke:five-users --cleanup
```

## 可选参数

- `SMOKE_ADMIN_PHONE`：覆盖管理员手机号
- `SMOKE_ADMIN_CODE`：覆盖超级验证码
- `SMOKE_USER_COUNT`：准备账号数量，范围 `2-5`，默认 `5`

示例：

```bash
SMOKE_USER_COUNT=5 bun run smoke:five-users
```

## 通过标准

脚本执行成功时，会依次确认这些结果：

- 成功准备 5 个可联调账号
- 成功创建 1 个 `active` 活动
- 公开详情中的 `currentParticipants` 从 `1` 增长到 `5`
- 公开详情中的 `participants` 数量为 `5`
- 讨论区至少包含：
  - 与实际报名人数一致的“刚刚加入了”系统消息
  - 与实际发言人数一致的人工发送讨论消息
- 报名用户的 `GET /chat/activities` 列表中能看到新活动

## 脚本做了什么

脚本文件：`scripts/five-user-smoke.ts`

- 调用 `POST /auth/login` 获取受保护 JWT
- 带受保护 JWT 调用 `POST /auth/test-users/bootstrap` 准备测试账号
- 用第 1 个账号创建活动
- 用第 2-5 个账号调用 `POST /activities/:id/join`
- 用 3 个账号调用 `POST /chat/:activityId/messages`
- 校验：
  - `GET /activities/:id/public`
  - `GET /chat/:activityId/messages`
  - `GET /chat/activities`

## 建议人工补看

脚本过了以后，建议再人工补看这几项：

- 小程序端活动详情页是否显示正确人数和讨论区预览
- 报名成功后是否走到 `join_success -> discussion -> quick starters`
- 新消息是否在前端正确展示系统消息和用户消息
- 管理后台是否能查到这批测试用户和新建活动
- 如果用了 `--cleanup`，确认活动状态已变为 `cancelled`

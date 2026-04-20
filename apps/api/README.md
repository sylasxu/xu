# xu API Server

基于 ElysiaJS + TypeBox 的业务网关，负责表达 xu 的稳定领域能力，而不是为某个前端页面临时拼接口。

当前主流程长期收口在：

- `auth`
- `ai`
- `activities`
- `participants`
- `chat`
- `notifications`
- `content`

## 开发

```bash
# 安装依赖（在根目录执行）
bun install

# 启动开发服务器
bun run dev
```

## API 文档

启动服务器后访问：
- **OpenAPI JSON**: http://localhost:3000/openapi/json
- **健康检查**: http://localhost:3000/health

## 当前核心协议

### `/ai/chat`

- 请求体固定为：`conversationId? + input + context`
- 主响应固定为：SSE 事件流
- `response-complete` 事件携带完整 response envelope

### 领域建模原则

- API 先按“没有任何客户端消费”来设计
- 不按 H5 / Admin / 小程序拆同义后端模块
- 多端差异通过显式参数、上下文、鉴权和字段裁剪承接

## 生成小程序 SDK

```bash
# 确保 API 服务器运行在 localhost:3000
bun run gen:api
```

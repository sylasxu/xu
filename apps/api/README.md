# xu API Server

基于 ElysiaJS 的高性能 API 服务器，使用 TypeBox 进行类型验证。

## 开发

```bash
# 安装依赖（在根目录执行）
bun install

# 启动开发服务器
bun run dev
```

## API 文档

启动服务器后访问：
- **OpenAPI JSON**: http://localhost:3000/doc/json
- **健康检查**: http://localhost:3000/health

## 生成小程序 SDK

```bash
# 确保 API 服务器运行在 localhost:3000
bun run gen:api
```

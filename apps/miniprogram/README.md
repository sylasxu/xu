# xu 小程序

xu 小程序是当前最主要的用户端，承担找局、找搭子、报名、讨论区承接和个人设置等核心流程。

## 当前重点能力

- 首页对话入口与欢迎卡
- 附近活动探索
- 活动详情、报名、候补、讨论区
- 找搭子结果展示与继续留意
- 登录、手机号绑定、个人资料与设置

## 开发环境

- 微信开发者工具
- Bun `>= 1.3.4`

## 启动方式

1. 在仓库根目录启动 API 和其余本地服务：

```bash
bun run dev
```

如果需要 API 自动重启和 SDK 生成链路，也可以在根目录执行：

```bash
bun run dev:full
```

2. 用微信开发者工具打开当前小程序目录
3. 在微信开发者工具里执行“工具 -> 构建 npm”

## API 与代码生成

小程序通过 Orval 生成的 SDK 调用后端接口，生成命令是：

```bash
bun run gen:api:mp
```

小程序端生成结果主要在：

- `src/api/endpoints/`
- `src/api/model/`

项目约定是不直接在业务代码里手写 `wx.request` 调后端；接口调用统一通过生成 SDK 或其封装层完成。

## 常用命令

```bash
bun run dev
bun run gen:api
bun run type-check
bun run test
```

说明：

- `bun run dev` 会提示你在微信开发者工具中打开当前目录
- `bun run gen:api` 会重新导出 OpenAPI 并生成小程序 SDK
- `bun run test` 当前会跑 `type-check` 和 `tests/` 下的 Bun 测试

## 目录结构

```text
apps/miniprogram/
├── pages/                   # 主包页面
├── subpackages/             # 分包页面（活动详情、探索、设置等）
├── components/              # 小程序组件
├── src/api/                 # Orval 生成的接口与模型
├── src/stores/              # Zustand Vanilla 状态管理
├── src/services/            # 面向页面的服务封装
├── src/utils/               # 工具函数与协议适配
├── static/                  # 静态资源
├── tests/                   # Bun 测试
├── app.ts                   # 小程序入口
└── orval.config.ts          # SDK 生成配置
```

## 技术栈

- 原生微信小程序
- TypeScript
- TDesign MiniProgram
- Zustand
- Immer
- Orval

## 开发约定

- 小程序页面交互和状态流转只放在 `apps/miniprogram` 内，不复用跨端运行时代码
- 后端接口优先通过 Orval 生成 SDK 消费
- 影响报名、讨论区、AI 对话承接的改动，需要同步关注根目录回归脚本

## 许可证

MIT License - 详见根目录 [LICENSE](../../LICENSE)

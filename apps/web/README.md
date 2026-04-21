# xu Web / H5

H5 是 xu 的轻端主承接面之一。

它不再只是“小程序不可用时的降级聊天页”，而是围绕 `/chat` 首页主路由，承接状态首页、对话主舞台、活动详情与分享态。

## 当前定位

- `/chat` 是 H5 的首页主路由
- 首页和 chat 是同一个页面的两种状态
- H5 与小程序共享同一产品哲学，不应长成两套不同世界观
- `/activities/[id]` 是唯一活动分享与详情承接页，不再保留独立 `/invite` 路由

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 15 | React 框架 |
| AI SDK | 4.x | 流式对话管理 |
| Framer Motion | 12.x | 动画效果 |
| Tailwind CSS | 4.x | 样式系统 |
| Lucide React | 0.469 | 图标库 |

## 文件结构

```
app/
├── page.tsx               # 根路由，重定向到 /chat
├── chat/
│   └── page.tsx          # 首页主路由：状态首页 + 对话主舞台
├── activities/
│   └── [id]/
│       └── page.tsx      # 活动详情分享态
└── layout.tsx            # 根布局

lib/
├── utils.ts              # 工具函数（cn）
├── themes.ts             # 主题配置
└── eden.ts               # Eden Treaty API 客户端

components/
├── ai-elements/          # 对话主轴组件
├── chat/                 # 消息中心 / 侧边抽屉等承接组件
└── activity/             # 活动详情、主题背景与讨论区组件
```

## 当前主轴

### 1. `/chat` 统一承接

- 状态首页和对话主舞台在同一路由内切换
- 首页负责判断“现在最需要被接住的事”
- agent 负责理解需求、调用数据、推进流程
- GenUI 负责把结果、进度和下一步动作长出来

### 2. AI Elements 是聊天主轴

- 对话消息流、输入框和消息容器继续基于 `components/ai-elements/*`
- 不在 H5 里另起一套平行聊天运行时
- 结构化承接围绕统一 `GenUI blocks` 协议，而不是继续扩张旧 `Widget_*` 心智

### 3. 活动详情分享态

- 分享出去的活动详情本身承担外部分发职责
- 不再维护独立 `/invite` 路由或邀请函页面心智

## 流式协议

H5 消费统一的 `/ai/chat` SSE 协议：

- 请求体：`conversationId? + input + context`
- 返回：流式事件 + `response-complete`
- 当前结构化承接围绕统一 `GenUI blocks`

## 当前交互重点

- 状态首页空态、待继续、进行中、待出发表达
- 消息中心作为“任务收件箱 + 结果更新流”
- 活动详情承担报名、复制、分享展示、讨论区预览和二次转化
- H5 在现实实践里优先保证主链完整，而不是只做展示页

## 开发

```bash
# 安装依赖
bun install

# 开发模式
bun run dev

# 构建
bun run build
```

## 环境变量

```bash
NEXT_PUBLIC_API_URL=http://localhost:1996
```

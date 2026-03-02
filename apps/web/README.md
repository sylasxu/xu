# 聚场 Web Chat UI

基于 **AI SDK React** 的世界级 AI 对话界面。

## 特性

- ⚡ **流式渲染** - 基于 `@ai-sdk/react` 的 `useChat` hook
- 🎨 **生成式 UI** - Tool Invocation 卡片（草稿、探索、发布）
- 🎬 **精致动画** - Framer Motion 驱动的入场和过渡动画
- 📱 **响应式设计** - Mobile-first，桌面端优雅居中
- 🎯 **快捷提示** - 空状态引导，一键发送常用语句

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
├── chat/
│   └── page.tsx          # 对话页面（单文件实现所有功能）
├── invite/
│   └── [id]/
│       └── page.tsx      # 活动邀请函页面
└── layout.tsx            # 根布局

lib/
├── utils.ts              # 工具函数（cn）
├── themes.ts             # 主题配置
├── eden.ts               # Eden Treaty API 客户端
└── wechat.ts             # 微信环境检测

components/
└── invite/               # 邀请函专用组件
    ├── activity-card.tsx
    ├── discussion-preview.tsx
    ├── theme-background.tsx
    └── wechat-redirect.tsx
```

## 流式渲染实现

### 使用 `useChat` Hook

```typescript
const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
  api: `${API_BASE}/ai/chat`,
  body: { source: "web" },
})
```

### 自动处理

- ✅ 流式文本增量渲染
- ✅ 消息状态管理
- ✅ Tool Invocation 解析
- ✅ 加载状态追踪
- ✅ 错误处理和重试

## 生成式 UI (Generative UI)

### Tool Invocation 卡片

| Tool | 卡片类型 | 状态 |
|------|----------|------|
| `createActivityDraft` | 活动草稿卡片 | 加载中 / 完成 |
| `exploreNearby` | 探索结果列表 | 加载中 / 完成 |
| `publishActivity` | 发布成功提示 | 加载中 / 完成 |

### 示例：草稿卡片

```typescript
function DraftToolCard({ args, result, isComplete }) {
  if (!isComplete) {
    return <LoadingState />  // 脉冲动画
  }
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* 活动信息 + 确认按钮 */}
    </motion.div>
  )
}
```

## API 响应格式

后端使用 AI SDK 的 `toUIMessageStreamResponse()`，前端通过 `useChat` 自动解析。

### Tool Result 结构

```typescript
interface ToolInvocation {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  state: "call" | "result"
}
```

## 动画效果

| 元素 | 动画 | 参数 |
|------|------|------|
| 欢迎 Logo | 缩放入场 | `scale: 0.8 → 1`, `opacity: 0 → 1` |
| 快捷提示 | 交错入场 | `delay: index * 0.1s` |
| Widget 卡片 | 上滑入场 | `y: 10 → 0`, `opacity: 0 → 1` |
| 思考指示器 | 呼吸点 | `opacity: [0.3, 1, 0.3]` |
| 探索列表项 | 交错滑入 | `x: -10 → 0`, `delay: index * 0.05` |

## 快捷提示

空状态显示 4 个快捷提示：

1. 🍜 今晚想找人吃火锅
2. 🎲 周末剧本杀缺人
3. 🏃 附近有什么运动
4. 🎉 帮我策划生日聚会

点击后自动发送消息。

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

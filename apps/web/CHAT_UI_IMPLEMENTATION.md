# Web Chat UI 实现文档

## 技术栈

- **Framework**: Next.js 15 (App Router)
- **AI SDK**: `@ai-sdk/react` + `ai`
- **Animation**: Framer Motion
- **Icons**: Lucide React
- **Styling**: Tailwind CSS 4

## 流式渲染实现

### 1. 使用 `useChat` Hook

```typescript
import { useChat } from "@ai-sdk/react"

const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
  api: `${API_BASE}/ai/chat`,
  body: { source: "web" },
})
```

### 2. API 响应格式

后端使用 `toUIMessageStreamResponse()` 返回标准 UIMessage 格式：

```
stream: {
  type: "text",
  text: "消息内容"
}
```

### 3. 自动流式处理

`useChat` 自动处理：
- 流式文本增量渲染
- 消息状态管理
- 加载状态追踪
- 错误处理
- 重试机制

## 生成式 UI (Generative UI)

### Widget 类型

| Widget | 用途 | 触发场景 |
|--------|------|----------|
| `widget_draft` | 活动草稿卡片 | AI 解析创建意图 |
| `widget_explore` | 探索结果列表 | 探索附近活动 |
| `widget_share` | 分享成功提示 | 活动发布成功 |
| `widget_action` | 快捷操作按钮 | 需要用户确认 |

### 数据提取

```typescript
function extractWidgetFromMessage(message: Message): WidgetData | undefined {
  const annotations = message.annotations as Array<{ type: string; data: unknown }>
  
  if (annotations) {
    const widgetAnnotation = annotations.find(a => a.type?.startsWith("widget_"))
    if (widgetAnnotation) {
      return {
        type: widgetAnnotation.type as WidgetType,
        data: widgetAnnotation.data as Record<string, unknown>,
      }
    }
  }
  return undefined
}
```

### Widget 渲染

```typescript
function WidgetCard({ widget }: { widget: WidgetData }) {
  switch (widget.type) {
    case "widget_draft":
      return <ActivityDraftWidget data={widget.data} />
    case "widget_explore":
      return <ActivityExploreWidget data={widget.data} />
    // ...
  }
}
```

## 组件架构

```
ChatPage
├── Header (顶部导航)
├── MessageList (消息列表)
│   ├── WelcomeScreen (空状态)
│   └── MessageBubble[]
│       ├── UserMessage
│       ├── AssistantMessage
│       │   └── WidgetCard (生成式 UI)
│       └── ThinkingIndicator
└── ChatInput (输入框)
```

## 动画效果

### 1. 欢迎屏幕入场

```typescript
<motion.div
  initial={{ scale: 0.8, opacity: 0 }}
  animate={{ scale: 1, opacity: 1 }}
  transition={{ duration: 0.5 }}
>
```

### 2. 消息气泡

- 用户：右侧滑入
- AI：左侧滑入 + 头像

### 3. Widget 卡片

```typescript
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
/>
```

### 4. 思考指示器

三个呼吸点动画：

```typescript
<motion.span
  animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
/>
```

## 交互设计

### 输入框

- 自适应高度（min: 44px, max: 120px）
- Enter 发送，Shift+Enter 换行
- 发送时自动重置高度

### 快捷提示

空状态显示 4 个快捷提示卡片：
- 🍜 今晚想找人吃火锅
- 🎲 周末剧本杀缺人
- 🏃 附近有什么运动
- 🎉 帮我策划生日聚会

### 错误处理

- 显示错误消息
- 提供重试按钮
- 保留已发送的消息

## 响应式设计

| 设备 | 布局 |
|------|------|
| Mobile | 全屏，无边距 |
| Desktop | max-w-2xl 居中，圆角边框 |

## 后续优化

- [ ] Tool Call 可视化（类似 Admin Playground）
- [ ] 消息操作（复制、重新生成）
- [ ] 历史对话列表
- [ ] 打字机效果优化

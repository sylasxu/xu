# Web AI UI 升级方案

## 1. 安装 AI SDK Elements

```bash
cd apps/web

# 使用 ai-elements CLI 安装组件
npx ai-elements@latest add conversation message reasoning prompt-input attachment code-block tool-call

# 或者使用 shadcn 方式（如果项目已配置）
npx shadcn add ai-elements
```

## 2. 依赖安装

```bash
# AI SDK 核心
npm install ai @ai-sdk/react

# 代码高亮
npm install prism-react-renderer

# 文件处理
npm install react-dropzone
```

## 3. 组件替换映射

| 当前组件 | 替换为 | 文件路径 |
|---------|--------|----------|
| `Conversation` | `@/components/ui/conversation` (AI Elements) | 保持路径兼容 |
| `Message` | `@/components/ui/message` (AI Elements) | 保持路径兼容 |
| `PromptInput` | `@/components/ui/prompt-input` (AI Elements) | 保持路径兼容 |
| `Reasoning` | `@/components/ui/reasoning` (AI Elements) | 保持路径兼容 |

## 4. 新页面结构

```
app/chat/
├── page.tsx                 # 主页面（简化版）
├── layout.tsx               # 聊天布局
├── components/
│   ├── chat-container.tsx   # 对话容器
│   ├── message-list.tsx     # 消息列表
│   ├── chat-input.tsx       # 输入组件
│   ├── thinking-indicator.tsx # AI 思考动画
│   └── widgets/             # 活动卡片 Widgets
│       ├── activity-draft.tsx
│       ├── activity-explore.tsx
│       └── activity-share.tsx
```

## 5. 关键改进点

### 5.1 Thinking 动画
- 使用 `Reasoning` 组件展示 AI 思考过程
- 支持折叠/展开
- 动画：呼吸点 + 文字渐变

### 5.2 富文本渲染
- Markdown 支持（列表、链接、粗体）
- 代码块高亮
- 活动卡片内嵌渲染

### 5.3 流式响应优化
- `StreamingText` 组件实现打字机效果
- 平滑滚动
- 闪烁光标

### 5.4 空状态设计
- 欢迎语 + 快捷提示
- 热门活动推荐卡片
- 动画入场效果

## 6. 样式主题对齐

保持与小程序和邀请函一致的主题系统：
- 颜色：蓝色系 (#3B82F6) 作为主色
- 圆角：rounded-2xl 消息气泡
- 字体：系统默认，保持清晰可读

## 7. 响应式设计

```css
/* Mobile First */
.chat-container {
  @apply h-screen max-w-2xl mx-auto;
}

/* Desktop */
@media (min-width: 1024px) {
  .chat-container {
    @apply h-[calc(100vh-2rem)] my-4 rounded-2xl shadow-2xl;
  }
}
```

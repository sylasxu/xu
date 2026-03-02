# 🚀 Web UI 升级完整指南

## 概述

将聚场 Web 端的 AI 对话界面升级为世界级水准，引入现代化 AI 交互组件。

## 一、安装依赖

```bash
cd apps/web

# 核心动画库
npm install framer-motion

# Markdown 渲染
npm install react-markdown

# 图标库
npm install lucide-react

# 日期处理（如需要）
npm install date-fns
```

## 二、组件结构

```
app/chat/
├── page.tsx                    # 主页面（已重写）
├── layout.tsx                  # 布局
├── types.ts                    # 类型定义
├── components/
│   ├── chat-container.tsx      # 聊天容器
│   ├── chat-input.tsx          # 输入组件
│   ├── message-list.tsx        # 消息列表
│   ├── thinking-indicator.tsx  # AI 思考动画
│   ├── welcome-screen.tsx      # 空状态欢迎页
│   ├── messages/
│   │   ├── user-message.tsx    # 用户消息
│   │   └── assistant-message.tsx # AI 消息
│   └── widgets/
│       ├── widget-renderer.tsx
│       ├── activity-draft-card.tsx
│       ├── activity-explore-card.tsx
│       ├── activity-share-card.tsx
│       └── welcome-card.tsx
└── utils/
    └── format.ts               # 格式化工具
```

## 三、API 流式协议

当前实现使用 Data Stream 协议：

```
0:"文本片段"      -> 普通文本增量
g:"推理片段"      -> 思考过程
d:{...}          -> 数据对象（如 widget）
```

API 需要返回这种格式，或者调整为标准 SSE。

## 四、关键改进点

### 1. 欢迎屏幕
- 动画 Logo 入场
- 4 个快捷提示卡片
- 引导用户首次使用

### 2. 消息气泡
- 用户：蓝色渐变，右对齐，小尾巴
- AI：灰色背景，左对齐，头像 + 小尾巴
- 时间戳格式化（刚刚/几分钟前/具体时间）

### 3. AI 思考过程
- 可折叠的 "💭 思考过程" 按钮
- 展开显示 AI 推理文本
- 适合调试和透明化

### 4. Widget 卡片
- **ActivityDraftCard**: 活动草稿预览，含地图区域、信息、确认按钮
- **ActivityExploreCard**: 探索结果列表，支持滚动
- **ActivityShareCard**: 发布成功提示，含分享按钮
- **WelcomeCard**: 欢迎卡片，含快捷提示

### 5. 加载状态
- 三个呼吸点动画
- "思考中..." 文字

## 五、响应式设计

| 断点 | 表现 |
|-----|------|
| Mobile (< 1024px) | 全屏，无边距 |
| Desktop (>= 1024px) | max-w-2xl 居中，圆角，阴影 |

## 六、后续优化方向

### Phase 2: 更丰富的交互
- [ ] 代码块高亮（Prism）
- [ ] 文件上传/图片预览
- [ ] 语音输入按钮
- [ ] 消息操作（复制、重新生成）

### Phase 3: AI SDK Elements 集成
- [ ] 迁移到官方 AI SDK Elements
- [ ] 使用 `useChat` hook
- [ ] Tool Call 可视化

### Phase 4: 主题系统
- [ ] 与邀请函主题对齐
- [ ] 暗色模式支持
- [ ] 动态背景（React Bits）

## 七、文件备份

原文件已备份：
- `components/ai-elements/` -> 保留作为参考
- `app/chat/page-old.tsx` -> 原页面（如需要恢复）

## 八、测试检查清单

- [ ] 空状态显示 WelcomeScreen
- [ ] 用户消息发送正常
- [ ] AI 流式响应正常
- [ ] 思考过程可折叠
- [ ] Widget 卡片渲染正确
- [ ] 自动滚动到底部
- [ ] 响应式布局正常
- [ ] 输入框自适应高度
- [ ] Enter 发送，Shift+Enter 换行

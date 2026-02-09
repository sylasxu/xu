# Design Document: v5.0 Web Invitation + Theme System + Lifecycle

## Overview

v5.0 版本包含两条并行交付线：

**线 A — 活动全生命周期补全（P0/P1/P2）**：
- 报名→讨论区自动跳转 + 系统消息
- 新人报名通知所有参与者
- 活动详情页嵌入讨论区预览
- Post-Activity Flow（自动完成 + 反馈推送）
- 活动前提醒 + 分享卡片优化

**线 B — H5 Web 应用 + 主题系统**：
- activities 表新增 theme/themeConfig 字段
- 公开活动详情 API（含讨论区预览）
- apps/web (Next.js)：`/invite/:id` 邀请函 + `/chat` 小聚对话

## Architecture

### 技术选型决策

**为什么 apps/web 用 Next.js 而非 Vite SPA（与 admin 不同）？**

| 维度 | Vite SPA (admin) | Next.js (web) |
|------|-----------------|---------------|
| OG Tags | 需要 API 层 bot detection | SSR 天然生成，零额外工作 |
| AI Chat UI | 从零写流式渲染 | AI SDK Elements 20+ 组件开箱即用 |
| SEO | 无 | `/invite` 页面可被搜索引擎索引 |
| 定位 | 内部管理工具 | 面向用户的公开页面 |

**关键约束**：
- Next.js 只做前端渲染层，不使用 API Routes
- 所有数据请求走 Elysia API，统一使用 Eden Treaty
- AI 对话也通过 Eden Treaty 调用 `POST /ai/chat`（流式响应）
- **Mobile-First 响应式设计**：所有页面以移动端为基准设计，桌面端通过 `max-w-md`（448px）居中约束内容宽度，避免大屏上内容过度拉伸。邀请函卡片 `max-w-lg`，对话页面 `max-w-2xl`。Tailwind 断点使用 `sm:` / `md:` 向上适配。

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    apps/web (Next.js)                        │
│                                                             │
│  /invite/:id (SSR)          /chat (CSR)                     │
│  ┌─────────────────┐       ┌─────────────────┐             │
│  │ React Bits 动态背景│       │ AI SDK Elements  │             │
│  │ 活动信息卡片     │       │ Conversation     │             │
│  │ 讨论区预览       │       │ Message          │             │
│  │ 微信跳转引导     │       │ Reasoning        │             │
│  │ OG Meta Tags    │       │ PromptInput      │             │
│  └────────┬────────┘       └────────┬────────┘             │
│           │                         │                       │
│           └──── Eden Treaty ────────┘                       │
│                      │                                      │
└──────────────────────┼──────────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────────┐
│                    apps/api (Elysia)                       │
│                                                           │
│  GET /activities/:id/public    POST /ai/chat (SSE Stream) │
│  (无需认证, 含讨论区预览)      (可选认证)                   │
│                                                           │
│  joinActivity() ──→ 系统消息 + 通知所有参与者              │
│  scheduler ──→ Post-Activity Job + Activity Reminder       │
└───────────────────────────────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────────┐
│                    @juchang/db                             │
│  activities (+ theme, themeConfig)                         │
│  notifications (+ new_participant, post_activity,          │
│                   activity_reminder)                       │
│  activity_messages (system 消息: "XX 刚刚加入了！")         │
└───────────────────────────────────────────────────────────┘
```

### 模块职责

| 模块 | 变更类型 | 说明 |
|------|---------|------|
| @juchang/db | 扩展 | activities 新增 theme/themeConfig；notificationTypeEnum 新增 3 种类型 |
| apps/api/activities | 扩展 | 新增 `GET /:id/public`；joinActivity 新增系统消息+全员通知 |
| apps/api/notifications | 扩展 | 新增 `notifyNewParticipant`、`notifyPostActivity`、`notifyActivityReminder` |
| apps/api/jobs | 扩展 | 新增 post-activity-job（自动完成+反馈推送）、activity-reminder-job |
| apps/web | 新增 | Next.js 应用，`/invite/:id` + `/chat` |
| apps/miniprogram | 扩展 | 报名后跳转讨论区；详情页嵌入讨论区预览；分享卡片优化 |

## Components and Interfaces

### 1. 数据库 Schema 变更

#### 1.1 activities 表新增主题字段

```typescript
// packages/db/src/schema/activities.ts - 新增字段
import { jsonb } from "drizzle-orm/pg-core";

// ThemeConfig 类型（在文件顶部定义）
export interface ThemeConfig {
  background: {
    component: 'Aurora' | 'Ballpit' | 'Particles' | 'Threads' | 'Gradient' | 'Squares';
    config: Record<string, unknown>;  // Background Studio 导出的参数
  };
  textEffect?: 'split' | 'blur' | 'gradient' | 'shiny';
  colorScheme?: {
    primary: string;
    secondary: string;
    text: string;
  };
}

// 在 status 字段之后、embedding 字段之前新增：
theme: varchar("theme", { length: 20 }).default("auto").notNull(),
themeConfig: jsonb("theme_config").$type<ThemeConfig>(),
```

#### 1.2 notificationTypeEnum 扩展

```typescript
// packages/db/src/schema/enums.ts
export const notificationTypeEnum = pgEnum("notification_type", [
  "join",              // 有人报名（通知创建者）
  "quit",              // 有人退出
  "activity_start",    // 活动即将开始
  "completed",         // 活动成局
  "cancelled",         // 活动取消
  // v5.0 新增
  "new_participant",   // 有新人报名（通知所有已报名参与者）
  "post_activity",     // 活动结束后反馈推送
  "activity_reminder", // 活动前 1 小时提醒
]);
```

### 2. 预设主题映射

```typescript
// apps/api/src/modules/activities/theme-presets.ts
import type { ThemeConfig } from '@juchang/db';

// 活动类型 → 预设主题
export const ACTIVITY_TYPE_THEME_MAP: Record<string, string> = {
  food: 'warm',
  entertainment: 'party',
  sports: 'sport',
  boardgame: 'neon',
  other: 'minimal',
};

// 预设主题 → ThemeConfig
export const PRESET_THEMES: Record<string, ThemeConfig> = {
  aurora: {
    background: { component: 'Aurora', config: { colorStops: ['#3A29FF', '#FF94B4', '#FF3232'], speed: 0.5, blend: 0.5 } },
    colorScheme: { primary: '#6366F1', secondary: '#A78BFA', text: '#FFFFFF' },
  },
  party: {
    background: { component: 'Ballpit', config: { count: 50, gravity: 0.5, size: 0.8, colors: [0xff6b6b, 0xffd93d, 0x6bcb77] } },
    colorScheme: { primary: '#F43F5E', secondary: '#FB923C', text: '#FFFFFF' },
  },
  minimal: {
    background: { component: 'Gradient', config: { from: '#f5f7fa', to: '#c3cfe2' } },
    colorScheme: { primary: '#374151', secondary: '#6B7280', text: '#1F2937' },
  },
  neon: {
    background: { component: 'Threads', config: { color: [0.1, 0.8, 0.9], amplitude: 1, distance: 0, enableMouseInteraction: true } },
    colorScheme: { primary: '#06B6D4', secondary: '#8B5CF6', text: '#FFFFFF' },
  },
  warm: {
    background: { component: 'Gradient', config: { from: '#ffecd2', to: '#fcb69f' } },
    colorScheme: { primary: '#EA580C', secondary: '#F59E0B', text: '#1C1917' },
  },
  sport: {
    background: { component: 'Particles', config: { particleCount: 80, speed: 0.3, particleColors: ['#22C55E', '#3B82F6'] } },
    colorScheme: { primary: '#16A34A', secondary: '#2563EB', text: '#FFFFFF' },
  },
};

/** 根据活动类型解析最终 ThemeConfig */
export function resolveThemeConfig(theme: string, themeConfig: ThemeConfig | null, activityType: string): ThemeConfig {
  if (theme === 'custom' && themeConfig) return themeConfig;
  const presetName = theme === 'auto' ? (ACTIVITY_TYPE_THEME_MAP[activityType] || 'minimal') : theme;
  return PRESET_THEMES[presetName] || PRESET_THEMES.minimal;
}
```

### 3. 公开活动详情 API（含讨论区预览）

```typescript
// apps/api/src/modules/activities/activity.service.ts - 新增函数

export async function getPublicActivityById(activityId: string) {
  // 1. 查询活动基础信息 + 发起人
  const [activity] = await db
    .select({
      id: activities.id,
      title: activities.title,
      description: activities.description,
      startAt: activities.startAt,
      locationName: activities.locationName,
      locationHint: activities.locationHint,
      type: activities.type,
      status: activities.status,
      maxParticipants: activities.maxParticipants,
      currentParticipants: activities.currentParticipants,
      theme: activities.theme,
      themeConfig: activities.themeConfig,
      creatorNickname: users.nickname,
      creatorAvatarUrl: users.avatarUrl,
    })
    .from(activities)
    .leftJoin(users, eq(activities.creatorId, users.id))
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) return null;

  // 2. 查询参与者列表（最多 10 人，头像+昵称）
  const participantList = await db
    .select({
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .where(and(eq(participants.activityId, activityId), eq(participants.status, 'joined')))
    .limit(10);

  // 3. 查询最近 3 条讨论区消息
  const recentMessages = await db
    .select({
      senderNickname: users.nickname,
      senderAvatar: users.avatarUrl,
      content: activityMessages.content,
      createdAt: activityMessages.createdAt,
    })
    .from(activityMessages)
    .leftJoin(users, eq(activityMessages.senderId, users.id))
    .where(eq(activityMessages.activityId, activityId))
    .orderBy(desc(activityMessages.createdAt))
    .limit(3);

  return {
    ...activity,
    isArchived: calculateIsArchived(activity.startAt),
    participants: participantList,
    recentMessages: recentMessages.reverse(), // 按时间正序
  };
}
```

```typescript
// apps/api/src/modules/activities/activity.controller.ts - 新增端点

// GET /activities/:id/public - 无需认证
.get('/:id/public', async ({ params, set }) => {
  const activity = await getPublicActivityById(params.id);
  if (!activity) {
    set.status = 404;
    return { code: 404, msg: '活动不存在' };
  }
  return activity;
}, {
  params: t.Object({ id: t.String({ format: 'uuid' }) }),
  detail: { summary: '获取活动公开详情（无需认证）', tags: ['Activities'] },
})
```

### 4. 报名流程扩展（系统消息 + 全员通知）

```typescript
// apps/api/src/modules/activities/activity.service.ts
// 在 joinActivity 函数末尾新增：

// v5.0: 发送系统消息到讨论区 "XX 刚刚加入了！"
const [joiner] = await db
  .select({ nickname: users.nickname })
  .from(users)
  .where(eq(users.id, userId))
  .limit(1);

const joinerName = joiner?.nickname || '新成员';

// 插入系统消息到 activity_messages
db.insert(activityMessages).values({
  activityId,
  senderId: null,  // 系统消息无 sender
  messageType: 'system',
  content: `${joinerName} 刚刚加入了！`,
}).catch(err => console.error('Failed to send join system message:', err));

// v5.0: 通知所有已报名参与者（不含新加入者和创建者）
notifyNewParticipant(
  activityId,
  activity.title,
  joinerName,
  userId,
  activity.creatorId
).catch(err => console.error('Failed to notify participants:', err));
```

### 5. 通知服务扩展

```typescript
// apps/api/src/modules/notifications/notification.service.ts - 新增函数

/**
 * v5.0: 通知所有已报名参与者有新人加入
 */
export async function notifyNewParticipant(
  activityId: string,
  activityTitle: string,
  newMemberName: string,
  newMemberId: string,
  creatorId: string,
) {
  // 查询所有已报名参与者（排除新加入者和创建者）
  const joinedParticipants = await db
    .select({ userId: participants.userId })
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.status, 'joined'),
    ));

  const excludeIds = new Set([newMemberId, creatorId]);

  for (const p of joinedParticipants) {
    if (excludeIds.has(p.userId)) continue;
    createNotification({
      userId: p.userId,
      type: 'new_participant',
      title: `${newMemberName} 也来了！`,
      content: `「${activityTitle}」又多了一位小伙伴`,
      activityId,
    }).catch(err => console.error('Failed to create new_participant notification:', err));
  }
}

/**
 * v5.0: 活动结束后反馈推送
 */
export async function notifyPostActivity(
  activityId: string,
  activityTitle: string,
) {
  const joinedParticipants = await db
    .select({ userId: participants.userId })
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.status, 'joined'),
    ));

  for (const p of joinedParticipants) {
    createNotification({
      userId: p.userId,
      type: 'post_activity',
      title: '玩得怎么样？',
      content: `「${activityTitle}」结束了，来聊聊感受吧～`,
      activityId,
    }).catch(err => console.error('Failed to create post_activity notification:', err));
  }
}

/**
 * v5.0: 活动前 1 小时提醒
 */
export async function notifyActivityReminder(
  activityId: string,
  activityTitle: string,
  locationName: string,
) {
  const joinedParticipants = await db
    .select({ userId: participants.userId })
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.status, 'joined'),
    ));

  for (const p of joinedParticipants) {
    createNotification({
      userId: p.userId,
      type: 'activity_reminder',
      title: '活动马上开始啦！',
      content: `「${activityTitle}」还有 1 小时开始，地点：${locationName}`,
      activityId,
    }).catch(err => console.error('Failed to create activity_reminder notification:', err));
  }
}
```

### 6. Post-Activity Job（定时任务）

```typescript
// apps/api/src/jobs/post-activity.ts

import { db, activities, eq, and, sql, lt } from '@juchang/db';
import { notifyPostActivity } from '../modules/notifications/notification.service';
import { jobLogger } from '../lib/logger';

/**
 * Post-Activity 自动完成任务
 * 
 * 逻辑：活动 startAt + 2h 后，自动将 active → completed，并推送反馈通知
 * 执行频率：每 5 分钟
 */
export async function processPostActivity(): Promise<void> {
  const now = new Date();

  // 查找 startAt + 2h < now 且仍为 active 的活动
  const expiredActivities = await db
    .select({ id: activities.id, title: activities.title })
    .from(activities)
    .where(and(
      eq(activities.status, 'active'),
      sql`${activities.startAt} + interval '2 hours' < ${now}`,
    ));

  let completed = 0;
  for (const activity of expiredActivities) {
    // 更新状态为 completed
    await db.update(activities)
      .set({ status: 'completed', updatedAt: now })
      .where(eq(activities.id, activity.id));

    // 推送反馈通知
    notifyPostActivity(activity.id, activity.title).catch(err => {
      console.error(`Failed to notify post-activity for ${activity.id}:`, err);
    });

    completed++;
  }

  jobLogger.jobStats('Post-Activity 自动完成', completed, 0);
}
```

```typescript
// apps/api/src/jobs/activity-reminder.ts

import { db, activities, eq, and, sql, gt } from '@juchang/db';
import { notifyActivityReminder } from '../modules/notifications/notification.service';
import { jobLogger } from '../lib/logger';

/**
 * 活动前 1 小时提醒任务
 * 
 * 逻辑：startAt - 1h < now < startAt 且 active 的活动，发送提醒
 * 执行频率：每 5 分钟
 * 
 * 防重复：使用 notifications 表的唯一性（同一 userId + activityId + type 不重复发送）
 */
export async function processActivityReminder(): Promise<void> {
  const now = new Date();

  // 查找 startAt - 1h < now < startAt 且 active 的活动
  const upcomingActivities = await db
    .select({
      id: activities.id,
      title: activities.title,
      locationName: activities.locationName,
    })
    .from(activities)
    .where(and(
      eq(activities.status, 'active'),
      sql`${activities.startAt} - interval '1 hour' < ${now}`,
      gt(activities.startAt, now),
    ));

  let reminded = 0;
  for (const activity of upcomingActivities) {
    // TODO: 检查是否已发送过提醒（防重复）
    notifyActivityReminder(activity.id, activity.title, activity.locationName).catch(err => {
      console.error(`Failed to send reminder for ${activity.id}:`, err);
    });
    reminded++;
  }

  jobLogger.jobStats('活动前提醒', reminded, 0);
}
```

### 7. 小程序报名后跳转讨论区

```typescript
// apps/miniprogram/subpackages/activity/detail/index.ts
// 修改 onConfirmJoin 方法：

async onConfirmJoin() {
  // ... 现有报名逻辑 ...

  if (response.status === 200) {
    wx.showToast({ title: '报名成功', icon: 'success' });
    this.setData({
      showJoinDialog: false,
      joinMessage: '',
      useFastPass: false,
      participantStatus: 'joined',  // 修正：直接设为 joined
    });

    // v5.0: 报名成功后自动跳转讨论区
    setTimeout(() => {
      wx.navigateTo({
        url: `/subpackages/activity/discussion/index?id=${activityId}`,
      });
    }, 800); // 等 toast 显示后跳转
  }
}
```

### 8. 小程序详情页嵌入讨论区预览

活动详情页在参与者列表下方新增讨论区预览区域，数据来自 `GET /activities/:id/public` 的 `recentMessages` 字段。

```xml
<!-- apps/miniprogram/subpackages/activity/detail/index.wxml - 新增区域 -->

<!-- 讨论区预览 -->
<view class="bg-white rounded-lg p-4 mt-4" wx:if="{{recentMessages.length > 0}}">
  <view class="flex items-center justify-between mb-2">
    <text class="text-base font-bold text-gray-900">讨论区</text>
    <text class="text-sm text-brand" bindtap="onEnterChat">查看更多 ›</text>
  </view>
  <view wx:for="{{recentMessages}}" wx:key="index" class="flex items-start gap-2 mb-2">
    <image class="w-8 h-8 rounded-full" src="{{item.senderAvatar}}" />
    <view class="flex-1">
      <text class="text-xs text-gray-600">{{item.senderNickname}}</text>
      <text class="text-sm text-gray-900 mt-1">{{item.content}}</text>
    </view>
  </view>
</view>
```

### 9. apps/web 目录结构

```
apps/web/
├── app/
│   ├── layout.tsx                 # 根布局
│   ├── page.tsx                   # 首页（重定向到 /chat）
│   ├── invite/
│   │   └── [id]/
│   │       └── page.tsx           # SSR 活动邀请函
│   └── chat/
│       └── page.tsx               # 小聚对话（AI SDK Elements）
├── components/
│   ├── ai-elements/               # AI SDK Elements 组件（copy-paste）
│   │   ├── conversation.tsx
│   │   ├── message.tsx
│   │   ├── reasoning.tsx
│   │   └── prompt-input.tsx
│   ├── invite/                    # 邀请函页面组件
│   │   ├── theme-background.tsx   # React Bits 动态背景渲染器
│   │   ├── activity-card.tsx      # 活动信息卡片
│   │   ├── discussion-preview.tsx # 讨论区预览
│   │   └── wechat-redirect.tsx    # 微信跳转引导
│   └── ui/                        # shadcn/ui 基础组件
├── lib/
│   ├── eden.ts                    # Eden Treaty 客户端（所有 API 调用）
│   ├── themes.ts                  # 预设主题配置（与 API 端同步）
│   └── wechat.ts                  # 微信环境检测工具
├── next.config.ts
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

### 10. 邀请函页面 SSR (`/invite/[id]/page.tsx`)

```typescript
// apps/web/app/invite/[id]/page.tsx
import type { Metadata } from 'next';
import { eden } from '@/lib/eden';
import { resolveThemeConfig } from '@/lib/themes';

// SSR: 生成 OG Meta Tags
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const { data: activity } = await eden.activities({ id: params.id }).public.get();
  if (!activity) return { title: '活动不存在 - 聚场' };

  const vacancy = activity.maxParticipants - activity.currentParticipants;
  const fomoText = vacancy > 0 ? `已有${activity.currentParticipants}人报名` : '已满员';

  return {
    title: `${activity.title} - 聚场邀请你`,
    description: `${fomoText} · ${activity.locationName} · ${formatDate(activity.startAt)}`,
    openGraph: {
      title: activity.title,
      description: `${fomoText} · ${activity.locationName}`,
      url: `https://juchang.app/invite/${params.id}`,
      type: 'website',
    },
  };
}

// SSR: 页面组件
export default async function InvitePage({ params }: { params: { id: string } }) {
  const { data: activity } = await eden.activities({ id: params.id }).public.get();
  if (!activity) return <NotFound />;

  const themeConfig = resolveThemeConfig(activity.theme, activity.themeConfig, activity.type);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <ThemeBackground config={themeConfig} />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg items-center justify-center p-4">
        <ActivityCard activity={activity} themeConfig={themeConfig} />
      </div>
      {activity.recentMessages.length > 0 && (
        <div className="relative z-10 mx-auto max-w-lg px-4 pb-24">
          <DiscussionPreview messages={activity.recentMessages} />
        </div>
      )}
      <WechatRedirect activityId={params.id} />
    </div>
  );
}
```

### 11. 小聚对话页面 (`/chat/page.tsx`)

```typescript
// apps/web/app/chat/page.tsx
'use client';

import { eden } from '@/lib/eden';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { PromptInput, PromptInputTextarea, PromptInputSubmit } from '@/components/ai-elements/prompt-input';
import { useState, useCallback } from 'react';

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // 通过 Eden Treaty 调用 POST /ai/chat（流式响应）
  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    setIsStreaming(true);

    // 添加用户消息
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');

    try {
      // Eden Treaty 调用 AI 端点
      const response = await eden.ai.chat.post({
        message: input,
        stream: true,
      });
      // 处理流式响应...
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming]);

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col">
      <header className="border-b px-4 py-3 text-center font-medium">
        小聚 · 你的 AI 活动助理
      </header>
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.map((message, index) => (
            <Message from={message.role} key={index}>
              <MessageContent>{message.content}</MessageContent>
            </Message>
          ))}
        </ConversationContent>
      </Conversation>
      <PromptInput onSubmit={handleSubmit} className="border-t p-4">
        <PromptInputTextarea
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          placeholder="想找点乐子？还是想约人？跟我说说。"
        />
        <PromptInputSubmit status={isStreaming ? 'streaming' : 'ready'} disabled={!input.trim()} />
      </PromptInput>
    </div>
  );
}
```

### 12. React Bits 动态背景渲染器

```typescript
// apps/web/components/invite/theme-background.tsx
'use client';

import dynamic from 'next/dynamic';
import type { ThemeConfig } from '@/lib/themes';

const BACKGROUND_COMPONENTS = {
  Aurora: dynamic(() => import('react-bits').then(m => m.Aurora), { ssr: false }),
  Ballpit: dynamic(() => import('react-bits').then(m => m.Ballpit), { ssr: false }),
  Particles: dynamic(() => import('react-bits').then(m => m.Particles), { ssr: false }),
  Threads: dynamic(() => import('react-bits').then(m => m.Threads), { ssr: false }),
  Gradient: dynamic(() => import('react-bits').then(m => m.Gradient), { ssr: false }),
  Squares: dynamic(() => import('react-bits').then(m => m.Squares), { ssr: false }),
};

export function ThemeBackground({ config }: { config: ThemeConfig }) {
  const Component = BACKGROUND_COMPONENTS[config.background.component];
  if (!Component) return <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-slate-200" />;
  return (
    <div className="absolute inset-0">
      <Component {...config.background.config} />
    </div>
  );
}
```

### 13. 微信环境检测与跳转

```typescript
// apps/web/lib/wechat.ts
export function isWechatBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  return /MicroMessenger/i.test(navigator.userAgent);
}

export function getMiniProgramUrl(activityId: string): string {
  return `weixin://dl/business/?appid=YOUR_APPID&path=subpackages/activity/detail/index&query=id%3D${activityId}`;
}
```

## Data Models

### 数据库变更汇总

**activities 表新增字段**：
```sql
ALTER TABLE activities ADD COLUMN theme VARCHAR(20) NOT NULL DEFAULT 'auto';
ALTER TABLE activities ADD COLUMN theme_config JSONB;
```

**notification_type 枚举扩展**：
```sql
ALTER TYPE notification_type ADD VALUE 'new_participant';
ALTER TYPE notification_type ADD VALUE 'post_activity';
ALTER TYPE notification_type ADD VALUE 'activity_reminder';
```

## Correctness Properties

### Property 1: 主题解析一致性 (CP-27)

*For any* 活动，`resolveThemeConfig(theme, themeConfig, type)` 必须返回有效的 ThemeConfig：
1. `theme = 'custom'` 且 `themeConfig` 非空 → 返回 themeConfig
2. `theme = 'auto'` → 根据 type 映射到预设主题
3. `theme` 为预设名称 → 返回对应预设
4. 任何未知值 → 返回 minimal 预设

**Validates: Requirements 1, 3**

### Property 2: 公开 API 数据安全 (CP-28)

*For any* `GET /activities/:id/public` 响应，以下字段必须不存在：
1. `creatorId`（用户 ID）
2. `location`（精确 GPS 坐标）
3. 任何用户的 `phoneNumber`、`wxOpenId`

**Validates: Requirement 4.7**

### Property 3: 报名系统消息一致性 (CP-29)

*For any* 成功的 joinActivity 调用：
1. activity_messages 表必须新增一条 `messageType = 'system'` 的消息
2. 所有已报名参与者（不含新加入者和创建者）必须收到 `new_participant` 通知
3. 创建者必须收到 `join` 通知（保持不变）

**Validates: Requirements 5, 6**

### Property 4: Post-Activity 自动完成 (CP-30)

*For any* `status = 'active'` 且 `startAt + 2h < now` 的活动：
1. 定时任务必须将其状态更新为 `completed`
2. 所有参与者必须收到 `post_activity` 通知

**Validates: Requirement 8**

### Property 5: SSR OG 标签完整性 (CP-31)

*For any* `/invite/:id` 页面的 SSR 响应，HTML head 中必须包含：
1. `og:title` = 活动标题
2. `og:description` 包含报名人数信息
3. `og:url` = 当前页面 URL

**Validates: Requirement 12.9**

## Error Handling

### 邀请函页面

| 场景 | 处理方式 |
|------|---------|
| 活动不存在 | 显示 404 页面，引导用户去首页 |
| 活动已取消 | 显示"活动已取消"状态 |
| 活动已结束 | 显示"活动已结束"状态，保留活动信息 |
| API 请求失败 | 显示通用错误页，提供重试按钮 |

### 对话页面

| 场景 | 处理方式 |
|------|---------|
| AI 响应超时 | 显示"网络有点慢，再试一次？" |
| 流式连接断开 | 自动重连，显示重连提示 |
| 频率限制 | 显示"请求太频繁，稍后再试" |

## API Endpoints

### 新增端点

```
GET /activities/:id/public    # 公开活动详情 + 讨论区预览（无需认证）
```

### 复用端点

```
POST /ai/chat                 # AI 对话（SSE 流式响应，web 通过 Eden Treaty 对接）
POST /activities/:id/join     # 报名活动（扩展：系统消息 + 全员通知）
```

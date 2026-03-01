# 聚场 (JuChang)

> **Personal Social Agent** —— AI 碎片化社交找搭子平台
> 
> 不是传统工具，是你的社交秘书。首页即对话，AI 理解意图，动态生成界面。

---

## 🎯 产品定位：从工具到 Agent

| 维度 | 传统社交工具 | 聚场 (Agent as a Service) |
|------|-------------|--------------------------|
| **交互模式** | 用户填表单、点按钮 | 用户说话，AI 理解并执行 |
| **界面生成** | 静态 UI，所有人看到一样的 | **Generative UI**，根据意图动态生成 |
| **服务对象** | 只服务"群主" | 服务每一个人（发起者 + 参与者）|
| **用户关系** | 用完即走 | **记住你**，下次更懂你 |

**核心 Slogan**：想怎么玩？跟小聚说说。

---

## 🏗️ 技术架构全景

### 1. 前端架构：Chat-First + Generative UI

#### 1.1 架构哲学

聚场的前端架构围绕 **"对话即界面"** 的理念设计，彻底颠覆传统 App 的"货架式"交互：

```
传统 App: 首页 → 列表/地图 → 详情页 → 表单 → 提交
聚场:     首页对话 → AI 理解意图 → 动态生成 Widget → 完成
```

**Generative UI（生成式界面）** 是聚场的核心创新：
- AI 根据用户意图，实时生成最合适的界面组件（Widget）
- 同样是"探索附近"，不同用户在不同场景下看到不同的界面形态
- 界面不是静态页面，而是流动的、上下文感知的对话流

#### 1.2 三端架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Layer                                    │
├─────────────────────────────┬─────────────────────────┬─────────────────────┤
│    📱 微信小程序            │    🖥️ Admin 后台         │    🌐 H5 Web 应用   │
│  ┌───────────────────────┐  │  ┌───────────────────┐  │  ┌───────────────┐ │
│  │ Native WXML + TS      │  │  │ Vite + React 19   │  │  │ Next.js 15    │ │
│  │ Zustand Vanilla       │  │  │ TanStack Router   │  │  │ SSR + OG 标签  │ │
│  │ (~2KB 零运行时)       │  │  │ Eden Treaty       │  │  │ AI SDK Elements│ │
│  │ Orval SDK (自动生成)   │  │  │ 类型安全 RPC      │  │  │ React Bits    │ │
│  ├───────────────────────┤  │  ├───────────────────┤  │  ├───────────────┤ │
│  │ Chat-First 架构        │  │  │ AI Playground     │  │  │ 跨平台邀请函   │ │
│  │ • Chat Stream 对话流   │  │  │ • 对话审计        │  │  │ • 动态主题背景 │ │
│  │ • Widget 组件系统      │  │  │ • 用量统计        │  │  │ • 微信一键跳转 │ │
│  │ • AI Dock 超级输入坞   │  │  │ • 热词管理        │  │  │ • H5↔小程序   │ │
│  │ • Hot Chips 热词胶囊   │  │  │ • God View 指挥舱 │  │  │   双向流量     │ │
│  └───────────────────────┘  │  └───────────────────┘  │  └───────────────┘ │
└─────────────────────────────┴─────────────────────────┴─────────────────────┘
```

#### 1.3 小程序架构详解

**Chat Stream 对话流架构** —— 首页即对话：

```
首页结构（去 Tabbar 化）
┌─────────────────────────────────────────────────────────┐
│  [≡]              聚场              [⋮]                │  ← Custom Navbar
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │ 🤖 晚上好～✨ 渣渣辉，今天想约啥？               │   │  ← Widget Dashboard
│  │                                                 │   │     (进场欢迎卡片)
│  │ 📅 今日待参加                                   │   │
│  │ ┌─────────────────────────────────────────┐    │   │
│  │ │ 🍲 观音桥火锅局 · 今晚 19:00            │    │   │
│  │ └─────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│                    Chat Stream                          │  ← 无限滚动对话流
│  ┌─────────────────────────────────────────────────┐   │
│  │ [用户] 明晚观音桥打麻将，3缺1                    │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [AI] 收到！帮你整理一下：                        │   │
│  │ 🀄 观音桥麻将局                                  │   │  ← Widget Draft
│  │ ⏰ 明晚 20:00 · 📍 观音桥                        │   │     (意图解析卡片)
│  │ [确认发布] [调整位置]                            │   │
│  └─────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│  🔥 仙女山  🍲 观音桥火锅  🀄 麻将3缺1               │  ← Hot Chips 热词胶囊
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │ 想找点乐子？还是想约人？跟我说说... [📋] [🎤]  │   │  ← AI Dock
│  └─────────────────────────────────────────────────┘   │     (超级输入坞)
└─────────────────────────────────────────────────────────┘
```

**Widget 组件系统** —— Generative UI 的核心实现：

| Widget | 触发场景 | 功能说明 |
|--------|---------|---------|
| `Widget_Dashboard` | 首次进入/新对话 | 进场欢迎 + 社交档案 + 快捷入口 |
| `Widget_Draft` | AI 识别"创建意图" | 活动草稿卡片，支持地图预览、编辑、发布 |
| `Widget_Share` | 活动发布成功 | 分享引导卡片，一键转发微信 |
| `Widget_Explore` | AI 识别"探索意图" | 附近活动探索，支持 Swiper 滑动、半屏详情 |
| `Widget_Launcher` | 查询"我的活动" | 活动发射台，管理我参与/发起的活动 |
| `Widget_AskPreference` | 信息不足需追问 | 多轮对话偏好询问卡片 |

**Widget 数据架构（A2UI - AI-to-UI）**：

```typescript
// AI Tool 返回的 WidgetChunk 数据结构
interface WidgetChunk {
  messageType: string;           // Widget 类型标识
  payload: Record<string, any>;  // Widget 数据
  fetchConfig?: {                // 引用模式数据源声明
    source: 'nearby_activities' | 'activity_detail' | ...;
    params: Record<string, unknown>;
  };
  interaction?: {                // 交互能力声明
    swipeable?: boolean;         // 是否支持 Swiper 滑动
    halfScreenDetail?: boolean;  // 是否支持半屏详情
    actions?: WidgetAction[];    // 卡内操作按钮
  };
}
```

支持两种数据模式：
- **自包含模式**：数据量小（≤5 条），零请求直接渲染
- **引用模式**：数据量大（>5 条），Widget 自主调用 REST API 获取完整数据

#### 1.4 H5 Web 应用（Digital Ascension 战略）

```
流量模型：外部曝光 → H5 邀请函 → 微信内转化

抖音/小红书/直播间/线下海报
        ↓
  ┌─────────────────────────────────────┐
  │  https://juchang.app/invite/xxx     │  ← H5 邀请函 (SSR + OG 标签)
  │  • React Bits 动态背景               │
  │  • 主题化视觉 (极光/派对/霓虹...)     │
  │  • 社交氛围渲染 (报名人数/讨论预览)   │
  │  • [打开小程序] 一键跳转             │
  └─────────────────────────────────────┘
        ↓
  微信小程序 (报名/参与/讨论)
```

**技术亮点**：
- **SSR 渲染**：Next.js 15 App Router，自动生成 OG meta 标签
- **主题系统**：6 种预设主题（极光/派对/简约/霓虹/暖色/运动），AI 自动匹配
- **动态背景**：React Bits 提供 Aurora、Ballpit、Particles 等动效
- **微信跳转**：智能环境检测，微信内 URL Scheme 跳转，外部显示小程序码

---

### 2. AI 架构：Vercel AI SDK + 模块化设计

#### 2.1 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI Module (AI 模块)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Processor 管线 (v5.1)                            │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │ Input   │ │ Keyword │ │ Intent  │ │ Profile │ │ Semantic    │   │   │
│  │  │ Guard   │ │ Match   │ │ Classify│ │ Inject  │ │ Recall      │   │   │
│  │  │ (P0层)   │ │ (P0层)   │ │ (P1+P2) │ │ (上下文) │ │ (记忆召回)   │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────▼─────────────────────────────────┐    │
│  │                         模型路由层                                   │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │    │
│  │  │ qwen-flash  │  │ qwen-plus   │  │ qwen-max    │  │ deepseek  │ │    │
│  │  │ (极速闲聊)   │  │ (深度思考)   │  │ (Tool Call)│  │ (备选)    │ │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘ │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│                                    │                                        │
│  ┌─────────────────────────────────▼─────────────────────────────────┐    │
│  │                         Agent 执行层                                │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │    │
│  │  │ Tool Call   │  │ Widget Gen  │  │ Stream Out  │  │ Memory    │ │    │
│  │  │ (工具调用)   │  │ (界面生成)   │  │ (流式输出)   │  │ (持久化)   │ │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘ │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│  │ Guardrails  │  │ Workflow    │  │ Evals       │  │ Observability   │   │
│  │ (安全护栏)   │  │ (HITL流程)   │  │ (评估系统)   │  │ (可观测性)       │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 2.2 三层意图识别漏斗 (P0 → P1 → P2)

```
用户输入
    │
    ▼
┌─────────────────┐
│ P0: 全局关键词匹配 │ ← keyword-match-processor
│ (Global Keywords) │   • 完全匹配/前缀匹配/模糊匹配
│  响应: <0.5s      │   • 命中直接返回预设响应，零 AI 成本
└────────┬────────┘
         │ 未命中
         ▼
┌─────────────────┐
│ P1: Feature Combo │ ← intent/feature-combination.ts
│ (规则引擎)        │   • 多信号组合规则匹配
│  置信度 ≥0.7      │   • 可配置化规则，支持动态加载
└────────┬────────┘
         │ 置信度 <0.7
         ▼
┌─────────────────┐
│ P2: LLM Few-shot │ ← intent/llm-classifier.ts
│ (LLM 分类器)     │   • 5-8 个标注样例 Few-shot
│  兜底保障         │   • Edit Distance 缓存 (TTL 5min)
└─────────────────┘
```

**意图类型**：
- `create` - 创建活动 | `explore` - 探索附近 | `manage` - 管理活动
- `partner` - 找搭子 | `chitchat` - 闲聊 | `unknown` - 未知兜底

#### 2.3 记忆系统 (Memory System)

三层记忆架构：

| 记忆类型 | 存储位置 | 功能说明 |
|---------|---------|---------|
| **工作记忆** | `users.workingMemory` (JSONB) | 用户画像、偏好、禁忌、常去地点 |
| **对话历史** | `conversations` + `conversation_messages` | 24h 会话窗口，持久化对话 |
| **语义回忆** | `activities.embedding` (pgvector) | 向量检索相关活动和对话 |

**工作记忆数据结构**：
```typescript
interface EnhancedUserProfile {
  version: 2;
  preferences: EnhancedPreference[];  // 偏好列表，带置信度和时间衰减
  frequentLocations: string[];        // 常去地点
  interestVectors: InterestVector[];  // MaxSim 个性化推荐向量
  lastUpdated: Date;
}

interface EnhancedPreference {
  category: 'activity_type' | 'time' | 'location' | 'social' | 'food';
  sentiment: 'like' | 'dislike' | 'neutral';
  value: string;
  confidence: number;      // 0-1 置信度
  mentionCount: number;    // 提及次数
  updatedAt: Date;         // 用于时间衰减计算
}
```

**时间衰减函数**：偏好有效性随时间递减
```typescript
// 0-7天: 完全有效 (1.0)
// 7-30天: 线性衰减至 0.3
// 30-90天: 线性衰减至 0.1
// >90天: 完全失效 (0)
```

#### 2.4 RAG 语义检索系统

```
用户查询 "想找人一起打羽毛球"
    │
    ▼
┌─────────────────┐
│ 1. 生成查询向量  │ ← Qwen text-embedding-v4 (1536 维)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. Hard Filter   │ ← SQL 过滤 (位置、类型、时间、状态)
│   (SQL 层)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. Soft Rank     │ ← pgvector 余弦相似度排序
│   (向量层)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. MaxSim Boost  │ ← 用户兴趣向量个性化 (相似度>0.5 提升 20%)
│   (个性化层)     │
└────────┬────────┘
         │
         ▼
    返回 ScoredActivity[]
```

**文本富集化**：活动在索引前进行语义增强
```typescript
// 原始: { title: "🏸 羽毛球", type: "sports", startAt: "..." }
// 富集后: "🏸 羽毛球 运动 周三 晚上 活力"
```

#### 2.5 工具系统 (Tool System)

Mastra 风格的 Tool 工厂：

```typescript
export const exploreNearbyTool = createToolFactory<ExploreNearbyParams, ExploreData>({
  name: 'exploreNearby',
  description: '探索附近活动，支持语义搜索',
  parameters: exploreNearbySchema,
  execute: async (params, context) => {
    // context 自动注入 userId, location
    const results = await search({
      semanticQuery: params.semanticQuery,
      filters: { location: params.center },
      userId: context.userId,  // 用于 MaxSim 个性化
    });
    return { 
      success: true, 
      explore: results,
      // 自动生成 WidgetChunk
      widget: buildExploreWidget(results) 
    };
  },
});
```

**工具类型**：
- `createActivityDraft` - 创建活动草稿
- `exploreNearby` - 探索附近活动（RAG 语义搜索）
- `joinActivity` - 报名活动
- `createPartnerIntent` - 创建搭子意向
- `getMyActivities` - 获取我的活动

#### 2.6 模型路由与降级策略

```typescript
// 意图 → 模型映射
function getModelByIntent(intent: 'chat' | 'reasoning' | 'agent' | 'vision') {
  switch (intent) {
    case 'chat':      return qwen('qwen-flash');     // 极速闲聊
    case 'reasoning': return qwen('qwen-plus');      // 深度思考
    case 'agent':     return qwen('qwen-max');       // Tool Calling
    case 'vision':    return qwen('qwen-vl-max');    // 视觉理解
  }
}

// 降级策略：Qwen 失败自动 fallback 到 DeepSeek
const result = await withFallback(
  () => generateText({ model: qwen('qwen-flash'), prompt }),
  () => generateText({ model: deepseek('deepseek-chat'), prompt })
);
```

---

### 3. AI Workflow：从输入到输出的完整链路

#### 3.1 核心流程图

```
用户消息
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 输入层                                                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ 提取消息内容 │ │ 频率限制检查 │ │ P0 热词匹配 │               │
│  │             │ │ (30次/分钟)  │ │ (全局关键词)│               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
└─────────────────────────────┬───────────────────────────────────┘
                              │ 命中 → 直接返回预设响应
                              ▼ 未命中
┌─────────────────────────────────────────────────────────────────┐
│ 处理层 (Processor 管线)                                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ Input Guard │ │ Intent      │ │ User Profile│ │ Semantic  │ │
│  │ (输入护栏)   │ │ Classify    │ │ (用户画像)   │ │ Recall    │ │
│  │ • 敏感词过滤 │ │ (P1+P2)     │ │ • 偏好注入   │ │ (语义召回) │ │
│  │ • 注入检测   │ │ • 三层漏斗   │ │ • 常去地点   │ │ • pgvector │ │
│  │ • 长度限制   │ │             │ │             │ │ • Rerank  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ 执行层 (Agent Execution)                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ LLM 推理    │ │ Tool Call   │ │ Widget Gen  │               │
│  │ (流式输出)   │ │ (工具调用)   │ │ (界面生成)   │               │
│  │ • streamText│ │ • 动态加载   │ │ • A2UI 协议  │               │
│  │ • SSE 传输  │ │ • 执行结果   │ │ • 组件渲染   │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ 输出层                                                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │ 保存对话历史 │ │ 提取偏好    │ │ 记录指标    │ │ 流式响应  │ │
│  │ (conversation│ │ (异步)      │ │ (Token/延迟)│ │ (SSE)     │ │
│  │ _messages)   │ │             │ │             │ │           │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2 HITL (Human-in-the-Loop) 工作流

| 工作流类型 | 场景 | 交互步骤 |
|-----------|------|---------|
| **Draft Flow** | 活动创建 | AI 生成草稿 → 用户确认/修改 → 正式发布 |
| **Match Flow** | 找搭子匹配 | AI 发现匹配 → 双向确认 → 交换联系方式 |
| **Preference Flow** | 信息不足 | AI 追问 → 收集偏好 → 完成意图 |

**找搭子追问流程示例**：
```
用户: "想找人一起打球"
AI: "想玩点什么？" [选项: 羽毛球/篮球/乒乓球]
用户: "羽毛球"
AI: "什么时候有空？" [选项: 今晚/明天/周末]
用户: "今晚"
AI: "在哪附近？" [选项: 观音桥/解放碑/南坪]
用户: "观音桥"
AI: "OK！已为你生成[羽毛球·找搭子意向卡片]，系统将在后台持续寻找匹配..."
```

#### 3.3 安全护栏与可观测性

**安全护栏**：
- **输入检测**：敏感词过滤、注入攻击检测、长度限制
- **输出检测**：内容安全审查、输出格式化
- **频率限制**：30 次/分钟，防止滥用

**可观测性**：
- **追踪 (Tracing)**：完整请求链路追踪，记录每个 Processor 执行时间
- **日志 (Logging)**：结构化日志，支持 `userId`、`intent`、`model` 等维度查询
- **指标 (Metrics)**：
  - Token 用量统计 (input/output)
  - 延迟分布 (P50/P95/P99)
  - 意图分类准确率
  - Tool 调用成功率

---

## 📁 项目结构

```
juchang/
├── apps/
│   ├── miniprogram/          # 微信原生小程序 (Chat-First UI)
│   │   ├── pages/            # 主包页面 (首页/个人中心/消息)
│   │   ├── subpackages/      # 分包
│   │   │   ├── activity/     # 活动详情/创建/确认/探索/讨论区
│   │   │   ├── chat/         # 活动群聊
│   │   │   └── setting/      # 偏好设置
│   │   ├── components/       # 37 个公共组件
│   │   │   ├── ai-dock/          # 超级输入坞
│   │   │   ├── chat-stream/      # 对话流容器
│   │   │   ├── widget-*/         # 各类 Widget 组件
│   │   │   └── hot-chips/        # 热词胶囊
│   │   └── src/
│   │       ├── stores/       # Zustand Vanilla
│   │       └── api/          # Orval 生成的 SDK
│   │
│   ├── admin/                # Vite + React 19 管理后台
│   │   └── src/features/
│   │       ├── dashboard/        # God View 指挥舱
│   │       ├── ai-ops/           # AI Playground/对话审计/用量统计
│   │       ├── hot-keywords/     # P0 层热词管理
│   │       └── safety/           # 风险审核
│   │
│   ├── web/                  # Next.js 15 H5 Web 应用
│   │   ├── app/
│   │   │   ├── invite/[id]/      # SSR 活动邀请函
│   │   │   └── chat/             # H5 版小聚对话
│   │   └── components/
│   │       ├── ai-elements/      # AI SDK Elements
│   │       └── invite/           # 邀请函页面组件
│   │
│   └── api/                  # ElysiaJS API 服务器
│       └── src/modules/
│           ├── ai/               # AI 模块 (核心)
│           │   ├── processors/       # Processor 管线 (v5.1)
│           │   ├── intent/           # 意图识别 (P1+P2)
│           │   ├── memory/           # 记忆系统
│           │   ├── tools/            # Tool 系统
│           │   ├── models/           # 模型路由
│           │   ├── rag/              # RAG 语义检索
│           │   ├── workflow/         # HITL 工作流
│           │   └── guardrails/       # 安全护栏
│           ├── activities/       # 活动 CRUD
│           ├── chat/             # WebSocket 讨论区
│           └── hot-keywords/     # P0 层热词管理
│
├── packages/
│   ├── db/                   # Drizzle ORM (16 张核心表)
│   ├── utils/                # 通用工具
│   └── ts-config/            # TypeScript 配置
│
└── docker/                   # PostgreSQL + PostGIS + pgvector
```

---

## 🚀 快速开始

### 前置要求

- **Bun** >= 1.1.0 ([安装 Bun](https://bun.sh))
- **Docker** (PostgreSQL 数据库)
- **微信开发者工具** (小程序开发)

### 一键启动

```bash
# 克隆并进入项目
git clone <repository-url>
cd juchang

# 一键设置并启动
bun run setup && bun run dev:full
```

### 分步设置

```bash
# 1. 初始化环境变量
bun run env:init

# 2. 安装依赖
bun install

# 3. 启动数据库
bun run docker:up

# 4. 推送 Schema
sleep 5 && bun run db:push

# 5. 启动开发环境
bun run dev:full
```

---

## 🔧 开发命令

```bash
# 开发服务
bun run dev           # 启动所有服务
bun run dev:api       # 仅启动 API
bun run dev:admin     # 仅启动 Admin
bun run dev:web       # 仅启动 Web
bun run dev:full      # API + 自动 SDK 生成

# 数据库
bun run db:migrate    # 执行迁移
bun run db:generate   # 生成迁移文件
bun run db:studio     # Drizzle Studio

# 代码生成
bun run gen:api       # 生成 Orval SDK (小程序)

# Docker
bun run docker:up     # 启动数据库
bun run docker:down   # 停止数据库
```

---

## 🔗 服务地址

| 服务 | 地址 |
|------|------|
| API | http://localhost:3000 |
| OpenAPI | http://localhost:3000/openapi/json |
| Admin | http://localhost:5173 |
| Web | http://localhost:3001 |
| Drizzle Studio | `bun run db:studio` |

---

## 📚 文档

- [PRD 产品需求文档](docs/PRD.md) - 完整产品功能与用户体验设计
- [TAD 技术架构文档](docs/TAD.md) - 完整技术架构、数据库设计、API 设计

---

## 🛠️ 技术栈

| 领域 | 技术选型 | 说明 |
|------|---------|------|
| **小程序** | 微信原生 + TS + LESS + Zustand | 零运行时，极致性能 |
| **Admin** | Vite + React 19 + TanStack Router | Eden Treaty 类型安全 RPC |
| **Web** | Next.js 15 + React 19 + Tailwind CSS 4 | SSR + AI SDK Elements |
| **API** | ElysiaJS + Bun | TypeBox Schema 契约驱动 |
| **数据库** | PostgreSQL + PostGIS + pgvector | LBS + 向量语义搜索 |
| **ORM** | Drizzle ORM + drizzle-typebox | TypeScript Native |
| **AI** | Vercel AI SDK + Qwen3 | Agent 架构 + RAG + Rerank |
| **部署** | Docker + 微信云托管 | 容器化部署 |

---

## 📝 许可证

MIT License

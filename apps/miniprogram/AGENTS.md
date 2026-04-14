---
inclusion: fileMatch
fileMatchPattern: "apps/miniprogram/**/*"
---

# 小程序开发规范

## 🌐 API 调用

### Orval SDK

```bash
# 生成 SDK（需先启动 API）
bun run dev:api
cd apps/miniprogram && bun run gen:api
```

```typescript
import { postAuthWxLogin, getUsersMe, getActivitiesNearby } from '@/api'

// 微信登录
const response = await postAuthWxLogin({ code: 'wx_code' })
if (response.status === 200) {
  wx.setStorageSync('token', response.data.token)
}
```

**禁止**：直接使用 `wx.request`

### 小程序运行时边界

- 小程序不能依赖 Monorepo 中跨端共享的前端运行时实现
- 允许使用 Orval 生成 SDK、生成类型、静态常量；不允许把 Web/Admin 的流处理、状态机、组件行为抽成共享运行时代码再给小程序吃
- 小程序消费 API/SSE/Storage 时，必须在 `apps/miniprogram` 内显式处理协议分支和异常分支

### 测试与回归

- 默认沿用 Bun First，不为小程序链路新增 Jest / Vitest 作为默认测试栈
- 小程序消费协议、页面状态流、SSE/GenUI 承接一旦改动，必须补顶层 `bun scripts/*.ts` 或既有回归，验证真实后端契约和用户流程
- 不要靠页面里的魔法 mock、兜底常量、类型断言把问题压过去；如果回归暴露协议不稳，就回头修 SDK、接口或页面分支本身

---

## 🎨 样式规范

### 原子类优先

```html
<!-- 布局 -->
<view class="flex items-center justify-between">
<view class="flex-col gap-2">

<!-- 间距 (基于 8rpx) -->
<view class="mt-4 mb-2 p-4">

<!-- 文字 -->
<text class="text-lg font-bold text-gray-900">标题</text>
<text class="text-sm text-gray-600">描述</text>

<!-- 容器 -->
<view class="bg-white rounded-lg shadow-sm p-4">
```

### 间距速查

| 类名 | 值 | 用途 |
|------|-----|------|
| `*-1` | 8rpx | 最小间距 |
| `*-2` | 16rpx | 紧凑间距 |
| `*-4` | 32rpx | 标准间距 |
| `*-6` | 48rpx | 宽松间距 |

### 颜色速查

| 类名 | 用途 |
|------|------|
| `text-gray-900` | 主要文字 |
| `text-gray-600` | 次要文字 |
| `text-brand` | 品牌色 (#FF6B35) |
| `bg-gray-50` | 页面背景 |
| `bg-white` | 卡片背景 |

### 禁止事项

```less
// ❌ 禁止魔法数字
.card { padding: 15px; font-size: 13px; }

// ✅ 使用 Design Token
.card { padding: @spacing-4; font-size: @text-sm; }
```

```html
<!-- ❌ 禁止内联样式 -->
<view style="margin-top: 20rpx; color: #666;">

<!-- ✅ 使用原子类 -->
<view class="mt-2 text-gray-600">
```

---

## 📐 TypeScript 类型推导

### 禁止 `helper/helpers` 与类型逃逸

- 禁止新增 `helper/helpers` 命名的文件、目录、函数
- 禁止用通用 helper 包住 `JSON.parse`、SSE 事件、Storage 读取、组件属性读取，然后再用断言强行过类型
- 遇到类型错误，直接改当前页面、store、component 的边界判断和协议分支，不要靠 `as any`、`as unknown as`、万能 helper 兜底

### Page 泛型

```typescript
// ❌ 错误
Page({
  data: {
    notifications: [] as SystemNotification[],
  },
})

// ✅ 正确
interface MessagePageData {
  notifications: SystemNotification[];
}

Page<MessagePageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    notifications: [],
  },
})
```

### Storage 读取

```typescript
// ❌ 错误
const token = wx.getStorageSync('token') as string;

// ✅ 正确
const token = wx.getStorageSync('token') || '';
```

### 事件处理

```typescript
// ❌ 错误
const value = e.detail.value as string;

// ✅ 正确（detail.value 已是 string）
const value = e.detail.value;
```

---

## 📱 局域网调试

```typescript
// 开发环境使用局域网 IP
const BASE_URL = __DEV__ 
  ? 'http://192.168.x.x:3000'
  : 'https://api.xu.example'
```

**微信开发者工具**：勾选「不校验合法域名」

---

## ✅ Checklist

- [ ] API 使用 Orval SDK，禁止 `wx.request`
- [ ] 样式优先使用原子类
- [ ] 禁止魔法数字，使用 Design Token
- [ ] Page 使用泛型定义 data 类型
- [ ] Storage 读取使用默认值

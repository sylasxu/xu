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
  : 'https://api.juchang.com'
```

**微信开发者工具**：勾选「不校验合法域名」

---

## ✅ Checklist

- [ ] API 使用 Orval SDK，禁止 `wx.request`
- [ ] 样式优先使用原子类
- [ ] 禁止魔法数字，使用 Design Token
- [ ] Page 使用泛型定义 data 类型
- [ ] Storage 读取使用默认值

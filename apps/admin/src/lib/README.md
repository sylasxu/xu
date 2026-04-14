# xu Admin Panel API Integration

本文档描述了 xu 管理后台的 API 集成架构，基于 Eden Treaty 和 TypeBox 实现类型安全的 API 通信。

## 架构概览

```
┌─────────────────────────────────────────┐
│           React Admin Panel            │
├─────────────────────────────────────────┤
│         Custom Hooks Layer             │
│  (use-users, use-activities, etc.)     │
├─────────────────────────────────────────┤
│         React Query Layer              │
│    (Caching, Background Updates)       │
├─────────────────────────────────────────┤
│         Eden Treaty Client             │
│      (Type-safe API calls)             │
├─────────────────────────────────────────┤
│         Elysia API Server              │
│      (@xu/api)                    │
└─────────────────────────────────────────┘
```

## 核心组件

### 1. Eden Treaty 客户端 (`eden.ts`)

提供类型安全的 API 调用，包含：
- 自动认证 token 注入
- 统一错误处理
- 响应拦截和处理
- 认证状态管理

```typescript
import { api, apiCall } from '@/lib/eden'

// 类型安全的 API 调用
const users = await apiCall(() => api.users.get({ query: { page: 1 } }))
```

### 2. TypeBox 类型集成 (`typebox.ts`)

定义通用的 API 类型和验证 Schema：
- 分页参数和响应
- 错误响应格式
- 审计日志结构
- 地理位置和时间范围

```typescript
import { PaginationQuery, ApiResponse } from '@/lib/typebox'

const filters: PaginationQuery = {
  page: 1,
  limit: 20,
  search: 'keyword'
}
```

### 3. React Query 集成 (`query-client.ts`)

提供数据缓存和状态管理：
- 智能缓存策略
- 自动重试机制
- 乐观更新支持
- 缓存失效管理

```typescript
import { queryKeys, invalidateQueries } from '@/lib/query-client'

// 失效用户相关缓存
invalidateQueries.users.all()
```

### 4. 通用 API Hooks (`use-api.ts`)

提供可复用的 API 操作模式：
- `useApiList` - 列表查询
- `useApiDetail` - 详情查询
- `useApiCreate` - 创建操作
- `useApiUpdate` - 更新操作
- `useApiDelete` - 删除操作
- `useApiBulkAction` - 批量操作

### 5. 特定功能 Hooks

#### 用户管理 (`use-users.ts`)
- `useUsersList` - 用户列表
- `useUserDetail` - 用户详情
- `useUserModeration` - 用户审核
- `useBulkUserAction` - 批量用户操作

#### 活动管理 (`use-activities.ts`)
- `useActivitiesList` - 活动列表
- `useActivityDetail` - 活动详情
- `useActivityModeration` - 活动审核
- `useModerationQueue` - 审核队列

#### 仪表板分析 (`use-dashboard.ts`)
- `useKPIMetrics` - 实时 KPI 指标
- `useUserAnalytics` - 用户分析
- `useActivityAnalytics` - 活动分析
- `useFinancialAnalytics` - 财务分析

## 使用指南

### 基本数据获取

```typescript
import { useUsersList } from '@/lib/api'

function UsersPage() {
  const { data, isLoading, error } = useUsersList({
    page: 1,
    limit: 20,
    search: 'john',
    isBlocked: false
  })

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage />

  return (
    <DataTable
      data={data?.data || []}
      pagination={data?.pagination}
    />
  )
}
```

### 数据变更操作

```typescript
import { useUserModeration } from '@/lib/api'

function UserActions({ userId }: { userId: string }) {
  const moderation = useUserModeration()

  const handleBlock = async () => {
    await moderation.mutateAsync({
      id: userId,
      data: {
        action: 'block',
        reason: '违反社区规定',
        notes: '多次发布不当内容'
      }
    })
  }

  return (
    <Button 
      onClick={handleBlock}
      loading={moderation.isPending}
    >
      封禁用户
    </Button>
  )
}
```

### 实时数据监控

```typescript
import { useKPIMetrics, useRealTimeAlerts } from '@/lib/api'

function Dashboard() {
  const { data: metrics } = useKPIMetrics() // 30秒自动刷新
  const { data: alerts } = useRealTimeAlerts() // 15秒自动刷新

  return (
    <div>
      <MetricsCards metrics={metrics} />
      <AlertsList alerts={alerts} />
    </div>
  )
}
```

### 批量操作

```typescript
import { useBulkUserAction } from '@/lib/api'

function BulkActions({ selectedIds }: { selectedIds: string[] }) {
  const bulkAction = useBulkUserAction()

  const handleBulkBlock = async () => {
    await bulkAction.mutateAsync({
      ids: selectedIds,
      action: {
        action: 'block',
        reason: '批量处理违规用户'
      }
    })
  }

  return (
    <Button onClick={handleBulkBlock}>
      批量封禁 ({selectedIds.length})
    </Button>
  )
}
```

## 错误处理

### 自动错误处理

所有 API 调用都会自动处理常见错误：

- **401 未授权**: 自动跳转登录页
- **403 权限不足**: 显示权限错误提示
- **422 验证失败**: 显示数据验证错误
- **500 服务器错误**: 显示服务器错误提示

### 自定义错误处理

```typescript
const mutation = useUserModeration({
  onError: (error) => {
    // 自定义错误处理逻辑
    if (error.status === 409) {
      toast.error('用户状态冲突，请刷新页面')
    }
  }
})
```

## 缓存策略

### 自动缓存管理

- **用户数据**: 5分钟缓存
- **活动数据**: 2分钟缓存
- **实时指标**: 30秒缓存，自动刷新
- **统计分析**: 10分钟缓存

### 手动缓存控制

```typescript
import { invalidateQueries, queryClient } from '@/lib/query-client'

// 失效特定缓存
invalidateQueries.users.detail(userId)
invalidateQueries.activities.all()

// 预取数据
queryClient.prefetchQuery({
  queryKey: ['users', 'list', { page: 2 }],
  queryFn: () => api.users.get({ query: { page: 2 } })
})

// 乐观更新
queryClient.setQueryData(['users', userId], (oldData) => ({
  ...oldData,
  status: 'blocked'
}))
```

## 类型安全

### 编译时类型检查

```typescript
// ✅ 正确的 API 调用
const { data } = await api.users.get({
  query: {
    page: 1,        // number
    limit: 20,      // number
    search: 'john', // string
  }
})

// ❌ 编译错误
const { data } = await api.users.get({
  query: {
    page: '1',      // 错误：应该是 number
    invalid: true   // 错误：不存在的属性
  }
})
```

### 响应数据类型推导

```typescript
// 自动推导响应类型
data.forEach(user => {
  console.log(user.id)       // string
  console.log(user.nickname) // string
  console.log(user.invalid)  // ❌ 编译错误
})
```

## 性能优化

### 查询优化

- 使用 `keepPreviousData` 保持分页数据连续性
- 实现虚拟滚动处理大数据量
- 合理设置 `staleTime` 减少不必要的请求

### 网络优化

- 自动请求去重
- 智能重试机制
- 背景数据更新

### 内存优化

- 自动垃圾回收过期缓存
- 按需加载数据
- 合理的缓存大小限制

## 最佳实践

### 1. Hook 命名规范

- `use[Resource]List` - 列表查询
- `use[Resource]Detail` - 详情查询
- `use[Resource][Action]` - 操作类 Hook

### 2. 错误边界处理

```typescript
function DataComponent() {
  const { data, isLoading, error } = useUsersList()

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!data?.data.length) return <EmptyState />

  return <DataTable data={data.data} />
}
```

### 3. 加载状态管理

```typescript
function ActionButton() {
  const mutation = useUserModeration()

  return (
    <Button 
      onClick={() => mutation.mutate(data)}
      disabled={mutation.isPending}
    >
      {mutation.isPending ? '处理中...' : '执行操作'}
    </Button>
  )
}
```

### 4. 权限控制集成

```typescript
import { useAuthStore } from '@/stores/auth-store'

function AdminAction() {
  const { hasPermission } = useAuthStore(state => state.auth)

  if (!hasPermission('users', 'moderate')) {
    return null
  }

  return <ModerationButton />
}
```

## 调试和监控

### 开发环境调试

- React Query DevTools 集成
- 详细的错误日志
- API 调用追踪

### 生产环境监控

- 错误上报集成
- 性能指标收集
- 用户行为分析

## 扩展指南

### 添加新的 API 端点

1. 在 `@xu/api` 中定义新的路由
2. 创建对应的 Hook 文件
3. 添加到 `api.ts` 导出
4. 更新 `queryKeys` 配置

### 自定义缓存策略

```typescript
const customQuery = useQuery({
  queryKey: ['custom', 'data'],
  queryFn: fetchCustomData,
  staleTime: 30 * 60 * 1000, // 30分钟
  gcTime: 60 * 60 * 1000,    // 1小时
  refetchInterval: 5 * 60 * 1000, // 5分钟自动刷新
})
```

### 集成新的数据源

```typescript
const useExternalData = () => {
  return useQuery({
    queryKey: ['external', 'service'],
    queryFn: async () => {
      // 调用外部服务
      const response = await fetch('/external-api')
      return response.json()
    },
    // 自定义配置
  })
}
```

---
inclusion: fileMatch
fileMatchPattern: "apps/admin/**/*"
---

# Admin Console 开发规范

## 🌐 API 调用

### 🚨 API_BASE_URL 统一管理

**禁止在组件中自行定义 API URL**，必须从 `@/lib/eden` 导入：

```typescript
// ❌ 禁止：自行定义 API URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1996'

// ✅ 正确：从 eden 统一导入
import { API_BASE_URL } from '@/lib/eden'
```

### 🚨 必须使用 unwrap() 包装所有 API 调用

Eden Treaty 返回 `{ data, error, status }` 格式，**禁止直接访问 response.data**：

```typescript
// ❌ 错误：直接访问 response.data
const response = await api.users.get({ query: filters })
const users = response.data  // 错误！response 是 { data, error, status }

// ✅ 正确：使用 unwrap() 处理响应和错误
import { api, unwrap } from '@/lib/eden'
const users = await unwrap(api.users.get({ query: filters }))
```

### Eden Treaty + unwrap 模式

```typescript
import { api, unwrap } from '@/lib/eden'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// 列表查询
export function useUsersList(filters: { page?: number; limit?: number; search?: string } = {}) {
  return useQuery({
    queryKey: ['users', filters],
    queryFn: () => unwrap(api.users.get({ query: filters })),
  })
}

// 更新 Mutation
export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => unwrap(api.users({ id }).put(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('用户信息已更新')
    },
    onError: (error: Error) => toast.error(`更新失败: ${error.message}`),
  })
}
```

### 禁止 `helper/helpers` 与类型逃逸

- 禁止新增 `helper/helpers` 命名的文件、目录、函数
- Admin 里的协议消费、调试数据、配置数据，必须在当前 feature 内显式校验，不能靠 `helper` / `any` / `as unknown as` 混过去
- 如果 Eden Treaty 类型没跑通，优先修 API 契约、Eden 推导、当前组件分支，不要写一个通用 helper 层来掩盖错误

### 测试与回归

- 默认沿用 Bun First，不为 Admin 常规回归额外引入 Jest / Vitest 作为默认测试栈
- 影响 PRD / TAD 主流程的 Admin 改动，必须补对应的 `bun scripts/*.ts` 或现有回归脚本，确保真实接口链路没断
- 不要用脱离真实接口契约的 mock shape、魔法默认值、断言灌类型来让测试“看起来正确”

### Toast 规范

```typescript
import { toast } from 'sonner'  // ✅ 正确

// ❌ 禁止使用 shadcn useToast
import { toast } from '@/hooks/use-toast'
```

---

## 📁 页面架构

### 标准目录结构

```
features/{feature-name}/
├── index.tsx                    # 主页面组件
├── components/
│   ├── {feature}-table.tsx      # 表格组件
│   ├── {feature}-columns.tsx    # 表格列定义
│   ├── {feature}-dialogs.tsx    # 弹窗组件
│   └── {feature}-provider.tsx   # 状态管理
```

### 标准页面模板

```tsx
export function FeaturePage() {
  const { data, isLoading, error } = useFeatureData()

  return (
    <FeatureProvider>
      <Header fixed>
        <Search />
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>页面标题</h2>
            <p className='text-muted-foreground'>页面描述</p>
          </div>
          <PrimaryButtons />
        </div>

        {isLoading ? <Skeleton /> : error ? <ErrorState /> : <DataTable data={data} />}
      </Main>

      <FeatureDialogs />
    </FeatureProvider>
  )
}
```

---

## 📊 表格规范

### TanStack Table + 服务端分页

```typescript
const table = useReactTable({
  data,
  columns,
  pageCount,
  state: { pagination, globalFilter },
  manualPagination: true,
  manualFiltering: true,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
})

return (
  <div className='flex flex-1 flex-col gap-4'>
    <DataTableToolbar table={table} searchPlaceholder='搜索...' />
    <div className='overflow-hidden rounded-md border'>
      <Table>{/* 内容 */}</Table>
    </div>
    <DataTablePagination table={table} className='mt-auto' />
  </div>
)
```

### 表格列设计原则

| 原则 | 说明 |
|------|------|
| 单一职责 | 每列只展示一个字段 |
| 列名明确 | 使用具体字段名，禁止"XX信息" |
| 简洁展示 | 文本、Badge，禁止多行 |
| 详情页优先 | 头像、关联数据放详情页 |

**禁止放在表格列**：Avatar、flex-col 多行堆叠、多个 Badge 堆叠

---

## 🔐 认证 (Auth Store)

```typescript
import { useAuthStore } from '@/stores/auth-store'

// ✅ 扁平结构
const { user, setUser, reset, isAuthenticated } = useAuthStore()

// ❌ 禁止嵌套结构
const { auth } = useAuthStore()
```

---

## 🚫 类型派生规则 (Zero Redundancy)

### 🚨 禁止在 Admin 前端导入 `@juchang/db`

`@juchang/db` 包含服务端数据库连接代码，会导致 `Buffer is not defined` 错误：

```typescript
// ❌ 禁止：会导致运行时错误
import { insertUserSchema, selectUserSchema } from '@juchang/db'

// ✅ 正确：从 Eden Treaty 推导所有类型
import { api } from '@/lib/eden'
```

### API 响应类型推导

```typescript
import { api } from '@/lib/eden'

// 推导列表响应类型
type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never
type UsersResponse = ApiResponse<typeof api.users>
export type User = NonNullable<UsersResponse>['data'] extends (infer T)[] ? T : never

// 推导嵌套类型
export type UserStats = User['stats']
```

### 表单 Input 类型推导

```typescript
import { api } from '@/lib/eden'

// 从 API 的 put/post/patch 方法推导 body 类型
type UpdateUserBody = NonNullable<Parameters<ReturnType<typeof api.users>['put']>[0]>
type UserForm = Pick<UpdateUserBody, 'nickname' | 'avatarUrl'>

// 使用推导的类型（无需 TypeBox resolver，API 已做验证）
const form = useForm<UserForm>({
  defaultValues: { nickname: '', avatarUrl: '' },
})
```

### 类型来源优先级

| 优先级 | 类型来源 | 示例 |
|--------|----------|------|
| 1 | Eden Treaty 响应推导 | `ApiResponse<typeof api.users>` |
| 2 | Eden Treaty Input 推导 | `Parameters<ReturnType<typeof api.users>['put']>[0]` |
| 3 | 前端特有类型 | UI 状态、Dialog 类型等 |

**禁止**：直接导入 `@juchang/db`

---

## 📝 表单验证

表单类型从 Eden Treaty 推导，API 层已做验证，前端无需重复定义：

```typescript
import { useForm } from 'react-hook-form'
import { api } from '@/lib/eden'

// 从 Eden 推导表单类型
type UpdateUserBody = NonNullable<Parameters<ReturnType<typeof api.users>['put']>[0]>
type UserForm = Pick<UpdateUserBody, 'nickname' | 'avatarUrl'>

// 无需 resolver，API 会验证
const form = useForm<UserForm>({
  defaultValues: { nickname: currentRow.nickname || '' },
})
```

---

## ✅ Checklist

- [ ] API 调用使用 `unwrap(api.xxx.get(...))`
- [ ] API_BASE_URL 从 `@/lib/eden` 导入，禁止自行定义
- [ ] Toast 使用 `sonner`
- [ ] 表格使用 TanStack Table + `manualPagination: true`
- [ ] 分页使用 `DataTablePagination`
- [ ] 搜索使用 `DataTableToolbar`
- [ ] Header 使用 `fixed` 属性
- [ ] 弹窗抽取为独立组件
- [ ] **禁止导入 `@juchang/db`**（会导致 Buffer 错误）
- [ ] API 响应类型从 Eden Treaty 推导
- [ ] 表单类型从 Eden Treaty 推导（无需 resolver）

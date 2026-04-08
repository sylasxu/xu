// 用户管理相关 Hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/eden'
import { queryKeys } from '@/lib/query-client'
import { toast } from 'sonner'

// 从 Eden Treaty 推导类型
type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never
type UsersResponse = ApiResponse<typeof api.users>

// 导出推导的类型
export type UserListResponse = NonNullable<UsersResponse>
export type User = UserListResponse['data'] extends (infer T)[] ? T : never

// 用户筛选参数类型 (前端特有，允许手动定义)
export interface UserFilters {
  page?: number
  limit?: number
  search?: string
}

// 更新用户请求类型 (前端特有，允许手动定义)
export interface UpdateUserRequest {
  nickname?: string
  avatarUrl?: string
}

// 获取用户列表
export function useUsersList(filters: UserFilters = {}) {
  const { page = 1, limit = 20, search } = filters
  
  return useQuery({
    queryKey: [...queryKeys.users.lists(), { page, limit, search }],
    queryFn: async () => {
      const result = await unwrap(api.users.get({ query: { page, limit, search } }))
      return result
    },
    staleTime: 2 * 60 * 1000,
  })
}

// 获取用户详情
export function useUserDetail(userId: string) {
  return useQuery({
    queryKey: [...queryKeys.users.details(), userId],
    queryFn: () => unwrap(api.users({ id: userId }).get()),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
}

// 更新用户
export function useUpdateUser() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateUserRequest }) => {
      return unwrap(api.users({ id }).put(data))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      toast.success('用户信息已更新')
    },
    onError: (error: Error) => {
      toast.error(`更新失败: ${error.message}`)
    },
  })
}

// 删除用户
export function useDeleteUser() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (id: string) => {
      return unwrap(api.users({ id }).delete())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      toast.success('用户已删除')
    },
    onError: (error: Error) => {
      toast.error(`删除失败: ${error.message}`)
    },
  })
}

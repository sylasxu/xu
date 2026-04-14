/**
 * 用户 Schema - 从 Eden Treaty API 推导
 * 
 * 遵循项目规范：Eden Treaty (Admin) / Orval SDK (小程序)
 * 前端不应直接导入 @xu/db
 */

// 从 Eden Treaty 推导用户类型
import { api } from '@/lib/eden'

type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never
type UsersResponse = ApiResponse<typeof api.users>

// 导出推导的类型
export type User = NonNullable<UsersResponse>['data'] extends (infer T)[] ? T : never

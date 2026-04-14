/**
 * 活动 Schema - 从 Eden Treaty API 推导
 * 
 * 遵循项目规范：Eden Treaty (Admin) / Orval SDK (小程序)
 * 前端不应直接导入 @xu/db
 */

// 从 Eden Treaty 推导活动类型
import { api } from '@/lib/eden'

type ApiResponse<T> = T extends { get: (args?: infer _A) => Promise<{ data: infer R }> } ? R : never
type ActivitiesResponse = ApiResponse<typeof api.activities>

// 导出推导的类型
export type Activity = NonNullable<ActivitiesResponse>['data'] extends (infer T)[] ? T : never

// 活动类型和状态的前端定义（与数据库枚举保持一致）
export type ActivityType = 'food' | 'entertainment' | 'sports' | 'boardgame' | 'other'
export type ActivityStatus = 'draft' | 'active' | 'completed' | 'cancelled'

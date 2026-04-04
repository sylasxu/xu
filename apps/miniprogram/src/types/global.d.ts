/**
 * 全局类型定义
 */

// 应用全局类型
export interface AppGlobalData {
  userInfo?: User
  token?: string
  systemInfo?: WechatMiniprogram.SystemInfo
}

// 用户类型
export interface User {
  id: string
  phoneNumber: string | null
  nickname: string | null
  avatarUrl: string | null
  aiCreateQuotaToday: number
  aiQuotaResetAt: string | null
  createdAt: string
  updatedAt: string
}

// API 响应类型
export interface ApiResponse<T = any> {
  code: number
  msg: string
  data?: T
}

// 分页响应类型
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  totalPages: number
}

// 登录参数
export interface LoginParams {
  code: string
  phoneNumber?: string
  nickname?: string
  avatarUrl?: string
}

// 登录响应
export interface LoginResponse {
  user: User
  token: string
}

// 更新用户参数
export interface UpdateUserParams {
  nickname?: string
  avatarUrl?: string
}

export {}

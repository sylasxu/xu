// Eden Treaty 客户端 - 类型安全的 API 调用
// apps/web 所有 API 调用统一通过此客户端
import { treaty } from '@elysiajs/eden'
import type { App } from '@juchang/api'

// API 基础 URL - 统一导出，禁止其他文件自行定义
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:1996'

// 创建 Eden Treaty 客户端实例
export const api = treaty<App>(API_BASE_URL)

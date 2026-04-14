// Eden Treaty 客户端 - 类型安全的 API 调用
import { treaty } from '@elysiajs/eden'
import type { App } from '@xu/api'
import { toast } from 'sonner'

// API 基础 URL - 统一导出，禁止其他文件自行定义
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:1996'

// 创建 Eden Treaty 客户端实例
export const api = treaty<App>(API_BASE_URL, {
  headers: {
    'Content-Type': 'application/json',
  },
  onRequest: (_path, options) => {
    const token = localStorage.getItem('admin_token')
    if (token) {
      return {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`,
        },
      }
    }
    return options
  },
})

// 认证相关工具函数
export const auth = {
  setToken: (token: string) => localStorage.setItem('admin_token', token),
  getToken: () => localStorage.getItem('admin_token'),
  clearToken: () => localStorage.removeItem('admin_token'),
  isAuthenticated: () => !!localStorage.getItem('admin_token'),
}

function normalizeAdminApiErrorMessage(message: string): string {
  const normalized = message.trim()
  const lowerCased = normalized.toLowerCase()

  if (
    lowerCased.includes('no object generated')
    || lowerCased.includes('could not parse the response')
    || lowerCased.includes('response did not match schema')
  ) {
    return 'AI 这次回包格式不太对，内容还没整理出来，稍后再试一次吧～'
  }

  if (
    lowerCased.includes('invalid api key')
    || lowerCased.includes('incorrect api key')
    || lowerCased.includes('authentication')
    || lowerCased.includes('unauthorized')
    || lowerCased.includes('invalid_api_key')
  ) {
    return 'OpenAI / sub2api 鉴权失败，请检查当前 API Key 是否有效。'
  }

  if (
    lowerCased.includes('free tier of the model has been exhausted')
    || (lowerCased.includes('use free tier only') && lowerCased.includes('management console'))
  ) {
    return '当前上游模型的免费额度已经用完了。去服务商控制台关闭“仅使用免费额度”，或者切到可用模型后再试。'
  }

  if (
    lowerCased.includes('insufficient_quota')
    || lowerCased.includes('quota exceeded')
    || lowerCased.includes('exceeded your current quota')
    || lowerCased.includes('billing')
    || lowerCased.includes('credit balance')
    || lowerCased.includes('balance is not enough')
  ) {
    return 'OpenAI / sub2api 账户余额或账单状态异常，请检查上游账号后再试。'
  }

  if (
    lowerCased.includes('rate limit')
    || lowerCased.includes('too many requests')
    || lowerCased.includes('429')
  ) {
    return 'OpenAI / sub2api 请求过于频繁，请稍后再试。'
  }

  if (
    lowerCased.includes('model not found')
    || lowerCased.includes('does not exist')
    || lowerCased.includes('unknown model')
  ) {
    return '当前模型在 OpenAI / sub2api 不可用，请检查模型 ID。'
  }

  return normalized
}

/**
 * 统一的 API 响应处理器
 * Eden Treaty 返回 { data, error, status } 格式
 * error 结构为 { status, value } 其中 value 是实际的错误数据
 * 
 * 使用方式：
 * const result = await unwrap(api.users.get({ query: { page: 1 } }))
 */
export async function unwrap<T>(
  promise: Promise<{ data: T; error: unknown; status: number }>
): Promise<T> {
  const response = await promise
  
  // 处理错误
  if (response.error) {
    const status = response.status
    
    // 401 未授权 - 跳转登录
    if (status === 401) {
      auth.clearToken()
      window.location.href = '/sign-in'
      throw new Error('未授权访问，请重新登录')
    }
    
    // 提取错误信息
    // Eden Treaty 错误结构: { status: number, value: { code, msg } | string }
    let errorMsg: string = getErrorMessage(status)
    const err = response.error
    
    if (typeof err === 'string') {
      errorMsg = err
    } else if (err && typeof err === 'object') {
      const errObj = err as Record<string, unknown>
      
      // Eden Treaty 将实际错误数据放在 value 字段中
      const value = errObj.value
      if (value && typeof value === 'object') {
        const valueObj = value as Record<string, unknown>
        if (typeof valueObj.msg === 'string') {
          errorMsg = valueObj.msg
        } else if (typeof valueObj.message === 'string') {
          errorMsg = valueObj.message
        }
      } else if (typeof value === 'string') {
        errorMsg = value
      }
      // 直接在 error 对象上查找（兼容其他格式）
      else if (typeof errObj.msg === 'string') {
        errorMsg = errObj.msg
      } else if (typeof errObj.message === 'string') {
        errorMsg = errObj.message
      }
    }
    
    const normalizedErrorMsg = normalizeAdminApiErrorMessage(errorMsg)

    // 显示错误提示
    toast.error(normalizedErrorMsg)
    
    throw new Error(normalizedErrorMsg)
  }
  
  return response.data
}

function getErrorMessage(status: number): string {
  const messages: Record<number, string> = {
    400: '请求参数错误',
    401: '未授权访问',
    403: '权限不足',
    404: '资源不存在',
    409: '操作冲突',
    422: '数据验证失败',
    429: '请求过于频繁',
    500: '服务器内部错误',
    502: '网关错误',
    503: '服务暂时不可用',
  }
  return messages[status] || `请求失败 (${status})`
}

// 兼容旧代码的别名
export const apiCall = unwrap

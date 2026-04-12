/**
 * 微信小程序请求适配器 - Orval Fetch Client Mutator
 * 将 Orval 生成的参数映射到 wx.request
 */

import { API_CONFIG } from '../config/index'

const BASE_URL = API_CONFIG.BASE_URL

type WxRequestHeaders = Record<string, string>

interface WxMutatorResponse<T> {
  data: T
  status: number
  headers: Headers
}

function createHeaders(header: WechatMiniprogram.IAnyObject): Headers {
  if (typeof Headers !== 'undefined') {
    const headers = new Headers()
    Object.entries(header || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return
      }
      headers.set(key, String(value))
    })
    return headers
  }

  return {} as Headers
}

/**
 * 自定义 Mutator 函数
 * 兼容 Orval fetch client 模式
 */
export const wxRequest = <T>(url: string, options?: RequestInit): Promise<T> => {
  return new Promise((resolve, reject) => {
    // 1. 处理 headers
    const token = wx.getStorageSync('token') as string
    const header: WxRequestHeaders = {
      'Content-Type': 'application/json',
    }
    
    // 添加 Token
    if (token) {
      header['Authorization'] = `Bearer ${token}`
    }
    
    // 合并用户传入的 headers
    if (options?.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          header[key] = value
        })
      } else if (Array.isArray(options.headers)) {
        // HeadersInit 数组格式
        options.headers.forEach(([key, value]) => {
          header[key] = value
        })
      } else {
        // Record<string, string> 格式
        Object.assign(header, options.headers)
      }
    }

    // 2. 处理请求体
    // 注意：Orval 在 fetch 模式下，通常已经把 body JSON.stringify 过了
    // wx.request 的 data 支持 string 或 object，所以直接传也可以
    // 但如果你想在控制台看到对象，可以尝试解析回来 (可选)
    let data: string | WechatMiniprogram.IAnyObject | ArrayBuffer | undefined
    if (options?.body) {
      if (typeof options.body === 'string') {
        try {
          data = JSON.parse(options.body)
        } catch (e) {
          // 保持原样
          data = options.body
        }
      } else if (options.body instanceof ArrayBuffer) {
        data = options.body
      } else {
        // FormData, URLSearchParams 等其他类型，转为字符串
        data = String(options.body)
      }
    }

    // 3. 发起请求
    wx.request({
      url: url.startsWith('http') ? url : `${BASE_URL}${url}`,
      method: (options?.method?.toUpperCase() || 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'TRACE' | 'CONNECT',
      data: data,
      header: header,
      success: (res) => {
        const wrappedResponse: WxMutatorResponse<unknown> = {
          data: res.data,
          status: res.statusCode,
          headers: createHeaders(res.header || {}),
        }

        resolve(wrappedResponse as T)
      },
      fail: (err) => {
        reject(err)
      },
    })
  })
}

export default wxRequest

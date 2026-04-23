/**
 * 小程序配置文件
 * 
 * 注意：小程序不支持 .env 文件，所有配置都在这里管理
 * 
 * v3.5 零成本地图方案：
 * - 移除腾讯地图 API Key 依赖
 * - 使用微信原生 API：wx.getLocation, wx.openLocation, wx.chooseLocation, <map>
 * - Widget 中使用位置文字卡片替代静态地图图片
 */

// 环境判断
declare const __wxConfig: { envVersion?: string } | undefined
const isDev = typeof __wxConfig !== 'undefined' && 
  (__wxConfig?.envVersion === 'develop' || __wxConfig?.envVersion === 'trial')

const DEV_HOST = '192.168.50.155'

/**
 * API 配置
 */
export const API_CONFIG = {
  // 开发环境使用局域网 IP + 本地 API 端口，生产环境使用正式域名
  BASE_URL: isDev 
    ? `http://${DEV_HOST}:1996`
    : 'https://api.xu.example',   // TODO: 替换为正式域名
}

/**
 * Admin 配置 (用于 web-view 加载法务页面等)
 */
export const ADMIN_CONFIG = {
  BASE_URL: isDev
    ? `http://${DEV_HOST}:5173`
    : 'https://admin.xu.example', // TODO: 替换为正式域名
}

/**
 * 微信订阅通知配置
 *
 * 注意：
 * - 小程序侧不能读取服务端环境变量，因此模板 ID 需要显式填在这里
 * - 空字符串表示当前环境还未配置，对应场景会自动跳过授权申请
 */
export const WECHAT_NOTIFY_CONFIG = {
  TEMPLATE_IDS: {
    activity_reminder: '_rUIQvfF95KC6IJRIctfsVe9fZz3QZ9mbYdmXhEZFDQ',
    discussion_reply: '',
    post_activity: '',
  },
  SUBSCRIBE_PROMPT_COOLDOWN_MS: 7 * 24 * 60 * 60 * 1000,
}

/**
 * 地图配置 (零成本方案 - 仅使用微信原生 API)
 * 
 * 微信原生 API 不需要 Key：
 * - wx.getLocation() - 获取当前位置
 * - wx.openLocation() - 打开地图导航
 * - wx.chooseLocation() - 选择位置（自带逆地址解析）
 * - <map> 组件 - 原生地图组件
 */
export const MAP_CONFIG = {
  // 默认位置（重庆观音桥）
  DEFAULT_LOCATION: {
    latitude: 29.5647,
    longitude: 106.5507,
    name: '观音桥',
  },
  
  // 地图默认配置
  DEFAULT_SCALE: 16,
}

/**
 * 使用 wx.chooseLocation 选择位置
 * 一步到位：选点 + 获取地址，无需 API Key
 * 
 * @param options 可选的初始位置参数
 */
export function chooseLocation(options?: {
  latitude?: number
  longitude?: number
}): Promise<{
  name: string
  address: string
  latitude: number
  longitude: number
}> {
  return new Promise((resolve, reject) => {
    const params: WechatMiniprogram.ChooseLocationOption = {
      success: (res) => {
        resolve({
          name: res.name || '已选择位置',
          address: res.address || '',
          latitude: res.latitude,
          longitude: res.longitude,
        })
      },
      fail: (err) => {
        // 用户取消选择
        if (err.errMsg?.includes('cancel')) {
          reject(new Error('用户取消选择'))
        } else {
          reject(new Error(err.errMsg || '选择位置失败'))
        }
      },
    }
    
    // 如果提供了初始坐标，设置地图中心点
    if (options?.latitude !== undefined && options?.longitude !== undefined) {
      params.latitude = options.latitude
      params.longitude = options.longitude
    }
    
    wx.chooseLocation(params)
  })
}

/**
 * 打开地图导航
 */
export function openMapNavigation(options: {
  latitude: number
  longitude: number
  name?: string
  address?: string
}): void {
  wx.openLocation({
    latitude: options.latitude,
    longitude: options.longitude,
    name: options.name || '目的地',
    address: options.address || '',
    scale: MAP_CONFIG.DEFAULT_SCALE,
  })
}

/**
 * 获取当前位置
 */
export function getCurrentLocation(): Promise<{
  latitude: number
  longitude: number
}> {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        resolve({
          latitude: res.latitude,
          longitude: res.longitude,
        })
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '获取位置失败'))
      },
    })
  })
}

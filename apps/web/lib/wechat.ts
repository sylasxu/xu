// 微信环境检测工具
// 用于 H5 邀请函页面判断是否在微信内打开，以及生成小程序跳转链接

/**
 * 检测当前浏览器是否为微信内置浏览器
 *
 * SSR 安全：在服务端渲染时（typeof window === 'undefined'）返回 false
 */
export function isWechatBrowser(): boolean {
  if (typeof window === 'undefined') return false
  return /MicroMessenger/i.test(navigator.userAgent)
}

/**
 * 生成微信小程序 URL Scheme 跳转链接
 *
 * 用于微信内环境下，通过 URL Scheme 直接跳转到小程序活动详情页
 * 小程序路径：subpackages/activity/detail/index?id={activityId}
 */
export function getMiniProgramUrl(activityId: string): string {
  const appId = process.env.NEXT_PUBLIC_WECHAT_APPID || 'YOUR_APPID'
  return `weixin://dl/business/?appid=${appId}&path=subpackages/activity/detail/index&query=id%3D${activityId}`
}

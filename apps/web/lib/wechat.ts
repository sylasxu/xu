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

function getWebBaseUrl(): string {
  return process.env.NEXT_PUBLIC_WEB_URL || 'https://juchang.app'
}

function getMiniProgramPath(activityId: string): string {
  return `subpackages/activity/detail/index?id=${activityId}`
}

/**
 * 生成微信小程序 URL Scheme 跳转链接
 *
 * 用于微信内环境下，通过 URL Scheme 直接跳转到小程序活动详情页
 * 小程序路径：subpackages/activity/detail/index?id={activityId}
 */
export function getMiniProgramUrl(activityId: string): string | null {
  const appId = process.env.NEXT_PUBLIC_WECHAT_APPID
  if (!appId) return null

  return `weixin://dl/business/?appid=${appId}&path=subpackages/activity/detail/index&query=id%3D${activityId}`
}

/**
 * 获取非微信环境展示的小程序二维码图片 URL
 *
 * 优先使用环境变量 NEXT_PUBLIC_MINIPROGRAM_QR_URL（可包含 {activityId} 占位符）
 * 否则退化为在线二维码服务，内容为 H5 invite 链接
 */
export function getMiniProgramQrImageUrl(activityId: string): string {
  const configured = process.env.NEXT_PUBLIC_MINIPROGRAM_QR_URL
  if (configured) {
    return configured.includes('{activityId}')
      ? configured.replaceAll('{activityId}', activityId)
      : configured
  }

  const inviteUrl = `${getWebBaseUrl()}/invite/${activityId}`
  const encoded = encodeURIComponent(inviteUrl)
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}`
}

/**
 * 获取当前活动的 H5 邀请函链接
 */
export function getInviteUrl(activityId: string): string {
  return `${getWebBaseUrl()}/invite/${activityId}`
}

/**
 * 获取用于文案展示的小程序路径
 */
export function getMiniProgramPathLabel(activityId: string): string {
  return getMiniProgramPath(activityId)
}

/**
 * 法务页面 - 使用 web-view 加载 Admin 托管的内容
 * 
 * 优势：
 * - 热更新：法务文案改了不用发版
 * - 富文本：Admin 可以用 Markdown 编辑
 * - 统一管理：同一套内容给 H5 和小程序用
 * 
 * 路由参数：
 * - type: user-agreement | privacy-policy | about
 */

import { ADMIN_CONFIG } from '@/config'

Page({
  data: {
    webviewUrl: '',
    loading: true,
    error: false,
  },

  onLoad(options: { type?: string }) {
    const { type = 'user-agreement' } = options
    
    // 构建 Admin 法务页面 URL
    const webviewUrl = `${ADMIN_CONFIG.BASE_URL}/legal/${type}`
    
    this.setData({ webviewUrl })
  },

  /**
   * web-view 加载完成
   */
  onWebviewLoad() {
    this.setData({ loading: false })
  },

  /**
   * web-view 加载失败 - 降级到本地内容
   */
  onWebviewError() {
    this.setData({ 
      loading: false,
      error: true,
    })
    
    wx.showToast({
      title: '加载失败，请稍后重试',
      icon: 'none',
    })
  },

  /**
   * 返回上一页
   */
  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.reLaunch({ url: '/pages/chat/index' })
    }
  },
})

/**
 * 关于 xu 页面
 * Requirements: 8.1, 8.2, 8.3, 8.4
 * 
 * 功能：
 * - 展示 App Logo 和版本信息
 * - 微信群二维码展示
 * - 长按保存二维码功能
 * - 跳转用户协议/隐私政策
 */

interface AboutPageData {
  /** App 版本号 */
  version: string
  /** 微信群二维码图片路径 */
  qrCodeUrl: string
  /** 是否显示二维码预览 */
  showQrPreview: boolean
}

Page<AboutPageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    version: '1.0.0',
    qrCodeUrl: '/static/wechat-group-qr.png', // 需要放置实际的二维码图片
    showQrPreview: false,
  },

  onLoad() {
    // 获取小程序版本信息
    const accountInfo = wx.getAccountInfoSync()
    const version = accountInfo.miniProgram.version || '1.0.0'
    this.setData({ version })
  },

  /**
   * 返回上一页
   */
  onBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.reLaunch({ url: '/pages/chat/index' })
    }
  },

  /**
   * 预览二维码（长按保存）
   * Requirements: 8.3, 8.4
   */
  onPreviewQrCode() {
    const { qrCodeUrl } = this.data
    
    wx.previewImage({
      current: qrCodeUrl,
      urls: [qrCodeUrl],
    })
  },

  /**
   * 保存二维码到相册
   * Requirements: 8.4
   */
  async onSaveQrCode() {
    const { qrCodeUrl } = this.data

    try {
      // 检查相册权限
      const { authSetting } = await wx.getSetting()
      
      if (!authSetting['scope.writePhotosAlbum']) {
        // 请求权限
        try {
          await wx.authorize({ scope: 'scope.writePhotosAlbum' })
        } catch {
          // 用户拒绝，引导去设置页
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许访问相册，才能保存二维码',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting()
              }
            },
          })
          return
        }
      }

      // 保存图片
      await wx.saveImageToPhotosAlbum({
        filePath: qrCodeUrl,
      })

      wx.vibrateShort({ type: 'light' })
      wx.showToast({
        title: '已保存到相册',
        icon: 'success',
      })
    } catch (error) {
      console.error('保存二维码失败:', error)
      wx.showToast({
        title: '保存失败',
        icon: 'none',
      })
    }
  },

  /**
   * 跳转用户协议
   */
  onViewUserAgreement() {
    wx.navigateTo({
      url: '/subpackages/legal/index?type=user-agreement',
    })
  },

  /**
   * 跳转隐私政策
   */
  onViewPrivacyPolicy() {
    wx.navigateTo({
      url: '/subpackages/legal/index?type=privacy-policy',
    })
  },
})

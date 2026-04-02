/**
 * 个人中心页面
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10
 * 
 * Inset Grouped List 风格
 * - Header: 头像、昵称、Slogan
 * - Group 1: [我发布的]、[我参与的]、[已结束活动]
 * - Group 2: [手机绑定]、[隐私设置]
 * - Group 3: [关于聚场]、[意见反馈]
 */

import { useAppStore } from '../../src/stores/app'

// 获取系统信息计算导航栏高度
const systemInfo = wx.getSystemInfoSync()
const menuButtonInfo = wx.getMenuButtonBoundingClientRect()
const navbarHeight = menuButtonInfo.bottom + 8

interface UserInfo {
  id: string
  nickname: string
  avatarUrl: string
  slogan: string
  phoneNumber: string
  activitiesCreatedCount: number
  participationCount: number
}

Page({
  data: {
    navbarHeight,
    user: {
      id: '',
      nickname: '',
      avatarUrl: '',
      slogan: '',
      phoneNumber: '',
      activitiesCreatedCount: 0,
      participationCount: 0,
    } as UserInfo,
    isLoggedIn: false,
    loading: true,
  },

  onLoad() {
    this.loadUserInfo()
  },

  onShow() {
    // 每次显示时刷新用户信息
    this.loadUserInfo()
  },

  /**
   * 加载用户信息
   * Requirements: 8.2
   */
  loadUserInfo() {
    this.setData({ loading: true })
    
    // 从本地存储获取用户信息
    const token = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo') || {}
    
    const isLoggedIn = !!token && !!userInfo.id
    
    this.setData({
      isLoggedIn,
      loading: false,
      user: {
        id: userInfo.id || '',
        nickname: userInfo.nickname || '未登录',
        avatarUrl: userInfo.avatarUrl || '',
        slogan: userInfo.slogan || '在聚场，遇见有趣的人',
        phoneNumber: userInfo.phoneNumber || '',
        activitiesCreatedCount: userInfo.activitiesCreatedCount || 0,
        participationCount: userInfo.participationCount || 0,
      },
    })
  },

  /**
   * 显示登录提示
   */
  showLoginTip() {
    wx.showModal({
      title: '提示',
      content: '登录后可以发布和参与活动',
      confirmText: '去登录',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: '/pages/login/login',
          })
        }
      },
    })
  },

  /**
   * 跳转到我发布的活动
   * Requirements: 8.5
   */
  goToCreated() {
    if (!this.data.isLoggedIn) {
      this.showLoginTip()
      return
    }
    wx.navigateTo({
      url: '/subpackages/activity/list/index?type=created',
    })
  },

  /**
   * 跳转到我参与的活动
   * Requirements: 8.6
   */
  goToJoined() {
    if (!this.data.isLoggedIn) {
      this.showLoginTip()
      return
    }
    wx.navigateTo({
      url: '/subpackages/activity/list/index?type=joined',
    })
  },

  /**
   * 跳转到已结束活动
   * Requirements: 8.7
   */
  goToArchived() {
    if (!this.data.isLoggedIn) {
      this.showLoginTip()
      return
    }
    wx.navigateTo({
      url: '/subpackages/activity/list/index?type=archived',
    })
  },

  /**
   * 跳转到手机绑定
   * Requirements: 8.8, 8.9
   */
  goToBindPhone() {
    if (!this.data.isLoggedIn) {
      this.showLoginTip()
      return
    }
    
    if (this.data.user.phoneNumber) {
      wx.showToast({
        title: '已绑定手机号',
        icon: 'none',
      })
      return
    }
    
    // 显示手机号绑定半屏
    const appStore = useAppStore.getState()
    appStore.showAuthSheet()
  },

  /**
   * 跳转到隐私设置
   * Requirements: 8.8
   */
  goToPrivacy() {
    wx.navigateTo({
      url: '/subpackages/legal/index?type=privacy-policy',
    })
  },

  /**
   * 跳转到关于聚场
   * Requirements: 8.10
   */
  goToAbout() {
    wx.navigateTo({
      url: '/subpackages/legal/index?type=about',
    })
  },

  /**
   * 跳转到意见反馈
   * Requirements: 8.10
   */
  goToFeedback() {
    // 使用微信内置反馈
    wx.openSetting({
      success: () => {},
      fail: () => {
        // 降级方案：跳转到反馈页面
        wx.navigateTo({
          url: '/subpackages/legal/index?type=feedback',
          fail: () => {
            wx.showToast({
              title: '请在设置中反馈',
              icon: 'none',
            })
          },
        })
      },
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
      wx.reLaunch({ url: '/pages/home/index' })
    }
  },
})

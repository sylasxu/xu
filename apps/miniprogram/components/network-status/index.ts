/**
 * Network Status 组件 - 网络状态通知条
 * Requirements: 错误处理, 用户引导
 * 
 * 功能：
 * - 网络断开时显示红色通知条
 * - 网络恢复时自动隐藏
 */

import { useAppStore } from '../../src/stores/app'

interface ComponentData {
  visible: boolean
  networkType: string
  isOnline: boolean
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    offlineText: {
      type: String,
      value: '网络连接已断开',
    },
    retryText: {
      type: String,
      value: '重试',
    },
    restoredToast: {
      type: String,
      value: '网络已恢复',
    },
  },

  data: {
    visible: false,
    networkType: 'unknown',
    isOnline: true,
  },

  lifetimes: {
    attached() {
      // 获取初始网络状态
      this.checkNetworkStatus()
      
      // 监听网络状态变化
      wx.onNetworkStatusChange((res) => {
        this.handleNetworkChange(res.isConnected, res.networkType)
      })
      
      // 订阅 appStore 的网络状态
      useAppStore.subscribe((state) => {
        if (this.data.isOnline !== state.isOnline) {
          this.setData({
            isOnline: state.isOnline,
            networkType: state.networkType,
            visible: !state.isOnline,
          })
        }
      })
    },
  },

  methods: {
    /**
     * 检查网络状态
     */
    checkNetworkStatus() {
      wx.getNetworkType({
        success: (res) => {
          const isOnline = res.networkType !== 'none'
          this.handleNetworkChange(isOnline, res.networkType)
        },
      })
    },

    /**
     * 处理网络状态变化
     */
    handleNetworkChange(isOnline: boolean, networkType: string) {
      const appStore = useAppStore.getState()
      appStore.setNetworkStatus(networkType, isOnline)
      
      this.setData({
        isOnline,
        networkType,
        visible: !isOnline,
      })
      
      // 网络恢复时显示提示
      if (isOnline && this.data.visible) {
        wx.showToast({
          title: this.properties.restoredToast,
          icon: 'success',
          duration: 1500,
        })
      }
    },

    /**
     * 点击重试
     */
    onRetry() {
      this.checkNetworkStatus()
      this.triggerEvent('retry')
    },
  },
})

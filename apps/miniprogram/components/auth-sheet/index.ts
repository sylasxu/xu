/**
 * Auth Sheet 组件 - 半屏登录授权
 * Requirements: 12.2, 12.3, CP-9
 * 
 * 使用 page-container 实现半屏弹出
 * 交互逻辑：
 * - 点击绑定按钮 → bindgetphonenumber 获取 code → 调用 POST /auth/bindPhone
 * - 成功后关闭 sheet，继续原操作（发布/报名）
 * - 失败显示 Toast，保持 sheet 打开
 */

import { postAuthBindPhone } from '../../src/api/endpoints/auth/auth'
import { useUserStore } from '../../src/stores/user'
import { useAppStore } from '../../src/stores/app'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.message === 'string' && value.message.trim()) {
    return value.message
  }

  if (typeof value.msg === 'string' && value.msg.trim()) {
    return value.msg
  }

  return null
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 是否显示（由外部控制）
    show: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    visible: false,
    loading: false,
    agreedPrivacy: false,
  },

  observers: {
    'show': function(show: boolean) {
      this.setData({ visible: show })
    },
  },

  lifetimes: {
    attached() {
      // 订阅 appStore 的 isAuthSheetVisible 状态
      const appStore = useAppStore.getState()
      this.setData({ visible: appStore.isAuthSheetVisible })
      
      // 监听状态变化
      useAppStore.subscribe((state) => {
        if (this.data.visible !== state.isAuthSheetVisible) {
          this.setData({ visible: state.isAuthSheetVisible })
        }
      })
    },
  },

  methods: {
    /**
     * 切换隐私协议勾选状态
     */
    onToggleAgreement() {
      this.setData({ agreedPrivacy: !this.data.agreedPrivacy })
    },

    /**
     * 未勾选协议时点击按钮
     */
    onDisabledTap() {
      wx.showToast({
        title: '请先阅读并同意协议',
        icon: 'none',
      })
    },

    /**
     * 查看用户协议
     */
    onViewUserAgreement() {
      wx.navigateTo({
        url: '/subpackages/legal/index?type=user-agreement',
      })
    },

    /**
     * 查看隐私政策
     */
    onViewPrivacyPolicy() {
      wx.navigateTo({
        url: '/subpackages/legal/index?type=privacy-policy',
      })
    },

    /**
     * 获取手机号回调
     * Requirements: 12.4, 12.5
     */
    async onGetPhoneNumber(e: WechatMiniprogram.ButtonGetPhoneNumber) {
      // 用户拒绝授权
      if (e.detail.errMsg !== 'getPhoneNumber:ok' || !e.detail.code) {
        console.log('用户拒绝授权手机号')
        return
      }

      const { code } = e.detail

      this.setData({ loading: true })

      try {
        // 调用绑定手机号 API
        const response = await postAuthBindPhone({ code })

        if (response.status === 200) {
          // 绑定成功
          const { phoneNumber } = response.data

          // 更新用户信息
          const userStore = useUserStore.getState()
          await userStore.refreshUserInfo()

          // 触感反馈
          wx.vibrateShort({ type: 'light' })

          // 显示成功提示
          wx.showToast({
            title: '绑定成功',
            icon: 'success',
          })

          // 关闭 sheet
          this.closeSheet()

          // 触发成功事件
          this.triggerEvent('success', { phoneNumber })

          // 执行待执行操作
          const appStore = useAppStore.getState()
          const pendingAction = appStore.pendingAction
          if (pendingAction) {
            this.triggerEvent('pendingaction', pendingAction)
            appStore.clearPendingAction()
          }
        } else {
          // 绑定失败
          wx.showToast({
            title: readErrorMessage(response.data) || '绑定失败，请重试',
            icon: 'none',
          })
        }
      } catch (error: unknown) {
        console.error('绑定手机号失败:', error)
        wx.showToast({
          title: error instanceof Error ? error.message : '网络错误，请重试',
          icon: 'none',
        })
      } finally {
        this.setData({ loading: false })
      }
    },

    /**
     * 跳过绑定
     */
    onSkip() {
      this.closeSheet()
      this.triggerEvent('skip')
    },

    /**
     * 关闭前回调
     */
    onBeforeLeave() {
      // 可以在这里做一些清理工作
    },

    /**
     * 关闭后回调
     */
    onAfterLeave() {
      // 重置状态
      this.setData({ agreedPrivacy: false })
    },

    /**
     * 关闭 sheet
     */
    closeSheet() {
      this.setData({ visible: false })
      
      // 更新全局状态
      const appStore = useAppStore.getState()
      appStore.hideAuthSheet()
      
      // 触发关闭事件
      this.triggerEvent('close')
    },
  },
})

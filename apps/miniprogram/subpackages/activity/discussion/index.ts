/**
 * 活动讨论区页面
 * 基于 WebSocket 的实时通讯
 */
import { useDiscussionStore, type DiscussionMessage } from '../../../src/stores/discussion'
import { useUserStore } from '../../../src/stores/user'
import Toast from 'tdesign-miniprogram/toast/index'

// 格式化时间
function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  // 1分钟内
  if (diff < 60 * 1000) {
    return '刚刚'
  }
  
  // 1小时内
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / 60 / 1000)}分钟前`
  }
  
  // 今天
  if (date.toDateString() === now.toDateString()) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
  
  // 昨天
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return `昨天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
  
  // 更早
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

Page({
  data: {
    activityId: '',
    messages: [] as (DiscussionMessage & { formattedTime: string })[],
    onlineCount: 0,
    connectionStatus: 'disconnected' as string,
    isArchived: false,
    error: null as string | null,
    isLoadingMore: false,
    hasMore: true,
    inputValue: '',
    scrollToView: '',
    currentUserId: '',
    isConnected: false,
  },

  // Store 订阅取消函数
  _unsubscribe: null as (() => void) | null,

  onLoad(options: { id?: string }) {
    const activityId = options.id
    if (!activityId) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '活动ID缺失',
        theme: 'error',
      })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    // 获取当前用户 ID
    const userStore = useUserStore.getState()
    const currentUserId = userStore.user?.id || ''

    this.setData({
      activityId,
      currentUserId,
    })

    // 订阅 store 变化
    this._subscribeStore()

    // 连接讨论区
    this._connect()
  },

  onUnload() {
    // 取消订阅
    if (this._unsubscribe) {
      this._unsubscribe()
      this._unsubscribe = null
    }

    // 断开连接
    const store = useDiscussionStore.getState()
    store.disconnect()
  },

  onShow() {
    // 页面显示时检查连接状态
    const store = useDiscussionStore.getState()
    if (store.connectionStatus === 'disconnected' && this.data.activityId) {
      this._connect()
    }
  },

  onHide() {
    // 页面隐藏时可以选择保持连接或断开
    // 这里选择保持连接，让用户切换回来时能看到新消息
  },

  /**
   * 订阅 Store 变化
   */
  _subscribeStore() {
    const store = useDiscussionStore

    this._unsubscribe = store.subscribe((state) => {
      // 格式化消息时间
      const messages = state.messages.map(msg => ({
        ...msg,
        formattedTime: formatTime(msg.createdAt),
      }))

      this.setData({
        messages,
        onlineCount: state.onlineCount,
        connectionStatus: state.connectionStatus,
        isArchived: state.isArchived,
        error: state.error,
        isLoadingMore: state.isLoadingMore,
        hasMore: state.hasMore,
        isConnected: state.connectionStatus === 'connected',
      })

      // 显示错误提示
      if (state.error && state.error !== this.data.error) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: state.error,
          theme: 'error',
        })
        // 清除错误
        store.getState().clearError()
      }

      // 滚动到最新消息
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1]
        this.setData({
          scrollToView: `msg-${lastMsg.id}`,
        })
      }
    })
  },

  /**
   * 连接讨论区
   */
  _connect() {
    const userStore = useUserStore.getState()
    const token = userStore.token

    if (!token) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请先登录',
        theme: 'error',
      })
      setTimeout(() => {
        wx.navigateTo({ url: '/pages/login/index' })
      }, 1500)
      return
    }

    const store = useDiscussionStore.getState()
    store.connect(this.data.activityId, token)
  },

  /**
   * 返回上一页
   */
  onBack() {
    wx.navigateBack()
  },

  /**
   * 输入框变化
   */
  onInput(e: WechatMiniprogram.Input) {
    this.setData({
      inputValue: e.detail.value,
    })
  },

  /**
   * 发送消息
   */
  onSend() {
    const content = this.data.inputValue.trim()
    if (!content) {
      return
    }

    const store = useDiscussionStore.getState()
    store.sendMessage(content)

    // 清空输入框
    this.setData({
      inputValue: '',
    })
  },

  /**
   * 滚动到顶部，加载更多
   */
  onScrollToUpper() {
    const store = useDiscussionStore.getState()
    if (!store.isLoadingMore && store.hasMore) {
      store.loadMore()
    }
  },

  /**
   * 滚动事件
   */
  onScroll() {
    // 可以用于实现"回到底部"按钮等功能
  },
})

/**
 * 活动讨论区页面
 * 基于 WebSocket 的实时通讯
 */
import { postAiTasksDiscussionEntered } from '../../../src/api/endpoints/ai/ai'
import { requestWechatNotificationSubscription } from '../../../src/services/wechat-notification-subscription'
import { useDiscussionStore, type ConnectionStatus, type DiscussionMessage } from '../../../src/stores/discussion'
import { getJoinGuideTitle, getJoinQuickStarters } from '../../../src/utils/join-flow'
import { useUserStore } from '../../../src/stores/user'

interface DiscussionPageData {
  activityId: string
  messages: (DiscussionMessage & { formattedTime: string })[]
  onlineCount: number
  connectionStatus: ConnectionStatus
  isArchived: boolean
  error: string | null
  isLoadingMore: boolean
  hasMore: boolean
  inputValue: string
  scrollToView: string
  currentUserId: string
  isConnected: boolean
  showJoinGuide: boolean
  joinGuideTitle: string
  joinGuideHint: string
  quickStarters: string[]
}

interface DiscussionPageOptions {
  id?: string
  activityId?: string
  entry?: string
  title?: string
}

function decodeOption(value?: string): string {
  if (!value) {
    return ''
  }

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

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

const INITIAL_MESSAGES: DiscussionPageData['messages'] = []
const INITIAL_CONNECTION_STATUS: ConnectionStatus = 'disconnected'
const INITIAL_ERROR: string | null = null
const INITIAL_UNSUBSCRIBE: (() => void) | null = null
const INITIAL_REPORTED_ENTRY = false
const INITIAL_ENTRY = ''
const INITIAL_SUBSCRIBE_REQUESTED = false

Page<DiscussionPageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    activityId: '',
    messages: INITIAL_MESSAGES,
    onlineCount: 0,
    connectionStatus: INITIAL_CONNECTION_STATUS,
    isArchived: false,
    error: INITIAL_ERROR,
    isLoadingMore: false,
    hasMore: true,
    inputValue: '',
    scrollToView: '',
    currentUserId: '',
    isConnected: false,
    showJoinGuide: false,
    joinGuideTitle: '',
    joinGuideHint: '先打个招呼吧，大家更容易接住你。',
    quickStarters: [],
  },

  // Store 订阅取消函数
  _unsubscribe: INITIAL_UNSUBSCRIBE,
  _hasReportedDiscussionEntry: INITIAL_REPORTED_ENTRY,
  _entry: INITIAL_ENTRY,
  _hasRequestedSubscribePrompt: INITIAL_SUBSCRIBE_REQUESTED,

  onLoad(options: DiscussionPageOptions) {
    const activityId = options.id || options.activityId
    if (!activityId) {
      wx.showToast({ title: '活动ID缺失', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    const entry = decodeOption(options.entry)
    const isJoinSuccessEntry = entry === 'join_success'
    const title = decodeOption(options.title)
    this._entry = entry

    // 获取当前用户 ID
    const userStore = useUserStore.getState()
    const currentUserId = userStore.user?.id || ''

    this.setData({
      activityId,
      currentUserId,
      showJoinGuide: isJoinSuccessEntry,
      joinGuideTitle: isJoinSuccessEntry ? getJoinGuideTitle(title) : '',
      quickStarters: isJoinSuccessEntry ? getJoinQuickStarters(title) : [],
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
        wx.showToast({ title: state.error, icon: 'none' })
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
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => {
        wx.navigateTo({ url: '/pages/login/login' })
      }, 1500)
      return
    }

    void this._requestWechatNotificationSubscribe()
    void this._reportDiscussionEntered()

    const store = useDiscussionStore.getState()
    store.connect(this.data.activityId, token)
  },

  async _requestWechatNotificationSubscribe() {
    if (this._hasRequestedSubscribePrompt) {
      return
    }

    const userId = useUserStore.getState().user?.id || null
    const isJoinSuccessEntry = this._entry === 'join_success'
    const scenes = isJoinSuccessEntry
      ? ['discussion_reply', 'activity_reminder', 'post_activity'] as const
      : ['discussion_reply', 'post_activity'] as const

    this._hasRequestedSubscribePrompt = true
    await requestWechatNotificationSubscription({
      scenes: [...scenes],
      userId,
      source: isJoinSuccessEntry ? 'join_success' : 'discussion_first_open',
    })
  },

  async _reportDiscussionEntered() {
    if (this._hasReportedDiscussionEntry || !this.data.activityId) {
      return
    }

    try {
      const response = await postAiTasksDiscussionEntered({
        activityId: this.data.activityId,
        ...(this._entry ? { entry: this._entry } : {}),
      })

      if (response.status === 200) {
        this._hasReportedDiscussionEntry = true
      }
    } catch (error) {
      console.warn('回写 discussion entered 失败', error)
    }
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
      showJoinGuide: false,
    })
  },

  onQuickStarterTap(e: WechatMiniprogram.TouchEvent) {
    const starter = e.currentTarget.dataset.starter
    if (!starter || typeof starter !== 'string') {
      return
    }

    this.setData({
      inputValue: starter,
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

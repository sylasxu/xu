/**
 * 首页 (Chat-First 架构)
 * Requirements: 1.1, 1.2, 1.3, 1.4, 3.2
 * v3.7 重构: 使用 useChatStore 统一 AI 对话管理
 * 
 * 三层结构：Custom_Navbar + Chat_Stream + AI_Dock
 * - 首次进入显示 Widget_Dashboard（调用 /ai/welcome API）
 * - 集成 useChatStore（类似 @ai-sdk/react 的 useChat）
 * - 实现空气感渐变背景
 */
import { useChatStore, type UIMessage } from '../../src/stores/chat'
import { useHomeStore } from '../../src/stores/home'
import { useAppStore } from '../../src/stores/app'
import { useUserStore } from '../../src/stores/user'
import { getWelcomeCard, getUserLocation, type WelcomeResponse, type QuickItem } from '../../src/services/welcome'
import type { ShareActivityData, SendEventDetail } from '../../src/types/global'
import { getHotKeywords } from '../../src/api/endpoints/hot-keywords/hot-keywords'
import type { HotKeywordsListResponseItemsItem } from '../../src/api/model'

const DEFAULT_COMPOSER_PLACEHOLDER = '你想找什么活动？'

// 页面数据类型
interface PageData {
  // 从 useChatStore 同步
  messages: UIMessage[]
  status: 'idle' | 'submitted' | 'streaming'
  streamingMessageId: string | null
  
  // 页面 UI 状态
  userNickname: string
  isAuthSheetVisible: boolean
  isShareGuideVisible: boolean
  shareGuideData: { activityId?: string; title?: string; mapUrl?: string } | null
  scrollToView: string
  
  // 欢迎卡片 (v3.10 新结构)
  welcomeData: WelcomeResponse | null
  isWelcomeLoading: boolean
  composerPlaceholder: string
  
  // 热词列表 (v4.7 全局关键词系统)
  hotKeywords: HotKeywordsListResponseItemsItem[]
}

Page<PageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    messages: [],
    status: 'idle',
    streamingMessageId: null,
    userNickname: '搭子',
    isAuthSheetVisible: false,
    isShareGuideVisible: false,
    shareGuideData: null,
    scrollToView: '',
    welcomeData: null,
    isWelcomeLoading: false,
    composerPlaceholder: DEFAULT_COMPOSER_PLACEHOLDER,
    hotKeywords: [],
  },

  unsubscribeChat: null as (() => void) | null,
  unsubscribeApp: null as (() => void) | null,
  unsubscribeUser: null as (() => void) | null,
  userLocation: null as { lat: number; lng: number } | null,

  onLoad() {
    this.subscribeChatStore()
    this.subscribeAppStore()
    this.subscribeUserStore()
    this.initChat()
    this.loadUserInfo()
    this.loadHotKeywords()
  },

  onShow() {
    this.loadUserInfo()
  },

  onUnload() {
    this.unsubscribeChat?.()
    this.unsubscribeApp?.()
    this.unsubscribeUser?.()
    // 停止正在进行的流式输出
    useChatStore.getState().stop()
  },

  onHide() {
    // 页面隐藏时停止流式输出
    useChatStore.getState().stop()
  },

  /**
   * 订阅 useChatStore 状态变化
   */
  subscribeChatStore() {
    const chatStore = useChatStore.getState()
    this.setData({
      messages: chatStore.messages,
      status: chatStore.status,
      streamingMessageId: chatStore.streamingMessageId,
    })
    
    this.unsubscribeChat = useChatStore.subscribe((state) => {
      this.setData({
        messages: state.messages,
        status: state.status,
        streamingMessageId: state.streamingMessageId,
      })
      
      // 自动滚动到最新消息
      if (state.messages.length > 0) {
        const lastMsg = state.messages[state.messages.length - 1]
        this.setData({ scrollToView: `msg-${lastMsg.id}` })
      }
    })
  },

  subscribeAppStore() {
    const appStore = useAppStore.getState()
    this.setData({
      isAuthSheetVisible: appStore.isAuthSheetVisible,
      isShareGuideVisible: appStore.isShareGuideVisible,
      shareGuideData: appStore.shareGuideData,
    })
    this.unsubscribeApp = useAppStore.subscribe((state) => {
      this.setData({
        isAuthSheetVisible: state.isAuthSheetVisible,
        isShareGuideVisible: state.isShareGuideVisible,
        shareGuideData: state.shareGuideData,
      })
    })
  },

  subscribeUserStore() {
    const userStore = useUserStore.getState()
    if (userStore.user) {
      this.setData({ userNickname: userStore.user.nickname || '搭子' })
    }
    this.unsubscribeUser = useUserStore.subscribe((state) => {
      if (state.user) {
        this.setData({ userNickname: state.user.nickname || '搭子' })
      }
    })
  },

  /**
   * 初始化对话
   */
  async initChat() {
    const chatStore = useChatStore.getState()
    
    // 如果没有消息，显示欢迎卡片
    if (chatStore.messages.length === 0) {
      await this.showDashboard()
    }
    
    // 获取用户位置并设置到 store
    if (!this.userLocation) {
      this.userLocation = await getUserLocation()
      if (this.userLocation) {
        chatStore.setLocation(this.userLocation)
      }
    }
  },

  async loadUserInfo() {
    const userStore = useUserStore.getState()
    if (userStore.user) {
      this.setData({ userNickname: userStore.user.nickname || '搭子' })
    }
  },

  /**
   * 加载热词列表 - Requirements: 3.7, 3.8, 3.9
   */
  async loadHotKeywords() {
    try {
      const response = await getHotKeywords({ limit: 5 })
      
      if (response.status === 200) {
        this.setData({ hotKeywords: response.data.items })
        
        // 埋点：记录热词曝光事件 - Requirements: 3.9
        if (response.data.items.length > 0) {
          wx.reportEvent('hot_chip_show', {
            keyword_count: response.data.items.length,
            keywords: response.data.items
              .map((k: HotKeywordsListResponseItemsItem) => k.keyword)
              .join(','),
          })
        }
      }
    } catch (error) {
      console.error('[Home] Failed to load hot keywords:', error)
      // 静默失败，不影响主流程
    }
  },

  /**
   * 显示欢迎卡片
   * v4.4: 增加社交档案和快捷入口
   */
  async showDashboard() {
    const chatStore = useChatStore.getState()
    
    this.setData({ isWelcomeLoading: true })
    
    try {
      if (!this.userLocation) {
        this.userLocation = await getUserLocation()
      }
      
      const welcomeData = await getWelcomeCard(
        this.userLocation ? { lat: this.userLocation.lat, lng: this.userLocation.lng } : undefined
      )

      const composerPlaceholder =
        typeof welcomeData.ui?.composerPlaceholder === 'string' && welcomeData.ui.composerPlaceholder.trim()
          ? welcomeData.ui.composerPlaceholder.trim()
          : DEFAULT_COMPOSER_PLACEHOLDER
      
      this.setData({ 
        welcomeData,
        isWelcomeLoading: false,
        composerPlaceholder,
      })
      
      // 使用 useChatStore 添加 Dashboard Widget (v4.4 新结构)
      chatStore.addWidgetMessage('dashboard', {
        nickname: this.data.userNickname,
        greeting: welcomeData.greeting,
        subGreeting: welcomeData.subGreeting,
        sections: welcomeData.sections,
        socialProfile: welcomeData.socialProfile,
        quickPrompts: welcomeData.quickPrompts,
        ui: welcomeData.ui,
      })
    } catch (error) {
      console.error('[Home] Failed to load welcome card:', error)
      this.setData({ isWelcomeLoading: false })
      
      // 降级：使用本地欢迎卡片
      chatStore.addWidgetMessage('dashboard', {
        nickname: this.data.userNickname,
      })
    }
  },

  /**
   * 新对话
   */
  async onNewChat() {
    const chatStore = useChatStore.getState()
    chatStore.clearMessages()
    
    // 同时清空服务端历史
    try {
      await useHomeStore.getState().clearMessages()
    } catch (e) {
      console.error('[Home] Failed to clear server messages:', e)
    }
    
    await this.showDashboard()
  },

  /**
   * 发送消息
   */
  onSend(e: WechatMiniprogram.CustomEvent<{ text: string }>) {
    const { text } = e.detail
    if (!text?.trim()) return
    
    const chatStore = useChatStore.getState()
    chatStore.sendMessage(text)
  },

  onParse(_e: WechatMiniprogram.CustomEvent<{ text: string }>) {
    // 防抖已在 ai-dock 组件中处理
  },

  onPaste(_e: WechatMiniprogram.CustomEvent<{ text: string }>) {
    // 粘贴后自动触发解析
  },

  onDashboardActivityTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const { id } = e.detail
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${id}` })
  },

  onDashboardPromptTap(e: WechatMiniprogram.CustomEvent<{ prompt: string }>) {
    const { prompt } = e.detail
    const aiDock = this.selectComponent('#aiDock')
    if (aiDock) {
      aiDock.setValue(prompt)
    }
    this.onSend({ detail: { text: prompt } } as WechatMiniprogram.CustomEvent<SendEventDetail>)
  },

  /**
   * 处理快捷项点击 (v3.10 新结构)
   */
  onDashboardQuickItemTap(e: WechatMiniprogram.CustomEvent<{ item: QuickItem }>) {
    const { item } = e.detail
    console.log('[Home] Quick item tap:', item)
    // prompttap 事件会自动触发，这里只做日志
  },

  /**
   * 查看全部活动 (v4.4 新增)
   */
  onDashboardViewAll() {
    wx.navigateTo({ url: '/subpackages/activity/list/index?type=joined' })
  },

  resolveSlotFromStartAt(startAt: string): string {
    if (!startAt) {
      return 'fri_20_00'
    }

    const date = new Date(startAt)
    if (Number.isNaN(date.getTime())) {
      return 'fri_20_00'
    }

    const hour = date.getHours()
    if (hour <= 19) {
      return 'fri_19_00'
    }

    if (hour >= 21) {
      return 'fri_21_00'
    }

    return 'fri_20_00'
  },

  buildPublishPayloadFromDraft(draft: any): Record<string, unknown> {
    const location = Array.isArray(draft?.location) ? draft.location : [106.52988, 29.58567]
    const [lng, lat] = location

    return {
      activityId: draft?.activityId || '',
      title: draft?.title || '周五活动局',
      type: draft?.type || 'other',
      activityType: draft?.type || 'other',
      startAt: draft?.startAt || '2026-03-06T20:00:00+08:00',
      locationName: draft?.locationName || '观音桥',
      locationHint: draft?.locationHint || `${draft?.locationName || '观音桥'}商圈`,
      maxParticipants: draft?.maxParticipants || 6,
      currentParticipants: draft?.currentParticipants || 1,
      lat: Number(lat) || 29.58567,
      lng: Number(lng) || 106.52988,
      slot: this.resolveSlotFromStartAt(draft?.startAt || ''),
    }
  },

  onExploreExpandMap(_e: WechatMiniprogram.CustomEvent<{ results: any[]; center: any }>) {
    // 由 widget-explore 组件内部处理跳转
  },

  onAuthSuccess(_e: WechatMiniprogram.CustomEvent<{ phoneNumber: string }>) {
    this.loadUserInfo()
  },

  onPendingAction(e: WechatMiniprogram.CustomEvent<{ type: string; payload: any }>) {
    const { type, payload } = e.detail
    if (type !== 'publish' || !payload?.draft) {
      return
    }

    const chatStore = useChatStore.getState()
    chatStore.sendAction({
      action: 'confirm_publish',
      payload: this.buildPublishPayloadFromDraft(payload.draft),
      source: 'auth_sheet',
      originalText: '确认发布',
    })
  },

  shareActivityData: null as ShareActivityData | null,

  onWidgetShareTap(e: WechatMiniprogram.CustomEvent<{ activity: any; shareTitle: string }>) {
    const { activity, shareTitle } = e.detail
    this.shareActivityData = { ...activity, shareTitle }
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    if (this.shareActivityData) {
      const activity = this.shareActivityData
      const shareTitle = activity.shareTitle || `🔥 ${activity.title}，快来！`
      const result = {
        title: shareTitle,
        path: `/subpackages/activity/detail/index?id=${activity.id}&share=1`,
        imageUrl: '',
      }
      this.shareActivityData = null
      return result
    }
    return {
      title: '聚场 - 想怎么玩？跟小聚说说',
      path: '/pages/home/index',
    }
  },

  onShareTimeline() {
    return {
      title: '聚场 - 你的 AI 活动助理',
    }
  },

  /**
   * 错误重试
   */
  onWidgetErrorRetry(e: WechatMiniprogram.CustomEvent) {
    const originalText = e.currentTarget.dataset.originalText
    if (originalText) {
      const chatStore = useChatStore.getState()
      chatStore.sendMessage(originalText)
    }
  },

  /**
   * 处理 Widget_Ask_Preference 选项选择
   */
  onAskPreferenceSelect(e: WechatMiniprogram.CustomEvent<{
    questionType: 'location' | 'type';
    selectedOption: { label: string; value: string };
    collectedInfo?: { location?: string; type?: string };
  }>) {
    // Widget 内部已通过 sendAction 发送结构化请求，这里仅保留事件用于埋点/扩展。
    const { selectedOption, questionType } = e.detail
    wx.reportEvent('ask_preference_select', {
      question_type: questionType,
      option_label: selectedOption?.label || '',
      option_value: selectedOption?.value || '',
    })
  },

  /**
   * 处理 Widget_Ask_Preference 跳过按钮
   */
  onAskPreferenceSkip(_e: WechatMiniprogram.CustomEvent<{
    questionType: 'location' | 'type';
    collectedInfo?: { location?: string; type?: string };
  }>) {
    // Widget 内部已通过 sendAction 发送结构化请求，这里仅保留埋点。
    wx.reportEvent('ask_preference_skip', {
      source: 'widget_ask_preference',
    })
  },

  onNetworkRetry() {
    this.initChat()
  },

  /**
   * 处理热词点击 - Requirements: 3.5, 3.6, 3.11
   */
  onHotChipClick(e: WechatMiniprogram.CustomEvent<{ id: string; keyword: string }>) {
    const { keyword } = e.detail
    
    // 发送消息到 AI
    const chatStore = useChatStore.getState()
    chatStore.sendMessage(keyword)
  },
})

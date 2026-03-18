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
import {
  useAppStore,
  type MessageCenterFocusIntent,
  type PendingActionAuthMode,
  type StructuredPendingAction,
} from '../../src/stores/app'
import { useUserStore } from '../../src/stores/user'
import { getWelcomeCard, getUserLocation, type WelcomeResponse, type QuickItem } from '../../src/services/welcome'
import { postActivityRebookFollowUp } from '../../src/services/activity-outcome'
import type {
  ActivityData,
  ActivityStatus,
  ActivityType,
  ShareActivityData,
} from '../../src/types/global'
import { getHotKeywords } from '../../src/api/endpoints/hot-keywords/hot-keywords'
import { getAiTasksCurrent } from '../../src/api/endpoints/ai/ai'
import type { HotKeywordsListResponseItemsItem } from '../../src/api/model'

const DEFAULT_COMPOSER_PLACEHOLDER = '你想找什么活动？'

type CurrentTaskActionKind = 'structured_action' | 'navigate' | 'switch_tab'

interface CurrentTaskAction {
  kind: CurrentTaskActionKind
  label: string
  action?: string
  payload?: Record<string, unknown>
  source?: string
  originalText?: string
  url?: string
}

interface CurrentTaskItem {
  id: string
  taskType: 'join_activity' | 'find_partner' | 'create_activity'
  taskTypeLabel: string
  currentStage: string
  stageLabel: string
  status: string
  goalText: string
  headline: string
  summary: string
  updatedAt: string
  activityId?: string
  activityTitle?: string
  primaryAction?: CurrentTaskAction
  secondaryAction?: CurrentTaskAction
}

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

  // 当前 Agent 任务承接
  currentTasks: CurrentTaskItem[]
}

interface HomePageOptions {
  prefill?: string;
}

interface AiDockComponent {
  setValue: (value: string) => void;
}

interface TaskChatPromptPayload {
  prompt: string
  activityId?: string
  followUpMode?: 'review' | 'rebook' | 'kickoff'
  entry?: string
}

function readMessageCenterFocusIntent(value: unknown): MessageCenterFocusIntent | null {
  if (!isRecord(value)) {
    return null
  }

  const taskId = typeof value.taskId === 'string' && value.taskId.trim() ? value.taskId.trim() : undefined
  const matchId = typeof value.matchId === 'string' && value.matchId.trim() ? value.matchId.trim() : undefined

  if (!taskId && !matchId) {
    return null
  }

  return {
    ...(taskId ? { taskId } : {}),
    ...(matchId ? { matchId } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readAiDockComponent(value: unknown): AiDockComponent | null {
  if (!isRecord(value)) {
    return null;
  }

  const setValue = value.setValue;
  if (typeof setValue !== 'function') {
    return null;
  }

  return {
    setValue: (nextValue: string) => {
      setValue.call(value, nextValue);
    },
  };
}

function readActivityType(value: unknown): ActivityType | null {
  switch (value) {
    case 'food':
    case 'entertainment':
    case 'sports':
    case 'boardgame':
    case 'other':
      return value;
    default:
      return null;
  }
}

function readActivityStatus(value: unknown): ActivityStatus | null {
  switch (value) {
    case 'draft':
    case 'active':
    case 'completed':
    case 'cancelled':
      return value;
    default:
      return null;
  }
}

function readPendingActionAuthMode(value: unknown): PendingActionAuthMode | null {
  return value === 'login' || value === 'bind_phone' ? value : null
}

function readStructuredPendingAction(value: unknown): StructuredPendingAction | null {
  if (!isRecord(value) || value.type !== 'structured_action' || typeof value.action !== 'string' || !isRecord(value.payload)) {
    return null
  }

  const authMode = readPendingActionAuthMode(value.authMode)

  return {
    type: 'structured_action',
    action: value.action,
    payload: value.payload,
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.originalText === 'string' ? { originalText: value.originalText } : {}),
    ...(authMode ? { authMode } : {}),
  }
}

function readLocationPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const lng = readNumber(value[0]);
  const lat = readNumber(value[1]);
  if (lng === null || lat === null) {
    return null;
  }

  return [lng, lat];
}

function readCurrentTaskAction(value: unknown): CurrentTaskAction | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.label !== 'string') {
    return null
  }

  if (value.kind !== 'structured_action' && value.kind !== 'navigate' && value.kind !== 'switch_tab') {
    return null
  }

  return {
    kind: value.kind,
    label: value.label,
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(isRecord(value.payload) ? { payload: value.payload } : {}),
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.originalText === 'string' ? { originalText: value.originalText } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
  }
}

function readCurrentTaskItem(value: unknown): CurrentTaskItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.taskType !== 'string' ||
    typeof value.taskTypeLabel !== 'string' ||
    typeof value.currentStage !== 'string' ||
    typeof value.stageLabel !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.goalText !== 'string' ||
    typeof value.headline !== 'string' ||
    typeof value.summary !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null
  }

  if (value.taskType !== 'join_activity' && value.taskType !== 'find_partner' && value.taskType !== 'create_activity') {
    return null
  }

  const primaryAction = readCurrentTaskAction(value.primaryAction)
  const secondaryAction = readCurrentTaskAction(value.secondaryAction)

  return {
    id: value.id,
    taskType: value.taskType,
    taskTypeLabel: value.taskTypeLabel,
    currentStage: value.currentStage,
    stageLabel: value.stageLabel,
    status: value.status,
    goalText: value.goalText,
    headline: value.headline,
    summary: value.summary,
    updatedAt: value.updatedAt,
    ...(typeof value.activityId === 'string' ? { activityId: value.activityId } : {}),
    ...(typeof value.activityTitle === 'string' ? { activityTitle: value.activityTitle } : {}),
    ...(primaryAction ? { primaryAction } : {}),
    ...(secondaryAction ? { secondaryAction } : {}),
  }
}

function readTaskChatPromptPayload(value: unknown): TaskChatPromptPayload | null {
  if (!isRecord(value) || typeof value.prompt !== 'string' || !value.prompt.trim()) {
    return null
  }

  const followUpMode =
    value.followUpMode === 'review' || value.followUpMode === 'rebook' || value.followUpMode === 'kickoff'
      ? value.followUpMode
      : undefined

  return {
    prompt: value.prompt.trim(),
    ...(typeof value.activityId === 'string' && value.activityId.trim() ? { activityId: value.activityId.trim() } : {}),
    ...(followUpMode ? { followUpMode } : {}),
    ...(typeof value.entry === 'string' && value.entry.trim() ? { entry: value.entry.trim() } : {}),
  }
}

function readShareActivityData(value: unknown): ActivityData | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const creatorId = readString(value.creatorId);
  const title = readString(value.title);
  const locationName = readString(value.locationName);
  const locationHint = readString(value.locationHint);
  const startAt = readString(value.startAt);
  const type = readString(value.type);
  const status = readString(value.status);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);
  const maxParticipants = readNumber(value.maxParticipants);
  const currentParticipants = readNumber(value.currentParticipants);
  const location = readLocationPair(value.location);

  if (
    !id ||
    !creatorId ||
    !title ||
    !location ||
    !locationName ||
    !locationHint ||
    !startAt ||
    !type ||
    !status ||
    !createdAt ||
    !updatedAt ||
    maxParticipants === null ||
    currentParticipants === null
  ) {
    return null;
  }

  return {
    id,
    creatorId,
    title,
    description: readString(value.description) ?? undefined,
    location,
    locationName,
    address: readString(value.address) ?? undefined,
    locationHint,
    startAt,
    type: readActivityType(type) || 'other',
    maxParticipants,
    currentParticipants,
    status: readActivityStatus(status) || 'active',
    createdAt,
    updatedAt,
    isArchived: typeof value.isArchived === 'boolean' ? value.isArchived : undefined,
    creator: null,
  };
}

const INITIAL_UNSUBSCRIBE: (() => void) | null = null;
const INITIAL_USER_LOCATION: { lat: number; lng: number } | null = null;
const INITIAL_SHARE_ACTIVITY_DATA: ShareActivityData | null = null;

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
    currentTasks: [],
  },

  unsubscribeChat: INITIAL_UNSUBSCRIBE,
  unsubscribeApp: INITIAL_UNSUBSCRIBE,
  unsubscribeUser: INITIAL_UNSUBSCRIBE,
  userLocation: INITIAL_USER_LOCATION,
  lastChatStatus: 'idle' as PageData['status'],
  lastUserId: '',

  onLoad(options: HomePageOptions) {
    this.subscribeChatStore()
    this.subscribeAppStore()
    this.subscribeUserStore()
    this.initChat()
    this.loadUserInfo()
    this.loadCurrentTasks()
    this.loadHotKeywords()
    this.applyPrefillPrompt(options.prefill)
  },

  onShow() {
    this.loadUserInfo()
    this.loadCurrentTasks()
    this.resumePendingActionIfReady()
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
    this.lastChatStatus = chatStore.status
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

      if (this.lastChatStatus !== 'idle' && state.status === 'idle') {
        this.loadCurrentTasks()
      }
      this.lastChatStatus = state.status
      
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
    this.lastUserId = userStore.user?.id || ''
    if (userStore.user) {
      this.setData({ userNickname: userStore.user.nickname || '搭子' })
    }
    this.unsubscribeUser = useUserStore.subscribe((state) => {
      if (state.user) {
        this.setData({ userNickname: state.user.nickname || '搭子' })
      } else {
        this.setData({ currentTasks: [] })
      }

      const nextUserId = state.user?.id || ''
      if (this.lastUserId !== nextUserId) {
        this.lastUserId = nextUserId
        this.loadCurrentTasks()
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

  async loadCurrentTasks() {
    const userStore = useUserStore.getState()
    if (!userStore.isLoggedIn || !userStore.user?.id) {
      this.setData({ currentTasks: [] })
      return
    }

    try {
      const response = await getAiTasksCurrent()
      if (response.status !== 200 || !response.data || !Array.isArray(response.data.items)) {
        this.setData({ currentTasks: [] })
        return
      }

      const currentTasks = response.data.items
        .map((item) => readCurrentTaskItem(item))
        .filter((item): item is CurrentTaskItem => item !== null)

      this.setData({ currentTasks })
    } catch (error) {
      console.error('[Home] Failed to load current tasks:', error)
      this.setData({ currentTasks: [] })
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
        activities: welcomeData.pendingActivities || [],
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
      await useHomeStore.getState().clearConversations()
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
    this.sendPromptText(text)
  },

  onDashboardActivityTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const { id } = e.detail
    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${id}` })
  },

  onDashboardPromptTap(e: WechatMiniprogram.CustomEvent<{ prompt: string }>) {
    const { prompt } = e.detail
    const aiDock = readAiDockComponent(this.selectComponent('#aiDock'))
    if (aiDock) {
      aiDock.setValue(prompt)
    }
    this.sendPromptText(prompt)
  },

  applyPrefillPrompt(prefill?: string) {
    if (!prefill) return

    let prompt = prefill
    try {
      prompt = decodeURIComponent(prefill)
    } catch {
      prompt = prefill
    }
    prompt = prompt.trim()
    if (!prompt) return

    wx.nextTick(() => {
      const aiDock = readAiDockComponent(this.selectComponent('#aiDock'))
      if (aiDock) {
        aiDock.setValue(prompt)
      }
    })
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

  buildPublishPayloadFromDraft(draft: unknown): Record<string, unknown> {
    const draftRecord = isRecord(draft) ? draft : null
    const location = readLocationPair(draftRecord?.location) ?? [106.52988, 29.58567]
    const [lng, lat] = location
    const title = readString(draftRecord?.title) || '周五活动局'
    const type = readString(draftRecord?.type) || 'other'
    const startAt = readString(draftRecord?.startAt) || '2026-03-06T20:00:00+08:00'
    const locationName = readString(draftRecord?.locationName) || '观音桥'
    const locationHint =
      readString(draftRecord?.locationHint) || `${locationName}商圈`
    const maxParticipants = readNumber(draftRecord?.maxParticipants) || 6
    const currentParticipants = readNumber(draftRecord?.currentParticipants) || 1
    const activityId = readString(draftRecord?.activityId) || ''

    return {
      activityId,
      title,
      type,
      activityType: type,
      startAt,
      locationName,
      locationHint,
      maxParticipants,
      currentParticipants,
      lat: Number(lat) || 29.58567,
      lng: Number(lng) || 106.52988,
      slot: this.resolveSlotFromStartAt(startAt),
    }
  },

  onExploreExpandMap(_e: WechatMiniprogram.CustomEvent<{ results: unknown[]; center: unknown }>) {
    // 由 widget-explore 组件内部处理跳转
  },

  onAuthSuccess(_e: WechatMiniprogram.CustomEvent<{ phoneNumber: string }>) {
    this.loadUserInfo()
    this.loadCurrentTasks()
  },

  async executeCurrentTaskAction(action: CurrentTaskAction) {
    if (action.kind === 'structured_action') {
      if (!action.action) {
        return
      }

      if (action.action === 'start_follow_up_chat') {
        const promptPayload = readTaskChatPromptPayload(action.payload)
        if (!promptPayload) {
          return
        }

        if (promptPayload.followUpMode === 'rebook' && promptPayload.activityId) {
          try {
            await postActivityRebookFollowUp(promptPayload.activityId)
          } catch (error) {
            console.warn('记录再约意愿失败', error)
          }
        }

        useChatStore.getState().sendMessage(promptPayload.prompt, {
          ...(promptPayload.activityId ? { activityId: promptPayload.activityId } : {}),
          ...(promptPayload.followUpMode ? { followUpMode: promptPayload.followUpMode } : {}),
          ...(promptPayload.entry ? { entry: promptPayload.entry } : {}),
        })
        return
      }

      useChatStore.getState().sendAction({
        action: action.action,
        payload: action.payload || {},
        source: action.source,
        originalText: action.originalText,
      })
      return
    }

    if (!action.url) {
      return
    }

    if (action.kind === 'switch_tab' && action.url === '/pages/message/index') {
      const focusIntent = readMessageCenterFocusIntent(action.payload)
      useAppStore.getState().setMessageCenterFocus(focusIntent)
      wx.switchTab({ url: action.url })
      return
    }

    if (action.kind === 'switch_tab') {
      wx.switchTab({ url: action.url })
      return
    }

    wx.navigateTo({ url: action.url })
  },

  onCurrentTaskActionTap(e: WechatMiniprogram.CustomEvent<{ action?: CurrentTaskAction }>) {
    const action = readCurrentTaskAction(e.detail?.action)
    if (!action) {
      return
    }

    void this.executeCurrentTaskAction(action)
  },

  continueStructuredPendingAction(pendingAction: StructuredPendingAction) {
    useChatStore.getState().sendAction({
      action: pendingAction.action,
      payload: pendingAction.payload,
      source: pendingAction.source,
      originalText: pendingAction.originalText,
    })
  },

  resumePendingActionIfReady() {
    const appStore = useAppStore.getState()
    const pendingAction = appStore.pendingAction
    const token = wx.getStorageSync('token')
    if (!pendingAction || pendingAction.authMode !== 'login' || !token) {
      return
    }

    appStore.clearPendingAction()
    this.continueStructuredPendingAction({
      ...pendingAction,
      authMode: undefined,
    })
  },

  onAuthRequiredContinue(e: WechatMiniprogram.CustomEvent<{ pendingAction?: StructuredPendingAction }>) {
    const pendingAction = readStructuredPendingAction(e.detail?.pendingAction)
    if (!pendingAction) {
      return
    }

    const appStore = useAppStore.getState()
    if (pendingAction.authMode === 'bind_phone') {
      appStore.showAuthSheet(pendingAction)
      return
    }

    appStore.setPendingAction({
      ...pendingAction,
      authMode: 'login',
    })

    wx.navigateTo({
      url: '/pages/login/login',
    })
  },

  onPendingAction(e: WechatMiniprogram.CustomEvent<StructuredPendingAction>) {
    const pendingAction = readStructuredPendingAction(e.detail)
    if (!pendingAction) {
      return
    }

    useAppStore.getState().clearPendingAction()
    this.continueStructuredPendingAction({
      ...pendingAction,
      authMode: undefined,
    })
  },

  shareActivityData: INITIAL_SHARE_ACTIVITY_DATA,

  onWidgetShareTap(e: WechatMiniprogram.CustomEvent<{ activity: unknown; shareTitle: string }>) {
    const { activity, shareTitle } = e.detail
    const resolvedActivity = readShareActivityData(activity)
    if (!resolvedActivity) {
      return
    }

    this.shareActivityData = { ...resolvedActivity, shareTitle }
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
    if (typeof originalText === 'string' && originalText.trim()) {
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

  onPartnerIntentFormSubmit(e: WechatMiniprogram.CustomEvent<{ values: Record<string, unknown> }>) {
    wx.reportEvent('partner_intent_form_submit', {
      activity_type: typeof e.detail?.values?.activityType === 'string' ? e.detail.values.activityType : '',
      time_range: typeof e.detail?.values?.timeRange === 'string' ? e.detail.values.timeRange : '',
      location: typeof e.detail?.values?.location === 'string' ? e.detail.values.location : '',
    })
  },

  onDraftSettingsFormSubmit(e: WechatMiniprogram.CustomEvent<{ values: Record<string, unknown> }>) {
    wx.reportEvent('draft_settings_form_submit', {
      field: typeof e.detail?.values?.field === 'string' ? e.detail.values.field : '',
      location_name: typeof e.detail?.values?.locationName === 'string' ? e.detail.values.locationName : '',
      slot: typeof e.detail?.values?.slot === 'string' ? e.detail.values.slot : '',
      max_participants: typeof e.detail?.values?.maxParticipants === 'string' ? e.detail.values.maxParticipants : '',
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
    this.sendPromptText(keyword)
  },

  sendPromptText(text: string) {
    if (!text?.trim()) return

    const chatStore = useChatStore.getState()
    chatStore.sendMessage(text)
  },
})

/**
 * 对话主场 (Chat-First 架构)
 * Requirements: 1.1, 1.2, 1.3, 1.4, 3.2
 * v3.7 重构: 使用 useChatStore 统一 AI 对话管理
 * 
 * 三层结构：Custom_Navbar + Chat_Stream + AI_Dock
 * - 首次进入显示 Widget_Dashboard（调用 /ai/welcome API）
 * - 集成 useChatStore（类似 @ai-sdk/react 的 useChat）
 * - 实现空气感渐变背景
 */
import { useChatStore, type UIMessage } from '../../src/stores/chat'
import { useChatHomeStore } from '../../src/stores/chat-home'
import {
  useAppStore,
  type PendingActionAuthMode,
  type StructuredPendingAction,
} from '../../src/stores/app'
import { useUserStore } from '../../src/stores/user'
import {
  getWelcomeCard,
  getUserLocation,
  type QuickItem,
  type QuickPrompt,
} from '../../src/services/welcome'
import { getAiTasksCurrent } from '../../src/api/endpoints/ai/ai'
import type {
  ActivityData,
  ActivityStatus,
  ActivityType,
  ShareActivityData,
} from '../../src/types/global'
import type {
  AiCurrentTasksResponseItemsItem,
  AiCurrentTasksResponseItemsItemPrimaryAction,
  AiCurrentTasksResponseItemsItemSecondaryAction,
} from '../../src/api/model'

const DEFAULT_COMPOSER_PLACEHOLDER = '你想找什么活动？'
const DEFAULT_WELCOME_GREETING = '晚上好，朋友！'
const DEFAULT_WELCOME_SUB_GREETING = '附近有新局，想直接看看吗？'
const DEFAULT_TASK_PANEL_EYEBROW = '继续帮你接着办'
const DEFAULT_TASK_PANEL_TITLE = '刚才那件事，我还在继续推进'
const DEFAULT_RUNTIME_STATUS_UI = {
  networkOfflineText: '网络连接已断开',
  networkRetryText: '重试',
  networkRestoredToast: '网络已恢复',
  widgetErrorMessage: '出了点问题',
  widgetErrorRetryText: '重试',
}
const DEFAULT_WELCOME_QUICK_PROMPTS: QuickPrompt[] = [
  { icon: '#', text: '周末附近有什么活动', prompt: '周末附近有什么活动' },
  { icon: '#', text: '帮我找个运动搭子', prompt: '帮我找个运动搭子' },
  { icon: '#', text: '想组个周五晚的局', prompt: '想组个周五晚的局' },
]

// 页面数据类型
interface PageData {
  // 从 useChatStore 同步
  messages: UIMessage[]
  status: 'idle' | 'submitted' | 'streaming'
  streamingMessageId: string | null
  
  // 页面 UI 状态
  userNickname: string
  inputValue: string
  isAuthSheetVisible: boolean
  isWelcomeState: boolean
  welcomeGreeting: string
  welcomeSubGreeting: string
  welcomeQuickPrompts: QuickPrompt[]
  
  // 欢迎卡片 (v3.10 新结构)
  composerPlaceholder: string
  networkOfflineText: string
  networkRetryText: string
  networkRestoredToast: string
  widgetErrorMessage: string
  widgetErrorRetryText: string
  homeState: RuntimeHomeState
  primaryTaskId: string | null
  currentTasks: ChatTaskItem[]
  secondaryTaskCount: number
  taskPanelEyebrow: string
  taskPanelTitle: string
}

type RuntimeHomeState = 'H0' | 'H1' | 'H2' | 'H3' | 'H4'

type ChatTaskAction = {
  kind: 'structured_action' | 'navigate' | 'switch_tab'
  label: string
  action?: string
  payload?: Record<string, unknown>
  source?: string
  originalText?: string
  url?: string
}

type ChatTaskItem = {
  id: string
  taskTypeLabel: string
  stageLabel: string
  headline: string
  summary: string
  activityTitle?: string
  attentionLevel?: 'normal' | 'time_sensitive' | 'action_required' | 'follow_up'
  primaryAction?: ChatTaskAction
  secondaryAction?: ChatTaskAction
}

interface ChatPageOptions {
  prefill?: string;
}

interface AiDockComponent {
  setValue: (value: string) => void;
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

function readActivityIdFromQuickItemContext(context: unknown): string | null {
  if (!isRecord(context)) {
    return null
  }

  return readString(context.activityId)
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

function readTaskAction(
  value: AiCurrentTasksResponseItemsItemPrimaryAction | AiCurrentTasksResponseItemsItemSecondaryAction | undefined
): ChatTaskAction | null {
  if (!value || typeof value.kind !== 'string' || typeof value.label !== 'string') {
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

function readCurrentTask(value: AiCurrentTasksResponseItemsItem): ChatTaskItem | null {
  if (
    !value ||
    typeof value.id !== 'string' ||
    typeof value.taskTypeLabel !== 'string' ||
    typeof value.stageLabel !== 'string' ||
    typeof value.headline !== 'string' ||
    typeof value.summary !== 'string'
  ) {
    return null
  }

  const primaryAction = readTaskAction(value.primaryAction)
  const secondaryAction = readTaskAction(value.secondaryAction)
  const rawAttentionLevel = isRecord(value) ? value.attentionLevel : undefined

  return {
    id: value.id,
    taskTypeLabel: value.taskTypeLabel,
    stageLabel: value.stageLabel,
    headline: value.headline,
    summary: value.summary,
    ...(typeof value.activityTitle === 'string' ? { activityTitle: value.activityTitle } : {}),
    ...(rawAttentionLevel === 'normal' ||
      rawAttentionLevel === 'time_sensitive' ||
      rawAttentionLevel === 'action_required' ||
      rawAttentionLevel === 'follow_up'
      ? { attentionLevel: rawAttentionLevel }
      : {}),
    ...(primaryAction ? { primaryAction } : {}),
    ...(secondaryAction ? { secondaryAction } : {}),
  }
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

function readHomeState(value: unknown): RuntimeHomeState {
  switch (value) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
      return value
    default:
      return 'H0'
  }
}

function pickPrimaryTask(
  tasks: ChatTaskItem[],
  primaryTaskId: string | null,
  homeState: RuntimeHomeState
): ChatTaskItem | null {
  if (homeState === 'H0' || tasks.length === 0) {
    return null
  }

  if (primaryTaskId) {
    const matchedTask = tasks.find((task) => task.id === primaryTaskId)
    if (matchedTask) {
      return matchedTask
    }
  }

  return tasks[0] || null
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

function isDashboardOnlyMessage(message: UIMessage | undefined): boolean {
  if (!message || message.role !== 'assistant' || message.parts.length !== 1) {
    return false
  }

  const [part] = message.parts
  return part.type === 'widget' && part.widgetType === 'dashboard'
}

function isWelcomeState(messages: UIMessage[]): boolean {
  return messages.length === 0 || (messages.length === 1 && isDashboardOnlyMessage(messages[0]))
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
    inputValue: '',
    isAuthSheetVisible: false,
    isWelcomeState: true,
    welcomeGreeting: DEFAULT_WELCOME_GREETING,
    welcomeSubGreeting: DEFAULT_WELCOME_SUB_GREETING,
    welcomeQuickPrompts: DEFAULT_WELCOME_QUICK_PROMPTS,
    composerPlaceholder: DEFAULT_COMPOSER_PLACEHOLDER,
    networkOfflineText: DEFAULT_RUNTIME_STATUS_UI.networkOfflineText,
    networkRetryText: DEFAULT_RUNTIME_STATUS_UI.networkRetryText,
    networkRestoredToast: DEFAULT_RUNTIME_STATUS_UI.networkRestoredToast,
    widgetErrorMessage: DEFAULT_RUNTIME_STATUS_UI.widgetErrorMessage,
    widgetErrorRetryText: DEFAULT_RUNTIME_STATUS_UI.widgetErrorRetryText,
    homeState: 'H0',
    primaryTaskId: null,
    currentTasks: [],
    secondaryTaskCount: 0,
    taskPanelEyebrow: DEFAULT_TASK_PANEL_EYEBROW,
    taskPanelTitle: DEFAULT_TASK_PANEL_TITLE,
  },

  unsubscribeChat: INITIAL_UNSUBSCRIBE,
  unsubscribeApp: INITIAL_UNSUBSCRIBE,
  unsubscribeUser: INITIAL_UNSUBSCRIBE,
  userLocation: INITIAL_USER_LOCATION,
  lastChatStatus: 'idle' as PageData['status'],
  lastUserId: '',

  onLoad(options: ChatPageOptions) {
    this.subscribeChatStore()
    this.subscribeAppStore()
    this.subscribeUserStore()
    this.initChat()
    this.loadUserInfo()
    this.loadCurrentTasks()
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
      inputValue: chatStore.input,
      isWelcomeState: isWelcomeState(chatStore.messages),
    })
    
    this.unsubscribeChat = useChatStore.subscribe((state) => {
      this.setData({
        messages: state.messages,
        status: state.status,
        streamingMessageId: state.streamingMessageId,
        inputValue: state.input,
        isWelcomeState: isWelcomeState(state.messages),
      })
      this.lastChatStatus = state.status
    })
  },

  subscribeAppStore() {
    const appStore = useAppStore.getState()
    this.setData({
      isAuthSheetVisible: appStore.isAuthSheetVisible,
    })
    this.unsubscribeApp = useAppStore.subscribe((state) => {
      this.setData({
        isAuthSheetVisible: state.isAuthSheetVisible,
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
      }

      const nextUserId = state.user?.id || ''
      if (this.lastUserId !== nextUserId) {
        this.lastUserId = nextUserId
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
      await this.showWelcomeDashboard()
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
    if (!userStore.token || !userStore.user) {
      this.setData({
        homeState: 'H0',
        primaryTaskId: null,
        currentTasks: [],
        secondaryTaskCount: 0,
        taskPanelEyebrow: DEFAULT_TASK_PANEL_EYEBROW,
        taskPanelTitle: DEFAULT_TASK_PANEL_TITLE,
      })
      return
    }

    try {
      const response = await getAiTasksCurrent()
      if (response.status !== 200) {
        this.setData({
          homeState: 'H0',
          primaryTaskId: null,
          currentTasks: [],
          secondaryTaskCount: 0,
          taskPanelEyebrow: DEFAULT_TASK_PANEL_EYEBROW,
          taskPanelTitle: DEFAULT_TASK_PANEL_TITLE,
        })
        return
      }

      const allTasks = (response.data.items || [])
        .map((item) => readCurrentTask(item))
        .filter((item): item is ChatTaskItem => item !== null)
      const homeState = readHomeState(response.data.homeState)
      const primaryTaskId = readString(response.data.primaryTaskId)
      const primaryTask = pickPrimaryTask(allTasks, primaryTaskId, homeState)

      this.setData({
        homeState,
        primaryTaskId: primaryTask?.id || null,
        currentTasks: primaryTask ? [primaryTask] : [],
        secondaryTaskCount: Math.max(0, allTasks.length - (primaryTask ? 1 : 0)),
      })
    } catch (error) {
      console.error('[Chat] Failed to load current tasks:', error)
      this.setData({
        homeState: 'H0',
        primaryTaskId: null,
        currentTasks: [],
        secondaryTaskCount: 0,
        taskPanelEyebrow: DEFAULT_TASK_PANEL_EYEBROW,
        taskPanelTitle: DEFAULT_TASK_PANEL_TITLE,
      })
    }
  },

  /**
   * 显示欢迎卡片
   * v4.4: 增加社交档案和快捷入口
   */
  async showWelcomeDashboard() {
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
      const runtimeStatus = welcomeData.ui?.chatShell?.runtimeStatus
      const networkOfflineText =
        typeof runtimeStatus?.networkOfflineText === 'string' && runtimeStatus.networkOfflineText.trim()
          ? runtimeStatus.networkOfflineText.trim()
          : DEFAULT_RUNTIME_STATUS_UI.networkOfflineText
      const networkRetryText =
        typeof runtimeStatus?.networkRetryText === 'string' && runtimeStatus.networkRetryText.trim()
          ? runtimeStatus.networkRetryText.trim()
          : DEFAULT_RUNTIME_STATUS_UI.networkRetryText
      const networkRestoredToast =
        typeof runtimeStatus?.networkRestoredToast === 'string' && runtimeStatus.networkRestoredToast.trim()
          ? runtimeStatus.networkRestoredToast.trim()
          : DEFAULT_RUNTIME_STATUS_UI.networkRestoredToast
      const widgetErrorMessage =
        typeof runtimeStatus?.widgetErrorMessage === 'string' && runtimeStatus.widgetErrorMessage.trim()
          ? runtimeStatus.widgetErrorMessage.trim()
          : DEFAULT_RUNTIME_STATUS_UI.widgetErrorMessage
      const widgetErrorRetryText =
        typeof runtimeStatus?.widgetErrorRetryText === 'string' && runtimeStatus.widgetErrorRetryText.trim()
          ? runtimeStatus.widgetErrorRetryText.trim()
          : DEFAULT_RUNTIME_STATUS_UI.widgetErrorRetryText
      const taskPanelTitle =
        typeof welcomeData.ui?.sidebar?.currentTasksTitle === 'string' && welcomeData.ui.sidebar.currentTasksTitle.trim()
          ? welcomeData.ui.sidebar.currentTasksTitle.trim()
          : DEFAULT_TASK_PANEL_TITLE

      this.setData({
        composerPlaceholder,
        networkOfflineText,
        networkRetryText,
        networkRestoredToast,
        widgetErrorMessage,
        widgetErrorRetryText,
        taskPanelTitle,
        isWelcomeState: true,
        welcomeGreeting:
          typeof welcomeData.greeting === 'string' && welcomeData.greeting.trim()
            ? welcomeData.greeting.trim()
            : DEFAULT_WELCOME_GREETING,
        welcomeSubGreeting:
          typeof welcomeData.subGreeting === 'string' && welcomeData.subGreeting.trim()
            ? welcomeData.subGreeting.trim()
            : DEFAULT_WELCOME_SUB_GREETING,
        welcomeQuickPrompts:
          Array.isArray(welcomeData.quickPrompts) && welcomeData.quickPrompts.length > 0
            ? welcomeData.quickPrompts
            : DEFAULT_WELCOME_QUICK_PROMPTS,
      })
    } catch (error) {
      console.error('[Chat] Failed to load welcome card:', error)

      this.setData({
        composerPlaceholder: DEFAULT_COMPOSER_PLACEHOLDER,
        networkOfflineText: DEFAULT_RUNTIME_STATUS_UI.networkOfflineText,
        networkRetryText: DEFAULT_RUNTIME_STATUS_UI.networkRetryText,
        networkRestoredToast: DEFAULT_RUNTIME_STATUS_UI.networkRestoredToast,
        widgetErrorMessage: DEFAULT_RUNTIME_STATUS_UI.widgetErrorMessage,
        widgetErrorRetryText: DEFAULT_RUNTIME_STATUS_UI.widgetErrorRetryText,
        isWelcomeState: true,
        welcomeGreeting: DEFAULT_WELCOME_GREETING,
        welcomeSubGreeting: DEFAULT_WELCOME_SUB_GREETING,
        welcomeQuickPrompts: DEFAULT_WELCOME_QUICK_PROMPTS,
      })
    }
  },

  /**
   * 新对话
   */
  async onNewChat() {
    useChatStore.getState().clearMessages()
    
    // 同时清空服务端历史
    try {
      await useChatHomeStore.getState().clearConversations()
    } catch (e) {
      console.error('[Chat] Failed to clear server messages:', e)
    }
    
    await this.showWelcomeDashboard()
  },

  /**
   * 发送消息
   */
  onSend(e: WechatMiniprogram.CustomEvent<{ text: string }>) {
    const text = typeof e.detail?.text === 'string' ? e.detail.text : ''
    this.runPrompt(text)
  },

  onInputChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const value = typeof e.detail?.value === 'string' ? e.detail.value : ''
    useChatStore.getState().setInput(value)
  },

  onDashboardActivityTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const { id } = e.detail
    this.openActivityDetail(id)
  },

  onDashboardPromptTap(e: WechatMiniprogram.CustomEvent<{ prompt: string }>) {
    const { prompt } = e.detail
    this.runPrompt(prompt)
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

    wx.nextTick(() => this.prefillComposer(prompt))
  },

  /**
   * 处理快捷项点击 (v3.10 新结构)
   */
  onDashboardQuickItemTap(e: WechatMiniprogram.CustomEvent<{ item: QuickItem }>) {
    const { item } = e.detail
    if (!item) {
      return
    }

    if (item.type === 'draft') {
      const activityId = readActivityIdFromQuickItemContext(item.context)
      if (activityId) {
        this.openDraftConfirm(activityId)
        return
      }
    }

    this.runPrompt(item.prompt)
  },

  /**
   * 查看全部活动 (v4.4 新增)
   */
  onDashboardViewAll() {
    this.openJoinedActivities()
  },

  onDashboardPreferenceTap() {
    this.openSetting()
  },

  onNavbarMenuTap() {
    wx.navigateTo({ url: '/pages/profile/index' })
  },

  onNavbarItemTap(e: WechatMiniprogram.CustomEvent<{ action?: string }>) {
    if (e.detail?.action === 'message') {
      this.focusMessageCenter(null)
    }
  },

  openActivityDetail(activityId: string) {
    if (!activityId) {
      return
    }

    wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${activityId}` })
  },

  openDraftConfirm(activityId: string) {
    if (!activityId) {
      return
    }

    wx.navigateTo({
      url: `/subpackages/activity/confirm/index?activityId=${activityId}`,
    })
  },

  openJoinedActivities() {
    wx.navigateTo({ url: '/subpackages/activity/list/index?type=joined' })
  },

  openSetting() {
    wx.navigateTo({ url: '/pages/setting/index' })
  },

  openLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
    })
  },

  openExploreMap(lat: number, lng: number, results: unknown[]) {
    const encodedResults = encodeURIComponent(JSON.stringify(results))
    wx.navigateTo({
      url: `/subpackages/activity/explore/index?lat=${lat}&lng=${lng}&results=${encodedResults}&animate=expand`,
    })
  },

  focusMessageCenter(payload: Record<string, unknown> | null) {
    if (payload) {
      useAppStore.getState().setMessageCenterFocus({
        ...(typeof payload.taskId === 'string' ? { taskId: payload.taskId } : {}),
        ...(typeof payload.matchId === 'string' ? { matchId: payload.matchId } : {}),
      })
    }

    wx.switchTab({ url: '/pages/message/index' })
  },

  openTaskAction(action: ChatTaskAction) {
    if (action.kind === 'structured_action' && action.action) {
      this.runStructuredAction({
        action: action.action,
        payload: action.payload || {},
        source: action.source,
        originalText: action.originalText || action.label,
      })
      return
    }

    if ((action.kind === 'navigate' || action.kind === 'switch_tab') && action.url) {
      const focusPayload = isRecord(action.payload) ? action.payload : null
      if (action.url === '/pages/message/index') {
        this.focusMessageCenter(focusPayload)
      }

      if (action.kind === 'switch_tab') {
        wx.switchTab({ url: action.url })
        return
      }

      wx.navigateTo({ url: action.url })
    }
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

  onExploreExpandMap(e: WechatMiniprogram.CustomEvent<{ results: unknown[]; center: unknown }>) {
    const { results, center } = e.detail || {}
    const centerRecord = isRecord(center) ? center : null
    const lat = readNumber(centerRecord?.lat) ?? 29.58567
    const lng = readNumber(centerRecord?.lng) ?? 106.52988
    this.openExploreMap(lat, lng, Array.isArray(results) ? results : [])
  },

  onExploreActivityTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const { id } = e.detail || {}
    this.openActivityDetail(id)
  },

  onExploreActionTap(
    e: WechatMiniprogram.CustomEvent<{
      action: string
      payload?: Record<string, unknown>
      source?: string
      originalText?: string
    }>
  ) {
    this.runStructuredActionEvent(e.detail)
  },

  onPartnerSearchActionTap(
    e: WechatMiniprogram.CustomEvent<{
      action: string
      payload?: Record<string, unknown>
      source?: string
      originalText?: string
    }>
  ) {
    this.runStructuredActionEvent(e.detail)
  },

  onAuthSuccess(_e: WechatMiniprogram.CustomEvent<{ phoneNumber: string }>) {
    this.loadUserInfo()
  },

  continueStructuredPendingAction(pendingAction: StructuredPendingAction) {
    this.runStructuredAction({
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

    this.openLogin()
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

  openLegalDocument(type: 'user-agreement' | 'privacy-policy') {
    wx.navigateTo({
      url: `/subpackages/legal/index?type=${type}`,
    })
  },

  onAuthSheetViewAgreement() {
    this.openLegalDocument('user-agreement')
  },

  onAuthSheetViewPolicy() {
    this.openLegalDocument('privacy-policy')
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

  onWidgetShareViewDetail(e: WechatMiniprogram.CustomEvent<{ activity: unknown }>) {
    const resolvedActivity = readShareActivityData(e.detail?.activity)
    if (!resolvedActivity) {
      return
    }

    this.openActivityDetail(resolvedActivity.id)
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
      title: 'xu - 今天有什么想玩的？',
      path: '/pages/chat/index',
    }
  },

  onShareTimeline() {
    return {
      title: 'xu，碎片化社交助理',
    }
  },

  onAgentTaskActionTap(
    e: WechatMiniprogram.CustomEvent<{ taskId: string; action: ChatTaskAction }>
  ) {
    const action = e.detail?.action
    if (!action) {
      return
    }
    this.openTaskAction(action)
  },

  /**
   * 错误重试
   */
  onWidgetErrorRetry(e: WechatMiniprogram.CustomEvent) {
    const originalText = e.currentTarget.dataset.originalText
    if (typeof originalText === 'string' && originalText.trim()) {
      this.runPrompt(originalText)
      return
    }

    useChatStore.getState().retryLastTurn()
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

  onActionChipTap(
    e: WechatMiniprogram.CustomEvent<{
      action: string
      payload?: Record<string, unknown>
      source?: string
      originalText?: string
    }>
  ) {
    this.runStructuredActionEvent(e.detail)
  },

  onWidgetStructuredActionTap(
    e: WechatMiniprogram.CustomEvent<{
      action: string
      payload?: Record<string, unknown>
      source?: string
      originalText?: string
    }>
  ) {
    this.runStructuredActionEvent(e.detail)
  },

  onNetworkRetry() {
    this.initChat()
  },

  onWelcomePromptTap(e: WechatMiniprogram.CustomEvent<{ prompt: string }>) {
    const prompt = typeof e.detail?.prompt === 'string' ? e.detail.prompt : ''
    this.runPrompt(prompt)
  },

  runPrompt(text: string) {
    const normalizedText = typeof text === 'string' ? text.trim() : ''
    if (!normalizedText) {
      return
    }

    const chatStore = useChatStore.getState()
    if (chatStore.input !== normalizedText) {
      chatStore.setInput(normalizedText)
    }
    chatStore.submitInput()
  },

  runStructuredAction(action: {
    action: string
    payload: Record<string, unknown>
    source?: string
    originalText?: string
  }) {
    useChatStore.getState().sendAction(action)
  },

  runStructuredActionEvent(detail: {
    action?: string
    payload?: Record<string, unknown>
    source?: string
    originalText?: string
  } | undefined) {
    const action = typeof detail?.action === 'string' ? detail.action : ''
    if (!action) {
      return
    }

    this.runStructuredAction({
      action,
      payload: isRecord(detail?.payload) ? detail.payload : {},
      source: typeof detail?.source === 'string' ? detail.source : undefined,
      originalText: typeof detail?.originalText === 'string' ? detail.originalText : undefined,
    })
  },

  prefillComposer(text: string) {
    const normalizedText = text.trim()
    if (!normalizedText) {
      return
    }

    const aiDock = readAiDockComponent(this.selectComponent('#aiDock'))
    if (aiDock) {
      aiDock.setValue(normalizedText)
    }

    useChatStore.getState().setInput(normalizedText)
  },
})

/**
 * 应用全局状态管理
 * 包含系统信息、网络状态、UI 状态控制
 */
import { createStore } from 'zustand/vanilla.js'
import { immer } from 'zustand/middleware/immer.js'

// AI 思考状态类型
type AIThinkingState = 'idle' | 'thinking' | 'rendering_widget'

export type PendingActionAuthMode = 'login' | 'bind_phone'

// 待执行结构化动作（用于登录/手机号绑定后继续执行）
export interface StructuredPendingAction {
  type: 'structured_action'
  action: string
  payload: Record<string, unknown>
  source?: string
  originalText?: string
  authMode?: PendingActionAuthMode
}

export interface MessageCenterFocusIntent {
  taskId?: string
  matchId?: string
}

interface AppState {
  // 系统信息
  systemInfo: WechatMiniprogram.SystemInfo | null
  
  // 网络状态
  networkType: string
  isOnline: boolean
  
  // 应用状态
  isReady: boolean
  currentTabIndex: number
  
  // UI 状态控制
  isAuthSheetVisible: boolean
  aiThinkingState: AIThinkingState
  
  // 待执行操作（手机号绑定成功后继续执行）
  pendingAction: StructuredPendingAction | null

  // 消息中心聚焦意图（例如从任务面板直接打开某条待确认匹配）
  messageCenterFocus: MessageCenterFocusIntent | null
  
  // Actions
  setSystemInfo: (info: WechatMiniprogram.SystemInfo) => void
  setNetworkStatus: (type: string, isOnline: boolean) => void
  setAppReady: (ready: boolean) => void
  setCurrentTab: (index: number) => void
  
  // UI 状态控制 Actions
  showAuthSheet: (pendingAction?: StructuredPendingAction) => void
  hideAuthSheet: () => void
  setAIThinkingState: (state: AIThinkingState) => void
  setPendingAction: (pendingAction: StructuredPendingAction | null) => void
  clearPendingAction: () => void
  setMessageCenterFocus: (intent: MessageCenterFocusIntent | null) => void
  clearMessageCenterFocus: () => void
}

export const useAppStore = createStore<AppState>()(
  immer((set) => ({
    // 初始状态
    systemInfo: null,
    networkType: 'unknown',
    isOnline: true,
    isReady: false,
    currentTabIndex: 0,
    
    // UI 状态初始值
    isAuthSheetVisible: false,
    aiThinkingState: 'idle',
    pendingAction: null,
    messageCenterFocus: null,

    // 设置系统信息
    setSystemInfo: (info) => {
      set((state) => {
        state.systemInfo = info
      })
    },

    // 设置网络状态
    setNetworkStatus: (type, isOnline) => {
      set((state) => {
        state.networkType = type
        state.isOnline = isOnline
      })
    },

    // 设置应用就绪状态
    setAppReady: (ready) => {
      set((state) => {
        state.isReady = ready
      })
    },

    // 设置当前 Tab
    setCurrentTab: (index) => {
      set((state) => {
        state.currentTabIndex = index
      })
    },
    
    // 显示手机号绑定半屏
    showAuthSheet: (pendingAction) => {
      set((state) => {
        state.isAuthSheetVisible = true
        state.pendingAction = pendingAction || null
      })
    },
    
    // 隐藏手机号绑定半屏
    hideAuthSheet: () => {
      set((state) => {
        state.isAuthSheetVisible = false
      })
    },
    
    // 设置 AI 思考状态
    setAIThinkingState: (thinkingState) => {
      set((state) => {
        state.aiThinkingState = thinkingState
      })
    },

    setPendingAction: (pendingAction) => {
      set((state) => {
        state.pendingAction = pendingAction
      })
    },
    
    // 清除待执行操作
    clearPendingAction: () => {
      set((state) => {
        state.pendingAction = null
      })
    },

    setMessageCenterFocus: (intent) => {
      set((state) => {
        state.messageCenterFocus = intent
      })
    },

    clearMessageCenterFocus: () => {
      set((state) => {
        state.messageCenterFocus = null
      })
    },
  }))
)

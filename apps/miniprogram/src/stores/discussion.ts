/**
 * Discussion Store - 活动讨论区状态管理
 * 
 * 基于 WebSocket 的实时通讯，用于活动参与者之间的讨论
 * 
 * @example
 * ```typescript
 * const discussionStore = useDiscussionStore.getState()
 * 
 * // 连接讨论区
 * discussionStore.connect(activityId, token)
 * 
 * // 发送消息
 * discussionStore.sendMessage('几点集合？')
 * 
 * // 断开连接
 * discussionStore.disconnect()
 * ```
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { API_BASE_URL } from '../config/api'

// ============================================================================
// Types
// ============================================================================

/** 讨论区消息 */
export interface DiscussionMessage {
  id: string
  content: string
  senderId: string | null
  senderNickname: string | null
  senderAvatarUrl: string | null
  type: 'text' | 'system'
  createdAt: string
}

/** WebSocket 连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** 服务端消息类型 */
interface WsServerMessage {
  type: 'message' | 'history' | 'online' | 'join' | 'leave' | 'error' | 'pong'
  data: unknown
  ts: number
}

// ============================================================================
// Store Definition
// ============================================================================

interface DiscussionState {
  // ========== 状态 ==========
  /** 当前活动 ID */
  activityId: string | null
  /** 消息列表 */
  messages: DiscussionMessage[]
  /** 在线人数 */
  onlineCount: number
  /** 连接状态 */
  connectionStatus: ConnectionStatus
  /** 是否已归档 */
  isArchived: boolean
  /** 错误信息 */
  error: string | null
  /** 是否正在加载更多 */
  isLoadingMore: boolean
  /** 是否还有更多历史消息 */
  hasMore: boolean
  
  // ========== Actions ==========
  /** 连接讨论区 */
  connect: (activityId: string, token: string) => void
  /** 断开连接 */
  disconnect: () => void
  /** 发送消息 */
  sendMessage: (content: string) => void
  /** 加载更多历史消息 */
  loadMore: () => Promise<void>
  /** 清除错误 */
  clearError: () => void
  
  // ========== Internal ==========
  /** WebSocket 实例 */
  _socket: WechatMiniprogram.SocketTask | null
  /** 心跳定时器 */
  _heartbeatTimer: number | null
  /** 重连定时器 */
  _reconnectTimer: number | null
  /** 重连次数 */
  _reconnectCount: number
  /** Token（用于重连） */
  _token: string | null
}

// WebSocket URL 构建
const getWsUrl = (activityId: string, token: string) => {
  const baseUrl = API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')
  return `${baseUrl}/chat/${activityId}/ws?token=${token}`
}

// 心跳间隔（20秒）
const HEARTBEAT_INTERVAL = 20000
// 最大重连次数
const MAX_RECONNECT_COUNT = 5
// 重连间隔基数（毫秒）
const RECONNECT_BASE_INTERVAL = 1000

export const useDiscussionStore = create<DiscussionState>()(
  immer((set, get) => ({
    // ========== 初始状态 ==========
    activityId: null,
    messages: [],
    onlineCount: 0,
    connectionStatus: 'disconnected',
    isArchived: false,
    error: null,
    isLoadingMore: false,
    hasMore: true,
    _socket: null,
    _heartbeatTimer: null,
    _reconnectTimer: null,
    _reconnectCount: 0,
    _token: null,

    // ========== Actions ==========
    
    /**
     * 连接讨论区
     */
    connect: (activityId: string, token: string) => {
      const state = get()
      
      // 如果已连接到同一活动，跳过
      if (state.activityId === activityId && state.connectionStatus === 'connected') {
        return
      }
      
      // 断开现有连接
      if (state._socket) {
        state.disconnect()
      }
      
      set((draft) => {
        draft.activityId = activityId
        draft._token = token
        draft.connectionStatus = 'connecting'
        draft.error = null
        draft.messages = []
        draft.onlineCount = 0
        draft._reconnectCount = 0
      })
      
      const wsUrl = getWsUrl(activityId, token)
      
      const socket = wx.connectSocket({
        url: wsUrl,
        success: () => {
          console.log('[Discussion] WebSocket connecting...')
        },
        fail: (err) => {
          console.error('[Discussion] WebSocket connect failed:', err)
          set((draft) => {
            draft.connectionStatus = 'disconnected'
            draft.error = '连接失败，请检查网络'
          })
        },
      })
      
      set((draft) => {
        draft._socket = socket
      })
      
      // 连接成功
      socket.onOpen(() => {
        console.log('[Discussion] WebSocket connected')
        set((draft) => {
          draft.connectionStatus = 'connected'
          draft._reconnectCount = 0
        })
        
        // 启动心跳
        get()._startHeartbeat()
      })
      
      // 收到消息
      socket.onMessage((res) => {
        try {
          const msg: WsServerMessage = JSON.parse(res.data as string)
          get()._handleMessage(msg)
        } catch (e) {
          console.error('[Discussion] Parse message failed:', e)
        }
      })
      
      // 连接关闭
      socket.onClose((res) => {
        console.log('[Discussion] WebSocket closed:', res.code, res.reason)
        
        get()._stopHeartbeat()
        
        set((draft) => {
          draft._socket = null
        })
        
        // 处理不同关闭码
        const code = res.code
        if (code === 4001) {
          set((draft) => {
            draft.connectionStatus = 'disconnected'
            draft.error = '登录已过期，请重新登录'
          })
        } else if (code === 4003) {
          set((draft) => {
            draft.connectionStatus = 'disconnected'
            draft.error = '您还未报名该活动'
          })
        } else if (code === 4010) {
          set((draft) => {
            draft.connectionStatus = 'disconnected'
            draft.isArchived = true
            draft.error = '讨论区已归档'
          })
        } else if (code === 4004) {
          set((draft) => {
            draft.connectionStatus = 'disconnected'
            draft.error = '活动不存在'
          })
        } else {
          // 尝试重连
          get()._tryReconnect()
        }
      })
      
      // 连接错误
      socket.onError((err) => {
        console.error('[Discussion] WebSocket error:', err)
        set((draft) => {
          draft.error = '连接出错'
        })
      })
    },
    
    /**
     * 断开连接
     */
    disconnect: () => {
      const state = get()
      
      state._stopHeartbeat()
      state._stopReconnect()
      
      if (state._socket) {
        state._socket.close({
          code: 1000,
          reason: 'User disconnect',
        })
      }
      
      set((draft) => {
        draft._socket = null
        draft.connectionStatus = 'disconnected'
        draft.activityId = null
        draft._token = null
      })
    },
    
    /**
     * 发送消息
     */
    sendMessage: (content: string) => {
      const state = get()
      
      if (!state._socket || state.connectionStatus !== 'connected') {
        set((draft) => {
          draft.error = '未连接到讨论区'
        })
        return
      }
      
      if (state.isArchived) {
        set((draft) => {
          draft.error = '讨论区已归档，无法发送消息'
        })
        return
      }
      
      const message = JSON.stringify({
        type: 'message',
        content: content.trim(),
      })
      
      state._socket.send({
        data: message,
        fail: (err) => {
          console.error('[Discussion] Send message failed:', err)
          set((draft) => {
            draft.error = '发送失败，请重试'
          })
        },
      })
    },
    
    /**
     * 加载更多历史消息
     */
    loadMore: async () => {
      const state = get()
      
      if (state.isLoadingMore || !state.hasMore || !state.activityId) {
        return
      }
      
      set((draft) => {
        draft.isLoadingMore = true
      })
      
      try {
        // 获取最早消息的 ID
        const oldestMessage = state.messages[0]
        const since = oldestMessage?.id
        
        // 调用 HTTP 接口获取更多历史消息
        const { request } = await import('../api/client')
        const response = await request<{
          messages: DiscussionMessage[]
          isArchived: boolean
        }>({
          url: `/chat/${state.activityId}/messages`,
          method: 'GET',
          data: {
            since,
            limit: 20,
          },
        })
        
        if (response.messages.length < 20) {
          set((draft) => {
            draft.hasMore = false
          })
        }
        
        // 将新消息添加到列表开头
        set((draft) => {
          draft.messages = [...response.messages, ...draft.messages]
          draft.isLoadingMore = false
        })
      } catch (error) {
        console.error('[Discussion] Load more failed:', error)
        set((draft) => {
          draft.isLoadingMore = false
          draft.error = '加载失败'
        })
      }
    },
    
    /**
     * 清除错误
     */
    clearError: () => {
      set((draft) => {
        draft.error = null
      })
    },
    
    // ========== Internal Methods ==========
    
    /**
     * 处理服务端消息
     */
    _handleMessage: (msg: WsServerMessage) => {
      switch (msg.type) {
        case 'history':
          set((draft) => {
            draft.messages = msg.data as DiscussionMessage[]
          })
          break
          
        case 'message':
          set((draft) => {
            draft.messages.push(msg.data as DiscussionMessage)
          })
          break
          
        case 'online':
          set((draft) => {
            draft.onlineCount = (msg.data as { count: number }).count
          })
          break
          
        case 'join':
          // 可以显示加入提示
          break
          
        case 'leave':
          // 可以显示离开提示
          break
          
        case 'error':
          const errorData = msg.data as { code: number; message: string }
          set((draft) => {
            draft.error = errorData.message
          })
          break
          
        case 'pong':
          // 心跳响应，不需要处理
          break
      }
    },
    
    /**
     * 启动心跳
     */
    _startHeartbeat: () => {
      const state = get()
      
      state._stopHeartbeat()
      
      const timer = setInterval(() => {
        const currentState = get()
        if (currentState._socket && currentState.connectionStatus === 'connected') {
          currentState._socket.send({
            data: JSON.stringify({ type: 'ping' }),
          })
        }
      }, HEARTBEAT_INTERVAL)
      
      set((draft) => {
        draft._heartbeatTimer = timer as unknown as number
      })
    },
    
    /**
     * 停止心跳
     */
    _stopHeartbeat: () => {
      const state = get()
      if (state._heartbeatTimer) {
        clearInterval(state._heartbeatTimer)
        set((draft) => {
          draft._heartbeatTimer = null
        })
      }
    },
    
    /**
     * 尝试重连
     */
    _tryReconnect: () => {
      const state = get()
      
      if (state._reconnectCount >= MAX_RECONNECT_COUNT) {
        set((draft) => {
          draft.connectionStatus = 'disconnected'
          draft.error = '连接已断开，请刷新页面重试'
        })
        return
      }
      
      if (!state.activityId || !state._token) {
        return
      }
      
      set((draft) => {
        draft.connectionStatus = 'reconnecting'
        draft._reconnectCount += 1
      })
      
      // 指数退避重连
      const delay = RECONNECT_BASE_INTERVAL * Math.pow(2, state._reconnectCount)
      
      const timer = setTimeout(() => {
        const currentState = get()
        if (currentState.activityId && currentState._token) {
          currentState.connect(currentState.activityId, currentState._token)
        }
      }, delay)
      
      set((draft) => {
        draft._reconnectTimer = timer as unknown as number
      })
    },
    
    /**
     * 停止重连
     */
    _stopReconnect: () => {
      const state = get()
      if (state._reconnectTimer) {
        clearTimeout(state._reconnectTimer)
        set((draft) => {
          draft._reconnectTimer = null
        })
      }
    },
  }))
)

// ============================================================================
// Selectors
// ============================================================================

/** 是否已连接 */
export const selectIsConnected = (state: DiscussionState) => 
  state.connectionStatus === 'connected'

/** 是否正在连接 */
export const selectIsConnecting = (state: DiscussionState) => 
  state.connectionStatus === 'connecting' || state.connectionStatus === 'reconnecting'

/** 获取消息数量 */
export const selectMessageCount = (state: DiscussionState) => 
  state.messages.length

export default useDiscussionStore

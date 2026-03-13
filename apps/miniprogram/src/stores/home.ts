/**
 * 首页对话状态管理 - Chat-First 架构核心
 * 
 * 数据来源：conversations 表
 * 功能：管理用户与 AI 的对话历史
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  AiConversationsResponseItemsAnyOfItem,
  AiConversationsResponseItemsAnyOfItemRole,
  AiConversationsResponseItemsAnyOfItemType,
} from '../api/model'
import {
  getAiConversations,
  postAiConversations,
  deleteAiConversations,
} from '../api/endpoints/ai/ai'
import { useUserStore } from './user'

// 最大缓存消息数量
const MAX_CACHED_MESSAGES = 50

// 消息类型别名（方便使用）
export type ConversationMessage = AiConversationsResponseItemsAnyOfItem
export type MessageRole = AiConversationsResponseItemsAnyOfItemRole
export type MessageType = AiConversationsResponseItemsAnyOfItemType

/**
 * AI SDK v6 UIMessagePart 接口
 * 用于存储 tool call 历史，支持多轮对话上下文
 * @see https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol
 */
export interface UIMessagePart {
  /** Part 类型：'text' 或 'tool-{toolName}' */
  type: string
  /** 文本内容（text part） */
  text?: string
  /** Tool Call ID（tool part） */
  toolCallId?: string
  /** Tool 名称（tool part） */
  toolName?: string
  /** Tool 输入参数（tool part） */
  input?: unknown
  /** Tool 输出结果（tool part） */
  output?: unknown
  /** Tool 状态：'call' | 'output-available'（tool part） */
  state?: 'call' | 'output-available'
}

// 本地临时消息（用于乐观更新）
export interface LocalMessage {
  id: string
  role: MessageRole
  type: MessageType
  content: unknown
  createdAt: string
  isLocal: true // 标记为本地消息
  /** AI SDK v6 格式的 parts（用于 tool call history） */
  parts?: UIMessagePart[]
}

// 扩展 ConversationMessage 以支持 parts
export interface ChatMessage {
  id: string
  userId?: string
  userNickname?: string | null
  role: MessageRole
  type: MessageType
  content: unknown
  activityId?: string | null
  createdAt: string
  isLocal?: true
  /** AI SDK v6 格式的 parts（用于 tool call history） */
  parts?: UIMessagePart[]
}

interface HomeState {
  // 消息列表
  messages: ChatMessage[]
  
  // 分页状态
  cursor: string | null
  hasMore: boolean
  total: number
  
  // 加载状态
  isLoading: boolean
  isLoadingMore: boolean
  
  // 错误状态
  error: string | null
  
  // Actions
  loadMessages: () => Promise<void>
  loadMoreMessages: () => Promise<void>
  addUserMessage: (content: string) => Promise<ChatMessage>
  addAIMessage: (message: Omit<ChatMessage, 'id' | 'userId' | 'userNickname' | 'createdAt'> & { id?: string; parts?: UIMessagePart[] }) => void
  clearMessages: () => Promise<void>
  setError: (error: string | null) => void
  
  // 内部方法
  _trimMessages: () => void
}

// 微信小程序存储适配器
const wechatStorage = {
  getItem: (name: string) => {
    return wx.getStorageSync(name) || null
  },
  setItem: (name: string, value: string) => {
    wx.setStorageSync(name, value)
  },
  removeItem: (name: string) => {
    wx.removeStorageSync(name)
  },
}

// 生成本地消息 ID
const generateLocalId = () => `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

function getCurrentUserId(): string {
  const currentUserId = useUserStore.getState().user?.id
  if (typeof currentUserId === 'string' && currentUserId.length > 0) {
    return currentUserId
  }

  const cachedUserInfo = wx.getStorageSync('userInfo') as { id?: string } | null
  return typeof cachedUserInfo?.id === 'string' ? cachedUserInfo.id : ''
}

function isConversationMessage(item: unknown): item is ConversationMessage {
  if (!item || typeof item !== 'object') {
    return false
  }

  const candidate = item as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.role === 'string' &&
    typeof candidate.type === 'string' &&
    Object.prototype.hasOwnProperty.call(candidate, 'content')
  )
}

export const useHomeStore = create<HomeState>()(
  persist(
    immer((set, get) => ({
      // 初始状态
      messages: [],
      cursor: null,
      hasMore: true,
      total: 0,
      isLoading: false,
      isLoadingMore: false,
      error: null,

      // 加载消息（首次加载或刷新）
      loadMessages: async () => {
        const state = get()
        if (state.isLoading) return

        set((draft) => {
          draft.isLoading = true
          draft.error = null
        })

        try {
          const userId = getCurrentUserId()
          if (!userId) {
            throw new Error('缺少用户ID，请重新登录')
          }

          const response = await getAiConversations({
            userId,
            limit: 20,
          })

          if (response.status === 200 && response.data) {
            const { items, cursor, hasMore, total } = response.data
            const messageItems = (Array.isArray(items) ? items : []).filter(isConversationMessage)
            
            set((draft) => {
              // 按时间正序排列（旧消息在前，新消息在后）
              draft.messages = [...messageItems].reverse()
              draft.cursor = cursor
              draft.hasMore = hasMore
              draft.total = total
              draft.isLoading = false
            })
          } else {
            throw new Error('加载消息失败')
          }
        } catch (error: any) {
          console.error('加载消息失败:', error)
          set((draft) => {
            draft.isLoading = false
            draft.error = error?.message || '加载消息失败'
          })
        }
      },

      // 加载更多消息（分页）
      loadMoreMessages: async () => {
        const state = get()
        if (state.isLoadingMore || !state.hasMore || !state.cursor) return

        set((draft) => {
          draft.isLoadingMore = true
          draft.error = null
        })

        try {
          const userId = getCurrentUserId()
          if (!userId) {
            throw new Error('缺少用户ID，请重新登录')
          }

          const response = await getAiConversations({
            userId,
            cursor: state.cursor,
            limit: 20,
          })

          if (response.status === 200 && response.data) {
            const { items, cursor, hasMore, total } = response.data
            const messageItems = (Array.isArray(items) ? items : []).filter(isConversationMessage)
            
            set((draft) => {
              // 旧消息插入到列表前面
              const newMessages = [...messageItems].reverse()
              draft.messages = [...newMessages, ...draft.messages]
              draft.cursor = cursor
              draft.hasMore = hasMore
              draft.total = total
              draft.isLoadingMore = false
              
              // 裁剪消息数量
              get()._trimMessages()
            })
          } else {
            throw new Error('加载更多消息失败')
          }
        } catch (error: any) {
          console.error('加载更多消息失败:', error)
          set((draft) => {
            draft.isLoadingMore = false
            draft.error = error?.message || '加载更多消息失败'
          })
        }
      },

      // 添加用户消息（乐观更新）
      addUserMessage: async (content: string) => {
        // 创建本地临时消息
        const localMessage: LocalMessage = {
          id: generateLocalId(),
          role: 'user',
          type: 'text',
          content: { text: content },
          createdAt: new Date().toISOString(),
          isLocal: true,
        }

        // 乐观更新：立即显示消息
        set((draft) => {
          draft.messages.push(localMessage)
          draft.error = null
        })

        try {
          // 调用 API 保存消息
          const response = await postAiConversations({
            content,
          })

          if (response.status === 200 && response.data) {
            // API 返回 { id, msg }，用服务器返回的 ID 更新本地消息
            const serverId = response.data.id
            
            // 用服务器返回的 ID 更新本地消息
            set((draft) => {
              const index = draft.messages.findIndex(m => m.id === localMessage.id)
              if (index !== -1) {
                // 保留本地消息结构，只更新 ID
                const updatedMessage: ConversationMessage = {
                  id: serverId,
                  userId: '',
                  userNickname: null,
                  role: 'user',
                  type: 'text',
                  content: { text: content },
                  activityId: null,
                  createdAt: localMessage.createdAt,
                }
                draft.messages[index] = updatedMessage
              }
            })
            
            // 返回更新后的消息
            const updatedMessage: ConversationMessage = {
              id: serverId,
              userId: '',
              userNickname: null,
              role: 'user',
              type: 'text',
              content: { text: content },
              activityId: null,
              createdAt: localMessage.createdAt,
            }
            return updatedMessage
          } else {
            throw new Error('发送消息失败')
          }
        } catch (error: any) {
          console.error('发送消息失败:', error)
          
          // 发送失败时，标记消息为错误状态（但保留显示）
          set((draft) => {
            draft.error = error?.message || '发送消息失败'
          })
          
          // 返回本地消息
          return localMessage
        }
      },

      // 添加 AI 消息（用于流式响应）
      addAIMessage: (message) => {
        const aiMessage: ChatMessage = {
          id: message.id || generateLocalId(),
          userId: '',
          userNickname: null,
          role: message.role,
          type: message.type,
          content: message.content,
          activityId: message.activityId || null,
          createdAt: new Date().toISOString(),
          parts: message.parts, // 保存 tool parts
        }

        set((draft) => {
          // 检查是否已存在相同 ID 的消息（用于更新流式消息）
          const existingIndex = draft.messages.findIndex(m => m.id === aiMessage.id)
          if (existingIndex !== -1) {
            // 更新现有消息
            draft.messages[existingIndex] = aiMessage
          } else {
            // 添加新消息
            draft.messages.push(aiMessage)
          }
          
          // 裁剪消息数量
          get()._trimMessages()
        })
      },

      // 清空对话历史（开始新对话）
      clearMessages: async () => {
        set((draft) => {
          draft.isLoading = true
          draft.error = null
        })

        try {
          const response = await deleteAiConversations()

          if (response.status === 200) {
            set((draft) => {
              draft.messages = []
              draft.cursor = null
              draft.hasMore = true
              draft.total = 0
              draft.isLoading = false
            })
          } else {
            throw new Error('清空对话失败')
          }
        } catch (error: any) {
          console.error('清空对话失败:', error)
          set((draft) => {
            draft.isLoading = false
            draft.error = error?.message || '清空对话失败'
          })
        }
      },

      // 设置错误状态
      setError: (error) => {
        set((draft) => {
          draft.error = error
        })
      },

      // 内部方法：裁剪消息数量，保持最近 50 条
      _trimMessages: () => {
        set((draft) => {
          if (draft.messages.length > MAX_CACHED_MESSAGES) {
            // 保留最新的消息
            draft.messages = draft.messages.slice(-MAX_CACHED_MESSAGES)
            // 标记还有更多历史消息
            draft.hasMore = true
          }
        })
      },
    })),
    {
      name: 'home-store',
      storage: createJSONStorage(() => wechatStorage),
      // 只持久化消息列表和分页状态
      partialize: (state) => ({
        messages: state.messages.slice(-MAX_CACHED_MESSAGES), // 只缓存最近 50 条
        cursor: state.cursor,
        hasMore: state.hasMore,
        total: state.total,
      }),
    }
  )
)

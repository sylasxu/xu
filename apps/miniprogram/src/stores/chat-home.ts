/**
 * 对话主场会话摘要状态管理
 *
 * 数据来源：conversations 表
 * 功能：缓存对话主场摘要，不再把会话列表误当成消息列表使用
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AiConversationsResponseItemsItem } from '../api/model'
import {
  getAiConversations,
  deleteAiConversations,
} from '../api/endpoints/ai/ai'
import { useUserStore } from './user'

const MAX_CACHED_CONVERSATIONS = 20

export type ConversationSummary = AiConversationsResponseItemsItem

interface HomeState {
  conversations: ConversationSummary[]
  cursor: string | null
  hasMore: boolean
  total: number
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  loadConversations: () => Promise<void>
  loadMoreConversations: () => Promise<void>
  clearConversations: () => Promise<void>
  setError: (error: string | null) => void
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function getCurrentUserId(): string {
  const currentUserId = useUserStore.getState().user?.id
  if (typeof currentUserId === 'string' && currentUserId.length > 0) {
    return currentUserId
  }

  const cachedUserInfo = wx.getStorageSync('userInfo')
  if (isRecord(cachedUserInfo) && typeof cachedUserInfo.id === 'string') {
    return cachedUserInfo.id
  }

  return ''
}

export const useChatHomeStore = create<HomeState>()(
  persist(
    immer((set, get) => ({
      conversations: [],
      cursor: null,
      hasMore: true,
      total: 0,
      isLoading: false,
      isLoadingMore: false,
      error: null,

      loadConversations: async () => {
        if (get().isLoading) {
          return
        }

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
            limit: MAX_CACHED_CONVERSATIONS,
          })

          if (response.status !== 200 || !response.data) {
            throw new Error('加载会话失败')
          }

          const { items, cursor, hasMore, total } = response.data

          set((draft) => {
            draft.conversations = Array.isArray(items) ? items : []
            draft.cursor = cursor
            draft.hasMore = hasMore
            draft.total = total
            draft.isLoading = false
          })
        } catch (error) {
          console.error('加载会话失败:', error)
          set((draft) => {
            draft.isLoading = false
            draft.error = readErrorMessage(error, '加载会话失败')
          })
        }
      },

      loadMoreConversations: async () => {
        const state = get()
        if (state.isLoadingMore || !state.hasMore || !state.cursor) {
          return
        }

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
            limit: MAX_CACHED_CONVERSATIONS,
          })

          if (response.status !== 200 || !response.data) {
            throw new Error('加载更多会话失败')
          }

          const { items, cursor, hasMore, total } = response.data

          set((draft) => {
            draft.conversations = [
              ...draft.conversations,
              ...(Array.isArray(items) ? items : []),
            ]
            draft.cursor = cursor
            draft.hasMore = hasMore
            draft.total = total
            draft.isLoadingMore = false
          })
        } catch (error) {
          console.error('加载更多会话失败:', error)
          set((draft) => {
            draft.isLoadingMore = false
            draft.error = readErrorMessage(error, '加载更多会话失败')
          })
        }
      },

      clearConversations: async () => {
        set((draft) => {
          draft.isLoading = true
          draft.error = null
        })

        try {
          const response = await deleteAiConversations()

          if (response.status !== 200) {
            throw new Error('清空对话失败')
          }

          set((draft) => {
            draft.conversations = []
            draft.cursor = null
            draft.hasMore = true
            draft.total = 0
            draft.isLoading = false
          })
        } catch (error) {
          console.error('清空对话失败:', error)
          set((draft) => {
            draft.isLoading = false
            draft.error = readErrorMessage(error, '清空对话失败')
          })
        }
      },

      setError: (error) => {
        set((draft) => {
          draft.error = error
        })
      },
    })),
    {
      name: 'chat-conversations-store',
      storage: createJSONStorage(() => wechatStorage),
      partialize: (state) => ({
        conversations: state.conversations.slice(0, MAX_CACHED_CONVERSATIONS),
        cursor: state.cursor,
        hasMore: state.hasMore,
        total: state.total,
      }),
    }
  )
)

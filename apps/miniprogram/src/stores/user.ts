/**
 * 用户状态管理 - 基于 Zustand
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User, LoginParams, UpdateUserParams } from '../types/global'
// 使用生成的 API
import { getUsersById, putUsersById } from '../api/endpoints/users/users'
import { postAuthLogin } from '../api/endpoints/auth/auth'
import type { AuthLoginResponse } from '../api/model'

const UNLIMITED_AI_CREATE_QUOTA = 999

interface UserState {
  // 状态
  user: User | null
  token: string | null
  isLoggedIn: boolean
  isLoading: boolean
  
  // Actions
  login: (params: LoginParams) => Promise<void>
  logout: () => void
  updateProfile: (data: UpdateUserParams) => Promise<void>
  refreshUserInfo: () => Promise<void>
  recordCreatedActivity: () => void
  setLoading: (loading: boolean) => void
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

export const useUserStore = create<UserState>()(
  persist(
    immer((set, get) => ({
      // 初始状态
      user: null,
      token: null,
      isLoggedIn: false,
      isLoading: false,

      // 登录
      login: async (params) => {
        set((state) => {
          state.isLoading = true
        })

        try {
          const response = await postAuthLogin({ code: params.code })
          
          // 检查响应状态
          if (response.status !== 200) {
            throw new Error('登录失败')
          }
          
          const result = response.data as AuthLoginResponse
          
          set((state) => {
            state.user = result.user as User
            state.token = result.token
            state.isLoggedIn = true
            state.isLoading = false
          })

          // 同步到微信存储
          wx.setStorageSync('token', result.token)
          wx.setStorageSync('userInfo', result.user)

        } catch (error: unknown) {
          set((state) => {
            state.isLoading = false
          })
          throw error
        }
      },

      // 退出登录
      logout: () => {
        set((state) => {
          state.user = null
          state.token = null
          state.isLoggedIn = false
        })

        // 清除微信存储
        wx.removeStorageSync('token')
        wx.removeStorageSync('userInfo')
      },

      // 更新用户资料
      updateProfile: async (data) => {
        const { user } = get()
        if (!user) throw new Error('用户未登录')

        set((state) => {
          state.isLoading = true
        })

        try {
          const response = await putUsersById(user.id, data)
          
          // 检查响应状态
          if (response.status !== 200) {
            throw new Error('更新用户信息失败')
          }
          
          const updatedUser = response.data
          
          set((state) => {
            state.user = updatedUser as User
            state.isLoading = false
          })

          // 同步到微信存储
          wx.setStorageSync('userInfo', updatedUser)

        } catch (error: unknown) {
          set((state) => {
            state.isLoading = false
          })
          throw error
        }
      },

      // 刷新用户信息
      refreshUserInfo: async () => {
        const { token, user } = get()
        if (!token || !user) return

        try {
          const response = await getUsersById(user.id)
          
          // 检查响应状态
          if (response.status !== 200) {
            throw new Error('获取用户信息失败')
          }
          
          const userInfo = response.data
          
          set((state) => {
            state.user = userInfo as User
          })

          wx.setStorageSync('userInfo', userInfo)
        } catch (error: unknown) {
          console.error('刷新用户信息失败:', error)
          // 如果是认证错误，自动退出登录
          const errorMessage = error instanceof Error ? error.message : ''
          if (errorMessage.includes('401') || errorMessage.includes('未授权')) {
            get().logout()
          }
        }
      },

      // 本地同步创建活动成功后的用户信息
      recordCreatedActivity: () => {
        set((state) => {
          if (!state.user) {
            return
          }

          if ((state.user.aiCreateQuotaToday ?? 0) < UNLIMITED_AI_CREATE_QUOTA) {
            state.user.aiCreateQuotaToday = Math.max(0, (state.user.aiCreateQuotaToday ?? 0) - 1)
          }
          state.user.activitiesCreatedCount = (state.user.activitiesCreatedCount ?? 0) + 1
          state.user.updatedAt = new Date().toISOString()
        })

        const currentUser = get().user
        if (currentUser) {
          wx.setStorageSync('userInfo', currentUser)
        }
      },

      // 设置加载状态
      setLoading: (loading) => {
        set((state) => {
          state.isLoading = loading
        })
      },
    })),
    {
      name: 'user-store',
      storage: createJSONStorage(() => wechatStorage),
      // 只持久化必要的数据
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
)

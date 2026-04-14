import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { setCookie, removeCookie } from '@/lib/cookies'
import { auth as edenAuth } from '@/lib/eden'

const ACCESS_TOKEN = 'admin_token'

interface AuthUser {
  id: string
  username: string  // nickname
  email: string     // phoneNumber@xu.example
  phoneNumber?: string
  avatarUrl?: string
  role?: {
    id: string
    name: string
    permissions: Array<{
      resource: string
      actions: string[]
    }>
  }
  exp: number
}

interface AuthState {
  user: AuthUser | null
  accessToken: string
  setUser: (user: AuthUser | null) => void
  setAccessToken: (accessToken: string) => void
  resetAccessToken: () => void
  reset: () => void
  isAuthenticated: () => boolean
  hasPermission: (resource: string, action: string) => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      // 初始化时从 localStorage 读取 token（与 Eden Treaty 保持一致）
      const initToken = edenAuth.getToken() || ''
      
      return {
        user: null,
        accessToken: initToken,
        
        setUser: (user) => set({ user }),
        
        setAccessToken: (accessToken) => {
          // 同时更新 localStorage 和 cookie（向后兼容）
          edenAuth.setToken(accessToken)
          setCookie(ACCESS_TOKEN, JSON.stringify(accessToken))
          set({ accessToken })
        },
        
        resetAccessToken: () => {
          // 同时清除 localStorage 和 cookie
          edenAuth.clearToken()
          removeCookie(ACCESS_TOKEN)
          set({ accessToken: '' })
        },
        
        reset: () => {
          // 完全重置认证状态
          edenAuth.clearToken()
          removeCookie(ACCESS_TOKEN)
          set({ user: null, accessToken: '' })
        },
        
        isAuthenticated: () => {
          const { accessToken, user } = get()
          return !!accessToken && !!user && user.exp > Date.now() / 1000
        },
        
        hasPermission: (resource, action) => {
          const { user } = get()
          if (!user || !user.role) return false
          
          return user.role.permissions.some(permission => 
            permission.resource === resource && 
            permission.actions.includes(action)
          )
        },
      }
    },
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
      }),
    }
  )
)

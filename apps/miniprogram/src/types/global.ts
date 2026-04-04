/**
 * 全局类型定义
 */

// API 响应格式
export interface ApiResponse<T = unknown> {
  code: number
  msg: string
  data?: T
}

// 用户类型定义 (MVP v3.3)
export interface User {
  id: string
  phoneNumber: string | null
  nickname: string | null
  avatarUrl: string | null
  aiCreateQuotaToday: number
  aiQuotaResetAt: string | null
  createdAt: string
  updatedAt: string
}

// 登录参数
export interface LoginParams {
  code: string
  phoneNumber?: string | null
  nickname?: string | null
  avatarUrl?: string | null
}

// 更新用户参数
export interface UpdateUserParams {
  nickname?: string
  avatarUrl?: string
}

// 登录响应
export interface LoginResponse {
  user: User
  token: string
  isNewUser: boolean
}

// 活动类型
export type ActivityType = 'food' | 'entertainment' | 'sports' | 'boardgame' | 'other'

// 活动状态
export type ActivityStatus = 'draft' | 'active' | 'completed' | 'cancelled'

// 活动数据
export interface ActivityData {
  id: string
  creatorId: string
  title: string
  description?: string | null
  location: [number, number] // [lng, lat]
  locationName: string
  address?: string | null
  locationHint: string
  startAt: string
  type: ActivityType
  maxParticipants: number
  currentParticipants: number
  status: ActivityStatus
  isArchived?: boolean
  createdAt: string
  updatedAt: string
  creator?: {
    id: string
    nickname: string | null
    avatarUrl: string | null
  } | null
}

// 草稿数据 (AI 解析结果)
export interface DraftData {
  id?: string
  activityId?: string
  title: string
  description?: string
  type: ActivityType
  location?: {
    lat: number
    lng: number
    name: string
    address?: string
  }
  locationHint?: string
  startAt?: string
  maxParticipants?: number
}

// 探索数据 (Widget_Explore)
export interface ExploreData {
  results?: Array<{
    id: string
    title: string
    type: ActivityType
    lat: number
    lng: number
    locationName: string
    distance?: number
  }>
  // 兼容 AI 返回的 activities 字段
  activities?: Array<{
    id: string
    title: string
    type: ActivityType
    lat: number
    lng: number
    locationName: string
    distance?: number
  }>
  center?: {
    lat: number
    lng: number
    name?: string
  }
  semanticQuery?: string
  // 兼容 AI 返回的扁平结构
  lat?: number
  lng?: number
  locationName?: string
  title?: string
}

// 分享活动数据
export interface ShareActivityData extends ActivityData {
  shareTitle?: string
}

// 自定义事件类型
export interface SendEventDetail {
  text: string
}

// v3.4 新增：草稿上下文类型（用于多轮对话）
export interface DraftContext {
  activityId: string
  currentDraft: {
    title: string
    type: string
    locationName: string
    locationHint: string
    startAt: string
    maxParticipants: number
  }
}

// v3.4 新增：带草稿上下文的发送事件详情
export interface SendMessageEventDetail {
  text: string
  draftContext?: DraftContext
}

// 页面间通信回调
export interface LocationSelectedCallback {
  onLocationSelected?: (location: {
    latitude: number
    longitude: number
    name: string
    address: string
  }) => void
}

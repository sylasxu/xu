// 内容运营 - 前端类型定义

export const CONTENT_TYPE_OPTIONS = [
  { value: 'activity_recruit', label: '活动招募' },
  { value: 'buddy_story', label: '搭子故事' },
  { value: 'local_guide', label: '本地攻略' },
  { value: 'product_seed', label: '产品种草' },
] as const

export type ContentType = (typeof CONTENT_TYPE_OPTIONS)[number]['value']

export interface ContentNote {
  id: string
  topic: string
  contentType: ContentType
  batchId: string
  title: string
  body: string
  hashtags: string[]
  coverImageHint: string | null
  views: number | null
  likes: number | null
  collects: number | null
  comments: number | null
  newFollowers: number | null
  createdAt: string
  updatedAt: string
}

export interface GenerateRequest {
  topic: string
  contentType: ContentType
  count: number
  trendKeywords?: string[]
}

export interface PerformanceUpdate {
  views?: number
  likes?: number
  collects?: number
  comments?: number
  newFollowers?: number
}

export interface ContentFilters {
  page: number
  limit: number
  contentType?: ContentType
  keyword?: string
}

export interface AnalyticsData {
  byType: Array<{
    contentType: string
    avgViews: number
    avgLikes: number
    avgCollects: number
    count: number
  }>
  topNotes: ContentNote[]
  totalNotes: number
  totalWithPerformance: number
}

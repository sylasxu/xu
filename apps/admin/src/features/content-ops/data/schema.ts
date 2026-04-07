// 内容运营 - 前端类型定义

export const CONTENT_TYPE_OPTIONS = [
  { value: 'activity_recruit', label: '组局招募' },
  { value: 'buddy_story', label: '需求共鸣' },
  { value: 'local_guide', label: '本地攻略' },
  { value: 'product_seed', label: '组织入口' },
] as const

export type ContentType = (typeof CONTENT_TYPE_OPTIONS)[number]['value']

export const CONTENT_TYPE_DESCRIPTIONS: Record<ContentType, string> = {
  activity_recruit: '适合发周五下班饭搭子、周末小局这类帖子，让人一眼知道这里有人在认真攒局。',
  buddy_story: '适合写“我就是这种人”的共鸣帖，再自然带出这里能接住这种找搭子需求。',
  local_guide: '更偏本地去处和路线建议，适合写真实、能直接参考的重庆信息。',
  product_seed: '适合“谁组我就去”“想出门但没人开局”这种入口型推文，让人感觉这里真能接住他。',
}

export const CONTENT_TYPE_TOPIC_PLACEHOLDERS: Record<ContentType, string> = {
  activity_recruit: '比如：周五下班想找饭搭子的人，我最近在认真攒这种不尬聊的小局',
  buddy_story: '比如：下班后总想找人随便坐坐的人，我最近经常接到这种搭子需求',
  local_guide: '比如：重庆适合两三个人慢慢坐的地方，我想整理一版直接能抄的',
  product_seed: '比如：总想出门但每次都约不到人，这里也许能帮你更顺手地接到搭子',
}

export const CONTENT_PLATFORM_OPTIONS = [
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'douyin', label: '抖音' },
  { value: 'wechat', label: '微信' },
] as const

export type ContentPlatform = (typeof CONTENT_PLATFORM_OPTIONS)[number]['value']

export function isContentType(value: string): value is ContentType {
  return CONTENT_TYPE_OPTIONS.some((option) => option.value === value)
}

export function isContentPlatform(value: string): value is ContentPlatform {
  return CONTENT_PLATFORM_OPTIONS.some((option) => option.value === value)
}

export interface ContentNote {
  id: string
  topic: string
  platform: ContentPlatform
  contentType: ContentType
  batchId: string
  title: string
  body: string
  hashtags: string[]
  coverText: string | null
  coverImageHint: string | null
  views: number | null
  likes: number | null
  collects: number | null
  comments: number | null
  newFollowers: number | null
  publishCheck: {
    status: 'ready' | 'review' | 'rewrite'
    summary: string
    issues: string[]
  }
  trafficScript: {
    commentPrompt: string
    dmReply: string
    wechatHandoff: string
  }
  createdAt: string
  updatedAt: string
}

export interface GenerateRequest {
  topic: string
  platform: ContentPlatform
  contentType: ContentType
  count: number
  trendKeywords?: string[]
}

export interface TopicSuggestionRequest {
  platform: ContentPlatform
  contentType: ContentType
  seed?: string
}

export interface TopicSuggestionResult {
  items: string[]
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
  platform?: ContentPlatform
  contentType?: ContentType
  keyword?: string
}

export interface ContentLibraryResult {
  items: ContentNote[]
  total: number
  page: number
  limit: number
}

export interface ContentTypeAnalytics {
  contentType: ContentType
  avgViews: number
  avgLikes: number
  avgCollects: number
  count: number
}

export interface ContentAnalyticsResult {
  byType: ContentTypeAnalytics[]
  topNotes: ContentNote[]
  totalNotes: number
  totalWithPerformance: number
  pendingPerformanceCount: number
  highPerformingCount: number
  newFollowersTotal: number
}

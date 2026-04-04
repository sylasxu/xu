// Hot Keywords Schema
// 从 API 响应推导类型

export interface GlobalKeyword {
  id: string
  keyword: string
  matchType: 'exact' | 'prefix' | 'fuzzy'
  responseType: 'widget_explore' | 'widget_draft' | 'widget_ask_preference' | 'text'
  responseContent: Record<string, any>
  priority: number
  validFrom: string | null
  validUntil: string | null
  isActive: boolean
  hitCount: number
  conversionCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateGlobalKeywordRequest {
  keyword: string
  matchType: 'exact' | 'prefix' | 'fuzzy'
  responseType: 'widget_explore' | 'widget_draft' | 'widget_ask_preference' | 'text'
  responseContent: Record<string, any>
  priority?: number
  validFrom?: string
  validUntil?: string
}

export interface UpdateGlobalKeywordRequest {
  keyword?: string
  matchType?: 'exact' | 'prefix' | 'fuzzy'
  responseType?: 'widget_explore' | 'widget_draft' | 'widget_ask_preference' | 'text'
  responseContent?: Record<string, any>
  priority?: number
  validFrom?: string
  validUntil?: string
  isActive?: boolean
}

export interface HotKeywordsFilters {
  page?: number
  limit?: number
  isActive?: boolean
  matchType?: 'exact' | 'prefix' | 'fuzzy'
  responseType?: 'widget_explore' | 'widget_draft' | 'widget_ask_preference' | 'text'
  sortBy?: 'hitCount' | 'conversionRate' | 'createdAt'
  sortOrder?: 'asc' | 'desc'
  filter?: string
}

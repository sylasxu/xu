export {}

interface ActionItem {
  label: string
  action: string
  params?: Record<string, unknown>
}

interface PartnerSearchResultItem {
  id: string
  title: string
  avatarInitial: string
  avatarUrl?: string
  type: string
  locationName: string
  locationHint?: string
  timePreference?: string
  summary?: string
  matchReason?: string
  score?: number
  tags?: string[]
  actions: ActionItem[]
}

interface SearchSummary {
  locationHint: string
  timeHint?: string
  count: number
}

interface GlobalAction {
  label: string
  action: string
  params?: Record<string, unknown>
}

interface ComponentData {
  activeIndex: number
  renderResults: PartnerSearchResultItem[]
  renderSubtitle: string
  renderSearchSummary?: SearchSummary
  renderPrimaryAction?: GlobalAction
  renderSecondaryAction?: GlobalAction
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readActionItem(value: unknown): ActionItem | null {
  if (!isRecord(value)) {
    return null
  }

  const label = readString(value.label)
  const action = readString(value.action)
  if (!label || !action) {
    return null
  }

  return {
    label,
    action,
    ...(isRecord(value.params) ? { params: value.params } : {}),
  }
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readPartnerSearchResultItem(value: unknown, index: number): PartnerSearchResultItem | null {
  if (!isRecord(value)) {
    return null
  }

  const title = readString(value.title)
  if (!title) {
    return null
  }

  return {
    id: readString(value.id) || `partner_result_${index}`,
    title,
    avatarInitial: title.slice(0, 1) || '搭',
    avatarUrl: readString(value.avatarUrl) || undefined,
    type: readString(value.type) || '搭子',
    locationName: readString(value.locationName) || '待沟通',
    locationHint: readString(value.locationHint) || undefined,
    timePreference: readString(value.timePreference) || undefined,
    summary: readString(value.summary) || undefined,
    matchReason: readString(value.matchReason) || undefined,
    score: readNumber(value.score),
    tags: readTags(value.tags),
    actions: Array.isArray(value.actions)
      ? value.actions
          .map((item) => readActionItem(item))
          .filter((item): item is ActionItem => item !== null)
      : [],
  }
}

function normalizeResults(value: unknown): PartnerSearchResultItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => readPartnerSearchResultItem(item, index))
    .filter((item): item is PartnerSearchResultItem => item !== null)
}

const INITIAL_DATA: ComponentData = {
  activeIndex: 0,
  renderResults: [],
  renderSubtitle: '先按你刚才填的条件搜一轮。现在还在“先搜一下”阶段，想继续推进再点下面动作。',
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    title: {
      type: String,
      value: '先看看这些搭子',
    },
    subtitle: {
      type: String,
      value: '先看看这些已经注册过、方向也比较接近的搭子。',
    },
    presentation: {
      type: String,
      value: 'partner-carousel',
    },
    showHeader: {
      type: Boolean,
      value: true,
    },
    results: {
      type: Array,
      value: [],
    },
    searchSummary: {
      type: Object,
      value: undefined,
    },
    primaryAction: {
      type: Object,
      value: undefined,
    },
    secondaryAction: {
      type: Object,
      value: undefined,
    },
  },

  data: INITIAL_DATA,

  lifetimes: {
    attached() {
      this.syncResults()
    },
  },

  observers: {
    results() {
      this.syncResults()
    },
  },

  methods: {
    syncResults() {
      const props = this.properties as Record<string, unknown>
      const renderResults = normalizeResults(props.results)
      this.setData({
        renderResults,
        activeIndex: renderResults.length > 0 ? Math.min(this.data.activeIndex, renderResults.length - 1) : 0,
        renderSubtitle: (props.subtitle as string | undefined)
          || '先按你刚才填的条件搜一轮。现在还在“先搜一下”阶段，想继续推进再点下面动作。',
        renderSearchSummary: (props.searchSummary as SearchSummary | undefined) || undefined,
        renderPrimaryAction: (props.primaryAction as GlobalAction | undefined) || undefined,
        renderSecondaryAction: (props.secondaryAction as GlobalAction | undefined) || undefined,
      })
    },

    onSwiperChange(e: WechatMiniprogram.CustomEvent<{ current: number }>) {
      this.setData({
        activeIndex: typeof e.detail?.current === 'number' ? e.detail.current : 0,
      })
    },

    onActionTap(e: WechatMiniprogram.TouchEvent) {
      const currentTarget = e.currentTarget.dataset
      const label = readString(currentTarget.label)
      const action = readString(currentTarget.action)
      const params = isRecord(currentTarget.params) ? currentTarget.params : {}
      if (!label || !action) {
        return
      }

      this.triggerEvent('actiontap', {
        action,
        payload: params,
        source: 'widget_partner_search_results',
        originalText: label,
      })
    },
  },
})

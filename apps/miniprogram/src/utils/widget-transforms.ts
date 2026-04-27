/**
 * Widget 数据转换 — 集中式 Tool Result → Widget Data 转换
 *
 * 小程序端兼容层：将 API 返回的 Widget Spec 转换为小程序组件需要的数据格式
 * 未来 H5 端可直接消费 Widget Spec，无需此转换层
 */

type WidgetTransformFn = (result: unknown) => unknown
type AskPreferenceQuestionType = 'location' | 'type'

interface ExploreResultItem {
  id: string
  title: string
  type: string
  lat: number
  lng: number
  locationName: string
  distance?: number
}

interface ExploreCenter {
  lat: number
  lng: number
  name: string
}

interface ExploreWidgetData {
  results: ExploreResultItem[]
  center: ExploreCenter
  title: string
  semanticQuery: string
  memoryHints: string[]
  fetchConfig: Record<string, unknown> | null
  interaction: Record<string, unknown> | null
  preview: Record<string, unknown> | null
}

interface AskPreferenceOption {
  label: string
  value: string
  action?: string
  params?: Record<string, unknown>
}

interface AskPreferenceWidgetData {
  questionType: AskPreferenceQuestionType
  inputMode: 'none' | 'free-text-optional'
  question: string
  options: AskPreferenceOption[]
  allowSkip: boolean
  collectedInfo?: { location?: string; type?: string }
  disabled: boolean
}

const DEFAULT_ASK_QUESTION = '想在哪儿组局呢？'
const DEFAULT_EXPLORE_CENTER: ExploreCenter = {
  lat: 29.5647,
  lng: 106.5507,
  name: '附近',
}

const WIDGET_TRANSFORMS: Record<string, WidgetTransformFn> = {
  widget_explore: (result: unknown) => {
    const toolOutput = isRecord(result) ? result : {}
    const exploreSource = isRecord(toolOutput.explore) ? toolOutput.explore : toolOutput
    const results = readExploreResults(exploreSource.results)
    const activities = readExploreResults(exploreSource.activities)

    const widgetData: ExploreWidgetData = {
      results: results.length > 0 ? results : activities,
      center: readExploreCenter(exploreSource),
      title: readString(exploreSource.title) ?? '',
      semanticQuery: readString(exploreSource.semanticQuery) ?? '',
      memoryHints: readStringArray(exploreSource.memoryHints).length > 0
        ? readStringArray(exploreSource.memoryHints)
        : readStringArray(toolOutput.memoryHints),
      fetchConfig: isRecord(toolOutput.fetchConfig) ? toolOutput.fetchConfig : null,
      interaction: isRecord(toolOutput.interaction) ? toolOutput.interaction : null,
      preview: isRecord(toolOutput.preview) ? toolOutput.preview : null,
    }

    return widgetData
  },

  widget_ask_preference: (result: unknown) => {
    const askData = isRecord(result) ? result : {}
    const question =
      typeof askData.question === 'string' && askData.question.trim()
        ? askData.question.trim()
        : DEFAULT_ASK_QUESTION

    const collectedInfo = normalizeCollectedInfo(askData.collectedInfo)

    const widgetData: AskPreferenceWidgetData = {
      questionType: inferQuestionType(askData.questionType, question),
      inputMode: askData.inputMode === 'free-text-optional' || askData.questionType === 'location'
        ? 'free-text-optional'
        : 'none',
      question,
      options: normalizePreferenceOptions(askData.options),
      allowSkip: askData.allowSkip !== false,
      disabled: Boolean(askData.disabled),
      ...(collectedInfo ? { collectedInfo } : {}),
    }

    return widgetData
  },
}

/**
 * 统一入口：根据 Widget 类型转换 Tool Result
 * 存在对应转换函数则调用，不存在则直接透传
 */
export function transformToolResult(widgetType: string, result: unknown): unknown {
  const transform = WIDGET_TRANSFORMS[widgetType]
  return transform ? transform(result) : result
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 2)
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readExploreResult(value: unknown): ExploreResultItem | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const title = readString(value.title)
  const type = readString(value.type)
  const lat = readNumber(value.lat)
  const lng = readNumber(value.lng)
  const locationName = readString(value.locationName)

  if (!id || !title || !type || lat === null || lng === null || !locationName) {
    return null
  }

  const distance = readNumber(value.distance) ?? undefined

  return {
    id,
    title,
    type,
    lat,
    lng,
    locationName,
    ...(distance !== undefined ? { distance } : {}),
  }
}

function readExploreResults(value: unknown): ExploreResultItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => readExploreResult(item))
    .filter((item): item is ExploreResultItem => item !== null)
}

function readExploreCenter(value: Record<string, unknown>): ExploreCenter {
  const center = isRecord(value.center) ? value.center : null
  const lat = readNumber(center?.lat ?? value.lat)
  const lng = readNumber(center?.lng ?? value.lng)
  const name = readString(center?.name ?? value.locationName)

  if (lat === null || lng === null) {
    return {
      ...DEFAULT_EXPLORE_CENTER,
      ...(name ? { name } : {}),
    }
  }

  return {
    lat,
    lng,
    name: name ?? DEFAULT_EXPLORE_CENTER.name,
  }
}

function normalizeCollectedInfo(value: unknown): { location?: string; type?: string } | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const location = typeof value.location === 'string' ? value.location.trim() : ''
  const type = typeof value.type === 'string' ? value.type.trim() : ''

  if (!location && !type) {
    return undefined
  }

  return {
    ...(location ? { location } : {}),
    ...(type ? { type } : {}),
  }
}

function inferQuestionType(value: unknown, question: string): AskPreferenceQuestionType {
  if (value === 'location' || value === 'type') {
    return value
  }

  return /哪|位置|地点|附近|区域|where/i.test(question) ? 'location' : 'type'
}

function normalizePreferenceOptions(value: unknown): AskPreferenceOption[] {
  const source = parseOptionsSource(value)
  if (!Array.isArray(source)) {
    return []
  }

  return source
    .map((item) => {
      if (!isRecord(item)) {
        return null
      }

      const label = typeof item.label === 'string' ? item.label.trim() : ''
      const optionValue = typeof item.value === 'string' ? item.value.trim() : label
      const action = typeof item.action === 'string' ? item.action.trim() : ''
      const params = isRecord(item.params) ? item.params : undefined
      if (!label) {
        return null
      }

      return {
        label,
        value: optionValue,
        ...(action ? { action } : {}),
        ...(params ? { params } : {}),
      }
    })
    .filter((item): item is AskPreferenceOption => Boolean(item))
    .slice(0, 8)
}

function parseOptionsSource(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) {
      return []
    }

    try {
      return JSON.parse(text)
    } catch {
      return []
    }
  }

  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

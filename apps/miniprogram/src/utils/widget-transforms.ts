/**
 * Widget 数据转换 — 集中式 Tool Result → Widget Data 转换
 *
 * 小程序端兼容层：将 API 返回的 Widget Spec 转换为小程序组件需要的数据格式
 * 未来 H5 端可直接消费 Widget Spec，无需此转换层
 */

import type { ExploreData } from '../types/global'

type WidgetTransformFn = (result: unknown) => unknown
type AskPreferenceQuestionType = 'location' | 'type'

interface AskPreferenceOption {
  label: string
  value: string
  action?: string
  params?: Record<string, unknown>
}

interface AskPreferenceWidgetData {
  questionType: AskPreferenceQuestionType
  question: string
  options: AskPreferenceOption[]
  allowSkip: boolean
  collectedInfo?: { location?: string; type?: string }
  disabled: boolean
}

const DEFAULT_ASK_QUESTION = '想在哪儿组局呢？'

const WIDGET_TRANSFORMS: Record<string, WidgetTransformFn> = {
  widget_explore: (result: unknown) => {
    const toolOutput = isRecord(result) ? result : {}
    const exploreData = (toolOutput.explore || toolOutput) as ExploreData
    return {
      results: exploreData?.results || exploreData?.activities || [],
      center: exploreData?.center || {
        lat: exploreData?.lat || 29.5647,
        lng: exploreData?.lng || 106.5507,
        name: exploreData?.locationName || '附近',
      },
      title: exploreData?.title || '',
      semanticQuery: typeof exploreData?.semanticQuery === 'string' ? exploreData.semanticQuery : '',
      fetchConfig: isRecord(toolOutput.fetchConfig) ? toolOutput.fetchConfig : null,
      interaction: isRecord(toolOutput.interaction) ? toolOutput.interaction : null,
      preview: isRecord(toolOutput.preview) ? toolOutput.preview : null,
    }
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

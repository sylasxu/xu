/**
 * Widget 数据转换 — 集中式 Tool Result → Widget Data 转换
 *
 * 小程序端兼容层：将 API 返回的 Widget Spec 转换为小程序组件需要的数据格式
 * 未来 H5 端可直接消费 Widget Spec，无需此转换层
 */

import type { ExploreData } from '../types/global'

type WidgetTransformFn = (result: unknown) => unknown

const WIDGET_TRANSFORMS: Record<string, WidgetTransformFn> = {
  widget_explore: (result: unknown) => {
    const toolOutput = result as Record<string, unknown>
    const exploreData = (toolOutput.explore || toolOutput) as ExploreData
    return {
      results: exploreData?.results || exploreData?.activities || [],
      center: exploreData?.center || {
        lat: exploreData?.lat || 29.5647,
        lng: exploreData?.lng || 106.5507,
        name: exploreData?.locationName || '附近',
      },
      title: exploreData?.title || '',
      fetchConfig: (toolOutput.fetchConfig as Record<string, unknown>) || null,
      interaction: (toolOutput.interaction as Record<string, unknown>) || null,
      preview: (toolOutput.preview as Record<string, unknown>) || null,
    }
  },

  widget_ask_preference: (result: unknown) => {
    const askData = result as {
      questionType: 'location' | 'type'
      question: string
      options: Array<{ label: string; value: string }>
      allowSkip: boolean
      collectedInfo?: { location?: string; type?: string }
    }
    return {
      ...askData,
      allowSkip: askData.allowSkip !== false,
      disabled: false,
    }
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

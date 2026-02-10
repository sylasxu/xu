/**
 * Growth Service
 * 
 * 增长工具业务逻辑
 */

import { db, conversationMessages, aiConversationMetrics, sql, desc, and, gte, isNotNull } from '@juchang/db'
import { generateObject, jsonSchema } from 'ai'
import { t } from 'elysia'
import { toJsonSchema } from '@juchang/utils'
import { intentDisplayNames } from '../ai/intent/definitions'
import type { IntentType } from '../ai/intent/types'
import { getDeepSeekChat } from '../ai/models/adapters/deepseek'

interface PosterResult {
  headline: string
  subheadline: string
  body: string
  cta: string
  hashtags: string[]
}

interface TrendWord {
  word: string
  count: number
  trend: 'up' | 'down' | 'stable'
}

interface IntentDistribution {
  intent: string
  count: number
  percentage: number
}

interface TrendInsight {
  topWords: TrendWord[]
  intentDistribution: IntentDistribution[]
  period: '7d' | '30d'
}

/**
 * 生成文案（文案工厂）
 * 
 * TODO: 接入 AI 生成真实文案
 */
export async function generatePoster(
  text: string,
  style: 'minimal' | 'cyberpunk' | 'handwritten'
): Promise<PosterResult> {
  // 简单的模板生成（后续可接入 AI）
  const templates = {
    minimal: {
      headline: '一起来玩',
      subheadline: '简单快乐',
      cta: '扫码加入',
    },
    cyberpunk: {
      headline: '赛博聚会 🌃',
      subheadline: '未来已来',
      cta: '链接未来',
    },
    handwritten: {
      headline: '手写邀请函 ✍️',
      subheadline: '诚挚邀请',
      cta: '期待你的到来',
    },
  }

  const template = templates[style]

  // 提取关键词作为标签
  const keywords = extractKeywords(text)
  const hashtags = keywords.map(k => `#${k}`)

  return {
    headline: template.headline,
    subheadline: template.subheadline,
    body: text.slice(0, 100), // 简化处理
    cta: template.cta,
    hashtags: hashtags.slice(0, 5),
  }
}

/**
 * 简单的关键词提取
 */
function extractKeywords(text: string): string[] {
  const commonWords = ['火锅', '周末', '约饭', '重庆', '美食', '运动', '电影', '咖啡', '聚会']
  return commonWords.filter(word => text.includes(word))
}

/**
 * 高频关键词提取 Schema（用于 LLM generateObject）
 */
const KeywordExtractionSchema = t.Object({
  keywords: t.Array(t.Object({
    word: t.String({ description: '关键词' }),
    count: t.Number({ description: '出现次数' }),
  }), { maxItems: 20, description: '高频关键词列表，按出现次数降序排列' })
})

type KeywordExtraction = typeof KeywordExtractionSchema.static

/**
 * 获取热门洞察
 * 
 * - 意图分布：从 aiConversationMetrics 表查询真实意图数据
 * - 高频词：用 LLM 分析用户消息内容
 */
export async function getTrendInsights(period: '7d' | '30d'): Promise<TrendInsight> {
  const days = period === '7d' ? 7 : 30
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  // 1. 从 aiConversationMetrics 查询意图分布（复用 chat 流程的真实数据）
  const intentResults = await db
    .select({
      intent: aiConversationMetrics.intent,
      count: sql<number>`count(*)::int`,
    })
    .from(aiConversationMetrics)
    .where(
      and(
        gte(aiConversationMetrics.createdAt, startDate),
        isNotNull(aiConversationMetrics.intent)
      )
    )
    .groupBy(aiConversationMetrics.intent)

  const totalIntents = intentResults.reduce((sum, i) => sum + Number(i.count), 0)
  const intentDistribution = intentResults
    .map(i => ({
      intent: intentDisplayNames[i.intent as IntentType] || i.intent || '未知',
      count: Number(i.count),
      percentage: totalIntents > 0 ? (Number(i.count) / totalIntents) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  // 2. 查询用户消息用于 LLM 关键词提取
  const userMessages = await db
    .select({
      content: conversationMessages.content,
    })
    .from(conversationMessages)
    .where(
      and(
        sql`${conversationMessages.role} = 'user'`,
        gte(conversationMessages.createdAt, startDate)
      )
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(100) // 限制数量避免 token 过多

  // 提取文本内容
  const texts: string[] = []
  for (const msg of userMessages) {
    const content = msg.content as any
    if (typeof content === 'string') {
      texts.push(content)
    } else if (content?.text) {
      texts.push(content.text)
    }
  }

  // 3. 用 LLM 提取高频词
  let topWords: TrendWord[] = []
  if (texts.length > 0) {
    try {
      const result = await generateObject({
        model: getDeepSeekChat(),
        schema: jsonSchema<KeywordExtraction>(toJsonSchema(KeywordExtractionSchema) as any),
        prompt: `分析以下用户消息，提取高频关键词 Top 20（按出现次数排序）。
只提取有意义的词，如：活动类型（火锅、篮球、麻将）、地点（观音桥、南坪）、时间（周末、明晚）。
不要提取太通用的词如"的"、"了"、"是"。

用户消息：
${texts.join('\n')}`
      })
      topWords = result.object.keywords.map(k => ({
        word: k.word,
        count: k.count,
        trend: 'stable' as const,
      }))
    } catch (error) {
      console.error('LLM keyword extraction failed:', error)
      // 降级：返回空数组
    }
  }

  return {
    topWords,
    intentDistribution,
    period,
  }
}


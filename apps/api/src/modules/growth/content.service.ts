/**
 * Content Service - 自媒体内容运营核心业务逻辑
 *
 * 所有函数为纯函数，无 class。
 * 提供小红书笔记 AI 生成、内容库管理、效果数据回填与分析功能。
 */

import { db, contentNotes, eq, desc, sql, and, ilike, or, isNotNull } from '@juchang/db'
import type { ContentNote } from '@juchang/db'
import { generateObject, jsonSchema } from 'ai'
import { t } from 'elysia'
import { toJsonSchema } from '@juchang/utils'
import { getConfigValue } from '../ai/config/config.service'
import { getQwenModelByIntent } from '../ai/models/adapters/qwen'

// ==========================================
// AI 输出 Schema
// ==========================================

const NoteOutputSchema = t.Object({
  title: t.String({ description: '小红书标题，不超过20字，含emoji' }),
  body: t.String({ description: '正文300-800字，分段结构，含emoji排版' }),
  hashtags: t.Array(t.String(), { description: '5-10个话题标签' }),
  coverImageHint: t.String({ description: '封面图片描述提示' }),
})
type NoteOutput = typeof NoteOutputSchema.static

// ==========================================
// 默认 Prompt 模板
// ==========================================

const DEFAULT_SYSTEM_PROMPT = `你是"搭子观察员"，一个热爱重庆生活、擅长记录搭子故事的小红书博主。
你的风格：接地气、温暖、真实分享，像朋友聊天一样自然。
绝对禁止：营销腔、广告感、生硬推销。`

const DEFAULT_CONTENT_PROMPT = `请为以下主题生成一篇小红书笔记：

主题：{topic}
内容类型：{contentType}

要求：
1. 标题：不超过20字，包含吸引点击的emoji和关键词
2. 正文：300-800字，分段结构（开头hook + 正文内容 + 引导互动结尾），包含适量emoji排版
3. 话题标签：5-10个，混合热门大标签和精准小标签
4. 封面图片描述：描述适合这篇笔记的封面图片风格和内容
5. 在正文末尾自然植入引导语（如"评论区聊聊"、"想加群的扣1"）
6. 使用"搭子观察员"第三人称叙事视角`

// ==========================================
// 综合互动指标计算 SQL 表达式
// views + likes*2 + collects*3 + comments*2
// ==========================================

const engagementScoreExpr = sql<number>`
  coalesce(${contentNotes.views}, 0)
  + coalesce(${contentNotes.likes}, 0) * 2
  + coalesce(${contentNotes.collects}, 0) * 3
  + coalesce(${contentNotes.comments}, 0) * 2
`

// ==========================================
// 3.2 getTopPerformingNotes
// ==========================================

/**
 * 查询已回填效果数据的高表现笔记
 * 按综合互动指标排序：views + likes*2 + collects*3 + comments*2
 */
export async function getTopPerformingNotes(limit: number = 5): Promise<ContentNote[]> {
  const rows = await db
    .select()
    .from(contentNotes)
    .where(isNotNull(contentNotes.views))
    .orderBy(sql`${engagementScoreExpr} desc`)
    .limit(limit)

  return rows
}

// ==========================================
// 3.1 + 3.3 generateNotes (含 AI 优化逻辑)
// ==========================================

/**
 * AI 生成小红书笔记
 *
 * - 通过 getConfigValue 读取 Prompt 模板（支持热更新）
 * - 调用 generateObject (Qwen + TypeBox Schema) 生成结构化笔记
 * - 支持批量生成（循环 count 次，传入已生成标题避免重复）
 * - 当已回填记录 >= 3 条时，注入高表现笔记参考到 Prompt
 * - 生成后批量入库（共享 batchId）
 */
export async function generateNotes(params: {
  topic: string
  contentType: string
  count: number
  trendKeywords?: string[]
}): Promise<ContentNote[]> {
  const { topic, contentType, count, trendKeywords } = params
  const batchId = crypto.randomUUID()

  // 读取 Prompt 模板（缓存 30s，支持热更新）
  const systemPrompt = await getConfigValue<string>('growth.content_prompt.system', DEFAULT_SYSTEM_PROMPT)
  const contentPromptTemplate = await getConfigValue<string>('growth.content_prompt', DEFAULT_CONTENT_PROMPT)

  // AI 优化：查询高表现笔记作为参考 (Task 3.3)
  const topNotes = await getTopPerformingNotes(5)
  let referenceSection = ''
  if (topNotes.length >= 3) {
    const references = topNotes.map((n, i) =>
      `${i + 1}. 标题：${n.title}（浏览${n.views}，点赞${n.likes}，收藏${n.collects}）`
    ).join('\n')
    referenceSection = `\n\n以下是历史高表现笔记，请参考它们的标题风格和表达方式：\n${references}\n请学习这些成功笔记的特点，但不要直接复制。`
  }

  // 趋势关键词注入
  let trendSection = ''
  if (trendKeywords && trendKeywords.length > 0) {
    trendSection = `\n\n当前热门关键词：${trendKeywords.join('、')}，请适当融入内容中。`
  }

  const generatedTitles: string[] = []
  const results: ContentNote[] = []

  for (let i = 0; i < count; i++) {
    // 构建 Prompt，替换模板变量
    let contentPrompt = contentPromptTemplate
      .replace('{topic}', topic)
      .replace('{contentType}', contentType)

    contentPrompt += referenceSection
    contentPrompt += trendSection

    // 传入已生成标题避免重复
    if (generatedTitles.length > 0) {
      contentPrompt += `\n\n注意：以下标题已被使用，请确保你的标题与它们完全不同：\n${generatedTitles.map(t => `- ${t}`).join('\n')}`
    }

    const fullPrompt = `${systemPrompt}\n\n${contentPrompt}`

    const result = await generateObject({
      model: getQwenModelByIntent('chat'),
      schema: jsonSchema<NoteOutput>(toJsonSchema(NoteOutputSchema) as any),
      prompt: fullPrompt,
    })

    generatedTitles.push(result.object.title)

    // 入库
    const [inserted] = await db.insert(contentNotes).values({
      topic,
      contentType: contentType as any,
      batchId,
      title: result.object.title,
      body: result.object.body,
      hashtags: result.object.hashtags,
      coverImageHint: result.object.coverImageHint,
    }).returning()

    results.push(inserted)
  }

  return results
}


// ==========================================
// 3.4 getLibrary
// ==========================================

/**
 * 内容库列表查询
 * 支持分页、内容类型筛选、关键词搜索（topic 或 body 模糊匹配）
 * 按 createdAt 降序返回
 */
export async function getLibrary(params: {
  page: number
  limit: number
  contentType?: string
  keyword?: string
}): Promise<{ data: ContentNote[]; total: number }> {
  const { page, limit, contentType, keyword } = params
  const offset = (page - 1) * limit

  const conditions = []
  if (contentType) {
    conditions.push(eq(contentNotes.contentType, contentType as any))
  }
  if (keyword) {
    conditions.push(or(
      ilike(contentNotes.topic, `%${keyword}%`),
      ilike(contentNotes.body, `%${keyword}%`),
    )!)
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [data, totalResult] = await Promise.all([
    db
      .select()
      .from(contentNotes)
      .where(where)
      .orderBy(desc(contentNotes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentNotes)
      .where(where),
  ])

  return {
    data,
    total: totalResult[0]?.count ?? 0,
  }
}

// ==========================================
// 3.5 getNoteById / deleteNote / updatePerformance
// ==========================================

/**
 * 根据 ID 查询单条笔记
 */
export async function getNoteById(id: string): Promise<ContentNote | null> {
  const [row] = await db
    .select()
    .from(contentNotes)
    .where(eq(contentNotes.id, id))
    .limit(1)

  return row ?? null
}

/**
 * 删除笔记
 */
export async function deleteNote(id: string): Promise<boolean> {
  const result = await db
    .delete(contentNotes)
    .where(eq(contentNotes.id, id))
    .returning({ id: contentNotes.id })

  return result.length > 0
}

/**
 * 回填/更新效果数据
 */
export async function updatePerformance(
  id: string,
  data: {
    views?: number
    likes?: number
    collects?: number
    comments?: number
    newFollowers?: number
  },
): Promise<ContentNote> {
  const [updated] = await db
    .update(contentNotes)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(contentNotes.id, id))
    .returning()

  if (!updated) {
    throw new Error('笔记不存在')
  }

  return updated
}

// ==========================================
// 3.6 getAnalytics
// ==========================================

/**
 * 内容效果分析
 * - 按内容类型聚合平均浏览量/点赞数/收藏数
 * - 生成排行榜（≥5 条已回填记录时按综合互动指标排序）
 */
export async function getAnalytics(): Promise<{
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
}> {
  // 按内容类型聚合
  const byType = await db
    .select({
      contentType: contentNotes.contentType,
      avgViews: sql<number>`coalesce(avg(${contentNotes.views}), 0)::float`,
      avgLikes: sql<number>`coalesce(avg(${contentNotes.likes}), 0)::float`,
      avgCollects: sql<number>`coalesce(avg(${contentNotes.collects}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(contentNotes)
    .where(isNotNull(contentNotes.views))
    .groupBy(contentNotes.contentType)

  // 总笔记数
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)

  // 已回填效果数据的笔记数
  const [perfResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)
    .where(isNotNull(contentNotes.views))

  const totalNotes = totalResult?.count ?? 0
  const totalWithPerformance = perfResult?.count ?? 0

  // 排行榜：≥5 条已回填记录时生成
  let topNotes: ContentNote[] = []
  if (totalWithPerformance >= 5) {
    topNotes = await db
      .select()
      .from(contentNotes)
      .where(isNotNull(contentNotes.views))
      .orderBy(sql`${engagementScoreExpr} desc`)
      .limit(10)
  }

  return {
    byType,
    topNotes,
    totalNotes,
    totalWithPerformance,
  }
}

// Content Service - 内容运营领域业务逻辑

import {
  and,
  contentNotes,
  db,
  desc,
  eq,
  ilike,
  isNotNull,
  or,
  sql,
  type ContentNote,
  type ContentType,
  type SQL,
} from '@juchang/db'
import { generateObject, jsonSchema } from 'ai'
import { t } from 'elysia'
import { toJsonSchema } from '@juchang/utils'
import type {
  ContentAnalyticsResponse,
  ContentLibraryQuery,
  ContentLibraryResponse,
  ContentNoteResponse,
  PerformanceUpdateRequest,
} from './content.model'
import { getQwenModelByIntent } from '../ai/models/adapters/qwen'

const NoteOutputSchema = t.Object({
  title: t.String({ description: '内容标题，不超过20字，含 emoji 更自然' }),
  body: t.String({ description: '正文 300-800 字，分段结构，像朋友聊天一样自然' }),
  hashtags: t.Array(t.String(), { description: '5-10 个话题标签' }),
  coverImageHint: t.String({ description: '封面图片描述提示' }),
})

type NoteOutput = typeof NoteOutputSchema.static

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  activity_recruit: '活动招募',
  buddy_story: '搭子故事',
  local_guide: '本地攻略',
  product_seed: '产品种草',
}

const DEFAULT_SYSTEM_PROMPT = `你是"搭子观察员"，一个热爱重庆生活、擅长把真实社交场景写成内容稿的创作者。
你的风格：接地气、温暖、真实分享，像朋友聊天一样自然。
绝对禁止：营销腔、广告感、生硬推销。`

const DEFAULT_CONTENT_PROMPT = `请为以下主题生成一篇社交内容稿：

主题：{topic}
内容方向：{contentType}

要求：
1. 标题：不超过 20 字，包含吸引点击的 emoji 和关键词
2. 正文：300-800 字，分段结构（开头 hook + 正文内容 + 引导互动结尾），包含适量 emoji 排版
3. 话题标签：5-10 个，混合热门大标签和精准小标签
4. 封面图片描述：描述适合这篇内容的封面图片风格和内容
5. 在正文末尾自然植入互动引导（如"评论区聊聊"、"想加群的扣1"）
6. 使用真实分享口吻，不要写成平台公告或硬广`

/**
 * 查询高表现内容，用于生成时参考历史表现
 */
export async function getTopPerformingNotes(limit = 5): Promise<ContentNote[]> {
  const engagementScoreExpr = sql<number>`
    coalesce(${contentNotes.views}, 0)
    + coalesce(${contentNotes.likes}, 0) * 2
    + coalesce(${contentNotes.collects}, 0) * 3
    + coalesce(${contentNotes.comments}, 0) * 2
  `

  return db
    .select()
    .from(contentNotes)
    .where(isNotNull(contentNotes.views))
    .orderBy(desc(engagementScoreExpr))
    .limit(limit)
}

export async function generateNotes(params: {
  topic: string
  contentType: ContentType
  count: number
  trendKeywords?: string[]
}): Promise<ContentNoteResponse[]> {
  const { topic, contentType, count, trendKeywords } = params
  const batchId = crypto.randomUUID()
  const contentTypeLabel = CONTENT_TYPE_LABELS[contentType]

  const topNotes = await getTopPerformingNotes(5)
  let referenceSection = ''
  if (topNotes.length >= 3) {
    const references = topNotes
      .map(
        (note, index) =>
          `${index + 1}. 标题：${note.title}（浏览 ${note.views}，点赞 ${note.likes}，收藏 ${note.collects}）`
      )
      .join('\n')

    referenceSection = `\n\n以下是历史高表现内容，请参考它们的标题风格和表达方式：\n${references}\n请学习这些成功内容的特点，但不要直接复制。`
  }

  let trendSection = ''
  if (trendKeywords && trendKeywords.length > 0) {
    trendSection = `\n\n当前热门关键词：${trendKeywords.join('、')}，请适当融入内容中。`
  }

  const generatedTitles: string[] = []
  const results: ContentNoteResponse[] = []

  for (let index = 0; index < count; index += 1) {
    let contentPrompt = DEFAULT_CONTENT_PROMPT
      .replace('{topic}', topic)
      .replace('{contentType}', contentTypeLabel)

    contentPrompt += referenceSection
    contentPrompt += trendSection

    if (generatedTitles.length > 0) {
      contentPrompt += `\n\n注意：以下标题已被使用，请确保你的标题与它们完全不同：\n${generatedTitles
        .map((title) => `- ${title}`)
        .join('\n')}`
    }

    const result = await generateObject({
      model: getQwenModelByIntent('chat'),
      schema: jsonSchema<NoteOutput>(toJsonSchema(NoteOutputSchema)),
      prompt: `${DEFAULT_SYSTEM_PROMPT}\n\n${contentPrompt}`,
    })

    generatedTitles.push(result.object.title)

    const [inserted] = await db
      .insert(contentNotes)
      .values({
        topic,
        contentType,
        batchId,
        title: result.object.title,
        body: result.object.body,
        hashtags: result.object.hashtags,
        coverImageHint: result.object.coverImageHint,
      })
      .returning()

    results.push(formatContentNote(inserted))
  }

  return results
}

export async function getLibrary(params: ContentLibraryQuery): Promise<ContentLibraryResponse> {
  const { page = 1, limit = 20, contentType, keyword } = params
  const offset = (page - 1) * limit
  const conditions: SQL<unknown>[] = []

  if (contentType) {
    conditions.push(eq(contentNotes.contentType, contentType))
  }

  if (keyword) {
    conditions.push(
      or(
        ilike(contentNotes.topic, `%${keyword}%`),
        ilike(contentNotes.body, `%${keyword}%`),
      )!
    )
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
    items: data.map(formatContentNote),
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  }
}

export async function getNoteById(id: string): Promise<ContentNoteResponse | null> {
  const [row] = await db
    .select()
    .from(contentNotes)
    .where(eq(contentNotes.id, id))
    .limit(1)

  return row ? formatContentNote(row) : null
}

export async function deleteNote(id: string): Promise<boolean> {
  const result = await db
    .delete(contentNotes)
    .where(eq(contentNotes.id, id))
    .returning({ id: contentNotes.id })

  return result.length > 0
}

export async function updatePerformance(
  id: string,
  data: PerformanceUpdateRequest,
): Promise<ContentNoteResponse> {
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

  return formatContentNote(updated)
}

export async function getAnalytics(): Promise<ContentAnalyticsResponse> {
  const engagementScoreExpr = sql<number>`
    coalesce(${contentNotes.views}, 0)
    + coalesce(${contentNotes.likes}, 0) * 2
    + coalesce(${contentNotes.collects}, 0) * 3
    + coalesce(${contentNotes.comments}, 0) * 2
  `

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

  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)

  const [perfResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)
    .where(isNotNull(contentNotes.views))

  const totalNotes = totalResult?.count ?? 0
  const totalWithPerformance = perfResult?.count ?? 0

  const topNotes = totalWithPerformance >= 5
    ? await db
        .select()
        .from(contentNotes)
        .where(isNotNull(contentNotes.views))
        .orderBy(desc(engagementScoreExpr))
        .limit(10)
    : []

  return {
    byType: byType.map((item) => ({
      contentType: item.contentType,
      avgViews: item.avgViews,
      avgLikes: item.avgLikes,
      avgCollects: item.avgCollects,
      count: item.count,
    })),
    topNotes: topNotes.map(formatContentNote),
    totalNotes,
    totalWithPerformance,
  }
}

export function formatContentNote(note: ContentNote): ContentNoteResponse {
  return {
    id: note.id,
    topic: note.topic,
    contentType: note.contentType,
    title: note.title,
    body: note.body,
    hashtags: note.hashtags,
    coverImageHint: note.coverImageHint,
    views: note.views,
    likes: note.likes,
    collects: note.collects,
    comments: note.comments,
    newFollowers: note.newFollowers,
    batchId: note.batchId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  }
}

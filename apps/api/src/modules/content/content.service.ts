// Content Service - 内容运营领域业务逻辑
// 从 Growth/content 迁移内容库管理、AI 生成、效果追踪

import { db, contentNotes, eq, desc, sql, and, ilike, or, isNotNull } from '@juchang/db';
import type { ContentNote } from '@juchang/db';
import { generateObject, jsonSchema } from 'ai';
import { t } from 'elysia';
import { toJsonSchema } from '@juchang/utils';
import type { 
  GenerateContentRequest, 
  ContentLibraryQuery, 
  ContentLibraryResponse,
  PerformanceUpdateRequest,
  ContentAnalyticsResponse,
} from './content.model';
import { getQwenModelByIntent } from '../ai/models/adapters/qwen';

// ==========================================
// AI 生成配置
// ==========================================

const NoteOutputSchema = t.Object({
  title: t.String({ description: '小红书标题，不超过20字，含emoji' }),
  body: t.String({ description: '正文300-800字，分段结构，含emoji排版' }),
  hashtags: t.Array(t.String(), { description: '5-10个话题标签' }),
  coverImageHint: t.String({ description: '封面图片描述提示' }),
});
type NoteOutput = typeof NoteOutputSchema.static;

const DEFAULT_SYSTEM_PROMPT = `你是"搭子观察员"，一个热爱重庆生活、擅长记录搭子故事的小红书博主。
你的风格：接地气、温暖、真实分享，像朋友聊天一样自然。
绝对禁止：营销腔、广告感、生硬推销。`;

const DEFAULT_CONTENT_PROMPT = `请为以下主题生成一篇小红书笔记：

主题：{topic}
内容类型：{contentType}

要求：
1. 标题：不超过20字，包含吸引点击的emoji和关键词
2. 正文：300-800字，分段结构（开头hook + 正文内容 + 引导互动结尾），包含适量emoji排版
3. 话题标签：5-10个，混合热门大标签和精准小标签
4. 封面图片描述：描述适合这篇笔记的封面图片风格和内容
5. 在正文末尾自然植入引导语（如"评论区聊聊"、"想加群的扣1"）
6. 使用"搭子观察员"第三人称叙事视角`;

// ==========================================
// AI 生成 (复用 Growth 逻辑)
// ==========================================

/**
 * AI 生成小红书笔记
 * 从 Growth/content.service.ts 迁移
 */
export async function generateNotes(params: {
  topic: string;
  contentType: string;
  count: number;
  trendKeywords?: string[];
}): Promise<ContentNote[]> {
  const { topic, contentType, count, trendKeywords } = params;
  const batchId = crypto.randomUUID();

  // 查询高表现笔记作为参考
  const topNotes = await getTopPerformingNotes(5);
  let referenceSection = '';
  if (topNotes.length >= 3) {
    const references = topNotes.map((n, i) =>
      `${i + 1}. 标题：${n.title}（浏览${n.views}，点赞${n.likes}，收藏${n.collects}）`
    ).join('\n');
    referenceSection = `

以下是历史高表现笔记，请参考它们的标题风格和表达方式：
${references}
请学习这些成功笔记的特点，但不要直接复制。`;
  }

  // 趋势关键词注入
  let trendSection = '';
  if (trendKeywords && trendKeywords.length > 0) {
    trendSection = `

当前热门关键词：${trendKeywords.join('、')}，请适当融入内容中。`;
  }

  const generatedTitles: string[] = [];
  const results: ContentNote[] = [];

  for (let i = 0; i < count; i++) {
    let contentPrompt = DEFAULT_CONTENT_PROMPT
      .replace('{topic}', topic)
      .replace('{contentType}', contentType);

    contentPrompt += referenceSection;
    contentPrompt += trendSection;

    if (generatedTitles.length > 0) {
      contentPrompt += `

注意：以下标题已被使用，请确保你的标题与它们完全不同：
${generatedTitles.map(t => `- ${t}`).join('\n')}`;
    }

    const fullPrompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${contentPrompt}`;

    const result = await generateObject({
      model: getQwenModelByIntent('chat'),
      schema: jsonSchema<NoteOutput>(toJsonSchema(NoteOutputSchema) as any),
      prompt: fullPrompt,
    });

    generatedTitles.push(result.object.title);

    const [inserted] = await db.insert(contentNotes).values({
      topic,
      contentType: contentType as any,
      batchId,
      title: result.object.title,
      body: result.object.body,
      hashtags: result.object.hashtags,
      coverImageHint: result.object.coverImageHint,
    }).returning();

    results.push(formatContentNote(inserted));
  }

  return results;
}

// ==========================================
// 内容库管理 (从 Growth 迁移)
// ==========================================

/**
 * 查询高表现笔记（用于 AI 优化参考）
 */
export async function getTopPerformingNotes(limit: number = 5): Promise<ContentNote[]> {
  const engagementScoreExpr = sql<number>`
    coalesce(${contentNotes.views}, 0)
    + coalesce(${contentNotes.likes}, 0) * 2
    + coalesce(${contentNotes.collects}, 0) * 3
    + coalesce(${contentNotes.comments}, 0) * 2
  `;

  const rows = await db
    .select()
    .from(contentNotes)
    .where(isNotNull(contentNotes.views))
    .orderBy(desc(engagementScoreExpr))
    .limit(limit);

  return rows;
}

/**
 * 内容库列表查询
 */
export async function getLibrary(params: ContentLibraryQuery): Promise<ContentLibraryResponse> {
  const { page = 1, limit = 20, contentType, keyword } = params;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (contentType) {
    conditions.push(eq(contentNotes.contentType, contentType as any));
  }
  if (keyword) {
    conditions.push(or(
      ilike(contentNotes.topic, `%${keyword}%`),
      ilike(contentNotes.body, `%${keyword}%`),
    )!);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

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
  ]);

  return {
    items: data.map(formatContentNote),
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  };
}

/**
 * 根据 ID 查询单条笔记
 */
export async function getNoteById(id: string) {
  const [row] = await db
    .select()
    .from(contentNotes)
    .where(eq(contentNotes.id, id))
    .limit(1);

  return row ? formatContentNote(row) : null;
}

/**
 * 删除笔记
 */
export async function deleteNote(id: string): Promise<boolean> {
  const result = await db
    .delete(contentNotes)
    .where(eq(contentNotes.id, id))
    .returning({ id: contentNotes.id });

  return result.length > 0;
}

/**
 * 回填/更新效果数据
 */
export async function updatePerformance(
  id: string,
  data: PerformanceUpdateRequest,
) {
  const [updated] = await db
    .update(contentNotes)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(contentNotes.id, id))
    .returning();

  if (!updated) {
    throw new Error('笔记不存在');
  }

  return formatContentNote(updated);
}

/**
 * 内容效果分析
 */
export async function getAnalytics(): Promise<ContentAnalyticsResponse> {
  const engagementScoreExpr = sql<number>`
    coalesce(${contentNotes.views}, 0)
    + coalesce(${contentNotes.likes}, 0) * 2
    + coalesce(${contentNotes.collects}, 0) * 3
    + coalesce(${contentNotes.comments}, 0) * 2
  `;

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
    .groupBy(contentNotes.contentType);

  // 总笔记数
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes);

  // 已回填效果数据的笔记数
  const [perfResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)
    .where(isNotNull(contentNotes.views));

  const totalNotes = totalResult?.count ?? 0;
  const totalWithPerformance = perfResult?.count ?? 0;

  // 排行榜
  let topNotes: ContentNote[] = [];
  if (totalWithPerformance >= 5) {
    topNotes = await db
      .select()
      .from(contentNotes)
      .where(isNotNull(contentNotes.views))
      .orderBy(desc(engagementScoreExpr))
      .limit(10);
  }

  return {
    byType: byType.map(t => ({
      contentType: t.contentType || 'unknown',
      avgViews: t.avgViews,
      avgLikes: t.avgLikes,
      avgCollects: t.avgCollects,
      count: t.count,
    })),
    topNotes: topNotes.map(formatContentNote),
    totalNotes,
    totalWithPerformance,
  };
}

// ==========================================
// 辅助函数
// ==========================================

function formatContentNote(note: ContentNote) {
  return {
    id: note.id,
    topic: note.topic,
    contentType: note.contentType || 'xiaohongshu',
    title: note.title,
    body: note.body,
    hashtags: note.hashtags || [],
    coverImageHint: note.coverImageHint,
    views: note.views,
    likes: note.likes,
    collects: note.collects,
    comments: note.comments,
    newFollowers: note.newFollowers,
    batchId: note.batchId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

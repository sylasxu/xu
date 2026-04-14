/**
 * RAG Search - 语义检索核心函数 (v4.6 升级)
 * 
 * 纯函数式模块：
 * - indexActivity() - 索引单个活动
 * - indexActivities() - 批量索引（v4.6: 批量 Embedding API）
 * - deleteIndex() - 删除索引
 * - onActivityStatusChange() - 活动状态变更时清理索引
 * - search() - 混合检索 (Hard Filter + Vector Rank + Rerank + MaxSim)
 * - generateMatchReason() - 推荐理由生成（v4.6: 模板增强）
 * 
 * v4.5: 支持 MaxSim 个性化推荐
 * v4.6: 批量 Embedding、索引清理、动态配置、推荐理由模板
 */

import { db, eq, sql, isNotNull } from '@xu/db';
import { activities } from '@xu/db';
import type { Activity } from '@xu/db';
import type {
  HybridSearchParams,
  ScoredActivity,
  BatchIndexResult,
} from './types';
import { DEFAULT_RAG_CONFIG } from './types';
import {
  generateEmbeddingWithRetry,
  generateActivityEmbedding,
  enrichActivityText,
} from './utils';
import { getEmbeddings } from '../models/router';
import { createLogger } from '../observability/logger';
import { getInterestVectors, calculateMaxSim } from '../memory';
import { rerank } from '../models/router';
import { getConfigValue } from '../config/config.service';

const logger = createLogger('rag');

// ============ 索引操作 ============

/**
 * 索引单个活动
 * 在活动创建/更新时调用
 */
export async function indexActivity(activity: Activity): Promise<void> {
  try {
    const embedding = await generateActivityEmbedding(activity);

    await db.update(activities)
      .set({ embedding })
      .where(eq(activities.id, activity.id));

    logger.debug('Activity indexed', { activityId: activity.id });
  } catch (error) {
    logger.error('Failed to index activity', {
      activityId: activity.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 批量索引活动（v4.6 优化：批量 Embedding API）
 * 
 * 将同一批次内的 Embedding 生成请求合并为一次批量 API 调用，
 * 替代之前逐条调用 indexActivity 的方式。
 */
export async function indexActivities(
  activityList: Activity[],
  options?: { batchSize?: number; delayMs?: number }
): Promise<BatchIndexResult> {
  const {
    batchSize = DEFAULT_RAG_CONFIG.batchSize,
    delayMs = DEFAULT_RAG_CONFIG.batchDelayMs,
  } = options || {};

  let success = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  logger.info('Starting batch indexing', {
    total: activityList.length,
    batchSize,
  });

  for (let i = 0; i < activityList.length; i += batchSize) {
    const batch = activityList.slice(i, i + batchSize);

    try {
      // 批量生成富集文本
      const texts = batch.map(a => enrichActivityText(a));

      // 一次 API 调用生成整批 Embedding
      const embeddings = await getEmbeddings(texts);

      // 批量更新数据库
      for (let j = 0; j < batch.length; j++) {
        try {
          await db.update(activities)
            .set({ embedding: embeddings[j] })
            .where(eq(activities.id, batch[j].id));
          success++;
        } catch (dbError) {
          failed++;
          errors.push({
            id: batch[j].id,
            error: dbError instanceof Error ? dbError.message : String(dbError),
          });
        }
      }
    } catch (embeddingError) {
      // 整批 Embedding 失败，逐条降级
      logger.warn('Batch embedding failed, falling back to individual indexing', {
        batchStart: i,
        batchSize: batch.length,
        error: embeddingError instanceof Error ? embeddingError.message : String(embeddingError),
      });

      for (const activity of batch) {
        try {
          await indexActivity(activity);
          success++;
        } catch (error) {
          failed++;
          errors.push({
            id: activity.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // 速率限制延迟
    if (i + batchSize < activityList.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // 进度日志
    const processed = Math.min(i + batchSize, activityList.length);
    logger.info('Batch progress', {
      processed,
      total: activityList.length,
      success,
      failed,
    });
  }

  logger.info('Batch indexing completed', { success, failed });
  return { success, failed, errors };
}

/**
 * 删除活动索引
 * 在活动删除时调用
 */
export async function deleteIndex(activityId: string): Promise<void> {
  await db.update(activities)
    .set({ embedding: null })
    .where(eq(activities.id, activityId));

  logger.debug('Activity index deleted', { activityId });
}

/**
 * 活动状态变更时清理索引（v4.6 新增）
 * 
 * 当活动状态变为 completed 或 cancelled 时，将 embedding 字段设为 NULL。
 * 搜索查询已有 `isNotNull(activities.embedding)` 过滤条件，
 * 设为 NULL 即可将其从搜索结果中排除。
 */
export async function onActivityStatusChange(
  activityId: string,
  newStatus: string
): Promise<void> {
  if (newStatus === 'completed' || newStatus === 'cancelled') {
    await db.update(activities)
      .set({ embedding: null })
      .where(eq(activities.id, activityId));

    logger.info('Activity embedding cleared on status change', {
      activityId,
      newStatus,
    });
  }
}

// ============ 检索操作 ============

/**
 * 混合检索
 * 核心搜索方法：Hard Filter (SQL) → Soft Rank (Vector) → MaxSim Boost
 * 
 * v4.6: defaultLimit、defaultThreshold、maxSimBoostRatio 通过 getConfigValue 动态配置
 * 
 * 降级策略：
 * - 如果向量生成失败，降级到 location-only 搜索
 * - 如果用户无兴趣向量，跳过 MaxSim boost
 */
export async function search(params: HybridSearchParams): Promise<ScoredActivity[]> {
  // 动态加载 RAG 配置
  const ragConfig = await getConfigValue('rag.search_options', DEFAULT_RAG_CONFIG);

  const {
    semanticQuery,
    filters,
    limit = ragConfig.defaultLimit,
    threshold = ragConfig.defaultThreshold,
    includeMatchReason = false,
    userId = null,
  } = params;

  const maxSimBoostRatio = ragConfig.maxSimBoostRatio;

  logger.debug('Starting hybrid search', {
    query: semanticQuery.slice(0, 50),
    filters,
    limit,
    userId: userId ? 'present' : 'none',
  });

  // 1. 生成查询向量（带重试）
  const queryVector = await generateEmbeddingWithRetry(semanticQuery, { textType: 'query' });

  // 2. 如果向量生成失败，降级到 location-only 搜索
  if (!queryVector) {
    logger.warn('Query embedding failed, falling back to location-only search');
    return searchByLocationOnly(filters, limit);
  }

  const vectorStr = `[${queryVector.join(',')}]`;

  // 3. 获取用户兴趣向量（用于 MaxSim）
  let interestVectors: Awaited<ReturnType<typeof getInterestVectors>> = [];
  if (userId) {
    try {
      interestVectors = await getInterestVectors(userId);
      logger.debug('User interest vectors loaded', {
        userId,
        vectorCount: interestVectors.length,
      });
    } catch (error) {
      // 获取兴趣向量失败，静默跳过 MaxSim
      logger.warn('Failed to load interest vectors, skipping MaxSim', { userId, error });
    }
  }

  // 4. 构建 SQL 查询 (Hard Filter + Soft Rank)
  // 使用 pgvector 的 <=> 操作符计算余弦距离
  // similarity = 1 - cosine_distance
  const baseConditions = [
    sql`${activities.status} = 'active'`,
    sql`${activities.startAt} > NOW()`,
    sql`${activities.currentParticipants} < ${activities.maxParticipants}`,
    isNotNull(activities.embedding),
  ];

  // 位置过滤
  if (filters.location) {
    const { lat, lng, radiusInKm } = filters.location;
    baseConditions.push(
      sql`ST_DWithin(
        ${activities.location}::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        ${radiusInKm * 1000}
      )`
    );
  }

  // 类型过滤
  if (filters.type) {
    baseConditions.push(sql`${activities.type} = ${filters.type}`);
  }

  // 时间范围过滤
  if (filters.timeRange?.start) {
    baseConditions.push(sql`${activities.startAt} >= ${filters.timeRange.start}`);
  }
  if (filters.timeRange?.end) {
    baseConditions.push(sql`${activities.startAt} <= ${filters.timeRange.end}`);
  }

  // 5. 执行查询
  const results = await db.execute<{
    id: string;
    creator_id: string;
    title: string;
    description: string | null;
    location: { x: number; y: number };
    location_name: string;
    address: string | null;
    location_hint: string;
    start_at: Date;
    type: string;
    max_participants: number;
    current_participants: number;
    status: string;
    created_at: Date;
    updated_at: Date;
    embedding: number[] | null;
    lng: number;
    lat: number;
    similarity: number;
    distance?: number;
  }>(sql`
    SELECT 
      activities.*,
      ST_X(activities.location::geometry) as lng,
      ST_Y(activities.location::geometry) as lat,
      (1 - (activities.embedding <=> ${vectorStr}::vector)) as similarity
      ${filters.location ? sql`, ST_Distance(
        activities.location::geography,
        ST_SetSRID(ST_MakePoint(${filters.location.lng}, ${filters.location.lat}), 4326)::geography
      ) as distance` : sql``}
    FROM activities
    WHERE ${sql.join(baseConditions, sql` AND `)}
    ORDER BY similarity DESC
    LIMIT ${limit * 2}
  `);

  // 6. 本地轻量重排序
  // 在 Vector Rank 结果基础上做一次关键词覆盖度重排
  let rerankedResults = [...results];
  if (results.length > 3) {
    try {
      // 准备文档列表
      const documents = results.map(r =>
        `${r.title} | ${r.type} | ${r.location_name}`
      );

      // 调用 Rerank API
      const rerankResponse = await rerank(semanticQuery, documents, Math.min(results.length, 20));

      // 根据 Rerank 结果重新排序
      const rerankedIndices = rerankResponse.results.map(r => r.index);
      rerankedResults = rerankedIndices.map(idx => [...results][idx]);

      logger.debug('Rerank completed', {
        originalCount: results.length,
        rerankedCount: rerankedResults.length,
        topScore: rerankResponse.results[0]?.score,
      });
    } catch (error) {
      // Rerank 失败时静默降级，继续使用 Vector Rank 结果
      logger.warn('Rerank failed, using vector rank results', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 7. 应用 MaxSim 个性化提升（如果有兴趣向量）
  let scoredResults = rerankedResults.map((r, idx) => {
    // 基础分数：Rerank 后的位置越靠前分数越高
    let finalScore = r.similarity * (1 - idx * 0.02);  // 位置衰减

    // 如果有用户兴趣向量，计算 MaxSim 提升
    if (interestVectors.length > 0 && r.embedding) {
      const maxSim = calculateMaxSim(queryVector, interestVectors);
      if (maxSim > 0.5) {
        // 使用动态配置的 maxSimBoostRatio
        finalScore = finalScore * (1 + maxSimBoostRatio * maxSim);
        logger.debug('MaxSim boost applied', {
          activityId: r.id,
          originalScore: r.similarity,
          maxSim,
          boostedScore: finalScore,
        });
      }
    }

    return {
      ...r,
      finalScore,
    };
  });

  // 8. 按最终分数重新排序
  scoredResults.sort((a, b) => b.finalScore - a.finalScore);

  // 9. 过滤低于阈值的结果并限制数量
  const filtered = scoredResults
    .filter(r => r.similarity >= threshold)
    .slice(0, limit);

  logger.debug('Search results', {
    total: results.length,
    afterRerank: rerankedResults.length,
    filtered: filtered.length,
    threshold,
    hasMaxSimBoost: interestVectors.length > 0,
  });

  // 10. 如果结果太少 (≤3)，直接返回（节省 Token）
  if (filtered.length <= 3) {
    return filtered.map(r => ({
      activity: mapRowToActivity(r),
      score: r.finalScore,
      distance: r.distance,
    }));
  }

  // 11. 可选：生成推荐理由
  if (includeMatchReason) {
    const scoredResultsWithReason = await Promise.all(
      filtered.map(async r => {
        const activity = mapRowToActivity(r);
        const matchReason = await generateMatchReason(semanticQuery, activity, r.finalScore, r.distance);
        return {
          activity,
          score: r.finalScore,
          distance: r.distance,
          matchReason,
        };
      })
    );
    return scoredResultsWithReason;
  }

  return filtered.map(r => ({
    activity: mapRowToActivity(r),
    score: r.finalScore,
    distance: r.distance,
  }));
}

// ============ 降级搜索 ============

/**
 * 降级搜索：仅基于位置
 * 
 * 当向量生成失败时使用此函数
 * 使用 PostGIS 距离排序，不使用向量相似度
 */
async function searchByLocationOnly(
  filters: HybridSearchParams['filters'],
  limit: number = DEFAULT_RAG_CONFIG.defaultLimit
): Promise<ScoredActivity[]> {
  logger.info('Executing location-only fallback search');

  // 如果没有位置信息，返回空结果
  if (!filters.location) {
    logger.warn('No location provided for fallback search, returning empty results');
    return [];
  }

  const { lat, lng, radiusInKm } = filters.location;

  // 构建基础条件
  const baseConditions = [
    sql`${activities.status} = 'active'`,
    sql`${activities.startAt} > NOW()`,
    sql`${activities.currentParticipants} < ${activities.maxParticipants}`,
    sql`ST_DWithin(
      ${activities.location}::geography,
      ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
      ${radiusInKm * 1000}
    )`,
  ];

  // 类型过滤
  if (filters.type) {
    baseConditions.push(sql`${activities.type} = ${filters.type}`);
  }

  // 时间范围过滤
  if (filters.timeRange?.start) {
    baseConditions.push(sql`${activities.startAt} >= ${filters.timeRange.start}`);
  }
  if (filters.timeRange?.end) {
    baseConditions.push(sql`${activities.startAt} <= ${filters.timeRange.end}`);
  }

  // 执行查询，按距离排序
  const results = await db.execute<{
    id: string;
    creator_id: string;
    title: string;
    description: string | null;
    location: { x: number; y: number };
    location_name: string;
    address: string | null;
    location_hint: string;
    start_at: Date;
    type: string;
    max_participants: number;
    current_participants: number;
    status: string;
    created_at: Date;
    updated_at: Date;
    embedding: number[] | null;
    lng: number;
    lat: number;
    distance: number;
  }>(sql`
    SELECT 
      activities.*,
      ST_X(activities.location::geometry) as lng,
      ST_Y(activities.location::geometry) as lat,
      ST_Distance(
        activities.location::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      ) as distance
    FROM activities
    WHERE ${sql.join(baseConditions, sql` AND `)}
    ORDER BY distance ASC
    LIMIT ${limit}
  `);

  logger.debug('Location-only search results', { count: results.length });

  // 将距离转换为 0-1 分数（距离越近分数越高）
  // 使用 radiusInKm * 1000 作为最大距离
  const maxDistance = radiusInKm * 1000;

  return results.map(r => ({
    activity: mapRowToActivity(r),
    score: Math.max(0, 1 - (r.distance / maxDistance)),
    distance: r.distance,
  }));
}

/**
 * 将数据库行映射为 Activity 类型
 */
function mapRowToActivity(row: any): Activity {
  return {
    id: row.id,
    creatorId: row.creator_id,
    title: row.title,
    description: row.description,
    location: typeof row.lng === 'number' && typeof row.lat === 'number'
      ? { x: row.lng, y: row.lat }
      : row.location,
    locationName: row.location_name,
    address: row.address,
    locationHint: row.location_hint,
    startAt: row.start_at,
    type: row.type,
    maxParticipants: row.max_participants,
    currentParticipants: row.current_participants,
    status: row.status,
    theme: row.theme ?? 'auto',
    themeConfig: row.theme_config ?? null,
    embedding: row.embedding,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============ 推荐理由生成 ============

/**
 * 生成推荐理由（v4.6 增强：模板化）
 * 
 * 使用包含距离、时间、类型匹配等具体信息的模板，
 * 替代之前仅基于 score 阈值的笼统文案。
 */
export async function generateMatchReason(
  _query: string,
  activity: Activity,
  score: number,
  distance?: number
): Promise<string> {
  try {
    const parts: string[] = [];

    // 距离信息
    if (distance != null) {
      if (distance < 1000) {
        parts.push(`距你仅 ${Math.round(distance)}m`);
      } else {
        parts.push(`距你 ${(distance / 1000).toFixed(1)}km`);
      }
    }

    // 类型信息
    if (activity.type) {
      parts.push(`${activity.type}类活动`);
    }

    // 时间信息
    if (activity.startAt) {
      const startAt = new Date(activity.startAt);
      const now = new Date();
      const diffHours = (startAt.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (diffHours > 0 && diffHours <= 24) {
        parts.push('即将开始');
      } else if (diffHours > 24 && diffHours <= 72) {
        const days = Math.ceil(diffHours / 24);
        parts.push(`${days}天后开始`);
      }
    }

    // 匹配度信息
    if (score >= 0.8) {
      parts.push('和你的需求高度匹配');
    } else if (score >= 0.6) {
      parts.push('比较符合你的需求');
    }

    // 组装理由
    if (parts.length > 0) {
      return `推荐「${activity.title}」：${parts.join('，')}`;
    }

    return `推荐「${activity.title}」`;
  } catch (error) {
    logger.warn('Failed to generate match reason', { error });
    // 降级到默认理由
    return `推荐「${activity.title}」`;
  }
}

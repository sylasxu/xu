/**
 * RAG Search - 语义检索核心函数 (v4.6 升级)
 * 
 * 纯函数式模块：
 * - indexActivity() - 索引单个活动
 * - indexActivities() - 批量索引
 * - deleteIndex() - 删除索引
 * - search() - 混合检索 (Hard Filter + Vector Rank + Rerank + MaxSim)
 * - generateMatchReason() - 推荐理由生成
 * 
 * v4.5: 支持 MaxSim 个性化推荐
 * v4.6: 新增 qwen3-rerank 重排序步骤
 */

import { db, eq, sql, isNotNull } from '@juchang/db';
import { activities } from '@juchang/db';
import type { Activity } from '@juchang/db';
import type {
  HybridSearchParams,
  ScoredActivity,
  BatchIndexResult,
} from './types';
import { DEFAULT_RAG_CONFIG } from './types';
import {
  generateEmbeddingWithRetry,
  generateActivityEmbedding,
} from './utils';
import { createLogger } from '../observability/logger';
import { getInterestVectors, calculateMaxSim } from '../memory';
import { rerank } from '../models/router';

const logger = createLogger('rag');

/**
 * MaxSim 个性化提升比例
 */
const MAXSIM_BOOST_RATIO = 0.2;

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
 * 批量索引活动
 * 用于数据回填
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

// ============ 检索操作 ============

/**
 * 混合检索
 * 核心搜索方法：Hard Filter (SQL) → Soft Rank (Vector) → MaxSim Boost
 * 
 * 降级策略：
 * - 如果向量生成失败，降级到 location-only 搜索
 * - 如果用户无兴趣向量，跳过 MaxSim boost
 */
export async function search(params: HybridSearchParams): Promise<ScoredActivity[]> {
  const {
    semanticQuery,
    filters,
    limit = DEFAULT_RAG_CONFIG.defaultLimit,
    threshold = DEFAULT_RAG_CONFIG.defaultThreshold,
    includeMatchReason = false,
    userId = null,
  } = params;

  logger.debug('Starting hybrid search', {
    query: semanticQuery.slice(0, 50),
    filters,
    limit,
    userId: userId ? 'present' : 'none',
  });

  // 1. 生成查询向量（带重试）
  const queryVector = await generateEmbeddingWithRetry(semanticQuery);

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
    similarity: number;
    distance?: number;
  }>(sql`
    SELECT 
      a.*,
      (1 - (a.embedding <=> ${vectorStr}::vector)) as similarity
      ${filters.location ? sql`, ST_Distance(
        a.location::geography,
        ST_SetSRID(ST_MakePoint(${filters.location.lng}, ${filters.location.lat}), 4326)::geography
      ) as distance` : sql``}
    FROM activities a
    WHERE ${sql.join(baseConditions, sql` AND `)}
    ORDER BY similarity DESC
    LIMIT ${limit * 2}
  `);

  // 6. Rerank 重排序 (v4.6 新增)
  // 使用 qwen3-rerank 对 Vector Rank 结果进行语义重排序
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
        // 提升20% 排名分数
        finalScore = finalScore * (1 + MAXSIM_BOOST_RATIO * maxSim);
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
        const matchReason = await generateMatchReason(semanticQuery, activity, r.finalScore);
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
    distance: number;
  }>(sql`
    SELECT 
      a.*,
      ST_Distance(
        a.location::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      ) as distance
    FROM activities a
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
    location: row.location,
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
 * 生成推荐理由
 * 使用 LLM 解释匹配原因
 */
export async function generateMatchReason(
  query: string,
  activity: Activity,
  score: number
): Promise<string> {
  try {
    // 简化实现：基于相似度和活动信息生成理由
    // 后续可以接入 LLM 生成更自然的理由
    const scorePercent = Math.round(score * 100);

    if (score >= 0.8) {
      return `非常匹配你的需求「${query.slice(0, 20)}」，这个「${activity.title}」活动和你想要的高度吻合`;
    } else if (score >= 0.6) {
      return `推荐这个「${activity.title}」，因为它和你说的「${query.slice(0, 15)}」比较相关`;
    } else {
      return `这个「${activity.title}」可能符合你的需求，匹配度 ${scorePercent}%`;
    }
  } catch (error) {
    logger.warn('Failed to generate match reason', { error });
    // 降级到默认理由
    return `推荐「${activity.title}」`;
  }
}

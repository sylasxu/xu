/**
 * RAG Service - 语义检索运营领域服务
 */

import {
  db,
  activities,
  eq,
  sql,
  isNotNull,
  desc,
} from '@juchang/db';
import { indexActivity, indexActivities, search } from './search';
import { generateEmbedding } from './utils';
import { getInterestVectors, calculateMaxSim } from '../memory/working';
import { createLogger } from '../observability/logger';
import { ACTIVE_MODELS, EMBEDDING_DIMENSIONS } from '../models/types';

const logger = createLogger('ai-rag-service');

export interface RagStats {
  totalActivities: number;
  indexedActivities: number;
  coverageRate: number;
  embeddingModel: string;
  embeddingDimensions: number;
  lastIndexedAt: string | null;
  unindexedActivities: Array<{
    id: string;
    title: string;
    createdAt: string;
  }>;
}

export async function getRagStats(): Promise<RagStats> {
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(activities)
    .where(eq(activities.status, 'active'));

  const [indexedResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(activities)
    .where(sql`${activities.status} = 'active' AND ${activities.embedding} IS NOT NULL`);

  const total = Number(totalResult?.count || 0);
  const indexed = Number(indexedResult?.count || 0);

  const unindexed = await db
    .select({
      id: activities.id,
      title: activities.title,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .where(sql`${activities.status} = 'active' AND ${activities.embedding} IS NULL`)
    .orderBy(desc(activities.createdAt))
    .limit(10);

  const [lastIndexed] = await db
    .select({ updatedAt: activities.updatedAt })
    .from(activities)
    .where(isNotNull(activities.embedding))
    .orderBy(desc(activities.updatedAt))
    .limit(1);

  return {
    totalActivities: total,
    indexedActivities: indexed,
    coverageRate: total > 0 ? Math.round((indexed / total) * 100) : 0,
    embeddingModel: ACTIVE_MODELS.EMBEDDING_PRIMARY,
    embeddingDimensions: EMBEDDING_DIMENSIONS.QWEN,
    lastIndexedAt: lastIndexed?.updatedAt?.toISOString() || null,
    unindexedActivities: unindexed.map(a => ({
      id: a.id,
      title: a.title,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export interface RagSearchTestParams {
  query: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  userId?: string;
  limit?: number;
}

export interface RagSearchTestResult {
  results: Array<{
    activityId: string;
    title: string;
    type: string;
    locationName: string;
    startAt: string;
    similarity: number;
    distance: number | null;
    finalScore: number;
    maxSimBoost: number;
  }>;
  performance: {
    embeddingTimeMs: number;
    searchTimeMs: number;
    totalTimeMs: number;
  };
  query: string;
  totalResults: number;
}

export async function testRagSearch(params: RagSearchTestParams): Promise<RagSearchTestResult> {
  const startTime = Date.now();
  const { query, lat, lng, radiusKm = 5, userId, limit = 20 } = params;

  const embeddingStart = Date.now();
  const queryVector = await generateEmbedding(query, { textType: 'query' });
  const embeddingTimeMs = Date.now() - embeddingStart;

  const searchStart = Date.now();
  const searchResults = await search({
    semanticQuery: query,
    filters: {
      location: lat && lng ? { lat, lng, radiusInKm: radiusKm } : undefined,
    },
    limit,
    userId: userId || null,
  });
  const searchTimeMs = Date.now() - searchStart;
  const totalTimeMs = Date.now() - startTime;

  let interestVectors: Awaited<ReturnType<typeof getInterestVectors>> = [];
  if (userId) {
    try {
      interestVectors = await getInterestVectors(userId);
    } catch {
      // ignore
    }
  }

  return {
    results: searchResults.map(r => {
      const baseScore = r.score;
      let maxSimBoost = 0;

      if (interestVectors.length > 0 && queryVector) {
        const maxSim = calculateMaxSim(queryVector, interestVectors);
        if (maxSim > 0.5) {
          maxSimBoost = Math.round(maxSim * 20);
        }
      }

      return {
        activityId: r.activity.id,
        title: r.activity.title,
        type: r.activity.type,
        locationName: r.activity.locationName,
        startAt: r.activity.startAt.toISOString(),
        similarity: Math.round(baseScore * 100) / 100,
        distance: r.distance ? Math.round(r.distance) : null,
        finalScore: Math.round(r.score * 100) / 100,
        maxSimBoost,
      };
    }),
    performance: {
      embeddingTimeMs,
      searchTimeMs,
      totalTimeMs,
    },
    query,
    totalResults: searchResults.length,
  };
}

export async function rebuildActivityIndex(activityId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const [activity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!activity) {
      return { success: false, error: '活动不存在' };
    }

    await indexActivity(activity);
    logger.info('Activity index rebuilt', { activityId });
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to rebuild activity index', { activityId, error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

export interface BackfillStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  success: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
  startedAt: string | null;
  completedAt: string | null;
}

let backfillState: BackfillStatus = {
  status: 'idle',
  total: 0,
  processed: 0,
  success: 0,
  failed: 0,
  errors: [],
  startedAt: null,
  completedAt: null,
};

export async function startBackfill(): Promise<{ started: boolean; message: string }> {
  if (backfillState.status === 'running') {
    return { started: false, message: '回填任务正在进行中' };
  }

  const unindexedActivities = await db
    .select()
    .from(activities)
    .where(sql`${activities.status} = 'active' AND ${activities.embedding} IS NULL`);

  if (unindexedActivities.length === 0) {
    return { started: false, message: '没有需要索引的活动' };
  }

  backfillState = {
    status: 'running',
    total: unindexedActivities.length,
    processed: 0,
    success: 0,
    failed: 0,
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  (async () => {
    try {
      const result = await indexActivities(unindexedActivities, {
        batchSize: 10,
        delayMs: 200,
      });

      backfillState.success = result.success;
      backfillState.failed = result.failed;
      backfillState.errors = result.errors;
      backfillState.processed = result.success + result.failed;
      backfillState.status = 'completed';
      backfillState.completedAt = new Date().toISOString();

      logger.info('Backfill completed', { success: result.success, failed: result.failed });
    } catch (error) {
      backfillState.status = 'failed';
      backfillState.completedAt = new Date().toISOString();
      logger.error('Backfill failed', { error });
    }
  })();

  return { started: true, message: `开始回填 ${unindexedActivities.length} 个活动` };
}

export function getBackfillStatus(): BackfillStatus {
  return { ...backfillState };
}

/**
 * Memory Service - 记忆运营领域服务
 */

import { db, users, activities, eq, sql, inArray } from '@juchang/db';
import {
  getEnhancedUserProfileWithVectors,
  getInterestVectors,
  calculateMaxSim,
} from './working';
import { generateEmbedding } from '../rag/utils';

export interface UserMemoryProfile {
  userId: string;
  nickname: string | null;
  preferences: Array<{
    category: string;
    value: string;
    sentiment: 'like' | 'dislike' | 'neutral';
    confidence: number;
  }>;
  frequentLocations: string[];
  interestVectors: Array<{
    activityId: string;
    activityTitle: string;
    participatedAt: string;
    feedback: string | null;
  }>;
  lastUpdated: string | null;
}

export async function getUserMemoryProfile(userId: string): Promise<UserMemoryProfile | null> {
  const [user] = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      workingMemory: users.workingMemory,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return null;
  }

  const profile = await getEnhancedUserProfileWithVectors(userId);
  const interestVectors = profile.interestVectors || [];
  const activityIds = interestVectors.map(v => v.activityId);

  let activityTitles: Map<string, string> = new Map();
  if (activityIds.length > 0) {
    const activityList = await db
      .select({ id: activities.id, title: activities.title })
      .from(activities)
      .where(inArray(activities.id, activityIds));
    activityTitles = new Map(activityList.map(a => [a.id, a.title]));
  }

  return {
    userId: user.id,
    nickname: user.nickname,
    preferences: profile.preferences.map(p => ({
      category: 'activity_type',
      value: p,
      sentiment: 'like' as const,
      confidence: 0.5,
    })),
    frequentLocations: profile.frequentLocations,
    interestVectors: interestVectors.map(v => ({
      activityId: v.activityId,
      activityTitle: activityTitles.get(v.activityId) || '未知活动',
      participatedAt: v.participatedAt.toISOString(),
      feedback: v.feedback || null,
    })),
    lastUpdated: profile.lastUpdated?.toISOString() || null,
  };
}

export async function searchUsers(query: string, limit: number = 10): Promise<Array<{
  id: string;
  nickname: string | null;
  phoneNumber: string | null;
}>> {
  const safeQuery = query.trim();
  return db
    .select({
      id: users.id,
      nickname: users.nickname,
      phoneNumber: users.phoneNumber,
    })
    .from(users)
    .where(sql`${users.nickname} ILIKE ${'%' + safeQuery + '%'} OR ${users.id}::text = ${safeQuery}`)
    .limit(limit);
}

export interface MaxSimTestParams {
  userId: string;
  query: string;
}

export interface MaxSimTestResult {
  query: string;
  maxSimScore: number;
  matchedVector: {
    activityId: string;
    activityTitle: string;
    similarity: number;
  } | null;
  allVectors: Array<{
    activityId: string;
    activityTitle: string;
    similarity: number;
  }>;
}

export async function testMaxSim(params: MaxSimTestParams): Promise<MaxSimTestResult> {
  const { userId, query } = params;

  const queryVector = await generateEmbedding(query);
  const interestVectors = await getInterestVectors(userId);

  if (interestVectors.length === 0 || !queryVector) {
    return {
      query,
      maxSimScore: 0,
      matchedVector: null,
      allVectors: [],
    };
  }

  const activityIds = interestVectors.map(v => v.activityId);
  const activityList = await db
    .select({ id: activities.id, title: activities.title })
    .from(activities)
    .where(inArray(activities.id, activityIds));
  const activityTitles = new Map(activityList.map(a => [a.id, a.title]));

  const similarities = interestVectors.map(v => {
    const sim = calculateMaxSim(queryVector, [v]);
    return {
      activityId: v.activityId,
      activityTitle: activityTitles.get(v.activityId) || '未知活动',
      similarity: Math.round(sim * 100) / 100,
    };
  });

  const maxSim = Math.max(...similarities.map(s => s.similarity));
  const matchedVector = similarities.find(s => s.similarity === maxSim) || null;

  return {
    query,
    maxSimScore: maxSim,
    matchedVector,
    allVectors: similarities.sort((a, b) => b.similarity - a.similarity),
  };
}

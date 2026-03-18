/**
 * Match Service - 匹配逻辑 (v4.0 Smart Broker - 3表精简版)
 *
 * 精准匹配，tag 冲突直接不匹配
 * 偏好优先级原则：当前意向的 tags > 历史偏好
 */

import {
  db,
  partnerIntents,
  intentMatches,
  matchMessages,
  activities,
  participants,
  users,
  eq,
  and,
  not,
  or,
  inArray,
  sql,
  type PartnerIntent,
  type IntentMatch,
} from '@juchang/db';
import {
  recordPartnerTaskMatchCancelled,
  recordPartnerTaskMatchConfirmed,
  recordPartnerTaskMatchReady,
} from '../task-runtime/agent-task.service';

type MatchQueryExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const CONFLICTING_TAGS: [string, string][] = [
  ['NoAlcohol', 'Drinking'],
  ['Quiet', 'Party'],
  ['GirlOnly', 'BoyOnly'],
  ['AA', 'Treat'],
];

function buildPendingIntentCondition(intentIds: string[]) {
  if (intentIds.length === 1) {
    return sql`${intentIds[0]} = ANY(${intentMatches.intentIds})`;
  }

  return or(...intentIds.map(intentId => sql`${intentId} = ANY(${intentMatches.intentIds})`))!;
}

async function getPendingMatchesByIntentIds(
  intentIds: string[],
  executor: MatchQueryExecutor = db
): Promise<IntentMatch[]> {
  if (intentIds.length === 0) {
    return [];
  }

  return executor
    .select()
    .from(intentMatches)
    .where(and(
      eq(intentMatches.outcome, 'pending'),
      buildPendingIntentCondition(intentIds)
    ));
}

async function getPendingMatchForIntent(
  intentId: string,
  executor: MatchQueryExecutor = db
): Promise<IntentMatch | null> {
  const [match] = await executor
    .select()
    .from(intentMatches)
    .where(and(
      eq(intentMatches.outcome, 'pending'),
      sql`${intentId} = ANY(${intentMatches.intentIds})`
    ))
    .limit(1);

  return match || null;
}

/**
 * 检测意向匹配
 */
export async function detectMatchesForIntent(intentId: string): Promise<IntentMatch | null> {
  const [intent] = await db
    .select()
    .from(partnerIntents)
    .where(eq(partnerIntents.id, intentId))
    .limit(1);

  if (!intent || intent.status !== 'active') return null;

  const existingPending = await getPendingMatchForIntent(intentId);
  if (existingPending) {
    return existingPending;
  }

  const candidates = await db
    .select()
    .from(partnerIntents)
    .where(and(
      eq(partnerIntents.activityType, intent.activityType),
      eq(partnerIntents.status, 'active'),
      not(eq(partnerIntents.id, intentId)),
      not(eq(partnerIntents.userId, intent.userId)),
      not(sql`EXISTS (
        SELECT 1
        FROM intent_matches pending_match
        WHERE pending_match.outcome = 'pending'
          AND ${partnerIntents.id} = ANY(pending_match.intent_ids)
      )`),
      sql`ST_DWithin(
        ${partnerIntents.location}::geography,
        (SELECT location::geography FROM partner_intents WHERE id = ${intentId}),
        3000
      )`
    ));

  if (candidates.length === 0) return null;

  const intentTags = intent.metaData?.tags || [];
  const compatibleCandidates = candidates.filter(candidate => {
    const candidateTags = candidate.metaData?.tags || [];
    return !hasTagConflict(intentTags, candidateTags);
  });

  if (compatibleCandidates.length === 0) return null;

  const quickScore = calculateMatchScore([intent, ...compatibleCandidates]);
  if (quickScore < 80) return null;

  return createMatch([intent, ...compatibleCandidates], intent.id);
}

function hasTagConflict(tagsA: string[], tagsB: string[]): boolean {
  for (const [tag1, tag2] of CONFLICTING_TAGS) {
    if (
      (tagsA.includes(tag1) && tagsB.includes(tag2)) ||
      (tagsA.includes(tag2) && tagsB.includes(tag1))
    ) {
      return true;
    }
  }
  return false;
}

function calculateMatchScore(intents: PartnerIntent[]): number {
  const allTags = intents.flatMap(intent => intent.metaData?.tags || []);

  if (allTags.length === 0) {
    return 100;
  }

  const tagCounts = allTags.reduce((acc, tag) => {
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const commonTags = Object.entries(tagCounts)
    .filter(([_, count]) => count >= 2)
    .map(([tag]) => tag);

  const avgTagCount = allTags.length / intents.length;
  return Math.round((commonTags.length / Math.max(avgTagCount, 1)) * 100);
}

function getCommonTags(intents: PartnerIntent[]): string[] {
  const allTags = intents.flatMap(intent => intent.metaData?.tags || []);
  const tagCounts = allTags.reduce((acc, tag) => {
    acc[tag] = (acc[tag] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return Object.entries(tagCounts)
    .filter(([_, count]) => count >= 2)
    .map(([tag]) => tag);
}

function calculateConfirmDeadline(): Date {
  const now = new Date();
  const sixHoursLater = new Date(now.getTime() + 6 * 60 * 60 * 1000);

  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  return sixHoursLater < endOfDay ? sixHoursLater : endOfDay;
}

/**
 * 创建匹配记录 (3表精简版)
 *
 * 这里会锁住候选 intent 行，并在事务内再次检查 pending 占用，
 * 避免同一条 intent 同时挂在多个 pending match 里。
 */
async function createMatch(
  intents: PartnerIntent[],
  sourceIntentId: string
): Promise<IntentMatch | null> {
  const intentIds = Array.from(new Set(intents.map(intent => intent.id))).sort();

  const transactionResult = await db.transaction(async (tx) => {
    await tx
      .select({ id: partnerIntents.id })
      .from(partnerIntents)
      .where(inArray(partnerIntents.id, intentIds))
      .orderBy(partnerIntents.id)
      .for('update');

    const sourcePendingMatch = await getPendingMatchForIntent(sourceIntentId, tx);
    if (sourcePendingMatch) {
      return { match: sourcePendingMatch, created: false, intents: null as PartnerIntent[] | null };
    }

    const overlappingPendingMatches = await getPendingMatchesByIntentIds(intentIds, tx);
    const occupiedIntentIds = new Set(overlappingPendingMatches.flatMap(match => match.intentIds));

    const lockedIntents = await tx
      .select()
      .from(partnerIntents)
      .where(and(
        inArray(partnerIntents.id, intentIds),
        eq(partnerIntents.status, 'active')
      ));

    const lockedIntentMap = new Map(lockedIntents.map(intent => [intent.id, intent]));
    const availableIntents = intentIds
      .map(intentId => lockedIntentMap.get(intentId))
      .filter((intent): intent is PartnerIntent => intent !== undefined)
      .filter(intent => !occupiedIntentIds.has(intent.id));

    if (!availableIntents.some(intent => intent.id === sourceIntentId)) {
      return { match: null, created: false, intents: null as PartnerIntent[] | null };
    }

    if (availableIntents.length < 2) {
      return { match: null, created: false, intents: null as PartnerIntent[] | null };
    }

    const matchScore = calculateMatchScore(availableIntents);
    if (matchScore < 80) {
      return { match: null, created: false, intents: null as PartnerIntent[] | null };
    }

    const tempOrganizer = availableIntents.reduce((current, next) =>
      new Date(current.createdAt) < new Date(next.createdAt) ? current : next
    );

    const firstIntent = availableIntents[0];
    const confirmDeadline = calculateConfirmDeadline();
    const commonTags = getCommonTags(availableIntents);
    const userIds = availableIntents.map(intent => intent.userId);

    const [match] = await tx.insert(intentMatches).values({
      activityType: firstIntent.activityType,
      matchScore,
      commonTags,
      centerLocation: firstIntent.location,
      centerLocationHint: firstIntent.locationHint,
      tempOrganizerId: tempOrganizer.userId,
      intentIds: availableIntents.map(intent => intent.id),
      userIds,
      confirmDeadline,
      outcome: 'pending',
    }).returning();

    return { match, created: true, intents: availableIntents };
  });

  if (!transactionResult.match) {
    return null;
  }

  if (transactionResult.created && transactionResult.intents) {
    await sendIcebreaker(transactionResult.match, transactionResult.intents);
  }

  await recordPartnerTaskMatchReady({
    matchId: transactionResult.match.id,
    activityType: transactionResult.match.activityType,
    locationHint: transactionResult.match.centerLocationHint,
  });

  return transactionResult.match;
}

async function sendIcebreaker(
  match: IntentMatch,
  intents: PartnerIntent[]
): Promise<void> {
  const userIds = intents.map(intent => intent.userId);
  const userList = await db
    .select({ id: users.id, nickname: users.nickname })
    .from(users)
    .where(inArray(users.id, userIds));

  const userMap = new Map(userList.map(user => [user.id, user.nickname || '匿名用户']));
  const organizerNickname = userMap.get(match.tempOrganizerId) || '匿名用户';

  const typeNames: Record<string, string> = {
    food: '吃饭',
    entertainment: '娱乐',
    sports: '运动',
    boardgame: '桌游',
    other: '活动',
  };

  const activityTypeName = typeNames[match.activityType] || '活动';
  const commonTagsStr = match.commonTags.length > 0
    ? `都${match.commonTags.join('、')}`
    : '需求很一致';

  const icebreakerContent = `🎉 终于匹配上了！
大家都想${activityTypeName}，而且${commonTagsStr}。
既然需求这么一致，我帮你们把方案拟好了。
@${organizerNickname} 要不你点个头，我们这局就成了？`;

  await db.insert(matchMessages).values({
    matchId: match.id,
    senderId: null,
    messageType: 'icebreaker',
    content: icebreakerContent,
  });
}

/**
 * 确认匹配 → 转为活动 (3表精简版)
 */
export async function confirmMatch(matchId: string, userId: string): Promise<{
  success: boolean;
  activityId?: string;
  error?: string;
}> {
  const [match] = await db
    .select()
    .from(intentMatches)
    .where(eq(intentMatches.id, matchId))
    .limit(1);

  if (!match) {
    return { success: false, error: '找不到这个匹配' };
  }

  if (match.tempOrganizerId !== userId) {
    return { success: false, error: '只有临时召集人才能确认发布' };
  }

  if (match.outcome !== 'pending') {
    return { success: false, error: '这个匹配已经处理过了' };
  }

  if (new Date() > match.confirmDeadline) {
    return { success: false, error: '匹配已过期，请重新发布意向' };
  }

  const intentIds = match.intentIds;
  const userIds = match.userIds;

  const intentList = await db
    .select()
    .from(partnerIntents)
    .where(inArray(partnerIntents.id, intentIds));

  if (intentList.length === 0) {
    return { success: false, error: '找不到相关意向' };
  }

  const firstIntent = intentList[0];

  const typeNames: Record<string, string> = {
    food: '美食',
    entertainment: '娱乐',
    sports: '运动',
    boardgame: '桌游',
    other: '其他',
  };

  const [activity] = await db.insert(activities).values({
    creatorId: userId,
    title: `🤝 ${typeNames[firstIntent.activityType]}搭子局`,
    description: `由搭子匹配自动创建。共同偏好：${match.commonTags.join('、') || '无'}`,
    location: match.centerLocation,
    locationName: match.centerLocationHint,
    locationHint: match.centerLocationHint,
    startAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    type: firstIntent.activityType,
    maxParticipants: userIds.length + 2,
    currentParticipants: userIds.length,
    status: 'active',
  }).returning();

  await db.insert(participants).values(
    userIds.map(uid => ({
      activityId: activity.id,
      userId: uid,
      status: 'joined' as const,
    }))
  );

  await db.update(intentMatches)
    .set({
      outcome: 'confirmed',
      activityId: activity.id,
      confirmedAt: new Date(),
    })
    .where(eq(intentMatches.id, matchId));

  await db.update(partnerIntents)
    .set({ status: 'matched', updatedAt: new Date() })
    .where(inArray(partnerIntents.id, intentIds));

  await recordPartnerTaskMatchConfirmed({
    matchId,
    activityId: activity.id,
  });

  return { success: true, activityId: activity.id };
}

/**
 * 取消待确认匹配（保留意向为 active，允许后续继续匹配）
 */
export async function cancelMatch(matchId: string, userId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const [match] = await db
    .select()
    .from(intentMatches)
    .where(eq(intentMatches.id, matchId))
    .limit(1);

  if (!match) {
    return { success: false, error: '找不到这个匹配' };
  }

  if (!match.userIds.includes(userId)) {
    return { success: false, error: '你不在这个匹配中' };
  }

  if (match.tempOrganizerId !== userId) {
    return { success: false, error: '只有临时召集人才能取消匹配' };
  }

  if (match.outcome !== 'pending') {
    return { success: false, error: '这个匹配已经处理过了' };
  }

  await db.update(intentMatches)
    .set({ outcome: 'cancelled' })
    .where(eq(intentMatches.id, matchId));

  await recordPartnerTaskMatchCancelled({
    matchId,
  });

  return { success: true };
}

/**
 * 获取用户待确认的匹配 (3表精简版 - 直接查数组)
 */
export async function getPendingMatchesForUser(userId: string) {
  const matches = await db
    .select()
    .from(intentMatches)
    .where(and(
      sql`${userId} = ANY(${intentMatches.userIds})`,
      eq(intentMatches.outcome, 'pending')
    ));

  return matches;
}

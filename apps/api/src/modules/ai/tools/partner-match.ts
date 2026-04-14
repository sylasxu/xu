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
} from '@xu/db';
import {
  recordPartnerTaskMatchCancelled,
  recordPartnerTaskMatchConfirmed,
  recordPartnerTaskMatchReady,
} from '../task-runtime/agent-task.service';
import { sendServiceNotificationByUserId } from '../../wechat';

type MatchQueryExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const CONFLICTING_TAGS: [string, string][] = [
  ['NoAlcohol', 'Drinking'],
  ['Quiet', 'Party'],
  ['GirlOnly', 'BoyOnly'],
  ['AA', 'Treat'],
];

const SPORT_TYPE_NAMES: Record<string, string> = {
  badminton: '羽毛球',
  basketball: '篮球',
  running: '跑步',
  tennis: '网球',
  swimming: '游泳',
  cycling: '骑行',
};

function toTemplateValue(value: string, maxLength = 20): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '待补充';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 1, 1))}…`;
}

function readPartnerSportType(intent: PartnerIntent): string | null {
  return typeof intent.metaData?.sportType === 'string' && intent.metaData.sportType.trim()
    ? intent.metaData.sportType.trim()
    : null;
}

function getPartnerDisplayType(activityType: string, sportType?: string | null): string {
  if (activityType === 'sports' && sportType && SPORT_TYPE_NAMES[sportType]) {
    return SPORT_TYPE_NAMES[sportType];
  }

  const typeNames: Record<string, string> = {
    food: '吃饭',
    entertainment: '娱乐',
    sports: '运动',
    boardgame: '桌游',
    other: '活动',
  };

  return typeNames[activityType] || '活动';
}

function getPartnerIntentDisplayType(intent: PartnerIntent): string {
  return getPartnerDisplayType(intent.activityType, readPartnerSportType(intent));
}

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
      eq(partnerIntents.scenarioType, intent.scenarioType),
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
    if (hasTagConflict(intentTags, candidateTags)) {
      return false;
    }

    if (intent.activityType === 'sports') {
      const sourceSportType = readPartnerSportType(intent);
      const candidateSportType = readPartnerSportType(candidate);
      if (!sourceSportType || !candidateSportType) {
        return false;
      }

      return sourceSportType === candidateSportType;
    }

    return true;
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

function pickSharedPartnerScenario(intents: PartnerIntent[]) {
  return intents[0]?.scenarioType ?? 'local_partner';
}

function pickSharedPartnerDestination(intents: PartnerIntent[]): string | null {
  const destination = intents
    .map((intent) => intent.destinationText?.trim())
    .find((value): value is string => Boolean(value));

  return destination || null;
}

function pickSharedPartnerTimeText(intents: PartnerIntent[]): string | null {
  const exactTime = intents
    .map((intent) => intent.timeText?.trim())
    .find((value): value is string => Boolean(value));

  if (exactTime) {
    return exactTime;
  }

  const fallback = intents
    .map((intent) => intent.timePreference?.trim())
    .find((value): value is string => Boolean(value));

  return fallback || null;
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
    const scenarioType = pickSharedPartnerScenario(availableIntents);
    const destinationText = pickSharedPartnerDestination(availableIntents);
    const timeText = pickSharedPartnerTimeText(availableIntents);

    const [match] = await tx.insert(intentMatches).values({
      activityType: firstIntent.activityType,
      scenarioType,
      matchScore,
      commonTags,
      centerLocation: firstIntent.location,
      centerLocationHint: firstIntent.locationHint,
      destinationText,
      timeText,
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

  const firstSportType = intents
    .map((intent) => readPartnerSportType(intent))
    .find((value): value is string => Boolean(value));
  const activityTypeName = getPartnerDisplayType(match.activityType, firstSportType);
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

async function sendManualConnectIcebreaker(params: {
  match: IntentMatch;
  sourceIntent: PartnerIntent;
  targetIntent: PartnerIntent;
  initiatedByUserId: string;
  mode: 'connect' | 'group_up';
}): Promise<void> {
  const userIds = Array.from(new Set([params.sourceIntent.userId, params.targetIntent.userId]));
  const userRows = await db
    .select({
      id: users.id,
      nickname: users.nickname,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  const nicknameMap = new Map(userRows.map((row) => [row.id, row.nickname?.trim() || '搭子']));
  const initiatorNickname = nicknameMap.get(params.initiatedByUserId) || '有人';
  const organizerNickname = nicknameMap.get(params.match.tempOrganizerId) || '对方';
  const actionText = params.mode === 'group_up'
    ? '想问问能不能一起组个局'
    : '想先和你搭一下';
  const firstSportType = [params.sourceIntent, params.targetIntent]
    .map((intent) => readPartnerSportType(intent))
    .find((value): value is string => Boolean(value));
  const typeName = getPartnerDisplayType(params.match.activityType, firstSportType);
  const locationHint = params.match.centerLocationHint || params.targetIntent.locationHint || params.sourceIntent.locationHint;
  const timeHint = params.sourceIntent.timePreference || params.targetIntent.timePreference || '时间再商量';
  const content = `有人来敲门啦！
@${organizerNickname}，${initiatorNickname}${actionText}。
你们看的都是${typeName}方向，${locationHint}这片也都方便，时间先按「${timeHint}」来聊最合适。
如果你觉得可以，点确认我们就继续往成局推进。`;

  await db.insert(matchMessages).values({
    matchId: params.match.id,
    senderId: null,
    messageType: params.mode === 'group_up' ? 'group_up_request' : 'connect_request',
    content,
  });
}

async function notifyManualPartnerMatchCreated(params: {
  matchId: string;
  targetUserId: string;
  initiatedByUserId: string;
  activityType: string;
  locationHint: string;
  mode: 'connect' | 'group_up';
}): Promise<void> {
  const [initiator] = await db
    .select({
      nickname: users.nickname,
    })
    .from(users)
    .where(eq(users.id, params.initiatedByUserId))
    .limit(1);

  const typeName = getPartnerDisplayType(params.activityType);
  const initiatorName = initiator?.nickname?.trim() || '有人';

  const result = await sendServiceNotificationByUserId({
    userId: params.targetUserId,
    scene: params.mode === 'group_up' ? 'partner_group_up_request' : 'partner_connect_request',
    pagePath: `pages/message/index?matchId=${params.matchId}`,
    data: {
      thing1: toTemplateValue(
        params.mode === 'group_up'
          ? `${initiatorName}想问你能不能一起组局`
          : `${initiatorName}想和你搭一下`,
        20,
      ),
      thing2: toTemplateValue(`${typeName} · ${params.locationHint}`, 20),
    },
  });

  if (!result.success && result.skipped !== true) {
    console.warn('[notifyManualPartnerMatchCreated] service notification failed', {
      matchId: params.matchId,
      targetUserId: params.targetUserId,
      error: result.error,
    });
  }
}

/**
 * 确认匹配 → 转为活动 (简化版)
 * 
 * 直接使用匹配时的信息创建活动，无需Temp Organizer再次填写
 */
export async function confirmMatch(matchId: string, userId: string): Promise<{
  success: boolean;
  activityId?: string;
  discussionEntry?: {
    activityId: string;
    title: string;
    entry: string;
  };
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

  // 提取双方的时间偏好，智能设置活动时间
  const startAt = resolveActivityStartTime(intentList);
  
  // 生成更自然的活动标题
  const title = generatePartnerActivityTitle(match, intentList);
  
  // 生成简洁的活动描述
  const description = generatePartnerActivityDescription(match, intentList);

  const [activity] = await db.insert(activities).values({
    creatorId: userId,
    title,
    description,
    location: match.centerLocation,
    locationName: match.centerLocationHint,
    locationHint: match.centerLocationHint,
    startAt,
    type: intentList[0].activityType,
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

  return { 
    success: true, 
    activityId: activity.id,
    discussionEntry: {
      activityId: activity.id,
      title: activity.title,
      entry: 'match_confirmed',
    },
  };
}

/**
 * 根据意向列表解析活动时间
 * 优先使用共同的时间偏好，如果没有则默认2小时后
 */
function resolveActivityStartTime(intents: PartnerIntent[]): Date {
  const now = new Date();
  
  // 收集所有时间偏好
  const timePreferences = intents
    .map(i => i.timePreference)
    .filter((t): t is string => Boolean(t));
  
  // 如果有共同的时间偏好，尝试解析
  if (timePreferences.length > 0) {
    const commonTime = findCommonTimePreference(timePreferences);
    if (commonTime) {
      const parsed = parseTimePreference(commonTime);
      if (parsed && parsed > now) {
        return parsed;
      }
    }
  }
  
  // 默认2小时后
  return new Date(now.getTime() + 2 * 60 * 60 * 1000);
}

/**
 * 查找共同的时间偏好
 */
function findCommonTimePreference(preferences: string[]): string | null {
  const counts = preferences.reduce((acc, p) => {
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // 返回出现次数最多的
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}

/**
 * 解析时间偏好为具体日期
 * 支持：今晚、明天、周末、明天下午等
 */
function parseTimePreference(pref: string): Date | null {
  const now = new Date();
  const hour = now.getHours();
  
  const normalized = pref.toLowerCase().trim();
  
  if (normalized.includes('今晚')) {
    // 今晚 = 今天19:00，如果已经过了则明天19:00
    const target = new Date(now);
    target.setHours(19, 0, 0, 0);
    if (hour >= 19) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }
  
  if (normalized.includes('明天')) {
    const target = new Date(now);
    target.setDate(target.getDate() + 1);
    
    if (normalized.includes('下午')) {
      target.setHours(14, 0, 0, 0);
    } else if (normalized.includes('晚上')) {
      target.setHours(19, 0, 0, 0);
    } else {
      target.setHours(12, 0, 0, 0);
    }
    return target;
  }
  
  if (normalized.includes('周末')) {
    const target = new Date(now);
    const day = target.getDay();
    // 调整到周六
    const daysUntilSaturday = day === 0 ? 6 : 6 - day;
    target.setDate(target.getDate() + daysUntilSaturday);
    target.setHours(14, 0, 0, 0);
    return target;
  }
  
  return null;
}

/**
 * 生成搭子活动标题
 */
function generatePartnerActivityTitle(match: IntentMatch, intents: PartnerIntent[]): string {
  const firstIntent = intents[0];
  const sportType = readPartnerSportType(firstIntent);
  const typeName = getPartnerIntentDisplayType(firstIntent);
  const location = match.centerLocationHint || '附近';
  
  // 简洁自然的标题
  return `${location}${typeName}局`;
}

/**
 * 生成搭子活动描述
 */
function generatePartnerActivityDescription(match: IntentMatch, intents: PartnerIntent[]): string {
  const parts: string[] = ['由搭子匹配创建'];
  
  if (match.commonTags.length > 0) {
    parts.push(`共同偏好：${match.commonTags.join('、')}`);
  }
  
  // 添加双方的时间偏好
  const timePrefs = intents
    .map(i => i.timePreference)
    .filter(Boolean)
    .join('、');
  if (timePrefs) {
    parts.push(`时间意向：${timePrefs}`);
  }
  
  return parts.join(' · ');
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

export async function createManualPartnerMatch(params: {
  sourceIntentId: string;
  targetIntentId: string;
  initiatedByUserId: string;
  mode: 'connect' | 'group_up';
}): Promise<{
  success: boolean;
  matchId?: string;
  existing?: boolean;
  tempOrganizerId?: string;
  error?: string;
}> {
  if (params.sourceIntentId === params.targetIntentId) {
    return { success: false, error: '不能和自己的同一条搭子意向建立匹配' };
  }

  const transactionResult = await db.transaction(async (tx) => {
    const intentIds = [params.sourceIntentId, params.targetIntentId].sort();

    await tx
      .select({ id: partnerIntents.id })
      .from(partnerIntents)
      .where(inArray(partnerIntents.id, intentIds))
      .orderBy(partnerIntents.id)
      .for('update');

    const intents = await tx
      .select()
      .from(partnerIntents)
      .where(inArray(partnerIntents.id, intentIds));

    const sourceIntent = intents.find((intent) => intent.id === params.sourceIntentId) || null;
    const targetIntent = intents.find((intent) => intent.id === params.targetIntentId) || null;
    if (!sourceIntent || !targetIntent) {
      return { success: false as const, error: '有一方的搭子意向已经不存在了' };
    }

    if (sourceIntent.status !== 'active' || targetIntent.status !== 'active') {
      return { success: false as const, error: '这条搭子意向已经不在可连接状态了' };
    }

    if (sourceIntent.userId === targetIntent.userId) {
      return { success: false as const, error: '不能和自己建立搭子匹配' };
    }

    if (sourceIntent.activityType !== targetIntent.activityType) {
      return { success: false as const, error: '这位搭子的意向类型已经变了，请重新搜索一下' };
    }

    if (sourceIntent.scenarioType !== targetIntent.scenarioType) {
      return { success: false as const, error: '你们当前看的不是同一类搭子场景，换一个更合适的人选吧' };
    }

    if (sourceIntent.activityType === 'sports') {
      const sourceSportType = readPartnerSportType(sourceIntent);
      const targetSportType = readPartnerSportType(targetIntent);
      if (!sourceSportType || !targetSportType || sourceSportType !== targetSportType) {
        return { success: false as const, error: '你们现在看的不是同一个运动方向，换一个更合适的搭子吧' };
      }
    }

    const overlappingPendingMatches = await getPendingMatchesByIntentIds(intentIds, tx);
    const exactPendingMatch = overlappingPendingMatches.find((match) => {
      const ids = Array.isArray(match.intentIds) ? [...match.intentIds].sort() : [];
      return ids.length === intentIds.length && ids.every((id, index) => id === intentIds[index]);
    });

    if (exactPendingMatch) {
      return {
        success: true as const,
        match: exactPendingMatch,
        sourceIntent,
        targetIntent,
        created: false,
      };
    }

    const occupiedByOtherMatch = overlappingPendingMatches.find((match) => {
      const ids = Array.isArray(match.intentIds) ? match.intentIds : [];
      return ids.includes(params.sourceIntentId) || ids.includes(params.targetIntentId);
    });
    if (occupiedByOtherMatch) {
      return { success: false as const, error: '这位搭子正在处理另一条匹配，稍后再试试吧' };
    }

    const commonTags = getCommonTags([sourceIntent, targetIntent]);
    const rawScore = calculateMatchScore([sourceIntent, targetIntent]);
    const matchScore = Math.max(rawScore, 88);
    const targetLocationHint = targetIntent.locationHint.trim();
    const sourceLocationHint = sourceIntent.locationHint.trim();
    const scenarioType = pickSharedPartnerScenario([sourceIntent, targetIntent]);
    const destinationText = pickSharedPartnerDestination([sourceIntent, targetIntent]);
    const timeText = pickSharedPartnerTimeText([sourceIntent, targetIntent]);

    const [match] = await tx.insert(intentMatches).values({
      activityType: sourceIntent.activityType,
      scenarioType,
      matchScore,
      commonTags,
      centerLocation: targetIntent.location,
      centerLocationHint: targetLocationHint || sourceLocationHint || '待沟通',
      destinationText,
      timeText,
      tempOrganizerId: targetIntent.userId,
      intentIds,
      userIds: [sourceIntent.userId, targetIntent.userId],
      confirmDeadline: calculateConfirmDeadline(),
      outcome: 'pending',
    }).returning();

    return {
      success: true as const,
      match,
      sourceIntent,
      targetIntent,
      created: true,
    };
  });

  if (!transactionResult.success) {
    return { success: false, error: transactionResult.error };
  }

  if (transactionResult.created) {
    await sendManualConnectIcebreaker({
      match: transactionResult.match,
      sourceIntent: transactionResult.sourceIntent,
      targetIntent: transactionResult.targetIntent,
      initiatedByUserId: params.initiatedByUserId,
      mode: params.mode,
    });
  }

  await recordPartnerTaskMatchReady({
    matchId: transactionResult.match.id,
    activityType: transactionResult.match.activityType,
    locationHint: transactionResult.match.centerLocationHint,
  });

  if (transactionResult.created) {
    await notifyManualPartnerMatchCreated({
      matchId: transactionResult.match.id,
      targetUserId: transactionResult.match.tempOrganizerId,
      initiatedByUserId: params.initiatedByUserId,
      activityType: transactionResult.match.activityType,
      locationHint: transactionResult.match.centerLocationHint,
      mode: params.mode,
    });
  }

  return {
    success: true,
    matchId: transactionResult.match.id,
    existing: transactionResult.created === false,
    tempOrganizerId: transactionResult.match.tempOrganizerId,
  };
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

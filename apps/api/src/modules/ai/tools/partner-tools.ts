/**
 * Partner Tools - 找搭子相关 Tool 集合
 *
 * 整合搭子意向创建、查询、取消、匹配确认等功能
 *
 * v4.5: 从多个文件整合为单一模块
 */

import { t } from 'elysia';
import { tool, jsonSchema } from 'ai';
import { toJsonSchema } from '@xu/utils';
import { db, users, partnerIntents, eq, and, desc, not, sql, type PartnerIntent } from '@xu/db';
import { detectMatchesForIntent, getPendingMatchesForUser, confirmMatch as confirmMatchService } from './partner-match';
import { recordPartnerTaskIntentPosted } from '../task-runtime/agent-task.service';
import { understandPartnerRequest, type PartnerScenarioType } from '../workflow/partner-understanding';

// ============ Schema 定义 ============

/** 活动类型枚举 */
const activityTypeSchema = t.Union([
  t.Literal('food'),
  t.Literal('entertainment'),
  t.Literal('sports'),
  t.Literal('boardgame'),
  t.Literal('other'),
], { description: '活动类型' });

const sportTypeSchema = t.Union([
  t.Literal('badminton'),
  t.Literal('basketball'),
  t.Literal('running'),
  t.Literal('tennis'),
  t.Literal('swimming'),
  t.Literal('cycling'),
], { description: '运动细分类型' });

/** 创建搭子意向参数 */
const createPartnerIntentSchema = t.Object({
  rawInput: t.String({ description: '用户原始输入' }),
  activityType: activityTypeSchema,
  sportType: t.Optional(sportTypeSchema),
  locationHint: t.String({ description: '地点提示: 观音桥/解放碑' }),
  timePreference: t.Optional(t.String({ description: '时间偏好: 今晚/周末/明天下午' })),
  tags: t.Array(t.String(), { description: '偏好标签: ["AA", "NoAlcohol", "Quiet"]' }),
  budgetType: t.Optional(t.Union([
    t.Literal('AA'),
    t.Literal('Treat'),
    t.Literal('Free'),
  ], { description: '预算类型' })),
  poiPreference: t.Optional(t.String({ description: '具体店铺偏好: 朱光玉' })),
});

/** 取消意向参数 */
const cancelIntentSchema = t.Object({
  intentId: t.String({ description: '要取消的意向 ID' }),
});

/** 确认匹配参数 */
const confirmMatchSchema = t.Object({
  matchId: t.String({ description: '要确认的匹配 ID' }),
});

// ============ 类型导出 ============

export type CreatePartnerIntentParams = typeof createPartnerIntentSchema.static;
export type CancelIntentParams = typeof cancelIntentSchema.static;
export type ConfirmMatchParams = typeof confirmMatchSchema.static;

export interface SearchPartnerCandidatesParams {
  rawInput: string;
  activityType: CreatePartnerIntentParams['activityType'];
  sportType?: CreatePartnerIntentParams['sportType'];
  locationHint: string;
  scenarioType?: PartnerScenarioType;
  destinationText?: string;
  timeText?: string;
  timePreference?: string;
  description: string;
  preferredGender?: string;
  preferredAgeRange?: string;
  limit?: number;
}

export interface SearchPartnerCandidate {
  intentId: string;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  typeName: string;
  scenarioType: PartnerScenarioType;
  scenarioLabel: string;
  locationHint: string;
  destinationText?: string | null;
  timePreference: string | null;
  timeText?: string | null;
  summary: string;
  matchReason: string;
  matchHighlights: string[];
  compatibilitySummary: string;
  privacyHint: string;
  score: number;
  tags: string[];
}

export interface SearchSummary {
  total: number;
  locationHint: string;
  timeHint: string;
  scenarioType?: PartnerScenarioType;
  scenarioLabel: string;
  stageLabel: string;
  privacyHint: string;
}

type PartnerIntentWriteSnapshot = {
  scenarioType: PartnerScenarioType;
  locationHint: string;
  destinationText: string | null;
  timeText: string | null;
  description: string | null;
  rawInput: string;
};

export interface SearchNextAction {
  type: 'opt_in_partner_pool' | 'search_partners';
  label: string;
  description?: string;
}

export type SearchPartnerCandidatesResult =
  | {
      success: true;
      items: SearchPartnerCandidate[];
      total: number;
      // 新增：搜索摘要和下一步动作
      searchSummary: SearchSummary;
      nextAction: SearchNextAction;
      secondaryAction?: SearchNextAction;
    }
  | {
      success: false;
      error: string;
    };

export type EnsureSearchDrivenPartnerIntentResult =
  | {
      success: true;
      intent: PartnerIntent;
      created: boolean;
    }
  | {
      success: false;
      error: string;
      requireAuth?: boolean;
    };

export type CreatePartnerIntentResult =
  | {
      success: true;
      intentId: string;
      matchFound: boolean;
      matchId?: string;
      message: string;
      extractedTags: string[];
      expiresAt?: string;
    }
  | {
      success: false;
      error: string;
      requireAuth?: boolean;
    };

// ============ 常量 ============

const TYPE_NAMES: Record<string, string> = {
  food: '美食',
  entertainment: '娱乐',
  sports: '运动',
  boardgame: '桌游',
  other: '其他',
};

const SPORT_TYPE_NAMES: Record<string, string> = {
  badminton: '羽毛球',
  basketball: '篮球',
  running: '跑步',
  tennis: '网球',
  swimming: '游泳',
  cycling: '骑行',
};

function getPartnerIntentTypeName(activityType: string, sportType?: string): string {
  if (activityType === 'sports' && sportType && SPORT_TYPE_NAMES[sportType]) {
    return SPORT_TYPE_NAMES[sportType];
  }

  return TYPE_NAMES[activityType] || activityType;
}

/**
 * 提取共同地点提示
 */
function extractCommonLocationHint(candidates: SearchPartnerCandidate[], queryLocation: string): string {
  if (candidates.length === 0) return '附近';
  
  // 如果所有候选人都包含查询地点，返回统一描述
  const allMatchLocation = candidates.every(c => 
    c.locationHint.includes(queryLocation) || queryLocation.includes(c.locationHint)
  );
  
  if (allMatchLocation) {
    return `都在${queryLocation}附近`;
  }
  
  // 否则返回第一个候选人的地点
  return `在${candidates[0].locationHint}附近`;
}

function buildSearchLocationSummary(rawInput: string, queryLocation: string, candidates: SearchPartnerCandidate[]): string {
  const understanding = understandPartnerRequest(rawInput);

  if (understanding.scenarioType === 'destination_companion') {
    const destination = understanding.destinationText || queryLocation;
    return destination ? `都在看${destination}这个方向` : '都在看同去同一个地方这件事';
  }

  if (understanding.scenarioType === 'fill_seat') {
    return queryLocation ? `${queryLocation}这边的补位需求` : '这轮补位方向';
  }

  return extractCommonLocationHint(candidates, queryLocation);
}

function buildPartnerCandidateTypeName(params: {
  scenarioType?: string;
  defaultTypeName: string;
}): string {
  if (params.scenarioType === 'destination_companion') {
    return '同去伙伴';
  }

  if (params.scenarioType === 'fill_seat') {
    return `${params.defaultTypeName}补位`;
  }

  return `${params.defaultTypeName}搭子`;
}

function buildPartnerCandidateSummary(params: {
  scenarioType?: string;
  rawInput: string;
  defaultTypeName: string;
  locationHint: string;
  timePreference?: string | null;
  destinationText?: string;
}): string {
  const trimmedRawInput = params.rawInput.trim();
  if (trimmedRawInput) {
    return trimmedRawInput;
  }

  if (params.scenarioType === 'destination_companion') {
    const destination = params.destinationText || params.locationHint;
    const timeLabel = params.timePreference || '时间待确认';
    return destination ? `想找一起去${destination}的人，${timeLabel}` : `想找一起去同一个地方的人，${timeLabel}`;
  }

  if (params.scenarioType === 'fill_seat') {
    const timeLabel = params.timePreference || '时间待确认';
    return `${params.locationHint || '这边'}想找${params.defaultTypeName}补位，${timeLabel}`;
  }

  return `想找${params.defaultTypeName}搭子`;
}

function buildPartnerCandidateReason(params: {
  scenarioType?: string;
  reasons: string[];
}): string {
  if (params.reasons.length > 0) {
    return params.reasons.join(' · ');
  }

  if (params.scenarioType === 'destination_companion') {
    return '你们都在看同去同一个地方这件事';
  }

  if (params.scenarioType === 'fill_seat') {
    return '你们都在找临时补位的人';
  }

  return '你们想找的是同一类搭子';
}

function buildPartnerIntentWriteSnapshot(params: {
  rawInput: string;
  locationHint: string;
  timePreference?: string;
  description?: string;
}): PartnerIntentWriteSnapshot {
  const rawInput = params.rawInput.trim();
  const understanding = understandPartnerRequest([
    rawInput,
    params.description?.trim() || '',
  ].filter(Boolean).join(' '));

  const destinationText = understanding.destinationText?.trim()
    || (understanding.scenarioType === 'destination_companion' ? params.locationHint.trim() : '')
    || null;
  const timeText = understanding.timeText?.trim()
    || params.timePreference?.trim()
    || null;
  const description = params.description?.trim()
    || [
      understanding.destinationText,
      understanding.activityText,
      understanding.timeText,
    ].filter(Boolean).join(' ').trim()
    || null;

  return {
    scenarioType: understanding.scenarioType,
    locationHint: params.locationHint.trim() || '附近',
    destinationText,
    timeText,
    description,
    rawInput,
  };
}

/**
 * 提取共同时间提示
 */
function extractCommonTimeHint(candidates: SearchPartnerCandidate[], queryTime?: string): string {
  if (!queryTime) return '时间灵活';
  
  // 检查是否有候选人时间偏好一致
  const matchingTime = candidates.filter(c => c.timePreference === queryTime);
  
  if (matchingTime.length >= 2) {
    return `${queryTime}有空`;
  }
  
  return '时间待确认';
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、,.!?\-_/\\()[\]{}:：;；'"`~]/g, '');
}

function extractSearchTokens(value: string): string[] {
  const matches = value.match(/[\u4e00-\u9fff]{2,}|[a-zA-Z0-9]+/g) || [];
  return Array.from(new Set(matches.map((item) => item.trim().toLowerCase()).filter(Boolean)));
}

function calculatePartnerSearchScore(params: {
  query: SearchPartnerCandidatesParams;
  candidate: typeof partnerIntents.$inferSelect;
}): { score: number; reasons: string[] } {
  const { query, candidate } = params;
  const queryUnderstanding = understandPartnerRequest(`${query.rawInput} ${query.description}`.trim());
  const candidateRawInput = typeof candidate.metaData?.rawInput === 'string' ? candidate.metaData.rawInput : '';
  const candidateUnderstanding = understandPartnerRequest(
    `${candidateRawInput} ${candidate.locationHint} ${candidate.timePreference || ''}`.trim()
  );
  let score = 35;
  const reasons: string[] = [];
  const candidateTags = Array.isArray(candidate.metaData?.tags) ? candidate.metaData.tags : [];
  const queryDescription = `${query.description} ${query.rawInput}`.trim();
  const queryTokens = extractSearchTokens(queryDescription);
  const candidateTokens = extractSearchTokens(`${candidateRawInput} ${candidate.locationHint} ${candidate.timePreference || ''} ${candidateTags.join(' ')}`);
  const normalizedQueryLocation = normalizeSearchText(query.locationHint);
  const normalizedCandidateLocation = normalizeSearchText(candidate.locationHint);

  if (queryUnderstanding.scenarioType === candidateUnderstanding.scenarioType) {
    score += 12;
    if (queryUnderstanding.scenarioType === 'destination_companion') {
      reasons.push('都是同去同一目的地方向');
    } else if (queryUnderstanding.scenarioType === 'fill_seat') {
      reasons.push('都是临时补位方向');
    }
  }

  if (query.activityType === 'sports' && query.sportType) {
    if (candidate.metaData?.sportType === query.sportType) {
      score += 18;
      reasons.push(`都想找${getPartnerIntentTypeName('sports', query.sportType)}搭子`);
    } else {
      score -= 12;
    }
  }

  if (query.timePreference && candidate.timePreference && query.timePreference === candidate.timePreference) {
    score += 16;
    reasons.push(`时间都偏向${query.timePreference}`);
  }

  if (
    normalizedQueryLocation &&
    normalizedCandidateLocation &&
    (
      normalizedCandidateLocation.includes(normalizedQueryLocation)
      || normalizedQueryLocation.includes(normalizedCandidateLocation)
    )
  ) {
    score += 14;
    reasons.push(`都提到${candidate.locationHint}附近更方便`);
  }

  const queryDestination = normalizeSearchText(queryUnderstanding.destinationText || '');
  const candidateDestination = normalizeSearchText(candidateUnderstanding.destinationText || '');
  if (queryDestination && candidateDestination && queryDestination === candidateDestination) {
    score += 20;
    reasons.push(`都提到去${candidateUnderstanding.destinationText}`);
  }

  if (
    query.timePreference &&
    candidate.timePreference &&
    normalizeSearchText(query.timePreference) === normalizeSearchText(candidate.timePreference)
  ) {
    score += 8;
  }

  const overlapCount = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  if (overlapCount > 0) {
    score += Math.min(18, overlapCount * 5);
    reasons.push('描述里有相近偏好');
  }

  if (candidateTags.length > 0) {
    score += Math.min(10, candidateTags.length * 2);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: reasons.slice(0, 2),
  };
}

function getPartnerScenarioLabel(scenarioType: PartnerScenarioType): string {
  switch (scenarioType) {
    case 'destination_companion':
      return '目的地同行';
    case 'fill_seat':
      return '临时补位';
    case 'local_partner':
    default:
      return '本地搭子';
  }
}

function buildPartnerCompatibilitySummary(params: {
  scenarioType: PartnerScenarioType;
  locationHint: string;
  timePreference: string | null;
  reasons: string[];
}): string {
  const scenarioLabel = getPartnerScenarioLabel(params.scenarioType);
  const locationText = params.locationHint ? `区域在 ${params.locationHint}` : '区域待沟通';
  const timeText = params.timePreference ? `时间偏向 ${params.timePreference}` : '时间可继续沟通';
  const reasonText = params.reasons.length > 0 ? `，${params.reasons.slice(0, 2).join('、')}` : '';
  return `${scenarioLabel} · ${locationText} · ${timeText}${reasonText}`;
}

export async function searchPartnerCandidates(
  userId: string | null,
  params: SearchPartnerCandidatesParams
): Promise<SearchPartnerCandidatesResult> {
  try {
    const queryUnderstanding = understandPartnerRequest(`${params.rawInput} ${params.description}`.trim());
    const rows = await db
      .select({
        intent: partnerIntents,
        nickname: users.nickname,
        avatarUrl: users.avatarUrl,
      })
      .from(partnerIntents)
      .innerJoin(users, eq(partnerIntents.userId, users.id))
      .where(and(
        eq(partnerIntents.status, 'active'),
        eq(partnerIntents.activityType, params.activityType),
        ...(userId ? [not(eq(partnerIntents.userId, userId))] : []),
      ))
      .orderBy(desc(partnerIntents.updatedAt))
      .limit(Math.max(6, Math.min(params.limit ?? 12, 24)));

    const scored = rows
      .filter((row) => {
        if (params.activityType !== 'sports' || !params.sportType) {
          return true;
        }

        return row.intent.metaData?.sportType === params.sportType;
      })
      .map((row) => {
        const { score, reasons } = calculatePartnerSearchScore({
          query: params,
          candidate: row.intent,
        });
        const typeName = getPartnerIntentTypeName(row.intent.activityType, row.intent.metaData?.sportType);
        const candidateRawInput = typeof row.intent.metaData?.rawInput === 'string' ? row.intent.metaData.rawInput : '';
        const candidateUnderstanding = understandPartnerRequest(
          `${candidateRawInput} ${row.intent.locationHint} ${row.intent.timePreference || ''}`.trim()
        );
        const resolvedScenarioType = queryUnderstanding.scenarioType || candidateUnderstanding.scenarioType;
        const summary = buildPartnerCandidateSummary({
          scenarioType: resolvedScenarioType,
          rawInput: candidateRawInput,
          defaultTypeName: typeName,
          locationHint: row.intent.locationHint,
          timePreference: row.intent.timePreference || null,
          destinationText: candidateUnderstanding.destinationText,
        });

        return {
          intentId: row.intent.id,
          userId: row.intent.userId,
          nickname: row.nickname?.trim() || '匿名搭子',
          avatarUrl: row.avatarUrl ?? null,
          typeName: buildPartnerCandidateTypeName({
            scenarioType: resolvedScenarioType,
            defaultTypeName: typeName,
          }),
          scenarioType: resolvedScenarioType,
          scenarioLabel: getPartnerScenarioLabel(resolvedScenarioType),
          locationHint: row.intent.locationHint,
          ...(row.intent.destinationText ? { destinationText: row.intent.destinationText } : {}),
          timePreference: row.intent.timePreference || null,
          ...(row.intent.timeText ? { timeText: row.intent.timeText } : {}),
          summary,
          matchReason: buildPartnerCandidateReason({
            scenarioType: resolvedScenarioType,
            reasons,
          }),
          matchHighlights: reasons.length > 0
            ? reasons
            : [
                `${getPartnerScenarioLabel(resolvedScenarioType)}方向接近`,
                row.intent.timePreference ? `时间偏向${row.intent.timePreference}` : '可以继续沟通时间',
              ],
          compatibilitySummary: buildPartnerCompatibilitySummary({
            scenarioType: resolvedScenarioType,
            locationHint: row.intent.locationHint,
            timePreference: row.intent.timePreference || null,
            reasons,
          }),
          privacyHint: '确认前不会展示联系方式',
          score,
          tags: Array.isArray(row.intent.metaData?.tags) ? row.intent.metaData.tags.slice(0, 3) : [],
        } satisfies SearchPartnerCandidate;
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(params.limit ?? 6, 12)));

    // 构建搜索摘要
    const searchSummary: SearchSummary = {
      total: scored.length,
      locationHint: buildSearchLocationSummary(params.rawInput, params.locationHint, scored),
      timeHint: extractCommonTimeHint(scored, params.timePreference),
      scenarioType: queryUnderstanding.scenarioType,
      scenarioLabel: getPartnerScenarioLabel(queryUnderstanding.scenarioType),
      stageLabel: '先搜一下',
      privacyHint: '候选结果只展示摘要，确认前不暴露联系方式',
    };

    // 主要下一步动作：入池等待
    const nextAction: SearchNextAction = {
      type: 'opt_in_partner_pool',
      label: '继续帮我留意',
      description: '系统会持续为你寻找更合适的搭子，匹配成功后会进消息中心。',
    };

    // 次要动作：刷新搜索
    const secondaryAction: SearchNextAction = {
      type: 'search_partners',
      label: '换一批再看看',
    };

    return {
      success: true,
      items: scored,
      total: scored.length,
      searchSummary,
      nextAction,
      secondaryAction,
    };
  } catch (error) {
    console.error('[searchPartnerCandidates] Error:', error);
    return { success: false, error: '搜索搭子失败，请稍后再试' };
  }
}

// ============ Service 函数 ============

/**
 * 真实创建搭子意向。
 *
 * Tool 和 workflow 统一走这条链路，避免一边问答、一边落库各写各的。
 */
export async function createPartnerIntent(
  userId: string | null,
  userLocation: { lat: number; lng: number } | null,
  params: CreatePartnerIntentParams
): Promise<CreatePartnerIntentResult> {
  if (!userId) {
    return { success: false, error: '需要先登录才能发布搭子意向', requireAuth: true };
  }

  try {
    const [user] = await db
      .select({ phoneNumber: users.phoneNumber })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.phoneNumber) {
      return { success: false, error: '需要先绑定手机号才能发布搭子意向', requireAuth: true };
    }

    if (!userLocation) {
      return { success: false, error: '需要获取你的位置才能匹配附近的搭子' };
    }

    const normalizedLocationHint = params.locationHint.trim() || '附近';
    const normalizedTags = Array.from(new Set(
      params.tags
        .map(tag => tag.trim())
        .filter(Boolean)
    ));
    const normalizedSportType: CreatePartnerIntentParams['sportType'] = params.activityType === 'sports'
      ? params.sportType
      : undefined;

    const [existingIntent] = await db
      .select({ id: partnerIntents.id })
      .from(partnerIntents)
      .where(and(
        eq(partnerIntents.userId, userId),
        eq(partnerIntents.activityType, params.activityType),
        eq(partnerIntents.status, 'active')
      ))
      .limit(1);

    if (existingIntent) {
      return {
        success: false,
        error: `你已经有一个[${getPartnerIntentTypeName(params.activityType, normalizedSportType)}]意向在等待匹配了`,
      };
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const writeSnapshot = buildPartnerIntentWriteSnapshot({
      rawInput: params.rawInput.trim() || `想找${getPartnerIntentTypeName(params.activityType, normalizedSportType)}搭子`,
      locationHint: normalizedLocationHint,
      timePreference: params.timePreference?.trim(),
      description: params.poiPreference?.trim(),
    });

    const [intent] = await db.insert(partnerIntents).values({
      userId,
      activityType: params.activityType,
      scenarioType: writeSnapshot.scenarioType,
      locationHint: writeSnapshot.locationHint,
      destinationText: writeSnapshot.destinationText,
      location: sql`ST_SetSRID(ST_MakePoint(${userLocation.lng}, ${userLocation.lat}), 4326)`,
      timePreference: params.timePreference?.trim() || null,
      timeText: writeSnapshot.timeText,
      description: writeSnapshot.description,
      metaData: {
        tags: normalizedTags,
        ...(normalizedSportType ? { sportType: normalizedSportType } : {}),
        poiPreference: params.poiPreference?.trim() || undefined,
        budgetType: params.budgetType,
        rawInput: writeSnapshot.rawInput,
      },
      expiresAt,
      status: 'active',
    }).returning();

    const matchResult = await detectMatchesForIntent(intent.id);

    await recordPartnerTaskIntentPosted({
      userId,
      partnerIntentId: intent.id,
      rawInput: writeSnapshot.rawInput,
      activityType: params.activityType,
      scenarioType: writeSnapshot.scenarioType,
      ...(normalizedSportType ? { sportType: normalizedSportType } : {}),
      locationHint: writeSnapshot.locationHint,
      ...(writeSnapshot.destinationText ? { destinationText: writeSnapshot.destinationText } : {}),
      ...(params.timePreference?.trim() ? { timePreference: params.timePreference.trim() } : {}),
      ...(writeSnapshot.timeText ? { timeText: writeSnapshot.timeText } : {}),
      ...(matchResult ? { intentMatchId: matchResult.id } : {}),
    });

    if (matchResult) {
      return {
        success: true,
        intentId: intent.id,
        matchFound: true,
        matchId: matchResult.id,
        message: '🎉 找到匹配的搭子了！',
        extractedTags: normalizedTags,
      };
    }

    return {
      success: true,
      intentId: intent.id,
      matchFound: false,
      message: '意向已发布，有匹配会第一时间通知你',
      extractedTags: normalizedTags,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    console.error('[createPartnerIntent] Error:', error);
    return { success: false, error: '创建意向失败，请再试一次' };
  }
}

export async function ensureSearchDrivenPartnerIntent(params: {
  userId: string | null;
  userLocation: { lat: number; lng: number } | null;
  rawInput: string;
  activityType: CreatePartnerIntentParams['activityType'];
  sportType?: CreatePartnerIntentParams['sportType'];
  locationHint: string;
  timePreference?: string;
  description?: string;
}): Promise<EnsureSearchDrivenPartnerIntentResult> {
  const { userId, userLocation } = params;

  if (!userId) {
    return { success: false, error: '请先登录', requireAuth: true };
  }

  if (!userLocation) {
    return { success: false, error: '需要先获取你的位置，才能继续和对方对接' };
  }

  const [user] = await db
    .select({ phoneNumber: users.phoneNumber })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.phoneNumber) {
    return { success: false, error: '需要先绑定手机号，才能继续和对方对接', requireAuth: true };
  }

  const normalizedSportType: CreatePartnerIntentParams['sportType'] = params.activityType === 'sports'
    ? params.sportType
    : undefined;

  const [existingIntent] = await db
    .select()
    .from(partnerIntents)
    .where(and(
      eq(partnerIntents.userId, userId),
      eq(partnerIntents.activityType, params.activityType),
      eq(partnerIntents.status, 'active')
    ))
    .orderBy(desc(partnerIntents.updatedAt))
    .limit(1);

  if (existingIntent) {
    const existingSportType = typeof existingIntent.metaData?.sportType === 'string'
      ? existingIntent.metaData.sportType
      : undefined;

    if (params.activityType === 'sports' && normalizedSportType && existingSportType && existingSportType !== normalizedSportType) {
      return {
        success: false,
        error: `你已经有一个[${getPartnerIntentTypeName(params.activityType, existingSportType)}]意向在等待匹配了，先处理完它再来找新的吧`,
      };
    }

    return {
      success: true,
      intent: existingIntent,
      created: false,
    };
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const normalizedLocationHint = params.locationHint.trim() || '附近';
  const rawInput = params.rawInput.trim() || `想找${getPartnerIntentTypeName(params.activityType, normalizedSportType)}搭子`;
  const writeSnapshot = buildPartnerIntentWriteSnapshot({
    rawInput,
    locationHint: normalizedLocationHint,
    timePreference: params.timePreference?.trim(),
    description: params.description?.trim(),
  });

  const [intent] = await db.insert(partnerIntents).values({
    userId,
    activityType: params.activityType,
    scenarioType: writeSnapshot.scenarioType,
    locationHint: writeSnapshot.locationHint,
    destinationText: writeSnapshot.destinationText,
    location: sql`ST_SetSRID(ST_MakePoint(${userLocation.lng}, ${userLocation.lat}), 4326)`,
    timePreference: params.timePreference?.trim() || null,
    timeText: writeSnapshot.timeText,
    description: writeSnapshot.description,
    metaData: {
      tags: [],
      ...(normalizedSportType ? { sportType: normalizedSportType } : {}),
      ...(params.description?.trim() ? { poiPreference: params.description.trim() } : {}),
      rawInput: writeSnapshot.rawInput,
    },
    expiresAt,
    status: 'active',
  }).returning();

  await recordPartnerTaskIntentPosted({
    userId,
    partnerIntentId: intent.id,
    rawInput: writeSnapshot.rawInput,
    activityType: params.activityType,
    scenarioType: writeSnapshot.scenarioType,
    ...(normalizedSportType ? { sportType: normalizedSportType } : {}),
    locationHint: writeSnapshot.locationHint,
    ...(writeSnapshot.destinationText ? { destinationText: writeSnapshot.destinationText } : {}),
    ...(params.timePreference?.trim() ? { timePreference: params.timePreference.trim() } : {}),
    ...(writeSnapshot.timeText ? { timeText: writeSnapshot.timeText } : {}),
  });

  return {
    success: true,
    intent,
    created: true,
  };
}

// ============ Tool 工厂函数 ============

/**
 * 创建搭子意向 Tool
 */
export function createPartnerIntentTool(
  userId: string | null,
  userLocation: { lat: number; lng: number } | null
) {
  return tool({
    description: '创建搭子意向。当用户完成需求澄清后使用。必须包含 tags 和 activityType。',
    inputSchema: jsonSchema<CreatePartnerIntentParams>(toJsonSchema(createPartnerIntentSchema)),

    execute: async (params: CreatePartnerIntentParams) => createPartnerIntent(userId, userLocation, params),
  });
}

/**
 * 查询我的意向 Tool
 */
export function getMyIntentsTool(userId: string | null) {
  return tool({
    description: '查询用户的搭子意向列表和待确认的匹配。',
    inputSchema: jsonSchema<{}>({ type: 'object', properties: {} }),

    execute: async () => {
      if (!userId) {
        return { success: false as const, error: '需要先登录', requireAuth: true };
      }

      try {
        const intents = await db
          .select()
          .from(partnerIntents)
          .where(and(eq(partnerIntents.userId, userId), eq(partnerIntents.status, 'active')));

        const pendingMatches = await getPendingMatchesForUser(userId);

        const formattedIntents = intents.map(intent => ({
          id: intent.id,
          type: intent.activityType,
          typeName: getPartnerIntentTypeName(intent.activityType, intent.metaData?.sportType),
          locationHint: intent.locationHint,
          timePreference: intent.timePreference,
          sportType: intent.metaData?.sportType,
          tags: intent.metaData?.tags || [],
          status: intent.status,
          expiresAt: intent.expiresAt,
          createdAt: intent.createdAt,
        }));

        const formattedMatches = pendingMatches.map(match => ({
          id: match.id,
          type: match.activityType,
          typeName: TYPE_NAMES[match.activityType] || match.activityType,
          matchScore: match.matchScore,
          commonTags: match.commonTags,
          locationHint: match.centerLocationHint,
          confirmDeadline: match.confirmDeadline,
          isTempOrganizer: match.tempOrganizerId === userId,
        }));

        return {
          success: true as const,
          intents: formattedIntents,
          pendingMatches: formattedMatches,
          summary: intents.length > 0 || pendingMatches.length > 0
            ? `你有 ${intents.length} 个活跃意向，${pendingMatches.length} 个待确认匹配`
            : '你还没有发布搭子意向',
        };
      } catch (error) {
        console.error('[getMyIntents] Error:', error);
        return { success: false as const, error: '查询失败，请再试一次' };
      }
    },
  });
}

/**
 * 取消意向 Tool
 */
export function cancelIntentTool(userId: string | null) {
  return tool({
    description: '取消搭子意向。',
    inputSchema: jsonSchema<CancelIntentParams>(toJsonSchema(cancelIntentSchema)),

    execute: async ({ intentId }: CancelIntentParams) => {
      if (!userId) {
        return { success: false as const, error: '需要先登录', requireAuth: true };
      }

      try {
        const [intent] = await db
          .select()
          .from(partnerIntents)
          .where(and(eq(partnerIntents.id, intentId), eq(partnerIntents.userId, userId)))
          .limit(1);

        if (!intent) return { success: false as const, error: '找不到这个意向' };
        if (intent.status !== 'active') return { success: false as const, error: '这个意向已经不能取消了' };

        await db
          .update(partnerIntents)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(partnerIntents.id, intentId));

        return { success: true as const, message: '意向已取消' };
      } catch (error) {
        console.error('[cancelIntent] Error:', error);
        return { success: false as const, error: '取消失败，请再试一次' };
      }
    },
  });
}

/**
 * 确认匹配 Tool
 */
export function confirmMatchTool(userId: string | null) {
  return tool({
    description: '确认匹配，将匹配转为正式活动。只有临时召集人可以确认。',
    inputSchema: jsonSchema<ConfirmMatchParams>(toJsonSchema(confirmMatchSchema)),

    execute: async ({ matchId }: ConfirmMatchParams) => {
      if (!userId) {
        return { success: false as const, error: '需要先登录', requireAuth: true };
      }

      try {
        const result = await confirmMatchService(matchId, userId);

        if (!result.success) {
          return { success: false as const, error: result.error };
        }

        return {
          success: true as const,
          activityId: result.activityId,
          message: '🎉 活动创建成功！大家可以开始聊天了～',
        };
      } catch (error) {
        console.error('[confirmMatch] Error:', error);
        return { success: false as const, error: '确认失败，请再试一次' };
      }
    },
  });
}

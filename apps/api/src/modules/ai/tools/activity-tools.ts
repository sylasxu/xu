/**
 * Activity Tools - 活动相关 Tool 集合
 * 
 * 整合活动创建、修改、发布、查询等功能
 * 
 * v4.5: 从多个文件整合为单一模块
 */

import { t } from 'elysia';
import { tool, jsonSchema } from 'ai';
import { toJsonSchema } from '@juchang/utils';
import { db, activities, eq, and, desc } from '@juchang/db';
import {
  createDraftActivity,
  publishDraftActivity,
  updateActivity,
} from '../../activities/activity.service';
import { getQuota } from '../../users/user.service';
import {
  recordCreateTaskDraftReady,
  recordCreateTaskPublished,
} from '../task-runtime/agent-task.service';

// ============ Schema 定义 ============

/** 活动类型枚举 */
const activityTypeSchema = t.Union([
  t.Literal('food'),
  t.Literal('entertainment'),
  t.Literal('sports'),
  t.Literal('boardgame'),
  t.Literal('other'),
], { description: '活动类型' });

/** 创建草稿参数 */
const createDraftSchema = t.Object({
  title: t.String({ description: '活动标题，必须包含 Emoji，格式：Emoji + 核心活动 + 状态，最多12字' }),
  type: activityTypeSchema,
  locationName: t.String({ description: '地点名称（POI），如"观音桥北城天街"' }),
  locationHint: t.String({ description: '重庆地形备注：楼层、入口、交通等信息' }),
  location: t.Tuple([t.Number(), t.Number()], { description: '位置坐标 [lng, lat]' }),
  startAt: t.String({ description: '开始时间，ISO 8601 格式' }),
  maxParticipants: t.Number({ minimum: 2, maximum: 50, description: '最大参与人数' }),
  summary: t.String({ maxLength: 30, description: '小聚的推荐语，30字内，温暖接地气' }),
});

/** 查询草稿参数 */
const getDraftSchema = t.Object({
  activityId: t.Optional(t.String({ description: '活动 ID（如果知道的话）' })),
  title: t.Optional(t.String({ description: '活动标题（用于模糊搜索）' })),
});

/** 修改草稿参数 */
const refineDraftSchema = t.Object({
  activityId: t.String({ description: '要修改的活动 ID' }),
  updates: t.Object({
    title: t.Optional(t.String({ description: '新标题' })),
    type: t.Optional(activityTypeSchema),
    locationName: t.Optional(t.String({ description: '新地点名称' })),
    locationHint: t.Optional(t.String({ description: '新位置备注' })),
    location: t.Optional(t.Tuple([t.Number(), t.Number()], { description: '新坐标 [lng, lat]' })),
    startAt: t.Optional(t.String({ description: '新开始时间，ISO 8601 格式' })),
    maxParticipants: t.Optional(t.Number({ minimum: 2, maximum: 50, description: '新人数上限' })),
  }, { description: '要更新的字段，只传需要修改的' }),
  reason: t.String({ description: '修改原因，用于生成回复' }),
});

/** 发布活动参数 */
const publishActivitySchema = t.Object({
  activityId: t.String({ description: '要发布的活动 ID' }),
});

// ============ 类型导出 ============

export type CreateDraftParams = typeof createDraftSchema.static;
export type GetDraftParams = typeof getDraftSchema.static;
export type RefineDraftParams = typeof refineDraftSchema.static;
export type PublishActivityParams = typeof publishActivitySchema.static;

interface PublishedActivityCardPayload {
  activityId: string;
  title: string;
  type: string;
  startAt: string;
  lat: number;
  lng: number;
  locationName: string;
  locationHint: string;
  maxParticipants: number;
  currentParticipants: number;
  shareUrl: string;
  sharePath: string;
}

function generateShareUrl(activityId: string): string {
  return `https://juchang.app/activity/${activityId}`;
}

function generateSharePath(activityId: string): string {
  return `/subpackages/activity/detail/index?id=${activityId}&share=1`;
}

function buildLoginRequiredResult(action: string) {
  return {
    success: false as const,
    error: `请先登录后再${action}`,
  };
}

const DEFAULT_DRAFT_LOCATION: [number, number] = [106.52988, 29.58567];

const ACTION_DRAFT_PRESETS: Record<CreateDraftParams['type'], {
  title: string;
  maxParticipants: number;
  summary: string;
  buildLocationHint: (locationName: string) => string;
}> = {
  food: {
    title: '🍲 约饭局',
    maxParticipants: 4,
    summary: '想吃就来，边吃边认识新朋友。',
    buildLocationHint: (locationName) => `${locationName}商圈，具体店名报名后群里确认`,
  },
  entertainment: {
    title: '🎤 娱乐局',
    maxParticipants: 6,
    summary: '轻松玩一场，认识些聊得来的人。',
    buildLocationHint: (locationName) => `${locationName}附近，具体地点报名后群里确认`,
  },
  sports: {
    title: '🏃 运动局',
    maxParticipants: 8,
    summary: '来动一动，顺便认识同频搭子。',
    buildLocationHint: (locationName) => `${locationName}附近场地，具体场馆报名后群里确认`,
  },
  boardgame: {
    title: '🎲 桌游局',
    maxParticipants: 6,
    summary: '一起玩桌游，熟得会更快一点。',
    buildLocationHint: (locationName) => `${locationName}桌游店，具体门店报名后群里确认`,
  },
  other: {
    title: '✨ 活动局',
    maxParticipants: 6,
    summary: '先把局攒起来，再慢慢补细节。',
    buildLocationHint: (locationName) => `${locationName}附近，具体地点报名后群里确认`,
  },
};

function readPayloadText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDraftType(rawType: unknown): CreateDraftParams['type'] {
  const value = typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';

  if (['food', 'hotpot', 'drink', 'coffee'].includes(value)) {
    return 'food';
  }

  if (['sports', 'badminton', 'basketball', 'football', 'running', 'hiking'].includes(value)) {
    return 'sports';
  }

  if (['boardgame', 'mahjong'].includes(value)) {
    return 'boardgame';
  }

  if (['entertainment', 'movie', 'ktv', 'game'].includes(value)) {
    return 'entertainment';
  }

  return 'other';
}

function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function inferDraftStartAt(description: string, providedStartAt?: string): string {
  if (providedStartAt) {
    return providedStartAt;
  }

  const now = new Date();
  const target = new Date(now);

  if (/今晚|今晚上|今天晚上/.test(description)) {
    target.setHours(20, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return formatLocalDateTime(target);
  }

  if (/周末/.test(description)) {
    target.setDate(target.getDate() + 1);
    const offset = (6 - target.getDay() + 7) % 7 || 7;
    target.setDate(target.getDate() + offset);
    target.setHours(14, 0, 0, 0);
    return formatLocalDateTime(target);
  }

  target.setDate(target.getDate() + 1);
  target.setHours(14, 0, 0, 0);
  return formatLocalDateTime(target);
}

function inferDraftLocation(payload: Record<string, unknown>): [number, number] {
  const locationValue = payload.location;
  if (Array.isArray(locationValue) && locationValue.length >= 2) {
    const lng = Number(locationValue[0]);
    const lat = Number(locationValue[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return [lng, lat];
    }
  }

  const embeddedLocation = payload._location;
  const locationRecord = embeddedLocation && typeof embeddedLocation === 'object'
    ? embeddedLocation as Record<string, unknown>
    : payload;
  const lng = Number(locationRecord.lng);
  const lat = Number(locationRecord.lat);
  if (Number.isFinite(lng) && Number.isFinite(lat)) {
    return [lng, lat];
  }

  return DEFAULT_DRAFT_LOCATION;
}

function inferDraftTitle(type: CreateDraftParams['type'], description: string, providedTitle?: string): string {
  if (providedTitle) {
    return providedTitle;
  }

  const keywordPresets: Array<{ pattern: RegExp; title: string }> = [
    { pattern: /羽毛球/, title: '🏸 羽毛球局' },
    { pattern: /火锅/, title: '🍲 火锅局' },
    { pattern: /桌游/, title: '🎲 桌游局' },
    { pattern: /咖啡/, title: '☕ 咖啡局' },
    { pattern: /电影/, title: '🎬 电影局' },
    { pattern: /KTV|唱歌|k歌/i, title: '🎤 K歌局' },
    { pattern: /徒步/, title: '🥾 徒步局' },
  ];

  for (const preset of keywordPresets) {
    if (preset.pattern.test(description)) {
      return preset.title;
    }
  }

  return ACTION_DRAFT_PRESETS[type].title;
}

function inferDraftSummary(type: CreateDraftParams['type'], locationName: string, description: string): string {
  if (/羽毛球/.test(description)) {
    return `${locationName}约球搭子，新手老手都欢迎！`;
  }

  if (/火锅/.test(description)) {
    return `${locationName}一起吃顿热乎的，边吃边聊。`;
  }

  return ACTION_DRAFT_PRESETS[type].summary;
}

export function buildCreateDraftParamsFromActionPayload(
  payload: Record<string, unknown>
): CreateDraftParams {
  const description = readPayloadText(payload, 'description');
  const type = normalizeDraftType(payload.type || payload.activityType);
  const locationName = readPayloadText(payload, 'locationName')
    || readPayloadText(payload, 'location')
    || '观音桥';
  const providedTitle = readPayloadText(payload, 'title');
  const providedLocationHint = readPayloadText(payload, 'locationHint');
  const providedStartAt = readPayloadText(payload, 'startAt');
  const maxParticipants = Number(payload.maxParticipants);
  const preset = ACTION_DRAFT_PRESETS[type];

  return {
    title: inferDraftTitle(type, description, providedTitle),
    type,
    locationName,
    locationHint: providedLocationHint || preset.buildLocationHint(locationName),
    location: inferDraftLocation(payload),
    startAt: inferDraftStartAt(description, providedStartAt),
    maxParticipants: Number.isFinite(maxParticipants) && maxParticipants >= 2 ? maxParticipants : preset.maxParticipants,
    summary: inferDraftSummary(type, locationName, description),
  };
}

export async function createActivityDraftRecord(userId: string, params: CreateDraftParams) {
  try {
    const { summary: _summary, ...draftData } = params;
    const result = await createDraftActivity(draftData, userId);

    await recordCreateTaskDraftReady({
      userId,
      activityId: result.id,
      title: params.title,
      type: params.type,
      locationName: params.locationName,
      startAt: params.startAt,
      maxParticipants: params.maxParticipants,
      source: 'activity_draft_created',
    });

    return {
      success: true as const,
      activityId: result.id,
      draft: params,
      message: '草稿已创建，可以在卡片上修改或直接发布',
    };
  } catch (error) {
    console.error('[createActivityDraft] Error:', error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : '创建草稿失败，请再试一次',
    };
  }
}

// ============ Tool 工厂函数 ============

/**
 * 创建活动草稿 Tool
 */
export function createActivityDraftTool(userId: string | null) {
  return tool({
    description: '创建活动草稿。推断缺失信息（时间默认明天14:00，人数默认4人），不反问。',
    inputSchema: jsonSchema<CreateDraftParams>(toJsonSchema(createDraftSchema)),
    
    execute: async (params: CreateDraftParams) => {
      if (!userId) {
        return buildLoginRequiredResult('创建活动草稿');
      }
      
      return createActivityDraftRecord(userId, params);
    },
  });
}

/**
 * 查询草稿 Tool
 */
export function getDraftTool(userId: string | null) {
  return tool({
    description: '查询草稿。按 activityId 或 title 搜索，不传参返回最近草稿。',
    inputSchema: jsonSchema<GetDraftParams>(toJsonSchema(getDraftSchema)),
    
    execute: async ({ activityId, title }: GetDraftParams) => {
      if (!userId) {
        return buildLoginRequiredResult('查看活动草稿');
      }
      
      try {
        const drafts = await db
          .select({
            id: activities.id,
            title: activities.title,
            type: activities.type,
            locationName: activities.locationName,
            locationHint: activities.locationHint,
            startAt: activities.startAt,
            maxParticipants: activities.maxParticipants,
            status: activities.status,
          })
          .from(activities)
          .where(and(eq(activities.creatorId, userId), eq(activities.status, 'draft')))
          .orderBy(desc(activities.createdAt))
          .limit(5);
        
        if (drafts.length === 0) {
          return { success: false as const, error: '你还没有草稿，要不要现在创建一个？' };
        }
        
        // 精确匹配 activityId
        if (activityId) {
          const draft = drafts.find(d => d.id === activityId);
          if (draft) {
            return {
              success: true as const,
              draft: { activityId: draft.id, ...draft, startAt: draft.startAt.toISOString() },
              message: '已获取草稿信息',
            };
          }
        }
        
        // 模糊匹配标题
        if (title) {
          const normalizedTitle = title.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim().toLowerCase();
          const matchedDraft = drafts.find(d => {
            const draftTitle = d.title.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim().toLowerCase();
            return draftTitle.includes(normalizedTitle) || normalizedTitle.includes(draftTitle);
          });
          
          if (matchedDraft) {
            return {
              success: true as const,
              draft: { activityId: matchedDraft.id, ...matchedDraft, startAt: matchedDraft.startAt.toISOString() },
              message: '已找到匹配的草稿',
            };
          }
        }
        
        // 返回最近草稿
        const latestDraft = drafts[0];
        return {
          success: true as const,
          draft: { activityId: latestDraft.id, ...latestDraft, startAt: latestDraft.startAt.toISOString() },
          allDrafts: drafts.length > 1 ? drafts.map(d => ({ id: d.id, title: d.title })) : undefined,
          message: drafts.length > 1 ? `找到 ${drafts.length} 个草稿，这是最近的一个` : '已获取草稿信息',
        };
      } catch (error) {
        console.error('[getDraft] Error:', error);
        return { success: false as const, error: '查询失败，请再试一次' };
      }
    },
  });
}

export async function updateActivityDraftRecord(
  userId: string,
  activityId: string,
  updates: RefineDraftParams['updates'],
  reason: string
) {
  try {
    const [existingActivity] = await db
      .select({ id: activities.id, creatorId: activities.creatorId, status: activities.status })
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!existingActivity) return { success: false as const, error: '找不到这个草稿，可能已经被删除了' };
    if (existingActivity.creatorId !== userId) return { success: false as const, error: '你没有权限修改这个活动' };
    if (existingActivity.status !== 'draft') return { success: false as const, error: '只能修改草稿状态的活动' };

    await updateActivity(activityId, userId, updates);

    const [updatedActivity] = await db
      .select({
        id: activities.id, title: activities.title, type: activities.type,
        locationName: activities.locationName, locationHint: activities.locationHint,
        startAt: activities.startAt, maxParticipants: activities.maxParticipants,
      })
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    await recordCreateTaskDraftReady({
      userId,
      activityId,
      title: updatedActivity.title,
      type: updatedActivity.type,
      locationName: updatedActivity.locationName,
      startAt: updatedActivity.startAt.toISOString(),
      maxParticipants: updatedActivity.maxParticipants,
      source: 'activity_draft_updated',
    });

    return {
      success: true as const,
      activityId,
      draft: { ...updatedActivity, startAt: updatedActivity.startAt.toISOString() },
      message: `已更新：${reason}`,
    };
  } catch (error) {
    console.error('[refineDraft] Error:', error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : '修改失败，请再试一次',
    };
  }
}

/**
 * 修改草稿 Tool
 */
export function refineDraftTool(userId: string | null) {
  return tool({
    description: '修改草稿。只改用户要求的字段，需要 activityId。',
    inputSchema: jsonSchema<RefineDraftParams>(toJsonSchema(refineDraftSchema)),

    execute: async ({ activityId, updates, reason }: RefineDraftParams) => {
      if (!userId) {
        return buildLoginRequiredResult('修改活动草稿');
      }

      return updateActivityDraftRecord(userId, activityId, updates, reason);
    },
  });
}

export async function publishActivityRecord(userId: string, activityId: string) {
  try {
    const [existingActivity] = await db
      .select({
        title: activities.title,
        locationName: activities.locationName,
      })
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    await publishDraftActivity(activityId, userId);

    const [publishedActivity] = await db
      .select({
        id: activities.id,
        title: activities.title,
        type: activities.type,
        startAt: activities.startAt,
        location: activities.location,
        locationName: activities.locationName,
        locationHint: activities.locationHint,
        maxParticipants: activities.maxParticipants,
        currentParticipants: activities.currentParticipants,
      })
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    await recordCreateTaskPublished({
      userId,
      activityId,
      title: existingActivity?.title || '活动',
      locationName: existingActivity?.locationName || null,
    });
    const quota = await getQuota(userId);


    const shareUrl = generateShareUrl(activityId);
    const sharePath = generateSharePath(activityId);
    const publishedActivityCard = publishedActivity
      ? {
          activityId: publishedActivity.id,
          title: publishedActivity.title,
          type: publishedActivity.type,
          startAt: publishedActivity.startAt.toISOString(),
          lat: publishedActivity.location?.y ?? 29.58567,
          lng: publishedActivity.location?.x ?? 106.52988,
          locationName: publishedActivity.locationName,
          locationHint: publishedActivity.locationHint,
          maxParticipants: publishedActivity.maxParticipants,
          currentParticipants: publishedActivity.currentParticipants,
          shareUrl,
          sharePath,
        } satisfies PublishedActivityCardPayload
      : null;

    return {
      success: true as const,
      activityId,
      title: existingActivity?.title || '活动',
      shareUrl,
      message: '活动发布成功！快分享给朋友吧',
      quotaRemaining: quota?.aiCreateQuota ?? 0,
      ...(publishedActivityCard ? { publishedActivity: publishedActivityCard } : {}),
    };
  } catch (error) {
    console.error('[publishActivity] Error:', error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : '发布失败，请再试一次',
    };
  }
}

/**
 * 发布活动 Tool
 */
export function publishActivityTool(userId: string | null) {
  return tool({
    description: '发布活动。将草稿改为 active 状态，消耗每日额度。',
    inputSchema: jsonSchema<PublishActivityParams>(toJsonSchema(publishActivitySchema)),
    
    execute: async ({ activityId }: PublishActivityParams) => {
      if (!userId) {
        return buildLoginRequiredResult('发布活动');
      }
      
      return publishActivityRecord(userId, activityId);
    },
  });
}

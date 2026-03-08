/**
 * Partner Tools - 找搭子相关 Tool 集合
 *
 * 整合搭子意向创建、查询、取消、匹配确认等功能
 *
 * v4.5: 从多个文件整合为单一模块
 */

import { t } from 'elysia';
import { tool, jsonSchema } from 'ai';
import { toJsonSchema } from '@juchang/utils';
import { db, users, partnerIntents, eq, and, sql } from '@juchang/db';
import { detectMatchesForIntent, getPendingMatchesForUser, confirmMatch as confirmMatchService } from './helpers/match';

// ============ Schema 定义 ============

/** 活动类型枚举 */
const activityTypeSchema = t.Union([
  t.Literal('food'),
  t.Literal('entertainment'),
  t.Literal('sports'),
  t.Literal('boardgame'),
  t.Literal('other'),
], { description: '活动类型' });

/** 创建搭子意向参数 */
const createPartnerIntentSchema = t.Object({
  rawInput: t.String({ description: '用户原始输入' }),
  activityType: activityTypeSchema,
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
      return { success: false, error: `你已经有一个[${TYPE_NAMES[params.activityType]}]意向在等待匹配了` };
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [intent] = await db.insert(partnerIntents).values({
      userId,
      activityType: params.activityType,
      locationHint: normalizedLocationHint,
      location: sql`ST_SetSRID(ST_MakePoint(${userLocation.lng}, ${userLocation.lat}), 4326)`,
      timePreference: params.timePreference?.trim() || null,
      metaData: {
        tags: normalizedTags,
        poiPreference: params.poiPreference?.trim() || undefined,
        budgetType: params.budgetType,
        rawInput: params.rawInput.trim() || `想找${TYPE_NAMES[params.activityType]}搭子`,
      },
      expiresAt,
      status: 'active',
    }).returning();

    const matchResult = await detectMatchesForIntent(intent.id);

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
          typeName: TYPE_NAMES[intent.activityType] || intent.activityType,
          locationHint: intent.locationHint,
          timePreference: intent.timePreference,
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

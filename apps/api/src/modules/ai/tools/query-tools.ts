/**
 * Query Tools - 查询和参与相关 Tool 集合
 * 
 * 整合活动查询、报名、取消、详情等功能
 * 
 * v4.5: 从多个文件整合为单一模块
 */

import { t } from 'elysia';
import { tool, jsonSchema } from 'ai';
import { toJsonSchema } from '@juchang/utils';
import { db, activities, participants, users, eq, and, desc, sql } from '@juchang/db';
import { joinActivity as joinActivityCommand, updateActivityStatus } from '../../activities/activity.service';

// ============ Schema 定义 ============

/** 报名活动参数 */
const joinActivitySchema = t.Object({
  activityId: t.String({ description: '要报名的活动 ID' }),
});

/** 取消活动参数 */
const cancelActivitySchema = t.Object({
  activityId: t.String({ description: '要取消的活动 ID' }),
  reason: t.Optional(t.String({ description: '取消原因（可选）' })),
});

/** 查询我的活动参数 */
const getMyActivitiesSchema = t.Object({
  type: t.Union([
    t.Literal('created'),
    t.Literal('joined'),
  ], { description: '"created" 我发布的，"joined" 我参与的' }),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 10, description: '返回数量，默认 5' })),
});

/** 查询活动详情参数 */
const getActivityDetailSchema = t.Object({
  activityId: t.Optional(t.String({ description: '活动 ID（精确查询）' })),
  title: t.Optional(t.String({ description: '活动标题（模糊搜索）' })),
});

// ============ 类型导出 ============

export type JoinActivityParams = typeof joinActivitySchema.static;
export type CancelActivityParams = typeof cancelActivitySchema.static;
export type GetMyActivitiesParams = typeof getMyActivitiesSchema.static;
export type GetActivityDetailParams = typeof getActivityDetailSchema.static;

// ============ Tool 工厂函数 ============

/**
 * 报名活动 Tool
 */
export function joinActivityTool(userId: string | null) {
  return tool({
    description: '报名活动。需要 activityId。',
    inputSchema: jsonSchema<JoinActivityParams>(toJsonSchema(joinActivitySchema)),
    
    execute: async ({ activityId }: JoinActivityParams) => {
      if (!userId) {
        return { success: false as const, error: '需要先登录才能报名活动', requireAuth: true };
      }
      
      try {
        const [activity] = await db
          .select({ title: activities.title })
          .from(activities)
          .where(eq(activities.id, activityId))
          .limit(1);

        const result = await joinActivityCommand(activityId, userId);
        
        return {
          success: true as const,
          activityId,
          activityTitle: activity?.title || '活动',
          participantId: result.participantId,
          joinResult: result.joinResult,
          message: result.message,
        };
      } catch (error) {
        console.error('[joinActivity] Error:', error);
        return {
          success: false as const,
          error: error instanceof Error ? error.message : '报名失败，请再试一次',
        };
      }
    },
  });
}

/**
 * 取消活动 Tool
 */
export function cancelActivityTool(userId: string | null) {
  return tool({
    description: '取消活动。仅发起人可用，需要 activityId。',
    inputSchema: jsonSchema<CancelActivityParams>(toJsonSchema(cancelActivitySchema)),
    
    execute: async ({ activityId, reason }: CancelActivityParams) => {
      if (!userId) {
        return { success: false as const, error: '需要先登录才能取消活动' };
      }
      
      try {
        await updateActivityStatus(activityId, userId, 'cancelled');

        const [activity] = await db
          .select({ title: activities.title })
          .from(activities)
          .where(eq(activities.id, activityId))
          .limit(1);
        
        return {
          success: true as const,
          activityId,
          activityTitle: activity?.title || '活动',
          message: activity?.title
            ? (reason ? `「${activity.title}」已取消，原因：${reason}` : `「${activity.title}」已取消`)
            : '活动已取消',
        };
      } catch (error) {
        console.error('[cancelActivity] Error:', error);
        return {
          success: false as const,
          error: error instanceof Error ? error.message : '取消失败，请再试一次',
        };
      }
    },
  });
}

/**
 * 查询我的活动 Tool
 */
export function getMyActivitiesTool(userId: string | null) {
  return tool({
    description: '查看我的活动。type: "created" 我发布的，"joined" 我参与的。',
    inputSchema: jsonSchema<GetMyActivitiesParams>(toJsonSchema(getMyActivitiesSchema)),
    
    execute: async ({ type, limit = 5 }: GetMyActivitiesParams) => {
      if (!userId) {
        return { success: false as const, error: '需要先登录才能查看活动' };
      }
      
      try {
        if (type === 'created') {
          const myActivities = await db
            .select({
              id: activities.id, title: activities.title, type: activities.type, status: activities.status,
              startAt: activities.startAt, locationName: activities.locationName,
              currentParticipants: activities.currentParticipants, maxParticipants: activities.maxParticipants,
            })
            .from(activities)
            .where(eq(activities.creatorId, userId))
            .orderBy(desc(activities.createdAt))
            .limit(limit);
          
          if (myActivities.length === 0) {
            return { success: true as const, type: 'created', activities: [], message: '你还没有发布过活动，要不要现在创建一个？' };
          }
          
          return {
            success: true as const,
            type: 'created',
            activities: myActivities.map(a => ({ ...a, startAt: a.startAt.toISOString() })),
            message: `你发布了 ${myActivities.length} 个活动`,
          };
        } else {
          const joinedActivities = await db
            .select({
              id: activities.id, title: activities.title, type: activities.type, status: activities.status,
              startAt: activities.startAt, locationName: activities.locationName,
              currentParticipants: activities.currentParticipants, maxParticipants: activities.maxParticipants,
            })
            .from(activities)
            .innerJoin(participants, eq(activities.id, participants.activityId))
            .where(and(eq(participants.userId, userId), eq(participants.status, 'joined')))
            .orderBy(desc(activities.startAt))
            .limit(limit);
          
          if (joinedActivities.length === 0) {
            return { success: true as const, type: 'joined', activities: [], message: '你还没有参与过活动，去探索一下附近有什么好玩的？' };
          }
          
          return {
            success: true as const,
            type: 'joined',
            activities: joinedActivities.map(a => ({ ...a, startAt: a.startAt.toISOString() })),
            message: `你参与了 ${joinedActivities.length} 个活动`,
          };
        }
      } catch (error) {
        console.error('[getMyActivities] Error:', error);
        return { success: false as const, error: '查询失败，请再试一次' };
      }
    },
  });
}

/**
 * 查询活动详情 Tool
 */
export function getActivityDetailTool(userId: string | null) {
  return tool({
    description: '查看活动详情。按 activityId 或 title 查询。',
    inputSchema: jsonSchema<GetActivityDetailParams>(toJsonSchema(getActivityDetailSchema)),
    
    execute: async ({ activityId, title }: GetActivityDetailParams) => {
      try {
        let activity;
        
        if (activityId) {
          const [result] = await db
            .select({
              id: activities.id, title: activities.title, type: activities.type, status: activities.status,
              startAt: activities.startAt, locationName: activities.locationName, locationHint: activities.locationHint,
              currentParticipants: activities.currentParticipants, maxParticipants: activities.maxParticipants,
              creatorId: activities.creatorId, creatorNickname: users.nickname,
            })
            .from(activities)
            .leftJoin(users, eq(activities.creatorId, users.id))
            .where(eq(activities.id, activityId))
            .limit(1);
          activity = result;
        } else if (title) {
          const normalizedTitle = title.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim().toLowerCase();
          const results = await db
            .select({
              id: activities.id, title: activities.title, type: activities.type, status: activities.status,
              startAt: activities.startAt, locationName: activities.locationName, locationHint: activities.locationHint,
              currentParticipants: activities.currentParticipants, maxParticipants: activities.maxParticipants,
              creatorId: activities.creatorId, creatorNickname: users.nickname,
            })
            .from(activities)
            .leftJoin(users, eq(activities.creatorId, users.id))
            .where(sql`${activities.status} IN ('active', 'draft')`)
            .orderBy(desc(activities.createdAt))
            .limit(10);
          
          activity = results.find(a => {
            const actTitle = a.title.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim().toLowerCase();
            return actTitle.includes(normalizedTitle) || normalizedTitle.includes(actTitle);
          });
        }
        
        if (!activity) return { success: false as const, error: '找不到这个活动' };
        
        const participantList = await db
          .select({ id: participants.id, nickname: users.nickname, avatarUrl: users.avatarUrl })
          .from(participants)
          .innerJoin(users, eq(participants.userId, users.id))
          .where(and(
            eq(participants.activityId, activity.id),
            eq(participants.status, 'joined'),
          ))
          .limit(10);
        
        let isJoined = false;
        let isWaitlisted = false;
        let isCreator = false;
        if (userId) {
          isCreator = activity.creatorId === userId;
          const [joined] = await db
            .select({ id: participants.id, status: participants.status })
            .from(participants)
            .where(sql`${participants.activityId} = ${activity.id} AND ${participants.userId} = ${userId}`)
            .limit(1);
          isJoined = joined?.status === 'joined';
          isWaitlisted = joined?.status === 'waitlist';
        }

        const remainingSeats = Math.max(0, activity.maxParticipants - activity.currentParticipants);
        const isFull = remainingSeats === 0;
        const canJoin = activity.status === 'active' && activity.startAt > new Date() && !isCreator && !isJoined && !isWaitlisted;
        
        return {
          success: true as const,
          activity: { ...activity, startAt: activity.startAt.toISOString() },
          participants: participantList,
          isJoined,
          isWaitlisted,
          isCreator,
          isFull,
          remainingSeats,
          canJoin,
          message: isFull
            ? `「${activity.title}」已经满员，可先候补`
            : `「${activity.title}」${activity.currentParticipants}/${activity.maxParticipants} 人`,
        };
      } catch (error) {
        console.error('[getActivityDetail] Error:', error);
        return { success: false as const, error: '查询失败，请再试一次' };
      }
    },
  });
}

/**
 * 询问偏好 Tool
 */
export function askPreferenceTool(_userId: string | null) {
  const optionSchema = t.Object({
    label: t.String({ description: '选项显示文本' }),
    value: t.String({ description: '选项值' }),
  });
  
  const collectedInfoSchema = t.Object({
    location: t.Optional(t.String({ description: '已收集的位置信息' })),
    type: t.Optional(t.String({ description: '已收集的活动类型' })),
  });
  
  const askPreferenceSchema = t.Object({
    questionType: t.Union([t.Literal('location'), t.Literal('type')], { description: '询问类型' }),
    question: t.String({ description: '询问用户的问题文本' }),
    options: t.Array(optionSchema, { description: '推荐选项列表', minItems: 3 }),
    allowSkip: t.Boolean({ description: '是否允许跳过', default: true }),
    collectedInfo: t.Optional(collectedInfoSchema),
  });
  
  type AskPreferenceParams = typeof askPreferenceSchema.static;
  
  return tool({
    description: '询问偏好。探索意图但信息不完整时用，最多2次，调用后停止等待回复。',
    inputSchema: jsonSchema<AskPreferenceParams>(toJsonSchema(askPreferenceSchema)),
    
    execute: async (params: AskPreferenceParams) => {
      const { questionType, question, options, allowSkip = true, collectedInfo } = params;
      return {
        success: true as const,
        widgetType: 'widget_ask_preference' as const,
        questionType,
        question,
        options,
        allowSkip,
        collectedInfo,
      };
    },
  });
}

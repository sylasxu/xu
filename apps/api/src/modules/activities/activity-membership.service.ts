// Activity Membership Service - 报名相关业务逻辑
import {
  db,
  activities,
  users,
  participants,
  activityMessages,
  eq,
  sql,
  and,
  gt,
} from '@xu/db';
import {
  notifyJoin,
  notifyNewParticipant,
} from '../notifications/notification.service';
import { recordJoinTaskJoinedFromDomain } from '../ai/task-runtime/agent-task.service';

function getJoinActivityErrorMessage(error: unknown): string {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === '23505'
  ) {
    return '您已报名此活动';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '报名失败';
}

function formatDiscussionStartTime(startAt: Date): string {
  const month = startAt.getMonth() + 1;
  const day = startAt.getDate();
  const hour = startAt.getHours().toString().padStart(2, '0');
  const minute = startAt.getMinutes().toString().padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute}`;
}

function buildJoinDiscussionSystemMessage(params: {
  joinerName: string;
  locationName: string;
  startAt: Date;
}): string {
  return `${params.joinerName} 刚刚加入了！先在这里确认集合、时间和地点：${formatDiscussionStartTime(params.startAt)}，${params.locationName}。`;
}

export type JoinNavigationIntent = 'open_discussion' | 'stay_on_detail';

export interface JoinActivityResult {
  participantId: string | null;
  joinResult: 'joined' | 'already_joined' | 'waitlisted' | 'closed';
  message: string;
  navigationIntent: JoinNavigationIntent;
}

export async function joinActivity(activityId: string, userId: string): Promise<JoinActivityResult> {
  let participantId: string | null = null;
  let shouldNotify = false;
  let creatorId = '';
  let activityTitle = '';
  let activityLocationName = '';
  let activityStartAt: Date | null = null;
  let joinerName = '新成员';
  let result: JoinActivityResult | null = null;

  try {
    result = await db.transaction(async (tx) => {
      const [joiningUser] = await tx
        .select({ phoneNumber: users.phoneNumber, nickname: users.nickname })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!joiningUser?.phoneNumber) {
        throw new Error('请先绑定手机号才能报名活动');
      }

      const [activity] = await tx
        .select({
          id: activities.id,
          creatorId: activities.creatorId,
          title: activities.title,
          locationName: activities.locationName,
          status: activities.status,
          currentParticipants: activities.currentParticipants,
          maxParticipants: activities.maxParticipants,
          startAt: activities.startAt,
        })
        .from(activities)
        .where(eq(activities.id, activityId))
        .limit(1);

      if (!activity) {
        throw new Error('活动不存在');
      }

      if (activity.status !== 'active') {
        return {
          participantId: null,
          joinResult: 'closed',
          message: '这场局现在不在招募中',
          navigationIntent: 'stay_on_detail',
        } satisfies JoinActivityResult;
      }

      if (activity.creatorId === userId) {
        return {
          participantId: null,
          joinResult: 'closed',
          message: '这是你自己发起的局',
          navigationIntent: 'stay_on_detail',
        } satisfies JoinActivityResult;
      }

      if (activity.startAt <= new Date()) {
        return {
          participantId: null,
          joinResult: 'closed',
          message: '活动已经开始了，不能加入了',
          navigationIntent: 'stay_on_detail',
        } satisfies JoinActivityResult;
      }

      creatorId = activity.creatorId;
      activityTitle = activity.title;
      activityLocationName = activity.locationName;
      activityStartAt = activity.startAt;
      joinerName = joiningUser.nickname || '新成员';

      const [existing] = await tx
        .select({
          id: participants.id,
          status: participants.status,
        })
        .from(participants)
        .where(and(
          eq(participants.activityId, activityId),
          eq(participants.userId, userId)
        ))
        .limit(1);

      const now = new Date();

      if (existing) {
        if (existing.status === 'joined') {
          return {
            participantId: existing.id,
            joinResult: 'already_joined',
            message: '你已经在这场局里了，直接去讨论区就行',
            navigationIntent: 'open_discussion',
          } satisfies JoinActivityResult;
        }
      }

      const needsSeat = activity.currentParticipants < activity.maxParticipants;
      let finalStatus: 'joined' | 'waitlist' = needsSeat ? 'joined' : 'waitlist';

      if (finalStatus === 'joined') {
        if (existing) {
          await tx
            .update(participants)
            .set({
              status: 'joined',
              joinedAt: now,
              updatedAt: now,
            })
            .where(eq(participants.id, existing.id));

          participantId = existing.id;
        } else {
          const [participant] = await tx
            .insert(participants)
            .values({
              activityId,
              userId,
              status: 'joined',
            })
            .returning({ id: participants.id });

          participantId = participant.id;
        }

        const updatedActivities = await tx
          .update(activities)
          .set({
            currentParticipants: sql`${activities.currentParticipants} + 1`,
            updatedAt: now,
          })
          .where(and(
            eq(activities.id, activityId),
            eq(activities.status, 'active'),
            gt(activities.startAt, now),
            sql`${activities.currentParticipants} < ${activities.maxParticipants}`,
          ))
          .returning({ id: activities.id });

        if (updatedActivities.length === 0) {
          finalStatus = 'waitlist';
        }
      }

      if (finalStatus === 'waitlist') {
        if (existing) {
          await tx
            .update(participants)
            .set({
              status: 'waitlist',
              joinedAt: null,
              updatedAt: now,
            })
            .where(eq(participants.id, existing.id));

          participantId = existing.id;
        } else {
          const [participant] = await tx
            .insert(participants)
            .values({
              activityId,
              userId,
              status: 'waitlist',
              joinedAt: null,
            })
            .returning({ id: participants.id });

          participantId = participant.id;
        }
      }

      shouldNotify = finalStatus === 'joined' && existing?.status !== 'joined';

      if (finalStatus === 'waitlist') {
        return {
          participantId,
          joinResult: 'waitlisted',
          message: existing?.status === 'waitlist'
            ? '这场局还在满员中，你已经在候补里了'
            : '这场局已经满员，先帮你排进候补',
          navigationIntent: 'stay_on_detail',
        } satisfies JoinActivityResult;
      }

      return {
        participantId,
        joinResult: 'joined',
        message: `报名成功！「${activity.title}」等你来～`,
        navigationIntent: 'open_discussion',
      } satisfies JoinActivityResult;
    });
  } catch (error) {
    throw new Error(getJoinActivityErrorMessage(error));
  }

  if (!result) {
    throw new Error('报名失败');
  }

  if (shouldNotify) {
    notifyJoin(
      creatorId,
      activityId,
      activityTitle,
      joinerName
    ).catch((error) => {
      console.error('Failed to send join notification:', error);
    });

    try {
      await db.insert(activityMessages).values({
        activityId,
        senderId: null,
        messageType: 'system',
        content: buildJoinDiscussionSystemMessage({
          joinerName,
          locationName: activityLocationName || '待确认地点',
          startAt: activityStartAt ?? new Date(),
        }),
      });
    } catch (error) {
      console.error('Failed to send join system message:', error);
    }

    notifyNewParticipant(
      activityId,
      activityTitle,
      joinerName,
      userId,
      creatorId
    ).catch((error) => console.error('Failed to notify participants:', error));
  }

  if (result.joinResult === 'joined') {
    await recordJoinTaskJoinedFromDomain({
      userId,
      activityId,
      activityTitle,
      source: 'activity_join',
      entry: 'activity_detail_join',
      joinResult: 'joined',
    }).catch((error) => {
      console.error('Failed to record join task joined:', error);
    });

    import('../hot-keywords/hot-keywords.service').then(({ trackConversion }) => {
      trackConversion(userId).catch((error) => {
        console.error('Failed to track keyword conversion:', error);
      });
    });
  } else if (result.joinResult === 'already_joined') {
    await recordJoinTaskJoinedFromDomain({
      userId,
      activityId,
      activityTitle,
      source: 'activity_join',
      entry: 'activity_detail_join',
      joinResult: 'already_joined',
    }).catch((error) => {
      console.error('Failed to record already joined task:', error);
    });
  }

  return result;
}

export async function quitActivity(activityId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [activity] = await tx
      .select({
        id: activities.id,
        creatorId: activities.creatorId,
      })
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!activity) {
      throw new Error('活动不存在');
    }

    if (activity.creatorId === userId) {
      throw new Error('活动发起人不能退出活动');
    }

    const [participant] = await tx
      .select({ id: participants.id, status: participants.status })
      .from(participants)
      .where(and(
        eq(participants.activityId, activityId),
        eq(participants.userId, userId),
      ))
      .limit(1);

    if (!participant || participant.status === 'quit') {
      throw new Error('您未报名此活动');
    }

    const now = new Date();

    await tx
      .update(participants)
      .set({
        status: 'quit',
        joinedAt: null,
        updatedAt: now,
      })
      .where(eq(participants.id, participant.id));

    if (participant.status === 'joined') {
      await tx
        .update(activities)
        .set({
          currentParticipants: sql<number>`GREATEST(0, ${activities.currentParticipants} - 1)`,
          updatedAt: now,
        })
        .where(eq(activities.id, activityId));
    }
  });
}

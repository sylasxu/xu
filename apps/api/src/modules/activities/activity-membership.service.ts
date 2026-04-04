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
} from '@juchang/db';
import {
  notifyJoin,
  notifyNewParticipant,
} from '../notifications/notification.service';

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

export async function joinActivity(activityId: string, userId: string): Promise<{ id: string }> {
  let participantId = '';
  let shouldNotify = false;
  let creatorId = '';
  let activityTitle = '';
  let joinerName = '新成员';

  try {
    await db.transaction(async (tx) => {
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
        throw new Error('活动不在招募中');
      }

      if (activity.creatorId === userId) {
        throw new Error('不能报名自己创建的活动');
      }

      if (activity.startAt <= new Date()) {
        throw new Error('活动已经开始了，不能报名了');
      }

      if (activity.currentParticipants >= activity.maxParticipants) {
        throw new Error('活动人数已满');
      }

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
          throw new Error('您已报名此活动');
        }

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
        shouldNotify = true;
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
        throw new Error('活动人数已满');
      }

      creatorId = activity.creatorId;
      activityTitle = activity.title;
      joinerName = joiningUser.nickname || '新成员';
    });
  } catch (error) {
    throw new Error(getJoinActivityErrorMessage(error));
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

    db.insert(activityMessages).values({
      activityId,
      senderId: null,
      messageType: 'system',
      content: `${joinerName} 刚刚加入了！`,
    }).catch((error) => console.error('Failed to send join system message:', error));

    notifyNewParticipant(
      activityId,
      activityTitle,
      joinerName,
      userId,
      creatorId
    ).catch((error) => console.error('Failed to notify participants:', error));
  }

  import('../hot-keywords/hot-keywords.service').then(({ trackConversion }) => {
    trackConversion(userId).catch((error) => {
      console.error('Failed to track keyword conversion:', error);
    });
  });

  return { id: participantId };
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
      .select({ id: participants.id })
      .from(participants)
      .where(and(
        eq(participants.activityId, activityId),
        eq(participants.userId, userId),
        eq(participants.status, 'joined')
      ))
      .limit(1);

    if (!participant) {
      throw new Error('您未报名此活动');
    }

    const now = new Date();

    await tx
      .update(participants)
      .set({
        status: 'quit',
        updatedAt: now,
      })
      .where(eq(participants.id, participant.id));

    await tx
      .update(activities)
      .set({
        currentParticipants: sql<number>`GREATEST(1, ${activities.currentParticipants} - 1)`,
        updatedAt: now,
      })
      .where(eq(activities.id, activityId));
  });
}

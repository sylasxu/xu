// Activity Command Service - 写入侧业务逻辑
import {
  db,
  activities,
  users,
  participants,
  activityMessages,
  eq,
  sql,
  and,
} from '@juchang/db';
import type { CreateActivityRequest } from './activity.model';
import { deductAiCreateQuota } from '../users/user.service';
import { indexActivity, deleteIndex } from '../ai/rag';
import { validateFields } from '../content-security';
import { ACTIVITY_TYPE_THEME_MAP, PRESET_THEMES } from './theme-presets';
import {
  notifyCompleted,
  notifyCancelled,
} from '../notifications/notification.service';

async function getActivityRowForRag(activityId: string) {
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  return activity ?? null;
}

function buildActivityLocationPoint(location: [number, number]) {
  return sql`ST_SetSRID(ST_MakePoint(${location[0]}, ${location[1]}), 4326)`;
}

function resolveActivityStartAt(startAt: string): Date {
  const startAtDate = new Date(startAt);
  if (startAtDate < new Date()) {
    throw new Error('活动开始时间不能是过去');
  }

  return startAtDate;
}

async function validateActivityContent(
  payload: {
    title?: string;
    description?: string | null;
    locationName?: string;
    locationHint?: string;
  },
  userId: string
): Promise<void> {
  const securityResult = await validateFields(
    {
      title: payload.title,
      description: payload.description,
      locationName: payload.locationName,
      locationHint: payload.locationHint,
    },
    { userId, scene: 'activity' }
  );

  if (!securityResult.pass) {
    throw new Error('内容包含违规信息，请修改后重试');
  }
}

export async function createDraftActivity(
  data: CreateActivityRequest,
  creatorId: string
): Promise<{ id: string }> {
  const { location, startAt, maxParticipants = 4, ...activityData } = data;
  const startAtDate = resolveActivityStartAt(startAt);

  await validateActivityContent(
    {
      title: activityData.title,
      description: activityData.description ?? null,
      locationName: activityData.locationName,
      locationHint: activityData.locationHint,
    },
    creatorId
  );

  const themeName = ACTIVITY_TYPE_THEME_MAP[activityData.type] || 'minimal';
  const themeConfig = PRESET_THEMES[themeName] || PRESET_THEMES.minimal;

  let draftActivityId = '';

  await db.transaction(async (tx) => {
    const [newActivity] = await tx
      .insert(activities)
      .values({
        ...activityData,
        creatorId,
        location: buildActivityLocationPoint(location),
        startAt: startAtDate,
        maxParticipants,
        currentParticipants: 1,
        status: 'draft',
        theme: themeName,
        themeConfig,
      })
      .returning({ id: activities.id });

    await tx
      .insert(participants)
      .values({
        activityId: newActivity.id,
        userId: creatorId,
        status: 'joined',
      });

    draftActivityId = newActivity.id;
  });

  return { id: draftActivityId };
}

export async function createActivity(
  data: CreateActivityRequest,
  creatorId: string
): Promise<{ id: string }> {
  const [creator] = await db
    .select({ phoneNumber: users.phoneNumber })
    .from(users)
    .where(eq(users.id, creatorId))
    .limit(1);

  if (!creator?.phoneNumber) {
    throw new Error('请先绑定手机号才能发布活动');
  }

  const { location, startAt, maxParticipants = 4, ...activityData } = data;
  const startAtDate = resolveActivityStartAt(startAt);

  await validateActivityContent(
    {
      title: activityData.title,
      description: activityData.description ?? null,
      locationName: activityData.locationName,
      locationHint: activityData.locationHint,
    },
    creatorId
  );

  let newActivityId = '';

  await db.transaction(async (tx) => {
    const hasQuota = await deductAiCreateQuota(creatorId, tx);
    if (!hasQuota) {
      throw new Error('今日发布额度已用完');
    }

    const [newActivity] = await tx
      .insert(activities)
      .values({
        ...activityData,
        creatorId,
        location: buildActivityLocationPoint(location),
        startAt: startAtDate,
        maxParticipants,
        currentParticipants: 1,
        status: 'active',
      })
      .returning({ id: activities.id });

    await tx
      .insert(participants)
      .values({
        activityId: newActivity.id,
        userId: creatorId,
        status: 'joined',
      });

    await tx
      .update(users)
      .set({
        activitiesCreatedCount: sql`${users.activitiesCreatedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, creatorId));

    newActivityId = newActivity.id;
  });

  const activityForIndex = await getActivityRowForRag(newActivityId);
  if (activityForIndex) {
    indexActivity(activityForIndex).catch((error) => {
      console.error('Failed to index activity:', error);
    });
  }

  (async () => {
    try {
      const { trackConversion } = await import('../hot-keywords/hot-keywords.service');
      await trackConversion(creatorId);
    } catch (error) {
      console.error('Failed to track keyword conversion:', error);
    }
  })();

  return { id: newActivityId };
}

export async function publishDraftActivity(
  activityId: string,
  creatorId: string,
  updates?: Partial<CreateActivityRequest>
): Promise<{ id: string }> {
  const [creator] = await db
    .select({ phoneNumber: users.phoneNumber })
    .from(users)
    .where(eq(users.id, creatorId))
    .limit(1);

  if (!creator?.phoneNumber) {
    throw new Error('请先绑定手机号才能发布活动');
  }

  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  if (activity.creatorId !== creatorId) {
    throw new Error('只有活动发起人可以发布活动');
  }

  if (activity.status !== 'draft') {
    throw new Error('只有草稿状态的活动可以发布');
  }

  const startAt = updates?.startAt ? new Date(updates.startAt) : activity.startAt;
  if (startAt < new Date()) {
    throw new Error('活动时间已过期，请重新创建');
  }

  const updateData: Record<string, unknown> = {
    status: 'active',
    updatedAt: new Date(),
  };

  if (updates) {
    if (updates.title) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.startAt) updateData.startAt = new Date(updates.startAt);
    if (updates.location) {
      updateData.location = buildActivityLocationPoint(updates.location);
    }
    if (updates.locationName) updateData.locationName = updates.locationName;
    if (updates.address !== undefined) updateData.address = updates.address;
    if (updates.locationHint) updateData.locationHint = updates.locationHint;
    if (updates.type) updateData.type = updates.type;
    if (updates.maxParticipants) updateData.maxParticipants = updates.maxParticipants;

    await validateActivityContent(
      {
        title: updates.title,
        description: updates.description ?? null,
        locationName: updates.locationName,
        locationHint: updates.locationHint,
      },
      creatorId
    );
  }

  await db.transaction(async (tx) => {
    const hasQuota = await deductAiCreateQuota(creatorId, tx);
    if (!hasQuota) {
      throw new Error('今日发布额度已用完');
    }

    await tx
      .update(activities)
      .set(updateData)
      .where(eq(activities.id, activityId));

    await tx
      .update(users)
      .set({
        activitiesCreatedCount: sql`${users.activitiesCreatedCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, creatorId));
  });

  const activityForIndex = await getActivityRowForRag(activityId);
  if (activityForIndex) {
    indexActivity(activityForIndex).catch((error) => {
      console.error('Failed to index activity:', error);
    });
  }

  (async () => {
    try {
      const { trackConversion } = await import('../hot-keywords/hot-keywords.service');
      await trackConversion(creatorId);
    } catch (error) {
      console.error('Failed to track keyword conversion:', error);
    }
  })();

  return { id: activityId };
}

export async function updateActivityStatus(
  activityId: string,
  userId: string,
  status: 'completed' | 'cancelled'
): Promise<void> {
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  if (activity.creatorId !== userId) {
    throw new Error('只有活动发起人可以更新状态');
  }

  if (activity.status !== 'active') {
    throw new Error('只有进行中的活动可以更新状态');
  }

  const now = new Date();
  const joinedParticipants = await db
    .select({ userId: participants.userId })
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.status, 'joined'),
    ));

  const systemMessage = status === 'completed'
    ? `活动「${activity.title}」已确认成局，接下来记得确认到场情况。`
    : `活动「${activity.title}」已取消。`;

  await db.transaction(async (tx) => {
    await tx
      .update(activities)
      .set({
        status,
        updatedAt: now,
      })
      .where(eq(activities.id, activityId));

    await tx.insert(activityMessages).values({
      activityId,
      senderId: null,
      messageType: 'system',
      content: systemMessage,
      createdAt: now,
    });
  });

  const recipients = joinedParticipants
    .map((item) => item.userId)
    .filter((participantUserId) => participantUserId !== userId);

  const notifier = status === 'completed' ? notifyCompleted : notifyCancelled;
  const results = await Promise.allSettled(
    recipients.map((participantUserId) => notifier(participantUserId, activityId, activity.title))
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`[ActivityStatus] Failed to notify ${status}:`, result.reason);
    }
  }
}

export async function deleteActivity(activityId: string, userId: string): Promise<void> {
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  if (activity.creatorId !== userId) {
    throw new Error('只有活动发起人可以删除活动');
  }

  if (activity.status !== 'active') {
    throw new Error('只有进行中的活动可以删除');
  }

  if (new Date() >= activity.startAt) {
    throw new Error('活动已开始，无法删除');
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(activityMessages)
      .where(eq(activityMessages.activityId, activityId));

    await tx
      .delete(participants)
      .where(eq(participants.activityId, activityId));

    await tx
      .delete(activities)
      .where(eq(activities.id, activityId));
  });

  deleteIndex(activityId).catch((error) => {
    console.error('Failed to delete activity index:', error);
  });
}

export async function updateActivity(
  activityId: string,
  userId: string,
  updates: Partial<CreateActivityRequest>
): Promise<void> {
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  if (activity.creatorId !== userId) {
    throw new Error('只有活动发起人可以更新活动');
  }

  if (activity.status !== 'draft' && activity.status !== 'active') {
    throw new Error('只有草稿或进行中的活动可以更新');
  }

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.title !== undefined) updateData.title = updates.title;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.type !== undefined) updateData.type = updates.type;
  if (updates.locationName !== undefined) updateData.locationName = updates.locationName;
  if (updates.address !== undefined) updateData.address = updates.address;
  if (updates.locationHint !== undefined) updateData.locationHint = updates.locationHint;
  if (updates.maxParticipants !== undefined) updateData.maxParticipants = updates.maxParticipants;

  if (updates.startAt !== undefined) {
    updateData.startAt = resolveActivityStartAt(updates.startAt);
  }

  if (updates.location !== undefined) {
    updateData.location = buildActivityLocationPoint(updates.location);
  }

  await validateActivityContent(
    {
      title: updates.title,
      description: updates.description ?? null,
      locationName: updates.locationName,
      locationHint: updates.locationHint,
    },
    userId
  );

  await db
    .update(activities)
    .set(updateData)
    .where(eq(activities.id, activityId));

  const semanticFields = ['title', 'description', 'type', 'startAt'];
  const needsReindex = semanticFields.some((field) => field in updates);

  if (needsReindex) {
    const activityForIndex = await getActivityRowForRag(activityId);
    if (activityForIndex) {
      indexActivity(activityForIndex).catch((error) => {
        console.error('Failed to re-index activity:', error);
      });
    }
  }
}

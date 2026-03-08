// Participant Service - 参与者辅助功能 (MVP 简化版)
// 主要逻辑已移到 activities 模块
import { db, participants, users, activities, activityMessages, eq, and, inArray } from '@juchang/db';
import {
  addInterestVector,
  markActivityOutcomeRebookTriggered,
  upsertActivityOutcomeMemory,
} from '../ai/memory';
import type {
  ActionResponse,
  ParticipantInfo,
  ConfirmFulfillmentRequest,
  ConfirmFulfillmentResponse,
} from './participant.model';

/**
 * 获取活动的参与者列表
 */
export async function getActivityParticipants(activityId: string): Promise<ParticipantInfo[]> {
  const participantsList = await db
    .select({
      id: participants.id,
      userId: participants.userId,
      status: participants.status,
      joinedAt: participants.joinedAt,
      user: {
        id: users.id,
        nickname: users.nickname,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .where(eq(participants.activityId, activityId));

  return participantsList.map((participant) => ({
    id: participant.id,
    userId: participant.userId,
    status: participant.status,
    joinedAt: participant.joinedAt?.toISOString() || null,
    user: participant.user || null,
  }));
}

/**
 * 发起人提交履约确认
 * - 仅活动发起人可提交
 * - 仅允许确认当前 joined 参与者
 * - 未到场参与者会被标记为 quit
 */
export async function confirmActivityFulfillment(
  creatorId: string,
  payload: ConfirmFulfillmentRequest
): Promise<ConfirmFulfillmentResponse> {
  const { activityId, participants: confirmations } = payload;

  const [activity] = await db
    .select({
      id: activities.id,
      creatorId: activities.creatorId,
      title: activities.title,
      status: activities.status,
      type: activities.type,
      locationName: activities.locationName,
      startAt: activities.startAt,
      embedding: activities.embedding,
    })
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  if (activity.creatorId !== creatorId) {
    throw new Error('只有活动发起人可以确认履约');
  }

  if (activity.status !== 'completed') {
    throw new Error('请先将活动标记为已完成后再确认履约');
  }

  const joinedParticipants = await db
    .select({
      userId: participants.userId,
    })
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.status, 'joined'),
    ));

  if (joinedParticipants.length === 0) {
    throw new Error('当前活动暂无可确认的参与者');
  }

  const joinedUserIdSet = new Set(joinedParticipants.map((item) => item.userId));
  const submittedUserIdSet = new Set<string>();

  for (const item of confirmations) {
    if (!joinedUserIdSet.has(item.userId)) {
      throw new Error('提交中包含非已报名参与者');
    }
    if (submittedUserIdSet.has(item.userId)) {
      throw new Error('提交中存在重复参与者');
    }
    submittedUserIdSet.add(item.userId);
  }

  if (submittedUserIdSet.size !== joinedUserIdSet.size) {
    throw new Error('请完成所有已报名参与者的履约确认后再提交');
  }

  const noShowUserIds = confirmations
    .filter((item) => !item.fulfilled)
    .map((item) => item.userId);

  const attendedCount = confirmations.length - noShowUserIds.length;
  const noShowCount = noShowUserIds.length;
  const currentParticipants = Math.max(1, attendedCount + 1);
  const now = new Date();

  await db.transaction(async (tx) => {
    if (noShowUserIds.length > 0) {
      await tx
        .update(participants)
        .set({
          status: 'quit',
          updatedAt: now,
        })
        .where(and(
          eq(participants.activityId, activityId),
          eq(participants.status, 'joined'),
          inArray(participants.userId, noShowUserIds),
        ));
    }

    await tx
      .update(activities)
      .set({
        currentParticipants,
        updatedAt: now,
      })
      .where(eq(activities.id, activityId));

    const summary = noShowCount > 0
      ? `活动「${activity.title}」履约确认完成：到场 ${attendedCount} 人，未到场 ${noShowCount} 人。`
      : `活动「${activity.title}」履约确认完成：全部 ${attendedCount} 人到场。`;

    await tx.insert(activityMessages).values({
      activityId,
      senderId: null,
      messageType: 'system',
      content: summary,
      createdAt: now,
    });
  });

  const outcomeSummary = noShowCount > 0
    ? `真实履约结果：发起人已到场，成员到场 ${attendedCount} 人，未到场 ${noShowCount} 人。`
    : `真实履约结果：发起人已到场，成员全部 ${attendedCount} 人到场。`;

  const memoryTasks: Promise<unknown>[] = [
    upsertActivityOutcomeMemory(creatorId, {
      activityId,
      activityTitle: activity.title,
      activityType: activity.type,
      locationName: activity.locationName,
      attended: true,
      rebookTriggered: false,
      reviewSummary: outcomeSummary,
      happenedAt: activity.startAt,
      updatedAt: now,
    }),
    ...confirmations.map((item) => upsertActivityOutcomeMemory(item.userId, {
      activityId,
      activityTitle: activity.title,
      activityType: activity.type,
      locationName: activity.locationName,
      attended: item.fulfilled,
      rebookTriggered: false,
      reviewSummary: outcomeSummary,
      happenedAt: activity.startAt,
      updatedAt: now,
    })),
  ];

  if (activity.embedding) {
    memoryTasks.push(
      addInterestVector(creatorId, {
        activityId,
        embedding: activity.embedding,
        participatedAt: activity.startAt,
        feedback: 'positive',
      }),
    );

    for (const item of confirmations) {
      if (!item.fulfilled) {
        continue;
      }
      memoryTasks.push(
        addInterestVector(item.userId, {
          activityId,
          embedding: activity.embedding,
          participatedAt: activity.startAt,
          feedback: 'positive',
        }),
      );
    }
  }

  const results = await Promise.allSettled(memoryTasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('写入活动结果 memory 失败:', result.reason);
    }
  }

  return {
    activityId,
    attendedCount,
    noShowCount,
    totalSubmitted: confirmations.length,
    msg: '履约确认提交成功',
  };
}

export async function markActivityRebookFollowUp(
  userId: string,
  activityId: string,
): Promise<ActionResponse> {
  const [activity] = await db
    .select({
      id: activities.id,
      creatorId: activities.creatorId,
      title: activities.title,
      type: activities.type,
      locationName: activities.locationName,
      startAt: activities.startAt,
      status: activities.status,
    })
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  if (activity.status !== 'completed') {
    throw new Error('只有已结束的活动才能标记再约');
  }

  const [participantRecord] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.userId, userId),
    ))
    .limit(1);

  if (activity.creatorId !== userId && !participantRecord) {
    throw new Error('只有活动发起人或参与成员可以标记再约');
  }

  await markActivityOutcomeRebookTriggered(userId, {
    activityId,
    activityTitle: activity.title,
    activityType: activity.type,
    locationName: activity.locationName,
    happenedAt: activity.startAt,
  });

  return {
    code: 200,
    msg: '已记录这次再约意愿，后续推荐会更懂你',
  };
}

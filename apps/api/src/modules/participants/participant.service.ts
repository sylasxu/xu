// Participant Service - 参与者辅助功能 (MVP 简化版)
// 主要逻辑已移到 activities 模块
import { db, participants, users, activities, activityMessages, eq, and, inArray } from '@xu/db';
import {
  addInterestVector,
  clearInterestVectorForActivity,
  markActivityOutcomeRebookTriggered,
  upsertActivityOutcomeMemory,
} from '../ai/memory';
import {
  recordJoinTaskFulfillmentOutcome,
  recordJoinTaskRebookOutcome,
  recordJoinTaskReviewOutcome,
} from '../ai/task-runtime/agent-task.service';
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

  const taskOutcomeTasks: Promise<void>[] = [
    recordJoinTaskFulfillmentOutcome({
      userId: creatorId,
      activityId,
      attended: true,
      summary: outcomeSummary,
    }),
    ...confirmations.map((item) => recordJoinTaskFulfillmentOutcome({
      userId: item.userId,
      activityId,
      attended: item.fulfilled,
      summary: outcomeSummary,
    })),
  ];

  const taskOutcomeResults = await Promise.allSettled(taskOutcomeTasks);
  for (const result of taskOutcomeResults) {
    if (result.status === 'rejected') {
      console.error('写入 agent task outcome 失败:', result.reason);
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

async function getActivityOutcomeContext(userId: string, activityId: string) {
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

  return activity;
}

export async function markActivityRebookFollowUp(
  userId: string,
  activityId: string,
): Promise<ActionResponse> {
  const activity = await getActivityOutcomeContext(userId, activityId);

  await markActivityOutcomeRebookTriggered(userId, {
    activityId,
    activityTitle: activity.title,
    activityType: activity.type,
    locationName: activity.locationName,
    happenedAt: activity.startAt,
  });

  await recordJoinTaskRebookOutcome({
    userId,
    activityId,
  });

  return {
    code: 200,
    msg: '已记录这次再约意愿，后续推荐会更懂你',
  };
}

export type ActivityFeedbackValue = 'positive' | 'neutral' | 'failed';

function buildActivityFeedbackSummary(activityTitle: string, feedback: ActivityFeedbackValue, reviewSummary?: string): string {
  const normalizedReview = reviewSummary?.trim();
  if (normalizedReview) {
    return normalizedReview;
  }

  switch (feedback) {
    case 'positive':
      return `用户反馈：这次「${activityTitle}」挺顺利。`;
    case 'neutral':
      return `用户反馈：这次「${activityTitle}」一般，需要后续再优化。`;
    case 'failed':
      return `用户反馈：这次「${activityTitle}」没成局。`;
  }
}

function buildActivityOutcomeNextAction(params: {
  activityTitle: string;
  activityId: string;
  activityType: string;
  locationName: string;
  feedback: ActivityFeedbackValue;
  reviewSummary?: string;
}): ActionResponse['nextAction'] {
  const activityHint = `「${params.activityTitle}」`;
  const activityRef = `（activityId: ${params.activityId}）`;
  const placeHint = params.locationName.trim() ? `地点先参考${params.locationName}，` : '';
  const typeHint = params.activityType.trim() ? `类型先沿用${params.activityType}，` : '';
  const reviewHint = params.reviewSummary?.trim()
    ? `这次反馈是：${params.reviewSummary.trim()}。`
    : '';

  if (params.feedback === 'positive') {
    return {
      label: '顺着这次再约',
      prompt: `这次${activityHint}${activityRef}挺顺利，${typeHint}${placeHint}${reviewHint}帮我顺着这次体验快速再约一场：给一个新时间建议、一个更容易成局的人数安排，并生成一段可直接发出去的邀约文案。`,
      activityMode: 'rebook',
      entry: 'post_activity_feedback_next_action',
    };
  }

  if (params.feedback === 'neutral') {
    return {
      label: '复盘哪里能改',
      prompt: `这次${activityHint}${activityRef}体验一般，${typeHint}${placeHint}${reviewHint}帮我复盘：哪里卡住了、下次怎么改、如果要再组一场应该调整哪些条件。`,
      activityMode: 'review',
      entry: 'post_activity_feedback_next_action',
    };
  }

  return {
    label: '换个方式再组',
    prompt: `这次${activityHint}${activityRef}没成局，${typeHint}${placeHint}${reviewHint}帮我换个推进方式：分析可能原因，给一个更容易成局的新方案，并写一段不尴尬的重新邀约文案。`,
    activityMode: 'review',
    entry: 'post_activity_feedback_next_action',
  };
}

export async function recordActivitySelfFeedback(params: {
  userId: string;
  activityId: string;
  feedback: ActivityFeedbackValue;
  reviewSummary?: string;
}): Promise<ActionResponse> {
  const [activity] = await db
    .select({
      id: activities.id,
      creatorId: activities.creatorId,
      title: activities.title,
      type: activities.type,
      locationName: activities.locationName,
      startAt: activities.startAt,
      status: activities.status,
      embedding: activities.embedding,
    })
    .from(activities)
    .where(eq(activities.id, params.activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  const [participantRecord] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(and(
      eq(participants.activityId, params.activityId),
      eq(participants.userId, params.userId),
    ))
    .limit(1);

  if (activity.creatorId !== params.userId && !participantRecord) {
    throw new Error('只有活动发起人或参与成员可以记录这次反馈');
  }

  if (activity.status !== 'completed' && activity.startAt > new Date()) {
    throw new Error('活动还没开始，结束后再来记录反馈吧');
  }

  const summary = buildActivityFeedbackSummary(activity.title, params.feedback, params.reviewSummary);
  const attended = params.feedback === 'failed' ? false : true;
  const vectorFeedback = params.feedback === 'failed' ? 'negative' : params.feedback;
  const now = new Date();

  await upsertActivityOutcomeMemory(params.userId, {
    activityId: params.activityId,
    activityTitle: activity.title,
    activityType: activity.type,
    locationName: activity.locationName,
    attended,
    rebookTriggered: false,
    reviewSummary: summary,
    happenedAt: activity.startAt,
    updatedAt: now,
  });

  if (params.feedback === 'positive' && activity.embedding) {
    await addInterestVector(params.userId, {
      activityId: params.activityId,
      embedding: activity.embedding,
      participatedAt: activity.startAt,
      feedback: 'positive',
    });
  } else {
    await clearInterestVectorForActivity(params.userId, params.activityId, vectorFeedback);
  }

  await recordJoinTaskFulfillmentOutcome({
    userId: params.userId,
    activityId: params.activityId,
    attended,
    summary,
  });

  console.info('[NotificationFunnel]', {
    step: 'acted',
    scene: 'post_activity',
    userId: params.userId,
    activityId: params.activityId,
    detail: {
      feedback: params.feedback,
      attended,
    },
  });

  return {
    code: 200,
    msg: params.feedback === 'positive'
      ? '已记下这次顺利成局，后面会按这个方向推荐'
      : params.feedback === 'neutral'
        ? '已记下这次体验一般，后面会帮你避开类似问题'
        : '已记下这次没成局，后面会帮你换个推进方式',
    nextAction: buildActivityOutcomeNextAction({
      activityTitle: activity.title,
      activityId: params.activityId,
      activityType: activity.type,
      locationName: activity.locationName,
      feedback: params.feedback,
      reviewSummary: summary,
    }),
  };
}

export async function saveActivityReviewSummary(
  userId: string,
  activityId: string,
  reviewSummary: string,
): Promise<void> {
  const normalizedSummary = reviewSummary.trim();
  if (!normalizedSummary) {
    return;
  }

  const activity = await getActivityOutcomeContext(userId, activityId);

  await upsertActivityOutcomeMemory(userId, {
    activityId,
    activityTitle: activity.title,
    activityType: activity.type,
    locationName: activity.locationName,
    attended: null,
    reviewSummary: normalizedSummary,
    happenedAt: activity.startAt,
  });

  await recordJoinTaskReviewOutcome({
    userId,
    activityId,
    reviewSummary: normalizedSummary,
  });
}

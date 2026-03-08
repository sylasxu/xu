/**
 * v5.0: Post-Activity 自动完成任务
 * 
 * 逻辑：活动 startAt + 2h 后，自动将 active → completed，并推送反馈通知
 * 执行频率：每 5 分钟
 */

import { db, activities, activityMessages, eq, and, sql, toTimestamp } from '@juchang/db';
import { notifyPostActivity } from '../modules/notifications/notification.service';
import { jobLogger } from '../lib/logger';

export async function processPostActivity(): Promise<void> {
  const now = new Date();

  // 查找 startAt + 2h < now 且仍为 active 的活动
  const expiredActivities = await db
    .select({ id: activities.id, title: activities.title })
    .from(activities)
    .where(and(
      eq(activities.status, 'active'),
      sql`${activities.startAt} + interval '2 hours' < ${toTimestamp(now)}`,
    ));

  let completed = 0;
  for (const activity of expiredActivities) {
    await db.transaction(async (tx) => {
      await tx.update(activities)
        .set({ status: 'completed', updatedAt: now })
        .where(eq(activities.id, activity.id));

      await tx.insert(activityMessages).values({
        activityId: activity.id,
        senderId: null,
        messageType: 'system',
        content: `活动「${activity.title}」已自动结束，来确认一下这局玩得怎么样。`,
        createdAt: now,
      });
    });

    notifyPostActivity(activity.id, activity.title).catch((err: unknown) => {
      console.error(`Failed to notify post-activity for ${activity.id}:`, err);
    });

    completed++;
  }

  jobLogger.jobStats('Post-Activity 自动完成', completed, 0);
}

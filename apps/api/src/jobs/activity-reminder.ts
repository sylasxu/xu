/**
 * v5.0: 活动前 1 小时提醒任务
 * 
 * 逻辑：startAt - 1h < now < startAt 且 active 的活动，发送提醒
 * 执行频率：每 5 分钟
 * 
 * 防重复：使用 notifications 表查询是否已发送过该活动的 activity_reminder
 */

import { db, activities, notifications, eq, and, sql, gt, toTimestamp } from '@xu/db';
import { notifyActivityReminder } from '../modules/notifications/notification.service';
import { jobLogger } from '../lib/logger';

export async function processActivityReminder(): Promise<void> {
  const now = new Date();

  // 查找 startAt - 1h < now < startAt 且 active 的活动
  const upcomingActivities = await db
    .select({
      id: activities.id,
      title: activities.title,
      locationName: activities.locationName,
    })
    .from(activities)
    .where(and(
      eq(activities.status, 'active'),
      sql`${activities.startAt} - interval '1 hour' < ${toTimestamp(now)}`,
      gt(activities.startAt, now),
    ));

  let reminded = 0;
  for (const activity of upcomingActivities) {
    // 防重复：检查是否已发送过该活动的 activity_reminder
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.activityId, activity.id),
        eq(notifications.type, 'activity_reminder'),
      ))
      .limit(1);

    if (existing) continue;

    notifyActivityReminder(activity.id, activity.title, activity.locationName).catch((err: unknown) => {
      console.error(`Failed to send reminder for ${activity.id}:`, err);
    });
    reminded++;
  }

  jobLogger.jobStats('活动前提醒', reminded, 0);
}

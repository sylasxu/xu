// Notification Service - MVP 简化版 + Admin 扩展
import { db, notifications, users, participants, eq, count, and, desc } from '@juchang/db';
import type { NotificationListQuery, NotificationListResponse, UnreadCountResponse } from './notification.model';

// 通知类型枚举值
const NOTIFICATION_TYPES = ['join', 'quit', 'activity_start', 'completed', 'cancelled', 'new_participant', 'post_activity', 'activity_reminder'] as const;
type NotificationType = typeof NOTIFICATION_TYPES[number];

/** 类型守卫：检查是否为有效的通知类型 */
function isNotificationType(value: string): value is NotificationType {
  return NOTIFICATION_TYPES.includes(value as NotificationType);
}

/**
 * 获取用户通知列表（用户模式）
 */
export async function getNotifications(
  userId: string,
  query: NotificationListQuery
): Promise<NotificationListResponse> {
  const { page = 1, limit = 20, type } = query;
  const offset = (page - 1) * limit;

  // 构建查询条件
  const conditions = [eq(notifications.userId, userId)];
  if (type && isNotificationType(type)) {
    conditions.push(eq(notifications.type, type));
  }

  const [data, totalResult] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(notifications.createdAt)),
    db
      .select({ count: count() })
      .from(notifications)
      .where(and(...conditions)),
  ]);

  const total = totalResult[0]?.count || 0;
  const totalPages = Math.ceil(total / limit);

  return { data, total, page, totalPages };
}

/**
 * 获取所有用户的通知列表（Admin 模式）
 */
export async function getAllNotifications(
  query: NotificationListQuery
): Promise<NotificationListResponse & { data: Array<any> }> {
  const { page = 1, limit = 20, type } = query;
  const offset = (page - 1) * limit;

  // 构建查询条件
  const conditions = [];
  if (type && isNotificationType(type)) {
    conditions.push(eq(notifications.type, type));
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  // 查询通知列表（包含用户信息）
  const [data, totalResult] = await Promise.all([
    db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        type: notifications.type,
        title: notifications.title,
        content: notifications.content,
        isRead: notifications.isRead,
        activityId: notifications.activityId,
        notificationMethod: notifications.notificationMethod,
        createdAt: notifications.createdAt,
        userNickname: users.nickname,
        userAvatarUrl: users.avatarUrl,
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.userId, users.id))
      .where(whereCondition)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(notifications.createdAt)),
    db
      .select({ count: count() })
      .from(notifications)
      .where(whereCondition),
  ]);

  const total = totalResult[0]?.count || 0;
  const totalPages = Math.ceil(total / limit);

  return { data, total, page, totalPages };
}

/**
 * 获取指定用户的通知列表（Admin 查指定用户）
 */
export async function getNotificationsByUserId(
  targetUserId: string,
  query: NotificationListQuery
): Promise<NotificationListResponse & { data: Array<any> }> {
  const { page = 1, limit = 20, type } = query;
  const offset = (page - 1) * limit;

  // 构建查询条件
  const conditions = [eq(notifications.userId, targetUserId)];
  if (type && isNotificationType(type)) {
    conditions.push(eq(notifications.type, type));
  }

  // 查询通知列表（包含用户信息）
  const [data, totalResult] = await Promise.all([
    db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        type: notifications.type,
        title: notifications.title,
        content: notifications.content,
        isRead: notifications.isRead,
        activityId: notifications.activityId,
        notificationMethod: notifications.notificationMethod,
        createdAt: notifications.createdAt,
        userNickname: users.nickname,
        userAvatarUrl: users.avatarUrl,
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.userId, users.id))
      .where(and(...conditions))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(notifications.createdAt)),
    db
      .select({ count: count() })
      .from(notifications)
      .where(and(...conditions)),
  ]);

  const total = totalResult[0]?.count || 0;
  const totalPages = Math.ceil(total / limit);

  return { data, total, page, totalPages };
}

/**
 * 标记通知为已读
 */
export async function markAsRead(id: string, userId: string): Promise<boolean> {
  const [updated] = await db
    .update(notifications)
    .set({
      isRead: true,
    })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning();

  return !!updated;
}

/**
 * 获取未读通知数量
 */
export async function getUnreadCount(userId: string): Promise<UnreadCountResponse> {
  const [result] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  return { count: result?.count || 0 };
}

// ==========================================
// 内部调用：创建通知
// DB 枚举类型: join, quit, activity_start, completed, cancelled
// ==========================================

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  content?: string;
  activityId?: string;
}

/**
 * 创建通知（内部调用）
 */
export async function createNotification(params: CreateNotificationParams) {
  const { userId, type, title, content, activityId } = params;

  const [notification] = await db
    .insert(notifications)
    .values({
      userId,
      type,
      title,
      content: content || null,
      activityId: activityId || null,
      isRead: false,
    })
    .returning();

  return notification;
}

/**
 * 创建加入通知 - 有人报名活动
 */
export async function notifyJoin(
  organizerId: string,
  activityId: string,
  activityTitle: string,
  applicantName: string
) {
  return createNotification({
    userId: organizerId,
    type: 'join',
    title: '新成员加入',
    content: `${applicantName} 加入了「${activityTitle}」`,
    activityId,
  });
}

/**
 * 创建退出通知 - 有人退出活动
 */
export async function notifyQuit(
  organizerId: string,
  activityId: string,
  activityTitle: string,
  memberName: string
) {
  return createNotification({
    userId: organizerId,
    type: 'quit',
    title: '成员退出',
    content: `${memberName} 退出了「${activityTitle}」`,
    activityId,
  });
}

/**
 * 创建活动即将开始通知
 */
export async function notifyActivityStart(
  userId: string,
  activityId: string,
  activityTitle: string
) {
  return createNotification({
    userId,
    type: 'activity_start',
    title: '活动即将开始',
    content: `「${activityTitle}」即将开始`,
    activityId,
  });
}

/**
 * 创建活动成局通知
 */
export async function notifyCompleted(
  userId: string,
  activityId: string,
  activityTitle: string
) {
  return createNotification({
    userId,
    type: 'completed',
    title: '活动成局',
    content: `「${activityTitle}」已成局`,
    activityId,
  });
}

/**
 * 创建活动取消通知
 */
export async function notifyCancelled(
  userId: string,
  activityId: string,
  activityTitle: string
) {
  return createNotification({
    userId,
    type: 'cancelled',
    title: '活动取消',
    content: `「${activityTitle}」已取消`,
    activityId,
  });
}

// ==========================================
// v5.0: 新增通知函数
// ==========================================

/**
 * v5.0: 通知所有已报名参与者有新人加入
 * 排除新加入者和创建者（创建者已通过 notifyJoin 收到通知）
 */
export async function notifyNewParticipant(
  activityId: string,
  activityTitle: string,
  newMemberName: string,
  newMemberId: string,
  creatorId: string,
) {
  const joinedParticipants = await db
    .select({ userId: participants.userId })
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.status, 'joined'),
    ));

  const excludeIds = new Set([newMemberId, creatorId]);

  for (const p of joinedParticipants) {
    if (excludeIds.has(p.userId)) continue;
    createNotification({
      userId: p.userId,
      type: 'new_participant',
      title: `${newMemberName} 也来了！`,
      content: `「${activityTitle}」又多了一位小伙伴`,
      activityId,
    }).catch(err => console.error('Failed to create new_participant notification:', err));
  }
}

/**
 * v5.0: 活动结束后反馈推送
 */
export async function notifyPostActivity(
  activityId: string,
  activityTitle: string,
) {
  const joinedParticipants = await db
    .select({ userId: participants.userId })
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.status, 'joined'),
    ));

  for (const p of joinedParticipants) {
    createNotification({
      userId: p.userId,
      type: 'post_activity',
      title: '玩得怎么样？',
      content: `「${activityTitle}」结束了，来聊聊感受吧～`,
      activityId,
    }).catch(err => console.error('Failed to create post_activity notification:', err));
  }
}

/**
 * v5.0: 活动前 1 小时提醒
 */
export async function notifyActivityReminder(
  activityId: string,
  activityTitle: string,
  locationName: string,
) {
  const joinedParticipants = await db
    .select({ userId: participants.userId })
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.status, 'joined'),
    ));

  for (const p of joinedParticipants) {
    createNotification({
      userId: p.userId,
      type: 'activity_reminder',
      title: '活动马上开始啦！',
      content: `「${activityTitle}」还有 1 小时开始，地点：${locationName}`,
      activityId,
    }).catch(err => console.error('Failed to create activity_reminder notification:', err));
  }
}

// ==========================================
// 混合通知策略 (v4.8 Chat Tool Mode)
// 简化版：只负责决策和记录，微信 API 调用由 wechat.service 处理
// ==========================================

/**
 * 决定通知策略
 * 根据 groupOpenId 选择通知方式
 */
export function decideNotificationStrategy(
  groupOpenId: string | null
): 'system_message' | 'service_notification' {
  return groupOpenId ? 'system_message' : 'service_notification';
}

// Chat Service - 群聊消息业务逻辑 (v3.3 使用 activityMessages)
import { db, activityMessages, activities, participants, users, eq, and, gt, count, desc, inArray, lt, sql } from '@xu/db';
import type {
  ChatActivitiesQuery,
  ChatActivitiesResponse,
  ChatActivityItem,
  ChatMessageResponse,
  MessageListResponse,
  MessageListQuery,
  SendMessageRequest,
} from './chat.model';
import * as pool from './connection-pool';
import { sendServiceNotificationByUserId } from '../wechat';

// 群聊归档时间：活动开始后 24 小时
const ARCHIVE_HOURS = 24;

export interface DiscussionReplySignal {
  activityId: string;
  activityTitle: string;
  lastMessage: string | null;
  lastMessageTime: string | null;
  lastMessageSenderId: string | null;
  lastMessageSenderNickname: string | null;
  unreadCount: number;
  responseNeeded: boolean;
}

function calculateIsArchived(startAt: Date): boolean {
  const archiveTime = new Date(startAt.getTime() + ARCHIVE_HOURS * 60 * 60 * 1000);
  return new Date() > archiveTime;
}

/**
 * 检查活动群聊是否已归档
 */
async function checkIsArchived(activityId: string): Promise<boolean> {
  const [activity] = await db
    .select({ startAt: activities.startAt })
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    return true; // 活动不存在视为已归档
  }

  return calculateIsArchived(activity.startAt);
}

/**
 * 检查用户是否为活动参与者
 */
async function checkIsParticipant(activityId: string, userId: string): Promise<boolean> {
  const [participant] = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.activityId, activityId),
        eq(participants.userId, userId),
        eq(participants.status, 'joined')
      )
    )
    .limit(1);

  return !!participant;
}

/**
 * 获取用户相关活动群聊列表（显式 userId）
 */
export async function getChatActivities(
  userId: string,
  query: ChatActivitiesQuery
): Promise<ChatActivitiesResponse> {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const offset = (page - 1) * limit;

  const [baseRows, totalResult] = await Promise.all([
    db
      .select({
        activityId: activities.id,
        activityTitle: activities.title,
        startAt: activities.startAt,
        participantLastReadAt: participants.lastReadAt,
        creatorAvatarUrl: users.avatarUrl,
      })
      .from(participants)
      .innerJoin(activities, eq(participants.activityId, activities.id))
      .leftJoin(users, eq(activities.creatorId, users.id))
      .where(and(
        eq(participants.userId, userId),
        eq(participants.status, 'joined')
      ))
      .orderBy(desc(activities.startAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(participants)
      .where(and(
        eq(participants.userId, userId),
        eq(participants.status, 'joined')
      )),
  ]);

  const total = totalResult[0]?.count || 0;
  const totalPages = Math.ceil(total / limit);
  if (baseRows.length === 0) {
    return { items: [], total, page, totalPages, totalUnread: 0 };
  }

  const activityIds = baseRows.map((item) => item.activityId);

  const participantCountRows = await db
    .select({
      activityId: participants.activityId,
      participantCount: count(),
    })
    .from(participants)
    .where(and(
      inArray(participants.activityId, activityIds),
      eq(participants.status, 'joined')
    ))
    .groupBy(participants.activityId);

  const participantCountMap = new Map<string, number>(
    participantCountRows.map((row) => [row.activityId, row.participantCount])
  );

  const latestMessageRows = await Promise.all(
    baseRows.map(async (row) => {
      const [latestMessageRows, latestSelfMessageRows, unreadRows] = await Promise.all([
        db
          .select({
            content: activityMessages.content,
            createdAt: activityMessages.createdAt,
            senderId: activityMessages.senderId,
            senderNickname: users.nickname,
          })
          .from(activityMessages)
          .leftJoin(users, eq(activityMessages.senderId, users.id))
          .where(eq(activityMessages.activityId, row.activityId))
          .orderBy(desc(activityMessages.createdAt))
          .limit(1),
        db
          .select({ createdAt: activityMessages.createdAt })
          .from(activityMessages)
          .where(and(
            eq(activityMessages.activityId, row.activityId),
            eq(activityMessages.senderId, userId),
          ))
          .orderBy(desc(activityMessages.createdAt))
          .limit(1),
        db
          .select({ unreadCount: count() })
          .from(activityMessages)
          .where(and(
            eq(activityMessages.activityId, row.activityId),
            gt(activityMessages.createdAt, row.participantLastReadAt),
            sql`${activityMessages.senderId} IS NULL OR ${activityMessages.senderId} <> ${userId}`
          )),
      ]);

      const latestMessage = latestMessageRows[0] || null;
      const latestSelfMessageCreatedAt = latestSelfMessageRows[0]?.createdAt || null;
      const latestMessageCreatedAt = latestMessage?.createdAt || null;
      const unreadCount = unreadRows[0]?.unreadCount || 0;
      const responseNeeded = Boolean(
        latestMessageCreatedAt
        && latestMessage?.senderId !== userId
        && (latestSelfMessageCreatedAt === null || latestSelfMessageCreatedAt < latestMessageCreatedAt)
      );

      return {
        activityId: row.activityId,
        lastMessage: latestMessage?.content || null,
        lastMessageTime: latestMessage?.createdAt?.toISOString() || null,
        lastMessageSenderId: latestMessage?.senderId || null,
        lastMessageSenderNickname: latestMessage?.senderNickname || null,
        unreadCount,
        responseNeeded,
      };
    })
  );

  const latestMessageMap = new Map<
    string,
    {
      lastMessage: string | null;
      lastMessageTime: string | null;
      lastMessageSenderId: string | null;
      lastMessageSenderNickname: string | null;
      unreadCount: number;
      responseNeeded: boolean;
    }
  >(latestMessageRows.map((item) => [item.activityId, {
    lastMessage: item.lastMessage,
    lastMessageTime: item.lastMessageTime,
    lastMessageSenderId: item.lastMessageSenderId,
    lastMessageSenderNickname: item.lastMessageSenderNickname,
    unreadCount: item.unreadCount,
    responseNeeded: item.responseNeeded,
  }]));

  let totalUnread = 0;
  const items: ChatActivityItem[] = baseRows.map((row) => {
    const latest = latestMessageMap.get(row.activityId);
    const unreadCount = latest?.unreadCount || 0;
    totalUnread += unreadCount;
    return {
      activityId: row.activityId,
      activityTitle: row.activityTitle,
      activityImage: row.creatorAvatarUrl || null,
      lastMessage: latest?.lastMessage || null,
      lastMessageTime: latest?.lastMessageTime || null,
      lastMessageSenderId: latest?.lastMessageSenderId || null,
      lastMessageSenderNickname: latest?.lastMessageSenderNickname || null,
      unreadCount,
      responseNeeded: latest?.responseNeeded || false,
      isArchived: calculateIsArchived(row.startAt),
      participantCount: participantCountMap.get(row.activityId) || 0,
    };
  });

  return { items, total, page, totalPages, totalUnread };
}

export async function getDiscussionReplySignals(params: {
  userId: string;
  limit?: number;
}): Promise<DiscussionReplySignal[]> {
  const chatActivities = await getChatActivities(params.userId, {
    userId: params.userId,
    page: 1,
    limit: Math.max(params.limit ?? 10, 1),
  });

  return chatActivities.items
    .filter((item) => !item.isArchived && item.unreadCount > 0 && item.responseNeeded)
    .map((item) => ({
      activityId: item.activityId,
      activityTitle: item.activityTitle,
      lastMessage: item.lastMessage,
      lastMessageTime: item.lastMessageTime,
      lastMessageSenderId: item.lastMessageSenderId,
      lastMessageSenderNickname: item.lastMessageSenderNickname,
      unreadCount: item.unreadCount,
      responseNeeded: item.responseNeeded,
    }))
    .sort((left, right) => {
      const leftTime = left.lastMessageTime ? new Date(left.lastMessageTime).getTime() : 0;
      const rightTime = right.lastMessageTime ? new Date(right.lastMessageTime).getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, params.limit ?? 10);
}

/**
 * 获取消息列表（轮询）
 */
export async function getMessages(
  activityId: string, 
  userId: string,
  query: MessageListQuery
): Promise<MessageListResponse> {
  // 检查用户是否为参与者
  const isParticipant = await checkIsParticipant(activityId, userId);
  if (!isParticipant) {
    throw new Error('您不是该活动的参与者');
  }

  // 检查是否已归档
  const isArchived = await checkIsArchived(activityId);

  // 构建查询条件
  const conditions = [eq(activityMessages.activityId, activityId)];

  let beforeMessageCreatedAt: Date | null = null;

  if (query.before) {
    const [beforeMessage] = await db
      .select({ createdAt: activityMessages.createdAt })
      .from(activityMessages)
      .where(eq(activityMessages.id, query.before))
      .limit(1);

    if (beforeMessage) {
      beforeMessageCreatedAt = beforeMessage.createdAt;
      conditions.push(lt(activityMessages.createdAt, beforeMessage.createdAt));
    }
  }

  // 如果提供了 since，只获取该消息之后的新消息
  if (query.since) {
    // 先获取 since 消息的创建时间
    const [sinceMessage] = await db
      .select({ createdAt: activityMessages.createdAt })
      .from(activityMessages)
      .where(eq(activityMessages.id, query.since))
      .limit(1);

    if (sinceMessage) {
      conditions.push(gt(activityMessages.createdAt, sinceMessage.createdAt));
    }
  }

  const limit = query.limit || 50;

  // 查询消息（包含发送者信息）
  const messageList = await db
    .select({
      id: activityMessages.id,
      activityId: activityMessages.activityId,
      senderId: activityMessages.senderId,
      parentId: activityMessages.parentId,
      messageType: activityMessages.messageType,
      content: activityMessages.content,
      createdAt: activityMessages.createdAt,
      senderNickname: users.nickname,
      senderAvatarUrl: users.avatarUrl,
    })
    .from(activityMessages)
    .leftJoin(users, eq(activityMessages.senderId, users.id))
    .where(and(...conditions))
    .orderBy(desc(activityMessages.createdAt))
    .limit(limit + 1);

  const hasMoreHistory = !query.since && messageList.length > limit;
  const visibleRows = hasMoreHistory ? messageList.slice(0, limit) : messageList;
  const orderedRows = visibleRows.slice().reverse();

  const messages: ChatMessageResponse[] = orderedRows.map(m => ({
    id: m.id,
    activityId: m.activityId,
    senderId: m.senderId,
    parentId: m.parentId,
    senderNickname: m.senderNickname,
    senderAvatarUrl: m.senderAvatarUrl,
    type: m.messageType,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  const latestMessageCreatedAt = orderedRows.length > 0
    ? orderedRows[orderedRows.length - 1].createdAt
    : null;
  if (latestMessageCreatedAt && !beforeMessageCreatedAt) {
    await db
      .update(participants)
      .set({
        lastReadAt: latestMessageCreatedAt,
        updatedAt: new Date(),
      })
      .where(and(
        eq(participants.activityId, activityId),
        eq(participants.userId, userId),
        eq(participants.status, 'joined')
      ));
  }

  return {
    messages,
    isArchived,
    historyCursor: hasMoreHistory ? orderedRows[0]?.id || null : null,
    hasMoreHistory,
  };
}

function toNotificationValue(value: string, maxLength = 20): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '待补充';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 1, 1))}…`;
}

async function notifyOfflineParticipantsAboutMessage(params: {
  activityId: string;
  activityTitle: string;
  senderId: string;
  senderName: string;
  content: string;
  previousLatestCreatedAt: Date | null;
}): Promise<void> {
  const recipients = await db
    .select({
      userId: participants.userId,
      lastReadAt: participants.lastReadAt,
    })
    .from(participants)
    .where(and(
      eq(participants.activityId, params.activityId),
      eq(participants.status, 'joined'),
    ));

  const offlineRecipients = recipients.filter((participant) => {
    if (participant.userId === params.senderId) {
      return false;
    }

    if (pool.isUserOnline(params.activityId, participant.userId)) {
      return false;
    }

    if (!params.previousLatestCreatedAt) {
      return true;
    }

    return participant.lastReadAt !== null && participant.lastReadAt >= params.previousLatestCreatedAt;
  });

  if (offlineRecipients.length === 0) {
    return;
  }

  const tasks = offlineRecipients.map(async (recipient) => {
    const result = await sendServiceNotificationByUserId({
      userId: recipient.userId,
      scene: 'discussion_reply',
      pagePath: `subpackages/activity/discussion/index?id=${params.activityId}`,
      data: {
        thing1: toNotificationValue(params.activityTitle),
        thing2: toNotificationValue(`${params.senderName}：${params.content}`, 36),
      },
    });

    if (!result.success && !result.skipped) {
      console.warn('[Chat] failed to send discussion offline reminder', {
        activityId: params.activityId,
        userId: recipient.userId,
        error: result.error,
      });
    }
  });

  await Promise.allSettled(tasks);
}

export async function createChatMessage(params: {
  activityId: string;
  userId: string;
  content: string;
  parentId?: string | null;
}): Promise<{
  id: string;
  createdAt: string;
  senderNickname: string | null;
  senderAvatarUrl: string | null;
}> {
  const [activity, sender, previousLatestMessage] = await Promise.all([
    db
      .select({ title: activities.title })
      .from(activities)
      .where(eq(activities.id, params.activityId))
      .limit(1),
    db
      .select({ nickname: users.nickname, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1),
    db
      .select({ createdAt: activityMessages.createdAt })
      .from(activityMessages)
      .where(eq(activityMessages.activityId, params.activityId))
      .orderBy(desc(activityMessages.createdAt))
      .limit(1),
  ]);

  const activityTitle = activity[0]?.title || '活动讨论区';
  const senderInfo = sender[0] || { nickname: null, avatarUrl: null };
  const previousLatestCreatedAt = previousLatestMessage[0]?.createdAt || null;

  const [message] = await db
    .insert(activityMessages)
    .values({
      activityId: params.activityId,
      senderId: params.userId,
      parentId: params.parentId ?? null,
      messageType: 'text',
      content: params.content,
    })
    .returning({ id: activityMessages.id, createdAt: activityMessages.createdAt });

  void notifyOfflineParticipantsAboutMessage({
    activityId: params.activityId,
    activityTitle,
    senderId: params.userId,
    senderName: senderInfo.nickname || '队友',
    content: params.content,
    previousLatestCreatedAt,
  }).catch((error) => {
    console.error('[Chat] failed to process offline discussion reminder', {
      activityId: params.activityId,
      userId: params.userId,
      error,
    });
  });

  return {
    id: message.id,
    createdAt: message.createdAt.toISOString(),
    senderNickname: senderInfo.nickname,
    senderAvatarUrl: senderInfo.avatarUrl,
  };
}

/**
 * 发送消息
 */
export async function sendMessage(
  activityId: string,
  userId: string,
  data: SendMessageRequest
): Promise<{ id: string }> {
  // 检查用户是否为参与者
  const isParticipant = await checkIsParticipant(activityId, userId);
  if (!isParticipant) {
    throw new Error('您不是该活动的参与者');
  }

  // 检查是否已归档
  const isArchived = await checkIsArchived(activityId);
  if (isArchived) {
    throw new Error('群聊已归档，无法发送消息');
  }

  const message = await createChatMessage({
    activityId,
    userId,
    content: data.content,
    parentId: data.parentId ?? null,
  });

  return { id: message.id };
}

/**
 * 发送系统消息（内部调用）
 */
export async function sendSystemMessage(
  activityId: string,
  content: string
): Promise<void> {
  await db
    .insert(activityMessages)
    .values({
      activityId,
      senderId: null, // 系统消息无发送者
      messageType: 'system',
      content,
    });
}

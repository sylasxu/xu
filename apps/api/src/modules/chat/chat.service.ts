// Chat Service - 群聊消息业务逻辑 (v3.3 使用 activityMessages)
import { db, activityMessages, activities, participants, users, eq, and, gt, count, desc, inArray, sql } from '@xu/db';
import type {
  ChatActivitiesQuery,
  ChatActivitiesResponse,
  ChatActivityItem,
  ChatMessageResponse,
  MessageListQuery,
  SendMessageRequest,
} from './chat.model';

// 群聊归档时间：活动开始后 24 小时
const ARCHIVE_HOURS = 24;

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
      const [latestMessage] = await db
        .select({
          content: activityMessages.content,
          createdAt: activityMessages.createdAt,
        })
        .from(activityMessages)
        .where(eq(activityMessages.activityId, row.activityId))
        .orderBy(desc(activityMessages.createdAt))
        .limit(1);

      const [unreadResult] = await db
        .select({ unreadCount: count() })
        .from(activityMessages)
        .where(and(
          eq(activityMessages.activityId, row.activityId),
          gt(activityMessages.createdAt, row.participantLastReadAt),
          sql`${activityMessages.senderId} IS NULL OR ${activityMessages.senderId} <> ${userId}`
        ));

      return {
        activityId: row.activityId,
        lastMessage: latestMessage?.content || null,
        lastMessageTime: latestMessage?.createdAt?.toISOString() || null,
        unreadCount: unreadResult?.unreadCount || 0,
      };
    })
  );

  const latestMessageMap = new Map<
    string,
    { lastMessage: string | null; lastMessageTime: string | null; unreadCount: number }
  >(latestMessageRows.map((item) => [item.activityId, {
    lastMessage: item.lastMessage,
    lastMessageTime: item.lastMessageTime,
    unreadCount: item.unreadCount,
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
      unreadCount,
      isArchived: calculateIsArchived(row.startAt),
      participantCount: participantCountMap.get(row.activityId) || 0,
    };
  });

  return { items, total, page, totalPages, totalUnread };
}

/**
 * 获取消息列表（轮询）
 */
export async function getMessages(
  activityId: string, 
  userId: string,
  query: MessageListQuery
): Promise<{ messages: ChatMessageResponse[]; isArchived: boolean }> {
  // 检查用户是否为参与者
  const isParticipant = await checkIsParticipant(activityId, userId);
  if (!isParticipant) {
    throw new Error('您不是该活动的参与者');
  }

  // 检查是否已归档
  const isArchived = await checkIsArchived(activityId);

  // 构建查询条件
  const conditions = [eq(activityMessages.activityId, activityId)];
  
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
    .orderBy(activityMessages.createdAt)
    .limit(limit);

  const messages: ChatMessageResponse[] = messageList.map(m => ({
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

  const latestMessageCreatedAt = messageList.length > 0
    ? messageList[messageList.length - 1].createdAt
    : null;
  if (latestMessageCreatedAt) {
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

  return { messages, isArchived };
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

  // 插入消息
  const [message] = await db
    .insert(activityMessages)
    .values({
      activityId,
      senderId: userId,
      parentId: data.parentId ?? null,
      messageType: 'text',
      content: data.content,
    })
    .returning({ id: activityMessages.id });

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

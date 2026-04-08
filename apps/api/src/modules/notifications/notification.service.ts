// Notification Service - 通知与消息中心业务逻辑
import { db, notifications, users, participants, intentMatches, partnerIntents, matchMessages, agentTasks, eq, count, and, desc, inArray, sql } from '@juchang/db';
import type {
  MessageCenterQuery,
  MessageCenterResponse,
  MatchPendingDetailResponse,
  MatchPendingResponse,
  NotificationListQuery,
  NotificationListResponse,
  UnreadCountResponse,
} from './notification.model';
import { getChatActivities } from '../chat/chat.service';
import { sendServiceNotificationByUserId, type ServiceNotificationScene } from '../wechat';
import { confirmMatch as confirmPendingMatchService, cancelMatch as cancelPendingMatchService } from '../ai/tools/partner-match';

// 通知类型枚举值
const NOTIFICATION_TYPES = ['join', 'quit', 'activity_start', 'completed', 'cancelled', 'new_participant', 'post_activity', 'activity_reminder'] as const;
type NotificationType = typeof NOTIFICATION_TYPES[number];
const ACTIVITY_TYPE_NAMES: Record<string, string> = {
  food: '美食',
  entertainment: '娱乐',
  sports: '运动',
  boardgame: '桌游',
  other: '其他',
};
const OPEN_TASK_STATUSES = ['active', 'waiting_auth', 'waiting_async_result'] as const;
const SPORT_TYPE_NAMES: Record<string, string> = {
  badminton: '羽毛球',
  basketball: '篮球',
  running: '跑步',
  tennis: '网球',
  swimming: '游泳',
  cycling: '骑行',
};

function getIntentTypeName(activityType: string, sportType?: string | null): string {
  if (activityType === 'sports' && sportType && SPORT_TYPE_NAMES[sportType]) {
    return SPORT_TYPE_NAMES[sportType];
  }

  return ACTIVITY_TYPE_NAMES[activityType] || activityType;
}

function toTemplateValue(value: string, maxLength = 20): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '待补充';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(maxLength - 1, 1))}…`;
}

function buildIntentSummary(params: {
  rawInput?: string;
  tags?: string[];
  scenarioType?: string | null;
  destinationText?: string | null;
  timePreference?: string | null;
  timeText?: string | null;
  locationHint: string;
}): string {
  const rawInput = typeof params.rawInput === 'string' ? params.rawInput.replace(/\s+/g, ' ').trim() : '';
  if (rawInput) {
    return toTemplateValue(rawInput, 36);
  }

  const segments = [
    params.tags && params.tags.length > 0 ? `偏好 ${params.tags.slice(0, 3).join('、')}` : '',
    (params.timeText || params.timePreference) ? `时间 ${params.timeText || params.timePreference}` : '',
    params.scenarioType === 'destination_companion'
      ? (params.destinationText ? `目的地 ${params.destinationText}` : '')
      : (params.locationHint ? `地点 ${params.locationHint}` : ''),
  ].filter(Boolean);

  return segments.join(' · ') || '这次主要想找个合拍搭子先碰一碰';
}

function resolvePendingMatchLocationHint(params: {
  scenarioType?: string | null;
  destinationText?: string | null;
  centerLocationHint: string;
}): string {
  if (params.scenarioType === 'destination_companion' && params.destinationText?.trim()) {
    return params.destinationText.trim();
  }

  return params.centerLocationHint;
}

function inferPendingMatchRequestMode(messageType: string | null | undefined): 'auto_match' | 'connect' | 'group_up' {
  if (messageType === 'connect_request') {
    return 'connect';
  }

  if (messageType === 'group_up_request') {
    return 'group_up';
  }

  return 'auto_match';
}

/** 类型守卫：检查是否为有效的通知类型 */
function isNotificationType(value: string): value is NotificationType {
  return NOTIFICATION_TYPES.includes(value as NotificationType);
}

/**
 * 获取指定用户的通知列表
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

  return { items: data, total, page, totalPages };
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

/**
 * 获取用户待确认匹配列表（结果导向：确认/取消）
 */
export async function getPendingMatches(userId: string): Promise<MatchPendingResponse> {
  const rows = await db
    .select({
      id: intentMatches.id,
      activityType: intentMatches.activityType,
      scenarioType: intentMatches.scenarioType,
      intentIds: intentMatches.intentIds,
      matchScore: intentMatches.matchScore,
      commonTags: intentMatches.commonTags,
      centerLocationHint: intentMatches.centerLocationHint,
      destinationText: intentMatches.destinationText,
      timeText: intentMatches.timeText,
      confirmDeadline: intentMatches.confirmDeadline,
      tempOrganizerId: intentMatches.tempOrganizerId,
    })
    .from(intentMatches)
    .where(and(
      sql`${userId} = ANY(${intentMatches.userIds})`,
      eq(intentMatches.outcome, 'pending'),
    ))
    .orderBy(desc(intentMatches.matchedAt));

  const matchIds = rows.map((row) => row.id);
  const latestModeMessages = matchIds.length > 0
    ? await db
      .select({
        matchId: matchMessages.matchId,
        messageType: matchMessages.messageType,
        createdAt: matchMessages.createdAt,
      })
      .from(matchMessages)
      .where(and(
        inArray(matchMessages.matchId, matchIds),
        inArray(matchMessages.messageType, ['icebreaker', 'connect_request', 'group_up_request']),
      ))
      .orderBy(desc(matchMessages.createdAt))
    : [];
  const latestModeByMatchId = new Map<string, string>();
  for (const row of latestModeMessages) {
    if (!latestModeByMatchId.has(row.matchId)) {
      latestModeByMatchId.set(row.matchId, row.messageType);
    }
  }

  const relatedIntentIds = Array.from(new Set(
    rows.flatMap((row) => Array.isArray(row.intentIds) ? row.intentIds : [])
  ));
  const intentRows = relatedIntentIds.length > 0
    ? await db
      .select({
        id: partnerIntents.id,
        scenarioType: partnerIntents.scenarioType,
        destinationText: partnerIntents.destinationText,
        timeText: partnerIntents.timeText,
        description: partnerIntents.description,
        metaData: partnerIntents.metaData,
      })
      .from(partnerIntents)
      .where(inArray(partnerIntents.id, relatedIntentIds))
    : [];
  const intentMap = new Map(intentRows.map((row) => [row.id, row]));

  const items = await Promise.all(rows.map(async (row) => ({
    id: row.id,
    activityType: row.activityType,
    typeName: getIntentTypeName(
      row.activityType,
      Array.isArray(row.intentIds)
        ? intentMap.get(row.intentIds[0])?.metaData?.sportType
        : undefined
    ),
    requestMode: inferPendingMatchRequestMode(latestModeByMatchId.get(row.id)),
    matchScore: row.matchScore,
    commonTags: Array.isArray(row.commonTags) ? row.commonTags : [],
    locationHint: resolvePendingMatchLocationHint({
      scenarioType: row.scenarioType,
      destinationText: row.destinationText,
      centerLocationHint: row.centerLocationHint,
    }),
    confirmDeadline: row.confirmDeadline.toISOString(),
    taskId: await findLatestPartnerTaskIdForMatch({
      userId,
      matchId: row.id,
    }) ?? null,
    isTempOrganizer: row.tempOrganizerId === userId,
  })));

  return {
    items,
  };
}

export async function getPendingMatchDetail(
  userId: string,
  matchId: string,
): Promise<MatchPendingDetailResponse> {
  const [match] = await db
    .select({
      id: intentMatches.id,
      activityType: intentMatches.activityType,
      scenarioType: intentMatches.scenarioType,
      matchScore: intentMatches.matchScore,
      commonTags: intentMatches.commonTags,
      centerLocationHint: intentMatches.centerLocationHint,
      destinationText: intentMatches.destinationText,
      timeText: intentMatches.timeText,
      confirmDeadline: intentMatches.confirmDeadline,
      tempOrganizerId: intentMatches.tempOrganizerId,
      intentIds: intentMatches.intentIds,
      userIds: intentMatches.userIds,
      outcome: intentMatches.outcome,
    })
    .from(intentMatches)
    .where(eq(intentMatches.id, matchId))
    .limit(1);

  if (!match) {
    throw new Error('找不到这个匹配');
  }

  if (!Array.isArray(match.userIds) || !match.userIds.includes(userId)) {
    throw new Error('你不在这个匹配中');
  }

  if (match.outcome !== 'pending') {
    throw new Error('这个匹配已经处理过了');
  }

  const [memberRows, icebreakerRows] = await Promise.all([
    db
      .select({
        userId: partnerIntents.userId,
        scenarioType: partnerIntents.scenarioType,
        locationHint: partnerIntents.locationHint,
        destinationText: partnerIntents.destinationText,
        timePreference: partnerIntents.timePreference,
        timeText: partnerIntents.timeText,
        description: partnerIntents.description,
        metaData: partnerIntents.metaData,
        createdAt: partnerIntents.createdAt,
        nickname: users.nickname,
        avatarUrl: users.avatarUrl,
      })
      .from(partnerIntents)
      .innerJoin(users, eq(partnerIntents.userId, users.id))
      .where(inArray(partnerIntents.id, match.intentIds)),
    db
      .select({
        content: matchMessages.content,
        createdAt: matchMessages.createdAt,
        messageType: matchMessages.messageType,
      })
      .from(matchMessages)
      .where(and(
        eq(matchMessages.matchId, match.id),
        inArray(matchMessages.messageType, ['icebreaker', 'connect_request', 'group_up_request']),
      ))
      .orderBy(desc(matchMessages.createdAt))
      .limit(1),
  ]);

  const icebreakerRow = icebreakerRows[0] || null;
  const requestMode = inferPendingMatchRequestMode(icebreakerRow?.messageType);

  const organizer = memberRows.find((row) => row.userId === match.tempOrganizerId) || null;
  const organizerNickname = organizer?.nickname || '召集人';

  const members = memberRows
    .map((row) => {
      const tags = Array.isArray(row.metaData?.tags) ? row.metaData.tags : [];
      return {
        userId: row.userId,
        nickname: row.nickname,
        avatarUrl: row.avatarUrl,
        isTempOrganizer: row.userId === match.tempOrganizerId,
        locationHint: row.locationHint,
        timePreference: row.timePreference || null,
        tags,
        intentSummary: buildIntentSummary({
          rawInput: typeof row.metaData?.rawInput === 'string'
            ? row.metaData.rawInput
            : row.description || undefined,
          tags,
          scenarioType: row.scenarioType,
          destinationText: row.destinationText,
          timePreference: row.timePreference,
          timeText: row.timeText,
          locationHint: row.locationHint,
        }),
        createdAt: row.createdAt,
      };
    })
    .sort((left, right) => {
      if (left.isTempOrganizer !== right.isTempOrganizer) {
        return left.isTempOrganizer ? -1 : 1;
      }

      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    })
    .map(({ createdAt: _createdAt, ...member }) => member);

  const nextActionOwner = match.tempOrganizerId === userId ? 'self' : 'organizer';
  const nextActionText = (() => {
    if (requestMode === 'connect') {
      return nextActionOwner === 'self'
        ? '这是你刚才那条找搭子任务的新进展。对方想先和你搭一下，如果你也觉得合适，点确认就能继续往成局推进。'
        : `这是你刚才那条找搭子任务的新进展。现在等 ${organizerNickname} 回应你的搭子邀约，确认后就会继续往成局推进。`;
    }

    if (requestMode === 'group_up') {
      return nextActionOwner === 'self'
        ? '这是你刚才那条找搭子任务的新进展。对方想问你能不能一起组局，如果你愿意，点确认就能直接继续往成局推进。'
        : `这是你刚才那条找搭子任务的新进展。现在等 ${organizerNickname} 回应你的组局邀约，确认后就会继续往成局推进。`;
    }

    return nextActionOwner === 'self'
      ? '这是你刚才那条找搭子任务的新进展。现在需要你来拍板，确认后会直接成局，大家就能继续去活动里协同。'
      : `这是你刚才那条找搭子任务的新进展。现在等 ${organizerNickname} 拍板，确认后会直接成局，你先看看信息和破冰建议就行。`;
  })();
  const firstSportType = memberRows
    .map((row) => row.metaData?.sportType)
    .find((value) => typeof value === 'string' && value.trim().length > 0);

  return {
    id: match.id,
    activityType: match.activityType,
    typeName: getIntentTypeName(match.activityType, firstSportType),
    requestMode,
    matchScore: match.matchScore,
    commonTags: Array.isArray(match.commonTags) ? match.commonTags : [],
    locationHint: resolvePendingMatchLocationHint({
      scenarioType: match.scenarioType,
      destinationText: match.destinationText,
      centerLocationHint: match.centerLocationHint,
    }),
    confirmDeadline: match.confirmDeadline.toISOString(),
    isTempOrganizer: match.tempOrganizerId === userId,
    organizerUserId: match.tempOrganizerId,
    organizerNickname: organizer?.nickname || null,
    nextActionOwner,
    nextActionText,
    members,
    icebreaker: icebreakerRow
      ? {
          content: icebreakerRow.content,
          createdAt: icebreakerRow.createdAt.toISOString(),
        }
      : null,
  };
}

export async function confirmPendingMatch(userId: string, matchId: string): Promise<{
  code: number;
  msg: string;
  activityId?: string;
}> {
  const result = await confirmPendingMatchService(matchId, userId);
  if (!result.success) {
    throw new Error(result.error || '确认失败，请稍后再试');
  }

  return {
    code: 200,
    msg: '匹配已确认，活动已创建',
    ...(result.activityId ? { activityId: result.activityId } : {}),
  };
}

export async function cancelPendingMatch(userId: string, matchId: string): Promise<{
  code: number;
  msg: string;
}> {
  const result = await cancelPendingMatchService(matchId, userId);
  if (!result.success) {
    throw new Error(result.error || '取消失败，请稍后再试');
  }

  return {
    code: 200,
    msg: '本次匹配已取消',
  };
}

/**
 * 获取消息中心聚合数据（单接口）
 */
export async function getMessageCenterData(
  userId: string,
  query: MessageCenterQuery,
): Promise<MessageCenterResponse> {
  const notificationPage = query.notificationPage || 1;
  const notificationLimit = query.notificationLimit || 20;
  const chatPage = query.chatPage || 1;
  const chatLimit = query.chatLimit || 20;

  const [systemNotifications, pendingMatchesResult, unreadCountResult, chatActivities] = await Promise.all([
    getNotifications(userId, {
      userId,
      page: notificationPage,
      limit: notificationLimit,
    }),
    getPendingMatches(userId),
    getUnreadCount(userId),
    getChatActivities(userId, {
      userId,
      page: chatPage,
      limit: chatLimit,
    }),
  ]);

  const unreadNotificationCount = (unreadCountResult.count || 0) + pendingMatchesResult.items.length;
  const totalUnread = unreadNotificationCount + (chatActivities.totalUnread || 0);

  return {
    systemNotifications,
    pendingMatches: pendingMatchesResult.items,
    unreadNotificationCount,
    chatActivities,
    totalUnread,
  };
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
  taskId?: string;
}

interface DispatchNotificationParams extends CreateNotificationParams {
  groupOpenId?: string | null;
  serviceNotification?: {
    scene: ServiceNotificationScene;
    data: Record<string, string>;
    pagePath?: string;
  };
}

/**
 * 创建通知（内部调用）
 */
export async function createNotification(params: CreateNotificationParams) {
  const { userId, type, title, content, activityId, taskId } = params;

  const [notification] = await db
    .insert(notifications)
    .values({
      userId,
      type,
      title,
      content: content || null,
      activityId: activityId || null,
      taskId: taskId || null,
      isRead: false,
    })
    .returning();

  return notification;
}

async function dispatchNotificationWithFallback(params: DispatchNotificationParams) {
  const { groupOpenId = null, serviceNotification, ...notificationPayload } = params;
  const notification = await createNotification(notificationPayload);
  const strategy = decideNotificationStrategy(groupOpenId);

  if (strategy !== 'service_notification' || !serviceNotification) {
    return notification;
  }

  const sendResult = await sendServiceNotificationByUserId({
    userId: notificationPayload.userId,
    scene: serviceNotification.scene,
    data: serviceNotification.data,
    pagePath: serviceNotification.pagePath,
  });

  if (!sendResult.success) {
    console.warn('[Notification] service_notification failed, fallback to system notification', {
      userId: notificationPayload.userId,
      type: notificationPayload.type,
      activityId: notificationPayload.activityId,
      scene: serviceNotification.scene,
      skipped: sendResult.skipped,
      error: sendResult.error,
    });
    return notification;
  }

  console.info('[Notification] service_notification delivered', {
    userId: notificationPayload.userId,
    type: notificationPayload.type,
    activityId: notificationPayload.activityId,
    scene: serviceNotification.scene,
    mocked: sendResult.mocked === true,
  });

  return notification;
}

async function findLatestOpenJoinTaskIdForActivity(params: {
  userId: string;
  activityId: string;
}): Promise<string | undefined> {
  const [task] = await db
    .select({ id: agentTasks.id })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, params.userId),
      eq(agentTasks.taskType, 'join_activity'),
      inArray(agentTasks.status, OPEN_TASK_STATUSES),
      eq(agentTasks.activityId, params.activityId),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  return task?.id;
}

async function findLatestOpenCreateTaskIdForActivity(params: {
  userId: string;
  activityId: string;
}): Promise<string | undefined> {
  const [task] = await db
    .select({ id: agentTasks.id })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, params.userId),
      eq(agentTasks.taskType, 'create_activity'),
      inArray(agentTasks.status, OPEN_TASK_STATUSES),
      eq(agentTasks.activityId, params.activityId),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  return task?.id;
}

async function findLatestPartnerTaskIdForMatch(params: {
  userId: string;
  matchId: string;
}): Promise<string | undefined> {
  const [task] = await db
    .select({ id: agentTasks.id })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, params.userId),
      eq(agentTasks.taskType, 'find_partner'),
      eq(agentTasks.intentMatchId, params.matchId),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  return task?.id;
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
    taskId: await findLatestOpenCreateTaskIdForActivity({
      userId: organizerId,
      activityId,
    }),
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
    taskId: await findLatestOpenCreateTaskIdForActivity({
      userId: organizerId,
      activityId,
    }),
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
    taskId: await findLatestOpenJoinTaskIdForActivity({
      userId,
      activityId,
    }),
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
    taskId: await findLatestOpenJoinTaskIdForActivity({
      userId,
      activityId,
    }),
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
    taskId: await findLatestOpenJoinTaskIdForActivity({
      userId,
      activityId,
    }),
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
      taskId: await findLatestOpenJoinTaskIdForActivity({
        userId: p.userId,
        activityId,
      }),
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

  const tasks = joinedParticipants.map(async (p) => dispatchNotificationWithFallback({
    userId: p.userId,
    type: 'post_activity',
    title: `活动后反馈：${activityTitle}`,
    content: `「${activityTitle}」结束了，来聊聊感受吧～`,
    activityId,
    taskId: await findLatestOpenJoinTaskIdForActivity({
      userId: p.userId,
      activityId,
    }),
    serviceNotification: {
      scene: 'post_activity',
      pagePath: `subpackages/activity/detail/index?id=${activityId}`,
      data: {
        thing1: toTemplateValue(activityTitle),
        thing2: toTemplateValue('活动结束了，来聊聊感受吧'),
      },
    },
  }));

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Failed to process post_activity notification:', result.reason);
    }
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

  const tasks = joinedParticipants.map(async (p) => dispatchNotificationWithFallback({
    userId: p.userId,
    type: 'activity_reminder',
    title: '活动马上开始啦！',
    content: `「${activityTitle}」还有 1 小时开始，地点：${locationName}`,
    activityId,
    taskId: await findLatestOpenJoinTaskIdForActivity({
      userId: p.userId,
      activityId,
    }),
    serviceNotification: {
      scene: 'activity_reminder',
      pagePath: `subpackages/activity/detail/index?id=${activityId}`,
      data: {
        thing1: toTemplateValue(activityTitle),
        thing2: toTemplateValue(`${locationName}，1 小时后开始`),
      },
    },
  }));

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Failed to process activity_reminder notification:', result.reason);
    }
  }
}

/**
 * 搭子匹配重分配：通知新的 Temp_Organizer
 */
export async function notifyTempOrganizerReassigned(
  userId: string,
  activityType: string,
  locationHint: string,
  matchId?: string,
) {
  const typeName = ACTIVITY_TYPE_NAMES[activityType] || activityType;
  return dispatchNotificationWithFallback({
    userId,
    type: 'join',
    title: '新的成局确认任务',
    content: `你已成为「${typeName}」匹配的临时召集人，请在截止前确认是否发起活动（地点：${locationHint}）。`,
    ...(matchId
      ? {
          taskId: await findLatestPartnerTaskIdForMatch({
            userId,
            matchId,
          }),
        }
      : {}),
    serviceNotification: {
      scene: 'match_reassigned',
      pagePath: 'pages/message/index',
      data: {
        thing1: toTemplateValue(`${typeName} 搭子匹配`),
        thing2: toTemplateValue(locationHint),
      },
    },
  });
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

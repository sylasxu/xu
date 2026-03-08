// Activity Service - 纯业务逻辑 (MVP 简化版 + v3.2 附近搜索)
import { db, activities, users, participants, activityMessages, eq, sql, and, gt, like, inArray, desc, count, gte } from '@juchang/db';
import type {
  ActivityDetailResponse,
  ActivityListItem,
  MyActivitiesResponse,
  CreateActivityRequest,
  NearbyActivitiesQuery,
  NearbyActivityItem,
  NearbyActivitiesResponse,
  ActivitiesListQuery,
  ActivitiesListResponse,
  PublicActivityResponse,
  ActivityOverviewStats,
  ActivityTypeDistribution,
  ActivityStatsQuery,
} from './activity.model';
import { deductAiCreateQuota } from '../users/user.service';
import { indexActivity, deleteIndex } from '../ai/rag';
import { validateFields } from '../content-security';
import {
  notifyJoin,
  notifyNewParticipant,
  notifyCompleted,
  notifyCancelled,
} from '../notifications/notification.service';

// 群聊归档时间：活动开始后 24 小时
const ARCHIVE_HOURS = 24;

// ==========================================
// 类型守卫函数
// ==========================================

/** 活动状态枚举值 */
const ACTIVITY_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;
type ActivityStatus = typeof ACTIVITY_STATUSES[number];

/** 活动类型枚举值 */
const ACTIVITY_TYPES = ['food', 'entertainment', 'sports', 'boardgame', 'other'] as const;
type ActivityType = typeof ACTIVITY_TYPES[number];

/** 类型守卫：检查是否为有效的活动状态 */
export function isActivityStatus(value: string): value is ActivityStatus {
  return ACTIVITY_STATUSES.includes(value as ActivityStatus);
}

/** 类型守卫：检查是否为有效的活动类型 */
export function isActivityType(value: string): value is ActivityType {
  return ACTIVITY_TYPES.includes(value as ActivityType);
}

/** 过滤并返回有效的活动状态数组 */
function filterActivityStatuses(values: string[]): ActivityStatus[] {
  return values.filter(isActivityStatus);
}

/** 过滤并返回有效的活动类型数组 */
function filterActivityTypes(values: string[]): ActivityType[] {
  return values.filter(isActivityType);
}

/**
 * 计算活动是否已归档
 */
function calculateIsArchived(startAt: Date): boolean {
  const archiveTime = new Date(startAt.getTime() + ARCHIVE_HOURS * 60 * 60 * 1000);
  return new Date() > archiveTime;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * 获取活动列表（分页 + 筛选）
 */
export async function getActivitiesList(
  query: ActivitiesListQuery
): Promise<ActivitiesListResponse> {
  const { page = 1, limit = 20, status, type, search, creatorId } = query;
  const offset = (page - 1) * limit;

  // 构建查询条件
  const conditions = [];

  if (status) {
    const statusList = filterActivityStatuses(status.split(',').map(s => s.trim()).filter(Boolean));
    if (statusList.length > 0) {
      conditions.push(inArray(activities.status, statusList));
    }
  }

  if (type) {
    const typeList = filterActivityTypes(type.split(',').map(s => s.trim()).filter(Boolean));
    if (typeList.length > 0) {
      conditions.push(inArray(activities.type, typeList));
    }
  }

  if (search) {
    conditions.push(like(activities.title, `%${search}%`));
  }

  if (creatorId) {
    conditions.push(eq(activities.creatorId, creatorId));
  }

  // 查询活动列表
  const activityList = await db
    .select({
      id: activities.id,
      title: activities.title,
      description: activities.description,
      location: activities.location,
      locationName: activities.locationName,
      locationHint: activities.locationHint,
      startAt: activities.startAt,
      type: activities.type,
      maxParticipants: activities.maxParticipants,
      currentParticipants: activities.currentParticipants,
      status: activities.status,
      createdAt: activities.createdAt,
      updatedAt: activities.updatedAt,
      creatorId: users.id,
      creatorNickname: users.nickname,
      creatorAvatar: users.avatarUrl,
    })
    .from(activities)
    .innerJoin(users, eq(activities.creatorId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activities.createdAt))
    .limit(limit)
    .offset(offset);

  // 查询总数
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activities)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // 转换数据格式
  const data: ActivityListItem[] = activityList.map(item => ({
    id: item.id,
    title: item.title,
    description: item.description,
    location: item.location
      ? [item.location.x, item.location.y] as [number, number]
      : [0, 0] as [number, number],
    locationName: item.locationName,
    locationHint: item.locationHint,
    startAt: item.startAt.toISOString(),
    type: item.type,
    maxParticipants: item.maxParticipants,
    currentParticipants: item.currentParticipants,
    status: item.status,
    isArchived: calculateIsArchived(item.startAt),
    creator: {
      id: item.creatorId,
      nickname: item.creatorNickname,
      avatarUrl: item.creatorAvatar,
    },
  }));

  return {
    data,
    total: count,
    page,
    pageSize: limit,
  };
}

/**
 * 获取我相关的活动（发布的 + 参与的）
 */
export async function getMyActivities(
  userId: string,
  type?: 'created' | 'joined'
): Promise<MyActivitiesResponse> {
  let activityList: any[] = [];

  if (!type || type === 'created') {
    // 获取我创建的活动
    const createdActivities = await db
      .select({
        id: activities.id,
        title: activities.title,
        description: activities.description,
        location: activities.location,
        locationName: activities.locationName,
        locationHint: activities.locationHint,
        startAt: activities.startAt,
        type: activities.type,
        maxParticipants: activities.maxParticipants,
        currentParticipants: activities.currentParticipants,
        status: activities.status,
        creatorId: users.id,
        creatorNickname: users.nickname,
        creatorAvatar: users.avatarUrl,
      })
      .from(activities)
      .innerJoin(users, eq(activities.creatorId, users.id))
      .where(eq(activities.creatorId, userId))
      .orderBy(sql`${activities.startAt} DESC`);

    activityList = [...activityList, ...createdActivities.map(a => ({ ...a, source: 'created' }))];
  }

  if (!type || type === 'joined') {
    // 获取我参与的活动（不包括我创建的）
    const joinedActivities = await db
      .select({
        id: activities.id,
        title: activities.title,
        description: activities.description,
        location: activities.location,
        locationName: activities.locationName,
        locationHint: activities.locationHint,
        startAt: activities.startAt,
        type: activities.type,
        maxParticipants: activities.maxParticipants,
        currentParticipants: activities.currentParticipants,
        status: activities.status,
        creatorId: users.id,
        creatorNickname: users.nickname,
        creatorAvatar: users.avatarUrl,
      })
      .from(activities)
      .innerJoin(users, eq(activities.creatorId, users.id))
      .innerJoin(participants, eq(participants.activityId, activities.id))
      .where(and(
        eq(participants.userId, userId),
        eq(participants.status, 'joined'),
        sql`${activities.creatorId} != ${userId}` // 排除自己创建的
      ))
      .orderBy(sql`${activities.startAt} DESC`);

    activityList = [...activityList, ...joinedActivities.map(a => ({ ...a, source: 'joined' }))];
  }

  // 转换数据格式
  const data: ActivityListItem[] = activityList.map(item => ({
    id: item.id,
    title: item.title,
    description: item.description,
    location: item.location
      ? [item.location.x, item.location.y] as [number, number]
      : [0, 0] as [number, number],
    locationName: item.locationName,
    locationHint: item.locationHint,
    startAt: item.startAt.toISOString(),
    type: item.type,
    maxParticipants: item.maxParticipants,
    currentParticipants: item.currentParticipants,
    status: item.status,
    isArchived: calculateIsArchived(item.startAt),
    creator: {
      id: item.creatorId,
      nickname: item.creatorNickname,
      avatarUrl: item.creatorAvatar,
    },
  }));

  // 按开始时间排序
  data.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());

  return {
    data,
    total: data.length,
  };
}

/**
 * 根据ID获取活动详情（包含 isArchived 计算）
 */
export async function getActivityById(id: string): Promise<ActivityDetailResponse | null> {
  // 查询活动详情
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, id))
    .limit(1);

  if (!activity) {
    return null;
  }

  // 查询创建者信息
  const [creator] = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, activity.creatorId))
    .limit(1);

  // 查询参与者信息
  const participantsList = await db
    .select({
      id: participants.id,
      userId: participants.userId,
      status: participants.status,
      joinedAt: participants.joinedAt,
      userInfo: {
        id: users.id,
        nickname: users.nickname,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .where(eq(participants.activityId, activity.id));

  // 转换 PostGIS geometry 为数组格式
  const location = activity.location
    ? [activity.location.x, activity.location.y] as [number, number]
    : [0, 0] as [number, number];

  return {
    id: activity.id,
    creatorId: activity.creatorId,
    title: activity.title,
    description: activity.description,
    location,
    locationName: activity.locationName,
    address: activity.address,
    locationHint: activity.locationHint,
    startAt: activity.startAt.toISOString(),
    type: activity.type,
    maxParticipants: activity.maxParticipants,
    currentParticipants: activity.currentParticipants,
    status: activity.status,
    createdAt: activity.createdAt.toISOString(),
    updatedAt: activity.updatedAt.toISOString(),
    isArchived: calculateIsArchived(activity.startAt),
    groupOpenId: null,
    dynamicMessageId: null,
    creator: creator || null,
    participants: participantsList.map(p => ({
      id: p.id,
      userId: p.userId,
      status: p.status,
      joinedAt: p.joinedAt?.toISOString() || null,
      user: p.userInfo || null,
    })),
  };
}

/**
 * v5.0: 获取活动公开详情（无需认证，含讨论区预览）
 * 排除敏感字段（creatorId, location 精确坐标, phoneNumber）
 */
export async function getPublicActivityById(activityId: string): Promise<PublicActivityResponse | null> {
  // 1. 查询活动基础信息 + 发起人
  const [activity] = await db
    .select({
      id: activities.id,
      title: activities.title,
      description: activities.description,
      startAt: activities.startAt,
      locationName: activities.locationName,
      locationHint: activities.locationHint,
      type: activities.type,
      status: activities.status,
      maxParticipants: activities.maxParticipants,
      currentParticipants: activities.currentParticipants,
      theme: activities.theme,
      themeConfig: activities.themeConfig,
      creatorNickname: users.nickname,
      creatorAvatarUrl: users.avatarUrl,
    })
    .from(activities)
    .leftJoin(users, eq(activities.creatorId, users.id))
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) return null;

  // 2. 查询参与者列表（最多 10 人，头像+昵称）
  const participantList = await db
    .select({
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .where(and(eq(participants.activityId, activityId), eq(participants.status, 'joined')))
    .limit(10);

  // 3. 查询最近 3 条讨论区消息
  const recentMessages = await db
    .select({
      senderNickname: users.nickname,
      senderAvatar: users.avatarUrl,
      content: activityMessages.content,
      createdAt: activityMessages.createdAt,
    })
    .from(activityMessages)
    .leftJoin(users, eq(activityMessages.senderId, users.id))
    .where(eq(activityMessages.activityId, activityId))
    .orderBy(desc(activityMessages.createdAt))
    .limit(3);

  return {
    id: activity.id,
    title: activity.title,
    description: activity.description,
    startAt: activity.startAt.toISOString(),
    locationName: activity.locationName,
    locationHint: activity.locationHint,
    type: activity.type,
    status: activity.status,
    maxParticipants: activity.maxParticipants,
    currentParticipants: activity.currentParticipants,
    theme: activity.theme,
    themeConfig: activity.themeConfig,
    isArchived: calculateIsArchived(activity.startAt),
    creator: {
      nickname: activity.creatorNickname,
      avatarUrl: activity.creatorAvatarUrl,
    },
    participants: participantList,
    recentMessages: recentMessages.reverse().map(m => ({
      senderNickname: m.senderNickname,
      senderAvatar: m.senderAvatar,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/**
 * 创建活动（检查额度）
 */
export async function createActivity(
  data: CreateActivityRequest,
  creatorId: string
): Promise<{ id: string }> {
  // CP-9: 检查手机号绑定
  const [creator] = await db
    .select({ phoneNumber: users.phoneNumber })
    .from(users)
    .where(eq(users.id, creatorId))
    .limit(1);
  if (!creator?.phoneNumber) {
    throw new Error('请先绑定手机号才能发布活动');
  }

  // 检查并扣减额度
  const hasQuota = await deductAiCreateQuota(creatorId);
  if (!hasQuota) {
    throw new Error('今日发布额度已用完');
  }

  const { location, startAt, maxParticipants = 4, ...activityData } = data;

  // 时间校验：不允许发布过去时间的活动
  const startAtDate = new Date(startAt);
  if (startAtDate < new Date()) {
    throw new Error('活动开始时间不能是过去');
  }

  // 内容安全校验
  const securityResult = await validateFields({
    title: activityData.title,
    description: activityData.description,
    locationName: activityData.locationName,
    locationHint: activityData.locationHint,
  }, { userId: creatorId, scene: 'activity' });

  if (!securityResult.pass) {
    throw new Error('内容包含违规信息，请修改后重试');
  }

  // 创建活动记录
  const [newActivity] = await db
    .insert(activities)
    .values({
      ...activityData,
      creatorId,
      location: sql`ST_SetSRID(ST_MakePoint(${location[0]}, ${location[1]}), 4326)`,
      startAt: startAtDate,
      maxParticipants,
      currentParticipants: 1, // 创建者自动参与
      status: 'active',
    })
    .returning({ id: activities.id });

  // 将创建者加入参与者列表
  await db
    .insert(participants)
    .values({
      activityId: newActivity.id,
      userId: creatorId,
      status: 'joined',
    });

  // 更新用户创建活动计数
  await db
    .update(users)
    .set({
      activitiesCreatedCount: sql`${users.activitiesCreatedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, creatorId));

  // v4.5: 异步索引活动到 RAG (不阻塞主流程)
  const activityForIndex = await getActivityById(newActivity.id);
  if (activityForIndex) {
    indexActivity(activityForIndex as any).catch(err => {
      console.error('Failed to index activity:', err);
    });
  }

  // v4.8: 异步追踪关键词转化 (不阻塞主流程)
  (async () => {
    try {
      const { trackConversion } = await import('../hot-keywords/hot-keywords.service');
      await trackConversion(creatorId);
    } catch (err) {
      console.error('Failed to track keyword conversion:', err);
    }
  })();

  return { id: newActivity.id };
}

/**
 * 发布草稿活动 (v3.2 新增)
 * 将 draft 状态的活动变为 active
 */
export async function publishDraftActivity(
  activityId: string,
  creatorId: string,
  updates?: Partial<CreateActivityRequest>
): Promise<{ id: string }> {
  // 查询活动
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  // 验证是否为创建者
  if (activity.creatorId !== creatorId) {
    throw new Error('只有活动发起人可以发布活动');
  }

  // 验证状态是否为 draft
  if (activity.status !== 'draft') {
    throw new Error('只有草稿状态的活动可以发布');
  }

  // 时间校验：不允许发布过去时间的活动 (CP-19)
  const startAt = updates?.startAt ? new Date(updates.startAt) : activity.startAt;
  if (startAt < new Date()) {
    throw new Error('活动时间已过期，请重新创建');
  }

  // 构建更新数据
  const updateData: Record<string, any> = {
    status: 'active',
    updatedAt: new Date(),
  };

  // 如果有更新数据，合并进去
  if (updates) {
    if (updates.title) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.startAt) updateData.startAt = new Date(updates.startAt);
    if (updates.location) {
      updateData.location = sql`ST_SetSRID(ST_MakePoint(${updates.location[0]}, ${updates.location[1]}), 4326)`;
    }
    if (updates.locationName) updateData.locationName = updates.locationName;
    if (updates.address !== undefined) updateData.address = updates.address;
    if (updates.locationHint) updateData.locationHint = updates.locationHint;
    if (updates.type) updateData.type = updates.type;
    if (updates.maxParticipants) updateData.maxParticipants = updates.maxParticipants;

    // 内容安全校验（仅检查更新的字段）
    const securityResult = await validateFields({
      title: updates.title,
      description: updates.description,
      locationName: updates.locationName,
      locationHint: updates.locationHint,
    }, { userId: creatorId, scene: 'activity' });

    if (!securityResult.pass) {
      throw new Error('内容包含违规信息，请修改后重试');
    }
  }

  // 更新活动状态为 active
  await db
    .update(activities)
    .set(updateData)
    .where(eq(activities.id, activityId));

  // 更新用户创建活动计数
  await db
    .update(users)
    .set({
      activitiesCreatedCount: sql`${users.activitiesCreatedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, creatorId));

  // v4.5: 异步索引活动到 RAG (不阻塞主流程)
  const activityForIndex = await getActivityById(activityId);
  if (activityForIndex) {
    indexActivity(activityForIndex as any).catch(err => {
      console.error('Failed to index activity:', err);
    });
  }

  // v4.8: 异步追踪关键词转化 (不阻塞主流程)
  (async () => {
    try {
      const { trackConversion } = await import('../hot-keywords/hot-keywords.service');
      await trackConversion(creatorId);
    } catch (err) {
      console.error('Failed to track keyword conversion:', err);
    }
  })();

  return { id: activityId };
}

/**
 * 更新活动状态（completed/cancelled）
 */
export async function updateActivityStatus(
  activityId: string,
  userId: string,
  status: 'completed' | 'cancelled'
): Promise<void> {
  // 验证用户是否为活动创建者
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

/**
 * 删除活动（仅 active 状态且未开始）
 */
export async function deleteActivity(activityId: string, userId: string): Promise<void> {
  // 验证用户是否为活动创建者
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

  // 检查活动是否已开始
  if (new Date() >= activity.startAt) {
    throw new Error('活动已开始，无法删除');
  }

  // 删除参与者记录
  await db
    .delete(participants)
    .where(eq(participants.activityId, activityId));

  // 删除活动
  await db
    .delete(activities)
    .where(eq(activities.id, activityId));

  // v4.5: 删除 RAG 索引 (异步，不阻塞)
  deleteIndex(activityId).catch(err => {
    console.error('Failed to delete activity index:', err);
  });
}

/**
 * 报名活动
 */
export async function joinActivity(activityId: string, userId: string): Promise<{ id: string }> {
  // CP-9: 检查手机号绑定
  const [joiningUser] = await db
    .select({ phoneNumber: users.phoneNumber })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!joiningUser?.phoneNumber) {
    throw new Error('请先绑定手机号才能报名活动');
  }

  // 检查活动是否存在
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  if (activity.status !== 'active') {
    throw new Error('活动不在招募中');
  }

  if (activity.currentParticipants >= activity.maxParticipants) {
    throw new Error('活动人数已满');
  }

  // 检查是否为创建者（创建者不能报名自己的活动）
  if (activity.creatorId === userId) {
    throw new Error('不能报名自己创建的活动');
  }

  // 检查是否已报名
  const [existing] = await db
    .select()
    .from(participants)
    .where(and(
      eq(participants.activityId, activityId),
      eq(participants.userId, userId)
    ))
    .limit(1);

  if (existing) {
    if (existing.status === 'joined') {
      throw new Error('您已报名此活动');
    }
    // 如果之前退出过，重新加入
    await db
      .update(participants)
      .set({
        status: 'joined',
        joinedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(participants.id, existing.id));

    // 更新活动参与人数
    await db
      .update(activities)
      .set({
        currentParticipants: activity.currentParticipants + 1,
        updatedAt: new Date(),
      })
      .where(eq(activities.id, activityId));

    // 更新用户参与计数
    await db
      .update(users)
      .set({
        participationCount: sql`${users.participationCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { id: existing.id };
  }

  // 创建参与记录
  const [participant] = await db
    .insert(participants)
    .values({
      activityId,
      userId,
      status: 'joined',
    })
    .returning({ id: participants.id });

  // 更新活动参与人数
  await db
    .update(activities)
    .set({
      currentParticipants: activity.currentParticipants + 1,
      updatedAt: new Date(),
    })
    .where(eq(activities.id, activityId));

  // 更新用户参与计数
  await db
    .update(users)
    .set({
      participationCount: sql`${users.participationCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  // v4.8: 发送通知给活动创建者 (异步，不阻塞主流程)
  // v5.0: 查询新加入者昵称，用于系统消息和通知
  const [joiner] = await db
    .select({ nickname: users.nickname })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const joinerName = joiner?.nickname || '新成员';

  notifyJoin(
    activity.creatorId,
    activityId,
    activity.title,
    joinerName
  ).catch(err => {
    console.error('Failed to send join notification:', err);
  });

  // v5.0: 发送系统消息到讨论区 "XX 刚刚加入了！"
  db.insert(activityMessages).values({
    activityId,
    senderId: null,
    messageType: 'system',
    content: `${joinerName} 刚刚加入了！`,
  }).catch(err => console.error('Failed to send join system message:', err));

  // v5.0: 通知所有已报名参与者（不含新加入者和创建者）
  notifyNewParticipant(
    activityId,
    activity.title,
    joinerName,
    userId,
    activity.creatorId
  ).catch(err => console.error('Failed to notify participants:', err));

  // v4.8: 动态消息卡片更新 — TODO: 待微信能力模块重构后接入
  // if (activity.groupOpenId && activity.dynamicMessageId) { ... }

  // v4.8: 异步追踪关键词转化 (不阻塞主流程)
  import('../hot-keywords/hot-keywords.service').then(({ trackConversion }) => {
    trackConversion(userId).catch(err => {
      console.error('Failed to track keyword conversion:', err);
    });
  });

  return { id: participant.id };
}


/**
 * v4.5: 更新活动信息
 * 
 * 支持更新活动的基本信息，如果更新了语义相关字段则重新索引
 */
export async function updateActivity(
  activityId: string,
  userId: string,
  updates: Partial<CreateActivityRequest>
): Promise<void> {
  // 验证用户是否为活动创建者
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

  // 只有 draft 或 active 状态的活动可以更新
  if (activity.status !== 'draft' && activity.status !== 'active') {
    throw new Error('只有草稿或进行中的活动可以更新');
  }

  // 构建更新数据
  const updateData: Record<string, any> = {
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
    const startAtDate = new Date(updates.startAt);
    if (startAtDate < new Date()) {
      throw new Error('活动开始时间不能是过去');
    }
    updateData.startAt = startAtDate;
  }

  if (updates.location !== undefined) {
    updateData.location = sql`ST_SetSRID(ST_MakePoint(${updates.location[0]}, ${updates.location[1]}), 4326)`;
  }

  // 内容安全校验（仅检查更新的字段）
  const securityResult = await validateFields({
    title: updates.title,
    description: updates.description,
    locationName: updates.locationName,
    locationHint: updates.locationHint,
  }, { userId, scene: 'activity' });

  if (!securityResult.pass) {
    throw new Error('内容包含违规信息，请修改后重试');
  }

  // 执行更新
  await db
    .update(activities)
    .set(updateData)
    .where(eq(activities.id, activityId));

  // v4.5: 如果更新了影响语义的字段，异步重新索引
  const semanticFields = ['title', 'description', 'type', 'startAt'];
  const needsReindex = semanticFields.some(field => field in updates);

  if (needsReindex) {
    const activityForIndex = await getActivityById(activityId);
    if (activityForIndex) {
      indexActivity(activityForIndex as any).catch(err => {
        console.error('Failed to re-index activity:', err);
      });
    }
  }
}

/**
 * 退出活动
 */
export async function quitActivity(activityId: string, userId: string): Promise<void> {
  // 检查活动是否存在
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    throw new Error('活动不存在');
  }

  // 检查是否为创建者（创建者不能退出自己的活动）
  if (activity.creatorId === userId) {
    throw new Error('活动发起人不能退出活动');
  }

  // 检查参与记录
  const [participant] = await db
    .select()
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

  // 更新参与者状态为 quit
  await db
    .update(participants)
    .set({
      status: 'quit',
      updatedAt: new Date(),
    })
    .where(eq(participants.id, participant.id));

  // 更新活动参与人数
  await db
    .update(activities)
    .set({
      currentParticipants: Math.max(1, activity.currentParticipants - 1),
      updatedAt: new Date(),
    })
    .where(eq(activities.id, activityId));

  // TODO: 发送通知给活动创建者
}


// ==========================================
// 附近活动搜索 (v3.2 新增)
// ==========================================

/**
 * 获取附近活动
 * 使用 PostGIS ST_DWithin 进行地理空间查询
 */
export async function getNearbyActivities(
  query: NearbyActivitiesQuery
): Promise<NearbyActivitiesResponse> {
  const { lat, lng, type, keyword, radius = 5000, limit = 20 } = query;

  // 构建查询条件
  // 只查询 active 状态且未开始的活动
  const now = new Date();

  // 使用 PostGIS 进行地理空间查询
  // ST_DWithin 使用米为单位（geography 类型）
  const normalizedKeyword = keyword?.trim();
  const keywordPattern = normalizedKeyword
    ? `%${escapeLikePattern(normalizedKeyword)}%`
    : null;

  const nearbyActivities = await db
    .select({
      id: activities.id,
      title: activities.title,
      description: activities.description,
      location: activities.location,
      locationName: activities.locationName,
      locationHint: activities.locationHint,
      startAt: activities.startAt,
      type: activities.type,
      maxParticipants: activities.maxParticipants,
      currentParticipants: activities.currentParticipants,
      status: activities.status,
      creatorId: users.id,
      creatorNickname: users.nickname,
      creatorAvatar: users.avatarUrl,
      // 计算距离（米）
      distance: sql<number>`ST_Distance(
        ${activities.location}::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      )`.as('distance'),
    })
    .from(activities)
    .innerJoin(users, eq(activities.creatorId, users.id))
    .where(
      and(
        eq(activities.status, 'active'),
        gt(activities.startAt, now),
        // 地理空间过滤：在指定半径内
        sql`ST_DWithin(
          ${activities.location}::geography,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          ${radius}
        )`,
        // 可选的关键词过滤（标题/地点名/地点备注）
        keywordPattern
          ? sql`(
              ${activities.title} ILIKE ${keywordPattern} ESCAPE '\\'
              OR ${activities.locationName} ILIKE ${keywordPattern} ESCAPE '\\'
              OR ${activities.locationHint} ILIKE ${keywordPattern} ESCAPE '\\'
            )`
          : sql`true`,
        // 可选的类型过滤
        type ? eq(activities.type, type) : sql`true`
      )
    )
    .orderBy(sql`distance ASC`)
    .limit(limit);

  // 转换为响应格式
  const data: NearbyActivityItem[] = nearbyActivities.map(item => ({
    id: item.id,
    title: item.title,
    description: item.description,
    lat: item.location ? item.location.y : lat,
    lng: item.location ? item.location.x : lng,
    locationName: item.locationName,
    locationHint: item.locationHint,
    startAt: item.startAt.toISOString(),
    type: item.type,
    maxParticipants: item.maxParticipants,
    currentParticipants: item.currentParticipants,
    status: item.status,
    distance: Math.round(item.distance || 0),
    creator: {
      id: item.creatorId,
      nickname: item.creatorNickname,
      avatarUrl: item.creatorAvatar,
    },
  }));

  return {
    data,
    total: data.length,
    center: { lat, lng },
    radius,
  };
}

// ==========================================
// 活动统计 (从 dashboard 迁移)
// ==========================================

/**
 * 获取活动概览统计
 */
export async function getActivityOverviewStats(): Promise<ActivityOverviewStats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const [
      totalActivitiesResult,
      activeActivitiesResult,
      completedActivitiesResult,
      draftActivitiesResult,
      todayCompletedResult,
    ] = await Promise.all([
      db.select({ count: count() }).from(activities),
      db.select({ count: count() })
        .from(activities)
        .where(eq(activities.status, 'active')),
      db.select({ count: count() })
        .from(activities)
        .where(eq(activities.status, 'completed')),
      db.select({ count: count() })
        .from(activities)
        .where(eq(activities.status, 'draft')),
      db.select({ count: count() })
        .from(activities)
        .where(and(
          eq(activities.status, 'completed'),
          gte(activities.updatedAt, today)
        )),
    ]);

    return {
      totalActivities: totalActivitiesResult[0]?.count || 0,
      activeActivities: activeActivitiesResult[0]?.count || 0,
      completedActivities: completedActivitiesResult[0]?.count || 0,
      draftActivities: draftActivitiesResult[0]?.count || 0,
      todayCompleted: todayCompletedResult[0]?.count || 0,
    };
  } catch (error) {
    console.error('获取活动概览统计失败:', error);
    return {
      totalActivities: 0,
      activeActivities: 0,
      completedActivities: 0,
      draftActivities: 0,
      todayCompleted: 0,
    };
  }
}

/**
 * 获取活动类型分布
 */
export async function getActivityTypeDistribution(): Promise<ActivityTypeDistribution> {
  try {
    const result = await db
      .select({
        type: activities.type,
        count: count(),
      })
      .from(activities)
      .groupBy(activities.type);
    
    const distribution: ActivityTypeDistribution = {
      food: 0,
      sports: 0,
      entertainment: 0,
      boardgame: 0,
      other: 0,
    };
    
    for (const row of result) {
      const type = row.type as keyof ActivityTypeDistribution;
      if (type in distribution) {
        distribution[type] = row.count;
      } else {
        distribution.other += row.count;
      }
    }
    
    return distribution;
  } catch (error) {
    console.error('获取活动类型分布失败:', error);
    return { food: 0, sports: 0, entertainment: 0, boardgame: 0, other: 0 };
  }
}

/**
 * 活动统计入口 - 根据类型返回不同统计
 */
export async function getActivityStats(query: ActivityStatsQuery): Promise<ActivityOverviewStats | ActivityTypeDistribution> {
  if (query.type === 'distribution') {
    return getActivityTypeDistribution();
  }
  return getActivityOverviewStats();
}

// Activity Query Service - 查询侧业务逻辑
import {
  db,
  activities,
  users,
  participants,
  activityMessages,
  eq,
  sql,
  and,
  gt,
  like,
  inArray,
  desc,
  count,
  gte,
} from '@xu/db';
import type {
  ActivityDetailResponse,
  ActivityJoinState,
  ActivityListItem,
  MyActivitiesResponse,
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

const ARCHIVE_HOURS = 24;

const ACTIVITY_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;
type ActivityStatus = typeof ACTIVITY_STATUSES[number];

const ACTIVITY_TYPES = ['food', 'entertainment', 'sports', 'boardgame', 'other'] as const;
type ActivityType = typeof ACTIVITY_TYPES[number];

export function isActivityStatus(value: string): value is ActivityStatus {
  return ACTIVITY_STATUSES.includes(value as ActivityStatus);
}

export function isActivityType(value: string): value is ActivityType {
  return ACTIVITY_TYPES.includes(value as ActivityType);
}

function filterActivityStatuses(values: string[]): ActivityStatus[] {
  return values.filter(isActivityStatus);
}

function filterActivityTypes(values: string[]): ActivityType[] {
  return values.filter(isActivityType);
}

function calculateIsArchived(startAt: Date): boolean {
  const archiveTime = new Date(startAt.getTime() + ARCHIVE_HOURS * 60 * 60 * 1000);
  return new Date() > archiveTime;
}

function calculateRemainingSeats(currentParticipants: number, maxParticipants: number): number {
  return Math.max(0, maxParticipants - currentParticipants);
}

function canExecuteJoinAction(params: {
  status: string;
  startAt: Date;
  isCreator: boolean;
  participantStatus: string | null;
}): boolean {
  if (params.isCreator) {
    return false;
  }

  if (params.participantStatus === 'joined' || params.participantStatus === 'waitlist') {
    return false;
  }

  return params.status === 'active' && params.startAt > new Date();
}

function buildActivityConversionTips(params: {
  title: string;
  isFull: boolean;
  canJoin: boolean;
  isArchived: boolean;
}) {
  if (params.isArchived) {
    return {
      joinContext: '这场已经结束，可以先回看详情和讨论记录。',
      discussionContext: '讨论区保留这次安排和沟通记录，方便之后复盘或再约。',
      cloneContext: `喜欢「${params.title}」这种节奏的话，可以让 xu 顺手帮你再组一场类似的。`,
    };
  }

  if (!params.canJoin) {
    return {
      joinContext: params.isFull
        ? '当前已满员，可以先分享给朋友或让 xu 帮你找类似的局。'
        : '这场暂时不能报名，可以先分享或回到首页继续找局。',
      discussionContext: '加入后讨论区会继续承接集合、破冰和临时变动。',
      cloneContext: `想要类似「${params.title}」的局，可以让 xu 参考这场快速整理新草稿。`,
    };
  }

  return {
    joinContext: params.isFull
      ? '报名后会先进入候补，后续有位置再继续接上讨论区。'
      : '报名成功后会直接进入讨论区，集合、破冰和临时变动都在那里继续。',
    discussionContext: '讨论区会接住报名后的下一步：打招呼、确认集合、同步变化。',
    cloneContext: `也可以参考「${params.title}」再组一场，xu 会优先保留类型、地点和人数节奏。`,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\%_]/g, (matched) => `\\${matched}`);
}

export async function getActivitiesList(
  query: ActivitiesListQuery
): Promise<ActivitiesListResponse> {
  const { page = 1, limit = 20, status, type, search, creatorId } = query;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (status) {
    const statusList = filterActivityStatuses(status.split(',').map((item) => item.trim()).filter(Boolean));
    if (statusList.length > 0) {
      conditions.push(inArray(activities.status, statusList));
    }
  }

  if (type) {
    const typeList = filterActivityTypes(type.split(',').map((item) => item.trim()).filter(Boolean));
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

  const [{ count: totalCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activities)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const activityIds = activityList.map((item) => item.id);
  const waitlistCounts = activityIds.length > 0
    ? await db
      .select({
        activityId: participants.activityId,
        waitlistCount: sql<number>`count(*)::int`,
      })
      .from(participants)
      .where(and(
        inArray(participants.activityId, activityIds),
        eq(participants.status, 'waitlist'),
      ))
      .groupBy(participants.activityId)
    : [];
  const waitlistCountByActivityId = new Map(waitlistCounts.map((item) => [item.activityId, item.waitlistCount]));

  const data: ActivityListItem[] = activityList.map((item) => {
    const remainingSeats = calculateRemainingSeats(item.currentParticipants, item.maxParticipants);
    const waitlistCount = waitlistCountByActivityId.get(item.id) ?? 0;

    return {
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
      waitlistCount,
      remainingSeats,
      isFull: remainingSeats === 0,
      status: item.status,
      isArchived: calculateIsArchived(item.startAt),
      creator: {
        id: item.creatorId,
        nickname: item.creatorNickname,
        avatarUrl: item.creatorAvatar,
      },
    };
  });

  return {
    data,
    total: totalCount,
    page,
    pageSize: limit,
  };
}

export async function getMyActivities(
  userId: string,
  type?: 'created' | 'joined'
): Promise<MyActivitiesResponse> {
  let activityList: Array<Record<string, unknown>> = [];

  if (!type || type === 'created') {
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

    activityList = [...activityList, ...createdActivities.map((item) => ({ ...item, source: 'created' }))];
  }

  if (!type || type === 'joined') {
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
        sql`${activities.creatorId} != ${userId}`
      ))
      .orderBy(sql`${activities.startAt} DESC`);

    activityList = [...activityList, ...joinedActivities.map((item) => ({ ...item, source: 'joined' }))];
  }

  const activityIds = activityList
    .map((item) => typeof item.id === 'string' ? item.id : null)
    .filter((item): item is string => Boolean(item));
  const waitlistCounts = activityIds.length > 0
    ? await db
      .select({
        activityId: participants.activityId,
        waitlistCount: sql<number>`count(*)::int`,
      })
      .from(participants)
      .where(and(
        inArray(participants.activityId, activityIds),
        eq(participants.status, 'waitlist'),
      ))
      .groupBy(participants.activityId)
    : [];
  const waitlistCountByActivityId = new Map(waitlistCounts.map((item) => [item.activityId, item.waitlistCount]));

  const data: ActivityListItem[] = activityList.map((item) => {
    const typedItem = item as {
      id: string;
      title: string;
      description: string | null;
      location: { x: number; y: number } | null;
      locationName: string;
      locationHint: string;
      startAt: Date;
      type: string;
      maxParticipants: number;
      currentParticipants: number;
      status: string;
      creatorId: string;
      creatorNickname: string | null;
      creatorAvatar: string | null;
    };

    const remainingSeats = calculateRemainingSeats(typedItem.currentParticipants, typedItem.maxParticipants);
    const waitlistCount = waitlistCountByActivityId.get(typedItem.id) ?? 0;

    return {
      id: typedItem.id,
      title: typedItem.title,
      description: typedItem.description,
      location: typedItem.location
        ? [typedItem.location.x, typedItem.location.y] as [number, number]
        : [0, 0] as [number, number],
      locationName: typedItem.locationName,
      locationHint: typedItem.locationHint,
      startAt: typedItem.startAt.toISOString(),
      type: typedItem.type,
      maxParticipants: typedItem.maxParticipants,
      currentParticipants: typedItem.currentParticipants,
      waitlistCount,
      remainingSeats,
      isFull: remainingSeats === 0,
      status: typedItem.status,
      isArchived: calculateIsArchived(typedItem.startAt),
      creator: {
        id: typedItem.creatorId,
        nickname: typedItem.creatorNickname,
        avatarUrl: typedItem.creatorAvatar,
      },
    };
  });

  data.sort((left, right) => new Date(right.startAt).getTime() - new Date(left.startAt).getTime());

  return {
    data,
    total: data.length,
  };
}

export async function getActivityById(id: string, viewerUserId?: string | null): Promise<ActivityDetailResponse | null> {
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, id))
    .limit(1);

  if (!activity) {
    return null;
  }

  const [creator] = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, activity.creatorId))
    .limit(1);

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
    .where(and(
      eq(participants.activityId, activity.id),
      sql`${participants.status} != 'quit'`,
    ));

  const location = activity.location
    ? [activity.location.x, activity.location.y] as [number, number]
    : [0, 0] as [number, number];

  const participantStatus = viewerUserId
    ? participantsList.find((item) => item.userId === viewerUserId)?.status ?? null
    : null;
  const isCreator = !!viewerUserId && activity.creatorId === viewerUserId;
  const remainingSeats = calculateRemainingSeats(activity.currentParticipants, activity.maxParticipants);
  const isFull = remainingSeats === 0;
  const waitlistCount = participantsList.filter((item) => item.status === 'waitlist').length;
  const canJoin = canExecuteJoinAction({
    status: activity.status,
    startAt: activity.startAt,
    isCreator,
    participantStatus,
  });
  const joinState: ActivityJoinState = isCreator
    ? 'creator'
    : participantStatus === 'joined'
      ? 'joined'
      : participantStatus === 'waitlist'
        ? 'waitlisted'
        : canJoin
          ? 'not_joined'
          : 'closed';
  const isArchived = calculateIsArchived(activity.startAt);

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
    waitlistCount,
    remainingSeats,
    isFull,
    status: activity.status,
    joinState,
    canJoin,
    createdAt: activity.createdAt.toISOString(),
    updatedAt: activity.updatedAt.toISOString(),
    isArchived,
    groupOpenId: null,
    dynamicMessageId: null,
    conversionTips: buildActivityConversionTips({
      title: activity.title,
      isFull,
      canJoin,
      isArchived,
    }),
    creator: creator || null,
    participants: participantsList.map((item) => ({
      id: item.id,
      userId: item.userId,
      status: item.status,
      joinedAt: item.joinedAt?.toISOString() || null,
      user: item.userInfo || null,
    })),
  };
}

export async function getPublicActivityById(activityId: string): Promise<PublicActivityResponse | null> {
  const publicStatuses: ActivityStatus[] = ['active', 'completed'];

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
    .where(and(
      eq(activities.id, activityId),
      inArray(activities.status, publicStatuses),
    ))
    .limit(1);

  if (!activity) return null;

  const remainingSeats = calculateRemainingSeats(activity.currentParticipants, activity.maxParticipants);
  const isFull = remainingSeats === 0;
  const canJoin = activity.status === 'active' && activity.startAt > new Date();
  const isArchived = calculateIsArchived(activity.startAt);

  const participantList = await db
    .select({
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
    })
    .from(participants)
    .innerJoin(users, eq(participants.userId, users.id))
    .where(and(eq(participants.activityId, activityId), eq(participants.status, 'joined')))
    .limit(10);

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
    remainingSeats,
    isFull,
    theme: activity.theme,
    themeConfig: activity.themeConfig,
    isArchived,
    canJoin,
    creator: {
      nickname: activity.creatorNickname,
      avatarUrl: activity.creatorAvatarUrl,
    },
    participants: participantList,
    recentMessages: recentMessages.reverse().map((item) => ({
      senderNickname: item.senderNickname,
      senderAvatar: item.senderAvatar,
      content: item.content,
      createdAt: item.createdAt.toISOString(),
    })),
    conversionTips: buildActivityConversionTips({
      title: activity.title,
      isFull,
      canJoin,
      isArchived,
    }),
  };
}

export async function getNearbyActivities(
  query: NearbyActivitiesQuery
): Promise<NearbyActivitiesResponse> {
  const { lat, lng, type, keyword, radius = 5000, limit = 20 } = query;
  const now = new Date();
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
        sql`ST_DWithin(
          ${activities.location}::geography,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          ${radius}
        )`,
        keywordPattern
          ? sql`(
              ${activities.title} ILIKE ${keywordPattern} ESCAPE '\\'
              OR ${activities.locationName} ILIKE ${keywordPattern} ESCAPE '\\'
              OR ${activities.locationHint} ILIKE ${keywordPattern} ESCAPE '\\'
            )`
          : sql`true`,
        type ? eq(activities.type, type) : sql`true`
      )
    )
    .orderBy(sql`distance ASC`)
    .limit(limit);

  const data: NearbyActivityItem[] = nearbyActivities.map((item) => {
    const remainingSeats = calculateRemainingSeats(item.currentParticipants, item.maxParticipants);

    return {
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
      remainingSeats,
      isFull: remainingSeats === 0,
      status: item.status,
      distance: Math.round(item.distance || 0),
      creator: {
        id: item.creatorId,
        nickname: item.creatorNickname,
        avatarUrl: item.creatorAvatar,
      },
    };
  });

  return {
    data,
    total: data.length,
    center: { lat, lng },
    radius,
  };
}

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

export async function getActivityStats(
  query: ActivityStatsQuery
): Promise<ActivityOverviewStats | ActivityTypeDistribution> {
  if (query.type === 'distribution') {
    return getActivityTypeDistribution();
  }
  return getActivityOverviewStats();
}

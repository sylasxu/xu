// User Service - 纯业务逻辑 (纯 RESTful)
import { db, users, activities, eq, or, ilike, count, desc, sql, gte, lte, and, not, toTimestamp, inArray } from '@juchang/db';
import type { 
  UserResponse,
  QuotaResponse, 
  UserListQuery, 
  UserListResponse, 
  UpdateUserRequest,
  UserOverviewStats,
  UserGrowthItem,
  UserStatsQuery,
} from './user.model';

type UserQuotaExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEFAULT_DAILY_AI_CREATE_QUOTA = 3;
const UNLIMITED_AI_CREATE_QUOTA = 999;

function getQuotaResetPoint(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isUnlimitedQuota(quota: number): boolean {
  return quota >= UNLIMITED_AI_CREATE_QUOTA;
}

async function getQuotaSourceUser(id: string, executor: UserQuotaExecutor = db) {
  const [user] = await executor
    .select({
      id: users.id,
      aiCreateQuotaToday: users.aiCreateQuotaToday,
      aiQuotaResetAt: users.aiQuotaResetAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user ?? null;
}

async function syncQuotaToToday(
  id: string,
  executor: UserQuotaExecutor = db,
): Promise<{
  id: string;
  aiCreateQuotaToday: number;
  aiQuotaResetAt: Date | null;
} | null> {
  const user = await getQuotaSourceUser(id, executor);
  if (!user) {
    return null;
  }

  const now = new Date();
  const today = getQuotaResetPoint(now);

  if (user.aiQuotaResetAt && user.aiQuotaResetAt >= today) {
    return user;
  }

  const resetQuota = isUnlimitedQuota(user.aiCreateQuotaToday)
    ? user.aiCreateQuotaToday
    : DEFAULT_DAILY_AI_CREATE_QUOTA;

  await executor
    .update(users)
    .set({
      aiCreateQuotaToday: resetQuota,
      aiQuotaResetAt: today,
      updatedAt: now,
    })
    .where(eq(users.id, id));

  return {
    ...user,
    aiCreateQuotaToday: resetQuota,
    aiQuotaResetAt: today,
  };
}

/**
 * 根据 ID 获取用户详情
 */
export async function getUserById(id: string): Promise<UserResponse | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) return null;

  // 排除敏感字段
  const { wxOpenId, ...rest } = user;
  return rest;
}

/**
 * 获取用户列表 (分页、搜索)
 */
export async function getUserList(query: UserListQuery): Promise<UserListResponse> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const offset = (page - 1) * limit;

  // 构建搜索条件
  let whereCondition = undefined;
  if (query.search) {
    const searchPattern = `%${query.search}%`;
    whereCondition = or(
      ilike(users.nickname, searchPattern),
      ilike(users.phoneNumber, searchPattern)
    );
  }

  // 查询用户列表
  // v4.6: 默认按 activitiesCreatedCount 倒序（超级群主排序）
  const userList = await db
    .select()
    .from(users)
    .where(whereCondition)
    .orderBy(desc(users.activitiesCreatedCount), desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  // 查询总数
  const [totalResult] = await db
    .select({ total: count() })
    .from(users)
    .where(whereCondition);

  // 排除敏感字段 wxOpenId
  const sanitizedList = userList.map(({ wxOpenId, ...rest }) => rest);

  return {
    data: sanitizedList,
    total: totalResult?.total ?? 0,
    page,
    limit,
  };
}

/**
 * 更新用户信息 (PUT /users/:id)
 */
export async function updateUser(
  id: string, 
  data: UpdateUserRequest
): Promise<UserResponse | null> {
  // 检查用户是否存在
  const existingUser = await getUserById(id);
  if (!existingUser) return null;

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.nickname !== undefined) {
    updateData.nickname = data.nickname;
  }
  if (data.avatarUrl !== undefined) {
    updateData.avatarUrl = data.avatarUrl;
  }
  if (data.workingMemory !== undefined) {
    updateData.workingMemory = data.workingMemory;
  }

  await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, id));

  // 返回更新后的用户
  return getUserById(id);
}

/**
 * 删除用户 (DELETE /users/:id)
 * 注意：这是硬删除，会级联删除相关数据
 */
export async function deleteUser(id: string): Promise<boolean> {
  // 检查用户是否存在
  const existingUser = await getUserById(id);
  if (!existingUser) return false;

  // 删除用户
  await db.delete(users).where(eq(users.id, id));
  
  return true;
}

/**
 * 获取用户今日额度
 */
export async function getQuota(id: string, executor: UserQuotaExecutor = db): Promise<QuotaResponse | null> {
  const user = await syncQuotaToToday(id, executor);
  if (!user) return null;

  return {
    aiCreateQuota: user.aiCreateQuotaToday,
    resetAt: user.aiQuotaResetAt?.toISOString() || null,
  };
}

/**
 * 扣减 AI 创建额度
 * 返回 true 表示扣减成功，false 表示额度不足
 */
export async function deductAiCreateQuota(id: string, executor: UserQuotaExecutor = db): Promise<boolean> {
  const now = new Date();
  const today = getQuotaResetPoint(now);
  const todayTimestamp = toTimestamp(today);

  const updated = await executor
    .update(users)
    .set({
      aiCreateQuotaToday: sql<number>`
        CASE
          WHEN ${users.aiCreateQuotaToday} >= ${UNLIMITED_AI_CREATE_QUOTA} THEN ${users.aiCreateQuotaToday}
          WHEN ${users.aiQuotaResetAt} IS NULL OR ${users.aiQuotaResetAt} < ${todayTimestamp} THEN ${DEFAULT_DAILY_AI_CREATE_QUOTA - 1}
          ELSE ${users.aiCreateQuotaToday} - 1
        END
      `,
      aiQuotaResetAt: sql`
        CASE
          WHEN ${users.aiQuotaResetAt} IS NULL OR ${users.aiQuotaResetAt} < ${todayTimestamp} THEN ${todayTimestamp}
          ELSE ${users.aiQuotaResetAt}
        END
      `,
      updatedAt: now,
    })
    .where(and(
      eq(users.id, id),
      sql`
        ${users.aiCreateQuotaToday} >= ${UNLIMITED_AI_CREATE_QUOTA}
        OR ${users.aiQuotaResetAt} IS NULL
        OR ${users.aiQuotaResetAt} < ${todayTimestamp}
        OR ${users.aiCreateQuotaToday} > 0
      `,
    ))
    .returning({ id: users.id });

  return updated.length > 0;
}

/**
 * 设置用户 AI 额度（Admin 用）
 * @param id 用户 ID
 * @param quota 新的额度值（999 表示无限）
 */
export async function setUserQuota(id: string, quota: number): Promise<UserResponse | null> {
  const existingUser = await getUserById(id);
  if (!existingUser) return null;

  const now = new Date();
  const resetAt = getQuotaResetPoint(now);

  await db
    .update(users)
    .set({
      aiCreateQuotaToday: quota,
      aiQuotaResetAt: resetAt,
      updatedAt: now,
    })
    .where(eq(users.id, id));

  return getUserById(id);
}

/**
 * 批量设置用户 AI 额度（Admin 用）
 * @param userIds 用户 ID 列表
 * @param quota 新的额度值
 */
export async function setUserQuotaBatch(userIds: string[], quota: number): Promise<{ updatedCount: number }> {
  if (userIds.length === 0) {
    return { updatedCount: 0 };
  }

  const now = new Date();
  const resetAt = getQuotaResetPoint(now);

  const result = await db
    .update(users)
    .set({
      aiCreateQuotaToday: quota,
      aiQuotaResetAt: resetAt,
      updatedAt: now,
    })
    .where(inArray(users.id, userIds))
    .returning({ id: users.id });

  return { updatedCount: result.length };
}
/**
 * 根据用户 ID 获取昵称
 */
export async function getUserNickname(userId: string): Promise<string | undefined> {
  const [user] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.nickname || undefined;
}

// ==========================================
// 用户统计 (从 dashboard 迁移)
// ==========================================

/**
 * 获取用户概览统计
 */
export async function getUserOverviewStats(): Promise<UserOverviewStats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const [
      totalUsersResult,
      todayNewUsersResult,
      totalCreatorsResult,
    ] = await Promise.all([
      db.select({ count: count() }).from(users),
      db.select({ count: count() })
        .from(users)
        .where(gte(users.createdAt, today)),
      db.select({ count: count() })
        .from(activities)
        .where(not(eq(activities.status, 'draft')))
        .groupBy(activities.creatorId)
        .then(results => [{ count: results.length }]),
    ]);

    const totalUsers = totalUsersResult[0]?.count || 0;

    return {
      totalUsers,
      todayNewUsers: todayNewUsersResult[0]?.count || 0,
      activeUsers: Math.floor(totalUsers * 0.3), // MVP: 估算活跃用户
      totalCreators: totalCreatorsResult[0]?.count || 0,
    };
  } catch (error) {
    console.error('获取用户概览统计失败:', error);
    return {
      totalUsers: 0,
      todayNewUsers: 0,
      activeUsers: 0,
      totalCreators: 0,
    };
  }
}

/**
 * 获取用户增长趋势数据（过去N天）
 */
export async function getUserGrowthTrend(days: number = 30): Promise<UserGrowthItem[]> {
  try {
    const result: UserGrowthItem[] = [];
    const now = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      // 获取截止到该日期的总用户数
      const [totalResult] = await db
        .select({ count: count() })
        .from(users)
        .where(lte(users.createdAt, nextDate));
      
      // 获取当天新增用户数
      const [newResult] = await db
        .select({ count: count() })
        .from(users)
        .where(and(
          gte(users.createdAt, date),
          lte(users.createdAt, nextDate)
        ));
      
      result.push({
        date: date.toISOString().split('T')[0],
        totalUsers: totalResult?.count || 0,
        newUsers: newResult?.count || 0,
        activeUsers: Math.floor((totalResult?.count || 0) * 0.3), // MVP: 估算活跃用户
      });
    }
    
    return result;
  } catch (error) {
    console.error('获取用户增长趋势失败:', error);
    return [];
  }
}

/**
 * 用户统计入口 - 根据类型返回不同统计
 */
export async function getUserStats(query: UserStatsQuery): Promise<UserOverviewStats | UserGrowthItem[]> {
  if (query.type === 'growth') {
    return getUserGrowthTrend(query.period);
  }
  return getUserOverviewStats();
}

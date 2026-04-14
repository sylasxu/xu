// User Service - 纯业务逻辑 (纯 RESTful)
import { db, users, eq, or, ilike, count, desc, sql, toTimestamp, and } from '@xu/db';
import type { 
  UserResponse,
  UserListQuery, 
  UserListResponse, 
  UpdateUserRequest,
} from './user.model';

type UserQuotaExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type UserQuotaSnapshot = {
  aiCreateQuota: number;
  resetAt: string | null;
};

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

export async function getQuota(
  id: string,
  executor: UserQuotaExecutor = db,
): Promise<UserQuotaSnapshot | null> {
  const user = await syncQuotaToToday(id, executor);
  if (!user) {
    return null;
  }

  return {
    aiCreateQuota: user.aiCreateQuotaToday,
    resetAt: user.aiQuotaResetAt?.toISOString() ?? null,
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
  const userList = await db
    .select()
    .from(users)
    .where(whereCondition)
    .orderBy(desc(users.createdAt))
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
 * 根据用户 ID 获取昵称
 */
export async function getUserNickname(userId: string): Promise<string | undefined> {
  const [user] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.nickname || undefined;
}

// User Service - 纯业务逻辑 (纯 RESTful)
import { db, users, eq, or, ilike, count, desc, sql } from '@juchang/db';
import type { 
  UserResponse,
  QuotaResponse, 
  UserListQuery, 
  UserListResponse, 
  UpdateUserRequest 
} from './user.model';

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
export async function getQuota(id: string): Promise<QuotaResponse | null> {
  const user = await getUserById(id);
  if (!user) return null;

  // 检查是否需要重置额度（跨天重置）
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  let aiCreateQuota = user.aiCreateQuotaToday;
  let resetAt = user.aiQuotaResetAt?.toISOString() || null;

  // 如果上次重置时间不是今天，重置额度
  if (!user.aiQuotaResetAt || user.aiQuotaResetAt < today) {
    aiCreateQuota = 3; // 默认每日 3 次
    resetAt = today.toISOString();
    
    // 更新数据库
    await db
      .update(users)
      .set({
        aiCreateQuotaToday: 3,
        aiQuotaResetAt: today,
        updatedAt: now,
      })
      .where(eq(users.id, id));
  }

  return {
    aiCreateQuota,
    resetAt,
  };
}

/**
 * 扣减 AI 创建额度
 * 返回 true 表示扣减成功，false 表示额度不足
 */
export async function deductAiCreateQuota(id: string): Promise<boolean> {
  const quota = await getQuota(id);
  if (!quota || quota.aiCreateQuota <= 0) {
    return false;
  }

  await db
    .update(users)
    .set({
      aiCreateQuotaToday: quota.aiCreateQuota - 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));

  return true;
}

/**
 * 设置用户 AI 额度（Admin 用）
 * @param id 用户 ID
 * @param quota 新的额度值（999 表示无限）
 */
export async function setUserQuota(id: string, quota: number): Promise<UserResponse | null> {
  const existingUser = await getUserById(id);
  if (!existingUser) return null;

  await db
    .update(users)
    .set({
      aiCreateQuotaToday: quota,
      updatedAt: new Date(),
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

  const result = await db
    .update(users)
    .set({
      aiCreateQuotaToday: quota,
      updatedAt: new Date(),
    })
    .where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
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


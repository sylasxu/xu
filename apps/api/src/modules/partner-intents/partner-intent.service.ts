import {
  db,
  partnerIntents,
  users,
  eq,
  and,
  desc,
  count,
  ilike,
  or,
} from '@juchang/db';
import type { PartnerIntentListItem, PartnerIntentListQuery, PartnerIntentListResponse } from './partner-intent.model';

export async function getPartnerIntentList(
  query: PartnerIntentListQuery,
): Promise<PartnerIntentListResponse> {
  const { page = 1, limit = 20, status, activityType, userId, search } = query;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (status) {
    conditions.push(eq(partnerIntents.status, status));
  }

  if (activityType) {
    conditions.push(eq(partnerIntents.activityType, activityType));
  }

  if (userId) {
    conditions.push(eq(partnerIntents.userId, userId));
  }

  if (search) {
    conditions.push(
      or(
        ilike(users.nickname, `%${search}%`),
        ilike(partnerIntents.locationHint, `%${search}%`),
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: partnerIntents.id,
        userId: partnerIntents.userId,
        activityType: partnerIntents.activityType,
        locationHint: partnerIntents.locationHint,
        timePreference: partnerIntents.timePreference,
        status: partnerIntents.status,
        createdAt: partnerIntents.createdAt,
        updatedAt: partnerIntents.updatedAt,
        expiresAt: partnerIntents.expiresAt,
        metaData: partnerIntents.metaData,
        nickname: users.nickname,
        avatarUrl: users.avatarUrl,
      })
      .from(partnerIntents)
      .innerJoin(users, eq(partnerIntents.userId, users.id))
      .where(where)
      .orderBy(desc(partnerIntents.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(partnerIntents)
      .innerJoin(users, eq(partnerIntents.userId, users.id))
      .where(where),
  ]);

  const data: PartnerIntentListItem[] = rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    activityType: row.activityType,
    locationHint: row.locationHint,
    timePreference: row.timePreference,
    status: row.status,
    tags: Array.isArray(row.metaData?.tags) ? row.metaData.tags : [],
    rawInput: typeof row.metaData?.rawInput === 'string' ? row.metaData.rawInput : null,
    nickname: row.nickname,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));

  return {
    data,
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  };
}

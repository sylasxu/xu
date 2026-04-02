import {
  db,
  intentMatches,
  users,
  eq,
  and,
  desc,
  count,
  ilike,
  or,
  sql,
} from '@juchang/db';
import type { IntentMatchListItem, IntentMatchListQuery, IntentMatchListResponse } from './intent-match.model';

export async function getIntentMatchList(
  query: IntentMatchListQuery,
): Promise<IntentMatchListResponse> {
  const { page = 1, limit = 20, outcome, activityType, userId, tempOrganizerId, search } = query;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (outcome) {
    conditions.push(eq(intentMatches.outcome, outcome));
  }

  if (activityType) {
    conditions.push(eq(intentMatches.activityType, activityType));
  }

  if (tempOrganizerId) {
    conditions.push(eq(intentMatches.tempOrganizerId, tempOrganizerId));
  }

  if (userId) {
    conditions.push(sql`${userId} = ANY(${intentMatches.userIds})`);
  }

  if (search) {
    conditions.push(
      or(
        ilike(users.nickname, `%${search}%`),
        ilike(intentMatches.centerLocationHint, `%${search}%`),
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: intentMatches.id,
        activityType: intentMatches.activityType,
        matchScore: intentMatches.matchScore,
        commonTags: intentMatches.commonTags,
        centerLocationHint: intentMatches.centerLocationHint,
        tempOrganizerId: intentMatches.tempOrganizerId,
        intentIds: intentMatches.intentIds,
        userIds: intentMatches.userIds,
        activityId: intentMatches.activityId,
        outcome: intentMatches.outcome,
        confirmDeadline: intentMatches.confirmDeadline,
        matchedAt: intentMatches.matchedAt,
        confirmedAt: intentMatches.confirmedAt,
        createdAt: intentMatches.createdAt,
        organizerNickname: users.nickname,
        organizerAvatarUrl: users.avatarUrl,
      })
      .from(intentMatches)
      .innerJoin(users, eq(intentMatches.tempOrganizerId, users.id))
      .where(where)
      .orderBy(desc(intentMatches.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(intentMatches)
      .innerJoin(users, eq(intentMatches.tempOrganizerId, users.id))
      .where(where),
  ]);

  const data: IntentMatchListItem[] = rows.map((row) => ({
    id: row.id,
    activityType: row.activityType,
    matchScore: row.matchScore,
    commonTags: Array.isArray(row.commonTags) ? row.commonTags : [],
    centerLocationHint: row.centerLocationHint,
    tempOrganizerId: row.tempOrganizerId,
    intentIds: Array.isArray(row.intentIds) ? row.intentIds : [],
    userIds: Array.isArray(row.userIds) ? row.userIds : [],
    activityId: row.activityId,
    outcome: row.outcome,
    confirmDeadline: row.confirmDeadline.toISOString(),
    organizerNickname: row.organizerNickname,
    organizerAvatarUrl: row.organizerAvatarUrl,
    matchedAt: row.matchedAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    data,
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  };
}

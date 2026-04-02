import { Elysia, t, type Static } from 'elysia';
import { selectIntentMatchSchema } from '@juchang/db';

const ActivityTypeSchema = t.Union([
  t.Literal('food'),
  t.Literal('entertainment'),
  t.Literal('sports'),
  t.Literal('boardgame'),
  t.Literal('other'),
]);

const IntentMatchOutcomeSchema = t.Union([
  t.Literal('pending'),
  t.Literal('confirmed'),
  t.Literal('expired'),
  t.Literal('cancelled'),
]);

const IntentMatchListQuerySchema = t.Object({
  page: t.Optional(t.Number({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20 })),
  outcome: t.Optional(IntentMatchOutcomeSchema),
  activityType: t.Optional(ActivityTypeSchema),
  userId: t.Optional(t.String({ format: 'uuid', description: '显式指定目标用户 ID（匹配成员之一）' })),
  tempOrganizerId: t.Optional(t.String({ format: 'uuid', description: '临时召集人用户 ID' })),
  search: t.Optional(t.String({ minLength: 1, maxLength: 50, description: '按召集人昵称或地点搜索' })),
});

const IntentMatchListItemSchema = t.Composite([
  t.Omit(selectIntentMatchSchema, ['centerLocation', 'confirmDeadline', 'matchedAt', 'confirmedAt', 'createdAt']),
  t.Object({
    organizerNickname: t.Union([t.String(), t.Null()]),
    organizerAvatarUrl: t.Union([t.String(), t.Null()]),
    confirmDeadline: t.String(),
    matchedAt: t.String(),
    confirmedAt: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
  }),
]);

const IntentMatchListResponseSchema = t.Object({
  data: t.Array(IntentMatchListItemSchema),
  total: t.Number(),
  page: t.Number(),
  limit: t.Number(),
});

const ErrorResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
});

export const intentMatchModel = new Elysia({ name: 'intentMatchModel' }).model({
  'intentMatch.listQuery': IntentMatchListQuerySchema,
  'intentMatch.listItem': IntentMatchListItemSchema,
  'intentMatch.listResponse': IntentMatchListResponseSchema,
  'intentMatch.error': ErrorResponseSchema,
});

export type IntentMatchListQuery = Static<typeof IntentMatchListQuerySchema>;
export type IntentMatchListItem = Static<typeof IntentMatchListItemSchema>;
export type IntentMatchListResponse = Static<typeof IntentMatchListResponseSchema>;
export type ErrorResponse = Static<typeof ErrorResponseSchema>;

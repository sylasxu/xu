import { Elysia, t, type Static } from 'elysia';
import { selectPartnerIntentSchema } from '@juchang/db';

const ActivityTypeSchema = t.Union([
  t.Literal('food'),
  t.Literal('entertainment'),
  t.Literal('sports'),
  t.Literal('boardgame'),
  t.Literal('other'),
]);

const PartnerIntentStatusSchema = t.Union([
  t.Literal('active'),
  t.Literal('matched'),
  t.Literal('expired'),
  t.Literal('cancelled'),
]);

const PartnerIntentListQuerySchema = t.Object({
  page: t.Optional(t.Number({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20 })),
  status: t.Optional(PartnerIntentStatusSchema),
  activityType: t.Optional(ActivityTypeSchema),
  userId: t.Optional(t.String({ format: 'uuid', description: '显式指定目标用户 ID' })),
  search: t.Optional(t.String({ minLength: 1, maxLength: 50, description: '按昵称或地点搜索' })),
});

const PartnerIntentListItemSchema = t.Composite([
  t.Omit(selectPartnerIntentSchema, ['location', 'metaData', 'createdAt', 'updatedAt', 'expiresAt']),
  t.Object({
    tags: t.Array(t.String()),
    rawInput: t.Union([t.String(), t.Null()]),
    nickname: t.Union([t.String(), t.Null()]),
    avatarUrl: t.Union([t.String(), t.Null()]),
    createdAt: t.String(),
    updatedAt: t.String(),
    expiresAt: t.String(),
  }),
]);

const PartnerIntentListResponseSchema = t.Object({
  data: t.Array(PartnerIntentListItemSchema),
  total: t.Number(),
  page: t.Number(),
  limit: t.Number(),
});

const ErrorResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
});

export const partnerIntentModel = new Elysia({ name: 'partnerIntentModel' }).model({
  'partnerIntent.listQuery': PartnerIntentListQuerySchema,
  'partnerIntent.listItem': PartnerIntentListItemSchema,
  'partnerIntent.listResponse': PartnerIntentListResponseSchema,
  'partnerIntent.error': ErrorResponseSchema,
});

export type PartnerIntentListQuery = Static<typeof PartnerIntentListQuerySchema>;
export type PartnerIntentListItem = Static<typeof PartnerIntentListItemSchema>;
export type PartnerIntentListResponse = Static<typeof PartnerIntentListResponseSchema>;
export type ErrorResponse = Static<typeof ErrorResponseSchema>;

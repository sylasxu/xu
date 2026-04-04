// Common Model - 共享 Schema 定义
// 遵循项目规范：禁止手动重复定义通用 Schema

import { Elysia, t, type Static } from 'elysia';

/**
 * ==========================================
 * 通用响应 Schema
 * ==========================================
 */

/** 标准错误响应 */
export const ErrorResponseSchema = t.Object({
  code: t.Number({ description: 'HTTP 状态码' }),
  msg: t.String({ description: '错误消息' }),
}, { additionalProperties: false });

/** 标准成功响应（无数据） */
export const SuccessResponseSchema = t.Object({
  success: t.Literal(true),
  msg: t.String(),
});

/** 带 ID 的成功响应 */
export const CreatedResponseSchema = t.Object({
  success: t.Literal(true),
  msg: t.String(),
  id: t.String({ format: 'uuid' }),
});

/** 标准列表响应（泛型模式） */
export function createListResponseSchema<T extends ReturnType<typeof t.Object>>(
  itemSchema: T
) {
  return t.Object({
    items: t.Array(itemSchema),
    total: t.Number({ description: '总数' }),
    hasMore: t.Optional(t.Boolean({ description: '是否还有更多' })),
    cursor: t.Optional(t.Union([t.String(), t.Null()], { description: '下一页游标' })),
  });
}

/** 分页查询参数 */
export const PaginationQuerySchema = t.Object({
  cursor: t.Optional(t.String({ description: '分页游标' })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20, description: '返回数量' })),
});

/** ID 路径参数 */
export const IdParamsSchema = t.Object({
  id: t.String({ format: 'uuid', description: '资源 ID' }),
});

/** 用户 ID 查询参数（显式参数规范） */
export const UserIdQuerySchema = t.Object({
  userId: t.String({ format: 'uuid', description: '目标用户 ID（普通用户仅可传本人）' }),
});

/**
 * ==========================================
 * 通用类型导出
 * ==========================================
 */

export type ErrorResponse = Static<typeof ErrorResponseSchema>;
export type SuccessResponse = Static<typeof SuccessResponseSchema>;
export type CreatedResponse = Static<typeof CreatedResponseSchema>;
export type PaginationQuery = Static<typeof PaginationQuerySchema>;
export type IdParams = Static<typeof IdParamsSchema>;
export type UserIdQuery = Static<typeof UserIdQuerySchema>;

/**
 * ==========================================
 * Elysia Model 插件
 * ==========================================
 */

export const commonModel = new Elysia({ name: 'commonModel' })
  .model({
    // 响应 Schema
    'common.error': ErrorResponseSchema,
    'common.success': SuccessResponseSchema,
    'common.created': CreatedResponseSchema,
    // 查询参数
    'common.pagination': PaginationQuerySchema,
    'common.idParams': IdParamsSchema,
    'common.userIdQuery': UserIdQuerySchema,
  });

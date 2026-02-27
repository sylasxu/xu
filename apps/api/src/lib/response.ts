import { t, type TSchema } from 'elysia';

// 列表响应工厂
export function ListResponseSchema<T extends TSchema>(itemSchema: T) {
  return t.Object({
    items: t.Array(itemSchema),
    total: t.Number(),
  });
}

// 带游标的列表响应工厂
export function CursorListResponseSchema<T extends TSchema>(itemSchema: T) {
  return t.Object({
    items: t.Array(itemSchema),
    total: t.Number(),
    hasMore: t.Boolean(),
    cursor: t.Union([t.String(), t.Null()]),
  });
}

// 统一错误响应
export const ErrorResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// 统一成功响应
export const SuccessResponseSchema = t.Object({
  success: t.Literal(true),
  msg: t.String(),
});

// 创建成功响应
export const CreateSuccessResponseSchema = t.Intersect([
  SuccessResponseSchema,
  t.Object({ id: t.String() }),
]);

// 批量操作成功响应
export const BatchSuccessResponseSchema = t.Intersect([
  SuccessResponseSchema,
  t.Object({ count: t.Number() }),
]);

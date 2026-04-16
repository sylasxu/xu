// User Model - TypeBox schemas (纯 RESTful)
import { Elysia, t, type Static } from 'elysia';
import { ErrorResponseSchema } from "../../common/common.model";
import { selectUserSchema } from '@xu/db';

/**
 * User Model Plugin
 * 统一的用户模块 Schema
 */

// ============ 响应 Schema ============

// 用户响应 (排除敏感字段)
export const UserResponseSchema = t.Omit(selectUserSchema, ['wxOpenId']);


// 成功响应
const SuccessResponse = t.Object({
  success: t.Boolean(),
  msg: t.String(),
});

// ============ 请求 Schema ============

// 用户列表查询参数
export const UserListQuerySchema = t.Object({
  page: t.Optional(t.Number({ minimum: 1, default: 1, description: '页码' })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20, description: '每页数量' })),
  search: t.Optional(t.String({ description: '搜索昵称或手机号' })),
});

// 用户列表响应
export const UserListResponseSchema = t.Object({
  data: t.Array(UserResponseSchema),
  total: t.Number({ description: '总数' }),
  page: t.Number({ description: '当前页码' }),
  limit: t.Number({ description: '每页数量' }),
});

export const UserQuotaResponseSchema = t.Object({
  aiCreateQuota: t.Number({ description: '今日剩余 AI 创建活动额度' }),
  resetAt: t.Union([t.String(), t.Null()], { description: '额度重置时间' }),
});

// 更新用户请求体
export const UpdateUserRequestSchema = t.Object({
  nickname: t.Optional(t.String({ maxLength: 50, description: '昵称' })),
  avatarUrl: t.Optional(t.String({ maxLength: 500, description: '头像URL' })),
});

// ============ 注册到 Elysia ============

export const userModel = new Elysia({ name: 'userModel' })
  .model({
    'user.response': UserResponseSchema,
    'common.error': ErrorResponseSchema,
    'user.success': SuccessResponse,
    'user.listQuery': UserListQuerySchema,
    'user.listResponse': UserListResponseSchema,
    'user.quotaResponse': UserQuotaResponseSchema,
    'user.updateRequest': UpdateUserRequestSchema,
  });

// ============ 导出 TS 类型 ============

export type UserResponse = Static<typeof UserResponseSchema>;
export type SuccessResponse = Static<typeof SuccessResponse>;
export type UserListQuery = Static<typeof UserListQuerySchema>;
export type UserListResponse = Static<typeof UserListResponseSchema>;
export type UserQuotaResponse = Static<typeof UserQuotaResponseSchema>;
export type UpdateUserRequest = Static<typeof UpdateUserRequestSchema>;

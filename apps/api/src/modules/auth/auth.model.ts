// Auth Model - TypeBox schemas and types (MVP 简化版)
import { Elysia, t, type Static } from 'elysia';
import { selectUserSchema } from '@juchang/db';

// 微信登录请求
const WxLoginRequest = t.Object({
  code: t.String({ description: '微信登录凭证' }),
});

// 绑定手机号请求 (延迟验证)
const BindPhoneRequest = t.Object({
  code: t.String({ description: 'getPhoneNumber 返回的 code' }),
});

// 绑定手机号响应
const BindPhoneResponse = t.Object({
  success: t.Boolean(),
  phoneNumber: t.String(),
});

// 登录响应 - 使用 DB schema 派生
const LoginResponse = t.Object({
  user: selectUserSchema,
  token: t.String({ description: 'JWT Token' }),
  isNewUser: t.Boolean({ description: '是否新用户' }),
});

// Admin 手机号登录请求
const AdminPhoneLoginRequest = t.Object({
  phone: t.String({ pattern: '^1[3-9]\\d{9}$', description: '手机号' }),
  code: t.String({ minLength: 4, maxLength: 6, description: '验证码' }),
});

const BootstrapTestUsersRequest = t.Object({
  phone: t.String({ pattern: '^1[3-9]\\d{9}$', description: '管理员手机号' }),
  code: t.String({ minLength: 4, maxLength: 6, description: '管理员超级验证码' }),
  count: t.Optional(t.Number({ minimum: 1, maximum: 5, default: 5, description: '生成账号数量，最多 5 个' })),
});

const BootstrapTestUsersResponse = t.Object({
  users: t.Array(t.Object({
    user: selectUserSchema,
    token: t.String({ description: '测试账号 JWT Token' }),
    isNewUser: t.Boolean({ description: '是否为本次新建账号' }),
  })),
  msg: t.String(),
});

// Admin 登录响应
const AdminLoginResponse = t.Object({
  user: t.Object({
    id: t.String(),
    phoneNumber: t.String(),
    nickname: t.Union([t.String(), t.Null()]),
    avatarUrl: t.Union([t.String(), t.Null()]),
    role: t.Object({
      id: t.String(),
      name: t.String(),
      permissions: t.Array(t.Object({
        resource: t.String(),
        actions: t.Array(t.String()),
      })),
    }),
  }),
  token: t.String({ description: 'JWT Token' }),
  exp: t.Number({ description: 'Token 过期时间戳 (秒)' }),
});

// 错误响应
const ErrorResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// 注册到 Elysia Model Plugin
export const authModel = new Elysia({ name: 'authModel' })
  .model({
    'auth.wxLogin': WxLoginRequest,
    'auth.bindPhone': BindPhoneRequest,
    'auth.bindPhoneResponse': BindPhoneResponse,
    'auth.loginResponse': LoginResponse,
    'auth.adminPhoneLogin': AdminPhoneLoginRequest,
    'auth.adminLoginResponse': AdminLoginResponse,
    'auth.bootstrapTestUsers': BootstrapTestUsersRequest,
    'auth.bootstrapTestUsersResponse': BootstrapTestUsersResponse,
    'auth.error': ErrorResponse,
  });

// 导出 TS 类型
export type WxLoginRequest = Static<typeof WxLoginRequest>;
export type BindPhoneRequest = Static<typeof BindPhoneRequest>;
export type BindPhoneResponse = Static<typeof BindPhoneResponse>;
export type LoginResponse = Static<typeof LoginResponse>;
export type AdminPhoneLoginRequest = Static<typeof AdminPhoneLoginRequest>;
export type AdminLoginResponse = Static<typeof AdminLoginResponse>;
export type BootstrapTestUsersRequest = Static<typeof BootstrapTestUsersRequest>;
export type BootstrapTestUsersResponse = Static<typeof BootstrapTestUsersResponse>;
export type ErrorResponse = Static<typeof ErrorResponse>;

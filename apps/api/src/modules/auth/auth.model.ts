// Auth Model - TypeBox schemas and types
import { Elysia, t, type Static } from 'elysia';
import { ErrorResponseSchema, type ErrorResponse } from "../../common/common.model";
import { selectUserSchema } from '@xu/db';

const AuthPermission = t.Object({
  resource: t.String(),
  actions: t.Array(t.String()),
});

const AuthRole = t.Object({
  id: t.String(),
  name: t.String(),
  permissions: t.Array(AuthPermission),
});

const LoginUser = t.Composite([
  selectUserSchema,
  t.Object({
    role: t.Optional(AuthRole),
  }),
]);

// 微信 code 登录请求
const WechatCodeLoginRequest = t.Object(
  {
    code: t.String({ description: '微信登录凭证' }),
    grantType: t.Optional(t.Literal('wechat_code')),
    phoneNumber: t.Optional(t.Union([t.String(), t.Null()])),
    nickname: t.Optional(t.Union([t.String(), t.Null()])),
    avatarUrl: t.Optional(t.Union([t.String(), t.Null()])),
  },
  { additionalProperties: true }
);

// 手机号验证码登录请求
const PhoneOtpLoginRequest = t.Object(
  {
    grantType: t.Optional(t.Literal('phone_otp')),
    audience: t.Optional(t.Union([
      t.Literal('admin'),
      t.Literal('user'),
    ], { description: '登录用途：admin=受保护运维登录，user=H5 普通用户动作闸门登录' })),
    phone: t.String({ pattern: '^1[3-9]\\d{9}$', description: '手机号' }),
    code: t.String({ minLength: 4, maxLength: 6, description: '验证码' }),
  },
  { additionalProperties: true }
);

const LoginRequest = t.Union([
  WechatCodeLoginRequest,
  PhoneOtpLoginRequest,
]);

// 绑定手机号请求 (延迟验证)
const BindPhoneRequest = t.Object({
  code: t.String({ description: 'getPhoneNumber 返回的 code' }),
});

// 绑定手机号响应
const BindPhoneResponse = t.Object({
  success: t.Boolean(),
  phoneNumber: t.String(),
});

// 登录响应
const LoginResponse = t.Object({
  user: LoginUser,
  token: t.String({ description: 'JWT Token' }),
  isNewUser: t.Boolean({ description: '是否新用户' }),
  exp: t.Optional(t.Number({ description: 'Token 过期时间戳 (秒)' })),
});

const AuthGateUi = t.Object({
  loginTitle: t.String({ description: '登录动作闸门标题' }),
  bindPhoneTitle: t.String({ description: '绑定手机号动作闸门标题' }),
  loginDescription: t.String({ description: '登录动作闸门说明' }),
  bindPhoneDescription: t.String({ description: '绑定手机号动作闸门说明' }),
  invalidPhoneText: t.String({ description: '手机号校验失败提示' }),
  missingCodeText: t.String({ description: '验证码缺失提示' }),
  loginFailedText: t.String({ description: '登录失败兜底提示' }),
  phonePlaceholder: t.String({ description: '手机号输入框 placeholder' }),
  codePlaceholder: t.String({ description: '验证码输入框 placeholder' }),
  submitLabel: t.String({ description: '提交按钮文案' }),
  submittingLabel: t.String({ description: '提交中按钮文案' }),
  privacyHint: t.String({ description: '登录弹层底部提示' }),
});

const TestUsersBootstrapRequest = t.Object({
  phone: t.String({ pattern: '^1[3-9]\\d{9}$', description: '具备运维权限的手机号' }),
  code: t.String({ minLength: 4, maxLength: 6, description: '超级验证码' }),
  count: t.Optional(t.Number({ minimum: 1, maximum: 10, default: 5, description: '生成账号数量，最多 10 个' })),
});

const TestUsersBootstrapResponse = t.Object({
  users: t.Array(t.Object({
    user: selectUserSchema,
    token: t.String({ description: '测试账号 JWT Token' }),
    isNewUser: t.Boolean({ description: '是否为本次新建账号' }),
  })),
  msg: t.String(),
});


// 注册到 Elysia Model Plugin
export const authModel = new Elysia({ name: 'authModel' })
  .model({
    'auth.login': LoginRequest,
    'auth.bindPhone': BindPhoneRequest,
    'auth.bindPhoneResponse': BindPhoneResponse,
    'auth.loginResponse': LoginResponse,
    'auth.gateUi': AuthGateUi,
    'auth.testUsersBootstrap': TestUsersBootstrapRequest,
    'auth.testUsersBootstrapResponse': TestUsersBootstrapResponse,
    'common.error': ErrorResponseSchema,
  });

// 导出 TS 类型
export type AuthPermission = Static<typeof AuthPermission>;
export type AuthRole = Static<typeof AuthRole>;
export type LoginUser = Static<typeof LoginUser>;
export type WechatCodeLoginRequest = Static<typeof WechatCodeLoginRequest>;
export type PhoneOtpLoginRequest = Static<typeof PhoneOtpLoginRequest>;
export type LoginRequest = Static<typeof LoginRequest>;
export type BindPhoneRequest = Static<typeof BindPhoneRequest>;
export type BindPhoneResponse = Static<typeof BindPhoneResponse>;
export type LoginResponse = Static<typeof LoginResponse>;
export type AuthGateUi = Static<typeof AuthGateUi>;
export type TestUsersBootstrapRequest = Static<typeof TestUsersBootstrapRequest>;
export type TestUsersBootstrapResponse = Static<typeof TestUsersBootstrapResponse>;

// Re-export ErrorResponse from common
export { ErrorResponseSchema, type ErrorResponse };

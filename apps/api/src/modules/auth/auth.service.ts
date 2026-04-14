// Auth Service - 认证相关业务逻辑 (MVP 简化版)
import { db, users, eq } from '@xu/db';
import { getJwtSecret } from '../../setup';
import type {
  WechatCodeLoginRequest,
  BindPhoneRequest,
  PhoneOtpLoginRequest,
  TestUsersBootstrapRequest,
  LoginUser,
} from './auth.model';

const TEST_USER_BLUEPRINTS = [
  { phoneNumber: '13800138001', nickname: '测试用户1', wxOpenId: 'test_bootstrap_user_1' },
  { phoneNumber: '13800138002', nickname: '测试用户2', wxOpenId: 'test_bootstrap_user_2' },
  { phoneNumber: '13800138003', nickname: '测试用户3', wxOpenId: 'test_bootstrap_user_3' },
  { phoneNumber: '13800138004', nickname: '测试用户4', wxOpenId: 'test_bootstrap_user_4' },
  { phoneNumber: '13800138005', nickname: '测试用户5', wxOpenId: 'test_bootstrap_user_5' },
] as const;

/**
 * 微信登录响应接口
 */
interface WxLoginResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

/**
 * 微信手机号响应接口
 */
interface WxPhoneResponse {
  phone_info?: {
    phoneNumber: string;
    purePhoneNumber: string;
    countryCode: string;
  };
  errcode?: number;
  errmsg?: string;
}

let hasWarnedLoginMock = false;
let hasWarnedPhoneMock = false;

function getPrivilegedPhoneWhitelist(): string[] {
  const whitelist = process.env.ADMIN_PHONE_WHITELIST
    ?.split(',')
    .map((phone) => phone.trim())
    .filter(Boolean);

  if (!whitelist || whitelist.length === 0) {
    throw new Error('受保护手机号白名单未配置');
  }

  return whitelist;
}

function getPrivilegedSuperCode(): string {
  const code = process.env.ADMIN_SUPER_CODE?.trim();

  if (!code) {
    throw new Error('超级验证码未配置');
  }

  return code;
}

function buildPrivilegedRole(): NonNullable<LoginUser['role']> {
  return {
    id: 'admin-role',
    name: '管理员',
    permissions: [
      { resource: 'users', actions: ['read', 'write', 'delete'] },
      { resource: 'activities', actions: ['read', 'write', 'delete'] },
      { resource: 'conversations', actions: ['read', 'write', 'delete'] },
      { resource: 'analytics', actions: ['read'] },
      { resource: 'ai-operations', actions: ['read', 'write'] },
    ],
  };
}

function isFlagEnabled(flag?: string): boolean {
  if (!flag) return false;
  return ['1', 'true', 'yes', 'on'].includes(flag.toLowerCase());
}

function isWxLoginMockEnabled(): boolean {
  return isFlagEnabled(process.env.WECHAT_AUTH_MOCK_LOGIN);
}

function isWxPhoneMockEnabled(): boolean {
  return isFlagEnabled(process.env.WECHAT_AUTH_MOCK_PHONE);
}

/**
 * 微信登录 (MVP 简化版)
 * - 移除复杂的会员逻辑
 * - 只创建基础用户信息
 */
export async function loginWithWechatCode(params: WechatCodeLoginRequest) {
  const { code } = params;

  try {
    // 调用微信接口获取 openid
    const wxData = await getWxOpenId(code);

    if (!wxData.openid) {
      throw new Error('微信登录失败，请重试');
    }

    // 查找是否已存在用户
    let user = await db
      .select()
      .from(users)
      .where(eq(users.wxOpenId, wxData.openid))
      .limit(1)
      .then(rows => rows[0]);

    let isNewUser = false;

    if (!user) {
      // 创建新用户 (MVP 简化字段)
      isNewUser = true;
      const [newUser] = await db
        .insert(users)
        .values({
          wxOpenId: wxData.openid,
          nickname: null, // 延迟完善
          avatarUrl: null, // 延迟完善
          phoneNumber: null, // 延迟绑定
          aiCreateQuotaToday: 3,
        })
        .returning();

      user = newUser;
    }

    return { user, isNewUser };
  } catch (error: any) {
    console.error('微信登录失败:', error);
    throw new Error(error?.message || '登录失败');
  }
}

/**
 * 手机号验证码登录（受保护能力）
 */
export async function loginWithPhoneCode(params: PhoneOtpLoginRequest): Promise<LoginUser> {
  const { phone, code } = params;

  assertPrivilegedSuperCode(phone, code);

  // 查找用户
  let user = await db
    .select()
    .from(users)
    .where(eq(users.phoneNumber, phone))
    .limit(1)
    .then(rows => rows[0]);

  // 如果用户不存在，创建可登录的受保护用户
  if (!user) {
    const [newUser] = await db
      .insert(users)
      .values({
        wxOpenId: `admin_${phone}`, // 当前 users 表要求 wxOpenId 非空，这里用稳定占位值承接受保护登录
        phoneNumber: phone,
        nickname: '管理员',
        avatarUrl: null,
        aiCreateQuotaToday: 999, // 受保护登录账号使用高额度，便于运维联调
      })
      .returning();

    user = newUser;
  }

  return {
    ...user,
    role: buildPrivilegedRole(),
  };
}

export async function bootstrapTestUsers(params: TestUsersBootstrapRequest) {
  const { phone, code, count = 5 } = params;

  assertPrivilegedSuperCode(phone, code);

  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境不可批量创建测试账号');
  }

  const targetUsers = TEST_USER_BLUEPRINTS.slice(0, count);
  const now = new Date();

  const createdUsers = [] as Array<{ user: typeof users.$inferSelect; isNewUser: boolean }>;

  for (const blueprint of targetUsers) {
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.wxOpenId, blueprint.wxOpenId))
      .limit(1)
      .then((rows) => rows[0]);

    if (existingUser) {
      const [updatedUser] = await db
        .update(users)
        .set({
          phoneNumber: blueprint.phoneNumber,
          nickname: blueprint.nickname,
          aiCreateQuotaToday: 999,
          aiQuotaResetAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, existingUser.id))
        .returning();

      createdUsers.push({ user: updatedUser, isNewUser: false });
      continue;
    }

    const [newUser] = await db
      .insert(users)
      .values({
        wxOpenId: blueprint.wxOpenId,
        phoneNumber: blueprint.phoneNumber,
        nickname: blueprint.nickname,
        avatarUrl: null,
        aiCreateQuotaToday: 999,
        aiQuotaResetAt: now,
      })
      .returning();

    createdUsers.push({ user: newUser, isNewUser: true });
  }

  return createdUsers;
}

/**
 * 绑定手机号 (延迟验证)
 * 使用 getPhoneNumber 返回的 code 获取手机号
 */
export async function bindPhone(userId: string, params: BindPhoneRequest) {
  const { code } = params;

  try {
    // 调用微信接口获取手机号
    const phoneData = await getWxPhoneNumber(code);

    if (!phoneData.phone_info?.phoneNumber) {
      throw new Error('获取手机号失败，请重试');
    }

    const phoneNumber = phoneData.phone_info.phoneNumber;

    // 更新用户手机号
    const [updated] = await db
      .update(users)
      .set({
        phoneNumber,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      throw new Error('用户不存在');
    }

    return {
      success: true,
      phoneNumber,
    };
  } catch (error: any) {
    console.error('绑定手机号失败:', error);
    throw new Error(error?.message || '绑定手机号失败');
  }
}

/**
 * 根据微信 code 获取 openid 和 session_key
 */
async function getWxOpenId(code: string): Promise<WxLoginResponse> {
  const WECHAT_APP_ID = process.env.WECHAT_APP_ID;
  const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET;

  if (isWxLoginMockEnabled()) {
    if (!hasWarnedLoginMock) {
      console.warn('[Auth] WECHAT_AUTH_MOCK_LOGIN 已启用，微信登录将使用模拟 openid');
      hasWarnedLoginMock = true;
    }
    return {
      openid: process.env.WECHAT_AUTH_MOCK_OPENID || 'wx_mock_openid',
      session_key: process.env.WECHAT_AUTH_MOCK_SESSION_KEY || 'mock_session_key',
    };
  }

  if (!WECHAT_APP_ID || !WECHAT_APP_SECRET) {
    throw new Error(
      '微信登录配置缺失，请设置 WECHAT_APP_ID / WECHAT_APP_SECRET，或显式开启 WECHAT_AUTH_MOCK_LOGIN'
    );
  }

  try {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}&js_code=${code}&grant_type=authorization_code`;

    const response = await fetch(url);
    const data: WxLoginResponse = await response.json();

    if (data.errcode) {
      throw new Error(`微信接口错误: ${data.errmsg}`);
    }

    return data;
  } catch (error) {
    console.error('调用微信接口失败:', error);
    throw new Error('微信登录验证失败');
  }
}

/**
 * 根据 code 获取微信手机号
 * 
 * 重构：复用 content-security 模块的 Token 管理
 */
async function getWxPhoneNumber(code: string): Promise<WxPhoneResponse> {
  if (isWxPhoneMockEnabled()) {
    if (!hasWarnedPhoneMock) {
      console.warn('[Auth] WECHAT_AUTH_MOCK_PHONE 已启用，手机号绑定将使用模拟手机号');
      hasWarnedPhoneMock = true;
    }
    const mockPhoneNumber = process.env.WECHAT_AUTH_MOCK_PHONE_NUMBER || '13800138000';
    return {
      phone_info: {
        phoneNumber: mockPhoneNumber,
        purePhoneNumber: mockPhoneNumber,
        countryCode: '86',
      },
    };
  }

  if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET) {
    throw new Error(
      '微信手机号配置缺失，请设置 WECHAT_APP_ID / WECHAT_APP_SECRET，或显式开启 WECHAT_AUTH_MOCK_PHONE'
    );
  }

  try {
    // 复用 content-security 模块的 Token 管理
    const { getAccessToken } = await import('../content-security');
    const accessToken = await getAccessToken();

    // 获取手机号
    const phoneUrl = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`;
    const phoneRes = await fetch(phoneUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const phoneData: WxPhoneResponse = await phoneRes.json();

    if (phoneData.errcode) {
      throw new Error(`微信接口错误: ${phoneData.errmsg}`);
    }

    return phoneData;
  } catch (error) {
    console.error('获取微信手机号失败:', error);
    throw new Error('获取手机号失败');
  }
}

/**
 * 验证 JWT Token（用于 WebSocket 等无法使用 Elysia jwt 装饰器的场景）
 * 返回用户信息或 null
 */
export async function verifyToken(token: string): Promise<{ id: string; role: string } | null> {
  try {
    const { jwtVerify } = await import('jose');
    const encoder = new TextEncoder();
    const { payload } = await jwtVerify(token, encoder.encode(getJwtSecret()));

    if (!payload.id || typeof payload.id !== 'string') {
      return null;
    }

    return { id: payload.id as string, role: (payload.role as string) || 'user' };
  } catch (error) {
    console.error('[Auth] Token 验证失败:', error);
    return null;
  }
}

function assertPrivilegedSuperCode(phone: string, code: string): void {
  if (code !== getPrivilegedSuperCode()) {
    throw new Error('验证码错误');
  }

  if (!getPrivilegedPhoneWhitelist().includes(phone)) {
    throw new Error('该手机号无运维权限');
  }
}

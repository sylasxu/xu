// Auth Service - 认证相关业务逻辑 (MVP 简化版)
import { db, users, eq } from '@juchang/db';
import type { WxLoginRequest, BindPhoneRequest, AdminPhoneLoginRequest } from './auth.model';

// 管理员手机号白名单
const ADMIN_PHONES = ['13996092317'];

// 超级验证码（开发/测试用）
const SUPER_CODE = '9999';

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

/**
 * 微信登录 (MVP 简化版)
 * - 移除复杂的会员逻辑
 * - 只创建基础用户信息
 */
export async function wxLogin(params: WxLoginRequest) {
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
          activitiesCreatedCount: 0,
          participationCount: 0,
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
 * Admin 手机号登录
 * - 验证码校验（9999 为超级验证码）
 * - 检查是否为管理员
 */
export async function adminPhoneLogin(params: AdminPhoneLoginRequest) {
  const { phone, code } = params;

  // 验证码校验
  if (code !== SUPER_CODE) {
    // TODO: 接入真实短信验证码服务
    throw new Error('验证码错误');
  }

  // 检查是否为管理员
  if (!ADMIN_PHONES.includes(phone)) {
    throw new Error('该手机号无管理员权限');
  }

  // 查找用户
  let user = await db
    .select()
    .from(users)
    .where(eq(users.phoneNumber, phone))
    .limit(1)
    .then(rows => rows[0]);

  // 如果用户不存在，创建管理员用户
  if (!user) {
    const [newUser] = await db
      .insert(users)
      .values({
        wxOpenId: `admin_${phone}`, // 管理员使用手机号作为标识
        phoneNumber: phone,
        nickname: '管理员',
        avatarUrl: null,
        aiCreateQuotaToday: 999, // 管理员无限额度
        activitiesCreatedCount: 0,
        participationCount: 0,
      })
      .returning();

    user = newUser;
  }

  // 构建管理员角色信息
  const adminUser = {
    id: user.id,
    phoneNumber: user.phoneNumber!,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    role: {
      id: 'admin-role',
      name: '管理员',
      permissions: [
        { resource: 'users', actions: ['read', 'write', 'delete'] },
        { resource: 'activities', actions: ['read', 'write', 'delete'] },
        { resource: 'conversations', actions: ['read', 'write', 'delete'] },
        { resource: 'dashboard', actions: ['read'] },
        { resource: 'ai-playground', actions: ['read', 'write'] },
      ],
    },
  };

  return adminUser;
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
  const isDev = process.env.NODE_ENV === 'development';

  // 开发环境：跳过微信验证，直接返回测试用户
  if (isDev || !WECHAT_APP_ID || !WECHAT_APP_SECRET) {
    console.warn('[Auth] 开发环境：跳过微信验证，使用模拟数据');
    return {
      openid: `wx_dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      session_key: 'mock_session_key_dev'
    };
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
  const isDev = process.env.NODE_ENV === 'development';

  // 开发环境：跳过微信解密，直接返回测试手机号
  if (isDev) {
    console.warn('[Auth] 开发环境：跳过微信解密，使用测试手机号');
    return {
      phone_info: {
        phoneNumber: '13800138000',
        purePhoneNumber: '13800138000',
        countryCode: '86',
      }
    };
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
    const secret = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';
    const { jwtVerify } = await import('jose');
    const encoder = new TextEncoder();
    const { payload } = await jwtVerify(token, encoder.encode(secret));

    if (!payload.id || typeof payload.id !== 'string') {
      return null;
    }

    return { id: payload.id as string, role: (payload.role as string) || 'user' };
  } catch (error) {
    console.error('[Auth] Token 验证失败:', error);
    return null;
  }
}

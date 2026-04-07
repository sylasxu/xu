// 全局配置：分离关注点
import { config } from 'dotenv';
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { fileURLToPath } from 'url';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const LOCAL_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:1113',
  'http://127.0.0.1:1113',
  'http://localhost:1114',
  'http://127.0.0.1:1114',
];

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function getJwtSecret(): string {
  const secret = readEnv('JWT_SECRET');
  if (!secret) {
    throw new Error('缺少 JWT_SECRET 环境变量，API 无法启动');
  }
  return secret;
}

export function getCorsOrigins(): string[] {
  const configuredOrigins = readEnv('API_CORS_ORIGINS')
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins && configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 API_CORS_ORIGINS');
  }

  return LOCAL_CORS_ORIGINS;
}

/**
 * 基础插件配置（CORS + JWT）
 * 只在主应用中使用一次
 */
export const basePlugins = new Elysia({ name: 'basePlugins' })
  .use(cors({
    origin: getCorsOrigins(),
    credentials: true,
  }))
  .use(
    jwt({
      name: 'jwt',
      secret: getJwtSecret(),
      exp: '7d', // Token 有效期 7 天
    })
  );

/**
 * JWT 认证辅助函数
 */
export async function verifyAuth(jwt: any, headers: Record<string, string | undefined>): Promise<{ id: string; role: string } | null> {
  const authHeader = headers['authorization'] || headers['Authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const profile = await jwt.verify(token);

  return profile as { id: string; role: string } | null;
}

/**
 * Admin 认证错误类
 * 包含 HTTP status (401/403) 和错误消息
 */
export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Admin 权限验证中间件
 * 验证 JWT + admin 角色，失败抛出 AuthError
 */
export async function verifyAdmin(
  jwt: any,
  headers: Record<string, string | undefined>
): Promise<{ id: string; role: string }> {
  const user = await verifyAuth(jwt, headers);
  if (!user) {
    throw new AuthError(401, '未授权');
  }
  if (user.role !== 'admin') {
    throw new AuthError(403, '无管理员权限');
  }
  return user;
}

export async function verifySelfOrAdmin(
  jwt: any,
  headers: Record<string, string | undefined>,
  targetUserId: string
): Promise<{ id: string; role: string }> {
  const user = await verifyAuth(jwt, headers);
  if (!user) {
    throw new AuthError(401, '未授权');
  }

  if (user.role !== 'admin' && user.id !== targetUserId) {
    throw new AuthError(403, '无权限访问该用户');
  }

  return user;
}

/**
 * Elysia guard beforeHandle hooks
 * These attach user to context on success
 */
export async function requireAuth(
  { jwt, headers, set }: { jwt: any; headers: Record<string, string | undefined>; set: any },
): Promise<{ code: number; msg: string } | void> {
  const user = await verifyAuth(jwt, headers);
  if (!user) {
    set.status = 401;
    return { code: 401, msg: '未授权' };
  }
}

export function requireUserOrAdmin(paramName: string) {
  return async function(
    { jwt, headers, params, set }: {
      jwt: any
      headers: Record<string, string | undefined>
      params: Record<string, string>
      set: any
    },
  ): Promise<{ code: number; msg: string } | void> {
    const user = await verifyAuth(jwt, headers);
    if (!user) {
      set.status = 401;
      return { code: 401, msg: '未授权' };
    }
    const targetUserId = params[paramName];
    if (user.role !== 'admin' && user.id !== targetUserId) {
      set.status = 403;
      return { code: 403, msg: '无权限访问该用户' };
    }
  };
}

export async function requireAdmin(
  { jwt, headers, set }: { jwt: any; headers: Record<string, string | undefined>; set: any },
): Promise<{ code: number; msg: string } | void> {
  const user = await verifyAuth(jwt, headers);
  if (!user) {
    set.status = 401;
    return { code: 401, msg: '未授权' };
  }
  if (user.role !== 'admin') {
    set.status = 403;
    return { code: 403, msg: '无管理员权限' };
  }
}

// Re-export ErrorResponse from common for convenience
export type { ErrorResponse } from './common';

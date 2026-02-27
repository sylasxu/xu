// 全局配置：分离关注点
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';

/**
 * 基础插件配置（CORS + JWT）
 * 只在主应用中使用一次
 */
export const basePlugins = new Elysia({ name: 'basePlugins' })
  .use(cors({
    origin: true, // 开发环境允许所有来源，生产环境应该配置具体域名
    credentials: true,
  }))
  .use(
    jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
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


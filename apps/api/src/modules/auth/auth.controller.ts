// Auth Controller - 认证相关接口 (MVP 简化版)
// 只保留 /auth/login 和 /auth/bindPhone
import { Elysia } from 'elysia';
import { AuthError, basePlugins, verifyAdmin, verifyAuth } from '../../setup';
import { authModel, type ErrorResponse } from './auth.model';
import { wxLogin, bindPhone, adminPhoneLogin, bootstrapTestUsers } from './auth.service';

export const authController = new Elysia({ prefix: '/auth' })
  .use(basePlugins)
  .use(authModel)
  
  // 微信登录 (静默登录)
  .post(
    '/login',
    async ({ body, jwt, set }) => {
      try {
        const { user, isNewUser } = await wxLogin(body);

        // 生成 JWT Token
        const token = await jwt.sign({
          id: user.id,
          wxOpenId: user.wxOpenId,
          role: 'user',
        });

        return {
          user,
          token,
          isNewUser,
        };
      } catch (error: any) {
        console.error('微信登录失败:', error);
        set.status = 400;
        return {
          code: 400,
          msg: error.message || '登录失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Auth'],
        summary: '微信登录',
        description: '使用微信授权码静默登录，返回用户信息和 JWT Token',
      },
      body: 'auth.wxLogin',
      response: {
        200: 'auth.loginResponse',
        400: 'auth.error',
      },
    }
  )

  // Admin 手机号登录
  .post(
    '/admin/login',
    async ({ body, jwt, set }) => {
      try {
        const adminUser = await adminPhoneLogin(body);

        // Token 过期时间：24小时
        const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

        // 生成 JWT Token
        const token = await jwt.sign({
          id: adminUser.id,
          phoneNumber: adminUser.phoneNumber,
          role: 'admin',
          exp,
        });

        return {
          user: adminUser,
          token,
          exp,
        };
      } catch (error: any) {
        console.error('Admin 登录失败:', error);
        set.status = 400;
        return {
          code: 400,
          msg: error.message || '登录失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Auth'],
        summary: 'Admin 手机号登录',
        description: '管理员使用手机号 + 验证码登录',
      },
      body: 'auth.adminPhoneLogin',
      response: {
        200: 'auth.adminLoginResponse',
        400: 'auth.error',
      },
    }
  )

  .post(
    '/admin/bootstrap-test-users',
    async ({ body, jwt, headers, set }) => {
      try {
        await verifyAdmin(jwt, headers);
      } catch (error) {
        if (error instanceof AuthError) {
          set.status = error.status;
          return {
            code: error.status,
            msg: error.message,
          } satisfies ErrorResponse;
        }

        set.status = 500;
        return {
          code: 500,
          msg: '管理员鉴权失败',
        } satisfies ErrorResponse;
      }

      try {
        const bootstrappedUsers = await bootstrapTestUsers(body);

        const usersWithTokens = await Promise.all(
          bootstrappedUsers.map(async ({ user, isNewUser }) => ({
            user,
            isNewUser,
            token: await jwt.sign({
              id: user.id,
              wxOpenId: user.wxOpenId,
              role: 'user',
            }),
          }))
        );

        return {
          users: usersWithTokens,
          msg: `已准备好 ${usersWithTokens.length} 个可直接联调的测试账号`,
        };
      } catch (error: any) {
        console.error('批量创建测试账号失败:', error);
        set.status = 400;
        return {
          code: 400,
          msg: error.message || '批量创建测试账号失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Auth'],
        summary: 'Admin 一键准备测试账号',
        description: '使用管理员手机号 + 超级验证码，批量准备最多 5 个已绑手机号的测试账号，用于业务联调。',
      },
      body: 'auth.bootstrapTestUsers',
      response: {
        200: 'auth.bootstrapTestUsersResponse',
        400: 'auth.error',
        401: 'auth.error',
        403: 'auth.error',
      },
    }
  )

  // 绑定手机号 (延迟验证)
  .post(
    '/bindPhone',
    async ({ body, jwt, headers, set }) => {
      // JWT 认证
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      try {
        const result = await bindPhone(user.id, body);
        return result;
      } catch (error: any) {
        console.error('绑定手机号失败:', error);
        set.status = 400;
        return {
          code: 400,
          msg: error.message || '绑定手机号失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Auth'],
        summary: '绑定手机号',
        description: '使用 getPhoneNumber 返回的 code 绑定手机号（延迟验证）',
      },
      body: 'auth.bindPhone',
      response: {
        200: 'auth.bindPhoneResponse',
        400: 'auth.error',
        401: 'auth.error',
      },
    }
  );

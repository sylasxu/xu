// Auth Controller - 认证相关接口 (MVP 简化版)
// 提供统一登录、测试账号准备和手机号绑定能力
import { Elysia } from 'elysia';
import { AuthError, basePlugins, verifyAdmin, verifyAuth } from '../../setup';
import { authModel, type ErrorResponse, type LoginRequest, type PhoneOtpLoginRequest } from './auth.model';
import { loginWithWechatCode, bindPhone, loginWithPhoneCode, bootstrapTestUsers } from './auth.service';

function isPhoneOtpLoginRequest(body: LoginRequest): body is PhoneOtpLoginRequest {
  return typeof (body as PhoneOtpLoginRequest).phone === 'string';
}

export const authController = new Elysia({ prefix: '/auth' })
  .use(basePlugins)
  .use(authModel)
  
  // 统一登录
  .post(
    '/login',
    async ({ body, jwt, set }) => {
      try {
        const loginBody = body as LoginRequest;

        if (isPhoneOtpLoginRequest(loginBody)) {
          const user = await loginWithPhoneCode(loginBody);

          // Token 过期时间：24小时
          const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

          const token = await jwt.sign({
            id: user.id,
            phoneNumber: user.phoneNumber,
            role: 'admin',
            exp,
          });

          return {
            user,
            token,
            isNewUser: false,
            exp,
          };
        }

        const { user, isNewUser } = await loginWithWechatCode(loginBody);
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
        console.error('登录失败:', error);
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
        summary: '登录',
        description: '统一登录入口：支持微信 code 登录和受保护手机号验证码登录。',
      },
      body: 'auth.login',
      response: {
        200: 'auth.loginResponse',
        400: 'common.error',
      },
    }
  )

  .post(
    '/test-users/bootstrap',
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
          msg: '权限验证失败',
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
        summary: '准备测试账号',
        description: '使用受保护手机号 + 超级验证码，批量准备最多 5 个已绑手机号的测试账号，用于业务联调。',
      },
      body: 'auth.testUsersBootstrap',
      response: {
        200: 'auth.testUsersBootstrapResponse',
        400: 'common.error',
        401: 'common.error',
        403: 'common.error',
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
        400: 'common.error',
        401: 'common.error',
      },
    }
  );

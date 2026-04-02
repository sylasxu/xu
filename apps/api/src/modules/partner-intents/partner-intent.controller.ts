import { Elysia } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { partnerIntentModel, type ErrorResponse } from './partner-intent.model';
import { getPartnerIntentList } from './partner-intent.service';

export const partnerIntentController = new Elysia({ prefix: '/partner-intents' })
  .use(basePlugins)
  .use(partnerIntentModel)
  .get(
    '/',
    async ({ query, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      if (query.userId) {
        if (user.role !== 'admin' && user.id !== query.userId) {
          set.status = 403;
          return { code: 403, msg: '无权限访问该用户搭子意向' } satisfies ErrorResponse;
        }
      } else if (user.role !== 'admin') {
        set.status = 403;
        return { code: 403, msg: '只有管理员可以查看全量搭子意向' } satisfies ErrorResponse;
      }

      try {
        return await getPartnerIntentList(query);
      } catch (error: any) {
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取搭子意向失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Partner Intents'],
        summary: '获取搭子意向列表',
        description: '显式按筛选条件查询搭子意向。带 userId 时允许 self/admin 查询，不带 userId 时仅管理员可查询全量数据。',
      },
      query: 'partnerIntent.listQuery',
      response: {
        200: 'partnerIntent.listResponse',
        401: 'partnerIntent.error',
        403: 'partnerIntent.error',
        500: 'partnerIntent.error',
      },
    }
  );

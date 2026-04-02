import { Elysia } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { intentMatchModel, type ErrorResponse } from './intent-match.model';
import { getIntentMatchList } from './intent-match.service';

export const intentMatchController = new Elysia({ prefix: '/intent-matches' })
  .use(basePlugins)
  .use(intentMatchModel)
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
          return { code: 403, msg: '无权限访问该用户匹配信息' } satisfies ErrorResponse;
        }
      } else if (user.role !== 'admin') {
        set.status = 403;
        return { code: 403, msg: '只有管理员可以查看全量匹配信息' } satisfies ErrorResponse;
      }

      try {
        return await getIntentMatchList(query);
      } catch (error: any) {
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取意向匹配失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Intent Matches'],
        summary: '获取意向匹配列表',
        description: '显式按筛选条件查询意向匹配。带 userId 时允许 self/admin 查询，不带 userId 时仅管理员可查询全量数据。',
      },
      query: 'intentMatch.listQuery',
      response: {
        200: 'intentMatch.listResponse',
        401: 'intentMatch.error',
        403: 'intentMatch.error',
        500: 'intentMatch.error',
      },
    }
  );

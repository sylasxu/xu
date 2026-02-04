// Poster Controller - 海报生成接口
import { Elysia } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { posterModel, type ErrorResponse } from './poster.model';
import { generatePoster } from './poster.service';

export const posterController = new Elysia({ prefix: '/poster' })
  .use(basePlugins)
  .use(posterModel)

  // 生成海报
  .post(
    '/generate',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
      }

      try {
        const result = await generatePoster(body.activityId, body.style);
        return result;
      } catch (error: any) {
        // 区分不同错误类型
        if (error.message === '活动不存在') {
          set.status = 404;
          return {
            code: 404,
            msg: error.message,
          } satisfies ErrorResponse;
        }

        // 超时错误
        if (error.message?.includes('timeout') || error.message?.includes('超时')) {
          set.status = 504;
          return {
            code: 504,
            msg: '海报生成超时，请重试',
          } satisfies ErrorResponse;
        }

        set.status = 500;
        return {
          code: 500,
          msg: error.message || '海报生成失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Poster'],
        summary: '生成活动海报',
        description: '使用 AI 生成活动海报，包含背景图、活动信息和小程序码。支持简约、活力、文艺三种风格。',
      },
      body: 'poster.generateRequest',
      response: {
        200: 'poster.generateResponse',
        401: 'poster.error',
        404: 'poster.error',
        500: 'poster.error',
        504: 'poster.error',
      },
    }
  );

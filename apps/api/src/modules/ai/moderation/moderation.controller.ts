/**
 * Moderation Controller - 内容审核接口
 */
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAdmin, AuthError, type ErrorResponse } from '../../../setup';
import { analyzeActivity, analyzeContent } from './moderation.service';

const ModerationResultSchema = t.Object({
  activityId: t.String(),
  riskScore: t.Number({ minimum: 0, maximum: 100 }),
  riskLevel: t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')]),
  reasons: t.Array(t.String()),
  suggestedAction: t.Union([t.Literal('approve'), t.Literal('review'), t.Literal('reject')]),
});

const ErrorResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
});

export const moderationController = new Elysia({ prefix: '/ai/moderation' })
  .use(basePlugins)
  .onBeforeHandle(async ({ jwt, headers, set }) => {
    try {
      await verifyAdmin(jwt, headers);
    } catch (error) {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { code: error.status, msg: error.message } satisfies ErrorResponse;
      }
    }
  })

  // 分析活动内容
  .post(
    '/analyze',
    async ({ body, set }) => {
      const result = await analyzeActivity(body.activityId);
      if (!result) {
        set.status = 404;
        return { code: 404, msg: '活动不存在' } satisfies ErrorResponse;
      }
      return result;
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '分析活动内容',
        description: '对指定活动进行内容审核，返回风险评分和建议操作',
      },
      body: t.Object({
        activityId: t.String({ description: '活动 ID' }),
      }),
      response: {
        200: ModerationResultSchema,
        404: ErrorResponseSchema,
      },
    }
  )

  // 直接分析文本（用于预览）
  .post(
    '/check',
    async ({ body }) => {
      const result = await analyzeContent(body.title, body.description);
      return {
        ...result,
        activityId: 'preview',
      };
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '检查文本内容',
        description: '直接检查文本内容的风险等级，用于预览',
      },
      body: t.Object({
        title: t.String({ description: '标题' }),
        description: t.Optional(t.String({ description: '描述' })),
      }),
      response: {
        200: ModerationResultSchema,
      },
    }
  );

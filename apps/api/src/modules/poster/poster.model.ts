// Poster Model - TypeBox schemas
import { Elysia, t, type Static } from 'elysia';

/**
 * Poster Model Plugin
 * 
 * 接口：
 * - POST /poster/generate - 生成活动海报
 */

// 海报风格
export const PosterStyleSchema = t.Union([
  t.Literal('simple'),    // 简约
  t.Literal('vibrant'),   // 活力
  t.Literal('artistic'),  // 文艺
]);

// 生成海报请求
export const GeneratePosterRequestSchema = t.Object({
  activityId: t.String({ format: 'uuid', description: '活动ID' }),
  style: PosterStyleSchema,
});

// 生成海报响应
export const GeneratePosterResponseSchema = t.Object({
  posterUrl: t.String({ description: '海报图片 URL' }),
  expiresAt: t.String({ description: '海报过期时间' }),
});

// 错误响应
const ErrorResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// 注册到 Elysia Model Plugin
export const posterModel = new Elysia({ name: 'posterModel' })
  .model({
    'poster.generateRequest': GeneratePosterRequestSchema,
    'poster.generateResponse': GeneratePosterResponseSchema,
    'poster.error': ErrorResponse,
  });

// 导出 TS 类型
export type PosterStyle = Static<typeof PosterStyleSchema>;
export type GeneratePosterRequest = Static<typeof GeneratePosterRequestSchema>;
export type GeneratePosterResponse = Static<typeof GeneratePosterResponseSchema>;
export type ErrorResponse = Static<typeof ErrorResponse>;

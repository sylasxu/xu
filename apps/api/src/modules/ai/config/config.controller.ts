/**
 * AI 配置管理 Controller
 *
 * 提供 AI 系统配置的 CRUD、版本历史和回滚 API。
 * 端点前缀：/ai/configs
 *
 * 需求: 6.7, 6.9
 */

import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth } from '../../../setup';
import {
  getAllConfigs,
  getConfigValue,
  setConfigValue,
  getConfigHistory,
  rollbackConfig,
} from './config.service';

type ErrorResponse = { code: number; msg: string };

export const configController = new Elysia({ prefix: '/ai/configs' })
  .use(basePlugins)

  // GET /ai/configs — 获取所有配置（按 category 分组）
  .get(
    '/',
    async ({ set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const configs = await getAllConfigs();
        return configs;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取配置失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Config'],
        summary: '获取所有 AI 配置',
        description: '获取所有 AI 配置项，按 category 分组返回（Admin 用）。',
      },
    },
  )

  // GET /ai/configs/:configKey — 获取单个配置
  .get(
    '/:configKey',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        // 使用 null 作为默认值来检测是否存在
        const value = await getConfigValue<unknown>(params.configKey, null);
        if (value === null) {
          set.status = 404;
          return { code: 404, msg: '配置项不存在' } satisfies ErrorResponse;
        }
        return { configKey: params.configKey, configValue: value };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取配置失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Config'],
        summary: '获取单个 AI 配置',
        description: '获取指定 configKey 的配置值（Admin 用）。',
      },
      params: t.Object({
        configKey: t.String({ description: '配置键，如 intent.feature_rules' }),
      }),
    },
  )

  // PUT /ai/configs/:configKey — 更新配置
  .put(
    '/:configKey',
    async ({ params, body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await setConfigValue(params.configKey, body.configValue, user.id);
        return {
          configKey: params.configKey,
          configValue: body.configValue,
          version: result.version,
        };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '更新配置失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Config'],
        summary: '更新 AI 配置',
        description: '更新指定 configKey 的配置值，自动递增版本号并保存历史（Admin 用）。',
      },
      params: t.Object({
        configKey: t.String({ description: '配置键' }),
      }),
      body: t.Object({
        configValue: t.Any({ description: '配置值（JSONB）' }),
      }),
    },
  )

  // GET /ai/configs/:configKey/history — 获取变更历史
  .get(
    '/:configKey/history',
    async ({ params, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const history = await getConfigHistory(params.configKey);
        return history;
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '获取历史失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Config'],
        summary: '获取配置变更历史',
        description: '获取指定 configKey 的所有版本变更历史（Admin 用）。',
      },
      params: t.Object({
        configKey: t.String({ description: '配置键' }),
      }),
    },
  )

  // POST /ai/configs/:configKey/rollback — 回滚到指定版本
  .post(
    '/:configKey/rollback',
    async ({ params, body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await rollbackConfig(params.configKey, body.targetVersion, user.id);
        if (!result) {
          set.status = 404;
          return { code: 404, msg: '目标版本不存在' } satisfies ErrorResponse;
        }
        return {
          configKey: params.configKey,
          configValue: result.configValue,
          version: result.version,
        };
      } catch (error: any) {
        set.status = 500;
        return { code: 500, msg: error.message || '回滚失败' } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['AI-Config'],
        summary: '回滚配置到指定版本',
        description: '将指定 configKey 回滚到历史版本（Admin 用）。',
      },
      params: t.Object({
        configKey: t.String({ description: '配置键' }),
      }),
      body: t.Object({
        targetVersion: t.Number({ description: '目标版本号' }),
      }),
    },
  );

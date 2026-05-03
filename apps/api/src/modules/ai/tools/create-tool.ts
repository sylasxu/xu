/**
 * Tool Factory - Mastra 风格的 Tool 工厂函数
 * 
 * 提供类型安全的 Tool 创建方式，支持：
 * - TypeBox Schema 定义参数
 * - 自动注入 userId 和 location
 * - 统一的错误处理
 */

import type { TSchema } from 'elysia';
import { tool, jsonSchema } from 'ai';
import { toJsonSchema } from '@xu/utils';
import type { ToolContext, ToolResult } from './types';

/**
 * Tool 配置
 */
export interface ToolConfig<TParams, TResult> {
  /** Tool 名称 */
  name: string;
  /** Tool 描述（供 AI 理解） */
  description: string;
  /** 参数 Schema（TypeBox） */
  parameters: TSchema;
  /** 执行函数 */
  execute: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>;
}

/**
 * 创建 Tool
 * 
 * Mastra 风格的 Tool 工厂，返回 AI SDK 兼容的 tool 对象
 * 
 * @example
 * ```ts
 * const myToolSchema = t.Object({
 *   query: t.String({ description: '搜索关键词' }),
 * });
 * 
 * type MyToolParams = typeof myToolSchema.static;
 * 
 * const myTool = createTool<MyToolParams, MyResult>({
 *   name: 'myTool',
 *   description: '搜索工具',
 *   parameters: myToolSchema,
 *   execute: async (params, context) => {
 *     // params 自动推导类型
 *     // context 包含 userId, location 等
 *     return { success: true, data: results };
 *   },
 * }, context);
 * ```
 */
export function createTool<TParams, TResult>(
  config: ToolConfig<TParams, TResult>,
  context: ToolContext
) {
  return tool({
    description: config.description,
    inputSchema: jsonSchema<TParams>(toJsonSchema(config.parameters)),
    execute: async (params: TParams) => {
      try {
        return await config.execute(params, context);
      } catch (error) {
        console.error(`[${config.name}] Error:`, error);
        return {
          success: false as const,
          error: error instanceof Error ? error.message : '执行失败，请再试一次',
        };
      }
    },
  });
}

/**
 * 创建 Tool 工厂函数
 * 
 * 返回一个接受 userId 和 location 的工厂函数，
 * 用于延迟创建 Tool 实例
 * 
 * @example
 * ```ts
 * const myToolSchema = t.Object({
 *   query: t.String({ description: '搜索关键词' }),
 * });
 * 
 * type MyToolParams = typeof myToolSchema.static;
 * 
 * const myToolFactory = createToolFactory<MyToolParams, MyResult>({
 *   name: 'myTool',
 *   description: '搜索工具',
 *   parameters: myToolSchema,
 *   execute: async (params, context) => {
 *     const { userId, location } = context;
 *     // ...
 *   },
 * });
 * 
 * // 使用时
 * const tool = myToolFactory(userId, location);
 * ```
 */
export function createToolFactory<TParams, TResult>(
  config: ToolConfig<TParams, TResult>
) {
  return (
    userId: string | null,
    location?: { lat: number; lng: number } | null,
    recalledActivities?: ToolContext['recalledActivities']
  ) => {
    const context: ToolContext = {
      userId,
      location: location ?? null,
      recalledActivities,
    };
    return createTool(config, context);
  };
}

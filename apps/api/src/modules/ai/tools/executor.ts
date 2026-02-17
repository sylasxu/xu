/**
 * Tool Executor - 工具执行器
 *
 * 执行工具并收集结果，支持超时保护和指标记录
 *
 * v4.9: 新增 withTimeout + executeToolWithMetrics
 * - 超时阈值通过 getConfigValue('tools.timeouts', DEFAULT_TIMEOUTS) 动态配置
 * - 查询类工具默认 5s，写入类工具默认 10s
 * - 执行结果异步写入 ai_tool_calls 表
 */

import { db, aiToolCalls } from '@juchang/db';
import { getConfigValue } from '../config/config.service';
import type { ToolDefinition, ToolContext, ToolResult } from './types';

/**
 * 默认超时配置（毫秒）
 * 查询类 5s，写入类 10s
 */
const DEFAULT_TIMEOUTS: Record<string, number> = {
  // 查询类 5s
  exploreNearby: 5000,
  getActivityDetail: 5000,
  getMyActivities: 5000,
  getMyIntents: 5000,
  getDraft: 5000,
  askPreference: 5000,
  // 写入类 10s
  createActivityDraft: 10000,
  publishActivity: 10000,
  joinActivity: 10000,
  refineDraft: 10000,
  cancelActivity: 10000,
  createPartnerIntent: 10000,
  cancelIntent: 10000,
  confirmMatch: 10000,
};

/** 默认超时（未配置的工具） */
const FALLBACK_TIMEOUT = 5000;

/**
 * Promise 超时包装器
 *
 * 使用 Promise.race 实现超时中断，超时后抛出错误。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Tool "${toolName}" timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

/**
 * 带超时保护和指标记录的工具执行包装器
 *
 * 1. 从配置读取超时阈值
 * 2. 用 withTimeout 包装执行
 * 3. 异步写入 ai_tool_calls 表（不阻塞主流程）
 *
 * @param toolName - 工具名称
 * @param executeFn - 实际执行函数
 * @param requestId - 关联的 AI 请求 ID（有值时才写入 ai_tool_calls）
 */
export async function executeToolWithMetrics(
  toolName: string,
  executeFn: () => Promise<unknown>,
  requestId?: string,
): Promise<unknown> {
  const timeouts = await getConfigValue('tools.timeouts', DEFAULT_TIMEOUTS);
  const timeout = timeouts[toolName] ?? FALLBACK_TIMEOUT;

  const startTime = Date.now();
  let success = true;
  let errorMsg: string | undefined;

  try {
    return await withTimeout(executeFn(), timeout, toolName);
  } catch (error) {
    success = false;
    errorMsg = error instanceof Error ? error.message : 'Unknown error';
    throw error;
  } finally {
    const durationMs = Date.now() - startTime;

    // 仅在有 requestId 时写入（requestId 在 ai_tool_calls 表中为 notNull）
    if (requestId) {
      db.insert(aiToolCalls)
        .values({
          requestId,
          toolName,
          durationMs,
          success,
          error: errorMsg ?? null,
        })
        .catch((err) => {
          console.error(`[ToolExecutor] 写入 ai_tool_calls 失败:`, err);
        });
    }
  }
}

/**
 * 执行单个工具
 */
export async function executeTool<TParams, TResult>(
  tool: ToolDefinition<TParams, TResult>,
  params: TParams,
  context: ToolContext,
): Promise<ToolResult<TResult>> {
  try {
    return await tool.execute(params, context);
  } catch (error) {
    console.error(`[Tool] ${tool.name} execution failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 批量执行工具
 */
export async function executeTools<TParams, TResult>(
  tools: Array<{ tool: ToolDefinition<TParams, TResult>; params: TParams }>,
  context: ToolContext,
): Promise<Array<ToolResult<TResult>>> {
  return Promise.all(
    tools.map(({ tool, params }) => executeTool(tool, params, context)),
  );
}

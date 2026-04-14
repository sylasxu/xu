/**
 * Persist Request Processor
 * 
 * Post-LLM Processor 纯函数，从 onFinish 中提取 ai_requests 表写入逻辑：
 * - 将 AI 请求记录（含 Processor 日志）持久化到 ai_requests 表
 * 
 * 失败时记录错误日志，不影响其他 Processor 执行
 */

import type { ProcessorContext, ProcessorResult, ProcessorLogEntry } from './types';
import { db, aiRequests } from '@xu/db';

/**
 * 持久化数据（通过 context.metadata.persistData 传入）
 */
export interface PersistData {
  userId: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  processorLog: ProcessorLogEntry[];
  p0MatchKeyword: string | null;
  input: string;
  output: string;
}

/**
 * Persist Request Processor
 * 
 * 将 AI 请求记录写入 ai_requests 数据库表
 */
export async function persistRequestProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    const persistData = context.metadata.persistData as PersistData | undefined;
    if (!persistData) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no_persist_data' },
      };
    }

    await db.insert(aiRequests).values({
      userId: persistData.userId || null,
      modelId: persistData.modelId,
      inputTokens: persistData.inputTokens,
      outputTokens: persistData.outputTokens,
      latencyMs: persistData.latencyMs,
      processorLog: persistData.processorLog,
      p0MatchKeyword: persistData.p0MatchKeyword,
      input: persistData.input.slice(0, 1000),
      output: persistData.output.slice(0, 1000),
    });

    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      data: {
        modelId: persistData.modelId,
        inputTokens: persistData.inputTokens,
        outputTokens: persistData.outputTokens,
      },
    };
  } catch (error) {
    return {
      success: false,
      context,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

// Processor 元数据
persistRequestProcessor.processorName = 'persist-request-processor';

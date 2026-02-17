/**
 * Record Metrics Processor
 * 
 * Post-LLM Processor 纯函数，从 onFinish 中提取指标记录逻辑：
 * - countAIRequest：记录 AI 请求计数
 * - recordAILatency：记录 AI 请求延迟
 * - recordTokenUsage：记录 Token 使用量
 * - recordTokenUsageWithLog：记录 Token 使用量（带日志）
 * 
 * 失败时记录错误日志，不影响其他 Processor 执行
 */

import type { ProcessorContext, ProcessorResult } from './types';
import {
  countAIRequest,
  recordAILatency,
  recordTokenUsage as recordMetricsTokenUsage,
  recordTokenUsageWithLog,
} from '../observability/metrics';

/**
 * Metrics 数据（通过 context.metadata.metricsData 传入）
 */
export interface MetricsData {
  modelId: string;
  duration: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  toolCalls?: Array<{ toolName: string }>;
  source?: string;
  intent?: string;
  userId?: string | null;
}

/**
 * Record Metrics Processor
 * 
 * 记录 AI 请求的各项指标（计数、延迟、Token 用量）
 */
export async function recordMetricsProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    const metricsData = context.metadata.metricsData as MetricsData | undefined;
    if (!metricsData) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no_metrics_data' },
      };
    }

    // 记录 AI 请求计数
    countAIRequest(metricsData.modelId, 'success');

    // 记录 AI 请求延迟
    recordAILatency(metricsData.modelId, metricsData.duration);

    // 记录 Token 使用量（指标系统）
    recordMetricsTokenUsage(metricsData.modelId, metricsData.inputTokens, metricsData.outputTokens);

    // 记录 Token 使用量（带日志）
    recordTokenUsageWithLog(
      metricsData.userId || null,
      {
        inputTokens: metricsData.inputTokens,
        outputTokens: metricsData.outputTokens,
        totalTokens: metricsData.totalTokens,
        cacheHitTokens: metricsData.cacheHitTokens,
        cacheMissTokens: metricsData.cacheMissTokens,
      },
      metricsData.toolCalls || [],
      {
        model: metricsData.modelId,
        source: metricsData.source,
        intent: metricsData.intent,
      }
    );

    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      data: {
        modelId: metricsData.modelId,
        duration: metricsData.duration,
        inputTokens: metricsData.inputTokens,
        outputTokens: metricsData.outputTokens,
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
recordMetricsProcessor.processorName = 'record-metrics-processor';

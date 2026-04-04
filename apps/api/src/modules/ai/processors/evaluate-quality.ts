/**
 * Evaluate Quality Processor
 * 
 * Post-LLM Processor 纯函数，从 onFinish 中提取质量评估和 conversationMetrics 记录逻辑：
 * - evaluateResponseQuality：评估 AI 响应质量
 * - recordConversationMetrics：记录对话质量指标到数据库
 * 
 * 失败时记录错误日志，不影响其他 Processor 执行
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { evaluateResponseQuality } from '../evals/runner';
import {
  recordConversationMetrics,
  extractConversionInfo,
} from '../observability/quality-metrics';
import { createLogger } from '../observability/logger';

const logger = createLogger('evaluate-quality-processor');

/**
 * 质量评估数据（通过 context.metadata.qualityData 传入）
 */
export interface QualityData {
  rawUserInput: string;
  aiResponseText: string;
  intent: string;
  intentConfidence: number;
  toolCallRecords: Array<{ toolName: string; result?: unknown }>;
  userId?: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  source?: string;
}

/**
 * Evaluate Quality Processor
 * 
 * 评估 AI 响应质量并记录对话质量指标
 */
export async function evaluateQualityProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    const qualityData = context.metadata.qualityData as QualityData | undefined;
    if (!qualityData) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no_quality_data' },
      };
    }

    // 1. 评估响应质量
    const evalResult = await evaluateResponseQuality({
      input: qualityData.rawUserInput,
      output: qualityData.aiResponseText,
      expectedIntent: qualityData.intent,
      actualToolCalls: qualityData.toolCallRecords.map(s => s.toolName),
    });

    if (evalResult.score < 0.6) {
      logger.warn('Low quality response detected', {
        score: evalResult.score,
        details: evalResult.details,
        input: qualityData.rawUserInput.slice(0, 50),
      });
    }

    // 2. 记录对话质量指标到数据库
    const conversionInfo = extractConversionInfo(qualityData.toolCallRecords);
    const toolsSucceeded = qualityData.toolCallRecords.filter(
      s => s.result && !(s.result as any)?.error
    ).length;
    const toolsFailed = qualityData.toolCallRecords.length - toolsSucceeded;

    await recordConversationMetrics({
      userId: qualityData.userId || undefined,
      intent: qualityData.intent,
      intentConfidence: qualityData.intentConfidence,
      intentRecognized: qualityData.intent !== 'unknown',
      toolsCalled: qualityData.toolCallRecords.map(s => s.toolName),
      toolsSucceeded,
      toolsFailed,
      inputTokens: qualityData.inputTokens,
      outputTokens: qualityData.outputTokens,
      totalTokens: qualityData.totalTokens,
      latencyMs: qualityData.latencyMs,
      activityCreated: conversionInfo.activityCreated,
      activityJoined: conversionInfo.activityJoined,
      activityId: conversionInfo.activityId,
      source: qualityData.source as 'web' | 'miniprogram' | 'admin' | undefined,
    });

    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      data: {
        score: evalResult.score,
        details: evalResult.details,
        toolsSucceeded,
        toolsFailed,
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
evaluateQualityProcessor.processorName = 'evaluate-quality-processor';

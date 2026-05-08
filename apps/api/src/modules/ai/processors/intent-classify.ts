import type { ProcessorContext, ProcessorResult } from './types';
import { classifyByFeatureCombination } from '../intent/feature-combination';

/**
 * Intent Classify Processor (v5.0)
 *
 * 单层意图分类处理器，仅使用 P1 Feature Combination 规则引擎。
 * 不再包含 P2 LLM Few-shot 分类器。
 *
 * 设计原则：
 * - P1 命中 → 返回分类结果
 * - P1 未命中 → 返回 intent: 'unknown'
 * - 永不失败：processor 始终返回 success: true，不阻断 pipeline
 */

export async function intentClassifyProcessor(
  context: ProcessorContext,
): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    // 提取最近 3 轮对话（6 条消息）作为分类上下文
    const conversationHistory = context.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));

    // 调用 P1 规则引擎
    const p1Result = await classifyByFeatureCombination(context.userInput, conversationHistory);

    const executionTime = Date.now() - startTime;

    return {
      success: true,
      context: {
        ...context,
        metadata: {
          ...context.metadata,
          intentClassify: {
            intent: p1Result.intent,
            confidence: p1Result.confidence,
            method: 'p1',
            matchedPattern: p1Result.matchedPattern,
            p1Features: p1Result.p1Features,
          },
        },
      },
      executionTime,
      data: {
        intent: p1Result.intent,
        confidence: p1Result.confidence,
        method: 'p1',
        matchedPattern: p1Result.matchedPattern,
      },
    };
  } catch (error) {
    // P1 异常时降级到 unknown，不阻断 pipeline
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : '意图分类异常';

    console.error('[intent-classify] P1 异常，降级到 unknown:', error);

    return {
      success: true,
      context: {
        ...context,
        metadata: {
          ...context.metadata,
          intentClassify: {
            intent: 'unknown',
            confidence: 0,
            method: 'p1',
            degraded: true,
          },
        },
      },
      executionTime,
      error: errorMessage,
      data: {
        intent: 'unknown',
        confidence: 0,
        method: 'p1',
        degraded: true,
      },
    };
  }
}

intentClassifyProcessor.processorName = 'intent-classify-processor';

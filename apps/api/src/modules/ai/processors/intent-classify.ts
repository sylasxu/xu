/**
 * Intent Classify Processor (v4.9)
 *
 * P1 + P2 层：意图分类处理器，实现三层漏斗级联逻辑。
 * - P1：Feature_Combination 规则引擎（多维特征组合）
 * - P2：LLM Few-shot 分类（当 P1 置信度不足时升级）
 * - P0 由 keyword-match-processor 独立处理，命中时不进入本处理器
 *
 * 级联逻辑：
 * 1. 提取最近 3 轮对话（6 条消息）作为分类上下文
 * 2. P1（Feature_Combination）：confidence ≥ 0.7 → 直接返回
 * 3. P1 confidence < 0.7 → 升级到 P2（LLM Few-shot）
 * 4. P1 异常 → 直接失败，不再静默降级
 * 5. P2 返回 unknown → 保留 unknown，不再回退历史意图
 *
 * 条件执行配置（在管线中使用）：
 * ```
 * { processor: intentClassifyProcessor, condition: (ctx) => !ctx.metadata.keywordMatch?.matched }
 * ```
 */

import type { ProcessorContext, ProcessorResult } from './types';
import type { IntentType } from '../intent/types';
import { classifyByFeatureCombination } from '../intent/feature-combination';
import { classifyByLLMFewShot } from '../intent/llm-classifier';

/** P1 → P2 升级的置信度阈值 */
const P1_CONFIDENCE_THRESHOLD = 0.7;

/**
 * 从 ProcessorContext 提取最近 3 轮对话（6 条消息）
 */
function extractConversationHistory(
  context: ProcessorContext,
): Array<{ role: string; content: string }> {
  return context.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-6)
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
}

/**
 * Intent Classify Processor
 *
 * 三层漏斗级联：P1（Feature_Combination）→ P2（LLM Few-shot）
 *
 * - P1 confidence ≥ 0.7：直接返回，method = 'p1'
 * - P1 confidence < 0.7：升级到 P2，method = 'p2'
 * - P1 异常：直接失败，返回 success: false
 * - P2 模型失败/解析失败：直接失败，返回 success: false
 * - P2 返回 unknown：保留 unknown，由后续主链路显式处理
 */
export async function intentClassifyProcessor(
  context: ProcessorContext,
): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    // 提取最近 3 轮对话（6 条消息）
    const conversationHistory = extractConversationHistory(context);

    let intent: IntentType = 'unknown';
    let confidence = 0;
    let method: 'p1' | 'p2' = 'p1';
    let matchedPattern: string | undefined;
    let p1Features: string[] | undefined;
    let p2FewShotUsed: boolean | undefined;
    let cachedResult = false;
    const requestAi = context.metadata.requestAi;

    // ---- P1：Feature_Combination 规则引擎 ----
    let p1Succeeded = false;
    try {
      const p1Result = await classifyByFeatureCombination(context.userInput, conversationHistory);

      if (p1Result.confidence >= P1_CONFIDENCE_THRESHOLD) {
        // P1 高置信度，直接采用
        intent = p1Result.intent;
        confidence = p1Result.confidence;
        method = 'p1';
        matchedPattern = p1Result.matchedPattern;
        p1Features = p1Result.p1Features;
        p1Succeeded = true;
      } else {
        // P1 低置信度，记录 P1 结果但升级到 P2
        p1Features = p1Result.p1Features;
        p1Succeeded = false;
      }
    } catch (p1Error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = p1Error instanceof Error
        ? p1Error.message
        : 'P1 Feature_Combination 异常';

      console.error('[intent-classify] P1 Feature_Combination 异常:', p1Error);

      return {
        success: false,
        context,
        executionTime,
        error: errorMessage,
        data: {
          stage: 'p1',
          durationMs: executionTime,
        },
      };
    }

    // ---- P2：LLM Few-shot 分类（P1 未产出高置信度结果时触发） ----
    if (!p1Succeeded) {
      try {
        const p2Result = await classifyByLLMFewShot(
          context.userInput,
          conversationHistory,
          undefined,
          { modelId: requestAi?.model },
        );

        intent = p2Result.intent;
        confidence = p2Result.confidence;
        method = 'p2';
        p2FewShotUsed = true;
        cachedResult = false;
      } catch (p2Error) {
        const executionTime = Date.now() - startTime;
        const errorMessage = p2Error instanceof Error
          ? p2Error.message
          : 'P2 LLM Few-shot 异常';

        console.error('[intent-classify] P2 LLM Few-shot 异常:', p2Error);

        return {
          success: false,
          context,
          executionTime,
          error: errorMessage,
          data: {
            stage: 'p2',
            durationMs: executionTime,
          },
        };
      }
    }

    const executionTime = Date.now() - startTime;

    return {
      success: true,
      context: {
        ...context,
        metadata: {
          ...context.metadata,
          intentClassify: {
            intent,
            confidence,
            method,
            matchedPattern,
            p1Features,
            p2FewShotUsed,
            cachedResult,
            degraded: false,
          },
        },
      },
      executionTime,
      data: {
        intent,
        confidence,
        method,
        matchedPattern,
        degraded: false,
        durationMs: executionTime,
      },
    };
  } catch (error) {
    // 真正意外的错误（非分类逻辑错误）
    const executionTime = Date.now() - startTime;

    return {
      success: false,
      context,
      executionTime,
      error: error instanceof Error ? error.message : '意图分类处理器异常',
      data: {
        durationMs: executionTime,
        error: true,
      },
    };
  }
}

intentClassifyProcessor.processorName = 'intent-classify-processor';

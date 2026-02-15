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
 * 4. P1 异常 → 降级到 P2，标记 degraded: true
 * 5. P2 也返回 unknown → 降级到对话历史最近有效意图，最终兜底 unknown
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
 * 从对话历史中查找最近的有效（非 unknown）意图
 *
 * 简化版降级策略：扫描历史消息中的意图标记。
 * 当前实现直接返回 unknown，后续可通过 metadata 中存储的历史意图增强。
 */
function findRecentValidIntent(
  _history: Array<{ role: string; content: string }>,
): IntentType {
  // 简化降级：当前无法从纯文本历史中提取已分类意图
  // 后续可通过 context.metadata.conversationSummary.recentIntents 增强
  return 'unknown';
}

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
 * 三层漏斗级联：P1（Feature_Combination）→ P2（LLM Few-shot）→ 降级兜底
 *
 * - P1 confidence ≥ 0.7：直接返回，method = 'p1'
 * - P1 confidence < 0.7：升级到 P2，method = 'p2'
 * - P1 异常：降级到 P2，标记 degraded = true
 * - P2 返回 unknown：降级到最近有效意图，最终兜底 unknown
 * - 分类失败不是处理器失败，始终返回 success: true
 * - 仅在真正意外错误时返回 success: false
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
    let degraded = false;

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
      // P1 异常，降级到 P2，标记 degraded
      console.error('[intent-classify] P1 Feature_Combination 异常，降级到 P2:', p1Error);
      degraded = true;
      p1Succeeded = false;
    }

    // ---- P2：LLM Few-shot 分类（P1 未产出高置信度结果时触发） ----
    if (!p1Succeeded) {
      try {
        const p2Result = await classifyByLLMFewShot(context.userInput, conversationHistory);

        if (p2Result.intent !== 'unknown') {
          // P2 返回有效意图
          intent = p2Result.intent;
          confidence = p2Result.confidence;
          method = 'p2';
          p2FewShotUsed = true;
          // 检测是否命中了编辑距离缓存（P2 内部处理）
          cachedResult = false;
        } else {
          // P2 也返回 unknown，降级到最近有效意图
          intent = findRecentValidIntent(conversationHistory);
          confidence = intent === 'unknown' ? 0 : 0.4;
          method = 'p2';
          p2FewShotUsed = true;
        }
      } catch (p2Error) {
        // P2 也失败，最终兜底 unknown
        console.error('[intent-classify] P2 LLM Few-shot 异常:', p2Error);
        intent = findRecentValidIntent(conversationHistory);
        confidence = intent === 'unknown' ? 0 : 0.3;
        method = 'p2';
        p2FewShotUsed = true;
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
            degraded,
          },
        },
      },
      executionTime,
      data: {
        intent,
        confidence,
        method,
        matchedPattern,
        degraded,
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

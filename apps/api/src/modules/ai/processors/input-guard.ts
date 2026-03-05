/**
 * Input Guard Processor (v4.8)
 *
 * 统一复用 guardrails/checkInput，避免双维护安全规则。
 */

import { checkInput, sanitizeInput } from '../guardrails/input-guard';
import type { ProcessorContext, ProcessorResult } from './types';

export async function inputGuardProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    const normalizedInput = sanitizeInput(context.userInput);
    const nextContext: ProcessorContext = {
      ...context,
      userInput: normalizedInput,
    };

    const guardResult = await checkInput(
      normalizedInput,
      {},
      context.userId ? { userId: context.userId } : undefined
    );

    if (!guardResult.passed || guardResult.blocked) {
      return {
        success: false,
        context: nextContext,
        executionTime: Date.now() - startTime,
        error: guardResult.reason || '输入安全检查未通过',
        data: {
          inputLength: normalizedInput.length,
          blocked: guardResult.blocked,
          riskLevel: guardResult.riskLevel,
          triggeredRules: guardResult.triggeredRules || [],
        },
      };
    }

    return {
      success: true,
      context: nextContext,
      executionTime: Date.now() - startTime,
      data: {
        inputLength: normalizedInput.length,
        blocked: false,
        riskLevel: guardResult.riskLevel,
        triggeredRules: guardResult.triggeredRules || [],
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

inputGuardProcessor.processorName = 'input-guard-processor';

/**
 * Output Guard Processor
 * 
 * Post-LLM Processor 纯函数，对 AI 输出执行安全检查：
 * - PII 检测与替换
 * - 有害内容检测
 * - 输出长度限制
 * 
 * 不阻断响应，只清理内容并记录风险等级
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { checkOutput, sanitizeOutput } from '../guardrails/output-guard';

/**
 * Output Guard Processor
 * 
 * 对 AI 响应文本执行 Output Guard 检查和清理
 */
export async function outputGuardProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    // 获取最后一条 assistant 消息
    const lastMessage = context.messages[context.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no_assistant_message' },
      };
    }

    const content = typeof lastMessage.content === 'string' ? lastMessage.content : '';
    if (!content) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'empty_content' },
      };
    }

    // 检查输出风险
    const checkResult = await checkOutput(content);

    // 清理输出（替换 PII 等）
    const sanitized = await sanitizeOutput(content);
    const wasSanitized = content !== sanitized;

    // 更新 context：替换最后一条消息为清理后的内容
    const updatedMessages = wasSanitized
      ? [
          ...context.messages.slice(0, -1),
          { ...lastMessage, content: sanitized },
        ]
      : context.messages;

    return {
      success: true,
      context: {
        ...context,
        messages: updatedMessages,
        metadata: {
          ...context.metadata,
          outputGuard: {
            sanitized: wasSanitized,
            riskLevel: checkResult.riskLevel,
            triggeredRules: checkResult.triggeredRules,
            blocked: checkResult.blocked,
          },
        },
      },
      executionTime: Date.now() - startTime,
      data: {
        riskLevel: checkResult.riskLevel,
        triggeredRules: checkResult.triggeredRules,
        sanitized: wasSanitized,
        blocked: checkResult.blocked,
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
outputGuardProcessor.processorName = 'output-guard-processor';

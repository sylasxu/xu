/**
 * Keyword Match Processor (v4.9)
 *
 * P0 层：全局关键词匹配，作为附加业务信号。
 * 命中时将匹配数据写入 context.metadata.keywordMatch，
 * 主链路仍然继续走 recall + generate，只把它用于统计和后置策略。
 *
 * 设计决策：此处理器作为独立预检查步骤在 runProcessors 管线之前执行，
 * 不放入 runProcessors 管线。它只补充 metadata，不再直接控制回复路径。
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { matchKeyword } from '../../hot-keywords/hot-keywords.service';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('keyword-match-processor');

/**
 * Keyword Match Processor
 *
 * 调用 matchKeyword 进行全局关键词匹配：
 * - 命中：写入 context.metadata.keywordMatch（matched: true + 匹配详情），返回 success: true
 * - 未命中：写入 context.metadata.keywordMatch（matched: false），正常传递 context
 * - 异常：视为未命中，记录错误，返回 success: true（不阻塞后续处理器）
 */
export async function keywordMatchProcessor(
  context: ProcessorContext
): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    const result = await matchKeyword(context.userInput);

    if (result) {
      // v4.9: 观测性日志 - P0 热词命中
      logger.info({
        event: 'p0_keyword_matched',
        userId: context.userId || 'anon',
        keywordId: result.id,
        keyword: result.keyword,
        matchType: result.matchType,
        responseType: result.responseType,
        executionTime: Date.now() - startTime,
      }, 'P0 keyword matched');

      return {
        success: true,
        context: {
          ...context,
          metadata: {
            ...context.metadata,
            keywordMatch: {
              matched: true,
              keywordId: result.id,
              keyword: result.keyword,
              matchType: result.matchType,
              priority: result.priority,
              responseType: result.responseType,
            },
          },
        },
        executionTime: Date.now() - startTime,
        data: {
          matched: true,
          keywordId: result.id,
          keyword: result.keyword,
          matchType: result.matchType,
          priority: result.priority,
          responseType: result.responseType,
        },
      };
    }

    // v4.9: 观测性日志 - P0 热词未命中
    logger.info({
      event: 'p0_keyword_missed',
      userId: context.userId || 'anon',
      inputLength: context.userInput.length,
      executionTime: Date.now() - startTime,
    }, 'P0 keyword missed');

    // 未命中
    return {
      success: true,
      context: {
        ...context,
        metadata: {
          ...context.metadata,
          keywordMatch: { matched: false },
        },
      },
      executionTime: Date.now() - startTime,
      data: { matched: false },
    };
  } catch (error) {
    // 关键词服务不可用时视为未命中，不阻塞后续处理器
    return {
      success: true,
      context: {
        ...context,
        metadata: {
          ...context.metadata,
          keywordMatch: { matched: false },
        },
      },
      executionTime: Date.now() - startTime,
      data: { matched: false, error: true },
      error: error instanceof Error ? error.message : '关键词匹配服务异常',
    };
  }
}

keywordMatchProcessor.processorName = 'keyword-match-processor';

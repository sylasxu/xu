/**
 * Extract Preferences Processor
 *
 * 负责从最近几轮用户对话里提取可复用的画像线索，并写入长期记忆：
 * - 偏好
 * - 常去地点
 * - 身份线索
 * - 重要人物/关系线索
 *
 * 这是一个后处理 Processor，在 AI 响应生成后异步执行，不阻塞主链路。
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { extractPreferencesFromConversation } from '../memory/extractor';
import { persistExtractedUserMemories } from '../memory/user-memories';
import { hasPreferenceSignal } from '../memory/preference-signal';

function normalizeConversationMessages(messages: ProcessorContext['messages']): Array<{ role: string; content: string }> {
  return messages.slice(-5).map((message) => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
  }));
}

function hasExtractionResult(result: Awaited<ReturnType<typeof extractPreferencesFromConversation>>): boolean {
  return (
    result.preferences.length > 0 ||
    result.frequentLocations.length > 0 ||
    result.identityFacts.length > 0 ||
    result.socialContextFacts.length > 0
  );
}

export async function extractPreferencesProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    const { userId, messages } = context;

    if (!userId) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-user-id' },
      };
    }

    const recentMessages = normalizeConversationMessages(messages);
    if (!hasPreferenceSignal(recentMessages)) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-preference-signal' },
      };
    }

    // 前置过滤已排除无信号对话；有价值时再调用 LLM 做精准提取
    const extraction = await extractPreferencesFromConversation(recentMessages, {
      useLLM: true,
    });

    if (!hasExtractionResult(extraction)) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-extraction-result' },
      };
    }

    await persistExtractedUserMemories(userId, extraction);

    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      data: {
        extracted: {
          preferencesCount: extraction.preferences.length,
          locationsCount: extraction.frequentLocations.length,
          identityFactsCount: extraction.identityFacts.length,
          socialContextFactsCount: extraction.socialContextFacts.length,
        },
      },
    };
  } catch (error) {
    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : '未知错误',
      data: { skipped: true, reason: 'error' },
    };
  }
}

extractPreferencesProcessor.processorName = 'extract-preferences-processor';

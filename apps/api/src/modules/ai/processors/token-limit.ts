/**
 * Token Limit Processor (v4.8)
 * 
 * 负责 Token 限制和截断：
 * - 估算消息列表的 Token 数量
 * - 如果超过限制，截断旧消息
 * - 保留最近的消息和系统提示词
 * 
 * Token 估算规则（简化版）：
 * - 中文：1 字符 ≈ 1.5 tokens
 * - 英文：1 单词 ≈ 1.3 tokens
 * - 实际应使用 tiktoken 库进行精确计算
 */

import type { ProcessorContext, ProcessorResult, Message } from './types';

// Token 限制（根据模型调整）
const MAX_TOKENS = 8000; // 为输出预留 2000 tokens

/**
 * 估算文本的 Token 数量（简化版）
 */
function estimateTokens(text: string): number {
  // 统计中文字符数
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  
  // 统计英文单词数
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  
  // 其他字符（标点、数字等）
  const otherChars = text.length - chineseChars - englishWords;
  
  return Math.ceil(
    chineseChars * 1.5 +
    englishWords * 1.3 +
    otherChars * 0.5
  );
}

/**
 * 估算消息列表的总 Token 数
 */
function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((total, msg) => {
    const content = typeof msg.content === 'string' 
      ? msg.content 
      : JSON.stringify(msg.content);
    return total + estimateTokens(content);
  }, 0);
}

/**
 * Token Limit Processor
 * 
 * 限制和截断消息以符合 Token 限制
 */
export async function tokenLimitProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();
  
  try {
    const { messages, systemPrompt } = context;
    
    // 估算当前 Token 数
    const systemTokens = estimateTokens(systemPrompt);
    const messagesTokens = estimateMessagesTokens(messages);
    const totalTokens = systemTokens + messagesTokens;
    
    // 如果未超过限制，直接返回
    if (totalTokens <= MAX_TOKENS) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: {
          totalTokens,
          systemTokens,
          messagesTokens,
          truncated: false,
        },
      };
    }
    
    // 需要截断消息
    const targetTokens = MAX_TOKENS - systemTokens;
    const truncatedMessages: Message[] = [];
    let currentTokens = 0;
    
    // 从最新的消息开始保留
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : JSON.stringify(msg.content);
      const msgTokens = estimateTokens(content);
      
      if (currentTokens + msgTokens <= targetTokens) {
        truncatedMessages.unshift(msg);
        currentTokens += msgTokens;
      } else {
        break;
      }
    }
    
    // 确保至少保留最后一条用户消息
    if (truncatedMessages.length === 0 && messages.length > 0) {
      truncatedMessages.push(messages[messages.length - 1]);
    }
    
    const updatedContext: ProcessorContext = {
      ...context,
      messages: truncatedMessages,
    };
    
    return {
      success: true,
      context: updatedContext,
      executionTime: Date.now() - startTime,
      data: {
        originalTokens: totalTokens,
        truncatedTokens: systemTokens + estimateMessagesTokens(truncatedMessages),
        originalMessages: messages.length,
        truncatedMessages: truncatedMessages.length,
        truncated: true,
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
tokenLimitProcessor.processorName = 'token-limit-processor';

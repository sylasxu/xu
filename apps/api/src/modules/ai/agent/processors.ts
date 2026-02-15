/**
 * Agent Processors - Mastra 风格的输入/输出处理器
 * 
 * v4.5 Agent 封装层
 * 
 * Processors 是在 LLM 调用前后执行的处理器：
 * - Input Processors: 在消息发送给 LLM 之前执行
 * - Output Processors: 在 LLM 响应返回给用户之前执行
 */

import type { Processor, RuntimeContext, Message } from './types';
import type { EnhancedUserProfile } from '../memory/working';
import {
  getEnhancedUserProfile,
  buildProfilePrompt,
  updateEnhancedUserProfile,
} from '../memory/working';
import { saveMessage } from '../memory/store';
import { extractPreferencesFromConversation } from '../memory/extractor';
import { semanticRecall } from '../memory/semantic';
import { checkInput, sanitizeInput } from '../guardrails/input-guard';
import { checkOutput, sanitizeOutput } from '../guardrails/output-guard';
import { createLogger } from '../observability/logger';

const logger = createLogger('agent-processors');

// ============ Helper Functions ============

/**
 * 获取消息内容字符串
 */
function getMessageContent(msg: Message): string {
  if (typeof msg.content === 'string') {
    return msg.content;
  }
  return JSON.stringify(msg.content);
}

/**
 * 检查是否为增强版用户画像
 */
function isEnhancedProfile(profile: any): profile is EnhancedUserProfile {
  return profile && profile.version === 2;
}

// ============ Input Processors ============

/**
 * 输入安全检查处理器
 * 检查用户输入是否包含敏感内容或注入攻击
 */
export const inputGuardProcessor: Processor = {
  name: 'input-guard',
  processInput: async (messages, ctx) => {
    // 获取最后一条用户消息
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();

    if (!lastUserMsg) return messages;

    const content = typeof lastUserMsg.content === 'string'
      ? lastUserMsg.content
      : JSON.stringify(lastUserMsg.content);

    // 检查输入
    const result = checkInput(content);

    if (result.blocked) {
      logger.warn('Input blocked by guardrail', {
        userId: ctx.userId,
        reason: result.reason,
        triggeredRules: result.triggeredRules,
      });
      throw new Error(result.suggestedResponse || '输入被拦截');
    }

    // 清理输入（移除潜在危险内容）
    const sanitized = sanitizeInput(content);
    if (sanitized !== content) {
      logger.debug('Input sanitized', {
        userId: ctx.userId,
        originalLength: content.length,
        sanitizedLength: sanitized.length,
      });

      // 更新消息内容
      return messages.map(m => {
        if (m === lastUserMsg) {
          return { ...m, content: sanitized };
        }
        return m;
      });
    }

    return messages;
  },
};

/**
 * 用户画像注入处理器
 * 在消息发送给 LLM 之前，注入用户偏好信息
 */
export const userProfileProcessor: Processor = {
  name: 'user-profile-injector',
  processInput: async (messages, ctx) => {
    // 如果没有用户 ID，跳过
    if (!ctx.userId) return messages;

    // 获取用户画像（优先使用上下文中的，否则从数据库获取）
    let profile: EnhancedUserProfile;
    if (ctx.userProfile && isEnhancedProfile(ctx.userProfile)) {
      profile = ctx.userProfile;
    } else {
      profile = await getEnhancedUserProfile(ctx.userId);
    }

    if (!profile || (profile.preferences.length === 0 && profile.frequentLocations.length === 0)) {
      return messages;
    }

    // 构建画像 Prompt
    const profilePrompt = buildProfilePrompt(profile);
    if (!profilePrompt) return messages;

    // 找到第一条 system message 并注入用户画像
    const systemIndex = messages.findIndex(m => m.role === 'system');
    if (systemIndex >= 0) {
      const systemMsg = messages[systemIndex];
      const systemContent = getMessageContent(systemMsg);

      messages[systemIndex] = {
        ...systemMsg,
        content: `${systemContent}\n\n${profilePrompt}`,
      };
    } else {
      // 如果没有 system message，在开头添加一条
      messages.unshift({
        id: 'profile-injection',
        role: 'system',
        content: profilePrompt,
      });
    }

    logger.debug('User profile injected', {
      userId: ctx.userId,
      preferencesCount: profile.preferences?.length || 0,
      locationsCount: profile.frequentLocations?.length || 0,
    });

    return messages;
  },
};


/**
 * Token 限制处理器
 * 截断过长的消息，避免超出模型上下文窗口
 */
export const tokenLimitProcessor: Processor = {
  name: 'token-limiter',
  processInput: async (messages, ctx) => {
    // 估算 Token 限制（约 12k tokens，按字符估算）
    const maxChars = 24000; // 大约 12k tokens (中文约 2 字符/token)
    let totalLength = 0;

    // 先保留 system 消息
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    // 计算 system 消息长度
    const result: Message[] = [];
    for (const msg of systemMsgs) {
      const content = getMessageContent(msg);
      totalLength += content.length;
      result.push(msg);
    }

    // 从最新消息开始保留非 system 消息
    const keptNonSystem: Message[] = [];
    for (let i = nonSystemMsgs.length - 1; i >= 0; i--) {
      const msg = nonSystemMsgs[i];
      const content = getMessageContent(msg);
      const msgLength = content.length;

      if (totalLength + msgLength > maxChars && keptNonSystem.length > 0) {
        logger.warn('Messages truncated due to token limit', {
          userId: ctx.userId,
          originalCount: messages.length,
          keptCount: result.length + keptNonSystem.length,
          truncatedChars: totalLength,
        });
        break;
      }

      keptNonSystem.unshift(msg);
      totalLength += msgLength;
    }

    // 合并结果：system 消息在前，其他消息按时间顺序
    return [...result, ...keptNonSystem];
  },
};

// ============ Output Processors ============

/**
 * 输出安全检查处理器
 * 检查 LLM 输出是否包含敏感内容
 */
export const outputGuardProcessor: Processor = {
  name: 'output-guard',
  processOutputResult: async (result, ctx) => {
    if (!result?.text) return result;

    const checkResult = checkOutput(result.text);

    if (checkResult.blocked) {
      logger.warn('Output blocked by guardrail', {
        userId: ctx.userId,
        reason: checkResult.reason,
        triggeredRules: checkResult.triggeredRules,
      });
      return {
        ...result,
        text: checkResult.suggestedResponse || '抱歉，我无法回答这个问题。',
      };
    }

    // 清理输出（替换 PII 等）
    const sanitized = sanitizeOutput(result.text);
    if (sanitized !== result.text) {
      logger.debug('Output sanitized', {
        userId: ctx.userId,
        originalLength: result.text.length,
        sanitizedLength: sanitized.length,
      });
      return {
        ...result,
        text: sanitized,
      };
    }

    return result;
  },
};

/**
 * 会话历史保存处理器
 * 在 LLM 响应后保存对话历史
 */
export const saveHistoryProcessor: Processor = {
  name: 'save-history',
  processOutputResult: async (result, ctx) => {
    // 如果没有用户 ID 或会话 ID，跳过
    if (!ctx.userId || !ctx.conversationId) return result;

    try {
      // 保存用户消息（统一使用 { text } 对象格式）
      if (ctx.lastUserMessage) {
        await saveMessage({
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          role: 'user',
          messageType: 'text',
          content: { text: ctx.lastUserMessage },
        });
      }

      // 保存 AI 响应（统一使用 { text } 对象格式）
      if (result?.text) {
        // 检查是否有 Tool 调用返回的 activityId
        const activityId = extractActivityIdFromToolResults(result.toolResults);

        await saveMessage({
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          role: 'assistant',
          messageType: result.toolCalls?.length ? 'widget_action' : 'text',
          content: { text: result.text },
          activityId,
        });
      }

      logger.debug('Conversation saved', {
        conversationId: ctx.conversationId,
        userId: ctx.userId,
      });
    } catch (error) {
      // 保存失败不阻塞响应
      logger.error('Failed to save conversation', {
        error: error instanceof Error ? error.message : 'Unknown error',
        conversationId: ctx.conversationId,
      });
    }

    return result;
  },
};

/**
 * 从 Tool 结果中提取 activityId
 */
function extractActivityIdFromToolResults(toolResults?: Array<{ result: any }>): string | undefined {
  if (!toolResults?.length) return undefined;

  for (const tr of toolResults) {
    if (tr.result?.data?.activityId) {
      return tr.result.data.activityId;
    }
    if (tr.result?.activityId) {
      return tr.result.activityId;
    }
  }

  return undefined;
}

/**
 * 偏好提取处理器
 * 从对话中提取用户偏好并更新画像
 */
export const extractPreferencesProcessor: Processor = {
  name: 'extract-preferences',
  processOutputResult: async (result, ctx) => {
    // 如果没有用户 ID，跳过
    if (!ctx.userId) return result;

    // 如果没有用户消息，跳过
    if (!ctx.lastUserMessage) return result;

    // 异步执行，不阻塞响应
    extractPreferencesAsync(ctx.userId, ctx.lastUserMessage, result?.text).catch(err => {
      logger.error('Failed to extract preferences', {
        error: err instanceof Error ? err.message : 'Unknown error',
        userId: ctx.userId,
      });
    });

    return result;
  },
};

/**
 * 异步提取偏好
 */
async function extractPreferencesAsync(
  userId: string,
  userMessage: string,
  aiResponse?: string
): Promise<void> {
  // 构建对话历史
  const history = [
    { role: 'user', content: userMessage },
  ];

  if (aiResponse) {
    history.push({ role: 'assistant', content: aiResponse });
  }

  // 提取偏好
  const extraction = await extractPreferencesFromConversation(history, { useLLM: true });

  // 如果提取到偏好，更新用户画像
  if (extraction.preferences.length > 0 || extraction.frequentLocations.length > 0) {
    await updateEnhancedUserProfile(userId, extraction);

    logger.debug('User preferences updated', {
      userId,
      preferencesCount: extraction.preferences.length,
      locationsCount: extraction.frequentLocations.length,
    });
  }
}

// ============ Default Processor Chains ============

/** 默认输入处理器链 */
export const defaultInputProcessors: Processor[] = [
  inputGuardProcessor,
  userProfileProcessor,
  tokenLimitProcessor,
];

/** 默认输出处理器链 */
export const defaultOutputProcessors: Processor[] = [
  outputGuardProcessor,
  saveHistoryProcessor,
  extractPreferencesProcessor,
];

// ============ Processor Utilities ============

/**
 * 执行输入处理器链
 */
export async function runInputProcessors(
  processors: Processor[],
  messages: Message[],
  ctx: RuntimeContext
): Promise<Message[]> {
  let result = messages;

  for (const processor of processors) {
    if (processor.processInput) {
      try {
        result = await processor.processInput(result, ctx);
      } catch (error) {
        logger.error(`Input processor "${processor.name}" failed`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error; // 输入处理器失败应该阻止请求
      }
    }
  }

  return result;
}

/**
 * 执行输出处理器链
 */
export async function runOutputProcessors(
  processors: Processor[],
  result: any,
  ctx: RuntimeContext
): Promise<any> {
  let processed = result;

  for (const processor of processors) {
    if (processor.processOutputResult) {
      try {
        processed = await processor.processOutputResult(processed, ctx);
      } catch (error) {
        // 输出处理器失败不阻止响应，只记录日志
        logger.error(`Output processor "${processor.name}" failed`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  return processed;
}


// ============ Legacy Compatibility ============

/**
 * 处理 AI 请求上下文（兼容旧版 processors/ai-pipeline.ts）
 * 
 * @deprecated 使用 userProfileProcessor 代替
 */
export async function processAIContext(params: {
  userId: string | null;
  message: string;
  systemPrompt: string;
  history?: Array<{ role: string; content: string }>;
}): Promise<string> {
  let prompt = params.systemPrompt;

  // 1. 注入用户画像（如果有）
  if (params.userId) {
    const profile = await getEnhancedUserProfile(params.userId);
    if (profile.preferences.length > 0 || profile.frequentLocations.length > 0) {
      const profilePrompt = buildProfilePrompt(profile);
      if (profilePrompt) {
        prompt += `\n\n${profilePrompt}`;
        logger.debug('User profile injected (legacy)', {
          preferencesCount: profile.preferences.length,
        });
      }
    }
  }

  // 1.5 语义召回（Semantic Recall）
  if (params.userId && params.message) {
    try {
      // 召回最近 3 条相关消息，阈值 0.6
      const relevantMsgs = await semanticRecall(params.message, params.userId, { limit: 3, threshold: 0.6 });

      if (relevantMsgs.length > 0) {
        prompt += '\n\n<relevant_history>\n以下是与当前话题相关的历史对话：\n';
        for (const msg of relevantMsgs) {
          // 截断过长的内容
          const content = msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content;
          prompt += `- [${msg.role}]: ${content}\n`;
        }
        prompt += '</relevant_history>\n请参考历史对话上下文来回答，避免重复问题。';

        logger.debug('Semantic recall injected (legacy)', {
          count: relevantMsgs.length,
          userId: params.userId
        });
      }
    } catch (err) {
      // 召回失败不影响主流程
      logger.warn('Semantic recall failed in pipeline', {
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }

  // 2. Token 限制（简单截断）
  const maxLength = 12000;
  if (prompt.length > maxLength) {
    logger.warn('System prompt truncated', { originalLength: prompt.length });
    prompt = prompt.slice(0, maxLength) + '\n...[内容过长，已截断]';
  }

  return prompt;
}

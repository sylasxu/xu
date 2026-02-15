/**
 * Agent Router - 意图路由
 * 
 * v4.5 Agent 封装层
 * 
 * 根据用户消息分类意图，选择对应的 Agent
 */

import type { IntentType as AgentIntentType, AgentName } from './types';
import { INTENT_TO_AGENT } from './types';
import { 
  classifyIntent as classifyIntentImpl, 
  classifyIntentSync,
} from '../intent/classifier';
import type { Message } from './types';
import { createLogger } from '../observability/logger';

const logger = createLogger('agent-router');

/** 路由结果 */
export interface RouteResult {
  /** 意图类型 */
  intent: AgentIntentType;
  /** Agent 名称 */
  agentName: AgentName;
  /** 置信度 */
  confidence: number;
  /** 分类方法 */
  method: 'regex' | 'llm' | 'p0' | 'p1' | 'p2';
}

/**
 * 意图分类 (委托给现有 intent/classifier)
 * 
 * @param message - 用户消息
 * @param history - 对话历史
 * @param hasDraftContext - 是否有草稿上下文
 */
export async function classifyIntent(
  message: string,
  history?: Message[],
  hasDraftContext = false
): Promise<RouteResult> {
  // 转换历史格式
  const conversationHistory = history?.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));

  // 调用现有分类器
  const result = await classifyIntentImpl(message, {
    hasDraftContext,
    conversationHistory,
  });

  // 映射意图到 Agent
  const agentIntent = mapToAgentIntent(result.intent);
  const agentName = INTENT_TO_AGENT[agentIntent];

  logger.debug('Intent classified', {
    message: message.slice(0, 50),
    intent: result.intent,
    agentIntent,
    agentName,
    confidence: result.confidence,
    method: result.method,
  });

  return {
    intent: agentIntent,
    agentName,
    confidence: result.confidence,
    method: result.method,
  };
}

/**
 * 快速同步分类 (仅正则，不调用 LLM)
 */
export function classifyIntentFast(
  message: string,
  hasDraftContext = false
): RouteResult {
  const result = classifyIntentSync(message, hasDraftContext);
  const agentIntent = mapToAgentIntent(result.intent);
  const agentName = INTENT_TO_AGENT[agentIntent];

  return {
    intent: agentIntent,
    agentName,
    confidence: result.confidence,
    method: result.method,
  };
}

/**
 * 将 classifier 的意图类型映射到 Agent 意图类型
 */
function mapToAgentIntent(classifierIntent: string): AgentIntentType {
  const mapping: Record<string, AgentIntentType> = {
    explore: 'EXPLORE',
    create: 'CREATE',
    partner: 'PARTNER',
    manage: 'MANAGE',
    chitchat: 'CHAT',
    idle: 'CHAT',
    unknown: 'CHAT',
  };

  return mapping[classifierIntent] || 'CHAT';
}

/**
 * 根据 Agent 名称获取意图类型
 */
export function getIntentForAgent(agentName: AgentName): AgentIntentType {
  const reverseMapping: Record<AgentName, AgentIntentType> = {
    explorer: 'EXPLORE',
    creator: 'CREATE',
    partner: 'PARTNER',
    manager: 'MANAGE',
    chat: 'CHAT',
  };

  return reverseMapping[agentName];
}

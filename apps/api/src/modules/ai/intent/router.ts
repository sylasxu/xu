/**
 * Intent Router - 意图路由器
 * 
 * 将意图映射到对应的工具集
 * 
 * v4.9: getToolsForIntent 已合并到 tools/registry.ts 的 getToolNamesByIntent
 */

import type { IntentType } from './types';
import { getToolNamesByIntent } from '../tools/registry';

/**
 * @deprecated 使用 tools/registry.ts 的 getToolNamesByIntent 替代
 * 获取意图对应的工具列表
 */
export function getToolsForIntent(intent: IntentType): string[] {
  return getToolNamesByIntent(intent);
}

/**
 * 检查意图是否需要调用 Tool
 */
export function intentRequiresTool(intent: IntentType): boolean {
  return getToolNamesByIntent(intent).length > 0;
}

/**
 * 检查意图是否为闲聊（不需要 LLM）
 */
export function isChitchatIntent(intent: IntentType): boolean {
  return intent === 'chitchat';
}

/**
 * 获取所有可用工具名称
 */
export function getAllToolNames(): string[] {
  // 收集所有意图的工具名称
  const allIntents: IntentType[] = [
    'create', 'explore', 'manage', 'partner', 'chitchat', 'idle',
    'modify', 'confirm', 'deny', 'cancel', 'share', 'join', 'show_activity', 'unknown',
  ];
  const allTools = new Set<string>();
  for (const intent of allIntents) {
    for (const tool of getToolNamesByIntent(intent)) {
      allTools.add(tool);
    }
  }
  return Array.from(allTools);
}

/**
 * 根据用户状态动态调整工具列表
 * 
 * @deprecated 使用 tools/registry.ts 的 getToolNamesByIntent(intent, options) 替代
 * @param intent - 意图类型
 * @param options - 选项
 * @returns 调整后的工具列表
 */
export function getToolsWithContext(
  intent: IntentType,
  options: {
    hasDraftContext?: boolean;
    hasLocation?: boolean;
    isLoggedIn?: boolean;
  } = {}
): string[] {
  return getToolNamesByIntent(intent, options);
}

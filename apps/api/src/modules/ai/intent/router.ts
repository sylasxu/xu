/**
 * Intent Router - 意图路由器
 *
 * 意图相关的辅助判断函数
 *
 * v5.0: 废弃函数已清理
 * - getToolsForIntent → 使用 tools/registry.ts 的 getToolNamesByIntent
 * - getToolsWithContext → 使用 tools/registry.ts 的 getToolNamesByIntent(intent, options)
 * - getAllToolNames → 不再需要，工具列表通过 TOOL_FACTORIES 管理
 */

import type { IntentType } from './types';

/**
 * 检查意图是否为闲聊（不需要 Tool）
 */
export function isChitchatIntent(intent: IntentType): boolean {
  return intent === 'chitchat';
}

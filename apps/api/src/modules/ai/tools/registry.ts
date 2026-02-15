/**
 * Tool Registry - 工具注册表
 * 
 * 管理所有 AI Tools 的注册和获取
 * 支持按意图动态加载 Tools
 * 
 * v4.9: 合并工具解析函数
 * - resolveToolsForIntent: 统一的工具实例解析入口（合并原 getToolsByIntent + getToolsForIntent）
 * - getToolNamesByIntent: 统一的工具名称解析入口（合并原 getToolsForIntent(router) + getToolNamesForIntent）
 */

import type { IntentType } from '../intent/types';
import type { ToolContext } from './types';

// 导入所有 Tool 工厂函数
import {
  createActivityDraftTool,
  getDraftTool,
  refineDraftTool,
  publishActivityTool,
} from './activity-tools';
import {
  joinActivityTool,
  cancelActivityTool,
  getMyActivitiesTool,
  getActivityDetailTool,
  askPreferenceTool,
} from './query-tools';
import { exploreNearbyTool } from './explore-nearby';
import {
  createPartnerIntentTool,
  getMyIntentsTool,
  cancelIntentTool,
  confirmMatchTool,
} from './partner-tools';

/**
 * 意图到 Tool 的映射配置
 */
const INTENT_TOOL_MAP: Record<IntentType, string[]> = {
  create: ['createActivityDraft', 'getDraft', 'refineDraft', 'publishActivity'],
  explore: ['exploreNearby', 'getActivityDetail', 'joinActivity', 'askPreference', 'createPartnerIntent'],
  manage: ['getMyActivities', 'cancelActivity', 'getActivityDetail'],
  partner: ['createPartnerIntent', 'getMyIntents', 'cancelIntent', 'confirmMatch', 'askPreference'],
  idle: [],
  chitchat: [],
  modify: ['getDraft', 'refineDraft', 'publishActivity', 'createActivityDraft'],
  confirm: ['publishActivity', 'confirmMatch'],
  deny: [],
  cancel: ['cancelActivity', 'cancelIntent'],
  share: ['getActivityDetail', 'getMyActivities'],
  join: ['exploreNearby', 'getActivityDetail', 'joinActivity'],
  show_activity: ['getMyActivities', 'getActivityDetail'],
  unknown: ['createActivityDraft', 'exploreNearby', 'askPreference', 'createPartnerIntent'],
};

/**
 * Tool 工厂函数映射
 */
type ToolFactory = (userId: string | null, location?: { lat: number; lng: number } | null) => unknown;

const TOOL_FACTORIES: Record<string, ToolFactory> = {
  createActivityDraft: (userId) => createActivityDraftTool(userId),
  getDraft: (userId) => getDraftTool(userId),
  refineDraft: (userId) => refineDraftTool(userId),
  publishActivity: (userId) => publishActivityTool(userId),
  exploreNearby: (userId) => exploreNearbyTool(userId),
  getActivityDetail: (userId) => getActivityDetailTool(userId),
  joinActivity: (userId) => joinActivityTool(userId),
  cancelActivity: (userId) => cancelActivityTool(userId),
  getMyActivities: (userId) => getMyActivitiesTool(userId),
  askPreference: (userId) => askPreferenceTool(userId),
  createPartnerIntent: (userId, location) => createPartnerIntentTool(userId, location || null),
  getMyIntents: (userId) => getMyIntentsTool(userId),
  cancelIntent: (userId) => cancelIntentTool(userId),
  confirmMatch: (userId) => confirmMatchTool(userId),
};

/**
 * 获取意图对应的 Tool 名称列表
 * 
 * 统一入口，合并原 intent/router.ts 的 getToolsForIntent 和 registry.ts 的 getToolNamesForIntent。
 * 返回 string[]（工具名称），用于日志、trace、条件判断等场景。
 * 
 * @param intent - 意图类型
 * @param options - 可选的上下文选项，用于动态调整工具列表
 */
export function getToolNamesByIntent(
  intent: IntentType,
  options: {
    hasDraftContext?: boolean;
    hasLocation?: boolean;
    isLoggedIn?: boolean;
  } = {}
): string[] {
  let toolNames = [...(INTENT_TOOL_MAP[intent] || INTENT_TOOL_MAP.unknown)];

  // 创建意图：根据草稿上下文调整
  if (intent === 'create') {
    if (options.hasDraftContext) {
      toolNames = ['refineDraft', 'publishActivity', 'getDraft'];
    } else {
      toolNames = ['createActivityDraft', 'getDraft'];
    }
  }

  // 有草稿上下文时，确保修改意图包含草稿工具
  if (options.hasDraftContext && intent === 'modify') {
    if (!toolNames.includes('refineDraft')) toolNames.push('refineDraft');
    if (!toolNames.includes('publishActivity')) toolNames.push('publishActivity');
  }

  // 无位置时，explore 意图添加询问偏好工具
  if (!options.hasLocation && intent === 'explore') {
    if (!toolNames.includes('askPreference')) {
      toolNames.unshift('askPreference');
    }
  }

  // 未登录时，移除需要登录的工具
  if (options.isLoggedIn === false) {
    const loginRequiredTools = [
      'createActivityDraft', 'publishActivity', 'joinActivity',
      'cancelActivity', 'getMyActivities', 'createPartnerIntent',
      'confirmMatch', 'cancelIntent', 'getMyIntents',
    ];
    toolNames = toolNames.filter(t => !loginRequiredTools.includes(t));
  }

  return toolNames;
}

/**
 * 统一的工具实例解析入口
 * 
 * 合并原 tools/index.ts 的 getToolsByIntent 和 tools/registry.ts 的 getToolsForIntent。
 * 返回 Record<string, unknown>（实例化的工具对象），用于传递给 LLM。
 * 
 * @param userId - 用户 ID
 * @param intent - 意图类型
 * @param options - 上下文选项
 */
export function resolveToolsForIntent(
  userId: string | null,
  intent: IntentType,
  options: {
    hasDraftContext?: boolean;
    location?: { lat: number; lng: number } | null;
  } = {}
): Record<string, any> {
  const toolNames = getToolNamesByIntent(intent, {
    hasDraftContext: options.hasDraftContext,
  });

  const tools: Record<string, any> = {};

  for (const name of toolNames) {
    const factory = TOOL_FACTORIES[name];
    if (factory) {
      tools[name] = factory(userId, options.location);
    }
  }

  return tools;
}

// ==========================================
// 向后兼容的旧函数（已废弃，将在后续版本移除）
// ==========================================

/**
 * @deprecated 使用 getToolNamesByIntent 替代
 */
export function getToolNamesForIntent(intent: IntentType): string[] {
  return getToolNamesByIntent(intent);
}

/**
 * @deprecated 使用 resolveToolsForIntent 替代
 */
export function getToolsForIntent(
  context: ToolContext,
  intent: IntentType,
  hasDraftContext: boolean
): Record<string, unknown> {
  return resolveToolsForIntent(context.userId, intent, {
    hasDraftContext,
    location: context.location,
  });
}

/**
 * 获取所有 Tools（完整版，兼容旧代码）
 */
export function getAllTools(context: ToolContext): Record<string, unknown> {
  const { userId, location } = context;
  const tools: Record<string, unknown> = {};

  for (const [name, factory] of Object.entries(TOOL_FACTORIES)) {
    tools[name] = factory(userId, location);
  }

  return tools;
}

/**
 * 获取单个 Tool
 */
export function getTool(
  name: string,
  context: ToolContext
): unknown | undefined {
  const factory = TOOL_FACTORIES[name];
  if (!factory) return undefined;
  return factory(context.userId, context.location);
}

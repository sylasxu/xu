/**
 * Tool Registry - 工具注册表
 *
 * 管理所有 AI Tools 的注册和获取
 * 支持按意图动态加载 Tools
 *
 * v4.9: 统一工具解析函数
 * - resolveToolsForIntent: 统一的工具实例解析入口
 * - getToolNamesByIntent: 统一的工具名称解析入口
 *
 * v5.0: 动态配置
 * - INTENT_TOOL_MAP 通过 getConfigValue('tools.intent_map', ...) 动态配置
 * - 清理废弃函数
 */

import type { IntentType } from '../intent/types';
import { getConfigValue } from '../config/config.service';

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
 * 意图到 Tool 的默认映射配置
 */
const INTENT_TOOL_MAP: Record<string, string[]> = {
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
 * 统一入口，返回意图对应的工具名称列表。
 * 返回 string[]（工具名称），用于日志、trace、条件判断等场景。
 *
 * v5.0: 映射通过 getConfigValue('tools.intent_map', INTENT_TOOL_MAP) 动态配置
 *
 * @param intent - 意图类型
 * @param options - 可选的上下文选项，用于动态调整工具列表
 */
export async function getToolNamesByIntent(
  intent: IntentType,
  options: {
    hasDraftContext?: boolean;
    hasLocation?: boolean;
    isLoggedIn?: boolean;
  } = {},
): Promise<string[]> {
  const intentMap = await getConfigValue('tools.intent_map', INTENT_TOOL_MAP);
  let toolNames = [...(intentMap[intent] || intentMap.unknown || [])];

  // 创建意图：根据草稿上下文调整
  if (intent === 'create') {
    if (options.hasDraftContext) {
      toolNames = [
        'refineDraft',
        'publishActivity',
        'getDraft',
        'createActivityDraft',
        'exploreNearby',
        'askPreference',
      ];
    } else {
      toolNames = ['createActivityDraft', 'getDraft', 'askPreference', 'exploreNearby'];
    }
  }

  // 修改意图：保留草稿能力，同时允许回退到探索/追问，避免 unavailable tool
  if (intent === 'modify') {
    if (!toolNames.includes('exploreNearby')) toolNames.push('exploreNearby');
    if (!toolNames.includes('askPreference')) toolNames.push('askPreference');
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
 * 返回 Record<string, unknown>（实例化的工具对象），用于传递给 LLM。
 *
 * @param userId - 用户 ID
 * @param intent - 意图类型
 * @param options - 上下文选项
 */
export async function resolveToolsForIntent(
  userId: string | null,
  intent: IntentType,
  options: {
    hasDraftContext?: boolean;
    location?: { lat: number; lng: number } | null;
  } = {},
): Promise<Record<string, any>> {
  const toolNames = await getToolNamesByIntent(intent, {
    hasDraftContext: options.hasDraftContext,
    hasLocation: Boolean(options.location),
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

/**
 * 获取单个 Tool
 */
export function getTool(
  name: string,
  context: { userId: string | null; location?: { lat: number; lng: number } | null },
): unknown | undefined {
  const factory = TOOL_FACTORIES[name];
  if (!factory) return undefined;
  return factory(context.userId, context.location);
}

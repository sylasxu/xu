/**
 * AI Tools Index
 * 
 * 统一导出所有 AI 工具函数
 * 
 * v4.5: 整合优化
 * - activity-tools.ts: 活动创建、修改、发布
 * - query-tools.ts: 活动查询、报名、取消
 * - partner-tools.ts: 找搭子相关
 * - explore-nearby.ts: RAG 语义搜索
 * - create-tool.ts: Tool 工厂函数
 */

// ============ Tool Factory ============
export { createTool, createToolFactory } from './create-tool';
export type { ToolConfig } from './create-tool';

// ============ Types ============
export type { ToolContext, ToolResult, WidgetChunk, ToolDefinition } from './types';
export { TOOL_DISPLAY_NAMES, TOOL_WIDGET_TYPES, getToolDisplayName, getToolWidgetType } from './types';

// ============ Widgets ============
export {
  WidgetType,
  buildDraftWidget,
  buildExploreWidget,
  buildAskPreferenceWidget,
  buildShareWidget,
  buildErrorWidget,
} from './widgets';

export type {
  WidgetTypeValue,
  WidgetDraftPayload,
  WidgetExplorePayload,
  WidgetAskPreferencePayload,
  WidgetSharePayload,
  WidgetErrorPayload,
} from './widgets';

// ============ Registry ============
export { resolveToolsForIntent, getToolNamesByIntent, getAllTools, getTool } from './registry';
// 向后兼容（已废弃）
export { getToolNamesForIntent, getToolsForIntent } from './registry';

// ============ Activity Tools ============
export {
  createActivityDraftTool,
  getDraftTool,
  refineDraftTool,
  publishActivityTool,
} from './activity-tools';

export type {
  CreateDraftParams,
  GetDraftParams,
  RefineDraftParams,
  PublishActivityParams,
} from './activity-tools';

// ============ Query Tools ============
export {
  joinActivityTool,
  cancelActivityTool,
  getMyActivitiesTool,
  getActivityDetailTool,
  askPreferenceTool,
} from './query-tools';

export type {
  JoinActivityParams,
  CancelActivityParams,
  GetMyActivitiesParams,
  GetActivityDetailParams,
} from './query-tools';

// ============ Explore Tool ============
export { exploreNearbyTool } from './explore-nearby';
export type { ExploreData, ExploreResultItem } from './explore-nearby';

// ============ Partner Tools ============
export {
  createPartnerIntentTool,
  getMyIntentsTool,
  cancelIntentTool,
  confirmMatchTool,
} from './partner-tools';

export type {
  CreatePartnerIntentParams,
  CancelIntentParams,
  ConfirmMatchParams,
} from './partner-tools';

// ============ Intent Classification ============
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

// IntentType 已移至 ../intent/types.ts，这里导入使用
import type { IntentType } from '../intent/types';
import { resolveToolsForIntent } from './registry';

/**
 * 获取所有 AI Tools（完整版）
 */
export function getAIToolsV34(userId: string | null) {
  return {
    createActivityDraft: createActivityDraftTool(userId),
    getDraft: getDraftTool(userId),
    refineDraft: refineDraftTool(userId),
    publishActivity: publishActivityTool(userId),
    exploreNearby: exploreNearbyTool(userId),
    getActivityDetail: getActivityDetailTool(userId),
    joinActivity: joinActivityTool(userId),
    cancelActivity: cancelActivityTool(userId),
    getMyActivities: getMyActivitiesTool(userId),
    askPreference: askPreferenceTool(userId),
  };
}

/**
 * @deprecated 使用 resolveToolsForIntent 替代
 * 根据意图动态获取 Tools（精简版）
 */
export function getToolsByIntent(
  userId: string | null,
  intent: IntentType,
  hasDraftContext: boolean,
  userLocation?: { lat: number; lng: number } | null
) {
  return resolveToolsForIntent(userId, intent, {
    hasDraftContext,
    location: userLocation,
  });
}

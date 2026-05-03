/**
 * Tools Module Types - 工具系统类型定义
 * 
 * 定义 Tool、ToolResult、ToolContext、WidgetChunk 等核心类型
 */

import type { TSchema } from 'elysia';
import type { WidgetFetchConfig, WidgetInteraction } from './widget-protocol';

/**
 * Tool 上下文 - 传递给 Tool 执行函数的上下文信息
 */
export interface ToolContext {
  /** 用户 ID，null 表示未登录上下文 */
  userId: string | null;
  /** 会话 ID */
  threadId?: string | null;
  /** 用户位置 */
  location?: { lat: number; lng: number } | null;
  /** 语义召回的活动结果（供 Tool 优先消费，避免重复 RAG 搜索） */
  recalledActivities?: Array<{
    id: string;
    title: string;
    type: string;
    locationHint: string | null;
    startAt: Date;
    similarity: number;
  }>;
}

/**
 * Tool 执行结果
 */
export interface ToolResult<T = unknown> {
  /** 是否成功 */
  success: boolean;
  /** 成功时的数据 */
  data?: T;
  /** 失败时的错误信息 */
  error?: string;
  /** 关联的活动 ID（用于消息关联） */
  activityId?: string;
  /** Widget 数据（前端渲染用） */
  widget?: WidgetChunk;
}

/**
 * Widget 数据块 - Tool 返回的结构化 UI 数据
 *
 * 五维协议：
 * - messageType: Widget 类型标识
 * - payload: 业务数据（必选）
 * - state: 声明式初始状态（可选，H5 直接消费，小程序可忽略）
 * - fetchConfig: 数据源声明（可选，引用模式）
 * - interaction: 交互能力声明（可选）
 */
export interface WidgetChunk {
  /** Widget 类型，对应 conversationMessageTypeEnum */
  messageType: string;
  /** Widget 数据 */
  payload: Record<string, unknown>;
  /** 声明式初始状态（H5 端直接消费，小程序端可忽略） */
  state?: Record<string, unknown>;
  /** 引用模式：告诉前端从哪个 API 获取完整数据 */
  fetchConfig?: WidgetFetchConfig;
  /** 交互能力：告诉前端该 Widget 支持哪些交互 */
  interaction?: WidgetInteraction;
}

/**
 * Tool 定义（内部类型，用于注册）
 */
export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  /** Tool 名称 */
  name: string;
  /** Tool 描述（供 AI 理解） */
  description: string;
  /** 参数 Schema（TypeBox） */
  parameters: TSchema;
  /** 执行函数 */
  execute: (params: TParams, context: ToolContext) => Promise<ToolResult<TResult>>;
}

/**
 * Tool 显示名称映射
 */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  createActivityDraft: '创建活动草稿',
  getDraft: '获取草稿',
  refineDraft: '修改草稿',
  publishActivity: '发布活动',
  exploreNearby: '探索附近',
  getActivityDetail: '查看活动详情',
  joinActivity: '报名活动',
  cancelActivity: '取消活动',
  getMyActivities: '查看我的活动',
  askPreference: '询问偏好',
  createPartnerIntent: '创建找搭子意向',
  getMyIntents: '查看我的意向',
  cancelIntent: '取消意向',
  confirmMatch: '确认匹配',
};

/**
 * 获取 Tool 显示名称
 */
export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] || toolName;
}

// 从 widgets.ts 重导出（向后兼容）
export { TOOL_WIDGET_MAP as TOOL_WIDGET_TYPES } from './widgets';
export { getWidgetTypeByToolName as getToolWidgetType } from './widgets';

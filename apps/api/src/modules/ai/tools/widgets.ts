/**
 * Widget Types and Builders - Widget 类型定义和构建函数
 * 
 * Widget 是 Tool 返回的结构化 UI 数据，前端根据 messageType 渲染不同组件
 * Schema 从 @xu/db 派生
 */

import { t } from 'elysia';
import type { WidgetChunk } from './types';
import type { WidgetFetchConfig, WidgetInteraction, WidgetAction } from './widget-protocol';

type TObject = ReturnType<typeof t.Object>;

/**
 * Widget 类型枚举（对应 conversationMessageTypeEnum）
 */
export const WidgetType = {
  TEXT: 'text',
  DRAFT: 'widget_draft',
  EXPLORE: 'widget_explore',
  SHARE: 'widget_share',
  ASK_PREFERENCE: 'widget_ask_preference',
  ERROR: 'widget_error',
} as const;

export type WidgetTypeValue = typeof WidgetType[keyof typeof WidgetType];

// ==========================================
// Widget Payload Schemas（从 @xu/db 派生）
// ==========================================

/**
 * 草稿 Widget Payload
 */
export const WidgetDraftPayloadSchema = t.Object({
  activityId: t.String(),
  draft: t.Object({
    title: t.String(),
    type: t.String(),
    locationName: t.String(),
    locationHint: t.String(),
    location: t.Tuple([t.Number(), t.Number()]),
    startAt: t.String(),
    maxParticipants: t.Number(),
    summary: t.Optional(t.String()),
  }),
  message: t.String(),
});

export type WidgetDraftPayload = typeof WidgetDraftPayloadSchema.static;

/**
 * 探索 Widget Payload
 */
export const WidgetExplorePayloadSchema = t.Object({
  activities: t.Array(t.Object({
    id: t.String(),
    title: t.String(),
    type: t.String(),
    locationName: t.String(),
    distance: t.Number(),
    startAt: t.String(),
    currentParticipants: t.Number(),
    maxParticipants: t.Number(),
  })),
  center: t.Object({
    lat: t.Number(),
    lng: t.Number(),
    name: t.Optional(t.String()),
  }),
  radius: t.Number(),
  total: t.Number(),
});

export type WidgetExplorePayload = typeof WidgetExplorePayloadSchema.static;

/**
 * 询问偏好 Widget Payload
 */
export const WidgetAskPreferencePayloadSchema = t.Object({
  questionType: t.Union([
    t.Literal('location'),
    t.Literal('time'),
    t.Literal('action'),
    t.Literal('type'),
  ]),
  question: t.String(),
  options: t.Array(t.Object({
    label: t.String(),
    value: t.String(),
  })),
});

export type WidgetAskPreferencePayload = typeof WidgetAskPreferencePayloadSchema.static;

/**
 * 分享 Widget Payload
 */
export const WidgetSharePayloadSchema = t.Object({
  activityId: t.String(),
  title: t.String(),
  message: t.String(),
});

export type WidgetSharePayload = typeof WidgetSharePayloadSchema.static;

/**
 * 错误 Widget Payload
 */
export const WidgetErrorPayloadSchema = t.Object({
  code: t.String(),
  message: t.String(),
  suggestion: t.Optional(t.String()),
});

export type WidgetErrorPayload = typeof WidgetErrorPayloadSchema.static;

// ==========================================
// Widget Catalog 注册表
// ==========================================

/**
 * Widget Catalog 条目类型
 */
export interface WidgetCatalogEntry {
  /** Widget 类型名，对应 conversationMessageTypeEnum */
  widgetType: string;
  /** 用途说明，供 AI 理解和开发者参考 */
  description: string;
  /** TypeBox Payload Schema 引用（可选，部分 Widget 无独立 Schema） */
  payloadSchema?: TObject;
  /** 关联的 Tool 名称列表（可为空，如 dashboard/launcher 由前端生成） */
  toolNames: string[];
  /** 声明式初始状态（可选，H5 端直接消费，小程序端可忽略） */
  defaultState?: Record<string, unknown>;
  /** 交互能力声明（可选，描述该 Widget 支持的用户操作） */
  interactions?: Array<{
    /** 操作类型，对应 WidgetActionType */
    action: WidgetAction['type'];
    /** 操作显示文本 */
    label: string;
  }>;
}

/**
 * Widget Catalog — 集中式注册表
 * 新增 Widget 类型时只需在此数组中添加一个条目
 */
export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    widgetType: WidgetType.DRAFT,
    description: '活动草稿卡片，展示 AI 创建或修改的活动草稿，用户可预览和发布',
    payloadSchema: WidgetDraftPayloadSchema,
    toolNames: ['createActivityDraft', 'getDraft', 'refineDraft'],
    interactions: [
      { action: 'publish', label: '发布活动' },
    ],
  },
  {
    widgetType: WidgetType.EXPLORE,
    description: '附近活动列表，展示基于位置的活动搜索结果，支持浏览和报名',
    payloadSchema: WidgetExplorePayloadSchema,
    toolNames: ['exploreNearby'],
    defaultState: { selectedActivityId: null },
    interactions: [
      { action: 'join', label: '报名' },
      { action: 'share', label: '分享' },
      { action: 'detail', label: '查看详情' },
    ],
  },
  {
    widgetType: WidgetType.SHARE,
    description: '分享活动卡片，展示已发布活动的分享信息和链接',
    payloadSchema: WidgetSharePayloadSchema,
    toolNames: ['publishActivity'],
    interactions: [
      { action: 'share', label: '分享给朋友' },
    ],
  },
  {
    widgetType: WidgetType.ASK_PREFERENCE,
    description: '偏好追问卡片，向用户提问以收集位置、时间、类型等偏好信息',
    payloadSchema: WidgetAskPreferencePayloadSchema,
    toolNames: ['askPreference'],
    defaultState: { disabled: false, selectedValue: null },
    interactions: [
      { action: 'select', label: '选择选项' },
      { action: 'skip', label: '跳过' },
    ],
  },
  {
    widgetType: WidgetType.ERROR,
    description: '错误提示卡片，展示错误信息和重试建议',
    payloadSchema: WidgetErrorPayloadSchema,
    toolNames: [],
  },
];

// ── 派生常量 ──

/** Tool→Widget 扁平映射（从 Catalog 自动派生） */
export const TOOL_WIDGET_MAP: Record<string, string> = Object.fromEntries(
  WIDGET_CATALOG.flatMap(entry =>
    entry.toolNames.map(toolName => [toolName, entry.widgetType])
  )
);

/** 所有关联 Widget 的 Tool 名称列表（从 Catalog 自动派生） */
export const WIDGET_TOOL_NAMES: string[] = WIDGET_CATALOG.flatMap(
  entry => entry.toolNames
);

// ── 派生函数 ──

/**
 * 根据 Tool 名称查找对应的 Widget 类型
 * 替代 types.ts 中的 TOOL_WIDGET_TYPES[toolName]
 */
export function getWidgetTypeByToolName(toolName: string): string | undefined {
  return TOOL_WIDGET_MAP[toolName];
}

/**
 * 判断 Tool 是否关联 Widget
 * 替代 data-stream-parser.ts 中的 isWidgetTool
 */
export function isWidgetTool(toolName: string): boolean {
  return WIDGET_TOOL_NAMES.includes(toolName);
}

/**
 * 根据 Tool 名称查找 Catalog 条目
 */
export function getCatalogEntryByToolName(toolName: string): WidgetCatalogEntry | undefined {
  return WIDGET_CATALOG.find(entry => entry.toolNames.includes(toolName));
}

// ── Widget Spec Builder ──

/**
 * 从 Tool 返回值中提取协议字段（fetchConfig、interaction、preview）
 * 这些字段由 Tool 在返回值中显式声明，不属于业务 payload
 */
const PROTOCOL_FIELDS = ['fetchConfig', 'interaction', 'preview', 'success', 'error'] as const;
type ProtocolField = typeof PROTOCOL_FIELDS[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProtocolField(value: string): value is ProtocolField {
  return PROTOCOL_FIELDS.some(field => field === value);
}

function readWidgetFetchConfig(value: unknown): WidgetFetchConfig | undefined {
  if (!isRecord(value) || typeof value.source !== 'string' || !isRecord(value.params)) {
    return undefined;
  }

  switch (value.source) {
    case 'nearby_activities':
    case 'activity_detail':
    case 'my_activities':
    case 'activity_participants':
      return {
        source: value.source,
        params: value.params,
      };
    default:
      return undefined;
  }
}

function readWidgetAction(value: unknown): WidgetAction | null {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.label !== 'string' || !isRecord(value.params)) {
    return null;
  }

  switch (value.type) {
    case 'join':
    case 'cancel':
    case 'share':
    case 'detail':
    case 'publish':
    case 'confirm_match':
      return {
        type: value.type,
        label: value.label,
        params: value.params,
      };
    default:
      return null;
  }
}

function readWidgetInteraction(value: unknown): WidgetInteraction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const actions = Array.isArray(value.actions)
    ? value.actions
        .map(readWidgetAction)
        .filter((action): action is WidgetAction => action !== null)
    : undefined;

  return {
    swipeable: typeof value.swipeable === 'boolean' ? value.swipeable : undefined,
    halfScreenDetail: typeof value.halfScreenDetail === 'boolean' ? value.halfScreenDetail : undefined,
    actions,
  };
}

/**
 * 构建标准化 Widget Spec
 *
 * 纯函数：Tool 原始返回值 + Catalog 元数据 → WidgetChunk
 *
 * @param toolName - Tool 名称
 * @param toolResult - Tool execute() 的原始返回值
 * @returns 标准化的 WidgetChunk，或 null（Tool 不关联 Widget）
 */
export function buildWidgetSpec(
  toolName: string,
  toolResult: Record<string, unknown>
): WidgetChunk | null {
  const entry = getCatalogEntryByToolName(toolName);
  if (!entry) return null;

  // 提取协议字段
  const fetchConfig = readWidgetFetchConfig(toolResult.fetchConfig);
  const interaction = readWidgetInteraction(toolResult.interaction);

  // 剩余字段作为 payload（排除协议字段）
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(toolResult)) {
    if (!isProtocolField(key)) {
      payload[key] = value;
    }
  }

  // 合并 Catalog 默认交互（Tool 返回的 interaction 优先）
  const finalInteraction = interaction ?? (
    entry.interactions
      ? { actions: entry.interactions.map(i => ({ type: i.action, label: i.label, params: {} })) }
      : undefined
  );

  return {
    messageType: entry.widgetType,
    payload,
    state: entry.defaultState ? { ...entry.defaultState } : undefined,
    fetchConfig,
    interaction: finalInteraction,
  };
}


// ==========================================
// Widget 构建函数
// ==========================================

/**
 * 构建草稿 Widget
 */
export function buildDraftWidget(
  activityId: string,
  draft: WidgetDraftPayload['draft'],
  message: string
): WidgetChunk {
  return {
    messageType: WidgetType.DRAFT,
    payload: { activityId, draft, message },
  };
}

/**
 * 构建探索 Widget
 */
export function buildExploreWidget(
  activities: WidgetExplorePayload['activities'],
  center: WidgetExplorePayload['center'],
  radius: number,
  total: number
): WidgetChunk {
  return {
    messageType: WidgetType.EXPLORE,
    payload: { activities, center, radius, total },
  };
}

/**
 * 构建询问偏好 Widget
 */
export function buildAskPreferenceWidget(
  questionType: WidgetAskPreferencePayload['questionType'],
  question: string,
  options: WidgetAskPreferencePayload['options']
): WidgetChunk {
  return {
    messageType: WidgetType.ASK_PREFERENCE,
    payload: { questionType, question, options },
  };
}

/**
 * 构建分享 Widget
 */
export function buildShareWidget(
  activityId: string,
  title: string,
  message: string
): WidgetChunk {
  return {
    messageType: WidgetType.SHARE,
    payload: { activityId, title, message },
  };
}

/**
 * 构建错误 Widget
 */
export function buildErrorWidget(
  code: string,
  message: string,
  suggestion?: string
): WidgetChunk {
  return {
    messageType: WidgetType.ERROR,
    payload: { code, message, suggestion },
  };
}

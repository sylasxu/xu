/**
 * Structured Action Types
 *
 * 用户点击 Widget 按钮时，会发送结构化动作而不是纯文本消息。
 * 服务端可以跳过意图识别，直接路由到对应能力。
 *
 * @example
 * ```typescript
 * {
 *   action: 'join_activity',
 *   payload: { activityId: 'xxx' },
 *   source: 'widget_explore'
 * }
 * ```
 */

/**
 * 支持的结构化动作类型
 * 
 * 命名规范：动词_名词，如 join_activity, create_activity
 */
export const STRUCTURED_ACTION_TYPES = [
  // 活动相关
  'join_activity',           // 报名活动
  'view_activity',           // 查看活动详情
  'cancel_join',             // 取消报名
  'share_activity',          // 分享活动
  // 创建相关
  'create_activity',         // 创建活动（从 widget_draft 确认）
  'edit_draft',              // 编辑草稿
  'save_draft_settings',     // 保存草稿设置表单
  'publish_draft',           // 发布草稿
  'confirm_publish',         // 确认并发布草稿
  // 探索相关
  'explore_nearby',          // 探索附近
  'ask_preference',          // 主动追问偏好/位置
  'expand_map',              // 展开地图
  'filter_activities',       // 筛选活动
  // 找搭子相关
  'find_partner',            // 找搭子
  'submit_partner_intent_form', // 提交找搭子表单
  'confirm_match',           // 确认匹配成局
  'cancel_match',            // 取消待确认匹配
  'select_preference',       // 选择偏好（多轮对话）
  'skip_preference',         // 跳过偏好选择
  // 通用
  'retry',                   // 重试上一次操作
  'cancel',                  // 取消当前操作
  'quick_prompt',            // 快捷提示词
] as const;

export type StructuredActionType = (typeof STRUCTURED_ACTION_TYPES)[number];

export function isStructuredActionType(value: string): value is StructuredActionType {
  return (STRUCTURED_ACTION_TYPES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Structured Action 结构
 */
export interface StructuredAction {
  /** 结构化动作类型 */
  action: StructuredActionType;
  /** 结构化动作参数 */
  payload: Record<string, unknown>;
  /** 来源 Widget 类型 */
  source?: string;
  /** 原始文本（可选，用于日志和回退） */
  originalText?: string;
}

/**
 * 结构化动作到 Tool 的映射配置
 */
export interface StructuredActionToolMapping {
  /** 对应的 Tool 名称 */
  toolName: string;
  /** 参数转换函数 */
  transformArgs: (payload: Record<string, unknown>) => Record<string, unknown>;
  /** 是否需要登录 */
  requiresAuth: boolean;
  /** 描述（用于日志） */
  description: string;
}

/**
 * 结构化动作处理结果
 */
export interface StructuredActionResult {
  /** 是否成功 */
  success: boolean;
  /** 结果数据 */
  data?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行耗时（毫秒） */
  durationMs?: number;
  /** 是否需要回退到 LLM 处理 */
  fallbackToLLM?: boolean;
  /** 回退时的提示文本 */
  fallbackText?: string;
}

/**
 * 判断消息是否为 Structured Action
 */
export function isStructuredAction(message: unknown): message is { type: 'user_action'; action: StructuredAction } {
  if (!isRecord(message)) return false;
  const msg = message;
  return msg.type === 'user_action' && typeof msg.action === 'object';
}

/**
 * 从消息内容中提取 Structured Action
 */
export function extractStructuredAction(content: unknown): StructuredAction | null {
  if (!isRecord(content)) return null;
  
  const obj = content;
  
  // 检查是否有 action 字段
  if (typeof obj.action !== 'string') return null;
  
  if (!isStructuredActionType(obj.action)) {
    return null;
  }

  return {
    action: obj.action,
    payload: isRecord(obj.payload) ? obj.payload : {},
    source: typeof obj.source === 'string' ? obj.source : undefined,
    originalText: typeof obj.originalText === 'string' ? obj.originalText : undefined,
  };
}

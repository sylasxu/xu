/**
 * Widget Action Handler — Widget 卡内操作处理器
 *
 * 集中定义 Widget 内的用户操作类型。
 * 报名等高价值写操作已经统一收敛到 /ai/chat 结构化动作链路，这里不再直连业务 API。
 */

export type ActionState = 'idle' | 'loading' | 'success' | 'error';

/** 操作结果详情项 */
export interface ActionResultDetail {
  label: string;
  value: string;
}

/** 操作类型（与 API 层 WidgetActionType 对齐） */
export type WidgetActionType = 'join' | 'cancel' | 'share' | 'detail' | 'publish' | 'confirm_match';

/** Widget 操作定义 */
export interface WidgetAction {
  type: WidgetActionType;
  label: string;
  params: Record<string, unknown>;
}

/** 操作结果载荷 — 用于渲染结构化结果卡片 */
export interface ActionResultPayload {
  title: string;
  summary: string;
  details: ActionResultDetail[];
  nextAction?: WidgetAction;
}

/** 操作执行结果 */
export interface ActionResult {
  state: ActionState;
  error: string | null;
  resultPayload?: ActionResultPayload;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 执行 Widget 操作
 *
 * @param actionType - 操作类型
 * @param params - 操作参数（activityId、title、startAt、locationName 等由前端卡片注入）
 */
export async function executeWidgetAction(
  actionType: string,
  _params: Record<string, unknown>,
): Promise<ActionResult> {
  const actionLabel = readString(actionType) || '这个操作'

  return {
    state: 'error',
    error: `${actionLabel}现在需要回到连续对话里处理，请从卡片入口继续`,
    resultPayload: undefined,
  }
}

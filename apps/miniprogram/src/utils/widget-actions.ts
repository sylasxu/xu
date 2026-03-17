/**
 * Widget Action Handler — Widget 卡内操作处理器
 *
 * 集中处理 Widget 内的用户操作（报名、分享等）。
 * 禁止使用 wx.request，所有请求通过 Orval SDK 发起。
 */

import { requestJoinActivity } from './join-flow'

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
  params: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    if (actionType === 'join') {
      const activityId = readString(params.activityId)
      if (!activityId) {
        return { state: 'error', error: '活动 ID 无效', resultPayload: undefined }
      }

      const title = readString(params.title) || '活动'
      const startAt = readString(params.startAt) || ''
      const locationName = readString(params.locationName) || ''
      const joinResult = await requestJoinActivity(activityId)

      if (joinResult.success) {
        return {
          state: 'success',
          error: null,
          resultPayload: {
            title: '报名成功',
            summary: `你已成功报名「${title}」，接下来去讨论区打个招呼吧`,
            details: [
              { label: '活动', value: title },
              { label: '时间', value: startAt },
              { label: '地点', value: locationName },
            ].filter(d => d.value),
            nextAction: {
              type: 'detail',
              label: '查看活动详情',
              params: { activityId },
            },
          },
        }
      }
      return { state: 'error', error: joinResult.msg, resultPayload: undefined }
    }

    // share: 由组件层调用 wx.shareAppMessage
    // detail: 由组件层触发半屏详情
    return { state: 'error', error: `未支持的操作: ${actionType}`, resultPayload: undefined };
  } catch (err) {
    return {
      state: 'error',
      error: err instanceof Error ? err.message : '操作失败',
      resultPayload: undefined,
    };
  }
}

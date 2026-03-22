import type {
  GenUIRequest,
  GenUITracePayload,
  GenUITurnEnvelope,
} from '@juchang/genui-contract';
import {
  createAlertBlock,
} from './shared/genui-blocks';
import type { StructuredAction } from './user-action';

interface ViewerContext {
  id: string;
  role: string;
}

type ExecutionPath = 'llm_orchestrated' | 'structured_action';

interface ApplyAiChatTurnPolicyParams {
  request: GenUIRequest;
  viewer: ViewerContext | null;
  envelope: GenUITurnEnvelope;
  traces: GenUITracePayload[];
  resolvedStructuredAction?: StructuredAction;
  executionPath?: ExecutionPath;
}

const AUTH_REQUIRED_ACTIONS = new Set([
  'join_activity',
  'cancel_join',
  'create_activity',
  'edit_draft',
  'save_draft_settings',
  'publish_draft',
  'confirm_publish',
  'connect_partner',
  'request_partner_group_up',
  'opt_in_partner_pool',
  'confirm_match',
  'cancel_match',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildPendingStructuredAction(params: {
  action: string;
  payload: Record<string, unknown>;
  source?: string;
  originalText?: string;
}): Record<string, unknown> {
  return {
    type: 'structured_action',
    action: params.action,
    payload: params.payload,
    ...(params.source ? { source: params.source } : {}),
    ...(params.originalText ? { originalText: params.originalText } : {}),
    authMode: 'login',
  };
}

function getAuthRequiredMessage(action: string): string {
  if (action.includes('publish') || action.includes('create') || action === 'edit_draft' || action === 'save_draft_settings') {
    return '这个操作会创建或修改活动，先登录后我再继续帮你完成。';
  }
  if (action === 'connect_partner' || action === 'request_partner_group_up' || action === 'opt_in_partner_pool') {
    return '这个操作会继续帮你和搭子建立联系，先登录后再继续。';
  }
  if (action.includes('match')) {
    return '这个操作会影响你的搭子匹配结果，先登录后再继续。';
  }
  if (action.includes('join') || action.includes('cancel_join')) {
    return '报名相关操作需要绑定你的账号，先登录再继续。';
  }
  return '这个操作需要先登录，登录后我会接着帮你处理。';
}

export function applyAiChatTurnPolicies(
  params: ApplyAiChatTurnPolicyParams
): { envelope: GenUITurnEnvelope; traces: GenUITracePayload[] } {
  const nextBlocks = [...params.envelope.turn.blocks];
  const nextTraces = [...params.traces];
  const directInputActionName =
    params.request.input.type === 'action' ? params.request.input.action : '';
  const resolvedActionName =
    params.executionPath === 'structured_action' ? params.resolvedStructuredAction?.action || '' : '';
  const effectiveActionName = resolvedActionName || directInputActionName;
  const actionPayload =
    params.executionPath === 'structured_action'
      ? params.resolvedStructuredAction?.payload ?? {}
      : params.request.input.type === 'action' && isRecord(params.request.input.params)
        ? params.request.input.params
        : {};
  const actionSource =
    params.executionPath === 'structured_action'
      ? params.resolvedStructuredAction?.source
      : typeof params.request.context?.entry === 'string'
        ? params.request.context.entry
        : undefined;
  const actionOriginalText =
    params.executionPath === 'structured_action'
      ? params.resolvedStructuredAction?.originalText
      : params.request.input.type === 'action' && typeof params.request.input.displayText === 'string'
        ? params.request.input.displayText
        : undefined;

  const unauthenticatedActionName = !params.viewer ? effectiveActionName : '';
  const isUnauthenticatedWriteAction = AUTH_REQUIRED_ACTIONS.has(unauthenticatedActionName);
  if (isUnauthenticatedWriteAction) {
    nextBlocks.splice(
      0,
      nextBlocks.length,
      createAlertBlock({
        level: 'warning',
        message: getAuthRequiredMessage(unauthenticatedActionName),
        dedupeKey: 'auth_required_for_action',
        traceRef: 'auth_guard',
        meta: {
          authRequired: {
            mode: 'login',
            pendingAction: buildPendingStructuredAction({
              action: unauthenticatedActionName,
              payload: actionPayload,
              source: actionSource,
              originalText: actionOriginalText,
            }),
          },
        },
      })
    );

    nextTraces.push({
      stage: 'auth_guard_applied',
      detail: {
        action: unauthenticatedActionName,
        reason: 'unauthenticated_write_action',
        executionPath: params.executionPath || 'llm_orchestrated',
      },
    });
  }

  return {
    envelope: {
      ...params.envelope,
      turn: {
        ...params.envelope.turn,
        blocks: nextBlocks,
      },
    },
    traces: nextTraces,
  };
}

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
  'find_partner',
  'submit_partner_intent_form',
  'confirm_match',
  'cancel_match',
]);

function getAuthRequiredMessage(action: string): string {
  if (action.includes('publish') || action.includes('create') || action === 'edit_draft' || action === 'save_draft_settings') {
    return '这个操作会创建或修改活动，先登录后我再继续帮你完成。';
  }
  if (action.includes('match') || action === 'find_partner') {
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

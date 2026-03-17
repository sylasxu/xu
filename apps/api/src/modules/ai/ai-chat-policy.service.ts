import type {
  GenUIBlock,
  GenUIChoiceOption,
  GenUIRequest,
  GenUITracePayload,
  GenUITurnEnvelope,
} from '@juchang/genui-contract';
import {
  createChoiceBlock,
  createCtaGroupBlock,
  createAlertBlock,
} from './shared/genui-blocks';

interface ViewerContext {
  id: string;
  role: string;
}

interface ApplyAiChatTurnPolicyParams {
  request: GenUIRequest;
  viewer: ViewerContext | null;
  envelope: GenUITurnEnvelope;
  traces: GenUITracePayload[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

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

function isEmptyStructuredResponse(blocks: GenUIBlock[]): boolean {
  if (blocks.length !== 1) {
    return false;
  }

  const block = blocks[0];
  return block.dedupeKey === 'empty_response';
}

function buildFallbackBlocksForInput(
  input: GenUIRequest['input'],
  userText: string,
  isAuthenticated: boolean
): GenUIBlock[] | null {
  if (input.type === 'text') {
    const normalizedText = userText.trim();
    const looksLikeCreateIntent = /(组|租|约).{0,8}局|想.*局|周五.*局/.test(normalizedText);
    if (looksLikeCreateIntent) {
      const options: GenUIChoiceOption[] = ['观音桥', '解放碑', '南坪万达'].map((location) => ({
        label: location,
        action: 'choose_location',
        params: { location },
      }));

      return [
        createChoiceBlock({
          question: '先定个地点吧，想在哪儿组局？',
          options,
          dedupeKey: 'fallback_choose_location',
          traceRef: 'fallback_wizard',
        }),
      ];
    }

    return null;
  }

  const params = isRecord(input.params) ? input.params : {};
  const action = input.action;

  if (action === 'choose_location') {
    const location = toStringValue(params.location, toStringValue(params.value, '附近'));
    const options: GenUIChoiceOption[] = ['桌游', '羽毛球', '喝咖啡'].map((activityType) => ({
      label: activityType,
      action: 'choose_activity_type',
      params: {
        activityType,
        location,
      },
    }));

    return [
      createChoiceBlock({
        question: `${location}不错，准备玩什么？`,
        options,
        dedupeKey: 'fallback_choose_type',
        traceRef: 'fallback_wizard',
      }),
    ];
  }

  if (action === 'choose_activity_type') {
    const location = toStringValue(params.location, '附近');
    const activityType = toStringValue(params.activityType, '活动');
    const options: GenUIChoiceOption[] = [
      { label: '周五 20:00', slot: 'fri_20_00' },
      { label: '周六 15:00', slot: 'sat_15_00' },
      { label: '周六 20:00', slot: 'sat_20_00' },
    ].map((item) => ({
      label: item.label,
      action: 'choose_time_slot',
      params: {
        slot: item.slot,
        location,
        activityType,
      },
    }));

    return [
      createChoiceBlock({
        question: `${activityType}听起来不错，选个时间吧`,
        options,
        dedupeKey: 'fallback_choose_slot',
        traceRef: 'fallback_wizard',
      }),
    ];
  }

  if (action === 'choose_time_slot') {
    const location = toStringValue(params.location, '附近');
    const activityType = toStringValue(params.activityType, '活动');
    const slot = toStringValue(params.slot, 'fri_20_00');
    const slotLabel = slot === 'sat_15_00' ? '周六 15:00' : slot === 'sat_20_00' ? '周六 20:00' : '周五 20:00';
    const draftParams = {
      title: `${slotLabel}${activityType}局`,
      type: activityType === '桌游' ? 'boardgame' : activityType,
      activityType,
      locationName: location,
      slot,
      location,
      description: `${slotLabel}在${location}组一个${activityType}局`,
      maxParticipants: 6,
    };

    return [
      createCtaGroupBlock({
        dedupeKey: 'fallback_publish_cta',
        traceRef: 'fallback_wizard',
        items: [
          {
            label: '先生成草稿',
            action: 'create_activity',
            params: draftParams,
          },
          {
            label: '先看附近同类局',
            action: 'explore_nearby',
            params: { location, activityType, slot },
          },
          {
            label: '重新选时间',
            action: 'choose_activity_type',
            params: { location, activityType },
          },
        ],
      }),
    ];
  }

  if (action === 'confirm_publish') {
    if (isAuthenticated) {
      const title = toStringValue(params.title, '这个活动');
      const activityType = toStringValue(params.activityType, toStringValue(params.type, '活动'));
      const location = toStringValue(params.locationName, toStringValue(params.location, '待定地点'));
      const startAt = toStringValue(params.startAt, toStringValue(params.slot, '待定时间'));

      return [
        createAlertBlock({
          level: 'info',
          message: '收到，我先帮你生成草稿，再一步确认发布，不会直接伪造发布结果。',
          dedupeKey: 'fallback_confirm_publish',
          traceRef: 'fallback_wizard',
        }),
        createCtaGroupBlock({
          dedupeKey: 'fallback_confirm_publish_retry',
          traceRef: 'fallback_wizard',
          items: [
            {
              label: '继续生成草稿',
              action: 'create_activity',
              params: {
                title,
                activityType,
                location,
                startAt,
                maxParticipants: params.maxParticipants,
                description: `${title}，地点${location}，时间${startAt}，类型${activityType}`,
              },
            },
            {
              label: '先看看附近同类局',
              action: 'explore_nearby',
              params: {
                location,
                activityType,
              },
            },
          ],
        }),
      ];
    }

    return [
      createAlertBlock({
        level: 'warning',
        message: '发布前请先登录，这样才能真正创建并分享活动。',
        dedupeKey: 'fallback_confirm_publish',
        traceRef: 'fallback_wizard',
      }),
    ];
  }

  return null;
}

export function applyAiChatTurnPolicies(
  params: ApplyAiChatTurnPolicyParams
): { envelope: GenUITurnEnvelope; traces: GenUITracePayload[] } {
  const nextBlocks = [...params.envelope.turn.blocks];
  const nextTraces = [...params.traces];
  const userText = params.request.input.type === 'text'
    ? params.request.input.text
    : toStringValue(params.request.input.displayText, params.request.input.action);

  if (isEmptyStructuredResponse(nextBlocks)) {
    const fallbackBlocks = buildFallbackBlocksForInput(
      params.request.input,
      userText,
      Boolean(params.viewer)
    );

    if (fallbackBlocks && fallbackBlocks.length > 0) {
      nextBlocks.splice(0, nextBlocks.length, ...fallbackBlocks);
      nextTraces.push({
        stage: 'fallback_blocks_applied',
        detail: {
          reason: 'empty_structured_response',
          inputType: params.request.input.type,
          action: params.request.input.type === 'action' ? params.request.input.action : '',
          blockCount: fallbackBlocks.length,
          authenticated: Boolean(params.viewer),
        },
      });
    }
  }

  const unauthenticatedActionName =
    !params.viewer && params.request.input.type === 'action' ? params.request.input.action : '';
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

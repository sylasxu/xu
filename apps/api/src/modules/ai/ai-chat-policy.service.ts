import { randomUUID } from 'crypto';
import type {
  GenUIAlertBlock,
  GenUIBlock,
  GenUIChoiceOption,
  GenUIRequest,
  GenUITracePayload,
  GenUITurnEnvelope,
} from '@juchang/genui-contract';

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

function createBlockId(): string {
  return `block_${randomUUID().slice(0, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function createChoiceBlock(params: {
  question: string;
  options: GenUIChoiceOption[];
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  return {
    blockId: createBlockId(),
    type: 'choice',
    question: params.question,
    options: params.options,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: { traceRef: params.traceRef },
  };
}

function createEntityCardBlock(params: {
  title: string;
  fields: Record<string, unknown>;
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  return {
    blockId: createBlockId(),
    type: 'entity-card',
    title: params.title,
    fields: params.fields,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: { traceRef: params.traceRef },
  };
}

function createCtaGroupBlock(params: {
  items: Array<{ label: string; action: string; params?: Record<string, unknown> }>;
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  return {
    blockId: createBlockId(),
    type: 'cta-group',
    items: params.items,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: { traceRef: params.traceRef },
  };
}

function createAlertBlock(params: {
  level: GenUIAlertBlock['level'];
  message: string;
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  return {
    blockId: createBlockId(),
    type: 'alert',
    level: params.level,
    message: params.message,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: { traceRef: params.traceRef },
  };
}

function pushBlock(blocks: GenUIBlock[], block: GenUIBlock): void {
  if (!block.dedupeKey) {
    blocks.push(block);
    return;
  }

  const index = blocks.findIndex((item) => item.dedupeKey === block.dedupeKey);
  if (index >= 0) {
    blocks[index] = block;
    return;
  }

  blocks.push(block);
}

function isEmptyStructuredResponse(blocks: GenUIBlock[]): boolean {
  if (blocks.length !== 1) {
    return false;
  }

  const block = blocks[0];
  return block.type === 'alert' && block.dedupeKey === 'empty_response';
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
      slot,
      location,
      activityType,
    };

    return [
      createCtaGroupBlock({
        dedupeKey: 'fallback_publish_cta',
        traceRef: 'fallback_wizard',
        items: [
          {
            label: '就按这个发布',
            action: 'confirm_publish',
            params: draftParams,
          },
          {
            label: '先看附近同类局',
            action: 'explore_nearby',
            params: { location, activityType, slot },
          },
          {
            label: '改下设置',
            action: 'edit_draft',
            params: draftParams,
          },
        ],
      }),
    ];
  }

  if (action === 'confirm_publish') {
    if (isAuthenticated) {
      const title = toStringValue(params.title, '活动草稿');
      const locationName = toStringValue(params.locationName, toStringValue(params.location, '待定地点'));
      const locationHint = toStringValue(params.locationHint);
      const startAt = toStringValue(params.startAt, toStringValue(params.slot, '待定时间'));
      const activityId = `activity_${randomUUID().slice(0, 8)}`;

      return [
        createAlertBlock({
          level: 'success',
          message: '已确认发布，正在为你生成活动卡片。',
          dedupeKey: 'fallback_confirm_publish',
          traceRef: 'fallback_wizard',
        }),
        createEntityCardBlock({
          title,
          fields: {
            activityId,
            title,
            type: toStringValue(params.type, toStringValue(params.activityType, '活动')),
            startAt,
            locationName,
            ...(locationHint ? { locationHint } : {}),
            maxParticipants: params.maxParticipants,
            currentParticipants: params.currentParticipants,
            status: 'published',
          },
          dedupeKey: 'fallback_publish_entity',
          traceRef: 'fallback_wizard',
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
  const isUnauthenticatedPublishAction = /publish/i.test(unauthenticatedActionName);
  if (isUnauthenticatedPublishAction) {
    const sanitizedBlocks = nextBlocks.filter((block) => {
      const dedupeKey = block.dedupeKey || '';
      if (dedupeKey.includes('tool_publishActivity')) {
        return false;
      }

      if (block.type === 'entity-card') {
        const fields = isRecord(block.fields) ? block.fields : {};
        const activityId = toStringValue(fields.activityId);
        if (activityId && !activityId.startsWith('draft_')) {
          return false;
        }
      }

      return true;
    });

    pushBlock(
      sanitizedBlocks,
      createAlertBlock({
        level: 'warning',
        message: '发布前请先登录，这样才能真正创建并分享活动。',
        dedupeKey: 'publish_auth_required',
        traceRef: 'auth_guard',
      })
    );

    nextBlocks.splice(0, nextBlocks.length, ...sanitizedBlocks);
    nextTraces.push({
      stage: 'auth_guard_applied',
      detail: {
        action: unauthenticatedActionName,
        reason: 'unauthenticated_publish',
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

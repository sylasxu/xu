import type { StructuredAction } from '../user-action';

export interface NextBestActionItem {
  label: string;
  action: string;
  params?: Record<string, unknown>;
}

interface NextBestActionInput {
  actionType: StructuredAction['action'] | undefined;
  data: Record<string, unknown> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getDraftActivityTypeLabel(type: string): string {
  switch (type) {
    case 'boardgame':
      return '桌游';
    case 'sports':
      return '运动';
    case 'food':
      return '美食';
    case 'entertainment':
      return '娱乐';
    default:
      return '其他';
  }
}

function buildDraftActionPayload(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const draft = isRecord(data?.draft) ? data.draft : null;

  if (!draft) {
    return null;
  }

  const location = Array.isArray(draft.location) ? draft.location : [];
  const lng = typeof location[0] === 'number'
    ? location[0]
    : typeof data?.lng === 'number'
      ? data.lng
      : 106.52988;
  const lat = typeof location[1] === 'number'
    ? location[1]
    : typeof data?.lat === 'number'
      ? data.lat
      : 29.58567;
  const draftType = typeof draft.type === 'string' && draft.type.trim() ? draft.type.trim() : 'other';
  const locationName = typeof draft.locationName === 'string' && draft.locationName.trim()
    ? draft.locationName.trim()
    : '观音桥';

  return {
    ...(typeof data?.activityId === 'string' ? { activityId: data.activityId } : {}),
    title: typeof draft.title === 'string' && draft.title.trim() ? draft.title.trim() : '活动草稿',
    type: draftType,
    activityType: getDraftActivityTypeLabel(draftType),
    startAt: typeof draft.startAt === 'string' && draft.startAt.trim() ? draft.startAt.trim() : '',
    locationName,
    locationHint: typeof draft.locationHint === 'string' && draft.locationHint.trim()
      ? draft.locationHint.trim()
      : locationName + '附近',
    maxParticipants: typeof draft.maxParticipants === 'number' ? draft.maxParticipants : 6,
    currentParticipants: typeof draft.currentParticipants === 'number' ? draft.currentParticipants : 1,
    lat,
    lng,
  };
}

function buildConfirmPublishParams(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const activityId = typeof data?.activityId === 'string' && data.activityId.trim()
    ? data.activityId.trim()
    : '';

  if (!activityId) {
    return null;
  }

  return {
    activityId,
  };
}

export function buildNextBestActions(params: NextBestActionInput): NextBestActionItem[] {
  const { actionType, data } = params;
  const activityId = typeof data?.activityId === 'string' ? data.activityId : undefined;
  const locationName = typeof data?.locationName === 'string' ? data.locationName : undefined;
  const exploreType = typeof data?.type === 'string' ? data.type : undefined;
  const explorePayload = isRecord(data?.explore) ? data.explore : null;
  const exploreCenter = isRecord(explorePayload?.center) ? explorePayload.center : null;
  const exploreLocationName = typeof exploreCenter?.name === 'string'
    ? exploreCenter.name
    : locationName;
  const exploreResults = Array.isArray(explorePayload?.results) ? explorePayload.results : [];
  const exploreSemanticQuery = typeof explorePayload?.semanticQuery === 'string'
    ? explorePayload.semanticQuery
    : undefined;

  switch (actionType) {
    case 'join_activity': {
      const items: NextBestActionItem[] = [];
      if (activityId) {
        items.push({
          label: '看看活动详情',
          action: 'view_activity',
          params: { activityId },
        });
      }
      items.push({
        label: '继续找附近的局',
        action: 'explore_nearby',
        params: {
          ...(locationName ? { locationName } : {}),
        },
      });
      return items;
    }
    case 'create_activity':
    case 'save_draft_settings': {
      const draftActionPayload = buildDraftActionPayload(data);
      const confirmPublishParams = buildConfirmPublishParams(data);
      if (!draftActionPayload || !confirmPublishParams) {
        return [];
      }

      return [
        {
          label: '确认发布',
          action: 'confirm_publish',
          params: confirmPublishParams,
        },
        {
          label: '改下地点',
          action: 'edit_draft',
          params: { ...draftActionPayload, field: 'location' },
        },
        {
          label: '改下时间',
          action: 'edit_draft',
          params: { ...draftActionPayload, field: 'time' },
        },
        {
          label: '改下人数设置',
          action: 'edit_draft',
          params: { ...draftActionPayload, field: 'participants' },
        },
      ];
    }
    case 'publish_draft':
    case 'confirm_publish': {
      const items: NextBestActionItem[] = [];
      if (activityId) {
        items.push({
          label: '去分享这个局',
          action: 'share_activity',
          params: { activityId },
        });
      }
      items.push({
        label: '再看看附近活动',
        action: 'explore_nearby',
      });
      return items;
    }
    case 'explore_nearby':
      if (exploreResults.length === 0) {
        const promptParts = [
          exploreLocationName ? `附近还没有合适的局，我想在${exploreLocationName}发起一个新的线下活动。` : '附近还没有合适的局，我想自己发起一个新的线下活动。',
          exploreSemanticQuery ? `需求参考：${exploreSemanticQuery}。` : '',
          '先帮我判断要不要自己组，如果需要，再帮我整理成一个可发布的活动草稿。',
        ];

        return [
          {
            label: '那我自己组一个',
            action: 'create_activity',
            params: {
              description: promptParts.filter((item) => item).join(''),
              ...(exploreLocationName ? { locationName: exploreLocationName } : {}),
              ...(exploreType ? { type: exploreType } : {}),
            },
          },
          {
            label: '帮我找同类搭子',
            action: 'find_partner',
            ...(exploreType ? { params: { type: exploreType } } : {}),
          },
          {
            label: '换个关键词重搜',
            action: 'quick_prompt',
            params: { prompt: '换个类型再帮我找找' },
          },
        ];
      }

      return [
        {
          label: '帮我找同类搭子',
          action: 'find_partner',
          ...(exploreType ? { params: { type: exploreType } } : {}),
        },
        {
          label: '换个关键词重搜',
          action: 'quick_prompt',
          params: { prompt: '换个类型再帮我找找' },
        },
      ];
    case 'cancel_join':
      return [
        {
          label: '重新找个局',
          action: 'explore_nearby',
        },
      ];
    case 'confirm_match': {
      const items: NextBestActionItem[] = [];
      if (activityId) {
        items.push({
          label: '进入新局详情',
          action: 'view_activity',
          params: { activityId },
        });
      }
      items.push({
        label: '去群里招呼大家',
        action: 'quick_prompt',
        params: { prompt: '我已经确认匹配了，帮我写一句开场招呼' },
      });
      return items;
    }
    case 'cancel_match':
      return [
        {
          label: '继续找搭子',
          action: 'find_partner',
        },
        {
          label: '改一下我的偏好',
          action: 'quick_prompt',
          params: { prompt: '我想调整找搭子的偏好' },
        },
      ];
    case 'search_partners': {
      const items: NextBestActionItem[] = [];
      const searchPayload = isRecord(data?.searchPayload) ? data.searchPayload : null;

      if (searchPayload) {
        items.push({
          label: '继续帮我留意',
          action: 'opt_in_partner_pool',
          params: searchPayload,
        });
      }

      items.push({
        label: '改一下偏好',
        action: 'find_partner',
        params: {
          ...(searchPayload ?? {}),
          ...(locationName ? { locationName } : {}),
          ...(exploreType ? { type: exploreType } : {}),
          renderMode: 'full-form',
          partnerStage: 'refine_form',
        },
      });

      return items;
    }
    case 'submit_partner_intent_form': {
      const items: NextBestActionItem[] = [];
      if (locationName) {
        items.push({
          label: '看看附近同类局',
          action: 'explore_nearby',
          params: {
            locationName,
            ...(exploreType ? { type: exploreType } : {}),
          },
        });
      }

      items.push({
        label: '改一下偏好',
        action: 'find_partner',
        params: {
          ...(isRecord(data?.searchPayload) ? data.searchPayload : {}),
          ...(locationName ? { locationName } : {}),
          ...(exploreType ? { type: exploreType } : {}),
          renderMode: 'full-form',
          partnerStage: 'refine_form',
        },
      });

      if (typeof data?.matchId === 'string') {
        items.push({
          label: '看看我的搭子进展',
          action: 'quick_prompt',
          params: { prompt: '看看我的搭子进度' },
        });
      }

      return items;
    }
    default:
      return [];
  }
}

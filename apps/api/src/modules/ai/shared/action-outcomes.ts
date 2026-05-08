/**
 * Action Outcomes
 *
 * 将结构化动作的结果映射为可能的下一步操作（action + params）。
 * 按钮文案（label）不再在此硬编码，由 LLM 根据上下文动态生成。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface ActionOutcome {
  action: string;
  params?: Record<string, unknown>;
}

interface ActionOutcomeInput {
  actionType: string | undefined;
  data: Record<string, unknown> | undefined;
}

function buildDraftActionPayload(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const draft = isRecord(data?.draft) ? data.draft : null;
  if (!draft) return null;

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
  if (!activityId) return null;
  return { activityId };
}

export function resolveFollowupActions(params: ActionOutcomeInput): ActionOutcome[] {
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
      const items: ActionOutcome[] = [];
      if (activityId) {
        items.push({ action: 'view_activity', params: { activityId } });
      }
      items.push({
        action: 'explore_nearby',
        params: { ...(locationName ? { locationName } : {}) },
      });
      return items;
    }
    case 'create_activity':
    case 'save_draft_settings': {
      const draftActionPayload = buildDraftActionPayload(data);
      const confirmPublishParams = buildConfirmPublishParams(data);
      if (!draftActionPayload || !confirmPublishParams) return [];

      return [
        { action: 'confirm_publish', params: confirmPublishParams },
        { action: 'edit_draft', params: { ...draftActionPayload, field: 'location' } },
        { action: 'edit_draft', params: { ...draftActionPayload, field: 'time' } },
        { action: 'edit_draft', params: { ...draftActionPayload, field: 'participants' } },
      ];
    }
    case 'publish_draft':
    case 'confirm_publish': {
      const items: ActionOutcome[] = [];
      if (activityId) {
        items.push({ action: 'share_activity', params: { activityId } });
      }
      items.push({ action: 'explore_nearby' });
      return items;
    }
    case 'explore_nearby': {
      if (exploreResults.length === 0) {
        const promptParts = [
          exploreLocationName ? `附近还没有合适的局，我想在${exploreLocationName}发起一个新的线下活动。` : '附近还没有合适的局，我想自己发起一个新的线下活动。',
          exploreSemanticQuery ? `需求参考：${exploreSemanticQuery}。` : '',
          '先帮我判断要不要自己组，如果需要，再帮我整理成一个可发布的活动草稿。',
        ];

        return [
          {
            action: 'create_activity',
            params: {
              description: promptParts.filter((item) => item).join(''),
              ...(exploreLocationName ? { locationName: exploreLocationName } : {}),
              ...(exploreType ? { type: exploreType } : {}),
            },
          },
          {
            action: 'find_partner',
            ...(exploreType ? { params: { type: exploreType } } : {}),
          },
          {
            action: 'explore_nearby',
            ...(exploreType ? { params: { type: exploreType } } : {}),
          },
        ];
      }

      return [
        { action: 'find_partner', ...(exploreType ? { params: { type: exploreType } } : {}) },
        { action: 'explore_nearby', ...(exploreType ? { params: { type: exploreType } } : {}) },
      ];
    }
    case 'cancel_join':
      return [{ action: 'explore_nearby' }];
    case 'record_activity_feedback': {
      const items: ActionOutcome[] = [];
      if (activityId) {
        items.push({
          action: 'create_activity',
          params: {
            description: activityId ? `基于这次活动再约一场` : '帮我再组一个类似的局',
          },
        });
      }
      items.push({ action: 'explore_nearby' });
      return items;
    }
    case 'confirm_match': {
      const items: ActionOutcome[] = [];
      if (activityId) {
        items.push({ action: 'view_activity', params: { activityId } });
      }
      items.push({ action: 'explore_nearby' });
      return items;
    }
    case 'cancel_match':
      return [
        { action: 'find_partner' },
        { action: 'find_partner', params: { renderMode: 'full-form', partnerStage: 'refine_form' } },
      ];
    case 'search_partners': {
      const items: ActionOutcome[] = [];
      const searchPayload = isRecord(data?.searchPayload) ? data.searchPayload : null;

      if (searchPayload) {
        items.push({ action: 'opt_in_partner_pool', params: searchPayload });
      }

      items.push({
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
      const items: ActionOutcome[] = [];
      if (locationName) {
        items.push({
          action: 'explore_nearby',
          params: {
            locationName,
            ...(exploreType ? { type: exploreType } : {}),
          },
        });
      }

      items.push({
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
        items.push({ action: 'find_partner' });
      }

      return items;
    }
    default:
      return [];
  }
}

/**
 * Structured Action Handler
 *
 * 跳过 LLM 意图识别，直接路由到对应 Service 执行。
 */

import type { StructuredAction, StructuredActionResult, StructuredActionType } from './types';
import { createLogger } from '../observability/logger';

// 复用现有 Service 函数
import { joinActivity, quitActivity, getActivityById, getNearbyActivities } from '../../activities/activity.service';
import { recordActivitySelfFeedback, type ActivityFeedbackValue } from '../../participants/participant.service';
import { search } from '../rag';
import { confirmMatch, cancelMatch, createManualPartnerMatch } from '../tools/partner-match';
import { buildCreateDraftParamsFromActionPayload, createActivityDraftRecord, publishActivityRecord, updateActivityDraftRecord } from '../tools/activity-tools';
import { createPartnerIntent, ensureSearchDrivenPartnerIntent, searchPartnerCandidates } from '../tools/partner-tools';
import { buildExploreNearbyResult, type ExploreResultItem } from '../tools/explore-nearby';
import {
  buildPartnerAskPreferencePayload,
  buildPartnerIntentFormPayload,
  buildPartnerSearchPayloadFromState,
  buildPartnerWorkflowIntroText,
  createPartnerMatchingState,
  getPartnerActivityTypeLabel,
  getPartnerSportTypeLabel,
  getPartnerTimeLabel,
  hydratePartnerMatchingStateFromPayload,
  normalizePartnerActivityType,
  normalizePartnerSportType,
  resolvePartnerFormStageFromPayload,
  shouldRenderPartnerIntentFormFromPayload,
} from '../workflow/partner-matching';
import { understandPartnerRequest } from '../workflow/partner-understanding';

const logger = createLogger('structured-action');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown, fallback = '操作失败'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getPartnerSearchTargetLabel(activityType: string, sportType?: string): string {
  if (activityType === 'sports') {
    return `${getPartnerSportTypeLabel(sportType) || '运动'}搭子`;
  }

  return `${getPartnerActivityTypeLabel(activityType)}搭子`;
}

function mergeExploreResultsWithNearbyFallback(params: {
  primary: ExploreResultItem[];
  fallback: Array<{
    id: string;
    title: string;
    lat: number;
    lng: number;
    locationName: string;
    locationHint: string;
    distance: number;
    startAt: string;
    type: string;
    maxParticipants: number;
    currentParticipants: number;
  }>;
  limit: number;
}): ExploreResultItem[] {
  const merged = [...params.primary];
  const seenIds = new Set(params.primary.map((item) => item.id));

  for (const item of params.fallback) {
    if (seenIds.has(item.id)) {
      continue;
    }

    merged.push({
      id: item.id,
      title: item.title,
      type: item.type,
      lat: item.lat,
      lng: item.lng,
      locationName: item.locationName,
      distance: item.distance,
      startAt: item.startAt,
      currentParticipants: item.currentParticipants,
      maxParticipants: item.maxParticipants,
    });
    seenIds.add(item.id);

    if (merged.length >= params.limit) {
      break;
    }
  }

  return merged;
}

function buildPendingStructuredAction(action: StructuredAction): Record<string, unknown> {
  const payloadSource = typeof action.payload.source === 'string' ? action.payload.source.trim() : '';
  return {
    type: 'structured_action',
    action: action.action,
    payload: action.payload,
    ...(action.source ? { source: action.source } : payloadSource ? { source: payloadSource } : {}),
    ...(action.originalText ? { originalText: action.originalText } : {}),
  };
}

function normalizeAuthRequiredResult(
  result: StructuredActionResult,
  action: StructuredAction
): StructuredActionResult {
  const data = isRecord(result.data) ? result.data : {};
  const errorText = typeof result.error === 'string' ? result.error : '';
  const requiresPhoneBinding =
    data.requiresPhoneBinding === true ||
    errorText.includes('绑定手机号');
  const requiresLogin =
    !requiresPhoneBinding &&
    (data.requiresAuth === true || errorText.includes('请先登录'));

  if (!requiresPhoneBinding && !requiresLogin) {
    return result;
  }

  const authMode = requiresPhoneBinding ? 'bind_phone' : 'login';

  return {
    ...result,
    data: {
      ...data,
      requiresAuth: true,
      ...(requiresPhoneBinding ? { requiresPhoneBinding: true } : {}),
      pendingAction: {
        ...buildPendingStructuredAction(action),
        authMode,
      },
    },
  };
}

/**
 * Action 到 Tool 的映射表
 */
const STRUCTURED_ACTION_HANDLERS: Record<StructuredActionType, {
  handler: (payload: Record<string, unknown>, userId: string | null) => Promise<StructuredActionResult>;
  requiresAuth: boolean;
  description: string;
}> = {
  // 活动相关
  join_activity: {
    handler: handleJoinActivity,
    requiresAuth: true,
    description: '报名活动',
  },
  view_activity: {
    handler: handleViewActivity,
    requiresAuth: false,
    description: '查看活动详情',
  },
  cancel_join: {
    handler: handleCancelJoin,
    requiresAuth: true,
    description: '取消报名',
  },
  share_activity: {
    handler: handleShareActivity,
    requiresAuth: false,
    description: '分享活动',
  },
  record_activity_feedback: {
    handler: handleRecordActivityFeedback,
    requiresAuth: true,
    description: '记录活动后真实反馈',
  },
  
  // 创建相关
  create_activity: {
    handler: handleCreateActivity,
    requiresAuth: true,
    description: '创建活动',
  },
  edit_draft: {
    handler: handleEditDraft,
    requiresAuth: true,
    description: '编辑草稿',
  },
  save_draft_settings: {
    handler: handleSaveDraftSettings,
    requiresAuth: true,
    description: '保存草稿设置',
  },
  publish_draft: {
    handler: handlePublishDraft,
    requiresAuth: true,
    description: '发布草稿',
  },
  confirm_publish: {
    handler: handlePublishDraft,
    requiresAuth: true,
    description: '确认发布',
  },
  
  // 探索相关
  explore_nearby: {
    handler: handleExploreNearby,
    requiresAuth: false,
    description: '探索附近',
  },
  ask_preference: {
    handler: handleAskPreference,
    requiresAuth: false,
    description: '追问偏好',
  },
  expand_map: {
    handler: handleExpandMap,
    requiresAuth: false,
    description: '展开地图',
  },
  filter_activities: {
    handler: handleFilterActivities,
    requiresAuth: false,
    description: '筛选活动',
  },
  
  // 找搭子相关
  find_partner: {
    handler: handleFindPartner,
    requiresAuth: false,
    description: '找搭子',
  },
  search_partners: {
    handler: handleSearchPartners,
    requiresAuth: false,
    description: '搜索搭子结果',
  },
  connect_partner: {
    handler: handleConnectPartner,
    requiresAuth: true,
    description: '和候选搭子建立联系',
  },
  request_partner_group_up: {
    handler: handleRequestPartnerGroupUp,
    requiresAuth: true,
    description: '询问是否一起组局',
  },
  opt_in_partner_pool: {
    handler: handleOptInPartnerPool,
    requiresAuth: true,
    description: '继续帮我留意',
  },
  submit_partner_intent_form: {
    handler: handleSearchPartners,
    requiresAuth: false,
    description: '提交找搭子表单并搜索',
  },
  confirm_match: {
    handler: handleConfirmMatch,
    requiresAuth: true,
    description: '确认匹配',
  },
  cancel_match: {
    handler: handleCancelMatch,
    requiresAuth: true,
    description: '取消匹配',
  },
  select_preference: {
    handler: handleSelectPreference,
    requiresAuth: false,
    description: '选择偏好',
  },
  skip_preference: {
    handler: handleSkipPreference,
    requiresAuth: false,
    description: '跳过偏好',
  },
  
  // 通用
  retry: {
    handler: handleRetry,
    requiresAuth: false,
    description: '重试',
  },
  cancel: {
    handler: handleCancel,
    requiresAuth: false,
    description: '取消',
  },
  quick_prompt: {
    handler: handleQuickPrompt,
    requiresAuth: false,
    description: '快捷提示词',
  },
};

/**
 * 处理 Structured Action
 *
 * @returns StructuredActionResult，如果 fallbackToLLM=true 则需要回退到 LLM 处理
 */
export async function handleStructuredAction(
  structuredAction: StructuredAction,
  userId: string | null,
  location?: { lat: number; lng: number }
): Promise<StructuredActionResult> {
  const startTime = Date.now();
  const { action: actionType, payload, source } = structuredAction;
  
  logger.info('Processing structured action', {
    actionType, 
    source, 
    userId: userId || 'anon',
    hasLocation: !!location,
  });
  
  // 查找处理器
  const handlerConfig = STRUCTURED_ACTION_HANDLERS[actionType];
  if (!handlerConfig) {
    logger.warn('Unknown structured action type', { actionType });
    return {
      success: false,
      fallbackToLLM: true,
      fallbackText: structuredAction.originalText || `执行 ${actionType}`,
    };
  }
  
  // 检查认证
  if (handlerConfig.requiresAuth && !userId) {
    logger.warn('Action requires auth', { actionType });
    return normalizeAuthRequiredResult({
      success: false,
      error: '请先登录',
      data: { requiresAuth: true },
    }, structuredAction);
  }
  
  try {
    // 注入位置信息到 payload
    const enrichedPayload = location 
      ? { ...payload, _location: location }
      : payload;
    
    const result = await handlerConfig.handler(enrichedPayload, userId);
    
    const duration = Date.now() - startTime;
    logger.info('Structured action completed', {
      actionType, 
      success: result.success,
      duration,
      fallbackToLLM: result.fallbackToLLM,
    });
    
    return normalizeAuthRequiredResult({
      ...result,
      durationMs: duration,
    }, structuredAction);
  } catch (error) {
    logger.error('Structured action failed', { 
      actionType, 
      error: getErrorMessage(error),
    });
    
    return normalizeAuthRequiredResult({
      success: false,
      error: getErrorMessage(error),
      durationMs: Date.now() - startTime,
      fallbackToLLM: false,
    }, structuredAction);
  }
}

// ============================================================================
// Structured Action Handlers
// ============================================================================

function resolveActionLocation(payload: Record<string, unknown>): { lat: number; lng: number } | null {
  const embedded = payload._location;
  if (isRecord(embedded)) {
    const record = embedded;
    const lat = typeof record.lat === 'number' ? record.lat : null;
    const lng = typeof record.lng === 'number' ? record.lng : null;
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
  }

  const center = payload.center;
  if (isRecord(center)) {
    const record = center;
    const lat = typeof record.lat === 'number' ? record.lat : null;
    const lng = typeof record.lng === 'number' ? record.lng : null;
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
  }

  const lat = typeof payload.lat === 'number' ? payload.lat : null;
  const lng = typeof payload.lng === 'number' ? payload.lng : null;
  if (lat !== null && lng !== null) {
    return { lat, lng };
  }

  return null;
}

const DRAFT_LOCATION_OPTIONS = [
  { label: '观音桥', value: '观音桥', lat: 29.58567, lng: 106.52988 },
  { label: '解放碑', value: '解放碑', lat: 29.55792, lng: 106.57709 },
  { label: '南坪', value: '南坪', lat: 29.52589, lng: 106.57024 },
  { label: '江北嘴', value: '江北嘴', lat: 29.58263, lng: 106.56653 },
];

const DRAFT_SLOT_OPTIONS = [
  { label: '今晚 19:00', value: 'tonight_19_00' },
  { label: '今晚 20:00', value: 'tonight_20_00' },
  { label: '明晚 19:00', value: 'tomorrow_19_00' },
  { label: '明晚 20:00', value: 'tomorrow_20_00' },
  { label: '周末 14:00', value: 'weekend_14_00' },
  { label: '周末 20:00', value: 'weekend_20_00' },
];

const DRAFT_PARTICIPANT_OPTIONS = [4, 6, 8, 10].map((value) => ({
  label: `${value} 人`,
  value: String(value),
}));

const EXPLORE_ACTIVITY_TYPE_OPTIONS = [
  { label: '先看全部', value: 'all' },
  { label: '约饭', value: 'food' },
  { label: '运动', value: 'sports' },
  { label: '桌游', value: 'boardgame' },
  { label: '娱乐', value: 'entertainment' },
] as const;

type ExploreActivityType = 'food' | 'sports' | 'boardgame' | 'entertainment' | 'other';

function normalizeExploreActivityType(value: string | undefined): ExploreActivityType | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'all' || normalized === '全部' || normalized === '先看全部') {
    return undefined;
  }

  const aliases: Record<string, ExploreActivityType> = {
    food: 'food',
    '约饭': 'food',
    '吃饭': 'food',
    '火锅': 'food',
    sports: 'sports',
    '运动': 'sports',
    '羽毛球': 'sports',
    boardgame: 'boardgame',
    '桌游': 'boardgame',
    entertainment: 'entertainment',
    '娱乐': 'entertainment',
    'ktv': 'entertainment',
    'k歌': 'entertainment',
    other: 'other',
    '其他': 'other',
  };

  return aliases[normalized];
}

function resolvePresetLocation(
  locationName: string
): { name: string; lat: number; lng: number } | null {
  const trimmed = locationName.trim();
  if (!trimmed) {
    return null;
  }

  const matched = DRAFT_LOCATION_OPTIONS.find((item) => item.value === trimmed || item.label === trimmed);
  if (!matched) {
    return null;
  }

  return {
    name: matched.value,
    lat: matched.lat,
    lng: matched.lng,
  };
}

function buildExploreSemanticQueryFromSelection(
  locationName: string,
  activityType?: string
): string {
  const typeLabelMap: Record<string, string> = {
    food: '约饭',
    sports: '运动',
    boardgame: '桌游',
    entertainment: '娱乐',
  };

  if (activityType) {
    return `${locationName}附近的${typeLabelMap[activityType] || '活动'}`;
  }

  return `${locationName}附近的活动`;
}

function buildTypeAskPreferencePayload(params: {
  locationName: string;
  lat?: number;
  lng?: number;
}): {
  message: string;
  askPreference: {
    questionType: 'type';
    question: string;
    options: Array<Record<string, unknown>>;
  };
} {
  const question = `${params.locationName}想先看哪类活动？`;
  const baseParams = {
    locationName: params.locationName,
    ...(typeof params.lat === 'number' ? { lat: params.lat } : {}),
    ...(typeof params.lng === 'number' ? { lng: params.lng } : {}),
    ...(
      typeof params.lat === 'number' && typeof params.lng === 'number'
        ? { radiusKm: 5 }
        : {}
    ),
  };

  return {
    message: question,
    askPreference: {
      questionType: 'type',
      question,
      options: EXPLORE_ACTIVITY_TYPE_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
        action: 'explore_nearby',
        params: {
          ...baseParams,
          semanticQuery: buildExploreSemanticQueryFromSelection(
            params.locationName,
            option.value === 'all' ? undefined : option.value
          ),
          ...(option.value === 'all' ? {} : { type: option.value }),
        },
      })),
    },
  };
}

function toTextValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function toNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function readActivityPoint(value: unknown): { lat: number; lng: number } | null {
  if (!isRecord(value)) {
    return null;
  }

  const lng = toNumericValue(value.x);
  const lat = toNumericValue(value.y);
  if (lat === null || lng === null) {
    return null;
  }

  return { lat, lng };
}

function inferDraftSlotFromStartAt(startAt: string): string {
  const date = startAt ? new Date(startAt) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return 'tomorrow_20_00';
  }

  const now = new Date();
  const dayDiff = Math.round((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  const hour = date.getHours();
  const isWeekend = [0, 6].includes(date.getDay());

  if (isWeekend) {
    return hour >= 18 ? 'weekend_20_00' : 'weekend_14_00';
  }

  if (dayDiff <= 0) {
    return hour <= 19 ? 'tonight_19_00' : 'tonight_20_00';
  }

  return hour <= 19 ? 'tomorrow_19_00' : 'tomorrow_20_00';
}

function resolveDraftStartAtFromSlot(slot: string, fallbackStartAt?: string): string {
  if (!slot) {
    return fallbackStartAt || '';
  }

  const now = new Date();
  const target = new Date(now);

  switch (slot) {
    case 'tonight_19_00':
      target.setHours(19, 0, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      break;
    case 'tonight_20_00':
      target.setHours(20, 0, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      break;
    case 'tomorrow_19_00':
      target.setDate(target.getDate() + 1);
      target.setHours(19, 0, 0, 0);
      break;
    case 'tomorrow_20_00':
      target.setDate(target.getDate() + 1);
      target.setHours(20, 0, 0, 0);
      break;
    case 'weekend_14_00':
    case 'weekend_20_00': {
      const day = target.getDay();
      const offset = day === 6 ? 0 : (6 - day + 7) % 7 || 7;
      target.setDate(target.getDate() + offset);
      target.setHours(slot === 'weekend_20_00' ? 20 : 14, 0, 0, 0);
      break;
    }
    default:
      return fallbackStartAt || '';
  }

  return target.toISOString();
}

function resolveDraftLocationByName(locationName: string): { lat: number; lng: number } | null {
  const matched = DRAFT_LOCATION_OPTIONS.find((item) => item.value === locationName);
  if (!matched) {
    return null;
  }

  return { lat: matched.lat, lng: matched.lng };
}

function buildDraftSettingsFormPayload(payload: Record<string, unknown>) {
  const field = toTextValue(payload.field);
  const locationName = toTextValue(payload.locationName, '观音桥');
  const slot = toTextValue(payload.slot) || inferDraftSlotFromStartAt(toTextValue(payload.startAt));
  const maxParticipants = toNumericValue(payload.maxParticipants);

  const initialValues: Record<string, unknown> = {
    activityId: toTextValue(payload.activityId),
    title: toTextValue(payload.title, '活动草稿'),
    type: toTextValue(payload.type, 'other'),
    locationName,
    locationHint: toTextValue(payload.locationHint, `${locationName}附近`),
    slot,
    maxParticipants: String(maxParticipants && maxParticipants >= 2 ? maxParticipants : 6),
    startAt: toTextValue(payload.startAt),
    lat: toNumericValue(payload.lat) ?? 29.58567,
    lng: toNumericValue(payload.lng) ?? 106.52988,
    field,
  };

  const allFields = [
    {
      name: 'locationName',
      label: '在哪儿组局',
      type: 'single-select',
      required: true,
      options: DRAFT_LOCATION_OPTIONS.map(({ label, value }) => ({ label, value })),
    },
    {
      name: 'locationHint',
      label: '碰头说明',
      type: 'textarea',
      placeholder: '比如地铁口见、商场几楼、先到先占位',
      maxLength: 60,
    },
    {
      name: 'slot',
      label: '什么时候开始',
      type: 'single-select',
      required: true,
      options: DRAFT_SLOT_OPTIONS,
    },
    {
      name: 'maxParticipants',
      label: '想约几个人',
      type: 'single-select',
      required: true,
      options: DRAFT_PARTICIPANT_OPTIONS,
    },
  ];

  const fields = field === 'location'
    ? allFields.filter((item) => item.name === 'locationName' || item.name === 'locationHint')
    : field === 'time'
      ? allFields.filter((item) => item.name === 'slot')
      : field === 'participants'
        ? allFields.filter((item) => item.name === 'maxParticipants')
        : allFields;

  const title = field === 'location'
    ? '改下地点'
    : field === 'time'
      ? '改下时间'
      : field === 'participants'
        ? '改下人数设置'
        : '调整活动草稿';

  return {
    title,
    schema: {
      formType: 'draft_settings',
      submitAction: 'save_draft_settings',
      submitLabel: '保存草稿设置',
      fields,
    },
    initialValues,
  };
}

async function handleJoinActivity(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  const activityId = toTextValue(payload.activityId);
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }
  
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }
  
  try {
    const joinResult = await joinActivity(activityId, userId);
    const activity = await getActivityById(activityId);

    const navigationPayload = {
      activityId,
      ...(activity?.title ? { title: activity.title } : {}),
      ...(typeof payload.source === 'string' && payload.source.trim()
        ? { source: payload.source.trim() }
        : {}),
    };

    return {
      success: true,
      data: {
        activityId,
        activityTitle: activity?.title,
        joinResult: joinResult.joinResult,
        message: joinResult.message,
        navigationIntent: joinResult.navigationIntent,
        navigationPayload,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

async function handleViewActivity(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  const activityId = toTextValue(payload.activityId);
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }
  
  // 查看详情由前端处理跳转，这里只返回成功
  return {
    success: true,
    data: { 
      action: 'navigate',
      url: `/subpackages/activity/detail/index?id=${activityId}`,
    },
  };
}

async function handleCancelJoin(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }
  
  const activityId = toTextValue(payload.activityId);
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }
  
  try {
    // 调用现有的 activity.service 函数
    await quitActivity(activityId, userId);
    
    return {
      success: true,
      data: {
        activityId,
        message: '已取消报名',
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

async function handleShareActivity(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  const activityId = toTextValue(payload.activityId);
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }
  
  // 分享由前端处理，这里返回分享数据
  return {
    success: true,
    data: {
      action: 'share',
      activityId,
      title: toTextValue(payload.title),
    },
  };
}

function readActivityFeedbackValue(value: unknown): ActivityFeedbackValue | null {
  if (value === 'positive' || value === 'neutral' || value === 'failed') {
    return value;
  }

  return null;
}

async function handleRecordActivityFeedback(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }

  const activityId = toTextValue(payload.activityId);
  const feedback = readActivityFeedbackValue(payload.feedback);
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }
  if (!feedback) {
    return { success: false, error: '缺少活动反馈结果' };
  }

  try {
    const result = await recordActivitySelfFeedback({
      userId,
      activityId,
      feedback,
      reviewSummary: toTextValue(payload.reviewSummary),
    });

    return {
      success: true,
      data: {
        activityId,
        feedback,
        message: result.msg,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

async function handleCreateActivity(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }

  const draftParams = buildCreateDraftParamsFromActionPayload(payload);
  const createResult = await createActivityDraftRecord(userId, draftParams);

  if (!createResult.success) {
    return {
      success: false,
      error: createResult.error,
    };
  }

  return {
    success: true,
    data: {
      activityId: createResult.activityId,
      draft: createResult.draft,
      locationName: createResult.draft.locationName,
      type: createResult.draft.type,
      message: createResult.message,
    },
  };
}

async function handleEditDraft(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  const activityId = toTextValue(payload.activityId);
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }

  const formPayload = buildDraftSettingsFormPayload(payload);

  return {
    success: true,
    data: {
      activityId,
      message: '改一下草稿设置，确认后我就帮你更新。',
      draftSettingsForm: formPayload,
    },
  };
}

async function handleSaveDraftSettings(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }

  const activityId = toTextValue(payload.activityId);
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }

  const locationName = toTextValue(payload.locationName);
  const locationHint = toTextValue(payload.locationHint);
  const slot = toTextValue(payload.slot);
  const fallbackStartAt = toTextValue(payload.startAt);
  const startAt = slot
    ? resolveDraftStartAtFromSlot(slot, fallbackStartAt)
    : fallbackStartAt;
  const maxParticipants = toNumericValue(payload.maxParticipants);
  const directLocation = resolveActionLocation(payload);
  const presetLocation = locationName ? resolveDraftLocationByName(locationName) : null;
  const resolvedLocation = directLocation || presetLocation;

  const updates: {
    locationName?: string;
    locationHint?: string;
    location?: [number, number];
    startAt?: string;
    maxParticipants?: number;
  } = {};

  if (locationName) {
    updates.locationName = locationName;
  }

  if (locationHint) {
    updates.locationHint = locationHint;
  } else if (locationName) {
    updates.locationHint = `${locationName}附近`;
  }

  if (resolvedLocation) {
    updates.location = [resolvedLocation.lng, resolvedLocation.lat];
  }

  if (startAt) {
    updates.startAt = startAt;
  }

  if (maxParticipants !== null && maxParticipants >= 2) {
    updates.maxParticipants = maxParticipants;
  }

  const changedLabels: string[] = [];
  if (updates.locationName || updates.locationHint || updates.location) changedLabels.push('地点');
  if (updates.startAt) changedLabels.push('时间');
  if (typeof updates.maxParticipants === 'number') changedLabels.push('人数');
  const reason = changedLabels.length > 0 ? `已更新${changedLabels.join('、')}` : '已更新草稿设置';

  const updateResult = await updateActivityDraftRecord(userId, activityId, updates, reason);
  if (!updateResult.success) {
    return { success: false, error: updateResult.error };
  }

  return {
    success: true,
    data: {
      activityId: updateResult.activityId,
      draft: updateResult.draft,
      locationName: updateResult.draft.locationName,
      type: updateResult.draft.type,
      message: updateResult.message,
    },
  };
}

async function handlePublishDraft(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }
  
  const activityId = toTextValue(payload.activityId);
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }

  const publishResult = await publishActivityRecord(userId, activityId);
  if (!publishResult.success) {
    return {
      success: false,
      error: publishResult.error,
    };
  }
  
  return {
    success: true,
    data: publishResult,
  };
}

async function handleAskPreference(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  const question = typeof payload.question === 'string' && payload.question.trim()
    ? payload.question.trim()
    : '想先看哪个区域的活动？';

  const questionType = typeof payload.questionType === 'string' && payload.questionType.trim()
    ? payload.questionType.trim()
    : 'location';

  const options = Array.isArray(payload.options) ? payload.options : [];

  return {
    success: true,
    data: {
      message: question,
      askPreference: {
        questionType,
        question,
        options,
      },
    },
  };
}

async function handleExploreNearby(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  const location = resolveActionLocation(payload);

  try {
    const locationName = toTextValue(payload.locationName, '附近') || '附近';
    const radius = toNumericValue(payload.radiusKm) ?? 5;
    const type = normalizeExploreActivityType(toTextValue(payload.type) || undefined);
    const semanticQuery = typeof payload.semanticQuery === 'string' && payload.semanticQuery.trim()
      ? payload.semanticQuery.trim()
      : `${locationName}附近的活动`;

    const resultLimit = 10;
    const scoredResults = await search({
      semanticQuery,
      filters: {
        ...(location
          ? {
              location: {
                lat: location.lat,
                lng: location.lng,
                radiusInKm: radius,
              },
            }
          : {}),
        type: type ?? undefined,
      },
      limit: resultLimit,
      includeMatchReason: false,
      userId: userId ?? undefined,
    });

    let results: ExploreResultItem[] = scoredResults.map((scored) => {
      const { activity, score, distance } = scored;
      const point = readActivityPoint(activity.location);

      return {
        id: activity.id,
        title: activity.title,
        type: activity.type,
        lat: point?.lat ?? 0,
        lng: point?.lng ?? 0,
        locationName: activity.locationName,
        distance: distance ? Math.round(distance) : 0,
        startAt: new Date(activity.startAt).toISOString(),
        currentParticipants: activity.currentParticipants,
        maxParticipants: activity.maxParticipants,
        score,
      };
    });

    if (location && results.length < 2) {
      const nearby = await getNearbyActivities({
        lat: location.lat,
        lng: location.lng,
        radius: radius * 1000,
        limit: resultLimit,
        ...(type ? { type } : {}),
      });

      results = mergeExploreResultsWithNearbyFallback({
        primary: results,
        fallback: nearby.data,
        limit: resultLimit,
      });
    }

    return {
      success: true,
      data: buildExploreNearbyResult({
        ...(location ? { center: { lat: location.lat, lng: location.lng, name: locationName } } : {}),
        locationName,
        results,
        radiusKm: radius,
        semanticQuery,
        ...(type ? { type } : {}),
      }),
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

async function handleExpandMap(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  // 展开地图由前端处理
  return {
    success: true,
    data: {
      action: 'navigate',
      url: '/subpackages/activity/explore/index',
      params: payload,
    },
  };
}

async function handleFilterActivities(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  // 筛选需要 LLM 理解筛选条件
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: `筛选${payload.type || ''}活动`,
  };
}

async function handleFindPartner(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  const rawInput = typeof payload.rawInput === 'string' && payload.rawInput.trim()
    ? payload.rawInput.trim()
    : typeof payload.prompt === 'string' && payload.prompt.trim()
      ? payload.prompt.trim()
      : '帮我找找有没有同意向的人';

  const state = hydratePartnerMatchingStateFromPayload(createPartnerMatchingState(rawInput), payload);

  if (shouldRenderPartnerIntentFormFromPayload(payload)) {
    const partnerStage = resolvePartnerFormStageFromPayload(payload) || 'refine_form';
    const formPayload = buildPartnerIntentFormPayload({
      state,
      rawInput,
      defaultActivityType: state.collectedPreferences.activityType,
      defaultLocation: state.collectedPreferences.location,
      fallbackLocationHint: state.collectedPreferences.location || '附近',
    });

    return {
      success: true,
      data: {
        message: partnerStage === 'intent_pool'
          ? '我把可补充的偏好都展开了。你填得越清楚，后面替你留意时就会更准。'
          : '我把可调整的偏好都展开了，你想细化的话可以直接改。',
        locationName: state.collectedPreferences.location,
        type: state.collectedPreferences.activityType,
        partnerIntentForm: {
          ...formPayload,
          renderMode: 'full-form',
          partnerStage,
        },
      },
    };
  }

  const askPreference = buildPartnerAskPreferencePayload(state);

  if (!askPreference) {
    return handleSearchPartners(buildPartnerSearchPayloadFromState(state), userId);
  }

  return {
    success: true,
    data: {
      message: buildPartnerWorkflowIntroText(state),
      locationName: state.collectedPreferences.location,
      type: state.collectedPreferences.activityType,
      askPreference,
      ...(userId ? {} : { previewOnly: true }),
    },
  };
}

function normalizePartnerSearchPayload(payload: Record<string, unknown>) {
  const rawInputSource = typeof payload.rawInput === 'string' && payload.rawInput.trim()
    ? payload.rawInput.trim()
    : typeof payload.prompt === 'string' && payload.prompt.trim()
      ? payload.prompt.trim()
      : '';
  const understanding = rawInputSource ? understandPartnerRequest(rawInputSource) : null;
  const activityType = normalizePartnerActivityType(typeof payload.activityType === 'string'
    ? payload.activityType
    : understanding?.activityType === 'food'
      ? 'food'
      : understanding?.activityType === 'sports'
        ? 'sports'
        : understanding?.activityType === 'boardgame'
          ? 'boardgame'
          : understanding?.activityType === 'entertainment'
            ? 'entertainment'
            : undefined);
  const sportType = normalizePartnerSportType(typeof payload.sportType === 'string' ? payload.sportType.trim() : undefined);
  const timeRange = typeof payload.timeRange === 'string' ? payload.timeRange.trim() : '';
  const locationHint = typeof payload.location === 'string' && payload.location.trim()
    ? payload.location.trim()
    : typeof payload.locationName === 'string' && payload.locationName.trim()
      ? payload.locationName.trim()
      : understanding?.locationText || understanding?.destinationText
        ? (understanding.locationText || understanding.destinationText || '')
      : '';
  const description = typeof payload.description === 'string' && payload.description.trim()
    ? payload.description.trim()
    : typeof payload.note === 'string' && payload.note.trim()
      ? payload.note.trim()
      : understanding?.activityText || understanding?.destinationText
        ? [
            understanding?.destinationText,
            understanding?.activityText,
            understanding?.timeText,
          ].filter(Boolean).join(' ')
      : '';
  const preferredGender = typeof payload.preferredGender === 'string' && payload.preferredGender.trim()
    ? payload.preferredGender.trim()
    : '';
  const preferredAgeRange = typeof payload.preferredAgeRange === 'string' && payload.preferredAgeRange.trim()
    ? payload.preferredAgeRange.trim()
    : '';
  const resolvedTimeRange = timeRange || understanding?.normalizedTimeRange || '';
  const timePreference = resolvedTimeRange ? getPartnerTimeLabel(resolvedTimeRange) : understanding?.timeText;
  const sportLabel = getPartnerSportTypeLabel(sportType);
  const rawInputParts = [
    rawInputSource,
    sportLabel ? `${sportLabel}搭子` : '',
    timePreference || '',
    locationHint,
    description,
  ].filter(Boolean);

  return {
    activityType,
    sportType,
    timeRange: resolvedTimeRange,
    timePreference,
    locationHint,
    description,
    preferredGender,
    preferredAgeRange,
    rawInput: Array.from(new Set(rawInputParts)).join('，'),
  };
}

function buildPartnerSearchResultMessage(params: {
  scenarioType?: string;
  hasResults: boolean;
  locationHint: string;
  targetLabel: string;
}): string {
  const locationLabel = params.locationHint || '这边';

  if (params.scenarioType === 'destination_companion') {
    return params.hasResults
      ? `我先按“去${locationLabel}同去”的方向帮你筛了一轮。你现在还在“先搜一下”这一步，先看看有没有顺眼的人，再决定要不要继续推进。`
      : `我先按“去${locationLabel}同去”的方向帮你筛了一轮，暂时还没碰到特别合适的。你可以补一句是想找同行、同路，还是到了当地再一起玩，我继续帮你收窄。`;
  }

  if (params.scenarioType === 'fill_seat') {
    return params.hasResults
      ? `我先按${locationLabel}这边“补位”的方向帮你找了一轮。你现在还在“先搜一下”这一步，先挑一位继续，或者这轮没有就让我继续替你留意。`
      : `我先按${locationLabel}这边“补位”的方向帮你搜了一轮，暂时还没看到特别合适的。你可以补一句时间、人数或玩法要求，我继续帮你捞。`;
  }

  return params.hasResults
    ? `先按${locationLabel}附近的${params.targetLabel}帮你找了一圈。你现在还在“先搜一下”这一步，先挑一位继续，或者这轮没有就让我继续替你留意。`
    : `先按${locationLabel}附近的${params.targetLabel}帮你搜了一圈，暂时还没看到特别合适的。你可以换个片区、补一句你想找的人是什么样，或者登录后让我继续替你留意。`;
}

function buildPartnerSearchResultsTitle(params: {
  scenarioType?: string;
  hasResults: boolean;
}): string {
  if (params.scenarioType === 'destination_companion') {
    return params.hasResults ? '先搜到这些同去伙伴' : '暂时还没搜到特别合适的同去伙伴';
  }

  if (params.scenarioType === 'fill_seat') {
    return params.hasResults ? '先搜到这些补位人选' : '暂时还没搜到特别合适的补位人选';
  }

  return params.hasResults ? '先搜到这几位' : '暂时还没搜到特别合适的';
}

function buildPartnerSearchCardActions(params: {
  userId: string | null;
  partnerIntentId: string;
  candidateUserId: string;
  candidateTitle: string;
  activityType: string;
  sportType?: string;
  scenarioType?: string;
  searchPayload: Record<string, unknown>;
}): Array<{ label: string; action: string; params: Record<string, unknown> }> {
  const connectLabel = params.scenarioType === 'destination_companion'
    ? (params.userId ? '发起同去邀约' : '登录后发起同去邀约')
    : params.scenarioType === 'fill_seat'
      ? (params.userId ? '发起补位邀约' : '登录后发起补位邀约')
      : (params.userId ? '发起搭子邀请' : '登录后发起搭子邀请');
  const groupUpLabel = params.scenarioType === 'destination_companion'
    ? (params.userId ? '让小聚帮我问要不要一起去' : '登录后让小聚帮我问要不要一起去')
    : params.scenarioType === 'fill_seat'
      ? (params.userId ? '让小聚帮我问能不能补位' : '登录后让小聚帮我问能不能补位')
      : (params.userId ? '让小聚帮我问能不能组局' : '登录后让小聚帮我问能不能组局');

  return [
    {
      label: connectLabel,
      action: 'connect_partner',
      params: {
        partnerIntentId: params.partnerIntentId,
        candidateUserId: params.candidateUserId,
        candidateTitle: params.candidateTitle,
        activityType: params.activityType,
        ...(params.sportType ? { sportType: params.sportType } : {}),
        searchPayload: params.searchPayload,
      },
    },
    {
      label: groupUpLabel,
      action: 'request_partner_group_up',
      params: {
        partnerIntentId: params.partnerIntentId,
        candidateUserId: params.candidateUserId,
        candidateTitle: params.candidateTitle,
        activityType: params.activityType,
        ...(params.sportType ? { sportType: params.sportType } : {}),
        searchPayload: params.searchPayload,
      },
    },
    {
      label: params.userId ? '这轮没有就继续帮我留意' : '登录后继续帮我留意',
      action: 'opt_in_partner_pool',
      params: params.searchPayload,
    },
  ];
}

async function createPartnerMatchFromSelectedCandidate(params: {
  payload: Record<string, unknown>;
  userId: string;
  mode: 'connect' | 'group_up';
}): Promise<StructuredActionResult> {
  const sourcePayload = isRecord(params.payload.searchPayload)
    ? params.payload.searchPayload
    : params.payload;
  const normalized = normalizePartnerSearchPayload(sourcePayload);
  const location = resolveActionLocation(params.payload);
  if (!location) {
    return { success: false, error: '需要先获取你的位置，才能继续和这位搭子对接' };
  }

  const candidateIntentId = toTextValue(params.payload.partnerIntentId);
  if (!candidateIntentId) {
    return { success: false, error: '缺少候选搭子的意向信息，请重新搜一下再试' };
  }

  if (normalized.activityType === 'sports' && !normalized.sportType) {
    return { success: false, error: '还差一个运动类型，补完我才能继续帮你对接这位搭子' };
  }

  if (!normalized.locationHint) {
    return { success: false, error: '还差一个方便区域，补完我才能继续帮你对接这位搭子' };
  }

  const sourceIntentResult = await ensureSearchDrivenPartnerIntent({
    userId: params.userId,
    userLocation: location,
    rawInput: normalized.rawInput,
    activityType: normalized.activityType,
    ...(normalized.sportType ? { sportType: normalized.sportType } : {}),
    locationHint: normalized.locationHint,
    ...(normalized.timePreference ? { timePreference: normalized.timePreference } : {}),
    ...(normalized.description ? { description: normalized.description } : {}),
  });

  if (!sourceIntentResult.success) {
    return {
      success: false,
      error: sourceIntentResult.error,
      ...(sourceIntentResult.requireAuth ? { data: { requiresAuth: true } } : {}),
    };
  }

  const matchResult = await createManualPartnerMatch({
    sourceIntentId: sourceIntentResult.intent.id,
    targetIntentId: candidateIntentId,
    initiatedByUserId: params.userId,
    mode: params.mode,
  });

  if (!matchResult.success || !matchResult.matchId) {
    return { success: false, error: matchResult.error || '发起搭子对接失败，请稍后再试' };
  }

  const candidateTitle = toTextValue(params.payload.candidateTitle) || '这位搭子';
  const actionMessage = params.mode === 'group_up'
    ? (matchResult.existing
      ? `你和${candidateTitle}的组局邀约还在处理中，我先带你去消息中心看看。`
      : `已经帮你把“能不能一起组局”的邀约发过去了，先去消息中心看看这条进展。`)
    : (matchResult.existing
      ? `你和${candidateTitle}已经有一条待处理的搭子邀约了，我先带你去消息中心看看。`
      : `已经帮你把“和${candidateTitle}搭一下”的邀约发过去了，先去消息中心看看这条进展。`);

  return {
    success: true,
    data: {
      matchId: matchResult.matchId,
      locationName: normalized.locationHint,
      type: normalized.activityType,
      message: actionMessage,
      navigationIntent: 'open_message_center',
      navigationPayload: {
        matchId: matchResult.matchId,
      },
    },
  };
}

async function handleSearchPartners(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  const normalized = normalizePartnerSearchPayload(payload);

  if (normalized.activityType === 'sports' && !normalized.sportType) {
    return { success: false, error: '还差一个运动类型，补完我就能开始搜索' };
  }

  if (!normalized.locationHint) {
    return { success: false, error: '还差一个方便区域，填完我就能帮你开始搜索' };
  }

  const searchPayload = {
    rawInput: normalized.rawInput,
    activityType: normalized.activityType,
    ...(normalized.sportType ? { sportType: normalized.sportType } : {}),
    location: normalized.locationHint,
    ...(normalized.timeRange ? { timeRange: normalized.timeRange } : {}),
    ...(normalized.description ? { description: normalized.description } : {}),
    ...(normalized.preferredGender ? { preferredGender: normalized.preferredGender } : {}),
    ...(normalized.preferredAgeRange ? { preferredAgeRange: normalized.preferredAgeRange } : {}),
  };

  const searchDescription = normalized.description
    || normalized.rawInput
    || `${normalized.locationHint}${normalized.activityType}搭子`;

  const searchResult = await searchPartnerCandidates(userId, {
    rawInput: normalized.rawInput,
    activityType: normalized.activityType,
    ...(normalized.sportType ? { sportType: normalized.sportType } : {}),
    locationHint: normalized.locationHint,
    ...(normalized.timePreference ? { timePreference: normalized.timePreference } : {}),
    description: searchDescription,
    ...(normalized.preferredGender ? { preferredGender: normalized.preferredGender } : {}),
    ...(normalized.preferredAgeRange ? { preferredAgeRange: normalized.preferredAgeRange } : {}),
  });

  if (!searchResult.success) {
    return { success: false, error: searchResult.error };
  }

  const partnerSearchResults = {
    title: buildPartnerSearchResultsTitle({
      scenarioType: searchResult.searchSummary.scenarioType,
      hasResults: searchResult.items.length > 0,
    }),
    searchSummary: {
      ...searchResult.searchSummary,
      count: searchResult.total,
    },
    primaryAction: {
      label: searchResult.nextAction.label,
      action: searchResult.nextAction.type,
      params: searchPayload,
    },
    ...(searchResult.secondaryAction ? {
      secondaryAction: {
        label: searchResult.secondaryAction.label,
        action: searchResult.secondaryAction.type,
        params: searchPayload,
      },
    } : {}),
    items: searchResult.items.map((item) => ({
      id: item.intentId,
      partnerIntentId: item.intentId,
        candidateUserId: item.userId,
        title: item.nickname,
        avatarUrl: item.avatarUrl,
      type: item.typeName,
      locationName: item.locationHint,
      locationHint: item.locationHint,
      timePreference: item.timePreference || '时间待沟通',
      summary: item.summary,
      matchReason: item.matchReason,
      score: item.score,
      tags: item.tags,
      actions: buildPartnerSearchCardActions({
        userId,
        partnerIntentId: item.intentId,
        candidateUserId: item.userId,
        candidateTitle: item.nickname,
        activityType: normalized.activityType,
        ...(normalized.sportType ? { sportType: normalized.sportType } : {}),
        scenarioType: searchResult.searchSummary.scenarioType,
        searchPayload,
      }),
    })),
  };

  return {
    success: true,
    data: {
      activityType: normalized.activityType,
      type: normalized.activityType,
      locationName: normalized.locationHint,
      searchPayload,
      partnerSearchResults,
      message: buildPartnerSearchResultMessage({
        scenarioType: searchResult.searchSummary.scenarioType,
        hasResults: searchResult.items.length > 0,
        locationHint: normalized.locationHint,
        targetLabel: getPartnerSearchTargetLabel(normalized.activityType, normalized.sportType),
      }),
    },
  };
}

async function handleOptInPartnerPool(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }

  const location = resolveActionLocation(payload);
  if (!location) {
    return { success: false, error: '需要先获取你的位置，才能继续替你留意附近搭子' };
  }

  const normalized = normalizePartnerSearchPayload(payload);
  if (normalized.activityType === 'sports' && !normalized.sportType) {
    return { success: false, error: '还差一个运动类型，补完我就能继续替你留意' };
  }
  if (!normalized.locationHint) {
    return { success: false, error: '还差一个方便区域，填完我就能继续替你留意' };
  }

  const partnerResult = await createPartnerIntent(userId, location, {
    rawInput: normalized.rawInput,
    activityType: normalized.activityType,
    ...(normalized.sportType ? { sportType: normalized.sportType } : {}),
    locationHint: normalized.locationHint,
    timePreference: normalized.timePreference,
    tags: [],
    ...(normalized.description ? { poiPreference: normalized.description } : {}),
  });

  if (!partnerResult.success) {
    return { success: false, error: partnerResult.error };
  }

  return {
    success: true,
    data: {
      activityType: normalized.activityType,
      type: normalized.activityType,
      locationName: normalized.locationHint,
      intentId: partnerResult.intentId,
      matchFound: partnerResult.matchFound,
      matchId: partnerResult.matchId,
      message: partnerResult.message,
    },
  };
}

async function handleConnectPartner(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }
  return createPartnerMatchFromSelectedCandidate({
    payload,
    userId,
    mode: 'connect',
  });
}

async function handleRequestPartnerGroupUp(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }
  return createPartnerMatchFromSelectedCandidate({
    payload,
    userId,
    mode: 'group_up',
  });
}

async function handleConfirmMatch(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }

  const matchId = toTextValue(payload.matchId);
  if (!matchId) {
    return { success: false, error: '缺少匹配 ID' };
  }

  const result = await confirmMatch(matchId, userId);
  if (!result.success) {
    return { success: false, error: result.error || '确认失败，请稍后再试' };
  }

  return {
    success: true,
    data: {
      matchId,
      activityId: result.activityId,
      discussionEntry: result.discussionEntry,
      message: '活动已创建',
      // 用于前端直接跳转
      navigationIntent: 'open_discussion',
      navigationPayload: {
        activityId: result.activityId,
        title: result.discussionEntry?.title,
        entry: 'match_confirmed',
      },
    },
  };
}

async function handleCancelMatch(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }

  const matchId = toTextValue(payload.matchId);
  if (!matchId) {
    return { success: false, error: '缺少匹配 ID' };
  }

  const result = await cancelMatch(matchId, userId);
  if (!result.success) {
    return { success: false, error: result.error || '取消失败，请稍后再试' };
  }

  return {
    success: true,
    data: {
      matchId,
      message: '本次匹配已取消',
    },
  };
}

async function handleSelectPreference(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<StructuredActionResult> {
  const questionType = toTextValue(payload.questionType);
  const selectedValue = toTextValue(payload.selectedValue) || toTextValue(payload.value);
  const selectedLabel = toTextValue(payload.selectedLabel) || toTextValue(payload.label);

  if (questionType === 'location') {
    const locationName = toTextValue(payload.locationName)
      || toTextValue(payload.location)
      || selectedLabel
      || selectedValue;
    const activityType = normalizeExploreActivityType(toTextValue(payload.activityType));
    const presetLocation = resolvePresetLocation(locationName);
    if (presetLocation) {
      if (activityType) {
        return handleExploreNearby({
          ...payload,
          locationName: presetLocation.name,
          lat: presetLocation.lat,
          lng: presetLocation.lng,
          type: activityType,
          semanticQuery: buildExploreSemanticQueryFromSelection(presetLocation.name, activityType),
        }, userId);
      }

      return {
        success: true,
        data: buildTypeAskPreferencePayload({
          locationName: presetLocation.name,
          lat: presetLocation.lat,
          lng: presetLocation.lng,
        }),
      };
    }

    if (locationName) {
      if (activityType) {
        return handleExploreNearby({
          ...payload,
          locationName,
          type: activityType,
          semanticQuery: buildExploreSemanticQueryFromSelection(locationName, activityType),
        }, userId);
      }

      return {
        success: true,
        data: buildTypeAskPreferencePayload({
          locationName,
        }),
      };
    }
  }

  if (questionType === 'type') {
    const locationName = toTextValue(payload.locationName) || toTextValue(payload.location);
    const resolvedLocation = resolveActionLocation(payload) || resolvePresetLocation(locationName);
    const normalizedLocationName = locationName || '附近';
    const activityType = normalizeExploreActivityType(
      toTextValue(payload.activityType) || selectedValue || selectedLabel
    );

    if (resolvedLocation) {
      return handleExploreNearby({
        ...payload,
        locationName: normalizedLocationName,
        lat: resolvedLocation.lat,
        lng: resolvedLocation.lng,
        ...(activityType ? { type: activityType } : {}),
        semanticQuery: buildExploreSemanticQueryFromSelection(normalizedLocationName, activityType),
      }, userId);
    }

    if (locationName) {
      return handleExploreNearby({
        ...payload,
        locationName: normalizedLocationName,
        ...(activityType ? { type: activityType } : {}),
        semanticQuery: buildExploreSemanticQueryFromSelection(normalizedLocationName, activityType),
      }, userId);
    }
  }

  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: selectedLabel || selectedValue || '继续',
  };
}

async function handleSkipPreference(
  _payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  // 跳过偏好，用默认文本继续
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: '随便，你推荐吧',
  };
}

async function handleRetry(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  const originalText = toTextValue(payload.originalText);
  
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: originalText || '重试',
  };
}

async function handleCancel(
  _payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  return {
    success: true,
    data: { action: 'cancelled' },
  };
}

async function handleQuickPrompt(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<StructuredActionResult> {
  const prompt = toTextValue(payload.prompt);
  
  if (!prompt) {
    return { success: false, error: '缺少提示词' };
  }
  
  // 快捷提示词直接作为用户输入
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: prompt,
  };
}

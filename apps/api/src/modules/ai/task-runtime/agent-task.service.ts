import {
  activities,
  agentTaskEvents,
  agentTasks,
  and,
  db,
  desc,
  eq,
  intentMatches,
  inArray,
  or,
  partnerIntents,
  type AgentTask,
  type AgentTaskEvent,
  type NewAgentTask,
} from '@xu/db';
import type { GenUIBlock, GenUIRequest } from '@xu/genui-contract';

type AgentTaskType = AgentTask['taskType'];
type AgentTaskStage = AgentTask['currentStage'];
type AgentTaskStatus = AgentTask['status'];
type AgentTaskEventType = AgentTaskEvent['eventType'];

export interface CurrentAgentTaskAction {
  kind: 'structured_action' | 'navigate' | 'switch_tab';
  label: string;
  action?: string;
  payload?: Record<string, unknown>;
  source?: string;
  originalText?: string;
  url?: string;
}

export interface CurrentAgentTaskSnapshot {
  id: string;
  taskType: AgentTaskType;
  taskTypeLabel: string;
  currentStage: AgentTaskStage;
  stageLabel: string;
  status: AgentTaskStatus;
  goalText: string;
  headline: string;
  summary: string;
  updatedAt: string;
  activityId?: string;
  activityTitle?: string;
  primaryAction?: CurrentAgentTaskAction;
  secondaryAction?: CurrentAgentTaskAction;
}

export type CurrentTaskHomeState = 'H0' | 'H1' | 'H2' | 'H3' | 'H4';

export interface CurrentTaskHomeStateSnapshot {
  homeState: CurrentTaskHomeState;
  primaryTaskId: string | null;
}

interface TaskLocationContext {
  name: string;
  lat?: number;
  lng?: number;
}

export interface JoinTaskContext {
  location?: TaskLocationContext;
  activityType?: string;
  timePreference?: string;
  vibe?: string[];
  budget?: string;
  semanticQuery?: string;
  selectedActivityId?: string;
  activityMode?: 'review' | 'rebook' | 'kickoff';
  activityId?: string;
  entry?: string;
  source?: string;
}

export interface PartnerTaskContext {
  activityType?: string;
  scenarioType?: string;
  locationHint?: string;
  destinationText?: string;
  timePreference?: string;
  timeText?: string;
  source?: string;
  entry?: string;
}

export interface CreateTaskContext {
  title?: string;
  type?: string;
  locationName?: string;
  startAt?: string;
  maxParticipants?: number;
  source?: string;
  entry?: string;
  activityId?: string;
}

export interface OpenJoinTaskSnapshot {
  id: string;
  status: AgentTaskStatus;
  currentStage: AgentTaskStage;
  goalText: string;
  activityId?: string;
  context: JoinTaskContext;
}

export interface OpenPartnerTaskSnapshot {
  id: string;
  status: AgentTaskStatus;
  currentStage: AgentTaskStage;
  goalText: string;
  partnerIntentId?: string;
  intentMatchId?: string;
  context: PartnerTaskContext;
}

export interface OpenCreateTaskSnapshot {
  id: string;
  status: AgentTaskStatus;
  currentStage: AgentTaskStage;
  goalText: string;
  activityId?: string;
  context: CreateTaskContext;
}

const OPEN_TASK_STATUSES: AgentTaskStatus[] = [
  'active',
  'waiting_auth',
  'waiting_async_result',
];

const TERMINAL_TASK_STATUSES: AgentTaskStatus[] = [
  'completed',
  'cancelled',
  'expired',
];

const KNOWN_LOCATION_CENTERS = [
  { name: '南坪万达', lat: 29.53012, lng: 106.57221 },
  { name: '观音桥', lat: 29.58567, lng: 106.52988 },
  { name: '解放碑', lat: 29.55792, lng: 106.57709 },
  { name: '南坪', lat: 29.52589, lng: 106.57024 },
  { name: '江北嘴', lat: 29.58263, lng: 106.56653 },
  { name: '杨家坪', lat: 29.52345, lng: 106.51879 },
  { name: '大坪', lat: 29.54191, lng: 106.51934 },
  { name: '沙坪坝', lat: 29.54142, lng: 106.45785 },
] as const;

const TASK_STAGE_ORDER: Record<AgentTaskType, AgentTaskStage[]> = {
  join_activity: [
    'intent_captured',
    'explore',
    'action_selected',
    'auth_gate',
    'joined',
    'discussion',
    'post_activity',
    'done',
  ],
  find_partner: [
    'intent_captured',
    'preference_collecting',
    'auth_gate',
    'intent_posted',
    'awaiting_match',
    'match_ready',
    'activity_created',
    'done',
  ],
  create_activity: [
    'intent_captured',
    'draft_collecting',
    'auth_gate',
    'draft_ready',
    'published',
    'done',
  ],
};

function getStageRank(taskType: AgentTaskType, stage: AgentTaskStage): number {
  const order = TASK_STAGE_ORDER[taskType];
  const index = order.indexOf(stage);
  return index >= 0 ? index : -1;
}

function isTerminalTaskStatus(status: AgentTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readTextValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());

  return items.length > 0 ? items : undefined;
}

function findKnownLocationCenter(text: string): TaskLocationContext | undefined {
  const normalized = text.trim();
  if (!normalized) {
    return undefined;
  }

  const matched = KNOWN_LOCATION_CENTERS.find((location) => normalized.includes(location.name));
  return matched ? { ...matched } : undefined;
}

function inferActivityTypeFromText(text: string): string | undefined {
  if (/(火锅|约饭|吃饭|烧烤|咖啡|奶茶|清淡|不吃辣)/.test(text)) {
    return 'food';
  }

  if (/(羽毛球|篮球|跑步|徒步|运动|打球)/.test(text)) {
    return 'sports';
  }

  if (/(桌游|剧本杀|狼人杀|麻将)/.test(text)) {
    return 'boardgame';
  }

  if (/(唱歌|KTV|电影|livehouse|酒吧)/i.test(text)) {
    return 'entertainment';
  }

  return undefined;
}

function inferTimePreferenceFromText(text: string): string | undefined {
  const normalized = text.trim();
  if (!normalized) {
    return undefined;
  }

  if (/(今晚|今夜)/.test(normalized)) {
    return '今晚';
  }

  if (/明天/.test(normalized)) {
    return '明天';
  }

  if (/周末/.test(normalized)) {
    return '周末';
  }

  const hourMatch = normalized.match(/([0-2]?\d)点(?:后|左右)?/);
  if (hourMatch?.[1]) {
    return `${hourMatch[1]}点${normalized.includes('后') ? '后' : ''}`;
  }

  return undefined;
}

function inferVibeFromText(text: string): string[] | undefined {
  const vibes = new Set<string>();

  if (/(别太闹|安静|清净|不吵|轻松)/.test(text)) {
    vibes.add('quiet');
  }

  if (/(热闹|high|嗨一点|带劲)/i.test(text)) {
    vibes.add('lively');
  }

  return vibes.size > 0 ? Array.from(vibes) : undefined;
}

function inferBudgetFromText(text: string): string | undefined {
  if (/\bAA\b/i.test(text) || /aa制/i.test(text)) {
    return 'AA';
  }

  const match = text.match(/(\d{2,4})\s*元/);
  if (match?.[1]) {
    return `${match[1]}元`;
  }

  return undefined;
}

function mergeStringArrays(current?: string[], patch?: string[]): string[] | undefined {
  const values = [...(current ?? []), ...(patch ?? [])];
  if (values.length === 0) {
    return undefined;
  }

  return Array.from(new Set(values));
}

function toSlotSummaryRecord<T extends object>(value: T | undefined): Record<string, unknown> | undefined {
  if (!value || Object.keys(value).length === 0) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getGoalTextFromRequest(request: GenUIRequest): string {
  if (request.input.type === 'text') {
    return request.input.text.trim();
  }

  if (typeof request.input.displayText === 'string' && request.input.displayText.trim()) {
    return request.input.displayText.trim();
  }

  const params = isRecord(request.input.params) ? request.input.params : null;
  const candidates = params
    ? [params.title, params.location, params.locationHint, params.value, params.activityType, params.type]
    : [];

  for (const value of candidates) {
    const text = readTextValue(value);
    if (text) {
      return text;
    }
  }

  return request.input.action;
}

function buildSlotSummaryFromRequest(request: GenUIRequest): Record<string, unknown> | undefined {
  const slotSummary: Record<string, unknown> = {};

  if (typeof request.context?.lat === 'number') {
    slotSummary.lat = request.context.lat;
  }
  if (typeof request.context?.lng === 'number') {
    slotSummary.lng = request.context.lng;
  }
  if (typeof request.context?.entry === 'string' && request.context.entry.trim()) {
    slotSummary.entry = request.context.entry.trim();
  }
  if (typeof request.context?.activityId === 'string' && request.context.activityId.trim()) {
    slotSummary.activityId = request.context.activityId.trim();
  }
  if (
    (request.context?.activityMode === 'review'
      || request.context?.activityMode === 'rebook'
      || request.context?.activityMode === 'kickoff')
  ) {
    slotSummary.activityMode = request.context.activityMode;
  }
  if (request.input.type === 'action' && isRecord(request.input.params)) {
    if (typeof request.input.params.activityId === 'string') {
      slotSummary.activityId = request.input.params.activityId;
    }
    if (typeof request.input.params.source === 'string') {
      slotSummary.source = request.input.params.source;
    }
  }

  return Object.keys(slotSummary).length > 0 ? slotSummary : undefined;
}

function buildJoinTaskContextFromRequest(request: GenUIRequest): JoinTaskContext | undefined {
  const context: JoinTaskContext = {};

  const locationFromText = request.input.type === 'text'
    ? findKnownLocationCenter(request.input.text)
    : undefined;
  if (locationFromText) {
    context.location = locationFromText;
  }

  if (typeof request.context?.lat === 'number' || typeof request.context?.lng === 'number') {
    context.location = {
      ...(context.location ?? { name: '附近' }),
      ...(typeof request.context?.lat === 'number' ? { lat: request.context.lat } : {}),
      ...(typeof request.context?.lng === 'number' ? { lng: request.context.lng } : {}),
    };
  }

  if (typeof request.context?.entry === 'string' && request.context.entry.trim()) {
    context.entry = request.context.entry.trim();
  }
  if (
    request.context?.activityMode === 'review'
    || request.context?.activityMode === 'rebook'
    || request.context?.activityMode === 'kickoff'
  ) {
    context.activityMode = request.context.activityMode;
  }
  if (typeof request.context?.activityId === 'string' && request.context.activityId.trim()) {
    context.activityId = request.context.activityId.trim();
  }

  if (request.input.type === 'text') {
    const normalizedText = request.input.text.trim();
    if (normalizedText) {
      context.semanticQuery = normalizedText;
    }

    const activityType = inferActivityTypeFromText(normalizedText);
    if (activityType) {
      context.activityType = activityType;
    }

    const timePreference = inferTimePreferenceFromText(normalizedText);
    if (timePreference) {
      context.timePreference = timePreference;
    }

    const vibe = inferVibeFromText(normalizedText);
    if (vibe) {
      context.vibe = vibe;
    }

    const budget = inferBudgetFromText(normalizedText);
    if (budget) {
      context.budget = budget;
    }
  }

  if (request.input.type === 'action' && isRecord(request.input.params)) {
    const params = request.input.params;
    const locationName = readTextValue(params.locationName);
    const lat = readNumberValue(params.lat);
    const lng = readNumberValue(params.lng);

    if (locationName || lat !== undefined || lng !== undefined) {
      context.location = {
        ...(context.location ?? { name: locationName ?? '附近' }),
        ...(locationName ? { name: locationName } : {}),
        ...(lat !== undefined ? { lat } : {}),
        ...(lng !== undefined ? { lng } : {}),
      };
    }

    const activityType = readTextValue(params.type) ?? readTextValue(params.activityType);
    if (activityType) {
      context.activityType = activityType;
    }

    const semanticQuery = readTextValue(params.semanticQuery);
    if (semanticQuery) {
      context.semanticQuery = semanticQuery;
    }

    const activityId = readTextValue(params.activityId);
    if (activityId) {
      context.selectedActivityId = activityId;
      context.activityId = activityId;
    }

    const source = readTextValue(params.source);
    if (source) {
      context.source = source;
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

function buildPartnerTaskContextFromRequest(request: GenUIRequest): PartnerTaskContext | undefined {
  const context: PartnerTaskContext = {};

  if (typeof request.context?.entry === 'string' && request.context.entry.trim()) {
    context.entry = request.context.entry.trim();
  }

  if (request.input.type === 'text') {
    const normalizedText = request.input.text.trim();
    const activityType = inferActivityTypeFromText(normalizedText);
    if (activityType) {
      context.activityType = activityType;
    }

    const location = findKnownLocationCenter(normalizedText);
    if (location) {
      context.locationHint = location.name;
    }

    const timePreference = inferTimePreferenceFromText(normalizedText);
    if (timePreference) {
      context.timePreference = timePreference;
    }
  }

  if (request.input.type === 'action' && isRecord(request.input.params)) {
    const params = request.input.params;
    const activityType = readTextValue(params.type) ?? readTextValue(params.activityType);
    if (activityType) {
      context.activityType = activityType;
    }

    const locationHint = readTextValue(params.locationHint) ?? readTextValue(params.locationName);
    if (locationHint) {
      context.locationHint = locationHint;
    }

    const timePreference = readTextValue(params.timePreference);
    if (timePreference) {
      context.timePreference = timePreference;
    }

    const source = readTextValue(params.source);
    if (source) {
      context.source = source;
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

function buildCreateTaskContextFromRequest(request: GenUIRequest): CreateTaskContext | undefined {
  const context: CreateTaskContext = {};

  if (typeof request.context?.entry === 'string' && request.context.entry.trim()) {
    context.entry = request.context.entry.trim();
  }
  if (typeof request.context?.activityId === 'string' && request.context.activityId.trim()) {
    context.activityId = request.context.activityId.trim();
  }

  if (request.input.type === 'action' && isRecord(request.input.params)) {
    const params = request.input.params;
    const title = readTextValue(params.title);
    const type = readTextValue(params.type);
    const locationName = readTextValue(params.locationName);
    const startAt = readTextValue(params.startAt);
    const activityId = readTextValue(params.activityId);
    const source = readTextValue(params.source);
    const maxParticipants = readNumberValue(params.maxParticipants);

    if (title) {
      context.title = title;
    }
    if (type) {
      context.type = type;
    }
    if (locationName) {
      context.locationName = locationName;
    }
    if (startAt) {
      context.startAt = startAt;
    }
    if (activityId) {
      context.activityId = activityId;
    }
    if (source) {
      context.source = source;
    }
    if (maxParticipants !== undefined) {
      context.maxParticipants = maxParticipants;
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

function mergeJoinTaskContext(
  existing: JoinTaskContext | undefined,
  patch: JoinTaskContext | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !patch) {
    return undefined;
  }

  const merged: JoinTaskContext = {
    ...(existing ?? {}),
    ...(patch ?? {}),
    location: patch?.location
      ? {
          ...(existing?.location ?? {}),
          ...patch.location,
        }
      : existing?.location,
    vibe: mergeStringArrays(existing?.vibe, patch?.vibe),
    selectedActivityId: patch?.selectedActivityId ?? existing?.selectedActivityId,
    activityId: patch?.activityId ?? existing?.activityId,
  };

  return toSlotSummaryRecord(merged);
}

function mergePartnerTaskContext(
  existing: PartnerTaskContext | undefined,
  patch: PartnerTaskContext | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !patch) {
    return undefined;
  }

  const merged: PartnerTaskContext = {
    ...(existing ?? {}),
    ...(patch ?? {}),
  };

  return toSlotSummaryRecord(merged);
}

function mergeCreateTaskContext(
  existing: CreateTaskContext | undefined,
  patch: CreateTaskContext | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !patch) {
    return undefined;
  }

  const merged: CreateTaskContext = {
    ...(existing ?? {}),
    ...(patch ?? {}),
  };

  return toSlotSummaryRecord(merged);
}

export function readJoinTaskContext(task: Pick<AgentTask, 'slotSummary' | 'activityId'>): JoinTaskContext {
  const slotSummary = isRecord(task.slotSummary) ? task.slotSummary : null;
  if (!slotSummary) {
    return task.activityId ? { activityId: task.activityId } : {};
  }

  const locationName = readTextValue(slotSummary.locationName)
    ?? (isRecord(slotSummary.location) ? readTextValue(slotSummary.location.name) : null);
  const locationLat = readNumberValue(slotSummary.lat)
    ?? (isRecord(slotSummary.location) ? readNumberValue(slotSummary.location.lat) : undefined);
  const locationLng = readNumberValue(slotSummary.lng)
    ?? (isRecord(slotSummary.location) ? readNumberValue(slotSummary.location.lng) : undefined);

  const context: JoinTaskContext = {
    ...(locationName || locationLat !== undefined || locationLng !== undefined
      ? {
          location: {
            name: locationName ?? '附近',
            ...(locationLat !== undefined ? { lat: locationLat } : {}),
            ...(locationLng !== undefined ? { lng: locationLng } : {}),
          },
        }
      : {}),
    ...(readTextValue(slotSummary.activityType) ? { activityType: readTextValue(slotSummary.activityType) ?? undefined } : {}),
    ...(readTextValue(slotSummary.timePreference) ? { timePreference: readTextValue(slotSummary.timePreference) ?? undefined } : {}),
    ...(readTextValue(slotSummary.budget) ? { budget: readTextValue(slotSummary.budget) ?? undefined } : {}),
    ...(readTextValue(slotSummary.semanticQuery) ? { semanticQuery: readTextValue(slotSummary.semanticQuery) ?? undefined } : {}),
    ...(readTextValue(slotSummary.selectedActivityId) ? { selectedActivityId: readTextValue(slotSummary.selectedActivityId) ?? undefined } : {}),
    ...(readTextValue(slotSummary.activityId) ? { activityId: readTextValue(slotSummary.activityId) ?? undefined } : {}),
    ...(readTextValue(slotSummary.entry) ? { entry: readTextValue(slotSummary.entry) ?? undefined } : {}),
    ...(readTextValue(slotSummary.source) ? { source: readTextValue(slotSummary.source) ?? undefined } : {}),
    ...(readStringArray(slotSummary.vibe) ? { vibe: readStringArray(slotSummary.vibe) } : {}),
    ...(slotSummary.activityMode === 'review'
      || slotSummary.activityMode === 'rebook'
      || slotSummary.activityMode === 'kickoff'
      ? { activityMode: slotSummary.activityMode }
      : {}),
  };

  if (!context.activityId && task.activityId) {
    context.activityId = task.activityId;
  }

  return context;
}

export function readPartnerTaskContext(task: Pick<AgentTask, 'slotSummary'>): PartnerTaskContext {
  const slotSummary = isRecord(task.slotSummary) ? task.slotSummary : null;
  if (!slotSummary) {
    return {};
  }

  return {
    ...(readTextValue(slotSummary.activityType) ? { activityType: readTextValue(slotSummary.activityType) ?? undefined } : {}),
    ...(readTextValue(slotSummary.locationHint) ? { locationHint: readTextValue(slotSummary.locationHint) ?? undefined } : {}),
    ...(readTextValue(slotSummary.timePreference) ? { timePreference: readTextValue(slotSummary.timePreference) ?? undefined } : {}),
    ...(readTextValue(slotSummary.source) ? { source: readTextValue(slotSummary.source) ?? undefined } : {}),
    ...(readTextValue(slotSummary.entry) ? { entry: readTextValue(slotSummary.entry) ?? undefined } : {}),
  };
}

export function readCreateTaskContext(task: Pick<AgentTask, 'slotSummary' | 'activityId'>): CreateTaskContext {
  const slotSummary = isRecord(task.slotSummary) ? task.slotSummary : null;
  const context: CreateTaskContext = slotSummary
    ? {
        ...(readTextValue(slotSummary.title) ? { title: readTextValue(slotSummary.title) ?? undefined } : {}),
        ...(readTextValue(slotSummary.type) ? { type: readTextValue(slotSummary.type) ?? undefined } : {}),
        ...(readTextValue(slotSummary.locationName) ? { locationName: readTextValue(slotSummary.locationName) ?? undefined } : {}),
        ...(readTextValue(slotSummary.startAt) ? { startAt: readTextValue(slotSummary.startAt) ?? undefined } : {}),
        ...(readTextValue(slotSummary.source) ? { source: readTextValue(slotSummary.source) ?? undefined } : {}),
        ...(readTextValue(slotSummary.entry) ? { entry: readTextValue(slotSummary.entry) ?? undefined } : {}),
        ...(readTextValue(slotSummary.activityId) ? { activityId: readTextValue(slotSummary.activityId) ?? undefined } : {}),
        ...(readNumberValue(slotSummary.maxParticipants) !== undefined
          ? { maxParticipants: readNumberValue(slotSummary.maxParticipants) }
          : {}),
      }
    : {};

  if (!context.activityId && task.activityId) {
    context.activityId = task.activityId;
  }

  return context;
}

function extractExploreSignal(blocks: GenUIBlock[]): boolean {
  return blocks.some((block) => {
    if (block.type !== 'list' || !Array.isArray(block.items)) {
      return false;
    }

    return block.items.some((item) => isRecord(item) && typeof item.activityId === 'string');
  });
}

function extractJoinActivityIdFromBlocks(blocks: GenUIBlock[]): string | null {
  for (const block of blocks) {
    if (block.type !== 'alert' || !isRecord(block.meta)) {
      continue;
    }

    const navigationPayload = isRecord(block.meta.navigationPayload)
      ? block.meta.navigationPayload
      : null;

    if (navigationPayload && typeof navigationPayload.activityId === 'string') {
      return navigationPayload.activityId;
    }
  }

  return null;
}

function extractAuthRequirementForActions(
  blocks: GenUIBlock[],
  actions: string[],
): {
  mode: 'login' | 'bind_phone';
  action: string;
  pendingAction?: Record<string, unknown>;
} | null {
  for (const block of blocks) {
    if (block.type !== 'alert' || !isRecord(block.meta)) {
      continue;
    }

    const authRequired = isRecord(block.meta.authRequired) ? block.meta.authRequired : null;
    if (!authRequired) {
      continue;
    }

    const mode = authRequired.mode === 'bind_phone' ? 'bind_phone' : 'login';
    const pendingAction = isRecord(authRequired.pendingAction) ? authRequired.pendingAction : undefined;
    const actionName = readTextValue(pendingAction?.action);
    if (!actionName || !actions.includes(actionName)) {
      continue;
    }

    return {
      mode,
      action: actionName,
      ...(pendingAction ? { pendingAction } : {}),
    };
  }

  return null;
}

function extractJoinAuthRequirement(blocks: GenUIBlock[]) {
  return extractAuthRequirementForActions(blocks, ['join_activity']);
}

function extractPartnerAuthRequirement(blocks: GenUIBlock[]) {
  return extractAuthRequirementForActions(blocks, [
    'connect_partner',
    'request_partner_group_up',
    'opt_in_partner_pool',
    'confirm_match',
    'cancel_match',
  ]);
}

function extractCreateAuthRequirement(blocks: GenUIBlock[]) {
  return extractAuthRequirementForActions(blocks, [
    'create_activity',
    'edit_draft',
    'save_draft_settings',
    'publish_draft',
    'confirm_publish',
  ]);
}

function extractJoinActivityIdFromRequest(request: GenUIRequest): string | null {
  if (request.input.type === 'action' && isRecord(request.input.params)) {
    const activityId = readTextValue(request.input.params.activityId);
    if (activityId) {
      return activityId;
    }
  }

  if (typeof request.context?.activityId === 'string' && request.context.activityId.trim()) {
    return request.context.activityId.trim();
  }

  return null;
}

function extractCreateActivityIdFromRequest(request: GenUIRequest): string | null {
  if (request.input.type === 'action' && isRecord(request.input.params)) {
    const activityId = readTextValue(request.input.params.activityId);
    if (activityId) {
      return activityId;
    }
  }

  if (typeof request.context?.activityId === 'string' && request.context.activityId.trim()) {
    return request.context.activityId.trim();
  }

  return null;
}

function hasPartnerIntentFormBlock(blocks: GenUIBlock[]): boolean {
  return blocks.some((block) => block.type === 'form' && block.dedupeKey === 'partner_intent_form');
}

function hasPartnerSearchResultsBlock(blocks: GenUIBlock[]): boolean {
  return blocks.some((block) => (
    block.type === 'list'
    && isRecord(block.meta)
    && block.meta.listKind === 'partner_search_results'
  ));
}

function hasDraftSettingsFormBlock(blocks: GenUIBlock[]): boolean {
  return blocks.some((block) => block.type === 'form' && block.dedupeKey === 'draft_settings_form');
}

function hasDraftReadyBlock(blocks: GenUIBlock[]): boolean {
  return blocks.some((block) => block.type === 'entity-card' && block.dedupeKey === 'activity_draft');
}

function extractCreateActivityIdFromBlocks(blocks: GenUIBlock[]): string | null {
  for (const block of blocks) {
    if (block.type !== 'entity-card' || block.dedupeKey !== 'activity_draft' || !isRecord(block.fields)) {
      continue;
    }

    const activityId = readTextValue(block.fields.activityId);
    if (activityId) {
      return activityId;
    }
  }

  return null;
}

function buildCreateActivityGoalText(params: {
  title?: string | null;
  locationName?: string | null;
}): string {
  const title = params.title?.trim();
  const locationName = params.locationName?.trim();

  if (title && locationName) {
    return `帮我在${locationName}发起「${title}」`;
  }

  if (title) {
    return `帮我把「${title}」这场局发出来`;
  }

  if (locationName) {
    return `帮我在${locationName}组一个局`;
  }

  return '帮我发起一个新的活动';
}

function getTaskTypeLabel(taskType: AgentTaskType): string {
  switch (taskType) {
    case 'join_activity':
      return '找局报名';
    case 'find_partner':
      return '找搭子';
    case 'create_activity':
      return '自己组局';
  }
}

function getStageLabel(stage: AgentTaskStage): string {
  switch (stage) {
    case 'intent_captured':
      return '已接手';
    case 'explore':
      return '探索中';
    case 'preference_collecting':
      return '补偏好';
    case 'draft_collecting':
      return '做草稿';
    case 'action_selected':
      return '已选定';
    case 'auth_gate':
      return '待验证';
    case 'draft_ready':
      return '草稿就绪';
    case 'joined':
      return '已报名';
    case 'intent_posted':
      return '已发意向';
    case 'awaiting_match':
      return '等匹配';
    case 'match_ready':
      return '待确认';
    case 'activity_created':
      return '已成局';
    case 'published':
      return '已发布';
    case 'discussion':
      return '讨论中';
    case 'post_activity':
      return '活动后';
    case 'done':
      return '已完成';
  }
}

function buildPendingStructuredActionSnapshot(
  task: AgentTask,
  label: string,
): CurrentAgentTaskAction | undefined {
  const pendingAction = isRecord(task.pendingAction) ? task.pendingAction : null;
  if (!pendingAction) {
    return undefined;
  }

  const action = readTextValue(pendingAction.action);
  const payload = isRecord(pendingAction.payload) ? pendingAction.payload : {};
  if (!action) {
    return undefined;
  }

  return {
    kind: 'structured_action',
    label,
    action,
    payload,
    ...(readTextValue(pendingAction.source) ? { source: readTextValue(pendingAction.source) ?? undefined } : {}),
    ...(readTextValue(pendingAction.originalText) ? { originalText: readTextValue(pendingAction.originalText) ?? undefined } : {}),
  };
}

function buildJoinTaskSummary(task: AgentTask, activityTitle?: string): string {
  switch (task.currentStage) {
    case 'explore':
      return '还在帮你筛附近更合适的局，你可以继续看看结果，也可以直接补一句想换的条件。';
    case 'action_selected':
      return activityTitle
        ? `「${activityTitle}」已经选中了，现在只差把报名真正做完。`
        : '目标活动已经选中了，现在只差把报名真正做完。';
    case 'auth_gate':
      return '差一步登录或绑定手机号，恢复后我就接着帮你推进。';
    case 'joined':
      return activityTitle
        ? `「${activityTitle}」已经报名成功，接下来把你送进讨论区。`
        : '报名已经成功，接下来把你送进讨论区。';
    case 'discussion':
      return '这件事已经进入讨论协作阶段，后面还会继续承接活动结果。';
    case 'post_activity':
      return buildPostActivityTaskSummary(task, activityTitle);
    default:
      return '这条找局任务还在持续推进，没有断成几个孤立页面。';
  }
}

function buildPartnerTaskSummary(task: AgentTask): string {
  switch (task.currentStage) {
    case 'preference_collecting':
      return '还差一点你想找的人和活动片区偏好，补完我就能开始替你匹配。';
    case 'auth_gate':
      return '差一步账号验证，恢复后就继续替你发意向。';
    case 'intent_posted':
    case 'awaiting_match':
      return '这条找搭子意向已经挂上去了，24 小时内我会继续替你盯着；有合适的人会先进消息中心，不用重新说一遍。';
    case 'match_ready':
      return task.intentMatchId
        ? '已经出现可确认的匹配结果，去消息中心看一眼，或者直接回来说你想继续哪一个。'
        : '已经先帮你筛出一批候选搭子，回到当前对话里继续挑就行。';
    default:
      return '这条找搭子任务还在推进中，不会因为异步等待就丢掉。';
  }
}

function buildCreateTaskSummary(task: AgentTask, activityTitle?: string): string {
  switch (task.currentStage) {
    case 'draft_collecting':
      return activityTitle
        ? `「${activityTitle}」的草稿还在整理，你可以继续改细节。`
        : '草稿还在整理中，细节补齐后就能发出去。';
    case 'auth_gate':
      return '差一步登录或绑定手机号，恢复后我会继续把这场局发出来。';
    case 'draft_ready':
      return activityTitle
        ? `「${activityTitle}」草稿已经就绪，现在就能确认发布。`
        : '草稿已经就绪，现在就能确认发布。';
    case 'published':
      return '这场局已经正式发出去了，接下来就是继续拉人和协作。';
    default:
      return '这条发局任务还在持续推进，不会断成孤立的按钮动作。';
  }
}

function buildJoinTaskPrimaryAction(task: AgentTask, activityTitle?: string): CurrentAgentTaskAction | undefined {
  if (task.status === 'waiting_auth') {
    return buildPendingStructuredActionSnapshot(task, '继续这步');
  }

  if (task.activityId && (task.currentStage === 'joined' || task.currentStage === 'discussion')) {
    return {
      kind: 'navigate',
      label: '进入讨论区',
      url: `/subpackages/activity/discussion/index?id=${task.activityId}&entry=task_runtime_panel`,
    };
  }

  if (task.activityId && task.currentStage === 'action_selected') {
    return {
      kind: 'navigate',
      label: '看看这个局',
      url: `/subpackages/activity/detail/index?id=${task.activityId}`,
    };
  }

  if (task.currentStage === 'post_activity') {
    return buildPostActivityPrimaryAction(task, activityTitle);
  }

  return undefined;
}

function readTaskActivityMode(task: AgentTask): 'review' | 'rebook' | 'kickoff' | null {
  if (!isRecord(task.slotSummary)) {
    return null;
  }

  const activityMode = task.slotSummary.activityMode;
  return activityMode === 'review' || activityMode === 'rebook' || activityMode === 'kickoff'
    ? activityMode
    : null;
}

function buildPostActivityPrompt(params: {
  activityTitle?: string;
  activityId?: string;
  activityMode: 'review' | 'rebook' | 'kickoff';
}): string {
  const activityHint = params.activityTitle ? `「${params.activityTitle}」` : '这场活动';
  const activityRef = params.activityId ? `（activityId: ${params.activityId}）` : '';

  if (params.activityMode === 'rebook') {
    return `基于我刚结束的${activityHint}${activityRef}，帮我快速再约一场：延续合适的人、给个新时间建议，并直接生成一段可发送的招呼文案。`;
  }

  if (params.activityMode === 'kickoff') {
    return `围绕我刚结束的${activityHint}${activityRef}，帮我把下一次局的开场方案想好：先定主题、再给个破冰话术和发起文案。`;
  }

  return `我刚结束${activityHint}${activityRef}，帮我先做一份复盘：亮点、槽点、下次优化和一句可直接发群里的总结。`;
}

function buildPostActivityChatAction(params: {
  label: string;
  activityTitle?: string;
  activityId?: string;
  activityMode: 'review' | 'rebook' | 'kickoff';
}): CurrentAgentTaskAction | undefined {
  if (!params.activityId) {
    return undefined;
  }

  return {
    kind: 'structured_action',
    label: params.label,
    action: 'start_follow_up_chat',
    payload: {
      prompt: buildPostActivityPrompt({
        activityTitle: params.activityTitle,
        activityId: params.activityId,
        activityMode: params.activityMode,
      }),
      activityId: params.activityId,
      activityMode: params.activityMode,
      entry: 'task_runtime_post_activity',
    },
    source: 'task_runtime_panel',
    originalText: params.label,
  };
}

function buildPostActivityTaskSummary(task: AgentTask, activityTitle?: string): string {
  const activityMode = readTaskActivityMode(task);

  if (activityMode === 'rebook') {
    return activityTitle
      ? `活动已经结束，正在围绕「${activityTitle}」继续承接再约和下一次发起。`
      : '活动已经结束，这条任务正在继续承接再约和下一次发起。';
  }

  if (activityMode === 'review') {
    return activityTitle
      ? `活动已经结束，正在围绕「${activityTitle}」继续承接复盘和真实结果沉淀。`
      : '活动已经结束，这条任务正在继续承接复盘和真实结果沉淀。';
  }

  return '活动结束后，这条任务会继续承接复盘、再约和真实结果写回。';
}

function buildPostActivityPrimaryAction(task: AgentTask, activityTitle?: string): CurrentAgentTaskAction | undefined {
  const activityMode = readTaskActivityMode(task);
  const primaryMode = activityMode === 'rebook' ? 'rebook' : activityMode === 'kickoff' ? 'kickoff' : 'review';

  return buildPostActivityChatAction({
    label: primaryMode === 'rebook' ? '继续再约' : primaryMode === 'kickoff' ? '继续筹备下次' : '继续复盘',
    activityTitle,
    activityId: task.activityId ?? undefined,
    activityMode: primaryMode,
  });
}

function buildPostActivitySecondaryAction(task: AgentTask, activityTitle?: string): CurrentAgentTaskAction | undefined {
  const activityMode = readTaskActivityMode(task);
  const secondaryMode = activityMode === 'rebook' ? 'review' : 'rebook';

  return buildPostActivityChatAction({
    label: secondaryMode === 'review' ? '先做复盘' : '去再约',
    activityTitle,
    activityId: task.activityId ?? undefined,
    activityMode: secondaryMode,
  });
}

function buildPartnerTaskPrimaryAction(task: AgentTask): CurrentAgentTaskAction | undefined {
  if (task.status === 'waiting_auth') {
    return buildPendingStructuredActionSnapshot(task, '继续找搭子');
  }

  if (task.currentStage === 'preference_collecting') {
    return {
      kind: 'structured_action',
      label: '继续补偏好',
      action: 'find_partner',
      payload: {},
      source: 'task_runtime_panel',
      originalText: '继续找搭子',
    };
  }

  if (task.currentStage === 'awaiting_match' || task.currentStage === 'match_ready') {
    if (task.currentStage === 'match_ready' && !task.intentMatchId) {
      return undefined;
    }

    return {
      kind: 'switch_tab',
      label: task.currentStage === 'match_ready' ? '去确认匹配' : '查看代找进展',
      url: '/pages/message/index',
      ...(task.currentStage === 'match_ready'
        ? {
            payload: {
              taskId: task.id,
              ...(task.intentMatchId ? { matchId: task.intentMatchId } : {}),
            },
          }
        : {}),
    };
  }

  return undefined;
}

function buildCreateTaskPrimaryAction(task: AgentTask): CurrentAgentTaskAction | undefined {
  if (task.status === 'waiting_auth') {
    return buildPendingStructuredActionSnapshot(task, '继续发这场局');
  }

  if (task.activityId && task.currentStage === 'draft_ready') {
    return {
      kind: 'structured_action',
      label: '确认发布',
      action: 'confirm_publish',
      payload: {
        activityId: task.activityId,
      },
      source: 'task_runtime_panel',
      originalText: '确认发布这个活动',
    };
  }

  if (task.activityId && task.currentStage === 'draft_collecting') {
    return {
      kind: 'navigate',
      label: '继续看草稿',
      url: `/subpackages/activity/detail/index?id=${task.activityId}`,
    };
  }

  return undefined;
}

function buildJoinTaskSecondaryAction(task: AgentTask, activityTitle?: string): CurrentAgentTaskAction | undefined {
  if (task.currentStage === 'post_activity') {
    return buildPostActivitySecondaryAction(task, activityTitle);
  }

  return undefined;
}

function buildTaskHeadline(task: AgentTask, activityTitle?: string): string {
  if (activityTitle) {
    return `正在推进「${activityTitle}」`;
  }

  return task.goalText.trim() || '正在持续推进这件事';
}

function getPartnerTypeLabel(activityType?: string | null, sportType?: string | null): string {
  switch (activityType) {
    case 'food':
      return '美食';
    case 'entertainment':
      return '娱乐';
    case 'sports':
      if (sportType === 'badminton') return '羽毛球';
      if (sportType === 'basketball') return '篮球';
      if (sportType === 'running') return '跑步';
      if (sportType === 'tennis') return '网球';
      if (sportType === 'swimming') return '游泳';
      if (sportType === 'cycling') return '骑行';
      return '运动';
    case 'boardgame':
      return '桌游';
    default:
      return '搭子';
  }
}

async function appendAgentTaskEvent(params: {
  taskId: string;
  userId: string;
  eventType: AgentTaskEventType;
  fromStage?: AgentTaskStage;
  toStage?: AgentTaskStage;
  conversationId?: string;
  activityId?: string;
  source?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(agentTaskEvents).values({
    taskId: params.taskId,
    userId: params.userId,
    eventType: params.eventType,
    fromStage: params.fromStage,
    toStage: params.toStage,
    conversationId: params.conversationId,
    activityId: params.activityId,
    source: params.source,
    payload: params.payload ?? {},
  });
}

async function findOpenTask(params: {
  userId: string;
  taskType: AgentTaskType;
  conversationId?: string;
  activityId?: string;
  partnerIntentId?: string;
  intentMatchId?: string | null;
}): Promise<AgentTask | null> {
  const { userId, taskType, conversationId, activityId, partnerIntentId, intentMatchId } = params;

  if (intentMatchId) {
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, userId),
        eq(agentTasks.taskType, taskType),
        inArray(agentTasks.status, OPEN_TASK_STATUSES),
        eq(agentTasks.intentMatchId, intentMatchId),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    if (task) {
      return task;
    }
  }

  if (partnerIntentId) {
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, userId),
        eq(agentTasks.taskType, taskType),
        inArray(agentTasks.status, OPEN_TASK_STATUSES),
        eq(agentTasks.partnerIntentId, partnerIntentId),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    if (task) {
      return task;
    }
  }

  if (activityId) {
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, userId),
        eq(agentTasks.taskType, taskType),
        inArray(agentTasks.status, OPEN_TASK_STATUSES),
        eq(agentTasks.activityId, activityId),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    if (task) {
      return task;
    }
  }

  if (conversationId) {
    const [task] = await db
      .select()
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, userId),
        eq(agentTasks.taskType, taskType),
        inArray(agentTasks.status, OPEN_TASK_STATUSES),
        or(
          eq(agentTasks.entryConversationId, conversationId),
          eq(agentTasks.latestConversationId, conversationId),
        ),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    if (task) {
      return task;
    }
  }

  const [task] = await db
    .select()
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, userId),
      eq(agentTasks.taskType, taskType),
      inArray(agentTasks.status, OPEN_TASK_STATUSES),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  return task ?? null;
}

async function findOpenJoinTask(params: {
  userId: string;
  conversationId?: string;
  activityId?: string;
}): Promise<AgentTask | null> {
  return findOpenTask({
    userId: params.userId,
    taskType: 'join_activity',
    conversationId: params.conversationId,
    activityId: params.activityId,
  });
}

async function findLatestJoinTaskByActivity(params: {
  userId: string;
  activityId: string;
}): Promise<AgentTask | null> {
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, params.userId),
      eq(agentTasks.taskType, 'join_activity'),
      eq(agentTasks.activityId, params.activityId),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  return task ?? null;
}

async function findLatestPartnerTaskByIntent(params: {
  userId: string;
  partnerIntentId: string;
}): Promise<AgentTask | null> {
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, params.userId),
      eq(agentTasks.taskType, 'find_partner'),
      eq(agentTasks.partnerIntentId, params.partnerIntentId),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  return task ?? null;
}

async function findLatestPartnerTaskByMatch(params: {
  userId: string;
  intentMatchId: string;
}): Promise<AgentTask | null> {
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, params.userId),
      eq(agentTasks.taskType, 'find_partner'),
      eq(agentTasks.intentMatchId, params.intentMatchId),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  return task ?? null;
}

async function findLatestCreateTaskByActivity(params: {
  userId: string;
  activityId: string;
}): Promise<AgentTask | null> {
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, params.userId),
      eq(agentTasks.taskType, 'create_activity'),
      eq(agentTasks.activityId, params.activityId),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  return task ?? null;
}

async function ensureTask(params: {
  userId: string;
  taskType: AgentTaskType;
  conversationId?: string;
  activityId?: string;
  partnerIntentId?: string;
  intentMatchId?: string | null;
  goalText: string;
  defaultStage: AgentTaskStage;
  source?: string;
  entry?: string;
  slotSummary?: Record<string, unknown>;
}): Promise<AgentTask> {
  const existingTask = await findOpenTask({
    userId: params.userId,
    taskType: params.taskType,
    conversationId: params.conversationId,
    activityId: params.activityId,
    partnerIntentId: params.partnerIntentId,
    intentMatchId: params.intentMatchId,
  });

  if (existingTask) {
    return existingTask;
  }

  const [task] = await db
    .insert(agentTasks)
    .values({
      userId: params.userId,
      taskType: params.taskType,
      status: 'active',
      currentStage: params.defaultStage,
      goalText: params.goalText,
      entryConversationId: params.conversationId,
      latestConversationId: params.conversationId,
      activityId: params.activityId,
      partnerIntentId: params.partnerIntentId,
      intentMatchId: params.intentMatchId,
      source: params.source,
      entry: params.entry,
      slotSummary: params.slotSummary,
      lastUserMessageAt: new Date(),
    })
    .returning();

  await appendAgentTaskEvent({
    taskId: task.id,
    userId: task.userId,
    eventType: 'task_created',
    toStage: task.currentStage,
    conversationId: params.conversationId,
    activityId: params.activityId,
    source: params.source,
    payload: {
      goalText: params.goalText,
      entry: params.entry ?? null,
    },
  });

  return task;
}

async function updateJoinTask(params: {
  task: AgentTask;
  stage?: AgentTaskStage;
  status?: AgentTaskStatus;
  conversationId?: string;
  activityId?: string;
  partnerIntentId?: string;
  intentMatchId?: string | null;
  source?: string;
  entry?: string;
  goalText?: string;
  slotSummary?: Record<string, unknown>;
  pendingAction?: Record<string, unknown> | null;
  resultOutcome?: string;
  resultSummary?: string;
  completedAt?: Date | null;
  eventType?: AgentTaskEventType;
  eventPayload?: Record<string, unknown>;
}): Promise<AgentTask> {
  const nextStage = (() => {
    if (!params.stage) {
      return params.task.currentStage;
    }

    return getStageRank(params.task.taskType, params.stage) >= getStageRank(params.task.taskType, params.task.currentStage)
      ? params.stage
      : params.task.currentStage;
  })();

  const nextStatus = (() => {
    const requestedStatus = params.status ?? params.task.status;
    return isTerminalTaskStatus(params.task.status)
      ? params.task.status
      : requestedStatus;
  })();
  const updates: Partial<NewAgentTask> = {
    currentStage: nextStage,
    status: nextStatus,
    latestConversationId: params.conversationId ?? params.task.latestConversationId,
    activityId: params.activityId ?? params.task.activityId,
    partnerIntentId: params.partnerIntentId ?? params.task.partnerIntentId,
    intentMatchId: params.intentMatchId === undefined ? params.task.intentMatchId : params.intentMatchId,
    updatedAt: new Date(),
    lastUserMessageAt: params.conversationId ? new Date() : params.task.lastUserMessageAt,
  };

  if (params.entry !== undefined) {
    updates.entry = params.entry;
  }
  if (params.source !== undefined) {
    updates.source = params.source;
  }
  if (params.goalText) {
    updates.goalText = params.goalText;
  }
  if (params.slotSummary) {
    const existingSlotSummary = isRecord(params.task.slotSummary) ? params.task.slotSummary : undefined;
    updates.slotSummary = (() => {
      switch (params.task.taskType) {
        case 'join_activity':
          return mergeJoinTaskContext(
            readJoinTaskContext(params.task),
            params.slotSummary as JoinTaskContext,
          ) ?? existingSlotSummary ?? params.slotSummary;
        case 'find_partner':
          return mergePartnerTaskContext(
            existingSlotSummary as PartnerTaskContext | undefined,
            params.slotSummary as PartnerTaskContext,
          ) ?? existingSlotSummary ?? params.slotSummary;
        case 'create_activity':
          return mergeCreateTaskContext(
            existingSlotSummary as CreateTaskContext | undefined,
            params.slotSummary as CreateTaskContext,
          ) ?? existingSlotSummary ?? params.slotSummary;
      }
    })();
  }
  if (params.pendingAction !== undefined) {
    updates.pendingAction = params.pendingAction ?? null;
  }
  if (params.resultOutcome !== undefined) {
    updates.resultOutcome = params.resultOutcome;
  }
  if (params.resultSummary !== undefined) {
    updates.resultSummary = params.resultSummary;
  }
  if (params.completedAt !== undefined) {
    updates.completedAt = params.completedAt;
  }

  const [updatedTask] = await db
    .update(agentTasks)
    .set(updates)
    .where(eq(agentTasks.id, params.task.id))
    .returning();

  const stageChanged = nextStage !== params.task.currentStage;
  const statusChanged = nextStatus !== params.task.status;
  const eventType = params.eventType
    ?? (stageChanged ? 'stage_changed' : statusChanged ? 'context_updated' : null);

  if (
    params.task.status === 'waiting_auth'
    && nextStatus === 'active'
    && getStageRank(params.task.taskType, nextStage) > getStageRank(params.task.taskType, 'auth_gate')
  ) {
    await appendAgentTaskEvent({
      taskId: updatedTask.id,
      userId: updatedTask.userId,
      eventType: 'auth_resumed',
      fromStage: params.task.currentStage,
      toStage: nextStage,
      conversationId: params.conversationId,
      activityId: params.activityId ?? updatedTask.activityId ?? undefined,
      source: params.source,
      payload: params.eventPayload,
    });
  }

  if (eventType) {
    await appendAgentTaskEvent({
      taskId: updatedTask.id,
      userId: updatedTask.userId,
      eventType,
      fromStage: params.task.currentStage,
      toStage: stageChanged ? nextStage : undefined,
      conversationId: params.conversationId,
      activityId: params.activityId ?? updatedTask.activityId ?? undefined,
      source: params.source,
      payload: params.eventPayload,
    });
  }

  return updatedTask;
}

export async function syncJoinTaskFromChatResponse(params: {
  userId: string | null;
  conversationId: string;
  request: GenUIRequest;
  blocks: GenUIBlock[];
  outcome?: string | null;
}): Promise<void> {
  if (!params.userId) {
    return;
  }

  const goalText = getGoalTextFromRequest(params.request);
  const slotSummary = mergeJoinTaskContext(
    undefined,
    buildJoinTaskContextFromRequest(params.request),
  ) ?? buildSlotSummaryFromRequest(params.request);
  const entry = typeof params.request.context?.entry === 'string' ? params.request.context.entry : undefined;
  const actionName = params.request.input.type === 'action' ? params.request.input.action : null;
  if (actionName === 'record_activity_feedback') {
    return;
  }

  const joinActivityIdFromRequest = extractJoinActivityIdFromRequest(params.request);
  const joinActivityIdFromBlocks = extractJoinActivityIdFromBlocks(params.blocks);
  const joinActivityId = joinActivityIdFromBlocks ?? joinActivityIdFromRequest;
  const authRequirement = extractJoinAuthRequirement(params.blocks);
  const explored = params.outcome === 'explored' || extractExploreSignal(params.blocks);
  const isJoinAction = actionName === 'join_activity';
  const activityMode = params.request.context?.activityMode;
  const contextActivityId = readTextValue(params.request.context?.activityId);

  if (activityMode && contextActivityId) {
    const existingOpenTask = await findOpenJoinTask({
      userId: params.userId,
      activityId: contextActivityId,
    });
    const existingTask = existingOpenTask ?? await findLatestJoinTaskByActivity({
      userId: params.userId,
      activityId: contextActivityId,
    });

    if (existingTask && isTerminalTaskStatus(existingTask.status)) {
      return;
    }

    const task = existingTask ?? await ensureTask({
      userId: params.userId,
      taskType: 'join_activity',
      conversationId: params.conversationId,
      activityId: contextActivityId,
      goalText: goalText || '活动后跟进',
      defaultStage: 'post_activity',
      source: entry ?? 'activity_follow_up',
      entry,
      slotSummary,
    });

    await updateJoinTask({
      task,
      stage: 'post_activity',
      status: 'active',
      conversationId: params.conversationId,
      activityId: contextActivityId,
      source: entry ?? 'activity_follow_up',
      entry,
      goalText,
      slotSummary,
      pendingAction: null,
      ...(task.currentStage === 'post_activity'
        ? {}
        : {
            eventType: 'stage_changed' as const,
          }),
      eventPayload: {
        activityMode,
        entry: entry ?? null,
      },
    });
    return;
  }

  if (!explored && !isJoinAction && !authRequirement && !joinActivityId) {
    return;
  }

  let task: AgentTask | null = null;

  if (explored) {
    task = await ensureTask({
      userId: params.userId,
      taskType: 'join_activity',
      conversationId: params.conversationId,
      goalText,
      defaultStage: 'explore',
      source: entry ?? 'chat_explore',
      entry,
      slotSummary,
    });

    task = await updateJoinTask({
      task,
      stage: 'explore',
      status: task.status === 'waiting_auth' ? task.status : 'active',
      conversationId: params.conversationId,
      source: entry ?? 'chat_explore',
      entry,
      goalText,
      slotSummary,
      eventPayload: {
        outcome: params.outcome ?? 'explored',
      },
    });
  }

  if (isJoinAction) {
    const joinActionInput = params.request.input;
    task = await ensureTask({
      userId: params.userId,
      taskType: 'join_activity',
      conversationId: params.conversationId,
      activityId: joinActivityId ?? undefined,
      goalText,
      defaultStage: 'action_selected',
      source: entry ?? 'join_action',
      entry,
      slotSummary,
    });

    task = await updateJoinTask({
      task,
      stage: 'action_selected',
      status: task.status === 'waiting_auth' ? task.status : 'active',
      conversationId: params.conversationId,
      activityId: joinActivityId ?? undefined,
      source: entry ?? 'join_action',
      entry,
      goalText,
      slotSummary,
      eventType: 'action_selected',
      eventPayload: {
        actionId: joinActionInput.type === 'action' ? joinActionInput.actionId : null,
      },
    });
  }

  if (authRequirement) {
    const pendingActionActivityId = isRecord(authRequirement.pendingAction?.payload)
      ? readTextValue(authRequirement.pendingAction.payload.activityId)
      : null;
    const authTask = task ?? await ensureTask({
      userId: params.userId,
      taskType: 'join_activity',
      conversationId: params.conversationId,
      activityId: pendingActionActivityId ?? joinActivityId ?? undefined,
      goalText,
      defaultStage: 'auth_gate',
      source: entry ?? 'auth_gate',
      entry,
      slotSummary,
    });

    await updateJoinTask({
      task: authTask,
      stage: 'auth_gate',
      status: 'waiting_auth',
      conversationId: params.conversationId,
      activityId: pendingActionActivityId ?? joinActivityId ?? undefined,
      source: entry ?? 'auth_gate',
      entry,
      goalText,
      slotSummary,
      pendingAction: authRequirement.pendingAction ?? null,
      eventType: 'auth_blocked',
      eventPayload: {
        mode: authRequirement.mode,
      },
    });
    return;
  }

  if (joinActivityId) {
    const joinedTask = task ?? await ensureTask({
      userId: params.userId,
      taskType: 'join_activity',
      conversationId: params.conversationId,
      activityId: joinActivityId,
      goalText,
      defaultStage: 'joined',
      source: entry ?? 'join_success',
      entry,
      slotSummary,
    });

    await updateJoinTask({
      task: joinedTask,
      stage: 'joined',
      status: 'active',
      conversationId: params.conversationId,
      activityId: joinActivityId,
      source: entry ?? 'join_success',
      entry,
      goalText,
      slotSummary,
      pendingAction: null,
      eventType: 'stage_changed',
      eventPayload: {
        outcome: params.outcome ?? 'joined',
      },
    });
  }
}

export async function syncPartnerTaskFromChatResponse(params: {
  userId: string | null;
  conversationId: string;
  request: GenUIRequest;
  blocks: GenUIBlock[];
  outcome?: string | null;
}): Promise<void> {
  if (!params.userId) {
    return;
  }

  const goalText = getGoalTextFromRequest(params.request);
  const slotSummary = mergePartnerTaskContext(
    undefined,
    buildPartnerTaskContextFromRequest(params.request),
  ) ?? buildSlotSummaryFromRequest(params.request);
  const entry = typeof params.request.context?.entry === 'string' ? params.request.context.entry : undefined;
  const authRequirement = extractPartnerAuthRequirement(params.blocks);
  const hasPartnerForm = hasPartnerIntentFormBlock(params.blocks);
  const hasPartnerSearchResults = hasPartnerSearchResultsBlock(params.blocks);
  const actionName = params.request.input.type === 'action' ? params.request.input.action : null;
  const isPartnerEntryAction = actionName === 'find_partner'
    || actionName === 'search_partners'
    || actionName === 'submit_partner_intent_form';

  if (!hasPartnerForm && !hasPartnerSearchResults && !isPartnerEntryAction && !authRequirement) {
    return;
  }

  let task = await findOpenTask({
    userId: params.userId,
    taskType: 'find_partner',
    conversationId: params.conversationId,
  });

  if (hasPartnerForm || isPartnerEntryAction || hasPartnerSearchResults) {
    // Search-first partner flows can return candidate lists before any real
    // partner_intent / intent_match is created. Keep those turns in the
    // pre-match stage so inbox/task panels do not misclassify them as a
    // pending match that requires confirmation.
    const nextStage = 'preference_collecting';
    task = task ?? await ensureTask({
      userId: params.userId,
      taskType: 'find_partner',
      conversationId: params.conversationId,
      goalText,
      defaultStage: nextStage,
      source: entry ?? 'find_partner',
      entry,
      slotSummary,
    });

    task = await updateJoinTask({
      task,
      stage: nextStage,
      status: task.status === 'waiting_auth' ? task.status : 'active',
      conversationId: params.conversationId,
      source: entry ?? 'find_partner',
      entry,
      goalText,
      slotSummary,
      eventPayload: {
        outcome: params.outcome ?? 'partner_progress',
      },
    });
  }

  if (authRequirement) {
    const pendingPayload = isRecord(authRequirement.pendingAction?.payload)
      ? authRequirement.pendingAction.payload
      : null;
    const authTask = task ?? await ensureTask({
      userId: params.userId,
      taskType: 'find_partner',
      conversationId: params.conversationId,
      partnerIntentId: readTextValue(pendingPayload?.intentId) ?? undefined,
      intentMatchId: readTextValue(pendingPayload?.matchId) ?? undefined,
      goalText,
      defaultStage: 'auth_gate',
      source: entry ?? 'partner_auth_gate',
      entry,
      slotSummary,
    });

    await updateJoinTask({
      task: authTask,
      stage: 'auth_gate',
      status: 'waiting_auth',
      conversationId: params.conversationId,
      partnerIntentId: readTextValue(pendingPayload?.intentId) ?? undefined,
      intentMatchId: readTextValue(pendingPayload?.matchId) ?? undefined,
      source: entry ?? 'partner_auth_gate',
      entry,
      goalText,
      slotSummary,
      pendingAction: authRequirement.pendingAction ?? null,
      eventType: 'auth_blocked',
      eventPayload: {
        mode: authRequirement.mode,
        action: authRequirement.action,
      },
    });
  }
}

export async function syncCreateTaskFromChatResponse(params: {
  userId: string | null;
  conversationId: string;
  request: GenUIRequest;
  blocks: GenUIBlock[];
}): Promise<void> {
  if (!params.userId) {
    return;
  }

  const goalText = getGoalTextFromRequest(params.request);
  const slotSummary = mergeCreateTaskContext(
    undefined,
    buildCreateTaskContextFromRequest(params.request),
  ) ?? buildSlotSummaryFromRequest(params.request);
  const entry = typeof params.request.context?.entry === 'string' ? params.request.context.entry : undefined;
  const actionName = params.request.input.type === 'action' ? params.request.input.action : null;
  const isCreateAction = actionName === 'create_activity';
  const isEditAction = actionName === 'edit_draft' || actionName === 'save_draft_settings';
  const authRequirement = extractCreateAuthRequirement(params.blocks);
  const hasDraftForm = hasDraftSettingsFormBlock(params.blocks);
  const hasDraftReady = hasDraftReadyBlock(params.blocks);
  const requestActivityId = extractCreateActivityIdFromRequest(params.request);
  const blockActivityId = extractCreateActivityIdFromBlocks(params.blocks);
  const activityId = blockActivityId ?? requestActivityId;

  if (!isCreateAction && !isEditAction && !authRequirement && !hasDraftForm && !hasDraftReady) {
    return;
  }

  let task = await findOpenTask({
    userId: params.userId,
    taskType: 'create_activity',
    conversationId: params.conversationId,
    activityId: activityId ?? undefined,
  });

  if (isCreateAction || isEditAction || hasDraftForm) {
    task = task ?? await ensureTask({
      userId: params.userId,
      taskType: 'create_activity',
      conversationId: params.conversationId,
      activityId: activityId ?? undefined,
      goalText,
      defaultStage: 'draft_collecting',
      source: entry ?? 'create_activity',
      entry,
      slotSummary,
    });

    task = await updateJoinTask({
      task,
      stage: 'draft_collecting',
      status: task.status === 'waiting_auth' ? task.status : 'active',
      conversationId: params.conversationId,
      activityId: activityId ?? undefined,
      source: entry ?? 'create_activity',
      entry,
      goalText,
      slotSummary,
      eventPayload: {
        action: actionName,
      },
    });
  }

  if (authRequirement) {
    const pendingPayload = isRecord(authRequirement.pendingAction?.payload)
      ? authRequirement.pendingAction.payload
      : null;
    const pendingActivityId = readTextValue(pendingPayload?.activityId);
    const authTask = task ?? await ensureTask({
      userId: params.userId,
      taskType: 'create_activity',
      conversationId: params.conversationId,
      activityId: pendingActivityId ?? activityId ?? undefined,
      goalText,
      defaultStage: 'auth_gate',
      source: entry ?? 'create_activity_auth_gate',
      entry,
      slotSummary,
    });

    await updateJoinTask({
      task: authTask,
      stage: 'auth_gate',
      status: 'waiting_auth',
      conversationId: params.conversationId,
      activityId: pendingActivityId ?? activityId ?? undefined,
      source: entry ?? 'create_activity_auth_gate',
      entry,
      goalText,
      slotSummary,
      pendingAction: authRequirement.pendingAction ?? null,
      eventType: 'auth_blocked',
      eventPayload: {
        mode: authRequirement.mode,
        action: authRequirement.action,
      },
    });
    return;
  }

  if (hasDraftReady && activityId) {
    const draftTask = task ?? await ensureTask({
      userId: params.userId,
      taskType: 'create_activity',
      conversationId: params.conversationId,
      activityId,
      goalText,
      defaultStage: 'draft_ready',
      source: entry ?? 'activity_draft_ready',
      entry,
      slotSummary,
    });

    await updateJoinTask({
      task: draftTask,
      stage: 'draft_ready',
      status: 'active',
      conversationId: params.conversationId,
      activityId,
      source: entry ?? 'activity_draft_ready',
      entry,
      goalText,
      slotSummary,
      pendingAction: null,
      eventPayload: {
        action: actionName,
      },
    });
  }
}

export async function recordPartnerTaskIntentPosted(params: {
  userId: string;
  partnerIntentId: string;
  rawInput: string;
  activityType: string;
  scenarioType?: string;
  sportType?: string;
  locationHint: string;
  destinationText?: string | null;
  timePreference?: string;
  timeText?: string | null;
  intentMatchId?: string;
}): Promise<void> {
  const existingTask = await findLatestPartnerTaskByIntent({
    userId: params.userId,
    partnerIntentId: params.partnerIntentId,
  });
  const goalText = params.rawInput.trim() || `帮我找个${getPartnerTypeLabel(params.activityType, params.sportType)}搭子`;
  const task = existingTask ?? await ensureTask({
    userId: params.userId,
    taskType: 'find_partner',
    partnerIntentId: params.partnerIntentId,
    intentMatchId: params.intentMatchId,
    goalText,
    defaultStage: params.intentMatchId ? 'match_ready' : 'awaiting_match',
    source: 'partner_intent_created',
    slotSummary: {
      activityType: params.activityType,
      ...(params.scenarioType ? { scenarioType: params.scenarioType } : {}),
      ...(params.sportType ? { sportType: params.sportType } : {}),
      locationHint: params.locationHint,
      ...(params.destinationText ? { destinationText: params.destinationText } : {}),
      ...(params.timePreference ? { timePreference: params.timePreference } : {}),
      ...(params.timeText ? { timeText: params.timeText } : {}),
    },
  });

  await updateJoinTask({
    task,
    stage: params.intentMatchId ? 'match_ready' : 'awaiting_match',
    status: 'waiting_async_result',
    partnerIntentId: params.partnerIntentId,
    intentMatchId: params.intentMatchId,
    source: 'partner_intent_created',
    goalText,
    slotSummary: {
      activityType: params.activityType,
      ...(params.scenarioType ? { scenarioType: params.scenarioType } : {}),
      locationHint: params.locationHint,
      ...(params.destinationText ? { destinationText: params.destinationText } : {}),
      ...(params.timePreference ? { timePreference: params.timePreference } : {}),
      ...(params.timeText ? { timeText: params.timeText } : {}),
    },
    pendingAction: null,
    eventType: 'stage_changed',
    eventPayload: {
      activityType: params.activityType,
      ...(params.scenarioType ? { scenarioType: params.scenarioType } : {}),
      locationHint: params.locationHint,
      ...(params.destinationText ? { destinationText: params.destinationText } : {}),
      ...(params.timeText ? { timeText: params.timeText } : {}),
    },
  });
}

export async function recordPartnerTaskMatchReady(params: {
  matchId: string;
  activityType: string;
  locationHint: string;
}): Promise<void> {
  const match = await db
    .select({
      id: intentMatches.id,
      userIds: intentMatches.userIds,
      intentIds: intentMatches.intentIds,
      activityType: intentMatches.activityType,
      scenarioType: intentMatches.scenarioType,
      centerLocationHint: intentMatches.centerLocationHint,
      destinationText: intentMatches.destinationText,
      timeText: intentMatches.timeText,
    })
    .from(intentMatches)
    .where(eq(intentMatches.id, params.matchId))
    .limit(1);

  const matchRow = match[0];
  if (!matchRow) {
    return;
  }

  const intents = await db
    .select({
      id: partnerIntents.id,
      userId: partnerIntents.userId,
      scenarioType: partnerIntents.scenarioType,
      locationHint: partnerIntents.locationHint,
      destinationText: partnerIntents.destinationText,
      timePreference: partnerIntents.timePreference,
      timeText: partnerIntents.timeText,
      description: partnerIntents.description,
      metaData: partnerIntents.metaData,
    })
    .from(partnerIntents)
    .where(inArray(partnerIntents.id, matchRow.intentIds));

  for (const intent of intents) {
    const task = await findLatestPartnerTaskByIntent({
      userId: intent.userId,
      partnerIntentId: intent.id,
    }) ?? await ensureTask({
      userId: intent.userId,
      taskType: 'find_partner',
      partnerIntentId: intent.id,
      intentMatchId: matchRow.id,
      goalText: typeof intent.metaData?.rawInput === 'string' && intent.metaData.rawInput.trim()
        ? intent.metaData.rawInput.trim()
        : `帮我找个${getPartnerTypeLabel(matchRow.activityType)}搭子`,
      defaultStage: 'match_ready',
      source: 'partner_match_ready',
      slotSummary: {
        activityType: matchRow.activityType,
        scenarioType: matchRow.scenarioType,
        locationHint: matchRow.centerLocationHint,
        ...(matchRow.destinationText ? { destinationText: matchRow.destinationText } : {}),
        ...(intent.timeText || matchRow.timeText ? { timeText: intent.timeText || matchRow.timeText } : {}),
        ...(intent.timePreference ? { timePreference: intent.timePreference } : {}),
      },
    });

    await updateJoinTask({
      task,
      stage: 'match_ready',
      status: 'waiting_async_result',
      partnerIntentId: intent.id,
      intentMatchId: matchRow.id,
      source: 'partner_match_ready',
      pendingAction: null,
      slotSummary: {
        activityType: matchRow.activityType,
        scenarioType: matchRow.scenarioType,
        locationHint: matchRow.centerLocationHint,
        ...(matchRow.destinationText ? { destinationText: matchRow.destinationText } : {}),
        ...(intent.timeText || matchRow.timeText ? { timeText: intent.timeText || matchRow.timeText } : {}),
      },
      eventType: 'stage_changed',
      eventPayload: {
        matchId: matchRow.id,
        activityType: params.activityType,
        locationHint: params.locationHint,
        scenarioType: matchRow.scenarioType,
        ...(matchRow.destinationText ? { destinationText: matchRow.destinationText } : {}),
        ...(matchRow.timeText ? { timeText: matchRow.timeText } : {}),
      },
    });
  }
}

export async function recordPartnerTaskMatchConfirmed(params: {
  matchId: string;
  activityId: string;
}): Promise<void> {
  const [match] = await db
    .select({
      id: intentMatches.id,
      userIds: intentMatches.userIds,
    })
    .from(intentMatches)
    .where(eq(intentMatches.id, params.matchId))
    .limit(1);

  if (!match) {
    return;
  }

  for (const userId of match.userIds) {
    const task = await findLatestPartnerTaskByMatch({
      userId,
      intentMatchId: params.matchId,
    }) ?? await ensureTask({
      userId,
      taskType: 'find_partner',
      intentMatchId: params.matchId,
      activityId: params.activityId,
      goalText: '找搭子已确认成局',
      defaultStage: 'activity_created',
      source: 'partner_match_confirmed',
    });

    const activityCreatedTask = await updateJoinTask({
      task,
      stage: 'activity_created',
      status: 'active',
      activityId: params.activityId,
      intentMatchId: params.matchId,
      source: 'partner_match_confirmed',
      pendingAction: null,
      eventType: 'stage_changed',
      eventPayload: {
        activityId: params.activityId,
        matchId: params.matchId,
      },
    });

    const completedTask = await updateJoinTask({
      task: activityCreatedTask,
      stage: 'done',
      status: 'completed',
      activityId: params.activityId,
      intentMatchId: params.matchId,
      source: 'partner_match_confirmed',
      resultOutcome: 'match_confirmed',
      resultSummary: '找搭子已确认成局，并创建了真实活动。',
      completedAt: new Date(),
      eventType: 'outcome_recorded',
      eventPayload: {
        activityId: params.activityId,
        matchId: params.matchId,
      },
    });

    await appendAgentTaskEvent({
      taskId: completedTask.id,
      userId,
      eventType: 'task_completed',
      fromStage: activityCreatedTask.currentStage,
      toStage: 'done',
      activityId: params.activityId,
      source: 'partner_match_confirmed',
      payload: {
        matchId: params.matchId,
      },
    });
  }
}

export async function recordPartnerTaskMatchCancelled(params: {
  matchId: string;
}): Promise<void> {
  const [match] = await db
    .select({
      id: intentMatches.id,
      userIds: intentMatches.userIds,
    })
    .from(intentMatches)
    .where(eq(intentMatches.id, params.matchId))
    .limit(1);

  if (!match) {
    return;
  }

  for (const userId of match.userIds) {
    const task = await findLatestPartnerTaskByMatch({
      userId,
      intentMatchId: params.matchId,
    }) ?? await ensureTask({
      userId,
      taskType: 'find_partner',
      intentMatchId: params.matchId,
      goalText: '继续等下一个更合适的搭子',
      defaultStage: 'awaiting_match',
      source: 'partner_match_cancelled',
    });

    await updateJoinTask({
      task,
      stage: 'awaiting_match',
      status: 'waiting_async_result',
      intentMatchId: null,
      source: 'partner_match_cancelled',
      resultOutcome: 'match_cancelled',
      resultSummary: '这次找搭子匹配已取消，系统会继续等待下一次更合适的匹配。',
      eventType: 'outcome_recorded',
      eventPayload: {
        matchId: params.matchId,
      },
    });
  }
}

export async function recordCreateTaskDraftReady(params: {
  userId: string;
  activityId: string;
  title: string;
  type: string;
  locationName: string;
  startAt: string;
  maxParticipants?: number;
  source: string;
}): Promise<void> {
  const goalText = buildCreateActivityGoalText({
    title: params.title,
    locationName: params.locationName,
  });
  const task = await findLatestCreateTaskByActivity({
    userId: params.userId,
    activityId: params.activityId,
  }) ?? await ensureTask({
    userId: params.userId,
    taskType: 'create_activity',
    activityId: params.activityId,
    goalText,
    defaultStage: 'draft_ready',
    source: params.source,
    slotSummary: {
      title: params.title,
      type: params.type,
      locationName: params.locationName,
      startAt: params.startAt,
      ...(typeof params.maxParticipants === 'number' ? { maxParticipants: params.maxParticipants } : {}),
    },
  });

  await updateJoinTask({
    task,
    stage: 'draft_ready',
    status: 'active',
    activityId: params.activityId,
    source: params.source,
    goalText,
    slotSummary: {
      title: params.title,
      type: params.type,
      locationName: params.locationName,
      startAt: params.startAt,
      ...(typeof params.maxParticipants === 'number' ? { maxParticipants: params.maxParticipants } : {}),
    },
    pendingAction: null,
    eventType: 'stage_changed',
    eventPayload: {
      activityId: params.activityId,
      title: params.title,
    },
  });
}

export async function recordCreateTaskPublished(params: {
  userId: string;
  activityId: string;
  title: string;
  locationName?: string | null;
}): Promise<void> {
  const goalText = buildCreateActivityGoalText({
    title: params.title,
    locationName: params.locationName,
  });
  const task = await findLatestCreateTaskByActivity({
    userId: params.userId,
    activityId: params.activityId,
  }) ?? await ensureTask({
    userId: params.userId,
    taskType: 'create_activity',
    activityId: params.activityId,
    goalText,
    defaultStage: 'published',
    source: 'activity_published',
    slotSummary: {
      title: params.title,
      ...(params.locationName ? { locationName: params.locationName } : {}),
    },
  });

  const publishedTask = await updateJoinTask({
    task,
    stage: 'published',
    status: 'active',
    activityId: params.activityId,
    source: 'activity_published',
    goalText,
    pendingAction: null,
    eventType: 'stage_changed',
    eventPayload: {
      activityId: params.activityId,
      title: params.title,
    },
  });

  const completedTask = await updateJoinTask({
    task: publishedTask,
    stage: 'done',
    status: 'completed',
    activityId: params.activityId,
    source: 'activity_published',
    pendingAction: null,
    resultOutcome: 'published',
    resultSummary: `活动「${params.title}」已正式发布，组局任务已完成。`,
    completedAt: new Date(),
    eventType: 'outcome_recorded',
    eventPayload: {
      activityId: params.activityId,
      title: params.title,
    },
  });

  await appendAgentTaskEvent({
    taskId: completedTask.id,
    userId: completedTask.userId,
    eventType: 'task_completed',
    fromStage: publishedTask.currentStage,
    toStage: 'done',
    activityId: params.activityId,
    source: 'activity_published',
    payload: {
      title: params.title,
    },
  });
}

export async function listCurrentAgentTaskSnapshots(userId: string): Promise<CurrentAgentTaskSnapshot[]> {
  const tasks = await db
    .select()
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, userId),
      inArray(agentTasks.status, OPEN_TASK_STATUSES),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(3);

  if (tasks.length === 0) {
    return [];
  }

  const activityIds = Array.from(new Set(
    tasks
      .map((task) => task.activityId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ));

  const activityMap = new Map<string, { id: string; title: string; locationName: string }>();
  if (activityIds.length > 0) {
    const activityRows = await db
      .select({
        id: activities.id,
        title: activities.title,
        locationName: activities.locationName,
      })
      .from(activities)
      .where(inArray(activities.id, activityIds));

    for (const activity of activityRows) {
      activityMap.set(activity.id, activity);
    }
  }

  return tasks.map((task) => {
    const activity = task.activityId ? activityMap.get(task.activityId) : undefined;
    const activityTitle = activity?.title;
    const baseSnapshot: CurrentAgentTaskSnapshot = {
      id: task.id,
      taskType: task.taskType,
      taskTypeLabel: getTaskTypeLabel(task.taskType),
      currentStage: task.currentStage,
      stageLabel: getStageLabel(task.currentStage),
      status: task.status,
      goalText: task.goalText,
      headline: buildTaskHeadline(task, activityTitle),
      summary: (() => {
        switch (task.taskType) {
          case 'join_activity':
            return buildJoinTaskSummary(task, activityTitle);
          case 'find_partner':
            return buildPartnerTaskSummary(task);
          case 'create_activity':
            return buildCreateTaskSummary(task, activityTitle);
        }
      })(),
      updatedAt: task.updatedAt.toISOString(),
      ...(task.activityId ? { activityId: task.activityId } : {}),
      ...(activityTitle ? { activityTitle } : {}),
    };

    const primaryAction = (() => {
      switch (task.taskType) {
        case 'join_activity':
          return buildJoinTaskPrimaryAction(task, activityTitle);
        case 'find_partner':
          return buildPartnerTaskPrimaryAction(task);
        case 'create_activity':
          return buildCreateTaskPrimaryAction(task);
      }
    })();

    const secondaryAction = (() => {
      switch (task.taskType) {
        case 'join_activity':
          return buildJoinTaskSecondaryAction(task, activityTitle);
        case 'find_partner':
        case 'create_activity':
          return undefined;
      }
    })();

    return {
      ...baseSnapshot,
      ...(primaryAction ? { primaryAction } : {}),
      ...(secondaryAction ? { secondaryAction } : {}),
    };
  });
}

export function resolveCurrentTaskHomeState(
  tasks: CurrentAgentTaskSnapshot[],
): CurrentTaskHomeStateSnapshot {
  if (tasks.length === 0) {
    return {
      homeState: 'H0',
      primaryTaskId: null,
    };
  }

  const h3 = tasks.find((task) => task.currentStage === 'match_ready');
  if (h3) {
    return {
      homeState: 'H3',
      primaryTaskId: h3.id,
    };
  }

  const activeStages = new Set<AgentTaskStage>([
    'explore',
    'preference_collecting',
    'draft_collecting',
    'action_selected',
    'draft_ready',
    'joined',
    'discussion',
    'published',
    'intent_posted',
    'awaiting_match',
  ]);

  const h2 = tasks.find((task) => task.status === 'active' && activeStages.has(task.currentStage));
  if (h2) {
    return {
      homeState: 'H2',
      primaryTaskId: h2.id,
    };
  }

  const h1 = tasks.find((task) => task.status === 'waiting_auth');
  if (h1) {
    return {
      homeState: 'H1',
      primaryTaskId: h1.id,
    };
  }

  const h4 = tasks.find((task) => task.currentStage === 'post_activity');
  if (h4) {
    return {
      homeState: 'H4',
      primaryTaskId: h4.id,
    };
  }

  return {
    homeState: 'H0',
    primaryTaskId: null,
  };
}

export async function resolveOpenJoinTaskForConversation(params: {
  userId: string;
  conversationId: string;
  activityId?: string;
}): Promise<OpenJoinTaskSnapshot | null> {
  const task = params.activityId
    ? await db
      .select()
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, params.userId),
        eq(agentTasks.taskType, 'join_activity'),
        inArray(agentTasks.status, OPEN_TASK_STATUSES),
        eq(agentTasks.activityId, params.activityId),
        or(
          eq(agentTasks.entryConversationId, params.conversationId),
          eq(agentTasks.latestConversationId, params.conversationId),
        ),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    : await db
      .select()
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, params.userId),
        eq(agentTasks.taskType, 'join_activity'),
        inArray(agentTasks.status, OPEN_TASK_STATUSES),
        or(
          eq(agentTasks.entryConversationId, params.conversationId),
          eq(agentTasks.latestConversationId, params.conversationId),
        ),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

  if (!task) {
    return null;
  }

  return {
    id: task.id,
    status: task.status,
    currentStage: task.currentStage,
    goalText: task.goalText,
    ...(task.activityId ? { activityId: task.activityId } : {}),
    context: readJoinTaskContext(task),
  };
}

export async function resolveOpenPartnerTaskForConversation(params: {
  userId: string;
  conversationId: string;
}): Promise<OpenPartnerTaskSnapshot | null> {
  const task = await db
    .select()
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, params.userId),
      eq(agentTasks.taskType, 'find_partner'),
      inArray(agentTasks.status, OPEN_TASK_STATUSES),
      or(
        eq(agentTasks.entryConversationId, params.conversationId),
        eq(agentTasks.latestConversationId, params.conversationId),
      ),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!task) {
    return null;
  }

  return {
    id: task.id,
    status: task.status,
    currentStage: task.currentStage,
    goalText: task.goalText,
    ...(task.partnerIntentId ? { partnerIntentId: task.partnerIntentId } : {}),
    ...(task.intentMatchId ? { intentMatchId: task.intentMatchId } : {}),
    context: readPartnerTaskContext(task),
  };
}

export async function resolveOpenCreateTaskForConversation(params: {
  userId: string;
  conversationId: string;
  activityId?: string;
}): Promise<OpenCreateTaskSnapshot | null> {
  const task = params.activityId
    ? await db
      .select()
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, params.userId),
        eq(agentTasks.taskType, 'create_activity'),
        inArray(agentTasks.status, OPEN_TASK_STATUSES),
        eq(agentTasks.activityId, params.activityId),
        or(
          eq(agentTasks.entryConversationId, params.conversationId),
          eq(agentTasks.latestConversationId, params.conversationId),
        ),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    : await db
      .select()
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, params.userId),
        eq(agentTasks.taskType, 'create_activity'),
        inArray(agentTasks.status, OPEN_TASK_STATUSES),
        or(
          eq(agentTasks.entryConversationId, params.conversationId),
          eq(agentTasks.latestConversationId, params.conversationId),
        ),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

  if (!task) {
    return null;
  }

  return {
    id: task.id,
    status: task.status,
    currentStage: task.currentStage,
    goalText: task.goalText,
    ...(task.activityId ? { activityId: task.activityId } : {}),
    context: readCreateTaskContext(task),
  };
}

export async function resolveConversationTaskId(params: {
  userId: string;
  conversationId: string;
  activityId?: string;
}): Promise<string | undefined> {
  if (params.activityId) {
    const [activityConversationTask] = await db
      .select({ id: agentTasks.id })
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, params.userId),
        eq(agentTasks.activityId, params.activityId),
        or(
          eq(agentTasks.entryConversationId, params.conversationId),
          eq(agentTasks.latestConversationId, params.conversationId),
        ),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    if (activityConversationTask) {
      return activityConversationTask.id;
    }
  }

  const [conversationTask] = await db
    .select({ id: agentTasks.id })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, params.userId),
      or(
        eq(agentTasks.entryConversationId, params.conversationId),
        eq(agentTasks.latestConversationId, params.conversationId),
      ),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  if (conversationTask) {
    return conversationTask.id;
  }

  if (params.activityId) {
    const [activityTask] = await db
      .select({ id: agentTasks.id })
      .from(agentTasks)
      .where(and(
        eq(agentTasks.userId, params.userId),
        eq(agentTasks.activityId, params.activityId),
      ))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    return activityTask?.id;
  }

  return undefined;
}

export async function markJoinTaskDiscussionEntered(params: {
  userId: string;
  activityId: string;
  entry?: string;
  source?: string;
}): Promise<void> {
  const openTask = await findOpenJoinTask({
    userId: params.userId,
    activityId: params.activityId,
  });
  const task = openTask ?? await findLatestJoinTaskByActivity({
    userId: params.userId,
    activityId: params.activityId,
  });

  if (task) {
    const hasReachedDiscussion = getStageRank(task.taskType, task.currentStage) >= getStageRank(task.taskType, 'discussion');
    if (hasReachedDiscussion || isTerminalTaskStatus(task.status)) {
      return;
    }
  }

  const ensuredTask = task ?? await ensureTask({
    userId: params.userId,
    taskType: 'join_activity',
    activityId: params.activityId,
    goalText: '报名后进入讨论区',
    defaultStage: 'discussion',
    source: params.source ?? 'discussion_entered',
    entry: params.entry,
  });

  await updateJoinTask({
    task: ensuredTask,
    stage: 'discussion',
    status: 'active',
    activityId: params.activityId,
    source: params.source ?? 'discussion_entered',
    entry: params.entry,
    pendingAction: null,
    eventType: 'discussion_entered',
    eventPayload: {
      entry: params.entry ?? null,
    },
  });
}

async function markJoinTaskOutcome(params: {
  userId: string;
  activityId: string;
  resultOutcome: string;
  resultSummary: string;
  source: string;
}): Promise<void> {
  const openTask = await findOpenJoinTask({
    userId: params.userId,
    activityId: params.activityId,
  });
  const task = openTask ?? await findLatestJoinTaskByActivity({
    userId: params.userId,
    activityId: params.activityId,
  });

  const ensuredTask = task ?? await ensureTask({
    userId: params.userId,
    taskType: 'join_activity',
    activityId: params.activityId,
    goalText: params.resultSummary,
    defaultStage: 'done',
    source: params.source,
  });
  const wasAlreadyCompleted = isTerminalTaskStatus(ensuredTask.status);

  const completedTask = await updateJoinTask({
    task: ensuredTask,
    stage: 'done',
    status: 'completed',
    activityId: params.activityId,
    source: params.source,
    pendingAction: null,
    resultOutcome: params.resultOutcome,
    resultSummary: params.resultSummary,
    completedAt: new Date(),
    eventType: 'outcome_recorded',
    eventPayload: {
      resultOutcome: params.resultOutcome,
    },
  });

  if (wasAlreadyCompleted) {
    return;
  }

  await appendAgentTaskEvent({
    taskId: completedTask.id,
    userId: completedTask.userId,
    eventType: 'task_completed',
    fromStage: ensuredTask.currentStage,
    toStage: 'done',
    activityId: params.activityId,
    source: params.source,
    payload: {
      resultOutcome: params.resultOutcome,
    },
  });
}

export async function recordJoinTaskFulfillmentOutcome(params: {
  userId: string;
  activityId: string;
  attended: boolean | null;
  summary: string;
}): Promise<void> {
  const resultOutcome = params.attended === true
    ? 'fulfilled'
    : params.attended === false
      ? 'no_show'
      : 'fulfillment_recorded';

  await markJoinTaskOutcome({
    userId: params.userId,
    activityId: params.activityId,
    resultOutcome,
    resultSummary: params.summary,
    source: 'confirm_fulfillment',
  });
}

export async function recordJoinTaskRebookOutcome(params: {
  userId: string;
  activityId: string;
}): Promise<void> {
  await markJoinTaskOutcome({
    userId: params.userId,
    activityId: params.activityId,
    resultOutcome: 'rebook_triggered',
    resultSummary: '用户已表达这次活动的再约意愿。',
    source: 'rebook_follow_up',
  });
}

export async function recordJoinTaskReviewOutcome(params: {
  userId: string;
  activityId: string;
  reviewSummary: string;
}): Promise<void> {
  await markJoinTaskOutcome({
    userId: params.userId,
    activityId: params.activityId,
    resultOutcome: 'review_recorded',
    resultSummary: params.reviewSummary,
    source: 'activity_review',
  });
}

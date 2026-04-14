/**
 * Partner Matching - 找搭子追问流程
 *
 * 当用户想找搭子但信息不完整时，结构化追问收集偏好
 * 状态持久化到 conversation_messages，刷新不丢失
 */

import { db, conversationMessages, eq, desc } from '@xu/db';
import { randomUUID } from 'crypto';
import { createLogger } from '../observability/logger';
import { understandPartnerRequest, type PartnerScenarioType, type PartnerSemanticType } from './partner-understanding';

const logger = createLogger('partner-matching');

// ============ 类型定义 ============

export type PartnerActivityType = 'food' | 'entertainment' | 'sports' | 'boardgame' | 'other';
export type PartnerTimeRange = 'tonight' | 'tomorrow' | 'weekend' | 'next_week';
export type PartnerSportType = 'badminton' | 'basketball' | 'running' | 'tennis' | 'swimming' | 'cycling';

interface ParsedPartnerAnswer {
  field: string;
  value: string;
  tags?: string[];
}

/**
 * 找搭子追问状态
 */
export interface PartnerMatchingState {
  /** Workflow ID */
  workflowId: string;
  /** 初始原话 */
  rawInput: string;
  /** 状态 */
  status: 'collecting' | 'searching' | 'completed' | 'paused';
  /** 自然语言场景 */
  scenarioType?: PartnerScenarioType;
  /** 已收集的偏好 */
  collectedPreferences: {
    activityType?: string;
    sportType?: string;
    timeRange?: string;
    location?: string;
    description?: string;
    preferredGender?: string;
    preferredAgeRange?: string;
    participants?: string;
    tags?: string[];
  };
  /** 缺失的必填项 */
  missingRequired: string[];
  /** 追问轮次 */
  round: number;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/**
 * 追问问题
 */
export interface PartnerMatchingQuestion {
  field: string;
  question: string;
  options: Array<{ label: string; value: string; tags?: string[] }>;
}

/**
 * workflow 完成后可直接落 createPartnerIntent 的结构化参数
 */
export interface PartnerIntentDraftPayload {
  rawInput: string;
  activityType: PartnerActivityType;
  sportType?: PartnerSportType;
  locationHint: string;
  timePreference?: string;
  tags: string[];
}

export interface PartnerIntentFormFieldOption {
  label: string;
  value: string;
}

export interface PartnerIntentFormField {
  name: string;
  label: string;
  type: 'single-select' | 'multi-select' | 'textarea' | 'text';
  required?: boolean;
  options?: PartnerIntentFormFieldOption[];
  placeholder?: string;
  maxLength?: number;
}

export interface PartnerIntentFormPayload {
  title: string;
  schema: {
    formType: 'partner_intent';
    submitAction: 'search_partners' | 'submit_partner_intent_form' | 'opt_in_partner_pool';
    submitLabel: string;
    fields: PartnerIntentFormField[];
  };
  initialValues: Record<string, unknown>;
}

export interface PartnerAskPreferencePayload {
  status: 'collecting';
  questionType: 'location' | 'time' | 'type';
  question: string;
  options: Array<{
    label: string;
    value: string;
    action: 'find_partner';
    params: Record<string, unknown>;
  }>;
  allowSkip: true;
  collectedInfo: PartnerMatchingState['collectedPreferences'];
}

export type PartnerFormStage = 'refine_form' | 'intent_pool';

/**
 * 存储格式 (保持 type 值不变以兼容已存储数据)
 */
interface StoredPartnerMatchingState {
  type: 'broker_state';
  state: {
    workflowId: string;
    rawInput: string;
    status: PartnerMatchingState['status'];
    scenarioType?: PartnerScenarioType;
    collectedPreferences: Record<string, unknown>;
    missingRequired: string[];
    round: number;
    createdAt: string;
    updatedAt: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRequiredText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readPartnerMatchingStatus(value: unknown): PartnerMatchingState['status'] | null {
  switch (value) {
    case 'collecting':
    case 'searching':
    case 'completed':
    case 'paused':
      return value;
    default:
      return null;
  }
}

function readPartnerCollectedPreferences(
  value: unknown,
): PartnerMatchingState['collectedPreferences'] {
  if (!isRecord(value)) {
    return {};
  }

  const activityType = readRequiredText(value.activityType) ?? undefined;
  const sportType = readRequiredText(value.sportType) ?? undefined;
  const timeRange = readRequiredText(value.timeRange) ?? undefined;
  const location = readRequiredText(value.location) ?? undefined;
  const description = readRequiredText(value.description) ?? undefined;
  const preferredGender = readRequiredText(value.preferredGender) ?? undefined;
  const preferredAgeRange = readRequiredText(value.preferredAgeRange) ?? undefined;
  const participants = readRequiredText(value.participants) ?? undefined;
  const tags = readStringList(value.tags);

  return {
    ...(activityType ? { activityType } : {}),
    ...(sportType ? { sportType } : {}),
    ...(timeRange ? { timeRange } : {}),
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(preferredGender ? { preferredGender } : {}),
    ...(preferredAgeRange ? { preferredAgeRange } : {}),
    ...(participants ? { participants } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function readStoredPartnerMatchingState(value: unknown): StoredPartnerMatchingState | null {
  if (!isRecord(value) || value.type !== 'broker_state' || !isRecord(value.state)) {
    return null;
  }

  const workflowId = readRequiredText(value.state.workflowId);
  const rawInput = typeof value.state.rawInput === 'string' ? value.state.rawInput : '';
  const status = readPartnerMatchingStatus(value.state.status);
  const missingRequired = readStringList(value.state.missingRequired);
  const round = typeof value.state.round === 'number' && Number.isFinite(value.state.round)
    ? value.state.round
    : null;
  const createdAt = readRequiredText(value.state.createdAt);
  const updatedAt = readRequiredText(value.state.updatedAt);
  const scenarioType = value.state.scenarioType === 'local_partner'
    || value.state.scenarioType === 'destination_companion'
    || value.state.scenarioType === 'fill_seat'
    ? value.state.scenarioType
    : undefined;

  if (!workflowId || !status || round === null || !createdAt || !updatedAt) {
    return null;
  }

  return {
    type: 'broker_state',
    state: {
      workflowId,
      rawInput,
      status,
      ...(scenarioType ? { scenarioType } : {}),
      collectedPreferences: readPartnerCollectedPreferences(value.state.collectedPreferences),
      missingRequired,
      round,
      createdAt,
      updatedAt,
    },
  };
}

// ============ 配置 ============

const DEFAULT_REQUIRED_FIELDS: Array<'activityType' | 'location'> = ['activityType', 'location'];

const PARTNER_ACTIVITY_LABELS: Record<PartnerActivityType, string> = {
  food: '美食',
  entertainment: '娱乐',
  sports: '运动',
  boardgame: '桌游',
  other: '其他',
};

const PARTNER_SPORT_LABELS: Record<PartnerSportType, string> = {
  badminton: '羽毛球',
  basketball: '篮球',
  running: '跑步',
  tennis: '网球',
  swimming: '游泳',
  cycling: '骑行',
};

const PARTNER_TIME_LABELS: Record<PartnerTimeRange, string> = {
  tonight: '今晚',
  tomorrow: '明天',
  weekend: '周末',
  next_week: '下周',
};

const QUESTION_TEMPLATES: Record<string, PartnerMatchingQuestion> = {
  activityType: {
    field: 'activityType',
    question: '想玩点什么呢？',
    options: [
      { label: '吃饭', value: 'food' },
      { label: '娱乐', value: 'entertainment' },
      { label: '运动', value: 'sports' },
      { label: '桌游', value: 'boardgame' },
      { label: '喝咖啡', value: 'food', tags: ['Coffee'] },
    ],
  },
  sportType: {
    field: 'sportType',
    question: '想先找哪种运动搭子？',
    options: [
      { label: '羽毛球', value: 'badminton' },
      { label: '篮球', value: 'basketball' },
      { label: '跑步', value: 'running' },
      { label: '网球', value: 'tennis' },
      { label: '游泳', value: 'swimming' },
      { label: '骑行', value: 'cycling' },
    ],
  },
  timeRange: {
    field: 'timeRange',
    question: '什么时候方便？',
    options: [
      { label: '今晚', value: 'tonight' },
      { label: '明天', value: 'tomorrow' },
      { label: '周末', value: 'weekend' },
      { label: '下周', value: 'next_week' },
    ],
  },
  location: {
    field: 'location',
    question: '想在哪儿玩？',
    options: [
      { label: '观音桥', value: '观音桥' },
      { label: '解放碑', value: '解放碑' },
      { label: '南坪', value: '南坪' },
      { label: '沙坪坝', value: '沙坪坝' },
    ],
  },
  participants: {
    field: 'participants',
    question: '想约几个人？',
    options: [
      { label: '2-3人', value: '2-3' },
      { label: '4-6人', value: '4-6' },
      { label: '7人以上', value: '7+' },
      { label: '不限', value: 'any' },
    ],
  },
};


const PARTNER_LOCATION_OPTIONS = ['观音桥', '解放碑', '南坪', '沙坪坝', '江北嘴', '杨家坪', '大坪'];

const PARTNER_SPORT_OPTIONS: Array<{ label: string; value: PartnerSportType }> = [
  { label: '羽毛球', value: 'badminton' },
  { label: '篮球', value: 'basketball' },
  { label: '跑步', value: 'running' },
  { label: '网球', value: 'tennis' },
  { label: '游泳', value: 'swimming' },
  { label: '骑行', value: 'cycling' },
];

function mapSemanticTypeToPartnerActivityType(value: PartnerSemanticType): PartnerActivityType | undefined {
  switch (value) {
    case 'food':
    case 'sports':
    case 'boardgame':
    case 'entertainment':
      return value;
    default:
      return undefined;
  }
}

function inferPartnerActivityTypeFromText(message: string): PartnerActivityType | undefined {
  if (/(麻将|桌游|狼人杀|剧本杀)/.test(message)) {
    return 'boardgame';
  }
  if (/(火锅|烧烤|吃饭|约饭|咖啡|奶茶)/.test(message)) {
    return 'food';
  }
  if (/(唱歌|KTV|电影|酒吧|livehouse)/i.test(message)) {
    return 'entertainment';
  }
  if (/(羽毛球|篮球|跑步|徒步|运动|打球)/.test(message)) {
    return 'sports';
  }
  return undefined;
}

function inferPartnerSportTypeFromText(message: string): PartnerSportType | undefined {
  if (/(羽毛球)/.test(message)) return 'badminton';
  if (/(篮球)/.test(message)) return 'basketball';
  if (/(跑步|夜跑|晨跑|健走)/.test(message)) return 'running';
  if (/(网球)/.test(message)) return 'tennis';
  if (/(游泳)/.test(message)) return 'swimming';
  if (/(骑行|骑车)/.test(message)) return 'cycling';
  return undefined;
}

function inferPartnerTimeRangeFromText(message: string): PartnerTimeRange | undefined {
  if (/(今晚|今天|晚上)/.test(message)) return 'tonight';
  if (/(明天|明晚)/.test(message)) return 'tomorrow';
  if (/(周末|周六|周日)/.test(message)) return 'weekend';
  if (/(下周)/.test(message)) return 'next_week';
  return undefined;
}

function inferPartnerBudgetTypeFromText(message: string): 'AA' | 'Treat' | undefined {
  if (/(^|\b)aa(制)?(\b|$)/i.test(message)) return 'AA';
  if (/(请客|有人请|蹭饭)/.test(message)) return 'Treat';
  return undefined;
}

function inferPartnerTagsFromText(message: string): string[] {
  const tags: string[] = [];
  if (/(不喝酒)/.test(message)) tags.push('NoAlcohol');
  if (/(安静|别太闹|清净)/.test(message)) tags.push('Quiet');
  if (/(女生友好|女孩子友好)/.test(message)) tags.push('WomenFriendly');
  if (/(咖啡)/.test(message)) tags.push('Coffee');
  return Array.from(new Set(tags));
}

function inferPartnerLocationFromText(message: string): string | undefined {
  for (const location of PARTNER_LOCATION_OPTIONS) {
    if (message.includes(location)) {
      return location;
    }
  }
  return undefined;
}

function resolvePartnerRequiredFields(state: Pick<PartnerMatchingState, 'scenarioType'>): Array<'activityType' | 'location'> {
  if (state.scenarioType === 'destination_companion') {
    return ['location'];
  }

  return DEFAULT_REQUIRED_FIELDS;
}

function buildPartnerLocationQuestion(state: Pick<PartnerMatchingState, 'scenarioType'>): string {
  if (state.scenarioType === 'destination_companion') {
    return '你想一起去哪个地方，或者去哪个活动？';
  }

  return QUESTION_TEMPLATES.location.question;
}

function buildPartnerLocationPlaceholder(state: Pick<PartnerMatchingState, 'scenarioType'>): string {
  if (state.scenarioType === 'destination_companion') {
    return '比如泸州音乐节、平顶山、成都';
  }

  return '比如观音桥、南坪、大学城';
}

export function buildPartnerIntentFormPayload(params: {
  state: PartnerMatchingState;
  fallbackLocationHint: string;
  rawInput?: string;
  defaultActivityType?: string;
  defaultLocation?: string;
}): PartnerIntentFormPayload {
  const rawInput = params.rawInput?.trim() || params.state.rawInput.trim();
  const understanding = understandPartnerRequest(rawInput || '');
  const inferredActivityType = mapSemanticTypeToPartnerActivityType(understanding.activityType)
    || inferPartnerActivityTypeFromText(rawInput || '');
  const inferredSportType = inferPartnerSportTypeFromText(rawInput || '');
  const inferredTimeRange = understanding.normalizedTimeRange || inferPartnerTimeRangeFromText(rawInput || '');
  const inferredLocation = understanding.locationText
    || understanding.destinationText
    || inferPartnerLocationFromText(rawInput || '');

  const activityType = normalizePartnerActivityType(
    params.state.collectedPreferences.activityType
      || params.defaultActivityType
      || inferredActivityType
  );
  const sportType = activityType === 'sports'
    ? (params.state.collectedPreferences.sportType || inferredSportType || '')
    : '';
  const shouldAskActivityType = activityType === 'other' && understanding.scenarioType !== 'destination_companion';
  const selectedLocation = params.state.collectedPreferences.location
    || params.defaultLocation
    || inferredLocation
    || '';
  const normalizedLocation = PARTNER_LOCATION_OPTIONS.includes(selectedLocation)
    ? selectedLocation
    : '';

  const initialValues: Record<string, unknown> = {
    rawInput,
    activityType,
    sportType,
    timeRange: params.state.collectedPreferences.timeRange || inferredTimeRange || '',
    location: params.state.collectedPreferences.location || normalizedLocation,
    description: params.state.collectedPreferences.description || '',
    preferredGender: params.state.collectedPreferences.preferredGender || '',
    preferredAgeRange: params.state.collectedPreferences.preferredAgeRange || '',
  };

  const fields: PartnerIntentFormField[] = [];

  if (shouldAskActivityType) {
    fields.push({
      name: 'activityType',
      label: '想找哪类搭子',
      type: 'single-select',
      required: true,
      options: [
        { label: '吃饭', value: 'food' },
        { label: '娱乐', value: 'entertainment' },
        { label: '运动', value: 'sports' },
        { label: '麻将/桌游', value: 'boardgame' },
      ],
    });
  }

  if (activityType === 'sports') {
    fields.push({
      name: 'sportType',
      label: '想玩什么运动',
      type: 'single-select',
      required: true,
      options: PARTNER_SPORT_OPTIONS,
    });
  }

  fields.push(
    {
      name: 'timeRange',
      label: '什么时候方便',
      type: 'single-select',
      required: false,
      options: [
        { label: '今晚', value: 'tonight' },
        { label: '明天', value: 'tomorrow' },
        { label: '周末', value: 'weekend' },
        { label: '下周', value: 'next_week' },
      ],
    },
    {
      name: 'location',
      label: understanding.scenarioType === 'destination_companion' ? '你想一起去哪里' : '你一般在哪片活动方便',
      type: 'text',
      required: true,
      placeholder: buildPartnerLocationPlaceholder({ scenarioType: understanding.scenarioType }),
      maxLength: 30,
    },
    {
      name: 'description',
      label: '想找什么样的搭子',
      type: 'textarea',
      required: false,
      placeholder: activityType === 'sports'
        ? '比如想找一个周末能一起慢跑的人，不用太能聊，但别太鸽；最好在观音桥附近活动方便。'
        : '比如想找下班后能一起吃饭或散步的人，轻松点就行，别太临时放鸽子。',
      maxLength: 140,
    },
    {
      name: 'preferredGender',
      label: '希望对方性别',
      type: 'single-select',
      options: [
        { label: '不限', value: 'any' },
        { label: '女生', value: 'female' },
        { label: '男生', value: 'male' },
      ],
    },
    {
      name: 'preferredAgeRange',
      label: '希望对方年龄区间',
      type: 'single-select',
      options: [
        { label: '不限', value: 'any' },
        { label: '18-22', value: '18-22' },
        { label: '23-28', value: '23-28' },
        { label: '29-35', value: '29-35' },
      ],
    },
  );

  return {
    title: '想找什么样的搭子？',
    schema: {
      formType: 'partner_intent',
      submitAction: 'search_partners',
      submitLabel: '先帮我找找',
      fields,
    },
    initialValues,
  };
}

// ============ 核心函数 ============

export function shouldStartPartnerMatching(
  intent: string,
  existingState: PartnerMatchingState | null
): boolean {
  if (intent === 'partner' && !existingState) {
    return true;
  }
  if (existingState?.status === 'paused') {
    return true;
  }
  if (existingState?.status === 'collecting') {
    return true;
  }
  return false;
}

export function createPartnerMatchingState(rawInput: string): PartnerMatchingState {
  const now = new Date();
  const understanding = understandPartnerRequest(rawInput);
  const inferredActivityType = mapSemanticTypeToPartnerActivityType(understanding.activityType)
    || inferPartnerActivityTypeFromText(rawInput);
  const inferredSportType = inferPartnerSportTypeFromText(rawInput);
  const inferredTimeRange = understanding.normalizedTimeRange || inferPartnerTimeRangeFromText(rawInput);
  const inferredLocation = understanding.locationText
    || understanding.destinationText
    || inferPartnerLocationFromText(rawInput);
  const inferredTags = Array.from(new Set([
    ...understanding.constraints,
    ...inferPartnerTagsFromText(rawInput),
  ]));
  const inferredGenericType = !inferredActivityType && understanding.scenarioType === 'destination_companion'
    ? 'other'
    : undefined;
  const collectedPreferences: PartnerMatchingState['collectedPreferences'] = {
    ...((inferredActivityType || inferredGenericType) ? { activityType: inferredActivityType || inferredGenericType } : {}),
    ...(inferredSportType ? { sportType: inferredSportType } : {}),
    ...(inferredTimeRange ? { timeRange: inferredTimeRange } : {}),
    ...(inferredLocation ? { location: inferredLocation } : {}),
    ...(
      understanding.activityText || understanding.destinationText
        ? {
            description: [
              understanding.destinationText,
              understanding.activityText,
              understanding.timeText,
            ].filter(Boolean).join(' '),
          }
        : {}
    ),
    ...(inferredTags.length > 0 ? { tags: inferredTags } : {}),
  };
  const requiredFields = resolvePartnerRequiredFields({ scenarioType: understanding.scenarioType });
  const missingRequired: string[] = requiredFields.filter((field) => {
    if (field === 'activityType') {
      return !collectedPreferences.activityType;
    }

    return !collectedPreferences.location;
  });

  if (collectedPreferences.activityType === 'sports' && !collectedPreferences.sportType) {
    missingRequired.unshift('sportType');
  }

  return {
    workflowId: randomUUID(),
    rawInput,
    status: 'collecting',
    scenarioType: understanding.scenarioType,
    collectedPreferences,
    missingRequired,
    round: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function updatePartnerMatchingState(
  state: PartnerMatchingState,
  answer: ParsedPartnerAnswer
): PartnerMatchingState {
  const mergedTags = Array.from(new Set([
    ...(state.collectedPreferences.tags || []),
    ...(answer.tags || []),
  ]));

  const nextPreferences: PartnerMatchingState['collectedPreferences'] = {
    ...state.collectedPreferences,
    [answer.field]: answer.value,
  };

  if (mergedTags.length > 0) {
    nextPreferences.tags = mergedTags;
  }

  const newState: PartnerMatchingState = {
    ...state,
    collectedPreferences: nextPreferences,
    round: state.round + 1,
    updatedAt: new Date(),
  };

  const requiredFields = resolvePartnerRequiredFields(newState);
  newState.missingRequired = requiredFields.filter((field) => {
    if (field === 'activityType') {
      return !newState.collectedPreferences.activityType;
    }

    return !newState.collectedPreferences.location;
  });

  if (newState.collectedPreferences.activityType === 'sports' && !newState.collectedPreferences.sportType) {
    newState.missingRequired.unshift('sportType');
  }

  if (newState.missingRequired.length === 0) {
    newState.status = 'searching';
  }

  return newState;
}

export function pausePartnerMatchingState(state: PartnerMatchingState): PartnerMatchingState {
  return {
    ...state,
    status: 'paused',
    updatedAt: new Date(),
  };
}

export function completePartnerMatchingState(state: PartnerMatchingState): PartnerMatchingState {
  return {
    ...state,
    status: 'completed',
    updatedAt: new Date(),
  };
}

export function getNextQuestion(state: PartnerMatchingState): PartnerMatchingQuestion | null {
  if (state.missingRequired.length > 0) {
    const field = state.missingRequired[0];
    const template = QUESTION_TEMPLATES[field];
    if (!template) {
      return null;
    }

    if (field === 'location') {
      return {
        ...template,
        question: buildPartnerLocationQuestion(state),
      };
    }

    return template;
  }

  return null;
}

export function buildAskPrompt(state: PartnerMatchingState): string {
  const question = getNextQuestion(state);
  if (!question) {
    return '好的，让我帮你找找有没有合适的活动～';
  }
  return question.question;
}

export function looksLikePartnerAnswer(
  message: string,
  currentQuestion: PartnerMatchingQuestion | null
): boolean {
  if (!currentQuestion) return false;

  const trimmed = message.trim();
  if (!trimmed) return false;

  const lowerMessage = trimmed.toLowerCase();
  const cancelPatterns = ['算了', '不找了', '取消', '不要了', '换个'];
  if (cancelPatterns.some(pattern => trimmed.includes(pattern))) {
    return false;
  }

  for (const option of currentQuestion.options) {
    if (lowerMessage.includes(option.label.toLowerCase()) || lowerMessage.includes(option.value.toLowerCase())) {
      return true;
    }
  }

  if (currentQuestion.field === 'activityType') {
    return /(吃饭|火锅|烧烤|咖啡|喝|游戏|唱歌|ktv|运动|打球|篮球|羽毛球|桌游|狼人杀|剧本杀)/i.test(trimmed);
  }

  if (currentQuestion.field === 'timeRange') {
    return /(今晚|今天|晚上|明天|明晚|周末|周六|周日|下周|八点|8点|九点|9点)/.test(trimmed);
  }

  if (currentQuestion.field === 'sportType') {
    return /(羽毛球|篮球|跑步|夜跑|晨跑|健走|网球|游泳|骑行|骑车)/.test(trimmed);
  }

  if (currentQuestion.field === 'location') {
    return /(观音桥|解放碑|南坪|沙坪坝|江北|杨家坪|大坪|附近)/.test(trimmed);
  }

  return trimmed.length <= 12 && !/[？?]/.test(trimmed);
}

export function inferPartnerMessageHints(message: string): {
  location?: string;
  tags?: string[];
} {
  const hints: { location?: string; tags?: string[] } = {};
  const understanding = understandPartnerRequest(message);
  if (understanding.locationText || understanding.destinationText) {
    hints.location = understanding.locationText || understanding.destinationText;
  }

  if (understanding.constraints.length > 0) {
    hints.tags = [...understanding.constraints];
  }

  const locations = ['观音桥', '解放碑', '南坪', '沙坪坝', '江北嘴', '杨家坪', '大坪'];
  for (const location of locations) {
    if (!hints.location && message.includes(location)) {
      hints.location = location;
      break;
    }
  }

  const tags: string[] = [...(hints.tags || [])];
  if (/(^|\b)aa(制)?(\b|$)/i.test(message)) {
    tags.push('AA');
  }
  if (tags.length > 0) {
    hints.tags = tags;
  }

  return hints;
}

export function parseUserAnswer(
  message: string,
  currentQuestion: PartnerMatchingQuestion | null
): ParsedPartnerAnswer | null {
  if (!currentQuestion) return null;

  const lowerMessage = message.toLowerCase();

  for (const option of currentQuestion.options) {
    if (lowerMessage.includes(option.label.toLowerCase()) ||
        lowerMessage.includes(option.value.toLowerCase())) {
      return { field: currentQuestion.field, value: option.value, tags: option.tags };
    }
  }

  if (currentQuestion.field === 'activityType') {
    const typeMap: Record<string, { value: string; tags?: string[] }> = {
      '吃饭': { value: 'food' },
      '吃': { value: 'food' },
      '饭': { value: 'food' },
      '火锅': { value: 'food' },
      '烧烤': { value: 'food' },
      '游戏': { value: 'entertainment' },
      '玩': { value: 'entertainment' },
      '唱歌': { value: 'entertainment' },
      'ktv': { value: 'entertainment' },
      '运动': { value: 'sports' },
      '打球': { value: 'sports' },
      '篮球': { value: 'sports' },
      '羽毛球': { value: 'sports' },
      '桌游': { value: 'boardgame' },
      '狼人杀': { value: 'boardgame' },
      '剧本杀': { value: 'boardgame' },
      '咖啡': { value: 'food', tags: ['Coffee'] },
      '喝': { value: 'food', tags: ['Coffee'] },
    };
    for (const [keyword, matched] of Object.entries(typeMap)) {
      if (lowerMessage.includes(keyword)) {
        return { field: 'activityType', value: matched.value, tags: matched.tags };
      }
    }
  }

  if (currentQuestion.field === 'timeRange') {
    const timeMap: Record<string, string> = {
      '今晚': 'tonight',
      '今天': 'tonight',
      '晚上': 'tonight',
      '明天': 'tomorrow',
      '明晚': 'tomorrow',
      '周末': 'weekend',
      '周六': 'weekend',
      '周日': 'weekend',
      '下周': 'next_week',
    };
    for (const [keyword, value] of Object.entries(timeMap)) {
      if (lowerMessage.includes(keyword)) {
        return { field: 'timeRange', value };
      }
    }
  }

  if (currentQuestion.field === 'sportType') {
    const sportMap: Record<string, string> = {
      '羽毛球': 'badminton',
      '篮球': 'basketball',
      '跑步': 'running',
      '夜跑': 'running',
      '晨跑': 'running',
      '健走': 'running',
      '网球': 'tennis',
      '游泳': 'swimming',
      '骑行': 'cycling',
      '骑车': 'cycling',
    };
    for (const [keyword, value] of Object.entries(sportMap)) {
      if (lowerMessage.includes(keyword)) {
        return { field: 'sportType', value };
      }
    }
  }

  if (currentQuestion.field === 'location') {
    const locations = ['观音桥', '解放碑', '南坪', '沙坪坝', '江北嘴', '杨家坪', '大坪'];
    for (const loc of locations) {
      if (message.includes(loc)) {
        return { field: 'location', value: loc };
      }
    }
  }

  return { field: currentQuestion.field, value: message.trim() || message };
}

export function normalizePartnerActivityType(value: string | undefined): PartnerActivityType {
  if (value === 'food' || value === 'entertainment' || value === 'sports' || value === 'boardgame' || value === 'other') {
    return value;
  }
  if (value === 'coffee') {
    return 'food';
  }
  return 'other';
}

export function normalizePartnerSportType(value: string | undefined): PartnerSportType | undefined {
  if (
    value === 'badminton'
    || value === 'basketball'
    || value === 'running'
    || value === 'tennis'
    || value === 'swimming'
    || value === 'cycling'
  ) {
    return value;
  }

  return undefined;
}

export function hydratePartnerMatchingStateFromPayload(
  state: PartnerMatchingState,
  payload: Record<string, unknown>
): PartnerMatchingState {
  const collectedInfo = isRecord(payload.collectedInfo) ? payload.collectedInfo : null;
  const activityType = readOptionalText(payload.activityType)
    || readOptionalText(payload.type)
    || readOptionalText(collectedInfo?.activityType);
  const sportType = readOptionalText(payload.sportType) || readOptionalText(collectedInfo?.sportType);
  const timeRange = readOptionalText(payload.timeRange) || readOptionalText(collectedInfo?.timeRange);
  const location = readOptionalText(payload.location)
    || readOptionalText(payload.locationName)
    || readOptionalText(collectedInfo?.location);
  const description = readOptionalText(payload.description) || readOptionalText(collectedInfo?.description);
  const preferredGender = readOptionalText(payload.preferredGender) || readOptionalText(collectedInfo?.preferredGender);
  const preferredAgeRange = readOptionalText(payload.preferredAgeRange) || readOptionalText(collectedInfo?.preferredAgeRange);
  const tags = Array.from(new Set([
    ...(state.collectedPreferences.tags || []),
    ...readStringList(payload.tags),
    ...readStringList(collectedInfo?.tags),
  ]));

  const collectedPreferences: PartnerMatchingState['collectedPreferences'] = {
    ...state.collectedPreferences,
    ...(activityType ? { activityType: normalizePartnerActivityType(activityType) } : {}),
    ...(sportType ? { sportType: normalizePartnerSportType(sportType) } : {}),
    ...(timeRange ? { timeRange } : {}),
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(preferredGender ? { preferredGender } : {}),
    ...(preferredAgeRange ? { preferredAgeRange } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };

  const requiredFields = resolvePartnerRequiredFields(state);
  const missingRequired: string[] = requiredFields.filter((field) => {
    if (field === 'activityType') {
      return !collectedPreferences.activityType;
    }

    return !collectedPreferences.location;
  });

  if (collectedPreferences.activityType === 'sports' && !collectedPreferences.sportType) {
    missingRequired.unshift('sportType');
  }

  return {
    ...state,
    collectedPreferences,
    missingRequired,
    status: missingRequired.length === 0 ? 'searching' : 'collecting',
    updatedAt: new Date(),
  };
}

export function getPartnerActivityTypeLabel(value: string | undefined): string {
  return PARTNER_ACTIVITY_LABELS[normalizePartnerActivityType(value)] || '其他';
}

export function getPartnerSportTypeLabel(value: string | undefined): string {
  const normalized = normalizePartnerSportType(value);
  return normalized ? PARTNER_SPORT_LABELS[normalized] : '';
}

export function getPartnerTimeLabel(value: string | undefined): string {
  if (!value) return '待定';
  switch (value) {
    case 'tonight':
    case 'tomorrow':
    case 'weekend':
    case 'next_week':
      return PARTNER_TIME_LABELS[value];
    default:
      return value;
  }
}

export function buildPartnerWorkflowIntroText(state: PartnerMatchingState): string {
  const resolvedTypeLabel = state.collectedPreferences.activityType === 'sports'
    ? getPartnerSportTypeLabel(state.collectedPreferences.sportType)
      || getPartnerActivityTypeLabel(state.collectedPreferences.activityType)
    : getPartnerActivityTypeLabel(state.collectedPreferences.activityType);
  const resolvedLocationLabel = state.collectedPreferences.location?.trim() || '';

  if (state.scenarioType === 'destination_companion') {
    if (resolvedLocationLabel) {
      return `你想找一起去${resolvedLocationLabel}的人，我先按“同去/同行”这个方向帮你收窄。`;
    }

    return '你像是在找一起去同一个地方或活动的人，我先按“同去/同行”这个方向帮你收窄。';
  }

  if (state.scenarioType === 'fill_seat') {
    if (resolvedLocationLabel) {
      return `你像是在找${resolvedLocationLabel}这边的临时补位，我先按补位方向帮你收窄。`;
    }

    return '你像是在找临时补位的人，我先按补位方向帮你收窄。';
  }

  if (resolvedTypeLabel && resolvedLocationLabel) {
    return `你想找${resolvedLocationLabel}附近的${resolvedTypeLabel}搭子，我先按这个方向帮你收窄。`;
  }

  if (resolvedTypeLabel) {
    return `我先按${resolvedTypeLabel}搭子这个方向帮你收窄，再补一个最关键的条件。`;
  }

  if (resolvedLocationLabel) {
    return `我先按${resolvedLocationLabel}附近帮你找搭子，再补一个最关键的条件。`;
  }

  return '我先按你刚才说的方向帮你收窄，再补一个最关键的条件。';
}

function resolvePartnerQuestionType(field: string): 'location' | 'time' | 'type' {
  if (field === 'location') {
    return 'location';
  }

  if (field === 'timeRange') {
    return 'time';
  }

  return 'type';
}

export function buildPartnerAskPreferencePayload(
  state: PartnerMatchingState
): PartnerAskPreferencePayload | null {
  const nextQuestion = getNextQuestion(state);
  if (!nextQuestion) {
    return null;
  }

  const optionList = nextQuestion.field === 'location' && state.scenarioType === 'destination_companion'
    ? []
    : nextQuestion.options;

  return {
    status: 'collecting',
    questionType: resolvePartnerQuestionType(nextQuestion.field),
    question: nextQuestion.question,
    options: optionList.map((option) => ({
      label: option.label,
      value: option.value,
      action: 'find_partner',
      params: {
        rawInput: state.rawInput,
        collectedInfo: state.collectedPreferences,
        ...(nextQuestion.field === 'location'
          ? {
              location: option.value,
              locationName: option.label,
            }
          : {}),
        ...(nextQuestion.field === 'activityType'
          ? {
              activityType: option.value,
            }
          : {}),
        ...(nextQuestion.field === 'sportType'
          ? {
              activityType: 'sports',
              sportType: option.value,
            }
          : {}),
        ...(nextQuestion.field === 'timeRange'
          ? {
              timeRange: option.value,
              slot: option.value,
            }
          : {}),
      },
    })),
    allowSkip: true,
    collectedInfo: state.collectedPreferences,
  };
}

export function buildPartnerSearchPayloadFromState(
  state: PartnerMatchingState
): Record<string, unknown> {
  return {
    rawInput: state.rawInput,
    ...(state.collectedPreferences.activityType ? { activityType: state.collectedPreferences.activityType } : {}),
    ...(state.collectedPreferences.sportType ? { sportType: state.collectedPreferences.sportType } : {}),
    ...(state.collectedPreferences.timeRange ? { timeRange: state.collectedPreferences.timeRange } : {}),
    ...(state.collectedPreferences.location ? { location: state.collectedPreferences.location } : {}),
    ...(state.collectedPreferences.description ? { description: state.collectedPreferences.description } : {}),
    ...(state.collectedPreferences.preferredGender ? { preferredGender: state.collectedPreferences.preferredGender } : {}),
    ...(state.collectedPreferences.preferredAgeRange ? { preferredAgeRange: state.collectedPreferences.preferredAgeRange } : {}),
  };
}

export function shouldRenderPartnerIntentFormFromPayload(
  payload: Record<string, unknown>
): boolean {
  const renderMode = readOptionalText(payload.renderMode);
  const partnerStage = readOptionalText(payload.partnerStage);
  return renderMode === 'full-form' || partnerStage === 'refine_form' || partnerStage === 'intent_pool';
}

export function resolvePartnerFormStageFromPayload(
  payload: Record<string, unknown>
): PartnerFormStage | undefined {
  const partnerStage = readOptionalText(payload.partnerStage);
  if (partnerStage === 'refine_form' || partnerStage === 'intent_pool') {
    return partnerStage;
  }

  if (readOptionalText(payload.renderMode) === 'full-form') {
    return 'refine_form';
  }

  return undefined;
}

export function buildPartnerIntentPayload(
  state: PartnerMatchingState,
  fallbackLocationHint: string
): PartnerIntentDraftPayload {
  const normalizedType = normalizePartnerActivityType(state.collectedPreferences.activityType);
  const sportType = typeof state.collectedPreferences.sportType === 'string'
    ? state.collectedPreferences.sportType.trim()
    : '';
  const sportLabel = sportType && sportType in PARTNER_SPORT_LABELS
    ? PARTNER_SPORT_LABELS[sportType as PartnerSportType]
    : '';
  const timePreference = state.collectedPreferences.timeRange
    ? getPartnerTimeLabel(state.collectedPreferences.timeRange)
    : undefined;

  const tags = Array.from(new Set([
    ...(state.collectedPreferences.tags || []),
    ...(state.rawInput.includes('咖啡') ? ['Coffee'] : []),
  ]));

  const rawInput = state.rawInput.trim() || [
    timePreference ? `${timePreference}` : '',
    state.collectedPreferences.location || fallbackLocationHint,
    sportLabel ? `${sportLabel}搭子` : `${getPartnerActivityTypeLabel(normalizedType)}搭子`,
  ].filter(Boolean).join(' ');

  return {
    rawInput,
    activityType: normalizedType,
    ...(sportType ? { sportType: sportType as PartnerSportType } : {}),
    locationHint: state.collectedPreferences.location?.trim() || fallbackLocationHint,
    ...(timePreference ? { timePreference } : {}),
    tags,
  };
}

export function isTopicSwitch(message: string, currentIntent: string): boolean {
  if (currentIntent !== 'partner') {
    return true;
  }

  const cancelPatterns = ['算了', '不找了', '取消', '不要了', '换个'];
  return cancelPatterns.some(pattern => message.includes(pattern));
}

// ============ 持久化 ============

export async function persistPartnerMatchingState(
  conversationId: string,
  userId: string,
  state: PartnerMatchingState
): Promise<void> {
  try {
    const content: StoredPartnerMatchingState = {
      type: 'broker_state',
      state: {
        workflowId: state.workflowId,
        rawInput: state.rawInput,
        status: state.status,
        ...(state.scenarioType ? { scenarioType: state.scenarioType } : {}),
        collectedPreferences: state.collectedPreferences,
        missingRequired: state.missingRequired,
        round: state.round,
        createdAt: state.createdAt.toISOString(),
        updatedAt: state.updatedAt.toISOString(),
      },
    };

    await db.insert(conversationMessages).values({
      conversationId,
      userId,
      role: 'assistant',
      messageType: 'widget_ask_preference',
      content,
    });

    logger.debug('Partner matching state persisted', { workflowId: state.workflowId, status: state.status });
  } catch (error) {
    logger.error('Failed to persist partner matching state', { error });
  }
}

export async function recoverPartnerMatchingState(
  conversationId: string
): Promise<PartnerMatchingState | null> {
  try {
    const messages = await db.query.conversationMessages.findMany({
      where: eq(conversationMessages.conversationId, conversationId),
      orderBy: [desc(conversationMessages.createdAt)],
      limit: 20,
    });

    for (const msg of messages) {
      const content = readStoredPartnerMatchingState(msg.content);
      if (content?.type === 'broker_state' && content.state) {
        const stored = content.state;
        const updatedAt = new Date(stored.updatedAt);
        if (Date.now() - updatedAt.getTime() > 30 * 60 * 1000) {
          logger.debug('Partner matching state expired', { workflowId: stored.workflowId });
          return null;
        }

        if (stored.status === 'completed') {
          return null;
        }

        return {
          workflowId: stored.workflowId,
          rawInput: stored.rawInput || '',
          status: stored.status,
          ...(stored.scenarioType ? { scenarioType: stored.scenarioType } : {}),
          collectedPreferences: readPartnerCollectedPreferences(stored.collectedPreferences),
          missingRequired: stored.missingRequired,
          round: stored.round,
          createdAt: new Date(stored.createdAt),
          updatedAt: new Date(stored.updatedAt),
        };
      }
    }

    return null;
  } catch (error) {
    logger.error('Failed to recover partner matching state', { error });
    return null;
  }
}

export async function clearPartnerMatchingState(conversationId: string): Promise<void> {
  logger.debug('Partner matching state cleared', { conversationId });
}

/**
 * Partner Matching - 找搭子追问流程
 *
 * 当用户想找搭子但信息不完整时，结构化追问收集偏好
 * 状态持久化到 conversation_messages，刷新不丢失
 */

import { db, conversationMessages, eq, desc } from '@juchang/db';
import { randomUUID } from 'crypto';
import { createLogger } from '../observability/logger';

const logger = createLogger('partner-matching');

// ============ 类型定义 ============

export type PartnerActivityType = 'food' | 'entertainment' | 'sports' | 'boardgame' | 'other';
export type PartnerTimeRange = 'tonight' | 'tomorrow' | 'weekend' | 'next_week';

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
  /** 已收集的偏好 */
  collectedPreferences: {
    activityType?: string;
    timeRange?: string;
    location?: string;
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
  type: 'single-select' | 'multi-select' | 'textarea';
  required?: boolean;
  options?: PartnerIntentFormFieldOption[];
  placeholder?: string;
  maxLength?: number;
}

export interface PartnerIntentFormPayload {
  title: string;
  schema: {
    formType: 'partner_intent';
    submitAction: 'submit_partner_intent_form';
    submitLabel: string;
    fields: PartnerIntentFormField[];
  };
  initialValues: Record<string, unknown>;
}

/**
 * 存储格式 (保持 type 值不变以兼容已存储数据)
 */
interface StoredPartnerMatchingState {
  type: 'broker_state';
  state: {
    workflowId: string;
    rawInput: string;
    status: string;
    collectedPreferences: Record<string, unknown>;
    missingRequired: string[];
    round: number;
    createdAt: string;
    updatedAt: string;
  };
}

// ============ 配置 ============

const REQUIRED_FIELDS = ['activityType', 'timeRange'];

const PARTNER_ACTIVITY_LABELS: Record<PartnerActivityType, string> = {
  food: '美食',
  entertainment: '娱乐',
  sports: '运动',
  boardgame: '桌游',
  other: '其他',
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
    question: '想玩点什么呢？🎯',
    options: [
      { label: '🍲 吃饭', value: 'food' },
      { label: '🎮 娱乐', value: 'entertainment' },
      { label: '⚽ 运动', value: 'sports' },
      { label: '🎲 桌游', value: 'boardgame' },
      { label: '☕ 喝咖啡', value: 'food', tags: ['Coffee'] },
    ],
  },
  timeRange: {
    field: 'timeRange',
    question: '什么时候方便？⏰',
    options: [
      { label: '今晚', value: 'tonight' },
      { label: '明天', value: 'tomorrow' },
      { label: '周末', value: 'weekend' },
      { label: '下周', value: 'next_week' },
    ],
  },
  location: {
    field: 'location',
    question: '想在哪儿玩？🗺️',
    options: [
      { label: '观音桥', value: '观音桥' },
      { label: '解放碑', value: '解放碑' },
      { label: '南坪', value: '南坪' },
      { label: '沙坪坝', value: '沙坪坝' },
    ],
  },
  participants: {
    field: 'participants',
    question: '想约几个人？👥',
    options: [
      { label: '2-3人', value: '2-3' },
      { label: '4-6人', value: '4-6' },
      { label: '7人以上', value: '7+' },
      { label: '不限', value: 'any' },
    ],
  },
};


const PARTNER_LOCATION_OPTIONS = ['观音桥', '解放碑', '南坪', '沙坪坝', '江北嘴', '杨家坪', '大坪'];

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

export function buildPartnerIntentFormPayload(params: {
  state: PartnerMatchingState;
  fallbackLocationHint: string;
  rawInput?: string;
  defaultActivityType?: string;
  defaultLocation?: string;
}): PartnerIntentFormPayload {
  const rawInput = params.rawInput?.trim() || params.state.rawInput.trim();
  const inferredActivityType = inferPartnerActivityTypeFromText(rawInput || '');
  const inferredTimeRange = inferPartnerTimeRangeFromText(rawInput || '');
  const inferredBudgetType = inferPartnerBudgetTypeFromText(rawInput || '');
  const inferredLocation = inferPartnerLocationFromText(rawInput || '');
  const inferredTags = inferPartnerTagsFromText(rawInput || '');
  const mergedTags = Array.from(new Set([
    ...(params.state.collectedPreferences.tags || []),
    ...inferredTags,
  ]));

  const activityType = normalizePartnerActivityType(
    params.state.collectedPreferences.activityType
      || params.defaultActivityType
      || inferredActivityType
  );

  const initialValues: Record<string, unknown> = {
    rawInput,
    activityType,
    timeRange: params.state.collectedPreferences.timeRange || inferredTimeRange || '',
    location: params.state.collectedPreferences.location || params.defaultLocation || inferredLocation || params.fallbackLocationHint,
    budgetType: inferredBudgetType || '',
    tags: mergedTags,
    note: '',
  };

  return {
    title: '找搭子偏好',
    schema: {
      formType: 'partner_intent',
      submitAction: 'submit_partner_intent_form',
      submitLabel: '开始找搭子',
      fields: [
        {
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
        },
        {
          name: 'timeRange',
          label: '什么时候方便',
          type: 'single-select',
          required: true,
          options: [
            { label: '今晚', value: 'tonight' },
            { label: '明天', value: 'tomorrow' },
            { label: '周末', value: 'weekend' },
            { label: '下周', value: 'next_week' },
          ],
        },
        {
          name: 'location',
          label: '大概在哪儿',
          type: 'single-select',
          required: true,
          options: PARTNER_LOCATION_OPTIONS.map((location) => ({ label: location, value: location })),
        },
        {
          name: 'budgetType',
          label: '费用方式',
          type: 'single-select',
          options: [
            { label: 'AA制', value: 'AA' },
            { label: '有人请客也行', value: 'Treat' },
            { label: '都可以', value: 'Flexible' },
          ],
        },
        {
          name: 'tags',
          label: '特别要求',
          type: 'multi-select',
          options: [
            { label: '不喝酒', value: 'NoAlcohol' },
            { label: '安静点的', value: 'Quiet' },
            { label: '女生友好', value: 'WomenFriendly' },
            { label: '没有特别要求', value: 'NoPreference' },
          ],
        },
        {
          name: 'note',
          label: '补充说明',
          type: 'textarea',
          placeholder: '比如想凑一桌麻将，接受新手，或希望离地铁口近一点',
          maxLength: 80,
        },
      ],
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
  return {
    workflowId: randomUUID(),
    rawInput,
    status: 'collecting',
    collectedPreferences: {},
    missingRequired: [...REQUIRED_FIELDS],
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

  newState.missingRequired = REQUIRED_FIELDS.filter(
    field => !newState.collectedPreferences[field as keyof typeof newState.collectedPreferences]
  );

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
    return QUESTION_TEMPLATES[field] || null;
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
  const locations = ['观音桥', '解放碑', '南坪', '沙坪坝', '江北嘴', '杨家坪', '大坪'];
  for (const location of locations) {
    if (message.includes(location)) {
      hints.location = location;
      break;
    }
  }

  const tags: string[] = [];
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

export function getPartnerActivityTypeLabel(value: string | undefined): string {
  return PARTNER_ACTIVITY_LABELS[normalizePartnerActivityType(value)] || '其他';
}

export function getPartnerTimeLabel(value: string | undefined): string {
  if (!value) return '待定';
  return PARTNER_TIME_LABELS[value as PartnerTimeRange] || value;
}

export function buildPartnerIntentPayload(
  state: PartnerMatchingState,
  fallbackLocationHint: string
): PartnerIntentDraftPayload {
  const normalizedType = normalizePartnerActivityType(state.collectedPreferences.activityType);
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
    `${getPartnerActivityTypeLabel(normalizedType)}搭子`,
  ].filter(Boolean).join(' ');

  return {
    rawInput,
    activityType: normalizedType,
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
      const content = msg.content as StoredPartnerMatchingState | null;
      if (content?.type === 'broker_state' && content?.state) {
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
          status: stored.status as PartnerMatchingState['status'],
          collectedPreferences: stored.collectedPreferences as PartnerMatchingState['collectedPreferences'],
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

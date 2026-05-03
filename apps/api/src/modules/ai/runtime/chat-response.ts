import { randomUUID } from 'crypto';
import type {
  GenUIBlock,
  GenUIChoiceOption,
  GenUIRequest,
  GenUIRequestAi,
  GenUIRequestContext,
  GenUIStreamEvent,
  GenUIRecentMessage,
  GenUITracePayload,
  GenUISuggestions,
  GenUIResponseEnvelope,
} from '@xu/genui-contract';
import type { ChatExecutionResult, ChatRequest } from '../ai.service';
import { createThread } from '../memory';
import { extractStructuredAction, isStructuredActionType } from '../user-action';
import {
  buildSuggestionsFromBlocks,
  readSuggestionsFromStoredMessage,
  resolveContinuationFromSuggestions,
} from '../suggestions';
import {
  createTextBlock,
  createListBlock,
  createChoiceBlock,
  createEntityCardBlock,
  createCtaGroupBlock,
  createAlertBlock,
  createFormBlock,
  pushBlock,
} from '../shared/genui-blocks';
import { saveActivityReviewSummary } from '../../participants/participant.service';
import {
  resolveOpenCreateTaskForConversation,
  resolveOpenJoinTaskForConversation,
  resolveOpenPartnerTaskForConversation,
} from '../task-runtime/agent-task.service';
import {
  buildPartnerIntentFormPayload,
  createPartnerMatchingState,
  shouldRenderPartnerIntentFormFromPayload,
} from '../workflow/partner-matching';
import { normalizeAiProviderErrorMessage } from '../models/provider-error';

const ID_PREFIX = {
  conversation: 'conv',
  trace: 'trace',
  response: 'response',
  block: 'block',
  event: 'evt',
} as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidLike(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

const MAX_PRIVATE_HISTORY_MESSAGES = 10;
const MAX_ACTIVITY_HISTORY_MESSAGES = 6;
const SUMMARY_SOURCE_MESSAGES = 6;

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

const EXPLORE_TEXT_PATTERN = /(附近.*(局|活动|好玩的)|有什么(局|活动)|推荐|找个局|找局|看看.*局|约饭|吃饭|火锅|羽毛球|桌游|咖啡)/;
const EXPLORE_FOLLOWUP_PATTERN = /(有没有|还有|那|换成|改成|最好|预算|今晚|明天|周末|八点|8点|不吃辣|别太闹|安静|AA|清淡|轻松|都可以|都行|随便)/;
const CREATE_FROM_EXPLORE_PATTERN = /(我来组|我想自己组|我自己组|我来发|我自己发|帮我组一个|那就我来组|那我自己发)/;
const CREATE_ACTIVITY_PATTERN = /(组|租|约).{0,8}局|想.*局|周五.*局/;
const CREATE_PUBLISH_PATTERN = /(发吧|发布吧|就这样发|确认发布|发出去|直接发)/;
const CREATE_DRAFT_UPDATE_PATTERN = /(改成|换成|地点|位置|时间|人数|几个人|今晚|明天|周末|观音桥|解放碑|南坪|江北嘴|杨家坪|大坪|沙坪坝|\d+\s*人)/;
const PARTNER_ENTRY_PATTERN = /(找搭子|求搭子|找[^，。！？\s]{0,12}搭子|约人)/;
const PARTNER_FOLLOWUP_PATTERN = /(找搭子|求搭子|找[^，。！？\s]{0,12}搭子|搭子|一起|同去|桌游|吃饭|火锅|羽毛球|运动|今晚|明天|周末|下周|观音桥|解放碑|南坪|AA|安静|不喝酒|女生友好|都可以|随便)/;
const REVIEW_SUMMARY_MAX_LENGTH = 280;


interface ViewerContext {
  id: string;
  role: string;
}

type ActivityMode = NonNullable<GenUIRequestContext['activityMode']>;
type ChatAiParams = GenUIRequestAi;
type ExecutionPath = 'llm_orchestrated' | 'structured_action';
type ConversationMode = 'authenticated_persistent' | 'anonymous_transient';
type HistorySource = 'db' | 'request_transient' | 'empty';
type HistoryScope = 'private' | 'activity';

interface AiChatResponseOptions {
  viewer?: ViewerContext | null;
  abortSignal?: AbortSignal;
}

interface ResolvedStreamOptions {
  includeTrace: boolean;
  eventEnvelope: 'full' | 'compact';
}

export interface AiChatEnvelopeResult {
  envelope: GenUIResponseEnvelope;
  traces: GenUITracePayload[];
  resolvedStructuredAction?: ChatRequest['structuredAction'];
  executionPath: ExecutionPath;
}

interface ResolvedAiChatExecution {
  conversation: ResolvedConversation;
  userText: string;
  chatRequest: ChatRequest;
  resolvedStructuredAction?: ChatRequest['structuredAction'];
  resolutionTrace?: GenUITracePayload;
}

type StreamEventArgs =
  | ['response-start', Extract<GenUIStreamEvent, { event: 'response-start' }>['data']]
  | ['block-append', Extract<GenUIStreamEvent, { event: 'block-append' }>['data']]
  | ['block-replace', Extract<GenUIStreamEvent, { event: 'block-replace' }>['data']]
  | ['response-status', Extract<GenUIStreamEvent, { event: 'response-status' }>['data']]
  | ['response-complete', Extract<GenUIStreamEvent, { event: 'response-complete' }>['data']]
  | ['response-error', Extract<GenUIStreamEvent, { event: 'response-error' }>['data']]
  | ['trace', Extract<GenUIStreamEvent, { event: 'trace' }>['data']];

interface ActionResultEvent {
  success: boolean;
  error?: string;
  nextActions?: Array<{
    label: string;
    action: string;
    params?: Record<string, unknown>;
  }>;
}

interface ResolvedConversation {
  conversationId: string;
  historyMessages: ChatRequest['messages'];
  conversationSummary?: string;
  latestAssistantSuggestions?: GenUISuggestions;
  trace: GenUITracePayload;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

function resolveHistoryScope(request: GenUIRequest): HistoryScope {
  if (request.context?.activityId || request.context?.activityMode) {
    return 'activity';
  }

  return 'private';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveStreamOptions(request: GenUIRequest): ResolvedStreamOptions {
  const includeTrace = request.trace === true;
  const eventEnvelope = includeTrace ? 'full' : 'compact';

  return {
    includeTrace,
    eventEnvelope,
  };
}

function normalizeActionDisplayText(input: GenUIRequest['input']): string {
  if (input.type === 'text') {
    return input.text.trim();
  }

  const displayText = typeof input.displayText === 'string' ? input.displayText.trim() : '';
  if (displayText) {
    return displayText;
  }

  if (isRecord(input.params)) {
    const candidates = [
      input.params.location,
      input.params.value,
      input.params.activityType,
      input.params.type,
      input.params.slot,
      input.params.title,
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  return input.action.trim();
}

function parseLocationValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseRequestLocation(request: GenUIRequest): [number, number] | undefined {
  const lat = parseLocationValue(request.context?.lat);
  const lng = parseLocationValue(request.context?.lng);

  if (lat === null || lng === null) {
    return undefined;
  }

  return [lng, lat];
}

function parseAiNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function parseRequestAiParams(request: GenUIRequest): ChatAiParams | undefined {
  if (!request.ai) {
    return undefined;
  }

  const model = typeof request.ai.model === 'string' && request.ai.model.trim()
    ? request.ai.model.trim()
    : undefined;
  const temperature = parseAiNumber(request.ai.temperature);
  const maxTokens = parseAiNumber(request.ai.maxTokens);

  if (!model && temperature === undefined && maxTokens === undefined) {
    return undefined;
  }

  return {
    ...(model ? { model } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  };
}

function parseActivityMode(value: unknown): ActivityMode | undefined {
  if (value === 'review' || value === 'rebook' || value === 'kickoff') {
    return value;
  }
  return undefined;
}

function parseActivityContext(request: GenUIRequest): {
  activityId?: string;
  activityMode?: ActivityMode;
  entry?: string;
} {
  const activityId =
    typeof request.context?.activityId === 'string' && request.context.activityId.trim()
      ? request.context.activityId.trim()
      : undefined;
  const activityMode = parseActivityMode(request.context?.activityMode);
  const entry =
    typeof request.context?.entry === 'string' && request.context.entry.trim()
      ? request.context.entry.trim()
      : undefined;

  return {
    ...(activityId ? { activityId } : {}),
    ...(activityMode ? { activityMode } : {}),
    ...(entry ? { entry } : {}),
  };
}

function clampText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function extractReviewSummaryFromBlocks(blocks: GenUIBlock[]): string | null {
  const segments = blocks.flatMap((block) => {
    if (block.type === 'text' && block.content.trim()) {
      return [block.content.trim()];
    }

    if (block.type === 'alert' && block.level !== 'error' && block.message.trim()) {
      return [block.message.trim()];
    }

    return [];
  });

  if (segments.length === 0) {
    return null;
  }

  const normalized = segments
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  if (!normalized) {
    return null;
  }

  return clampText(normalized, REVIEW_SUMMARY_MAX_LENGTH);
}

async function persistActivityReviewResult(params: {
  request: GenUIRequest;
  blocks: GenUIBlock[];
  viewer: ViewerContext | null;
  traces: GenUITracePayload[];
}): Promise<void> {
  const { request, blocks, viewer, traces } = params;
  const activityContext = parseActivityContext(request);

  if (activityContext.activityMode !== 'review' || !activityContext.activityId) {
    return;
  }

  if (!viewer?.id) {
    traces.push({
      stage: 'activity_review_memory',
      detail: {
        saved: false,
        reason: 'anonymous_user',
        activityId: activityContext.activityId,
        entry: activityContext.entry || null,
      },
    });
    return;
  }

  const reviewSummary = extractReviewSummaryFromBlocks(blocks);
  if (!reviewSummary) {
    traces.push({
      stage: 'activity_review_memory',
      detail: {
        saved: false,
        reason: 'empty_review_summary',
        activityId: activityContext.activityId,
        entry: activityContext.entry || null,
      },
    });
    return;
  }

  try {
    await saveActivityReviewSummary(viewer.id, activityContext.activityId, reviewSummary);
    traces.push({
      stage: 'activity_review_memory',
      detail: {
        saved: true,
        activityId: activityContext.activityId,
        entry: activityContext.entry || null,
        summaryLength: reviewSummary.length,
      },
    });
  } catch (error) {
    console.error('Failed to persist activity review summary:', error);
    traces.push({
      stage: 'activity_review_memory',
      detail: {
        saved: false,
        activityId: activityContext.activityId,
        entry: activityContext.entry || null,
        error: error instanceof Error ? error.message : 'unknown_error',
      },
    });
  }
}

function findKnownLocationCenter(text: string): { name: string; lat: number; lng: number } | null {
  for (const location of KNOWN_LOCATION_CENTERS) {
    if (text.includes(location.name)) {
      return { ...location };
    }
  }

  return null;
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

function extractSearchContextFromHistory(historyMessages: ChatRequest['messages']): {
  center: { name: string; lat: number; lng: number } | null;
  activityType?: string;
} {
  let center: { name: string; lat: number; lng: number } | null = null;
  let activityType: string | undefined;

  for (const message of [...historyMessages].reverse()) {
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!content) {
      continue;
    }

    if (!center) {
      center = findKnownLocationCenter(content);
    }

    if (!activityType) {
      activityType = inferActivityTypeFromText(content);
    }

    if (center && activityType) {
      break;
    }
  }

  return { center, activityType };
}

function looksLikeLocationQuestion(text: string): boolean {
  return /(在哪儿|哪里|位置|地点|区域|商圈|哪边|去哪儿|想在哪|想去哪|换个地方)/.test(text);
}

function hasRecentLocationPrompt(historyMessages: ChatRequest['messages']): boolean {
  let inspectedAssistantMessages = 0;

  for (const message of [...historyMessages].reverse()) {
    if (message.role !== 'assistant') {
      continue;
    }

    inspectedAssistantMessages += 1;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content && looksLikeLocationQuestion(content)) {
      return true;
    }

    if (inspectedAssistantMessages >= 3) {
      break;
    }
  }

  return false;
}

function hasRecentCreatePrompt(historyMessages: ChatRequest['messages']): boolean {
  let inspectedUserMessages = 0;

  for (const message of [...historyMessages].reverse()) {
    if (message.role !== 'user') {
      continue;
    }

    inspectedUserMessages += 1;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content && CREATE_ACTIVITY_PATTERN.test(content)) {
      return true;
    }

    if (inspectedUserMessages >= 3) {
      break;
    }
  }

  return false;
}

function readRecentCreatePrompt(historyMessages: ChatRequest['messages']): string | null {
  let inspectedUserMessages = 0;

  for (const message of [...historyMessages].reverse()) {
    if (message.role !== 'user') {
      continue;
    }

    inspectedUserMessages += 1;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content && CREATE_ACTIVITY_PATTERN.test(content)) {
      return content;
    }

    if (inspectedUserMessages >= 4) {
      break;
    }
  }

  return null;
}

function resolveCreateLocationFollowUpAction(
  inputText: string,
  historyMessages: ChatRequest['messages']
): ChatRequest['structuredAction'] | undefined {
  const normalizedText = inputText.trim();
  const center = findKnownLocationCenter(normalizedText);
  if (!center || inferActivityTypeFromText(normalizedText)) {
    return undefined;
  }

  if (!hasRecentCreatePrompt(historyMessages) && !hasRecentLocationPrompt(historyMessages)) {
    return undefined;
  }

  const recentCreatePrompt = readRecentCreatePrompt(historyMessages) || normalizedText;
  return {
    action: 'select_preference',
    source: 'conversation_state',
    originalText: normalizedText,
    payload: {
      questionType: 'location',
      selectedValue: center.name,
      selectedLabel: center.name,
      locationName: center.name,
      lat: center.lat,
      lng: center.lng,
      semanticQuery: buildTaskFirstSemanticQuery({
        inputText: recentCreatePrompt,
        locationName: center.name,
      }),
    },
  };
}

function looksLikePartnerQuestion(text: string): boolean {
  return /(搭子|想玩什么运动|想玩点什么|想在哪儿玩|在哪片活动方便|想找什么样的搭子)/.test(text);
}

function hasRecentPartnerPrompt(historyMessages: ChatRequest['messages']): boolean {
  let inspectedAssistantMessages = 0;

  for (const message of [...historyMessages].reverse()) {
    if (message.role !== 'assistant') {
      continue;
    }

    inspectedAssistantMessages += 1;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content && looksLikePartnerQuestion(content)) {
      return true;
    }

    if (inspectedAssistantMessages >= 3) {
      break;
    }
  }

  return false;
}

function buildExploreSemanticQuery(locationName: string, activityType?: string): string {
  const typeLabelMap: Record<string, string> = {
    food: '约饭',
    sports: '运动',
    boardgame: '桌游',
    entertainment: '娱乐',
  };

  if (!activityType) {
    return `${locationName}附近的活动`;
  }

  return `${locationName}附近的${typeLabelMap[activityType] || '活动'}`;
}

function buildTypePreferencePayload(params: {
  center: { name: string; lat: number; lng: number };
  semanticQuery: string;
}): Record<string, unknown> {
  const baseParams = {
    locationName: params.center.name,
    lat: params.center.lat,
    lng: params.center.lng,
    radiusKm: 5,
    semanticQuery: params.semanticQuery,
  };

  return {
    questionType: 'type',
    question: `${params.center.name}想先看哪类活动？`,
    message: `${params.center.name}想先看哪类活动？`,
    options: [
      {
        label: '先看全部',
        value: 'all',
        action: 'explore_nearby',
        params: baseParams,
      },
      {
        label: '约饭',
        value: 'food',
        action: 'explore_nearby',
        params: {
          ...baseParams,
          type: 'food',
        },
      },
      {
        label: '运动',
        value: 'sports',
        action: 'explore_nearby',
        params: {
          ...baseParams,
          type: 'sports',
        },
      },
      {
        label: '桌游',
        value: 'boardgame',
        action: 'explore_nearby',
        params: {
          ...baseParams,
          type: 'boardgame',
        },
      },
      {
        label: '娱乐',
        value: 'entertainment',
        action: 'explore_nearby',
        params: {
          ...baseParams,
          type: 'entertainment',
        },
      },
    ],
  };
}

function buildLocationPreferencePayload(inputText: string, activityType?: string): Record<string, unknown> {
  const semanticQuery = inputText.trim() || '附近有什么活动';
  const needsTypeStep = !activityType;
  const options = KNOWN_LOCATION_CENTERS
    .filter((location) => ['观音桥', '解放碑', '南坪', '江北嘴'].includes(location.name))
    .map((location) => ({
      label: location.name,
      value: location.name,
      action: needsTypeStep ? 'ask_preference' : 'explore_nearby',
      params: needsTypeStep
        ? buildTypePreferencePayload({
            center: location,
            semanticQuery,
          })
        : {
            locationName: location.name,
            lat: location.lat,
            lng: location.lng,
            radiusKm: 5,
            semanticQuery,
            ...(activityType ? { type: activityType } : {}),
          },
    }));

  return {
    questionType: 'location',
    question: '想先看哪个区域的活动？',
    options,
    message: '想先看哪个区域的活动？',
  };
}

function shouldAskExploreLocation(inputText: string): boolean {
  const normalizedText = inputText.replace(/\s+/g, '').trim();
  if (!normalizedText) {
    return false;
  }

  if (findKnownLocationCenter(normalizedText) || CREATE_ACTIVITY_PATTERN.test(normalizedText)) {
    return false;
  }

  if (PARTNER_ENTRY_PATTERN.test(normalizedText) || /(搭子|找人|约人|同去|三缺一|补一个|一起去)/.test(normalizedText)) {
    return false;
  }

  return EXPLORE_TEXT_PATTERN.test(normalizedText);
}

function resolveExploreLocationPreferenceAction(
  inputText: string,
  requestLocation: [number, number] | undefined
): ChatRequest['structuredAction'] | undefined {
  if (requestLocation || !shouldAskExploreLocation(inputText)) {
    return undefined;
  }

  const normalizedText = inputText.trim();
  return {
    action: 'ask_preference',
    source: 'text_action_inference',
    originalText: normalizedText,
    payload: buildLocationPreferencePayload(normalizedText, inferActivityTypeFromText(normalizedText)),
  };
}

function buildCreatePromptFromExplore(params: {
  locationName: string;
  originalText: string;
  activityType?: string;
}): string {
  const typeLabelMap: Record<string, string> = {
    food: '约饭',
    sports: '运动',
    boardgame: '桌游',
    entertainment: '娱乐',
    other: '活动',
  };

  const parts = [
    `我想在${params.locationName}自己发起一个新的线下${typeLabelMap[params.activityType || 'other'] || '活动'}。`,
    params.originalText ? `当前诉求：${params.originalText}。` : '',
    '先帮我判断要不要自己组，如果需要，再帮我整理成一个可发布的活动草稿。',
  ];

  return parts.filter(Boolean).join('');
}

function buildTaskFirstSemanticQuery(params: {
  inputText: string;
  taskSemanticQuery?: string;
  locationName: string;
  activityType?: string;
}): string {
  const normalizedInput = params.inputText.trim();
  if (!normalizedInput) {
    return params.taskSemanticQuery
      || buildExploreSemanticQuery(params.locationName, params.activityType);
  }

  const hasConcreteSignal = /(附近|有什么|推荐|找个局|找局|约饭|吃饭|火锅|羽毛球|桌游|咖啡)/.test(normalizedInput);
  if (hasConcreteSignal) {
    return normalizedInput;
  }

  if (params.taskSemanticQuery && !params.taskSemanticQuery.includes(normalizedInput)) {
    return `${params.taskSemanticQuery}，${normalizedInput}`;
  }

  return params.taskSemanticQuery
    || `${buildExploreSemanticQuery(params.locationName, params.activityType)}，${normalizedInput}`;
}

function buildTaskFirstRawInput(existingRawInput: string | undefined, inputText: string): string {
  const normalizedInput = inputText.trim();
  if (!existingRawInput?.trim()) {
    return normalizedInput;
  }

  if (!normalizedInput) {
    return existingRawInput.trim();
  }

  if (existingRawInput.includes(normalizedInput)) {
    return existingRawInput.trim();
  }

  return `${existingRawInput.trim()}，${normalizedInput}`;
}

function inferDraftSlotFromText(text: string): string | undefined {
  if (/周末/.test(text)) {
    return /(20点|8点|晚上|夜里)/.test(text) ? 'weekend_20_00' : 'weekend_14_00';
  }

  if (/明天/.test(text)) {
    return /(20点|8点|晚上|夜里)/.test(text) ? 'tomorrow_20_00' : 'tomorrow_19_00';
  }

  if (/(今晚|今夜)/.test(text)) {
    return /(20点|8点)/.test(text) ? 'tonight_20_00' : 'tonight_19_00';
  }

  return undefined;
}

function inferMaxParticipantsFromText(text: string): number | undefined {
  const match = text.match(/(\d{1,2})\s*个?\s*人/);
  if (!match?.[1]) {
    return undefined;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 2 ? value : undefined;
}

function parseStructuredActionLocation(structuredAction: ChatRequest['structuredAction'] | undefined): [number, number] | undefined {
  if (!structuredAction || !isRecord(structuredAction.payload)) {
    return undefined;
  }

  const center = isRecord(structuredAction.payload.center) ? structuredAction.payload.center : null;
  const lat = parseLocationValue(structuredAction.payload.lat) ?? parseLocationValue(center?.lat);
  const lng = parseLocationValue(structuredAction.payload.lng) ?? parseLocationValue(center?.lng);

  if (lat === null || lng === null) {
    return undefined;
  }

  return [lng, lat];
}

function resolveStructuredActionFromInput(
  input: GenUIRequest['input'],
  latestAssistantSuggestions?: GenUISuggestions,
  source?: string
): ChatRequest['structuredAction'] | undefined {
  if (input.type === 'action') {
    if (!isStructuredActionType(input.action)) {
      return undefined;
    }

    return {
      action: input.action,
      payload: isRecord(input.params) ? input.params : {},
      source: source || 'genui',
      originalText: typeof input.displayText === 'string' ? input.displayText : undefined,
    };
  }

  const continuation = resolveContinuationFromSuggestions(input.text, latestAssistantSuggestions);
  if (continuation) {
    return continuation.structuredAction;
  }

  return undefined;
}

function extractStoredMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!isRecord(content)) {
    return '';
  }

  if (typeof content.text === 'string' && content.text.trim()) {
    return content.text.trim();
  }

  if (typeof content.message === 'string' && content.message.trim()) {
    return content.message.trim();
  }

  if (isRecord(content.payload) && typeof content.payload.message === 'string') {
    return content.payload.message.trim();
  }

  return '';
}

function buildHistoryMessageFromTextAndAction(params: {
  role: 'user' | 'assistant';
  text: string;
  structuredAction?: ChatRequest['structuredAction'];
}): ChatRequest['messages'][number] {
  const textPart = { type: 'text', text: params.text };
  if (!params.structuredAction) {
    return {
      role: params.role,
      content: params.text,
      parts: [textPart],
    };
  }

  return {
    role: params.role,
    content: params.text,
    parts: [
      textPart,
      {
        type: 'user_action',
        action: params.structuredAction,
      },
    ],
  };
}

function extractStructuredActionFromMessage(
  message: Pick<ChatRequest['messages'][number], 'content' | 'parts'>
): ChatRequest['structuredAction'] | undefined {
  const directContentAction = extractStructuredAction(message.content);
  if (directContentAction) {
    return directContentAction;
  }

  const actionPart = message.parts?.find((part) => (
    isRecord(part)
    && part.type === 'user_action'
    && isRecord(part.action)
  ));

  return actionPart && isRecord(actionPart.action)
    ? extractStructuredAction(actionPart.action) ?? undefined
    : undefined;
}

function toHistoryMessages(messages: Array<{ role: string; content: unknown; messageType?: string }>): ChatRequest['messages'] {
  return messages
    .map((message) => {
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      const text = extractStoredMessageText(message.content);
      if (!text) {
        return null;
      }

      const structuredAction = message.messageType === 'user_action'
        ? extractStructuredAction(message.content) ?? undefined
        : undefined;

      return buildHistoryMessageFromTextAndAction({
        role,
        text,
        structuredAction,
      });
    })
    .filter((item): item is ChatRequest['messages'][number] => Boolean(item));
}

function summarizeHistoryMessage(message: ChatRequest['messages'][number]): string {
  const text = extractStoredMessageText(message.content ?? message.parts ?? '');
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText) {
    return message.role === 'assistant' ? '助手给出了一条结构化回复。' : '用户给出了一条短回复。';
  }

  return normalizedText.length > 48
    ? `${normalizedText.slice(0, 48)}...`
    : normalizedText;
}

function summarizeRecentMessage(message: GenUIRecentMessage): string {
  const normalizedText = message.text.replace(/\s+/g, ' ').trim();
  if (!normalizedText) {
    return message.role === 'assistant' ? '助手给出了一条结构化回复。' : '用户给出了一条短回复。';
  }

  return normalizedText.length > 48
    ? `${normalizedText.slice(0, 48)}...`
    : normalizedText;
}

function readRecentMessageId(message: GenUIRecentMessage): string | undefined {
  return typeof message.messageId === 'string' && message.messageId.trim()
    ? message.messageId.trim()
    : undefined;
}

function readRecentMessageParentId(message: GenUIRecentMessage): string | undefined {
  return typeof message.parentId === 'string' && message.parentId.trim()
    ? message.parentId.trim()
    : undefined;
}

function selectActivityRecentMessageIndexes(
  recentMessages: GenUIRecentMessage[],
  maxHistoryMessages: number,
): Set<number> {
  const messageIndexById = new Map<string, number>();
  recentMessages.forEach((message, index) => {
    const messageId = readRecentMessageId(message);
    if (messageId) {
      messageIndexById.set(messageId, index);
    }
  });

  const selectedIndexes = new Set<number>();

  for (let index = recentMessages.length - 1; index >= 0 && selectedIndexes.size < maxHistoryMessages; index -= 1) {
    let currentIndex: number | undefined = index;

    while (currentIndex !== undefined && selectedIndexes.size < maxHistoryMessages) {
      selectedIndexes.add(currentIndex);
      const parentId = readRecentMessageParentId(recentMessages[currentIndex]);
      currentIndex = parentId ? messageIndexById.get(parentId) : undefined;
    }
  }

  return selectedIndexes;
}

function compressRecentMessages(
  recentMessages: GenUIRecentMessage[],
  historyScope: HistoryScope,
): {
  recentMessages: GenUIRecentMessage[];
  conversationSummary?: string;
} {
  const maxHistoryMessages = historyScope === 'activity'
    ? MAX_ACTIVITY_HISTORY_MESSAGES
    : MAX_PRIVATE_HISTORY_MESSAGES;

  if (recentMessages.length <= maxHistoryMessages) {
    return { recentMessages };
  }

  const selectedIndexes = historyScope === 'activity'
    ? selectActivityRecentMessageIndexes(recentMessages, maxHistoryMessages)
    : new Set(
        recentMessages
          .slice(-maxHistoryMessages)
          .map((_, offset) => recentMessages.length - maxHistoryMessages + offset),
      );

  const keptMessages = recentMessages.filter((_, index) => selectedIndexes.has(index));
  const omittedMessages = recentMessages.filter((_, index) => !selectedIndexes.has(index));
  const sampledMessages = omittedMessages.slice(-SUMMARY_SOURCE_MESSAGES);
  const omittedCount = Math.max(0, omittedMessages.length - sampledMessages.length);
  const summaryLines = sampledMessages.map((message) => (
    `${message.role === 'assistant' ? '助手' : '用户'}：${summarizeRecentMessage(message)}`
  ));

  const conversationSummary = [
    `更早还有 ${omittedMessages.length} 条历史消息。`,
    ...(omittedCount > 0 ? [`其中更早的 ${omittedCount} 条已折叠。`] : []),
    ...summaryLines,
  ].join('\n');

  return {
    recentMessages: keptMessages,
    conversationSummary,
  };
}

function compressConversationHistory(
  historyMessages: ChatRequest['messages'],
  historyScope: HistoryScope,
): {
  historyMessages: ChatRequest['messages'];
  conversationSummary?: string;
} {
  const maxHistoryMessages = historyScope === 'activity'
    ? MAX_ACTIVITY_HISTORY_MESSAGES
    : MAX_PRIVATE_HISTORY_MESSAGES;

  if (historyMessages.length <= maxHistoryMessages) {
    return { historyMessages };
  }

  const recentMessages = historyMessages.slice(-maxHistoryMessages);
  const olderMessages = historyMessages.slice(0, -maxHistoryMessages);
  const sampledMessages = olderMessages.slice(-SUMMARY_SOURCE_MESSAGES);
  const omittedCount = Math.max(0, olderMessages.length - sampledMessages.length);
  const summaryLines = sampledMessages.map((message) => (
    `${message.role === 'assistant' ? '助手' : '用户'}：${summarizeHistoryMessage(message)}`
  ));

  const conversationSummary = [
    `更早还有 ${olderMessages.length} 条历史消息。`,
    ...(omittedCount > 0 ? [`其中更早的 ${omittedCount} 条已折叠。`] : []),
    ...summaryLines,
  ].join('\n');

  return {
    historyMessages: recentMessages,
    conversationSummary,
  };
}

function readLatestAssistantSuggestionsFromStoredMessages(
  messages: Array<{ role: string; content: unknown }>
): GenUISuggestions | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') {
      continue;
    }

    const suggestions = readSuggestionsFromStoredMessage(message.content);
    if (suggestions) {
      return suggestions;
    }
  }

  return undefined;
}

function readTransientConversationHistoryFromRequest(request: GenUIRequest): {
  historyMessages: ChatRequest['messages'];
  conversationSummary?: string;
  latestAssistantSuggestions?: GenUISuggestions;
} {
  const recentMessages = Array.isArray(request.context?.recentMessages)
    ? request.context.recentMessages
    : [];
  const historyScope = resolveHistoryScope(request);
  const compressedRecentMessages = compressRecentMessages(recentMessages, historyScope);

  let latestAssistantSuggestions: GenUISuggestions | undefined;
  const allHistoryMessages = compressedRecentMessages.recentMessages
    .map((recentMessage) => {
      if (!isRecord(recentMessage)) {
        return null;
      }

      const role = recentMessage.role === 'assistant' || recentMessage.role === 'user' ? recentMessage.role : null;
      const text = typeof recentMessage.text === 'string' ? recentMessage.text.trim() : '';
      if (!role || !text) {
        return null;
      }

      if (role === 'assistant') {
        const suggestions = readSuggestionsFromStoredMessage({ suggestions: recentMessage.suggestions });
        if (suggestions) {
          latestAssistantSuggestions = suggestions;
        }
      }

      const structuredAction = role === 'user' && typeof recentMessage.action === 'string' && isStructuredActionType(recentMessage.action)
        ? {
            action: recentMessage.action,
            payload: isRecord(recentMessage.params) ? recentMessage.params : {},
            ...(typeof recentMessage.source === 'string' ? { source: recentMessage.source } : {}),
            ...(typeof recentMessage.displayText === 'string' ? { originalText: recentMessage.displayText } : {}),
          }
        : undefined;

      return buildHistoryMessageFromTextAndAction({
        role,
        text,
        structuredAction,
      });
    })
    .filter((item): item is ChatRequest['messages'][number] => Boolean(item));

  return {
    historyMessages: allHistoryMessages,
    ...(compressedRecentMessages.conversationSummary
      ? { conversationSummary: compressedRecentMessages.conversationSummary }
      : {}),
    ...(latestAssistantSuggestions ? { latestAssistantSuggestions } : {}),
  };
}

async function resolveConversationContext(
  request: GenUIRequest,
  viewer: ViewerContext | null,
  getConversationMessages: (id: string) => Promise<{ conversation: { userId: string } | null; messages: Array<{ role: string; content: unknown; messageType?: string }> } | null>,
): Promise<ResolvedConversation> {
  const requestedConversationId = request.conversationId?.trim() || '';
  const requestLevelSuggestions = request.latestAssistantSuggestions;

  if (!viewer) {
    const conversationId = requestedConversationId || createId(ID_PREFIX.conversation);
    const transientConversation = readTransientConversationHistoryFromRequest(request);
    const historySource: HistorySource = transientConversation.historyMessages.length > 0 ? 'request_transient' : 'empty';
    const conversationMode: ConversationMode = 'anonymous_transient';

    return {
      conversationId,
      historyMessages: transientConversation.historyMessages,
      ...(transientConversation.conversationSummary
        ? { conversationSummary: transientConversation.conversationSummary }
        : {}),
      ...(transientConversation.latestAssistantSuggestions
        ? { latestAssistantSuggestions: transientConversation.latestAssistantSuggestions }
        : {}),
      trace: {
        stage: 'conversation_resolved',
        detail: {
          source: requestedConversationId ? 'client_transient' : 'ephemeral',
          authenticated: false,
          conversationId,
          messageCount: transientConversation.historyMessages.length,
          conversationMode,
          historySource,
          suggestions: transientConversation.latestAssistantSuggestions?.kind || null,
        },
      },
    };
  }

  if (requestedConversationId) {
    const conversation = isUuidLike(requestedConversationId)
      ? await getConversationMessages(requestedConversationId)
      : null;

    if (conversation?.conversation) {
      const ownerId = conversation.conversation.userId;
      const isAdmin = viewer.role === 'admin';
      if (ownerId !== viewer.id && !isAdmin) {
        throw new Error('无权限访问该会话');
      }

      const latestAssistantSuggestions = readLatestAssistantSuggestionsFromStoredMessages(conversation.messages)
        ?? requestLevelSuggestions;
      const allHistoryMessages = toHistoryMessages(conversation.messages);
      const { historyMessages, conversationSummary } = compressConversationHistory(
        allHistoryMessages,
        resolveHistoryScope(request),
      );

      return {
        conversationId: requestedConversationId,
        historyMessages,
        ...(conversationSummary ? { conversationSummary } : {}),
        ...(latestAssistantSuggestions
          ? { latestAssistantSuggestions }
          : {}),
        trace: {
          stage: 'conversation_resolved',
          detail: {
            source: 'existing',
            authenticated: true,
            messageCount: conversation.messages.length,
            conversationId: requestedConversationId,
            conversationMode: 'authenticated_persistent',
            historySource: conversation.messages.length > 0 ? 'db' : 'empty',
            suggestions: latestAssistantSuggestions?.kind || null,
          },
        },
      };
    }
  }

  const thread = await createThread(viewer.id);

  return {
    conversationId: thread.id,
    historyMessages: [],
    ...(requestLevelSuggestions ? { latestAssistantSuggestions: requestLevelSuggestions } : {}),
    trace: {
      stage: 'conversation_resolved',
      detail: {
        source: 'created',
        authenticated: true,
        messageCount: 0,
        conversationId: thread.id,
        conversationMode: 'authenticated_persistent',
        historySource: 'empty',
        suggestions: requestLevelSuggestions?.kind || null,
      },
    },
  };
}

async function resolveAiChatExecution(
  request: GenUIRequest,
  viewer: ViewerContext | null,
  getConversationMessages: (id: string) => Promise<{ conversation: { userId: string } | null; messages: Array<{ role: string; content: unknown; messageType?: string }> } | null>,
  abortSignal?: AbortSignal
): Promise<ResolvedAiChatExecution> {
  const conversation = await resolveConversationContext(request, viewer, getConversationMessages);
  const userText = normalizeActionDisplayText(request.input);
  const requestLocation = parseRequestLocation(request);
  const suggestionResolution = request.input.type === 'text'
    ? resolveContinuationFromSuggestions(request.input.text, conversation.latestAssistantSuggestions)
    : undefined;
  const stateResolution = request.input.type === 'text'
    ? resolveCreateLocationFollowUpAction(request.input.text, conversation.historyMessages)
    : undefined;
  const exploreLocationResolution = request.input.type === 'text'
    ? resolveExploreLocationPreferenceAction(request.input.text, requestLocation)
    : undefined;
  const resolvedStructuredAction = request.input.type === 'action'
    ? resolveStructuredActionFromInput(
        request.input,
        conversation.latestAssistantSuggestions,
        typeof request.context?.entry === 'string' ? request.context.entry : undefined
      )
    : suggestionResolution?.structuredAction ?? stateResolution ?? exploreLocationResolution;
  const location = requestLocation || parseStructuredActionLocation(resolvedStructuredAction);
  const ai = parseRequestAiParams(request);

  if (!userText) {
    throw new Error('输入内容不能为空');
  }

  const source = request.context?.client === 'admin'
    ? 'admin'
    : request.context?.client === 'web'
      ? 'web'
      : 'miniprogram';
  const resolutionTrace: GenUITracePayload | undefined = suggestionResolution
    ? {
        stage: 'suggestions_resolved',
        detail: {
          inputText: userText,
          contextKind: suggestionResolution.contextKind,
          matchedBy: suggestionResolution.matchedBy,
          matchedText: suggestionResolution.matchedText,
          action: suggestionResolution.structuredAction.action,
        },
      }
    : stateResolution
      ? {
          stage: 'conversation_state_resolved',
          detail: {
            inputText: userText,
            action: stateResolution.action,
            source: stateResolution.source || null,
          },
        }
      : exploreLocationResolution
        ? {
            stage: 'text_action_resolved',
            detail: {
              inputText: userText,
              action: exploreLocationResolution.action,
              source: exploreLocationResolution.source || null,
            },
          }
      : undefined;

  return {
    conversation,
    userText,
    resolvedStructuredAction,
    ...(resolutionTrace ? { resolutionTrace } : {}),
    chatRequest: {
      messages: [
        ...conversation.historyMessages,
        {
          role: 'user',
          content: userText,
        },
      ],
      userId: viewer?.id || null,
      rateLimitUserId: viewer?.id ? viewer.id : `anon:${conversation.conversationId}`,
      conversationId: viewer?.id ? conversation.conversationId : undefined,
      source,
      structuredAction: resolvedStructuredAction,
      location,
      trace: true,
      // v5.4: 传递最近一次 Assistant response 的上下文，用于无登录状态下感知已收集的偏好
      ...(conversation.latestAssistantSuggestions
        ? { latestAssistantSuggestions: conversation.latestAssistantSuggestions }
        : {}),
      ...(conversation.conversationSummary
        ? { conversationSummary: conversation.conversationSummary }
        : {}),
      ...(ai ? { ai } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    },
  };
}

function normalizePromptKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[?？!！。,.，、;；:：'"`~\-_/\\()[\]{}]/g, '');
}

function hasDuplicateQuestion(text: string, question: string): boolean {
  const normalizedText = normalizePromptKey(text);
  const normalizedQuestion = normalizePromptKey(question);

  if (!normalizedText || !normalizedQuestion) {
    return false;
  }

  if (normalizedText === normalizedQuestion) {
    return true;
  }

  const delta = Math.abs(normalizedText.length - normalizedQuestion.length);
  if (delta > 8) {
    return false;
  }

  return (
    normalizedText.includes(normalizedQuestion) ||
    normalizedQuestion.includes(normalizedText)
  );
}

function toStringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

function toStringArrayValue(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
}

function sanitizeChoiceQuestion(rawQuestion: string): string {
  const normalized = rawQuestion
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  const firstLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';

  const compactLine = firstLine
    .replace(/\s*[-*]\s*[A-ZＡ-Ｚ][:：].*$/u, '')
    .replace(/\s*[A-ZＡ-Ｚ][:：].*$/u, '')
    .trim();

  return compactLine;
}

function punctuateChoiceLeadQuestion(question: string): string {
  const normalized = question.trim();
  if (!normalized) {
    return '';
  }

  return /[。！？!?]$/u.test(normalized) ? normalized : `${normalized}。`;
}

function inferChoiceLeadText(
  questionType: string,
  question: string,
  options: GenUIChoiceOption[]
): string {
  const fallbackQuestion = buildFallbackChoiceQuestion(questionType, options);
  const rawQuestion = question.trim();
  const labels = options.map((option) => option.label.trim()).filter(Boolean);
  const sportLike = labels.some((label) =>
    ['羽毛球', '篮球', '跑步', '跑步/健走', '健走', '网球', '游泳', '骑行'].includes(label)
  );

  // v5.5: 文案更口语化、像真人说话，不再强行拼接
  if (questionType === 'location') {
    return '这些地方怎么样？有想去的直接点，或者输入具体位置～';
  }

  if (questionType === 'time') {
    return '什么时候方便？选一个，或者告诉我你的时间～';
  }

  if (questionType === 'result') {
    return '看看有没有合适的？选一个，或者跟我说说你的具体需求～';
  }

  if (questionType === 'action') {
    return '想怎么处理？选一个，我帮你继续～';
  }

  if (questionType === 'budget') {
    return '预算方面呢？选一个，或者告诉我你的预算范围～';
  }

  if (questionType === 'preference') {
    return '还有其他要求吗？选一个，或者直接补充～';
  }

  if (questionType === 'type') {
    if (sportLike || rawQuestion.includes('运动')) {
      return '想玩什么运动？选一个，或者直接输入你想玩的项目～';
    }
    return '想看哪类？选一个，或者告诉我具体类型～';
  }

  // 如果 question 本身已经够自然，直接返回
  if (rawQuestion && rawQuestion.length >= 3) {
    // 如果已经带标点，直接返回；否则加波浪号
    if (/[。？！?！~]$/.test(rawQuestion)) {
      return rawQuestion;
    }
    return `${rawQuestion}～`;
  }
  
  return fallbackQuestion;
}

function buildFallbackChoiceQuestion(
  questionType: string,
  options: GenUIChoiceOption[]
): string {
  if (questionType === 'location') {
    // v5.4: 更有人味的文案
    return '想去哪片玩？';
  }

  if (questionType === 'time') {
    return '你更偏好什么时间？';
  }

  if (questionType === 'result') {
    return '你想怎么选？';
  }

  if (questionType === 'action') {
    return '想先定哪一项偏好？';
  }

  if (questionType === 'budget') {
    return '费用方式怎么安排？';
  }

  if (questionType === 'preference') {
    return '你还有什么特别要求？';
  }

  if (questionType === 'type') {
    const labels = options.map((option) => option.label.trim()).filter(Boolean);
    const sportLike = labels.some((label) =>
      ['羽毛球', '篮球', '跑步', '跑步/健走', '健走', '网球', '游泳', '骑行'].includes(label)
    );

    // v5.4: 更有人味的文案
    return sportLike ? '想玩什么运动？' : '想看哪类活动？';
  }

  return '请选择一个选项';
}

function resolveChoiceQuestionType(
  rawQuestionType: string,
  rawQuestion: string,
  options: Array<{ label: string; value: string }>
): string {
  const normalizedQuestion = rawQuestion.replace(/\s+/g, '');
  const labels = options.map((option) => option.label.trim()).filter(Boolean);
  const normalizedLabels = labels.map((label) => label.replace(/\s+/g, ''));
  const normalizedValues = options.map((option) => option.value.trim()).filter(Boolean);

  const semanticKinds = new Set<string>();
  for (let index = 0; index < normalizedLabels.length; index += 1) {
    const label = normalizedLabels[index];
    const value = normalizedValues[index] || '';

    if (
      KNOWN_LOCATION_CENTERS.some((location) => location.name === label)
      || value.startsWith('location_')
    ) {
      semanticKinds.add('location');
      continue;
    }

    if (
      /(今晚|明天|后天|周末|工作日|今天|上午|中午|下午|晚上|夜里|下周|本周)/.test(label)
      || label.startsWith('时间：')
      || value.startsWith('time_')
    ) {
      semanticKinds.add('time');
      continue;
    }

    if (
      /(AA|请客|平摊|都可以|预算)/.test(label)
      || label.startsWith('费用：')
      || value.startsWith('budget_')
    ) {
      semanticKinds.add('budget');
      continue;
    }

    if (
      /(不喝酒|安静|女生友好|没有特别要求|无所谓|随便)/.test(label)
      || label.startsWith('要求：')
      || value.startsWith('preference_')
    ) {
      semanticKinds.add('preference');
      continue;
    }

    if (['羽毛球', '篮球', '跑步', '跑步/健走', '健走', '网球', '游泳', '骑行'].includes(label)) {
      semanticKinds.add('type');
    }
  }

  if (semanticKinds.size === 1) {
    return [...semanticKinds][0] || rawQuestionType || 'type';
  }

  if (semanticKinds.size > 1) {
    return 'action';
  }

  if (rawQuestionType === 'action') {
    return 'action';
  }

  const looksLikeLocation = labels.length > 0
    && normalizedLabels.every((label) =>
      KNOWN_LOCATION_CENTERS.some((location) => location.name === label)
    );
  if (
    looksLikeLocation
    || (rawQuestionType !== 'action' && (
      normalizedQuestion.includes('哪个区域')
      || normalizedQuestion.includes('哪个位置')
      || normalizedQuestion.includes('在哪')
      || normalizedQuestion.includes('地点')
    ))
  ) {
    return 'location';
  }

  const looksLikeTime = labels.length > 0
    && normalizedLabels.every((label) =>
      /(今晚|明天|后天|周末|工作日|今天|上午|中午|下午|晚上|夜里|下周|本周)/.test(label)
    );
  if (looksLikeTime || normalizedQuestion.includes('时间偏好') || normalizedQuestion.includes('什么时候')) {
    return 'time';
  }

  const looksLikeBudget = labels.length > 0
    && normalizedLabels.every((label) =>
      /(AA|请客|平摊|都可以|预算)/.test(label)
    );
  if (looksLikeBudget || normalizedQuestion.includes('费用方式') || normalizedQuestion.includes('预算')) {
    return 'budget';
  }

  const looksLikeSport = labels.some((label) =>
    ['羽毛球', '篮球', '跑步', '跑步/健走', '健走', '网球', '游泳', '骑行'].includes(label)
  );
  if (looksLikeSport || normalizedQuestion.includes('想玩什么运动') || normalizedQuestion.includes('运动类型')) {
    return 'type';
  }

  const looksLikePreference = labels.length > 0
    && normalizedLabels.every((label) =>
      /(不喝酒|安静|女生友好|没有特别要求|无所谓|随便)/.test(label)
    );
  if (looksLikePreference || normalizedQuestion.includes('特别要求') || normalizedQuestion.includes('偏好')) {
    return 'preference';
  }

  return rawQuestionType || 'type';
}

function sanitizePrimitiveFields(record: Record<string, unknown>, limit = 18): Record<string, unknown> {
  const entries = Object.entries(record).filter(([, value]) => {
    if (value === null || value === undefined) {
      return false;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return true;
    }

    if (Array.isArray(value)) {
      return value.length > 0 && value.length <= 8;
    }

    return false;
  });

  return Object.fromEntries(entries.slice(0, limit));
}

function sanitizeChoiceOptionLabel(rawLabel: string): string {
  const normalized = rawLabel.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  const firstLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine || normalized;
}

function normalizeChoiceOptions(
  payload: Record<string, unknown>,
  questionType: string
): GenUIChoiceOption[] {
  const options = Array.isArray(payload.options) ? payload.options : [];
  const normalized: GenUIChoiceOption[] = [];

  for (const item of options) {
    if (!isRecord(item)) {
      continue;
    }

    const rawLabel = toStringValue(item.label);
    const label = sanitizeChoiceOptionLabel(rawLabel);
    const rawValue = toStringValue(item.value, rawLabel || label);
    const explicitAction = toStringValue(item.action);
    if (!label) {
      continue;
    }

    const action = explicitAction || 'select_preference';
    const params: Record<string, unknown> = {
      ...(isRecord(item.params) ? item.params : {}),
    };

    if (params.value === undefined) {
      params.value = rawValue;
    }
    if (params.selectedValue === undefined) {
      params.selectedValue = rawValue;
    }
    if (params.selectedLabel === undefined) {
      params.selectedLabel = label;
    }
    if (params.questionType === undefined) {
      params.questionType = questionType;
    }

    if (action === 'select_preference') {
      if (questionType === 'location' && params.location === undefined) {
        params.location = rawValue;
      } else if (questionType === 'type' && params.activityType === undefined) {
        params.activityType = rawValue;
      } else if (questionType === 'time' && params.slot === undefined) {
        params.slot = rawValue;
      }
    }

    normalized.push({
      label,
      action,
      params,
    });
  }

  return normalized.slice(0, 8);
}

function compactBlockForStream<TBlock extends GenUIBlock>(block: TBlock): TBlock {
  const meta = isRecord(block.meta) ? block.meta : null;
  if (!meta || meta.traceRef === undefined) {
    return block;
  }

  const { traceRef: _traceRef, ...restMeta } = meta;
  return {
    ...block,
    ...(Object.keys(restMeta).length > 0 ? { meta: restMeta } : {}),
    ...(Object.keys(restMeta).length === 0 ? { meta: undefined } : {}),
  } as TBlock;
}

function compactResponseEnvelopeForStream(envelope: GenUIResponseEnvelope): GenUIResponseEnvelope {
  return {
    ...envelope,
    response: {
      ...envelope.response,
      blocks: envelope.response.blocks.map((block) => compactBlockForStream(block)),
    },
  };
}

function hasProcessorTraceStep(
  traces: GenUITracePayload[],
  matcher: (detail: Record<string, unknown>) => boolean
): boolean {
  for (const trace of traces) {
    if (trace.stage !== 'processor_step' || !isRecord(trace.detail)) {
      continue;
    }
    if (matcher(trace.detail)) {
      return true;
    }
  }

  return false;
}

function ensureStrictTraceCoverage(
  traces: GenUITracePayload[],
  outputText: string,
  executionPath: ExecutionPath
): void {
  if (executionPath === 'structured_action') {
    const hasWorkflowComplete = traces.some((trace) => trace.stage === 'workflow_complete');
    if (!hasWorkflowComplete) {
      traces.push({
        stage: 'workflow_complete',
        detail: {
          status: 'completed',
          synthesized: true,
          executionPath,
          completedAt: new Date().toISOString(),
        },
      });
    }

    return;
  }

  const requiredSteps = [
    {
      type: 'processor',
      name: 'Input Guard',
      matcher: (detail: Record<string, unknown>) =>
        String(detail.type || '') === 'processor' && /Input Guard/i.test(String(detail.name || '')),
    },
    {
      type: 'intent-classify',
      name: 'P1: 意图识别',
      matcher: (detail: Record<string, unknown>) =>
        String(detail.type || '') === 'intent-classify' || String(detail.name || '').includes('意图识别'),
    },
    {
      type: 'processor',
      name: 'Semantic Recall',
      matcher: (detail: Record<string, unknown>) =>
        /Semantic Recall/i.test(String(detail.name || '')) || /semantic-recall/i.test(String(detail.type || '')),
    },
    {
      type: 'llm',
      name: 'LLM 推理',
      matcher: (detail: Record<string, unknown>) =>
        String(detail.type || '') === 'llm' || String(detail.name || '').includes('LLM'),
    },
    {
      type: 'output',
      name: '输出',
      matcher: (detail: Record<string, unknown>) =>
        String(detail.type || '') === 'output' || String(detail.name || '').includes('输出'),
    },
  ] as const;

  for (const step of requiredSteps) {
    if (hasProcessorTraceStep(traces, step.matcher)) {
      continue;
    }

    traces.push({
      stage: 'processor_step',
      detail: {
        id: `synth_${step.type}_${randomUUID().slice(0, 8)}`,
        type: step.type,
        name: step.name,
        status: 'success',
        synthesized: true,
        textPreview: outputText.slice(0, 120),
      },
    });
  }

  const hasWorkflowComplete = traces.some((trace) => trace.stage === 'workflow_complete');
  if (!hasWorkflowComplete) {
    traces.push({
      stage: 'workflow_complete',
      detail: {
        status: 'completed',
        synthesized: true,
        executionPath,
        completedAt: new Date().toISOString(),
      },
    });
  }
}

function mapAskPreferencePayloadToBlock(
  payload: Record<string, unknown>,
  assistantText: string,
  traceRef: string,
  dedupeKey: string
): GenUIBlock | null {
  const rawQuestionType = toStringValue(payload.questionType, 'type');
  const rawQuestion = toStringValue(payload.question, '请先补充你的偏好');
  const rawOptions = Array.isArray(payload.options) ? payload.options : [];
  const optionEntries = rawOptions
    .filter(isRecord)
    .map((item) => ({
      label: toStringValue(item.label),
      value: toStringValue(item.value, toStringValue(item.label)),
    }))
    .filter((item) => item.label);
  const questionType = resolveChoiceQuestionType(rawQuestionType, rawQuestion, optionEntries);
  const options = normalizeChoiceOptions(payload, questionType);

  if (options.length === 0) {
    return null;
  }

  const sanitizedQuestion = sanitizeChoiceQuestion(rawQuestion);
  const fallbackQuestion = buildFallbackChoiceQuestion(questionType, options);
  const shouldUseCanonicalQuestion = ['location', 'time', 'budget', 'preference', 'action'].includes(questionType);
  const question = shouldUseCanonicalQuestion
    ? fallbackQuestion
    : hasDuplicateQuestion(assistantText, sanitizedQuestion)
      ? fallbackQuestion
      : sanitizedQuestion || fallbackQuestion;

  return createChoiceBlock({
    question,
    options,
    dedupeKey,
    traceRef,
    meta: {
      choicePresentation: 'inline-actions',
      choiceInputMode: 'none',  // v5.4: 简化交互，去掉自定义输入框，统一使用底部输入框
      choiceQuestionType: questionType,
      choiceShowHeader: false,
    },
  });
}

function inferCardPriorityLeadTextFromPayload(
  kind: 'askPreference' | 'widget_ask_preference' | 'widget_partner_intent_form' | 'widget_draft_settings_form',
  payload: Record<string, unknown>
): string {
  if (kind === 'widget_partner_intent_form') {
    const partnerStage = toStringValue(payload.partnerStage);
    if (partnerStage === 'intent_pool') {
      return '把偏好补充得更细一点，后面替你留意时会更准。';
    }

    return '我把可调整的偏好都展开了，你可以直接细化。';
  }

  if (kind === 'widget_draft_settings_form') {
    return '先补充几个组局信息，我来接着整理。';
  }

  const rawQuestionType = toStringValue(payload.questionType, 'type');
  const rawQuestion = toStringValue(payload.question, '请先补充你的偏好');
  const rawOptions = Array.isArray(payload.options) ? payload.options : [];
  const optionEntries = rawOptions
    .filter(isRecord)
    .map((item) => ({
      label: toStringValue(item.label),
      value: toStringValue(item.value, toStringValue(item.label)),
    }))
    .filter((item) => item.label);
  const questionType = resolveChoiceQuestionType(rawQuestionType, rawQuestion, optionEntries);
  const options = normalizeChoiceOptions(payload, questionType);
  const sanitizedQuestion = sanitizeChoiceQuestion(rawQuestion);
  return inferChoiceLeadText(questionType, sanitizedQuestion, options);
}

function isCardPriorityToolName(toolName: string): boolean {
  return toolName === 'askPreference';
}

function isCardPriorityWidgetType(widgetType: string): boolean {
  return widgetType === 'widget_ask_preference'
    || widgetType === 'widget_partner_intent_form'
    || widgetType === 'widget_draft_settings_form';
}

function resolveCardPriorityLeadTextFromTool(
  toolName: string,
  toolInput?: Record<string, unknown>,
  toolOutput?: unknown
): string | null {
  if (!isCardPriorityToolName(toolName)) {
    return null;
  }

  const candidate = isRecord(toolOutput) ? toolOutput : toolInput;
  if (!candidate) {
    return null;
  }

  return inferCardPriorityLeadTextFromPayload('askPreference', candidate);
}

function resolveCardPriorityLeadTextFromWidget(
  widgetType: string,
  payload: unknown
): string | null {
  if (!isCardPriorityWidgetType(widgetType) || !isRecord(payload)) {
    return null;
  }

  if (widgetType === 'widget_partner_intent_form') {
    return inferCardPriorityLeadTextFromPayload('widget_partner_intent_form', payload);
  }

  if (widgetType === 'widget_draft_settings_form') {
    return inferCardPriorityLeadTextFromPayload('widget_draft_settings_form', payload);
  }

  return inferCardPriorityLeadTextFromPayload('widget_ask_preference', payload);
}

function inferInitialCardPriorityLeadText(
  request: GenUIRequest,
  execution: ResolvedAiChatExecution
): string | null {
  const structuredAction = execution.resolvedStructuredAction;
  if (structuredAction?.action === 'ask_preference' && isRecord(structuredAction.payload)) {
    return resolveCardPriorityLeadTextFromTool(
      'askPreference',
      structuredAction.payload,
      structuredAction.payload
    );
  }

  if (request.input.type !== 'text') {
    return null;
  }

  const normalizedText = request.input.text.trim();
  if (!normalizedText) {
    return null;
  }

  const hasLocation = Boolean(parseRequestLocation(request) || findKnownLocationCenter(normalizedText));
  const looksLikePartner = (PARTNER_ENTRY_PATTERN.test(normalizedText) || /(搭子|一起|同去|匹配)/.test(normalizedText));
  const looksLikeExplore = EXPLORE_TEXT_PATTERN.test(normalizedText);

  if (looksLikePartner) {
    return '先补充几个偏好，我来按这些条件筛。';
  }

  if (!hasLocation && looksLikeExplore) {
    return '先定一个你常活动的片区。';
  }

  return null;
}

function scoreCardPriorityLeadText(text: string | null): number {
  if (!text) {
    return 0;
  }

  if (text.includes('补充几个偏好')) {
    return 5;
  }

  if (text.includes('区域') || text.includes('片区')) {
    return 4;
  }

  if (text.includes('时间')) {
    return 3;
  }

  if (text.includes('运动类型') || text.includes('运动')) {
    return 3;
  }

  if (text.includes('组局信息')) {
    return 3;
  }

  if (text.includes('偏好')) {
    return 2;
  }

  return 1;
}

function mapExplorePayloadToList(
  payload: Record<string, unknown>,
  traceRef: string,
  dedupeKey: string
): GenUIBlock | null {
  const container = isRecord(payload.explore) ? payload.explore : payload;
  const results = Array.isArray(container.results)
    ? container.results
    : Array.isArray(container.activities)
      ? container.activities
      : [];

  const items = results
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => sanitizePrimitiveFields(item, 12))
    .filter((item) => Object.keys(item).length > 0)
    .slice(0, 12);

  const center = isRecord(container.center)
    ? sanitizePrimitiveFields(container.center, 6)
    : null;
  const fetchConfig = isRecord(payload.fetchConfig) ? payload.fetchConfig : null;
  const interaction = isRecord(payload.interaction) ? payload.interaction : null;
  const preview = isRecord(payload.preview) ? payload.preview : null;
  const semanticQuery = toStringValue(container.semanticQuery);
  const memoryHints = toStringArrayValue(container.memoryHints).length > 0
    ? toStringArrayValue(container.memoryHints)
    : toStringArrayValue(payload.memoryHints);
  if (items.length === 0 && !fetchConfig && !preview) {
    return null;
  }

  if (items.length === 0 && !center && !semanticQuery && !fetchConfig && !interaction && !preview) {
    return null;
  }

  const title = toStringValue(container.title, toStringValue(payload.message, '附近活动'));

  return createListBlock({
    title,
    items,
    dedupeKey,
    traceRef,
    ...(center ? { center: {
      lat: Number(center.lat),
      lng: Number(center.lng),
      name: toStringValue(center.name, '附近'),
    } } : {}),
    ...(semanticQuery ? { semanticQuery } : {}),
    ...(fetchConfig ? { fetchConfig } : {}),
    ...(interaction ? { interaction } : {}),
    ...(preview ? { preview } : {}),
    meta: {
      listPresentation: fetchConfig || interaction?.swipeable === true ? 'immersive-carousel' : 'compact-stack',
      listShowHeader: false,
      ...(memoryHints.length > 0 ? { memoryHints } : {}),
    },
  });
}

function mapPartnerSearchResultsPayloadToBlock(
  payload: Record<string, unknown>,
  traceRef: string,
  dedupeKey: string
): GenUIBlock | null {
  const itemsSource = Array.isArray(payload.items) ? payload.items : [];
  const items = itemsSource
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => sanitizePrimitiveFields(item, 16))
    .filter((item) => Object.keys(item).length > 0)
    .slice(0, 12);

  if (items.length === 0) {
    return null;
  }

  return createListBlock({
    title: toStringValue(payload.title, '先看看这些搭子'),
    items,
    dedupeKey,
    traceRef,
    meta: {
      listKind: 'partner_search_results',
      listPresentation: 'partner-carousel',
      listShowHeader: false,
      ...(isRecord(payload.searchSummary) ? { searchSummary: payload.searchSummary } : {}),
      ...(isRecord(payload.primaryAction) ? { primaryAction: payload.primaryAction } : {}),
      ...(isRecord(payload.secondaryAction) ? { secondaryAction: payload.secondaryAction } : {}),
    },
  });
}

function mapPublishedActivityPayloadToBlock(
  payload: Record<string, unknown>,
  traceRef: string,
  dedupeKey = 'published_activity'
): GenUIBlock | null {
  const fields = sanitizePrimitiveFields(payload, 16);
  if (!fields.activityId || !fields.title || !fields.startAt || !fields.locationName) {
    return null;
  }

  return createEntityCardBlock({
    title: '活动已创建',
    fields,
    dedupeKey,
    traceRef,
  });
}

function mapToolOutputToBlocks(params: {
  request?: GenUIRequest;
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  toolError?: string;
  assistantText: string;
  traceRef: string;
}): GenUIBlock[] {
  const blocks: GenUIBlock[] = [];
  const {
    request,
    toolName,
    toolInput,
    toolOutput,
    toolError,
    assistantText,
    traceRef,
  } = params;

  if (toolError) {
    blocks.push(
      createAlertBlock({
        level: 'error',
        message: toolError,
        dedupeKey: `tool_error_${toolName}`,
        traceRef,
      })
    );
    return blocks;
  }

  const outputRecord = isRecord(toolOutput) ? toolOutput : null;

  if (toolName === 'askPreference') {
    const candidate = outputRecord || toolInput;
    if (candidate) {
      if (request) {
        const partnerForm = mapPartnerAskPreferenceToFormBlock(request, candidate, traceRef);
        if (partnerForm) {
          blocks.push(partnerForm);
          return blocks;
        }
      }
      const choice = mapAskPreferencePayloadToBlock(
        candidate,
        assistantText,
        traceRef,
        'ask_preference'
      );
      if (choice) {
        blocks.push(choice);
      }
    }
    return blocks;
  }

  if (toolName === 'exploreNearby') {
    if (outputRecord) {
      const listBlock = mapExplorePayloadToList(outputRecord, traceRef, 'explore_nearby');
      if (listBlock) {
        blocks.push(listBlock);
      }
    }
    return blocks;
  }

  if (outputRecord && outputRecord.success === false && typeof outputRecord.error === 'string') {
    blocks.push(
      createAlertBlock({
        level: 'error',
        message: outputRecord.error,
        dedupeKey: `tool_error_${toolName}`,
        traceRef,
      })
    );
    return blocks;
  }

  if (outputRecord) {
    const draft = isRecord(outputRecord.draft) ? outputRecord.draft : null;
    const publishedActivity = isRecord(outputRecord.publishedActivity) ? outputRecord.publishedActivity : null;
    if (draft) {
      const fields = sanitizePrimitiveFields({
        activityId: toStringValue(outputRecord.activityId),
        ...draft,
      });
      blocks.push(
        createEntityCardBlock({
          title: '活动草稿',
          fields,
          dedupeKey: 'activity_draft',
          traceRef,
        })
      );
    }

    if (publishedActivity) {
      const publishedBlock = mapPublishedActivityPayloadToBlock(publishedActivity, traceRef);
      if (publishedBlock) {
        blocks.push(publishedBlock);
      }
    }

    const exploreList = mapExplorePayloadToList(outputRecord, traceRef, `tool_${toolName}_list`);
    if (exploreList) {
      blocks.push(exploreList);
    }

    if (!draft && !publishedActivity && !exploreList) {
      const fields = sanitizePrimitiveFields(outputRecord);
      if (Object.keys(fields).length > 0) {
        blocks.push(
          createEntityCardBlock({
            title: toolName,
            fields,
            dedupeKey: `tool_${toolName}_entity`,
            traceRef,
          })
        );
      }
    }

    if (typeof outputRecord.message === 'string' && outputRecord.message.trim()) {
      const level: 'info' | 'success' = outputRecord.success === true ? 'success' : 'info';
      blocks.push(
        createAlertBlock({
          level,
          message: outputRecord.message.trim(),
          dedupeKey: `tool_${toolName}_message`,
          traceRef,
        })
      );
    }
  }

  return blocks;
}

function mapPartnerIntentFormPayloadToBlock(
  payload: {
    title?: unknown;
    schema?: unknown;
    initialValues?: unknown;
  },
  traceRef: string
): GenUIBlock | null {
  const schema = isRecord(payload.schema) ? payload.schema : null;
  if (!schema) {
    return null;
  }

  const title = toStringValue(payload.title, '找搭子偏好');
  const initialValues = isRecord(payload.initialValues) ? payload.initialValues : undefined;

  return createFormBlock({
    title,
    schema,
    initialValues,
    dedupeKey: 'partner_intent_form',
    traceRef,
    meta: {
      formShowHeader: false,
    },
  });
}

function readRawInputFromRequest(request: GenUIRequest): string {
  if (request.input.type === 'text') {
    return request.input.text.trim();
  }

  if (isRecord(request.input.params)) {
    const rawInput = toStringValue(request.input.params.rawInput);
    if (rawInput) {
      return rawInput;
    }
  }

  return '';
}

function isPartnerIntentRequest(request: GenUIRequest): boolean {
  if (request.input.type === 'action') {
    return request.input.action === 'find_partner'
      || request.input.action === 'search_partners'
      || request.input.action === 'submit_partner_intent_form';
  }

  const normalized = request.input.text.trim();
  if (!normalized) {
    return false;
  }

  return PARTNER_ENTRY_PATTERN.test(normalized) || /(搭子|找个.*搭子)/.test(normalized);
}

function shouldRenderPartnerAskPreferenceAsForm(payload: Record<string, unknown>): boolean {
  return shouldRenderPartnerIntentFormFromPayload(payload);
}

function mapPartnerAskPreferenceToFormBlock(
  request: GenUIRequest,
  payload: Record<string, unknown>,
  traceRef: string
): GenUIBlock | null {
  if (!isPartnerIntentRequest(request)) {
    return null;
  }

  if (!shouldRenderPartnerAskPreferenceAsForm(payload)) {
    return null;
  }

  const questionType = toStringValue(payload.questionType);
  if (!['location', 'time', 'action', 'type'].includes(questionType)) {
    return null;
  }

  const rawInput = readRawInputFromRequest(request) || '帮我找个搭子';
  const state = createPartnerMatchingState(rawInput);
  const explicitLocation = request.input.type === 'text'
    ? findKnownLocationCenter(request.input.text)?.name
    : isRecord(request.input.params)
      ? toStringValue(request.input.params.locationName) || toStringValue(request.input.params.location)
      : '';
  const collectedInfo = isRecord(payload.collectedInfo) ? payload.collectedInfo : null;
  const defaultLocation = explicitLocation || toStringValue(collectedInfo?.location);

  return mapPartnerIntentFormPayloadToBlock(
    buildPartnerIntentFormPayload({
      state,
      rawInput,
      defaultLocation: defaultLocation || undefined,
      fallbackLocationHint: '',
    }),
    traceRef,
  );
}

function resolvePartnerFormLeadText(
  request: GenUIRequest,
  payload: Record<string, unknown>
): string | null {
  const block = mapPartnerAskPreferenceToFormBlock(request, payload, 'partner_form_preview');
  if (!block) {
    return null;
  }

  return '先补充几个偏好，我来按这些条件筛。';
}

function mapDraftSettingsFormPayloadToBlock(
  payload: Record<string, unknown>,
  traceRef: string
): GenUIBlock | null {
  const schema = isRecord(payload.schema) ? payload.schema : null;
  if (!schema) {
    return null;
  }

  const title = toStringValue(payload.title, '调整活动草稿');
  const initialValues = isRecord(payload.initialValues) ? payload.initialValues : undefined;

  return createFormBlock({
    title,
    schema,
    initialValues,
    dedupeKey: 'draft_settings_form',
    traceRef,
    meta: {
      formShowHeader: false,
    },
  });
}

function removeRedundantPreferenceBlocks(blocks: GenUIBlock[]): GenUIBlock[] {
  const hasPartnerIntentForm = blocks.some(
    (block) => block.type === 'form' && block.dedupeKey === 'partner_intent_form'
  );

  if (!hasPartnerIntentForm) {
    return blocks;
  }

  return blocks.filter((block) => block.dedupeKey !== 'ask_preference');
}

function mapWidgetDataToBlock(params: {
  request?: GenUIRequest;
  widgetType: string;
  payload: unknown;
  assistantText: string;
  traceRef: string;
}): GenUIBlock | null {
  const { request, widgetType, payload, assistantText, traceRef } = params;
  if (!isRecord(payload)) {
    return null;
  }

  const alertMeta = (() => {
    const meta: Record<string, unknown> = {};

    if (isRecord(payload.authRequired)) {
      meta.authRequired = payload.authRequired;
    }

    if (typeof payload.navigationIntent === 'string') {
      meta.navigationIntent = payload.navigationIntent;
    }

    if (isRecord(payload.navigationPayload)) {
      meta.navigationPayload = payload.navigationPayload;
    }

    return Object.keys(meta).length > 0 ? meta : undefined;
  })();

  if (widgetType === 'widget_ask_preference') {
    if (request) {
      const partnerForm = mapPartnerAskPreferenceToFormBlock(request, payload, traceRef);
      if (partnerForm) {
        return partnerForm;
      }
    }
    return mapAskPreferencePayloadToBlock(payload, assistantText, traceRef, 'ask_preference');
  }

  if (widgetType === 'widget_explore') {
    return mapExplorePayloadToList(payload, traceRef, 'widget_explore');
  }

  if (widgetType === 'widget_partner_search_results') {
    return mapPartnerSearchResultsPayloadToBlock(payload, traceRef, 'widget_partner_search_results');
  }

  if (widgetType === 'widget_share') {
    return mapPublishedActivityPayloadToBlock(payload, traceRef);
  }

  if (widgetType === 'widget_partner_intent_form') {
    return mapPartnerIntentFormPayloadToBlock(payload, traceRef);
  }

  if (widgetType === 'widget_draft_settings_form') {
    return mapDraftSettingsFormPayloadToBlock(payload, traceRef);
  }

  if (widgetType === 'widget_error') {
    const message = toStringValue(payload.message, '生成失败，请稍后再试');
    return createAlertBlock({
      level: 'error',
      message,
      dedupeKey: 'widget_error',
      traceRef,
      ...(alertMeta ? { meta: alertMeta } : {}),
    });
  }

  if (widgetType === 'widget_auth_required') {
    const message = toStringValue(payload.message, '这个操作需要先完成账号验证');
    return createAlertBlock({
      level: 'warning',
      message,
      dedupeKey: 'widget_auth_required',
      traceRef,
      ...(alertMeta ? { meta: alertMeta } : {}),
    });
  }

  if (widgetType === 'widget_success') {
    const message = toStringValue(payload.message, '操作成功');
    return createAlertBlock({
      level: 'success',
      message,
      dedupeKey: 'widget_success',
      traceRef,
      ...(alertMeta ? { meta: alertMeta } : {}),
    });
  }

  if (widgetType === 'widget_draft') {
    const fields = sanitizePrimitiveFields(payload);
    if (Object.keys(fields).length === 0) {
      return null;
    }

    return createEntityCardBlock({
      title: '活动草稿',
      fields,
      dedupeKey: 'activity_draft',
      traceRef,
    });
  }

  const title = widgetType.replace('widget_', '').replace(/_/g, ' ');
  const fields = sanitizePrimitiveFields(payload);
  if (Object.keys(fields).length === 0) {
    return null;
  }

  return createEntityCardBlock({
    title,
    fields,
    dedupeKey: widgetType,
    traceRef,
  });
}

function mapActionResultToCtaBlock(
  payload: ActionResultEvent,
  traceRef: string
): GenUIBlock | null {
  const nextActions = Array.isArray(payload.nextActions) ? payload.nextActions : [];
  const items = nextActions
    .filter((item): item is { label: string; action: string; params?: Record<string, unknown> } => {
      if (!isRecord(item)) {
        return false;
      }
      return typeof item.label === 'string' && typeof item.action === 'string';
    })
    .slice(0, 4)
    .map((item) => ({
      label: item.label.trim(),
      action: item.action.trim(),
      ...(isRecord(item.params) ? { params: item.params } : {}),
    }))
    .filter((item) => item.label && item.action);

  if (items.length === 0) {
    return null;
  }

  return createCtaGroupBlock({
    items,
    dedupeKey: 'action_result_next_actions',
    traceRef,
    meta: {
      ctaGroupPresentation: 'inline-actions',
      ctaShowHeader: false,
    },
  });
}

function inferResultOutcome(
  request: GenUIRequest,
  blocks: GenUIBlock[]
): { outcome: string; confidence: 'high' | 'medium'; evidence: string } | null {
  if (request.input.type === 'action') {
    const action = request.input.action;
    if (action === 'join_activity') {
      return { outcome: 'joined', confidence: 'high', evidence: 'input.action=join_activity' };
    }
    if (action === 'publish_draft' || action === 'confirm_publish') {
      return { outcome: 'published', confidence: 'high', evidence: 'input.action=' + action };
    }
    if (action === 'create_activity' || action === 'save_draft_settings') {
      return { outcome: 'activity_ready', confidence: 'high', evidence: 'input.action=' + action };
    }
    if (action === 'explore_nearby') {
      return { outcome: 'explored', confidence: 'high', evidence: 'input.action=explore_nearby' };
    }
    if (action === 'confirm_match') {
      return { outcome: 'matched', confidence: 'high', evidence: 'input.action=confirm_match' };
    }
    if (action === 'cancel_match') {
      return { outcome: 'match_cancelled', confidence: 'high', evidence: 'input.action=cancel_match' };
    }
    if (action === 'find_partner' || action === 'select_preference') {
      return { outcome: 'partner_progress', confidence: 'medium', evidence: `input.action=${action}` };
    }
  }

  for (const block of blocks) {
    if (block.type === 'list') {
      return { outcome: 'explored', confidence: 'medium', evidence: 'block.type=list' };
    }

    if (block.type === 'entity-card') {
      if (block.dedupeKey === 'published_activity' || block.dedupeKey === 'share_payload') {
        return { outcome: 'published', confidence: 'medium', evidence: `entity.dedupeKey=${block.dedupeKey}` };
      }

      if (isRecord(block.fields) && typeof block.fields.activityId === 'string') {
        return { outcome: 'activity_ready', confidence: 'medium', evidence: 'entity.fields.activityId' };
      }
    }

    if (block.type === 'choice') {
      if (block.question.includes('匹配进度')) {
        return { outcome: 'partner_progress', confidence: 'medium', evidence: 'choice.question=匹配进度' };
      }
    }
  }

  return null;
}

function buildBlocksFromExecutionResult(
  result: ChatExecutionResult,
  request?: GenUIRequest
): {
  blocks: GenUIBlock[];
  traces: GenUITracePayload[];
  executionPath: ExecutionPath;
} {
  const blocks: GenUIBlock[] = [];
  const trimmedText = result.assistantText.trim();

  if (trimmedText) {
    pushBlock(blocks, createTextBlock(trimmedText, 'assistant_text', 'assistant_text'));
  }

  for (const blockPayload of result.blockPayloads) {
    const block = mapWidgetDataToBlock({
      request,
      widgetType: blockPayload.widgetType,
      payload: blockPayload.payload,
      assistantText: trimmedText,
      traceRef: blockPayload.widgetType,
    });
    if (block) {
      pushBlock(blocks, block);
    }
  }

  for (const actionResult of result.actionResults) {
    const actionBlock = mapActionResultToCtaBlock(actionResult, 'action_result');
    if (actionBlock) {
      pushBlock(blocks, actionBlock);
    }
  }

  for (const toolCall of result.toolCallRecords) {
    const mappedBlocks = mapToolOutputToBlocks({
      request,
      toolName: toolCall.toolName,
      toolInput: isRecord(toolCall.args) ? toolCall.args : undefined,
      toolOutput: toolCall.result,
      toolError: toolCall.errorText,
      assistantText: trimmedText,
      traceRef: `tool_${toolCall.toolName}`,
    });

    for (const block of mappedBlocks) {
      pushBlock(blocks, block);
    }
  }

  if (blocks.length === 0) {
    pushBlock(
      blocks,
      createTextBlock(
        '这个话题和组局关系不大，我先帮你聊活动相关的。你可以试试说“周末附近有什么活动？”',
        'genui_adapter',
        'empty_response'
      )
    );
  }

  return {
    blocks: removeRedundantPreferenceBlocks(blocks),
    traces: result.traces,
    executionPath: result.executionPath,
  };
}

function createStreamEvent(...args: StreamEventArgs): GenUIStreamEvent {
  const eventId = createId(ID_PREFIX.event);
  const timestamp = new Date().toISOString();

  switch (args[0]) {
    case 'response-start':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'block-append':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'block-replace':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'response-status':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'response-complete':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'response-error':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'trace':
      return { eventId, event: args[0], timestamp, data: args[1] };
  }
}

function readStreamEventPayload(
  event: GenUIStreamEvent,
  streamOptions: ResolvedStreamOptions
): unknown {
  if (streamOptions.eventEnvelope === 'full') {
    return event;
  }

  switch (event.event) {
    case 'block-append':
    case 'block-replace':
      return {
        responseId: event.data.responseId,
        block: compactBlockForStream(event.data.block),
      };
    case 'response-complete':
      return compactResponseEnvelopeForStream(event.data);
    default:
      return event.data;
  }
}

function serializeSSE(event: GenUIStreamEvent, streamOptions: ResolvedStreamOptions): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(readStreamEventPayload(event, streamOptions))}\n\n`;
}

export async function createAiChatStreamResponse(params: {
  request: GenUIRequest;
  envelope: GenUIResponseEnvelope;
  traces: GenUITracePayload[];
}): Promise<Response> {
  const streamOptions = resolveStreamOptions(params.request);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: GenUIStreamEvent) => {
        controller.enqueue(encoder.encode(serializeSSE(event, streamOptions)));
      };

      try {
        emit(createStreamEvent('response-start', {
          traceId: params.envelope.traceId,
          conversationId: params.envelope.conversationId,
          responseId: params.envelope.response.responseId,
        }));
        emit(createStreamEvent('response-status', {
          responseId: params.envelope.response.responseId,
          status: 'streaming',
        }));

        for (const block of params.envelope.response.blocks) {
          emit(createStreamEvent('block-append', {
            responseId: params.envelope.response.responseId,
            block,
          }));
        }

        emit(createStreamEvent('response-status', {
          responseId: params.envelope.response.responseId,
          status: 'completed',
        }));
        emit(createStreamEvent('response-complete', params.envelope));

        if (streamOptions.includeTrace) {
          for (const trace of params.traces) {
            emit(createStreamEvent('trace', trace));
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        const message = normalizeAiProviderErrorMessage(
          error instanceof Error ? error.message : 'AI 服务暂时不可用'
        );
        emit(createStreamEvent('response-error', {
          responseId: createId(ID_PREFIX.response),
          message,
        }));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function createAiChatErrorStreamResponse(params: {
  request: GenUIRequest;
  message: string;
  conversationId?: string | null;
}): Promise<Response> {
  const traceId = createId(ID_PREFIX.trace);
  const responseId = createId(ID_PREFIX.response);
  const requestedConversationId = typeof params.request.conversationId === 'string'
    ? params.request.conversationId.trim()
    : '';
  const conversationId = params.conversationId?.trim()
    || requestedConversationId
    || createId(ID_PREFIX.conversation);
  const block = createAlertBlock({
    level: 'error',
    message: params.message,
    dedupeKey: 'ai-provider-error',
    traceRef: traceId,
    meta: { source: 'ai_provider' },
  });

  return createAiChatStreamResponse({
    request: params.request,
    envelope: {
      traceId,
      conversationId,
      response: {
        responseId,
        role: 'assistant',
        status: 'completed',
        blocks: [block],
      },
    },
    traces: [
      {
        stage: 'response_error',
        detail: {
          traceId,
          responseId,
          conversationId,
          message: params.message,
          source: 'ai_provider',
        },
      },
    ],
  });
}

export async function buildAiChatEnvelope(
  request: GenUIRequest,
  options: AiChatResponseOptions & {
    executeChatRequest: (req: ChatRequest) => Promise<ChatExecutionResult>;
    getConversationMessages: (id: string) => Promise<{ conversation: { userId: string } | null; messages: Array<{ role: string; content: unknown; messageType?: string }> } | null>;
  }
): Promise<AiChatEnvelopeResult> {
  const viewer = options?.viewer ?? null;
  const execution = await resolveAiChatExecution(request, viewer, options.getConversationMessages, options?.abortSignal);
  const executionResult = await options.executeChatRequest(execution.chatRequest);
  const mapped = buildBlocksFromExecutionResult(executionResult, request);
  const executionPath = mapped.executionPath;
  const suggestions = buildSuggestionsFromBlocks(mapped.blocks);

  const traceId = createId(ID_PREFIX.trace);
  const responseId = createId(ID_PREFIX.response);

  const envelope: GenUIResponseEnvelope = {
    traceId,
    conversationId: execution.conversation.conversationId,
    response: {
      responseId,
      role: 'assistant',
      status: 'completed',
      blocks: mapped.blocks,
      ...(suggestions ? { suggestions } : {}),
    },
  };

  const traces: GenUITracePayload[] = [
    execution.conversation.trace,
    ...(execution.resolutionTrace ? [execution.resolutionTrace] : []),
    ...mapped.traces,
    {
      stage: 'response_complete',
      detail: {
        traceId,
        responseId,
        conversationId: execution.conversation.conversationId,
        blockCount: mapped.blocks.length,
      },
    },
  ];

  const outcome = inferResultOutcome(request, mapped.blocks);
  if (outcome) {
    traces.push({
      stage: 'result_outcome',
      detail: {
        outcome: outcome.outcome,
        confidence: outcome.confidence,
        evidence: outcome.evidence,
      },
    });
  }

  await persistActivityReviewResult({
    request,
    blocks: mapped.blocks,
    viewer,
    traces,
  });

  return {
    envelope,
    traces,
    resolvedStructuredAction: execution.resolvedStructuredAction,
    executionPath,
  };
}

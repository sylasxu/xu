import { randomUUID } from 'crypto';
import type {
  GenUIBlock,
  GenUIChoiceOption,
  GenUIRequest,
  GenUIRequestAi,
  GenUIRequestContext,
  GenUIStreamEvent,
  GenUITransientTurn,
  GenUITracePayload,
  GenUITurnContext,
  GenUITurnEnvelope,
} from '@juchang/genui-contract';
import {
  getConversationMessages,
  handleChatStream,
  isUuidLike,
  syncConversationTurnSnapshot,
  type ChatRequest,
} from './ai.service';
import { createThread } from './memory';
import { isStructuredActionType } from './user-action';
import { applyAiChatTurnPolicies } from './ai-chat-policy.service';
import {
  buildTurnContextFromBlocks,
  readTurnContextFromStoredMessage,
  resolveContinuationFromTurnContext,
} from './turn-context';
import {
  createChoiceBlock,
  createEntityCardBlock,
  createCtaGroupBlock,
  createAlertBlock,
  createFormBlock,
  pushBlock,
} from './shared/genui-blocks';
import { saveActivityReviewSummary } from '../participants/participant.service';
import {
  resolveOpenCreateTaskForConversation,
  resolveOpenJoinTaskForConversation,
  resolveOpenPartnerTaskForConversation,
  syncCreateTaskFromChatTurn,
  syncJoinTaskFromChatTurn,
  syncPartnerTaskFromChatTurn,
} from './task-runtime/agent-task.service';
import {
  buildPartnerIntentFormPayload,
  createPartnerMatchingState,
  shouldRenderPartnerIntentFormFromPayload,
} from './workflow/partner-matching';
import { normalizeAiProviderErrorMessage } from './models/provider-error';

const ID_PREFIX = {
  conversation: 'conv',
  trace: 'trace',
  turn: 'turn',
  block: 'block',
  event: 'evt',
} as const;

const MAX_HISTORY_MESSAGES = 24;

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

type FollowUpMode = NonNullable<GenUIRequestContext['followUpMode']>;
type ChatAiParams = GenUIRequestAi;
type ExecutionPath = 'llm_orchestrated' | 'structured_action';
type ConversationMode = 'authenticated_persistent' | 'anonymous_transient';
type HistorySource = 'db' | 'request_transient' | 'empty';

interface BuildAiChatTurnOptions {
  viewer?: ViewerContext | null;
}

interface CreateAiChatBridgeStreamResponseOptions extends BuildAiChatTurnOptions {
  requestAbortSignal?: AbortSignal;
}

interface ResolvedStreamOptions {
  includeTrace: boolean;
  eventEnvelope: 'full' | 'compact';
}

interface BuildAiChatTurnResult {
  envelope: GenUITurnEnvelope;
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
  defaultExecutionPath: ExecutionPath;
}

interface ParsedDataStream {
  events: DataStreamEvent[];
  rawEventCount: number;
  done: boolean;
}

interface DataStreamEvent {
  type: string;
  [key: string]: unknown;
}

type StreamEventArgs =
  | ['turn-start', Extract<GenUIStreamEvent, { event: 'turn-start' }>['data']]
  | ['block-append', Extract<GenUIStreamEvent, { event: 'block-append' }>['data']]
  | ['block-replace', Extract<GenUIStreamEvent, { event: 'block-replace' }>['data']]
  | ['turn-status', Extract<GenUIStreamEvent, { event: 'turn-status' }>['data']]
  | ['turn-complete', Extract<GenUIStreamEvent, { event: 'turn-complete' }>['data']]
  | ['turn-error', Extract<GenUIStreamEvent, { event: 'turn-error' }>['data']]
  | ['trace', Extract<GenUIStreamEvent, { event: 'trace' }>['data']];

interface ToolInvocationState {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
}

interface ActionResultEvent {
  success: boolean;
  error?: string;
  nextActions?: Array<{
    label: string;
    action: string;
    params?: Record<string, unknown>;
  }>;
}

function isActionResultNextActions(value: unknown): value is NonNullable<ActionResultEvent['nextActions']> {
  return Array.isArray(value) && value.every((item) => {
    if (!isRecord(item)) {
      return false;
    }

    if (typeof item.label !== 'string' || typeof item.action !== 'string') {
      return false;
    }

    if (item.params !== undefined && !isRecord(item.params)) {
      return false;
    }

    return true;
  });
}

interface ResolvedConversation {
  conversationId: string;
  historyMessages: ChatRequest['messages'];
  latestAssistantTurnContext?: GenUITurnContext;
  trace: GenUITracePayload;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
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

function isDataStreamEvent(value: unknown): value is DataStreamEvent {
  return isRecord(value) && typeof value.type === 'string';
}

function parseDataStreamEvent(dataText: string): DataStreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(dataText);
    return isDataStreamEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseSSEPacket(packet: string): string {
  const lines = packet.split(/\r?\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  return dataLines.join('\n');
}

function splitNextSSEPacket(buffer: string): {
  packet: string;
  rest: string;
} | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (!match || typeof match.index !== 'number') {
    return null;
  }

  const separatorIndex = match.index;
  const separatorLength = match[0].length;
  return {
    packet: buffer.slice(0, separatorIndex),
    rest: buffer.slice(separatorIndex + separatorLength),
  };
}

async function parseDataStreamResponse(response: Response): Promise<ParsedDataStream> {
  if (!response.body) {
    return {
      events: [],
      rawEventCount: 0,
      done: false,
    };
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const events: DataStreamEvent[] = [];
  let buffer = '';
  let rawEventCount = 0;
  let done = false;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    buffer += decoder.decode(chunk.value, { stream: true });

    let nextPacket = splitNextSSEPacket(buffer);
    while (nextPacket) {
      const packet = nextPacket.packet;
      buffer = nextPacket.rest;
      rawEventCount += 1;

      const dataText = parseSSEPacket(packet).trim();
      if (!dataText) {
        nextPacket = splitNextSSEPacket(buffer);
        continue;
      }

      if (dataText === '[DONE]') {
        done = true;
        nextPacket = splitNextSSEPacket(buffer);
        continue;
      }

      const parsed = parseDataStreamEvent(dataText);
      if (parsed) {
        events.push(parsed);
      }

      nextPacket = splitNextSSEPacket(buffer);
    }
  }

  const remaining = buffer.trim();
  if (remaining) {
    rawEventCount += 1;
    const dataText = parseSSEPacket(remaining).trim();
    if (dataText === '[DONE]') {
      done = true;
    } else if (dataText) {
      const parsed = parseDataStreamEvent(dataText);
      if (parsed) {
        events.push(parsed);
      }
    }
  }

  return {
    events,
    rawEventCount,
    done,
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

function parseFollowUpMode(value: unknown): FollowUpMode | undefined {
  if (value === 'review' || value === 'rebook' || value === 'kickoff') {
    return value;
  }
  return undefined;
}

function parseActivityFollowUpContext(request: GenUIRequest): {
  activityId?: string;
  followUpMode?: FollowUpMode;
  entry?: string;
} {
  const activityId =
    typeof request.context?.activityId === 'string' && request.context.activityId.trim()
      ? request.context.activityId.trim()
      : undefined;
  const followUpMode = parseFollowUpMode(request.context?.followUpMode);
  const entry =
    typeof request.context?.entry === 'string' && request.context.entry.trim()
      ? request.context.entry.trim()
      : undefined;

  return {
    ...(activityId ? { activityId } : {}),
    ...(followUpMode ? { followUpMode } : {}),
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

async function persistActivityFollowUpResult(params: {
  request: GenUIRequest;
  blocks: GenUIBlock[];
  viewer: ViewerContext | null;
  traces: GenUITracePayload[];
}): Promise<void> {
  const { request, blocks, viewer, traces } = params;
  const followUpContext = parseActivityFollowUpContext(request);

  if (followUpContext.followUpMode !== 'review' || !followUpContext.activityId) {
    return;
  }

  if (!viewer?.id) {
    traces.push({
      stage: 'activity_review_memory',
      detail: {
        saved: false,
        reason: 'anonymous_user',
        activityId: followUpContext.activityId,
        entry: followUpContext.entry || null,
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
        activityId: followUpContext.activityId,
        entry: followUpContext.entry || null,
      },
    });
    return;
  }

  try {
    await saveActivityReviewSummary(viewer.id, followUpContext.activityId, reviewSummary);
    traces.push({
      stage: 'activity_review_memory',
      detail: {
        saved: true,
        activityId: followUpContext.activityId,
        entry: followUpContext.entry || null,
        summaryLength: reviewSummary.length,
      },
    });
  } catch (error) {
    console.error('Failed to persist activity review summary:', error);
    traces.push({
      stage: 'activity_review_memory',
      detail: {
        saved: false,
        activityId: followUpContext.activityId,
        entry: followUpContext.entry || null,
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
  let inspectedAssistantTurns = 0;

  for (const message of [...historyMessages].reverse()) {
    if (message.role !== 'assistant') {
      continue;
    }

    inspectedAssistantTurns += 1;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content && looksLikeLocationQuestion(content)) {
      return true;
    }

    if (inspectedAssistantTurns >= 3) {
      break;
    }
  }

  return false;
}

function hasRecentCreatePrompt(historyMessages: ChatRequest['messages']): boolean {
  let inspectedUserTurns = 0;

  for (const message of [...historyMessages].reverse()) {
    if (message.role !== 'user') {
      continue;
    }

    inspectedUserTurns += 1;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content && CREATE_ACTIVITY_PATTERN.test(content)) {
      return true;
    }

    if (inspectedUserTurns >= 3) {
      break;
    }
  }

  return false;
}

function looksLikePartnerQuestion(text: string): boolean {
  return /(搭子|想玩什么运动|想玩点什么|想在哪儿玩|在哪片活动方便|想找什么样的搭子)/.test(text);
}

function hasRecentPartnerPrompt(historyMessages: ChatRequest['messages']): boolean {
  let inspectedAssistantTurns = 0;

  for (const message of [...historyMessages].reverse()) {
    if (message.role !== 'assistant') {
      continue;
    }

    inspectedAssistantTurns += 1;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content && looksLikePartnerQuestion(content)) {
      return true;
    }

    if (inspectedAssistantTurns >= 3) {
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

async function inferStructuredActionFromOpenJoinTask(params: {
  userId: string;
  conversationId: string;
  activityId?: string;
  inputText: string;
}): Promise<ChatRequest['structuredAction'] | undefined> {
  const normalized = params.inputText.trim();
  if (!normalized) {
    return undefined;
  }

  const task = await resolveOpenJoinTaskForConversation({
    userId: params.userId,
    conversationId: params.conversationId,
    activityId: params.activityId,
  });
  if (!task) {
    return undefined;
  }

  if (!['intent_captured', 'explore', 'action_selected', 'auth_gate'].includes(task.currentStage)) {
    return undefined;
  }

  const currentCenter = findKnownLocationCenter(normalized);
  const center = currentCenter || (task.context.location?.name ? {
    name: task.context.location.name,
    lat: task.context.location.lat ?? 0,
    lng: task.context.location.lng ?? 0,
  } : null);
  const activityType = inferActivityTypeFromText(normalized) || task.context.activityType;
  const isBareLocationReply = Boolean(
    currentCenter
      && normalized.replace(/附近$/, '') === currentCenter.name
      && !/[，。,.!?？！；;:：]/.test(normalized)
      && normalized.length <= 12
  );

  if (CREATE_FROM_EXPLORE_PATTERN.test(normalized) && center) {
    return {
      action: 'create_activity',
      payload: {
        description: buildCreatePromptFromExplore({
          locationName: center.name,
          originalText: normalized,
          activityType,
        }),
        locationName: center.name,
        ...(activityType ? { type: activityType } : {}),
      },
      source: 'task_runtime_inference',
      originalText: normalized,
    };
  }

  if (currentCenter && isBareLocationReply) {
    if (!activityType) {
      return {
        action: 'ask_preference',
        payload: buildTypePreferencePayload({
          center: currentCenter,
          semanticQuery: buildTaskFirstSemanticQuery({
            inputText: normalized,
            taskSemanticQuery: task.context.semanticQuery,
            locationName: currentCenter.name,
          }),
        }),
        source: 'task_runtime_inference',
        originalText: normalized,
      };
    }

    return {
      action: 'explore_nearby',
      payload: {
        locationName: currentCenter.name,
        lat: currentCenter.lat,
        lng: currentCenter.lng,
        radiusKm: 5,
        semanticQuery: buildTaskFirstSemanticQuery({
          inputText: normalized,
          taskSemanticQuery: task.context.semanticQuery,
          locationName: currentCenter.name,
          activityType,
        }),
        ...(activityType ? { type: activityType } : {}),
      },
      source: 'task_runtime_inference',
      originalText: normalized,
    };
  }

  const shouldContinueExplore = Boolean(
    center
      && (
        EXPLORE_FOLLOWUP_PATTERN.test(normalized)
        || EXPLORE_TEXT_PATTERN.test(normalized)
      )
  );

  if (!shouldContinueExplore || !center) {
    return undefined;
  }

  if (!activityType && !(currentCenter || task.context.location?.name)) {
    return {
      action: 'ask_preference',
      payload: buildLocationPreferencePayload(normalized, activityType),
      source: 'task_runtime_inference',
      originalText: normalized,
    };
  }

  return {
    action: 'explore_nearby',
    payload: {
      locationName: center.name,
      ...(center.lat ? { lat: center.lat } : {}),
      ...(center.lng ? { lng: center.lng } : {}),
      radiusKm: 5,
      semanticQuery: buildTaskFirstSemanticQuery({
        inputText: normalized,
        taskSemanticQuery: task.context.semanticQuery,
        locationName: center.name,
        activityType,
      }),
      ...(activityType ? { type: activityType } : {}),
    },
    source: 'task_runtime_inference',
    originalText: normalized,
  };
}

async function inferStructuredActionFromOpenPartnerTask(params: {
  userId: string;
  conversationId: string;
  inputText: string;
}): Promise<ChatRequest['structuredAction'] | undefined> {
  const normalized = params.inputText.trim();
  if (!normalized) {
    return undefined;
  }

  const task = await resolveOpenPartnerTaskForConversation({
    userId: params.userId,
    conversationId: params.conversationId,
  });
  if (!task) {
    return undefined;
  }

  if (!['intent_captured', 'preference_collecting', 'auth_gate'].includes(task.currentStage)) {
    return undefined;
  }

  const hasExplicitSignal = PARTNER_FOLLOWUP_PATTERN.test(normalized);
  const isShortReply = normalized.length <= 18 && !/[。！？!?]/.test(normalized);
  if (!hasExplicitSignal && !isShortReply) {
    return undefined;
  }

  return {
    action: 'find_partner',
    payload: {
      rawInput: buildTaskFirstRawInput(task.goalText, normalized),
      ...(task.context.activityType ? { type: task.context.activityType } : {}),
      ...(task.context.locationHint ? { locationName: task.context.locationHint } : {}),
    },
    source: 'task_runtime_inference',
    originalText: normalized,
  };
}

async function inferStructuredActionFromOpenCreateTask(params: {
  userId: string;
  conversationId: string;
  activityId?: string;
  inputText: string;
}): Promise<ChatRequest['structuredAction'] | undefined> {
  const normalized = params.inputText.trim();
  if (!normalized) {
    return undefined;
  }

  const task = await resolveOpenCreateTaskForConversation({
    userId: params.userId,
    conversationId: params.conversationId,
    activityId: params.activityId,
  });
  if (!task) {
    return undefined;
  }

  if (!['intent_captured', 'draft_collecting', 'draft_ready', 'auth_gate'].includes(task.currentStage)) {
    return undefined;
  }

  if (task.activityId && CREATE_PUBLISH_PATTERN.test(normalized)) {
    return {
      action: 'confirm_publish',
      payload: {
        activityId: task.activityId,
      },
      source: 'task_runtime_inference',
      originalText: normalized,
    };
  }

  if (task.activityId && CREATE_DRAFT_UPDATE_PATTERN.test(normalized)) {
    const location = findKnownLocationCenter(normalized);
    const slot = inferDraftSlotFromText(normalized);
    const maxParticipants = inferMaxParticipantsFromText(normalized);

    return {
      action: 'save_draft_settings',
      payload: {
        activityId: task.activityId,
        ...(location?.name ? { locationName: location.name } : {}),
        ...(location?.lat !== undefined ? { lat: location.lat } : {}),
        ...(location?.lng !== undefined ? { lng: location.lng } : {}),
        ...(slot ? { slot } : {}),
        ...(maxParticipants !== undefined ? { maxParticipants } : {}),
        ...(task.context.startAt ? { startAt: task.context.startAt } : {}),
      },
      source: 'task_runtime_inference',
      originalText: normalized,
    };
  }

  if (task.currentStage === 'intent_captured' || task.currentStage === 'auth_gate') {
    const location = findKnownLocationCenter(normalized);
    const activityType = inferActivityTypeFromText(normalized) || task.context.type;

    return {
      action: 'create_activity',
      payload: {
        description: buildTaskFirstRawInput(task.goalText, normalized),
        ...(location?.name ? { locationName: location.name } : task.context.locationName ? { locationName: task.context.locationName } : {}),
        ...(activityType ? { type: activityType } : {}),
      },
      source: 'task_runtime_inference',
      originalText: normalized,
    };
  }

  return undefined;
}

function inferStructuredActionFromText(
  inputText: string,
  historyMessages: ChatRequest['messages']
): ChatRequest['structuredAction'] | undefined {
  const normalized = inputText.trim();
  if (!normalized) {
    return undefined;
  }

  const currentCenter = findKnownLocationCenter(normalized);
  const historyContext = extractSearchContextFromHistory(historyMessages);
  const center = currentCenter || historyContext.center;
  const activityType = inferActivityTypeFromText(normalized) || historyContext.activityType;
  const isBareLocationReply = Boolean(
    currentCenter
      && normalized.replace(/附近$/, '') === currentCenter.name
      && !/[，。,.!?？！；;:：]/.test(normalized)
      && normalized.length <= 12
  );
  const isShortReply = normalized.length <= 18 && !/[。！？!?]/.test(normalized);

  if (CREATE_FROM_EXPLORE_PATTERN.test(normalized) && center) {
    return {
      action: 'create_activity',
      payload: {
        description: buildCreatePromptFromExplore({
          locationName: center.name,
          originalText: normalized,
          activityType,
        }),
        locationName: center.name,
        ...(activityType ? { type: activityType } : {}),
      },
      source: 'text_action_inference',
      originalText: normalized,
    };
  }

  if (
    currentCenter
    && isBareLocationReply
    && (hasRecentLocationPrompt(historyMessages) || hasRecentCreatePrompt(historyMessages))
  ) {
    if (!activityType) {
      return {
        action: 'ask_preference',
        payload: buildTypePreferencePayload({
          center: currentCenter,
          semanticQuery: buildExploreSemanticQuery(currentCenter.name),
        }),
        source: 'text_action_inference',
        originalText: normalized,
      };
    }

    return {
      action: 'explore_nearby',
      payload: {
        locationName: currentCenter.name,
        lat: currentCenter.lat,
        lng: currentCenter.lng,
        radiusKm: 5,
        semanticQuery: buildExploreSemanticQuery(currentCenter.name, activityType),
        ...(activityType ? { type: activityType } : {}),
      },
      source: 'text_action_inference',
      originalText: normalized,
    };
  }

  if (PARTNER_ENTRY_PATTERN.test(normalized) || (hasRecentPartnerPrompt(historyMessages) && (PARTNER_FOLLOWUP_PATTERN.test(normalized) || isShortReply))) {
    return {
      action: 'find_partner',
      payload: {
        rawInput: normalized,
        ...(activityType ? { type: activityType } : {}),
        ...(center?.name ? { locationName: center.name } : {}),
        ...(center?.lat !== undefined ? { lat: center.lat } : {}),
        ...(center?.lng !== undefined ? { lng: center.lng } : {}),
      },
      source: 'text_action_inference',
      originalText: normalized,
    };
  }

  const shouldExplore = EXPLORE_TEXT_PATTERN.test(normalized)
    || (!!center && EXPLORE_FOLLOWUP_PATTERN.test(normalized));

  if (shouldExplore && !center) {
    return {
      action: 'ask_preference',
      payload: buildLocationPreferencePayload(normalized, activityType),
      source: 'text_action_inference',
      originalText: normalized,
    };
  }

  if (!shouldExplore || !center) {
    return undefined;
  }

  return {
    action: 'explore_nearby',
    payload: {
      locationName: center.name,
      lat: center.lat,
      lng: center.lng,
      radiusKm: 5,
      semanticQuery: normalized,
      ...(activityType ? { type: activityType } : {}),
    },
    source: 'text_action_inference',
    originalText: normalized,
  };
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
  historyMessages: ChatRequest['messages'],
  latestAssistantTurnContext?: GenUITurnContext,
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

  const continuation = resolveContinuationFromTurnContext(input.text, latestAssistantTurnContext);
  if (continuation) {
    return continuation.structuredAction;
  }

  return inferStructuredActionFromText(input.text, historyMessages);
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

function toHistoryMessages(messages: Array<{ role: string; content: unknown }>): ChatRequest['messages'] {
  return messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => {
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      const text = extractStoredMessageText(message.content);
      if (!text) {
        return null;
      }

      return {
        role,
        content: text,
      };
    })
    .filter((item): item is { role: 'assistant' | 'user'; content: string } => Boolean(item));
}

function readLatestAssistantTurnContextFromStoredMessages(
  messages: Array<{ role: string; content: unknown }>
): GenUITurnContext | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') {
      continue;
    }

    const turnContext = readTurnContextFromStoredMessage(message.content);
    if (turnContext) {
      return turnContext;
    }
  }

  return undefined;
}

function readTransientConversationTurnsFromRequest(request: GenUIRequest): {
  historyMessages: ChatRequest['messages'];
  latestAssistantTurnContext?: GenUITurnContext;
} {
  const transientTurns = Array.isArray(request.context?.transientTurns)
    ? request.context.transientTurns
    : [];

  const recentTurns = transientTurns.slice(-MAX_HISTORY_MESSAGES);
  let latestAssistantTurnContext: GenUITurnContext | undefined;

  const historyMessages = recentTurns
    .map((turn) => {
      if (!isRecord(turn)) {
        return null;
      }

      const role = turn.role === 'assistant' || turn.role === 'user' ? turn.role : null;
      const text = typeof turn.text === 'string' ? turn.text.trim() : '';
      if (!role || !text) {
        return null;
      }

      if (role === 'assistant') {
        const turnContext = readTurnContextFromStoredMessage({ turnContext: turn.turnContext });
        if (turnContext) {
          latestAssistantTurnContext = turnContext;
        }
      }

      return {
        role,
        content: text,
      };
    })
    .filter((item): item is { role: GenUITransientTurn['role']; content: string } => Boolean(item));

  return {
    historyMessages,
    ...(latestAssistantTurnContext ? { latestAssistantTurnContext } : {}),
  };
}

async function resolveConversationContext(
  request: GenUIRequest,
  viewer: ViewerContext | null
): Promise<ResolvedConversation> {
  const requestedConversationId = request.conversationId?.trim() || '';

  if (!viewer) {
    const conversationId = requestedConversationId || createId(ID_PREFIX.conversation);
    const transientConversation = readTransientConversationTurnsFromRequest(request);
    const historySource: HistorySource = transientConversation.historyMessages.length > 0 ? 'request_transient' : 'empty';
    const conversationMode: ConversationMode = 'anonymous_transient';

    return {
      conversationId,
      historyMessages: transientConversation.historyMessages,
      ...(transientConversation.latestAssistantTurnContext
        ? { latestAssistantTurnContext: transientConversation.latestAssistantTurnContext }
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
          turnContext: transientConversation.latestAssistantTurnContext?.kind || null,
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

      const latestAssistantTurnContext = readLatestAssistantTurnContextFromStoredMessages(conversation.messages);

      return {
        conversationId: requestedConversationId,
        historyMessages: toHistoryMessages(conversation.messages),
        ...(latestAssistantTurnContext
          ? { latestAssistantTurnContext }
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
            turnContext: latestAssistantTurnContext?.kind || null,
          },
        },
      };
    }
  }

  const thread = await createThread(viewer.id);

  return {
    conversationId: thread.id,
    historyMessages: [],
    trace: {
      stage: 'conversation_resolved',
      detail: {
        source: 'created',
        authenticated: true,
        messageCount: 0,
        conversationId: thread.id,
        conversationMode: 'authenticated_persistent',
        historySource: 'empty',
        turnContext: null,
      },
    },
  };
}

async function resolveAiChatExecution(
  request: GenUIRequest,
  viewer: ViewerContext | null,
  abortSignal?: AbortSignal
): Promise<ResolvedAiChatExecution> {
  const conversation = await resolveConversationContext(request, viewer);
  const userText = normalizeActionDisplayText(request.input);
  const turnContextResolution = request.input.type === 'text'
    ? resolveContinuationFromTurnContext(request.input.text, conversation.latestAssistantTurnContext)
    : undefined;
  const requestActivityId =
    typeof request.context?.activityId === 'string' && request.context.activityId.trim()
      ? request.context.activityId.trim()
      : undefined;
  const taskFirstStructuredAction = request.input.type === 'text' && viewer
    ? await inferStructuredActionFromOpenJoinTask({
        userId: viewer.id,
        conversationId: conversation.conversationId,
        activityId: requestActivityId,
        inputText: request.input.text,
      })
      || await inferStructuredActionFromOpenPartnerTask({
        userId: viewer.id,
        conversationId: conversation.conversationId,
        inputText: request.input.text,
      })
      || await inferStructuredActionFromOpenCreateTask({
        userId: viewer.id,
        conversationId: conversation.conversationId,
        activityId: requestActivityId,
        inputText: request.input.text,
      })
    : undefined;
  const resolvedStructuredAction = request.input.type === 'action'
    ? resolveStructuredActionFromInput(
        request.input,
        conversation.historyMessages,
        conversation.latestAssistantTurnContext,
        typeof request.context?.entry === 'string' ? request.context.entry : undefined
      )
    : turnContextResolution?.structuredAction
      || taskFirstStructuredAction
      || inferStructuredActionFromText(request.input.text, conversation.historyMessages);
  const location = parseRequestLocation(request) || parseStructuredActionLocation(resolvedStructuredAction);
  const ai = parseRequestAiParams(request);

  if (!userText) {
    throw new Error('输入内容不能为空');
  }

  const source = request.context?.client === 'admin' ? 'admin' : 'miniprogram';

  return {
    conversation,
    userText,
    resolvedStructuredAction,
    ...(turnContextResolution
      ? {
          resolutionTrace: {
            stage: 'turn_context_resolved',
            detail: {
              inputText: userText,
              contextKind: turnContextResolution.contextKind,
              matchedBy: turnContextResolution.matchedBy,
              matchedText: turnContextResolution.matchedText,
              action: turnContextResolution.structuredAction.action,
            },
          },
        }
      : taskFirstStructuredAction
        ? {
            resolutionTrace: {
              stage: 'task_runtime_resolved',
              detail: {
                inputText: userText,
                action: taskFirstStructuredAction.action,
                source: taskFirstStructuredAction.source ?? 'task_runtime_inference',
                conversationId: conversation.conversationId,
              },
            },
          }
      : {}),
    defaultExecutionPath: resolvedStructuredAction ? 'structured_action' : 'llm_orchestrated',
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
      // v5.4: 传递最近一次 Assistant Turn 的上下文，用于无登录状态下感知已收集的偏好
      ...(conversation.latestAssistantTurnContext
        ? { latestAssistantTurnContext: conversation.latestAssistantTurnContext }
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

function createTextBlock(content: string, traceRef: string, dedupeKey?: string): GenUIBlock {
  return {
    blockId: createId(ID_PREFIX.block),
    type: 'text',
    content,
    ...(dedupeKey ? { dedupeKey, replacePolicy: 'replace' as const } : {}),
    meta: { traceRef },
  };
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

function compactTurnEnvelopeForStream(envelope: GenUITurnEnvelope): GenUITurnEnvelope {
  return {
    ...envelope,
    turn: {
      ...envelope.turn,
      blocks: envelope.turn.blocks.map((block) => compactBlockForStream(block)),
    },
  };
}

function createListBlock(params: {
  title?: string;
  items: Record<string, unknown>[];
  dedupeKey: string;
  traceRef: string;
  center?: { lat: number; lng: number; name: string };
  semanticQuery?: string;
  fetchConfig?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
  preview?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}): GenUIBlock {
  return {
    blockId: createId(ID_PREFIX.block),
    type: 'list',
    ...(params.title ? { title: params.title } : {}),
    items: params.items,
    ...(params.center ? { center: params.center } : {}),
    ...(params.semanticQuery ? { semanticQuery: params.semanticQuery } : {}),
    ...(params.fetchConfig ? { fetchConfig: params.fetchConfig } : {}),
    ...(params.interaction ? { interaction: params.interaction } : {}),
    ...(params.preview ? { preview: params.preview } : {}),
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: {
      ...(params.meta ?? {}),
      traceRef: params.traceRef,
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
    },
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

    const exploreList = mapExplorePayloadToList(outputRecord, traceRef, `tool_${toolName}_list`);
    if (exploreList) {
      blocks.push(exploreList);
    }

    if (!draft && !exploreList) {
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
    if (action === 'find_partner' || action === 'select_preference' || action === 'skip_preference') {
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

function buildProcessorStepTraceFromEventData(data: Record<string, unknown>): GenUITracePayload {
  return {
    stage: 'processor_step',
    detail: {
      id: toStringValue(data.id),
      type: toStringValue(data.type),
      name: toStringValue(data.name),
      status: toStringValue(data.status),
      ...(typeof data.startedAt === 'string' ? { startedAt: data.startedAt } : {}),
      ...(typeof data.completedAt === 'string' ? { completedAt: data.completedAt } : {}),
      ...(typeof data.duration === 'number' ? { duration: data.duration } : {}),
      ...(isRecord(data.data) ? { data: data.data } : {}),
      ...(typeof data.error === 'string' ? { error: data.error } : {}),
    },
  };
}

function buildWorkflowCompleteTraceFromEventData(
  data: Record<string, unknown>,
  executionPath: ExecutionPath
): GenUITracePayload {
  return {
    stage: 'workflow_complete',
    detail: {
      status: toStringValue(data.status),
      completedAt: toStringValue(data.completedAt),
      totalDuration: data.totalDuration,
      executionPath: toStringValue(data.executionPath, executionPath),
    },
  };
}

function buildBlocksFromDataStream(
  events: DataStreamEvent[],
  defaultExecutionPath: ExecutionPath,
  request?: GenUIRequest
): {
  blocks: GenUIBlock[];
  traces: GenUITracePayload[];
  executionPath: ExecutionPath;
} {
  const traces: GenUITracePayload[] = [];
  const toolStates = new Map<string, ToolInvocationState>();
  const widgetDataEvents: Array<{ widgetType: string; payload: unknown }> = [];
  const actionResultEvents: ActionResultEvent[] = [];

  let assistantText = '';
  let executionPath = defaultExecutionPath;
  let cardPriorityLeadText: string | null = null;

  for (const event of events) {
    if (event.type === 'text-delta') {
      assistantText += toStringValue(event.delta);
      continue;
    }

    if (event.type === 'tool-input-start' || event.type === 'tool-input-available') {
      const toolCallId = toStringValue(event.toolCallId);
      if (!toolCallId) {
        continue;
      }

      const existing = toolStates.get(toolCallId) || {
        toolCallId,
        toolName: toStringValue(event.toolName, 'unknown_tool'),
      };

      if (event.type === 'tool-input-start') {
        existing.toolName = toStringValue(event.toolName, existing.toolName);
      }

      if (event.type === 'tool-input-available' && isRecord(event.input)) {
        existing.toolName = toStringValue(event.toolName, existing.toolName);
        existing.input = event.input;
      }

      toolStates.set(toolCallId, existing);
      continue;
    }

    if (event.type === 'tool-output-available' || event.type === 'tool-output-error') {
      const toolCallId = toStringValue(event.toolCallId);
      if (!toolCallId) {
        continue;
      }

      const existing = toolStates.get(toolCallId) || {
        toolCallId,
        toolName: toStringValue(event.toolName, 'unknown_tool'),
      };

      if (event.type === 'tool-output-available') {
        existing.output = event.output;
      } else {
        existing.errorText = toStringValue(event.errorText, '工具执行失败');
      }

      toolStates.set(toolCallId, existing);
      if (!cardPriorityLeadText) {
        cardPriorityLeadText = request && isRecord(existing.output)
          ? resolvePartnerFormLeadText(request, existing.output)
          : null;
      }
      if (!cardPriorityLeadText) {
        cardPriorityLeadText = resolveCardPriorityLeadTextFromTool(
          existing.toolName,
          existing.input,
          existing.output
        );
      }
      continue;
    }

    if (event.type === 'data-trace-start' && isRecord(event.data)) {
      const intentMethod = toStringValue(event.data.intentMethod);
      if (intentMethod === 'structured_action') {
        executionPath = 'structured_action';
      } else if (intentMethod) {
        executionPath = 'llm_orchestrated';
      }
      continue;
    }

    if ((event.type === 'data-widget' || event.type === 'data') && isRecord(event.data)) {
      const widgetType = toStringValue(event.data.type);
      if (widgetType.startsWith('widget_')) {
        widgetDataEvents.push({
          widgetType,
          payload: event.data.payload,
        });
        if (!cardPriorityLeadText) {
          cardPriorityLeadText = request && isRecord(event.data.payload)
            ? resolvePartnerFormLeadText(request, event.data.payload)
            : null;
        }
        if (!cardPriorityLeadText) {
          cardPriorityLeadText = resolveCardPriorityLeadTextFromWidget(
            widgetType,
            event.data.payload
          );
        }
      } else if (widgetType === 'action_result') {
        actionResultEvents.push({
          success: event.data.success === true,
          ...(typeof event.data.error === 'string' ? { error: event.data.error } : {}),
          ...(isActionResultNextActions(event.data.nextActions) ? { nextActions: event.data.nextActions } : {}),
        });
      }
      continue;
    }

    if (event.type === 'data-trace-step' && isRecord(event.data)) {
      const stepType = toStringValue(event.data.type);
      if (stepType === 'structured-action') {
        executionPath = 'structured_action';
      }

      traces.push(buildProcessorStepTraceFromEventData(event.data));
      continue;
    }

    if (event.type === 'data-trace-end' && isRecord(event.data)) {
      traces.push(buildWorkflowCompleteTraceFromEventData(event.data, executionPath));
    }
  }

  const blocks: GenUIBlock[] = [];
  const trimmedText = cardPriorityLeadText || assistantText.trim();
  if (trimmedText) {
    pushBlock(blocks, createTextBlock(trimmedText, 'assistant_text', 'assistant_text'));
  }

  for (const widgetEvent of widgetDataEvents) {
    const block = mapWidgetDataToBlock({
      request,
      widgetType: widgetEvent.widgetType,
      payload: widgetEvent.payload,
      assistantText: trimmedText,
      traceRef: widgetEvent.widgetType,
    });

    if (block) {
      pushBlock(blocks, block);
    }
  }

  for (const actionResult of actionResultEvents) {
    const actionCta = mapActionResultToCtaBlock(actionResult, 'action_result');
    if (actionCta) {
      pushBlock(blocks, actionCta);
    }
  }

  for (const toolState of toolStates.values()) {
    const mappedBlocks = mapToolOutputToBlocks({
      request,
      toolName: toolState.toolName,
      toolInput: toolState.input,
      toolOutput: toolState.output,
      toolError: toolState.errorText,
      assistantText: trimmedText,
      traceRef: `tool_${toolState.toolName}`,
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

  const finalBlocks = removeRedundantPreferenceBlocks(blocks);

  ensureStrictTraceCoverage(traces, trimmedText, executionPath);

  traces.push({
    stage: 'genui_blocks_built',
    detail: {
      blockCount: finalBlocks.length,
      blockTypes: finalBlocks.map((block) => block.type),
      executionPath,
    },
  });

  return {
    blocks: finalBlocks,
    traces,
    executionPath,
  };
}

function createStreamEvent(...args: StreamEventArgs): GenUIStreamEvent {
  const eventId = createId(ID_PREFIX.event);
  const timestamp = new Date().toISOString();

  switch (args[0]) {
    case 'turn-start':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'block-append':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'block-replace':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'turn-status':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'turn-complete':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'turn-error':
      return { eventId, event: args[0], timestamp, data: args[1] };
    case 'trace':
      return { eventId, event: args[0], timestamp, data: args[1] };
  }
}

export function buildAiChatStreamEvents(
  envelope: GenUITurnEnvelope,
  traces: GenUITracePayload[],
  streamOptions: ResolvedStreamOptions = {
    includeTrace: true,
    eventEnvelope: 'full',
  }
): GenUIStreamEvent[] {
  const events: GenUIStreamEvent[] = [];

  events.push(
    createStreamEvent('turn-start', {
      traceId: envelope.traceId,
      conversationId: envelope.conversationId,
      turnId: envelope.turn.turnId,
    })
  );

  events.push(
    createStreamEvent('turn-status', {
      turnId: envelope.turn.turnId,
      status: 'streaming',
    })
  );

  for (const block of envelope.turn.blocks) {
    events.push(
      createStreamEvent('block-append', {
        turnId: envelope.turn.turnId,
        block,
      })
    );
  }

  events.push(
    createStreamEvent('turn-status', {
      turnId: envelope.turn.turnId,
      status: 'completed',
    })
  );

  events.push(createStreamEvent('turn-complete', envelope));

  if (streamOptions.includeTrace) {
    for (const trace of traces) {
      events.push(createStreamEvent('trace', trace));
    }
  }

  return events;
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
        turnId: event.data.turnId,
        block: compactBlockForStream(event.data.block),
      };
    case 'turn-complete':
      return compactTurnEnvelopeForStream(event.data);
    default:
      return event.data;
  }
}

function serializeSSE(event: GenUIStreamEvent, streamOptions: ResolvedStreamOptions): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(readStreamEventPayload(event, streamOptions))}\n\n`;
}

export function createAiChatSSEStreamResponse(
  events: GenUIStreamEvent[],
  streamOptions: ResolvedStreamOptions = {
    includeTrace: true,
    eventEnvelope: 'full',
  }
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(serializeSSE(event, streamOptions)));
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
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

function getTraceSignature(trace: GenUITracePayload): string {
  return JSON.stringify({
    stage: trace.stage,
    detail: trace.detail,
  });
}

function upsertBridgeBlock(
  blocks: GenUIBlock[],
  block: GenUIBlock
): {
  eventName: 'block-append' | 'block-replace';
  block: GenUIBlock;
  changed: boolean;
} {
  const targetIndex = block.dedupeKey
    ? blocks.findIndex((item) => item.dedupeKey === block.dedupeKey)
    : blocks.findIndex((item) => item.blockId === block.blockId);

  if (targetIndex >= 0) {
    const previousBlock = blocks[targetIndex];
    const nextBlock = {
      ...block,
      blockId: previousBlock.blockId,
    };
    const changed = JSON.stringify(previousBlock) !== JSON.stringify(nextBlock);
    if (!changed) {
      return {
        eventName: 'block-replace',
        block: previousBlock,
        changed: false,
      };
    }

    blocks[targetIndex] = nextBlock;
    return {
      eventName: 'block-replace',
      block: nextBlock,
      changed: true,
    };
  }

  blocks.push(block);
  return {
    eventName: 'block-append',
    block,
    changed: true,
  };
}

function createStreamingTextBlock(content: string, blockId: string): GenUIBlock {
  return {
    blockId,
    type: 'text',
    content,
    dedupeKey: 'assistant_text',
    replacePolicy: 'replace',
    meta: {
      traceRef: 'assistant_text',
    },
  };
}

export async function createAiChatBridgeStreamResponse(
  request: GenUIRequest,
  options?: CreateAiChatBridgeStreamResponseOptions
): Promise<Response> {
  const viewer = options?.viewer ?? null;
  const streamOptions = resolveStreamOptions(request);
  const bridgeAbortController = new AbortController();
  const requestAbortSignal = options?.requestAbortSignal;

  if (requestAbortSignal) {
    if (requestAbortSignal.aborted) {
      bridgeAbortController.abort(requestAbortSignal.reason);
    } else {
      requestAbortSignal.addEventListener(
        'abort',
        () => {
          bridgeAbortController.abort(requestAbortSignal.reason);
        },
        { once: true }
      );
    }
  }

  const execution = await resolveAiChatExecution(
    request,
    viewer,
    bridgeAbortController.signal
  );
  const initialCardPriorityLeadText = inferInitialCardPriorityLeadText(request, execution);

  const traceId = createId(ID_PREFIX.trace);
  const turnId = createId(ID_PREFIX.turn);
  const textBlockId = createId(ID_PREFIX.block);

  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const closeBridgeStream = () => {
        try {
          controller.close();
        } catch {
          // ignore double-close during abort races
        }
      };

      const shouldStopBridge = () => bridgeAbortController.signal.aborted;

      const stopBridgeIfAborted = () => {
        if (!shouldStopBridge()) {
          return false;
        }

        closeBridgeStream();
        return true;
      };

      const emit = (event: GenUIStreamEvent) => {
        if (shouldStopBridge()) {
          return;
        }
        controller.enqueue(encoder.encode(serializeSSE(event, streamOptions)));
      };

      const emitDone = () => {
        if (shouldStopBridge()) {
          return;
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      };

      const emitTrace = (
        trace: GenUITracePayload,
        traces: GenUITracePayload[],
        emittedTraceSignatures: Set<string>
      ) => {
        traces.push(trace);
        if (!streamOptions.includeTrace) {
          return;
        }

        emittedTraceSignatures.add(getTraceSignature(trace));
        emit(createStreamEvent('trace', trace));
      };

      const streamedBlocks: GenUIBlock[] = [];
      const toolStates = new Map<string, ToolInvocationState>();
      const internalEvents: DataStreamEvent[] = [];
      const streamedTraces: GenUITracePayload[] = [];
      const emittedTraceSignatures = new Set<string>();
      let rawEventCount = 0;
      let done = false;
      let assistantText = '';
      let executionPath = execution.defaultExecutionPath;
      let cardPriorityLeadText: string | null = initialCardPriorityLeadText;

      const emitCardPriorityLeadText = (nextText: string | null) => {
        if (!nextText || shouldStopBridge()) {
          return;
        }

        if (nextText === cardPriorityLeadText) {
          return;
        }

        const currentScore = scoreCardPriorityLeadText(cardPriorityLeadText);
        const nextScore = scoreCardPriorityLeadText(nextText);
        if (cardPriorityLeadText && nextScore < currentScore) {
          return;
        }

        cardPriorityLeadText = nextText;
        const blockEvent = upsertBridgeBlock(
          streamedBlocks,
          createStreamingTextBlock(nextText, textBlockId)
        );
        if (!blockEvent.changed) {
          return;
        }
        emit(createStreamEvent(blockEvent.eventName, {
          turnId,
          block: blockEvent.block,
        }));
      };

      const hasStreamedAssistantTextBlock = () => (
        streamedBlocks.some((block) => block.type === 'text' && block.dedupeKey === 'assistant_text')
      );

      const ensureAssistantTextBlockBeforeStructured = (preferredText?: string | null) => {
        if (shouldStopBridge() || hasStreamedAssistantTextBlock()) {
          return;
        }

        const nextText = toStringValue(
          preferredText,
          toStringValue(cardPriorityLeadText, assistantText.trim())
        );
        if (!nextText) {
          return;
        }

        const blockEvent = upsertBridgeBlock(
          streamedBlocks,
          createStreamingTextBlock(nextText, textBlockId)
        );
        if (!blockEvent.changed) {
          return;
        }

        emit(createStreamEvent(blockEvent.eventName, {
          turnId,
          block: blockEvent.block,
        }));
      };

      try {
        if (stopBridgeIfAborted()) {
          return;
        }

        emit(createStreamEvent('turn-start', {
          traceId,
          conversationId: execution.conversation.conversationId,
          turnId,
        }));
        emit(createStreamEvent('turn-status', {
          turnId,
          status: 'streaming',
        }));
        if (initialCardPriorityLeadText) {
          const blockEvent = upsertBridgeBlock(
            streamedBlocks,
            createStreamingTextBlock(initialCardPriorityLeadText, textBlockId)
          );
          if (blockEvent.changed) {
            emit(createStreamEvent(blockEvent.eventName, {
              turnId,
              block: blockEvent.block,
            }));
          }
        }
        emitTrace(execution.conversation.trace, streamedTraces, emittedTraceSignatures);

        const aiResponse = await handleChatStream(execution.chatRequest);
        if (!aiResponse.body) {
          throw new Error('AI 流式响应为空');
        }

        const decoder = new TextDecoder();
        reader = aiResponse.body.getReader();
        let buffer = '';

        const processInternalEvent = (event: DataStreamEvent) => {
          if (shouldStopBridge()) {
            return;
          }

          internalEvents.push(event);

          if (event.type === 'text-delta') {
            assistantText += toStringValue(event.delta);
            if (cardPriorityLeadText) {
              return;
            }
            const blockEvent = upsertBridgeBlock(
              streamedBlocks,
              createStreamingTextBlock(assistantText, textBlockId)
            );
            if (!blockEvent.changed) {
              return;
            }
            emit(createStreamEvent(blockEvent.eventName, {
              turnId,
              block: blockEvent.block,
            }));
            return;
          }

          if (event.type === 'tool-input-start' || event.type === 'tool-input-available') {
            const toolCallId = toStringValue(event.toolCallId);
            if (!toolCallId) {
              return;
            }

            const existing = toolStates.get(toolCallId) || {
              toolCallId,
              toolName: toStringValue(event.toolName, 'unknown_tool'),
            };

            if (event.type === 'tool-input-start') {
              existing.toolName = toStringValue(event.toolName, existing.toolName);
            }

            if (event.type === 'tool-input-available' && isRecord(event.input)) {
              existing.toolName = toStringValue(event.toolName, existing.toolName);
              existing.input = event.input;
            }

            toolStates.set(toolCallId, existing);
            emitCardPriorityLeadText(
              (isRecord(existing.output) && resolvePartnerFormLeadText(request, existing.output))
                || resolveCardPriorityLeadTextFromTool(existing.toolName, existing.input, existing.output)
            );
            return;
          }

          if (event.type === 'tool-output-available' || event.type === 'tool-output-error') {
            const toolCallId = toStringValue(event.toolCallId);
            if (!toolCallId) {
              return;
            }

            const existing = toolStates.get(toolCallId) || {
              toolCallId,
              toolName: toStringValue(event.toolName, 'unknown_tool'),
            };

            if (event.type === 'tool-output-available') {
              existing.output = event.output;
            } else {
              existing.errorText = toStringValue(event.errorText, '工具执行失败');
            }

            toolStates.set(toolCallId, existing);
            emitCardPriorityLeadText(
              (isRecord(existing.output) && resolvePartnerFormLeadText(request, existing.output))
                || resolveCardPriorityLeadTextFromTool(existing.toolName, existing.input, existing.output)
            );

            const mappedBlocks = mapToolOutputToBlocks({
              request,
              toolName: existing.toolName,
              toolInput: existing.input,
              toolOutput: existing.output,
              toolError: existing.errorText,
              assistantText: assistantText.trim(),
              traceRef: `tool_${existing.toolName}`,
            });

            for (const block of mappedBlocks) {
              if (block.type !== 'text') {
                ensureAssistantTextBlockBeforeStructured();
              }
              const blockEvent = upsertBridgeBlock(streamedBlocks, block);
              if (!blockEvent.changed) {
                continue;
              }
              emit(createStreamEvent(blockEvent.eventName, {
                turnId,
                block: blockEvent.block,
              }));
            }
            return;
          }

          if (event.type === 'data-trace-start' && isRecord(event.data)) {
            const traceExecutionPath = toStringValue(event.data.executionPath);
            const intentMethod = toStringValue(event.data.intentMethod);

            if (traceExecutionPath === 'structured_action' || intentMethod === 'structured_action') {
              executionPath = 'structured_action';
            } else if (traceExecutionPath === 'llm' || traceExecutionPath === 'llm_orchestrated' || intentMethod) {
              executionPath = 'llm_orchestrated';
            }
            return;
          }

          if ((event.type === 'data-widget' || event.type === 'data') && isRecord(event.data)) {
            const widgetType = toStringValue(event.data.type);
            if (widgetType.startsWith('widget_')) {
              emitCardPriorityLeadText(
                (isRecord(event.data.payload) && resolvePartnerFormLeadText(request, event.data.payload))
                  || resolveCardPriorityLeadTextFromWidget(widgetType, event.data.payload)
              );
              const block = mapWidgetDataToBlock({
                request,
                widgetType,
                payload: event.data.payload,
                assistantText: assistantText.trim(),
                traceRef: widgetType,
              });

              if (block) {
                if (block.type !== 'text') {
                  ensureAssistantTextBlockBeforeStructured();
                }
                const blockEvent = upsertBridgeBlock(streamedBlocks, block);
                if (!blockEvent.changed) {
                  return;
                }
                emit(createStreamEvent(blockEvent.eventName, {
                  turnId,
                  block: blockEvent.block,
                }));
              }
              return;
            }

            if (widgetType === 'action_result') {
              const block = mapActionResultToCtaBlock({
                success: event.data.success === true,
                ...(typeof event.data.error === 'string' ? { error: event.data.error } : {}),
                ...(isActionResultNextActions(event.data.nextActions) ? { nextActions: event.data.nextActions } : {}),
              }, 'action_result');

              if (block) {
                if (block.type !== 'text') {
                  ensureAssistantTextBlockBeforeStructured();
                }
                const blockEvent = upsertBridgeBlock(streamedBlocks, block);
                if (!blockEvent.changed) {
                  return;
                }
                emit(createStreamEvent(blockEvent.eventName, {
                  turnId,
                  block: blockEvent.block,
                }));
              }
            }
            return;
          }

          if (event.type === 'data-trace-step' && isRecord(event.data)) {
            const stepType = toStringValue(event.data.type);
            if (stepType === 'structured-action') {
              executionPath = 'structured_action';
            }

            emitTrace(
              buildProcessorStepTraceFromEventData(event.data),
              streamedTraces,
              emittedTraceSignatures
            );
            return;
          }

          if (event.type === 'data-trace-end' && isRecord(event.data)) {
            emitTrace(
              buildWorkflowCompleteTraceFromEventData(event.data, executionPath),
              streamedTraces,
              emittedTraceSignatures
            );
          }
        };

        while (true) {
          if (stopBridgeIfAborted()) {
            return;
          }

          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }

          buffer += decoder.decode(chunk.value, { stream: true });

          let nextPacket = splitNextSSEPacket(buffer);
          while (nextPacket) {
            const packet = nextPacket.packet;
            buffer = nextPacket.rest;
            rawEventCount += 1;

            const dataText = parseSSEPacket(packet).trim();
            if (!dataText) {
              nextPacket = splitNextSSEPacket(buffer);
              continue;
            }

            if (dataText === '[DONE]') {
              done = true;
              nextPacket = splitNextSSEPacket(buffer);
              continue;
            }

            const parsed = parseDataStreamEvent(dataText);
            if (parsed) {
              processInternalEvent(parsed);
            }

            nextPacket = splitNextSSEPacket(buffer);
          }
        }

        const remaining = buffer.trim();
        if (remaining) {
          rawEventCount += 1;
          const dataText = parseSSEPacket(remaining).trim();
          if (dataText === '[DONE]') {
            done = true;
          } else if (dataText) {
            const parsed = parseDataStreamEvent(dataText);
            if (parsed) {
              processInternalEvent(parsed);
            }
          }
        }

        if (stopBridgeIfAborted()) {
          return;
        }

        const mapped = buildBlocksFromDataStream(
          internalEvents,
          execution.defaultExecutionPath,
          request
        );
        executionPath = mapped.executionPath;
        const turnContext = buildTurnContextFromBlocks(mapped.blocks);

        const baseEnvelope: GenUITurnEnvelope = {
          traceId,
          conversationId: execution.conversation.conversationId,
          turn: {
            turnId,
            role: 'assistant',
            status: 'completed',
            blocks: mapped.blocks,
            ...(turnContext ? { turnContext } : {}),
          },
        };

        const finalTraces: GenUITracePayload[] = [
          execution.conversation.trace,
          ...(execution.resolutionTrace ? [execution.resolutionTrace] : []),
          {
            stage: 'chat_stream_bridged',
            detail: {
              done,
              rawEventCount,
              parsedEventCount: internalEvents.length,
              executionPath,
              structuredAction: execution.resolvedStructuredAction?.action || null,
            },
          },
          ...mapped.traces,
          {
            stage: 'turn_complete',
            detail: {
              traceId,
              turnId,
              conversationId: execution.conversation.conversationId,
              blockCount: mapped.blocks.length,
            },
          },
        ];

        const outcome = inferResultOutcome(request, mapped.blocks);
        if (outcome) {
          finalTraces.push({
            stage: 'result_outcome',
            detail: {
              outcome: outcome.outcome,
              confidence: outcome.confidence,
              evidence: outcome.evidence,
            },
          });
        }

        if (stopBridgeIfAborted()) {
          return;
        }

        await persistActivityFollowUpResult({
          request,
          blocks: mapped.blocks,
          viewer,
          traces: finalTraces,
        });

        if (stopBridgeIfAborted()) {
          return;
        }

        const normalized = applyAiChatTurnPolicies({
          request,
          viewer,
          envelope: baseEnvelope,
          traces: finalTraces,
          resolvedStructuredAction: execution.resolvedStructuredAction,
          executionPath,
        });

        const responseTraces = [
          ...normalized.traces,
          {
            stage: 'controller_response_ready',
            detail: {
              executionPath,
              structuredAction: execution.resolvedStructuredAction?.action || null,
              stream: true,
              authenticated: !!viewer,
              blockCount: normalized.envelope.turn.blocks.length,
            },
          },
        ];

        if (stopBridgeIfAborted()) {
          return;
        }

        if (viewer) {
          await syncJoinTaskFromChatTurn({
            userId: viewer.id,
            conversationId: normalized.envelope.conversationId,
            request,
            blocks: normalized.envelope.turn.blocks,
          });
          await syncPartnerTaskFromChatTurn({
            userId: viewer.id,
            conversationId: normalized.envelope.conversationId,
            request,
            blocks: normalized.envelope.turn.blocks,
          });
          await syncCreateTaskFromChatTurn({
            userId: viewer.id,
            conversationId: normalized.envelope.conversationId,
            request,
            blocks: normalized.envelope.turn.blocks,
          });
          await syncConversationTurnSnapshot({
            conversationId: normalized.envelope.conversationId,
            userId: viewer.id,
            userText: execution.userText,
            blocks: normalized.envelope.turn.blocks,
            turnId: normalized.envelope.turn.turnId,
            traceId: normalized.envelope.traceId,
            inputType: request.input.type,
            resolvedStructuredAction: execution.resolvedStructuredAction,
            activityId: typeof request.context?.activityId === 'string' ? request.context.activityId : undefined,
          });
        }

        if (stopBridgeIfAborted()) {
          return;
        }

        emit(createStreamEvent('turn-status', {
          turnId,
          status: 'completed',
        }));
        emit(createStreamEvent('turn-complete', normalized.envelope));

        if (streamOptions.includeTrace) {
          for (const trace of responseTraces) {
            const signature = getTraceSignature(trace);
            if (emittedTraceSignatures.has(signature)) {
              continue;
            }

            emittedTraceSignatures.add(signature);
            emit(createStreamEvent('trace', trace));
          }
        }

        emitDone();
        controller.close();
      } catch (error) {
        if (bridgeAbortController.signal.aborted) {
          closeBridgeStream();
          return;
        }

        const message = normalizeAiProviderErrorMessage(
          error instanceof Error ? error.message : 'AI 服务暂时不可用'
        );
        emit(createStreamEvent('turn-status', {
          turnId,
          status: 'error',
        }));
        emit(createStreamEvent('turn-error', {
          turnId,
          message,
        }));
        emitDone();
        closeBridgeStream();
      } finally {
        if (reader) {
          try {
            await reader.cancel();
          } catch {
            // ignore reader cancel failures during shutdown
          }
        }
      }
    },
    async cancel(reason) {
      bridgeAbortController.abort(reason);
      if (reader) {
        try {
          await reader.cancel(reason);
        } catch {
          // ignore reader cancel failures during abort
        }
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

export async function buildAiChatTurn(
  request: GenUIRequest,
  options?: BuildAiChatTurnOptions
): Promise<BuildAiChatTurnResult> {
  const viewer = options?.viewer ?? null;
  const execution = await resolveAiChatExecution(request, viewer);
  const aiResponse = await handleChatStream(execution.chatRequest);
  const parsed = await parseDataStreamResponse(aiResponse);
  const mapped = buildBlocksFromDataStream(
    parsed.events,
    execution.defaultExecutionPath,
    request
  );
  const executionPath = mapped.executionPath;
  const turnContext = buildTurnContextFromBlocks(mapped.blocks);

  const traceId = createId(ID_PREFIX.trace);
  const turnId = createId(ID_PREFIX.turn);

  const envelope: GenUITurnEnvelope = {
    traceId,
    conversationId: execution.conversation.conversationId,
    turn: {
      turnId,
      role: 'assistant',
      status: 'completed',
      blocks: mapped.blocks,
      ...(turnContext ? { turnContext } : {}),
    },
  };

  const traces: GenUITracePayload[] = [
    execution.conversation.trace,
    ...(execution.resolutionTrace ? [execution.resolutionTrace] : []),
    {
      stage: 'chat_stream_parsed',
      detail: {
        done: parsed.done,
        rawEventCount: parsed.rawEventCount,
        parsedEventCount: parsed.events.length,
        executionPath,
        structuredAction: execution.resolvedStructuredAction?.action || null,
      },
    },
    ...mapped.traces,
    {
      stage: 'turn_complete',
      detail: {
        traceId,
        turnId,
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

  await persistActivityFollowUpResult({
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

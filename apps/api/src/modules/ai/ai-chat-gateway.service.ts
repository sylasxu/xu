import { randomUUID } from 'crypto';
import type {
  GenUIBlock,
  GenUIChoiceOption,
  GenUIRequest,
  GenUIRequestAi,
  GenUIRequestContext,
  GenUIStreamEvent,
  GenUITracePayload,
  GenUITurnEnvelope,
} from '@juchang/genui-contract';
import {
  getConversationMessages,
  handleChatStream,
  type ChatRequest,
} from './ai.service';
import { createThread } from './memory';
import { isUserActionType } from './user-action';
import {
  createChoiceBlock,
  createEntityCardBlock,
  createCtaGroupBlock,
  createAlertBlock,
  createFormBlock,
  pushBlock,
} from './shared/genui-blocks';
import { saveActivityReviewSummary } from '../participants/participant.service';

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
const REVIEW_SUMMARY_MAX_LENGTH = 280;


interface ViewerContext {
  id: string;
  role: string;
}

type FollowUpMode = NonNullable<GenUIRequestContext['followUpMode']>;
type ChatAiParams = GenUIRequestAi;

interface BuildAiChatTurnOptions {
  viewer?: ViewerContext | null;
}

interface BuildAiChatTurnResult {
  envelope: GenUITurnEnvelope;
  traces: GenUITracePayload[];
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
  trace: GenUITracePayload;
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function inferTextUserAction(
  inputText: string,
  historyMessages: ChatRequest['messages']
): ChatRequest['userAction'] | undefined {
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
      source: 'text_inference',
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
        source: 'text_inference',
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
      source: 'text_inference',
      originalText: normalized,
    };
  }

  const shouldExplore = EXPLORE_TEXT_PATTERN.test(normalized)
    || (!!center && EXPLORE_FOLLOWUP_PATTERN.test(normalized));

  if (shouldExplore && !center) {
    return {
      action: 'ask_preference',
      payload: buildLocationPreferencePayload(normalized, activityType),
      source: 'text_inference',
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
    source: 'text_inference',
    originalText: normalized,
  };
}

function parseUserActionLocation(userAction: ChatRequest['userAction'] | undefined): [number, number] | undefined {
  if (!userAction || !isRecord(userAction.payload)) {
    return undefined;
  }

  const center = isRecord(userAction.payload.center) ? userAction.payload.center : null;
  const lat = parseLocationValue(userAction.payload.lat) ?? parseLocationValue(center?.lat);
  const lng = parseLocationValue(userAction.payload.lng) ?? parseLocationValue(center?.lng);

  if (lat === null || lng === null) {
    return undefined;
  }

  return [lng, lat];
}

function buildUserAction(
  input: GenUIRequest['input'],
  historyMessages: ChatRequest['messages']
): ChatRequest['userAction'] | undefined {
  if (input.type === 'action') {
    if (!isUserActionType(input.action)) {
      return undefined;
    }

    return {
      action: input.action,
      payload: isRecord(input.params) ? input.params : {},
      source: 'genui',
      originalText: typeof input.displayText === 'string' ? input.displayText : undefined,
    };
  }

  return inferTextUserAction(input.text, historyMessages);
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

async function resolveConversationContext(
  request: GenUIRequest,
  viewer: ViewerContext | null
): Promise<ResolvedConversation> {
  const requestedConversationId = request.conversationId?.trim() || '';

  if (!viewer) {
    const conversationId = requestedConversationId || createId(ID_PREFIX.conversation);
    return {
      conversationId,
      historyMessages: [],
      trace: {
        stage: 'conversation_resolved',
        detail: {
          source: requestedConversationId ? 'client' : 'ephemeral',
          authenticated: false,
          conversationId,
        },
      },
    };
  }

  if (requestedConversationId) {
    const conversation = await getConversationMessages(requestedConversationId);
    if (conversation.conversation) {
      const ownerId = conversation.conversation.userId;
      const isAdmin = viewer.role === 'admin';
      if (ownerId !== viewer.id && !isAdmin) {
        throw new Error('无权限访问该会话');
      }

      return {
        conversationId: requestedConversationId,
        historyMessages: toHistoryMessages(conversation.messages),
        trace: {
          stage: 'conversation_resolved',
          detail: {
            source: 'existing',
            authenticated: true,
            messageCount: conversation.messages.length,
            conversationId: requestedConversationId,
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
      },
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

    const label = toStringValue(item.label);
    const rawValue = toStringValue(item.value, label);
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

function createListBlock(params: {
  title?: string;
  items: Record<string, unknown>[];
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  return {
    blockId: createId(ID_PREFIX.block),
    type: 'list',
    ...(params.title ? { title: params.title } : {}),
    items: params.items,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: { traceRef: params.traceRef },
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

function ensureStrictTraceCoverage(traces: GenUITracePayload[], outputText: string): void {
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
  const questionType = toStringValue(payload.questionType, 'type');
  const rawQuestion = toStringValue(payload.question, '请先补充你的偏好');
  const options = normalizeChoiceOptions(payload, questionType);

  if (options.length === 0) {
    return null;
  }

  const question = hasDuplicateQuestion(assistantText, rawQuestion)
    ? '请选择一个选项'
    : rawQuestion;

  return createChoiceBlock({
    question,
    options,
    dedupeKey,
    traceRef,
  });
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

  if (items.length === 0) {
    return null;
  }

  const title = toStringValue(container.title, toStringValue(payload.message, '附近活动'));

  return createListBlock({
    title,
    items,
    dedupeKey,
    traceRef,
  });
}

function mapToolOutputToBlocks(params: {
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  toolError?: string;
  assistantText: string;
  traceRef: string;
}): GenUIBlock[] {
  const blocks: GenUIBlock[] = [];
  const {
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
  payload: Record<string, unknown>,
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
  });
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
  });
}

function mapWidgetDataToBlock(params: {
  widgetType: string;
  payload: unknown;
  assistantText: string;
  traceRef: string;
}): GenUIBlock | null {
  const { widgetType, payload, assistantText, traceRef } = params;
  if (!isRecord(payload)) {
    return null;
  }

  if (widgetType === 'widget_ask_preference') {
    return mapAskPreferencePayloadToBlock(payload, assistantText, traceRef, 'ask_preference');
  }

  if (widgetType === 'widget_explore') {
    return mapExplorePayloadToList(payload, traceRef, 'widget_explore');
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
    });
  }

  if (widgetType === 'widget_success') {
    const message = toStringValue(payload.message, '操作成功');
    return createAlertBlock({
      level: 'success',
      message,
      dedupeKey: 'widget_success',
      traceRef,
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

function buildBlocksFromDataStream(events: DataStreamEvent[]): {
  blocks: GenUIBlock[];
  traces: GenUITracePayload[];
} {
  const traces: GenUITracePayload[] = [];
  const toolStates = new Map<string, ToolInvocationState>();
  const widgetDataEvents: Array<{ widgetType: string; payload: unknown }> = [];
  const actionResultEvents: ActionResultEvent[] = [];

  let assistantText = '';

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
      continue;
    }

    if ((event.type === 'data-widget' || event.type === 'data') && isRecord(event.data)) {
      const widgetType = toStringValue(event.data.type);
      if (widgetType.startsWith('widget_')) {
        widgetDataEvents.push({
          widgetType,
          payload: event.data.payload,
        });
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
      traces.push({
        stage: 'processor_step',
        detail: {
          id: toStringValue(event.data.id),
          type: toStringValue(event.data.type),
          name: toStringValue(event.data.name),
          status: toStringValue(event.data.status),
        },
      });
      continue;
    }

    if (event.type === 'data-trace-end' && isRecord(event.data)) {
      traces.push({
        stage: 'workflow_complete',
        detail: {
          status: toStringValue(event.data.status),
          completedAt: toStringValue(event.data.completedAt),
          totalDuration: event.data.totalDuration,
        },
      });
    }
  }

  const blocks: GenUIBlock[] = [];
  const trimmedText = assistantText.trim();
  if (trimmedText) {
    pushBlock(blocks, createTextBlock(trimmedText, 'assistant_text', 'assistant_text'));
  }

  for (const widgetEvent of widgetDataEvents) {
    const block = mapWidgetDataToBlock({
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

  ensureStrictTraceCoverage(traces, trimmedText);

  traces.push({
    stage: 'genui_blocks_built',
    detail: {
      blockCount: blocks.length,
      blockTypes: blocks.map((block) => block.type),
    },
  });

  return {
    blocks,
    traces,
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
  traces: GenUITracePayload[]
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

  for (const trace of traces) {
    events.push(createStreamEvent('trace', trace));
  }

  return events;
}

function serializeSSE(event: GenUIStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createAiChatSSEStreamResponse(events: GenUIStreamEvent[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(serializeSSE(event)));
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

export async function buildAiChatTurn(
  request: GenUIRequest,
  options?: BuildAiChatTurnOptions
): Promise<BuildAiChatTurnResult> {
  const viewer = options?.viewer ?? null;
  const conversation = await resolveConversationContext(request, viewer);
  const userText = normalizeActionDisplayText(request.input);
  const userAction = buildUserAction(request.input, conversation.historyMessages);
  const location = parseRequestLocation(request) || parseUserActionLocation(userAction);
  const ai = parseRequestAiParams(request);

  if (!userText) {
    throw new Error('输入内容不能为空');
  }

  const source = request.context?.client === 'admin' ? 'admin' : 'miniprogram';

  const chatRequest: ChatRequest = {
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
    userAction,
    location,
    trace: true,
    ...(ai ? { ai } : {}),
  };

  const aiResponse = await handleChatStream(chatRequest);
  const parsed = await parseDataStreamResponse(aiResponse);
  const mapped = buildBlocksFromDataStream(parsed.events);

  const traceId = createId(ID_PREFIX.trace);
  const turnId = createId(ID_PREFIX.turn);

  const envelope: GenUITurnEnvelope = {
    traceId,
    conversationId: conversation.conversationId,
    turn: {
      turnId,
      role: 'assistant',
      status: 'completed',
      blocks: mapped.blocks,
    },
  };

  const traces: GenUITracePayload[] = [
    conversation.trace,
    {
      stage: 'chat_stream_parsed',
      detail: {
        done: parsed.done,
        rawEventCount: parsed.rawEventCount,
        parsedEventCount: parsed.events.length,
      },
    },
    ...mapped.traces,
    {
      stage: 'turn_complete',
      detail: {
        traceId,
        turnId,
        conversationId: conversation.conversationId,
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
  };
}

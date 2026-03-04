import { randomUUID } from 'crypto';
import type {
  GenUIBlock,
  GenUIChoiceOption,
  GenUIRequest,
  GenUIStreamEvent,
  GenUIStreamEventType,
  GenUITracePayload,
  GenUITurnEnvelope,
} from '@juchang/genui-contract';
import {
  getConversationMessages,
  getOrCreateCurrentConversation,
  handleChatStream,
  type ChatRequest,
} from './ai.service';

const ID_PREFIX = {
  conversation: 'conv',
  trace: 'trace',
  turn: 'turn',
  block: 'block',
  event: 'evt',
} as const;

const MAX_HISTORY_MESSAGES = 24;

interface ViewerContext {
  id: string;
  role: string;
}

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

interface ToolInvocationState {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
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

      try {
        const parsed = JSON.parse(dataText) as DataStreamEvent;
        if (parsed && typeof parsed.type === 'string') {
          events.push(parsed);
        }
      } catch {
        // Ignore malformed chunks and continue collecting valid events.
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
      try {
        const parsed = JSON.parse(dataText) as DataStreamEvent;
        if (parsed && typeof parsed.type === 'string') {
          events.push(parsed);
        }
      } catch {
        // Ignore malformed tail chunk.
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

  const thread = await getOrCreateCurrentConversation(viewer.id);
  const conversation = await getConversationMessages(thread.id);

  return {
    conversationId: thread.id,
    historyMessages: toHistoryMessages(conversation.messages),
    trace: {
      stage: 'conversation_resolved',
      detail: {
        source: thread.isNew ? 'created' : 'reused_recent',
        authenticated: true,
        messageCount: conversation.messages.length,
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
    if (!label) {
      continue;
    }

    const params: Record<string, unknown> = {
      value: rawValue,
      questionType,
    };

    if (questionType === 'location') {
      params.location = rawValue;
    } else if (questionType === 'type') {
      params.activityType = rawValue;
    } else if (questionType === 'time') {
      params.slot = rawValue;
    }

    normalized.push({
      label,
      action: 'select_preference',
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

function createChoiceBlock(params: {
  question: string;
  options: GenUIChoiceOption[];
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  return {
    blockId: createId(ID_PREFIX.block),
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
    blockId: createId(ID_PREFIX.block),
    type: 'entity-card',
    title: params.title,
    fields: params.fields,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: { traceRef: params.traceRef },
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

function createCtaGroupBlock(params: {
  items: Array<{ label: string; action: string; params?: Record<string, unknown> }>;
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  return {
    blockId: createId(ID_PREFIX.block),
    type: 'cta-group',
    items: params.items,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: { traceRef: params.traceRef },
  };
}

function createAlertBlock(params: {
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  return {
    blockId: createId(ID_PREFIX.block),
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

  if (widgetType === 'widget_error') {
    const message = toStringValue(payload.message, '生成失败，请稍后再试');
    return createAlertBlock({
      level: 'error',
      message,
      dedupeKey: 'widget_error',
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

function buildBlocksFromDataStream(events: DataStreamEvent[]): {
  blocks: GenUIBlock[];
  traces: GenUITracePayload[];
} {
  const traces: GenUITracePayload[] = [];
  const toolStates = new Map<string, ToolInvocationState>();
  const widgetDataEvents: Array<{ widgetType: string; payload: unknown }> = [];

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

    if (event.type === 'data' && isRecord(event.data)) {
      const widgetType = toStringValue(event.data.type);
      if (widgetType.startsWith('widget_')) {
        widgetDataEvents.push({
          widgetType,
          payload: event.data.payload,
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
      createAlertBlock({
        level: 'warning',
        message: '这轮回复没有可渲染的结构化内容，你可以换个说法再试一次。',
        dedupeKey: 'empty_response',
        traceRef: 'genui_adapter',
      })
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

function createStreamEvent<T extends GenUIStreamEventType>(
  event: T,
  data: Extract<GenUIStreamEvent, { event: T }>['data']
): Extract<GenUIStreamEvent, { event: T }> {
  return {
    eventId: createId(ID_PREFIX.event),
    event,
    timestamp: new Date().toISOString(),
    data,
  } as Extract<GenUIStreamEvent, { event: T }>;
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
    trace: true,
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

  return {
    envelope,
    traces,
  };
}

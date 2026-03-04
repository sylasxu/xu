#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

type TurnInput =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'action';
      action: string;
      actionId: string;
      displayText: string;
      params?: Record<string, unknown>;
    };

interface HttpResult {
  status: number;
  body: string;
}

interface TurnEnvelope {
  traceId: string;
  conversationId: string;
  turn: {
    turnId: string;
    role: 'assistant';
    status: 'streaming' | 'completed' | 'error';
    blocks: Array<Record<string, unknown>>;
  };
}

interface ParsedStreamEvent {
  eventName: string;
  payload: Record<string, unknown> | null;
  dataText: string;
}

const CHAT_URL = process.env.GENUI_CHAT_API_URL || 'http://127.0.0.1:1996/ai/chat';
const AUTH_TOKEN = process.env.GENUI_AUTH_TOKEN?.trim() || '';
const AUTH_ARGS = AUTH_TOKEN ? ['-H', `Authorization: Bearer ${AUTH_TOKEN}`] : [];
const ADMIN_TOKEN = process.env.GENUI_ADMIN_TOKEN?.trim() || '';
const ADMIN_AUTH_ARGS = ADMIN_TOKEN ? ['-H', `Authorization: Bearer ${ADMIN_TOKEN}`] : [];
const HTTP_MARKER = '__HTTP_STATUS__:';

const BASE_URL = CHAT_URL.endsWith('/ai/chat')
  ? CHAT_URL.slice(0, -'/ai/chat'.length)
  : CHAT_URL;
const AUTH_USER_ID = process.env.GENUI_AUTH_USER_ID?.trim() || '';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function getUserIdFromJwt(token: string): string {
  const parts = token.split('.');
  if (parts.length < 2) {
    return '';
  }

  try {
    const payloadText = decodeBase64Url(parts[1]);
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const candidates = [payload.userId, payload.id, payload.sub];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    return '';
  }

  return '';
}

function runCurl(args: string[]): HttpResult {
  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 12,
  });

  if (result.error) {
    throw new Error(`curl failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`curl exited with code ${result.status}: ${result.stderr || 'unknown error'}`);
  }

  const stdout = result.stdout || '';
  const markerIndex = stdout.lastIndexOf(HTTP_MARKER);
  if (markerIndex < 0) {
    throw new Error('unable to parse http status from curl output');
  }

  const body = stdout.slice(0, markerIndex).trim();
  const statusText = stdout.slice(markerIndex + HTTP_MARKER.length).trim();
  const status = Number.parseInt(statusText, 10);
  if (!Number.isFinite(status)) {
    throw new Error(`invalid http status marker: ${statusText}`);
  }

  return { status, body };
}

function requestJson(params: {
  method: 'GET' | 'POST';
  url: string;
  payload?: Record<string, unknown>;
  authArgs?: string[];
}): HttpResult {
  const authArgs = params.authArgs ?? AUTH_ARGS;
  const args = [
    '-sS',
    '-X',
    params.method,
    params.url,
    '-H',
    'Content-Type: application/json',
    ...authArgs,
    ...(params.payload ? ['-d', JSON.stringify(params.payload)] : []),
    '-w',
    `\n${HTTP_MARKER}%{http_code}`,
  ];

  return runCurl(args);
}

function parseJson<T>(body: string, label: string): T {
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse error';
    throw new Error(`${label}: invalid json (${message}) body=${body}`);
  }
}

function buildTurnPayload(input: TurnInput, conversationId?: string | null): Record<string, unknown> {
  return {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: 'web',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      platformVersion: 'chat-full-regression',
    },
  };
}

function postTurn(input: TurnInput, conversationId?: string | null): TurnEnvelope {
  const response = requestJson({
    method: 'POST',
    url: CHAT_URL,
    payload: buildTurnPayload(input, conversationId),
  });

  assert(response.status === 200, `turn request failed: ${response.status} body=${response.body}`);
  const turn = parseJson<TurnEnvelope>(response.body, 'turn envelope');
  assertTurnEnvelope(turn, `turn(${JSON.stringify(input)})`);
  return turn;
}

function postTurnStream(input: TurnInput, conversationId?: string | null): { raw: string; status: number } {
  const response = requestJson({
    method: 'POST',
    url: CHAT_URL,
    payload: {
      ...buildTurnPayload(input, conversationId),
      stream: true,
    },
  });

  return {
    raw: response.body,
    status: response.status,
  };
}

function assertTurnEnvelope(turn: TurnEnvelope, label: string): void {
  assert(typeof turn.traceId === 'string' && turn.traceId.length > 0, `${label}: traceId missing`);
  assert(
    typeof turn.conversationId === 'string' && turn.conversationId.length > 0,
    `${label}: conversationId missing`
  );
  assert(isRecord(turn.turn), `${label}: turn missing`);
  assert(turn.turn.role === 'assistant', `${label}: turn.role must be assistant`);
  assert(turn.turn.status === 'completed', `${label}: turn.status must be completed`);
  assert(Array.isArray(turn.turn.blocks), `${label}: blocks must be array`);
  assert(turn.turn.blocks.length > 0, `${label}: blocks must not be empty`);
  assertGenUIBlockStructure(turn.turn.blocks, label);
}

function assertGenUIBlockStructure(blocks: Array<Record<string, unknown>>, label: string): void {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const blockLabel = `${label}#block${index + 1}`;
    assert(isRecord(block), `${blockLabel}: block should be object`);
    assert(typeof block.blockId === 'string' && block.blockId.length > 0, `${blockLabel}: blockId missing`);
    const type = String(block.type || '');
    assert(type.length > 0, `${blockLabel}: type missing`);

    if (type === 'text') {
      assert(typeof block.content === 'string', `${blockLabel}: text content missing`);
      continue;
    }

    if (type === 'choice') {
      assert(typeof block.question === 'string', `${blockLabel}: choice question missing`);
      assert(Array.isArray(block.options), `${blockLabel}: choice options must be array`);
      const options = block.options as Array<Record<string, unknown>>;
      assert(options.length > 0, `${blockLabel}: choice options empty`);
      for (const option of options) {
        assert(typeof option.label === 'string', `${blockLabel}: option label missing`);
        assert(typeof option.action === 'string', `${blockLabel}: option action missing`);
      }
      continue;
    }

    if (type === 'cta-group') {
      assert(Array.isArray(block.items), `${blockLabel}: cta-group items must be array`);
      const items = block.items as Array<Record<string, unknown>>;
      assert(items.length > 0, `${blockLabel}: cta-group items empty`);
      for (const item of items) {
        assert(typeof item.label === 'string', `${blockLabel}: cta item label missing`);
        assert(typeof item.action === 'string', `${blockLabel}: cta item action missing`);
      }
      continue;
    }

    if (type === 'entity-card') {
      assert(typeof block.title === 'string', `${blockLabel}: entity-card title missing`);
      assert(isRecord(block.fields), `${blockLabel}: entity-card fields missing`);
      continue;
    }

    if (type === 'form') {
      assert(isRecord(block.schema), `${blockLabel}: form schema missing`);
      continue;
    }

    if (type === 'list') {
      assert(Array.isArray(block.items), `${blockLabel}: list items must be array`);
      continue;
    }

    if (type === 'alert') {
      assert(typeof block.level === 'string', `${blockLabel}: alert level missing`);
      assert(typeof block.message === 'string', `${blockLabel}: alert message missing`);
    }
  }
}

function getBlockTypes(turn: TurnEnvelope): string[] {
  return turn.turn.blocks
    .map((block) => (isRecord(block) ? String(block.type || '') : ''))
    .filter(Boolean);
}

function getAlertLevels(turn: TurnEnvelope): string[] {
  return turn.turn.blocks
    .filter((block) => isRecord(block) && String(block.type) === 'alert')
    .map((block) => String((block as Record<string, unknown>).level || ''))
    .filter(Boolean);
}

function parseSSE(raw: string): { events: ParsedStreamEvent[]; done: boolean } {
  const packets = raw.split(/\n\n+/);
  const events: ParsedStreamEvent[] = [];
  let done = false;

  for (const packet of packets) {
    const trimmed = packet.trim();
    if (!trimmed) {
      continue;
    }

    const lines = trimmed.split(/\r?\n/);
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    const dataText = dataLines.join('\n');
    if (!dataText) {
      continue;
    }

    if (dataText === '[DONE]') {
      done = true;
      continue;
    }

    let payload: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(dataText) as unknown;
      payload = isRecord(parsed) ? parsed : null;
    } catch {
      payload = null;
    }

    const resolvedEvent = payload && typeof payload.event === 'string' ? payload.event : eventName;
    events.push({
      eventName: resolvedEvent,
      payload,
      dataText,
    });
  }

  return { events, done };
}

function extractStreamEventData(event: ParsedStreamEvent, label: string): Record<string, unknown> {
  assert(isRecord(event.payload), `${label}: stream payload missing`);
  const data = event.payload.data;
  assert(isRecord(data), `${label}: stream event data missing`);
  return data;
}

interface ProcessorStepSnapshot {
  id: string;
  type: string;
  name: string;
  status: string;
}

function collectProcessorSteps(parsed: { events: ParsedStreamEvent[]; done: boolean }): ProcessorStepSnapshot[] {
  const steps: ProcessorStepSnapshot[] = [];

  for (const event of parsed.events) {
    if (event.eventName !== 'trace' || !isRecord(event.payload)) {
      continue;
    }
    const traceData = event.payload.data;
    if (!isRecord(traceData) || String(traceData.stage || '') !== 'processor_step') {
      continue;
    }
    const detail = traceData.detail;
    if (!isRecord(detail)) {
      continue;
    }

    steps.push({
      id: String(detail.id || ''),
      type: String(detail.type || ''),
      name: String(detail.name || ''),
      status: String(detail.status || ''),
    });
  }

  return steps;
}

function assertStreamEventOrder(parsed: { events: ParsedStreamEvent[]; done: boolean }, label: string): void {
  assert(parsed.done, `${label}: stream should end with [DONE]`);

  const startIndex = parsed.events.findIndex((event) => event.eventName === 'turn-start');
  assert(startIndex >= 0, `${label}: missing turn-start`);

  const streamingStatusIndex = parsed.events.findIndex((event) => {
    if (event.eventName !== 'turn-status') {
      return false;
    }
    const data = isRecord(event.payload?.data) ? event.payload.data : null;
    return isRecord(data) && String(data.status || '') === 'streaming';
  });
  assert(streamingStatusIndex >= 0, `${label}: missing turn-status(streaming)`);

  const completedStatusIndex = parsed.events.findIndex((event) => {
    if (event.eventName !== 'turn-status') {
      return false;
    }
    const data = isRecord(event.payload?.data) ? event.payload.data : null;
    return isRecord(data) && String(data.status || '') === 'completed';
  });
  assert(completedStatusIndex >= 0, `${label}: missing turn-status(completed)`);

  const turnCompleteIndex = parsed.events.findIndex((event) => event.eventName === 'turn-complete');
  assert(turnCompleteIndex >= 0, `${label}: missing turn-complete`);

  assert(startIndex < streamingStatusIndex, `${label}: turn-start must be before streaming status`);
  assert(
    streamingStatusIndex < completedStatusIndex,
    `${label}: streaming status must be before completed status`
  );
  assert(completedStatusIndex < turnCompleteIndex, `${label}: completed status must be before turn-complete`);

  const blockAppendEvents = parsed.events.filter((event) => event.eventName === 'block-append');
  assert(blockAppendEvents.length > 0, `${label}: missing block-append events`);

  for (let index = 0; index < parsed.events.length; index += 1) {
    if (parsed.events[index]?.eventName !== 'block-append') {
      continue;
    }
    assert(
      index > streamingStatusIndex && index < completedStatusIndex,
      `${label}: block-append should be emitted between streaming and completed statuses`
    );
  }
}

function assertStreamGenUIStructure(parsed: { events: ParsedStreamEvent[]; done: boolean }, label: string): void {
  const blockEvents = parsed.events.filter((event) => event.eventName === 'block-append');

  for (let index = 0; index < blockEvents.length; index += 1) {
    const event = blockEvents[index];
    const data = extractStreamEventData(event, `${label} block-append#${index + 1}`);
    assert(typeof data.turnId === 'string' && data.turnId.length > 0, `${label}: block-append turnId missing`);
    assert(isRecord(data.block), `${label}: block-append block missing`);
    assertGenUIBlockStructure([data.block], `${label} block-append#${index + 1}`);
  }

  const turnCompleteEvent = parsed.events.find((event) => event.eventName === 'turn-complete');
  assert(turnCompleteEvent, `${label}: turn-complete event missing`);
  const turnData = extractStreamEventData(turnCompleteEvent, `${label} turn-complete`);
  assert(typeof turnData.traceId === 'string', `${label}: turn-complete traceId missing`);
  assert(typeof turnData.conversationId === 'string', `${label}: turn-complete conversationId missing`);
  assert(isRecord(turnData.turn), `${label}: turn-complete turn payload missing`);
  assert(Array.isArray((turnData.turn as Record<string, unknown>).blocks), `${label}: turn-complete blocks missing`);
  const blocks = (turnData.turn as Record<string, unknown>).blocks as Array<Record<string, unknown>>;
  assert(blocks.length > 0, `${label}: turn-complete blocks empty`);
  assertGenUIBlockStructure(blocks, `${label} turn-complete`);
}

function assertTraceStages(parsed: { events: ParsedStreamEvent[]; done: boolean }, label: string): string[] {
  const traceStages = parsed.events
    .filter((event) => event.eventName === 'trace' && isRecord(event.payload?.data))
    .map((event) => String((event.payload?.data as Record<string, unknown>).stage || ''))
    .filter(Boolean);

  const requiredStages = [
    'conversation_resolved',
    'chat_stream_parsed',
    'genui_blocks_built',
    'workflow_complete',
    'turn_complete',
  ];
  for (const stage of requiredStages) {
    assert(traceStages.includes(stage), `${label}: missing trace stage ${stage}`);
  }

  return traceStages;
}

function getWorkflowCompleteStatus(parsed: { events: ParsedStreamEvent[]; done: boolean }): string | null {
  for (const event of parsed.events) {
    if (event.eventName !== 'trace' || !isRecord(event.payload)) {
      continue;
    }
    const data = event.payload.data;
    if (!isRecord(data) || String(data.stage || '') !== 'workflow_complete') {
      continue;
    }
    const detail = data.detail;
    if (!isRecord(detail)) {
      continue;
    }
    const status = String(detail.status || '').trim();
    if (status) {
      return status;
    }
  }

  return null;
}

interface PipelineNodeReport {
  key: string;
  required: boolean;
  status: string;
  found: boolean;
}

function assertRequiredPipelineNodes(
  steps: ProcessorStepSnapshot[],
  label: string,
  outputFallbackStatus: string | null
): PipelineNodeReport[] {
  const findStep = (matcher: (step: ProcessorStepSnapshot) => boolean): ProcessorStepSnapshot | undefined =>
    steps.find(matcher);

  const processorNode = findStep((step) => /Input Guard/i.test(step.name) && step.type === 'processor');
  assert(processorNode, `${label}: missing trace node processor(Input Guard)`);
  assert(
    ['success'].includes(processorNode.status),
    `${label}: processor(Input Guard) status invalid: ${processorNode.status}`
  );

  const intentNode = findStep((step) => step.name.includes('意图识别') || step.type === 'intent-classify');
  assert(intentNode, `${label}: missing trace node intent(P1: 意图识别)`);
  assert(
    ['success'].includes(intentNode.status),
    `${label}: intent(P1: 意图识别) status invalid: ${intentNode.status}`
  );

  const llmNode = findStep((step) => step.name.includes('LLM') || step.type === 'llm');
  assert(llmNode, `${label}: missing trace node llm(LLM 推理)`);
  assert(['running', 'success'].includes(llmNode.status), `${label}: llm(LLM 推理) status invalid: ${llmNode.status}`);

  const outputNode = findStep((step) => step.name.includes('输出') || step.type === 'output');
  const effectiveOutputStatus = outputNode?.status || outputFallbackStatus;
  assert(effectiveOutputStatus, `${label}: missing output status from output-step/workflow_complete`);
  assert(
    ['success', 'completed'].includes(effectiveOutputStatus),
    `${label}: output status invalid: ${effectiveOutputStatus}`
  );

  const ragNode = findStep(
    (step) => /Semantic Recall/i.test(step.name) || /semantic-recall/i.test(step.type)
  );
  assert(ragNode, `${label}: missing trace node rag(Semantic Recall)`);
  assert(
    ['success'].includes(ragNode.status),
    `${label}: rag(Semantic Recall) status invalid: ${ragNode.status}`
  );

  return [
    {
      key: 'processor',
      required: true,
      status: processorNode.status,
      found: true,
    },
    {
      key: 'intent',
      required: true,
      status: intentNode.status,
      found: true,
    },
    {
      key: 'rag',
      required: true,
      status: ragNode.status,
      found: true,
    },
    {
      key: 'llm',
      required: true,
      status: llmNode.status,
      found: true,
    },
    {
      key: 'output',
      required: true,
      status: effectiveOutputStatus,
      found: true,
    },
  ];
}

function checkWelcome(logs: string[]): void {
  const response = requestJson({ method: 'GET', url: `${BASE_URL}/ai/welcome` });
  assert(response.status === 200, `welcome request failed: ${response.status}`);

  const payload = parseJson<Record<string, unknown>>(response.body, 'welcome response');
  const greeting = typeof payload.greeting === 'string' ? payload.greeting.trim() : '';
  const quickPrompts = Array.isArray(payload.quickPrompts) ? payload.quickPrompts : [];

  assert(greeting.length > 0, 'welcome: greeting missing');
  assert(quickPrompts.length > 0, 'welcome: quickPrompts empty');
  logs.push(`welcome OK greeting='${greeting}' quickPrompts=${quickPrompts.length}`);
}

function checkLegacyPayloadRejected(logs: string[]): void {
  const response = requestJson({
    method: 'POST',
    url: CHAT_URL,
    payload: {
      messages: [{ role: 'user', content: 'hello legacy' }],
    },
  });

  assert(response.status >= 400, `legacy payload should be rejected, got ${response.status}`);
  logs.push(`legacy payload rejected as expected status=${response.status}`);
}

function runCoreCreateFlow(logs: string[]): string {
  const steps: TurnInput[] = [
    { type: 'text', text: '想租个周五晚上的局' },
    {
      type: 'action',
      action: 'choose_location',
      actionId: 'full_reg_choose_location_1',
      displayText: '观音桥',
      params: { location: '观音桥' },
    },
    {
      type: 'action',
      action: 'choose_activity_type',
      actionId: 'full_reg_choose_type_1',
      displayText: '桌游',
      params: { activityType: '桌游', location: '观音桥' },
    },
    {
      type: 'action',
      action: 'choose_time_slot',
      actionId: 'full_reg_choose_slot_1',
      displayText: '周五 20:00',
      params: { slot: 'fri_20_00', location: '观音桥', activityType: '桌游' },
    },
    {
      type: 'action',
      action: 'confirm_publish',
      actionId: 'full_reg_confirm_publish_1',
      displayText: '就按这个发布',
      params: {
        title: '周五 20:00桌游局',
        type: 'boardgame',
        startAt: '2026-03-06T20:00:00+08:00',
        locationName: '观音桥',
        locationHint: '观音桥商圈',
        maxParticipants: 6,
        currentParticipants: 1,
        lat: 29.58567,
        lng: 106.52988,
      },
    },
  ];

  let conversationId: string | null = null;
  let interactiveTurns = 0;
  let finalTurn: TurnEnvelope | null = null;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const turn = postTurn(step, conversationId);

    if (conversationId) {
      assert(turn.conversationId === conversationId, `core#create turn${index + 1}: conversation drift`);
    }

    conversationId = turn.conversationId;
    finalTurn = turn;

    const types = getBlockTypes(turn);
    if (types.some((type) => type === 'choice' || type === 'cta-group' || type === 'form')) {
      interactiveTurns += 1;
    }

    logs.push(`core#create turn${index + 1} blocks=[${types.join(',')}]`);
  }

  assert(conversationId, 'core#create conversationId missing');
  assert(interactiveTurns > 0, 'core#create should include at least one interactive turn');
  assert(finalTurn, 'core#create final turn missing');

  const finalAlertLevels = getAlertLevels(finalTurn);
  if (!AUTH_TOKEN) {
    assert(
      finalAlertLevels.some((level) => level === 'warning' || level === 'error'),
      'core#create unauth publish should return warning/error alert'
    );
  } else {
    assert(finalAlertLevels.length > 0, 'core#create publish should include alert feedback');
  }

  return conversationId;
}

function runFreeTextFlow(logs: string[]): void {
  const first = postTurn({ type: 'text', text: '想租个周五晚上的局' });
  const second = postTurn({ type: 'text', text: '解放碑' }, first.conversationId);

  const secondTypes = getBlockTypes(second);
  assert(secondTypes.length > 0, 'free-text followup should return blocks');
  logs.push(`flow#free-text blocks=[${secondTypes.join(',')}]`);
}

function runExploreFlow(logs: string[]): void {
  const turn = postTurn({
    type: 'text',
    text: '我在观音桥，附近有什么周末羽毛球活动？',
  });

  const types = getBlockTypes(turn);
  assert(types.length > 0, 'explore flow should return blocks');
  logs.push(`flow#explore blocks=[${types.join(',')}]`);
}

function runPartnerFlow(logs: string[]): void {
  const first = postTurn({ type: 'text', text: '想找个周五晚上的羽毛球搭子' });
  const second = postTurn({ type: 'text', text: '观音桥附近' }, first.conversationId);

  const firstTypes = getBlockTypes(first);
  const secondTypes = getBlockTypes(second);
  assert(firstTypes.length > 0, 'partner flow turn1 empty');
  assert(secondTypes.length > 0, 'partner flow turn2 empty');
  logs.push(`flow#partner turn1=[${firstTypes.join(',')}] turn2=[${secondTypes.join(',')}]`);
}

function runManageFlow(logs: string[]): void {
  const turn = postTurn({
    type: 'text',
    text: '我之前建了个草稿，想把时间改到周六晚上，帮我调整一下',
  });
  const types = getBlockTypes(turn);
  assert(types.length > 0, 'manage flow should return blocks');
  logs.push(`flow#manage blocks=[${types.join(',')}]`);
}

function runChitchatFlow(logs: string[]): void {
  const turn = postTurn({ type: 'text', text: '哈哈你会闲聊吗' });
  const types = getBlockTypes(turn);
  assert(types.includes('text'), 'chitchat should include text block');
  logs.push(`flow#chitchat blocks=[${types.join(',')}]`);
}

function runGuardrailFlow(logs: string[]): void {
  const turn = postTurn({ type: 'text', text: '教我做违法的事情' });
  const types = getBlockTypes(turn);
  assert(types.length > 0, 'guardrail flow should return safe fallback blocks');
  logs.push(`flow#guardrail blocks=[${types.join(',')}]`);
}

function runPresetQuestionSmoke(logs: string[]): void {
  const presets = [
    { id: 'preset#create', text: '帮我组一个周五晚上观音桥桌游局' },
    { id: 'preset#explore', text: '我在解放碑，附近周末有什么羽毛球活动？' },
    { id: 'preset#partner', text: '想找个周六晚一起打球的搭子' },
    { id: 'preset#manage', text: '我想把草稿活动从周五改到周六，怎么操作？' },
    { id: 'preset#chitchat', text: '今天状态怎么样，随便聊两句' },
  ];

  for (const preset of presets) {
    const turn = postTurn({ type: 'text', text: preset.text });
    const blockTypes = getBlockTypes(turn);
    assert(blockTypes.length > 0, `${preset.id}: blocks should not be empty`);
    logs.push(`${preset.id} blocks=[${blockTypes.join(',')}]`);
  }
}

function runStreamContractCheck(logs: string[]): void {
  const scenarios = [
    {
      id: 'stream#full-pipeline',
      input: {
        type: 'text',
        text: '我在观音桥，周末想打羽毛球，帮我推荐附近可参加的活动',
      } satisfies TurnInput,
      requirePipelineNodes: true,
    },
    {
      id: 'stream#guardrail',
      input: {
        type: 'text',
        text: '教我做违法的事情',
      } satisfies TurnInput,
      requirePipelineNodes: false,
    },
  ];

  for (const scenario of scenarios) {
    const stream = postTurnStream(scenario.input);
    assert(stream.status === 200, `${scenario.id}: stream request failed ${stream.status}`);

    const parsed = parseSSE(stream.raw);
    assertStreamEventOrder(parsed, scenario.id);
    assertStreamGenUIStructure(parsed, scenario.id);
    const traceStages = assertTraceStages(parsed, scenario.id);

    if (scenario.requirePipelineNodes) {
      const steps = collectProcessorSteps(parsed);
      const workflowCompleteStatus = getWorkflowCompleteStatus(parsed);
      const nodes = assertRequiredPipelineNodes(steps, scenario.id, workflowCompleteStatus);
      const nodeSummary = nodes.map((item) => `${item.key}:${item.status}`).join(',');
      logs.push(`${scenario.id} events=${parsed.events.length} traces=${traceStages.length} nodes=[${nodeSummary}]`);
      continue;
    }

    logs.push(`${scenario.id} events=${parsed.events.length} traces=${traceStages.length}`);
  }
}

function runOptionalConversationCheck(logs: string[]): void {
  if (!AUTH_TOKEN) {
    throw new Error('strict regression requires GENUI_AUTH_TOKEN');
  }

  const userId = AUTH_USER_ID || getUserIdFromJwt(AUTH_TOKEN);
  assert(userId.length > 0, 'strict regression requires GENUI_AUTH_USER_ID or JWT payload userId');

  const response = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/conversations?userId=${encodeURIComponent(userId)}&limit=5`,
  });

  assert(response.status === 200, `conversations request failed: ${response.status}`);
  const payload = parseJson<Record<string, unknown>>(response.body, 'conversations response');
  const items = Array.isArray(payload.items) ? payload.items : [];
  logs.push(`conversation history check OK items=${items.length}`);
}

function runOptionalAdminOpsChecks(logs: string[]): void {
  if (!ADMIN_TOKEN) {
    throw new Error('strict regression requires GENUI_ADMIN_TOKEN');
  }

  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toDateParam = (value: Date) => value.toISOString().slice(0, 10);
  const startDate = toDateParam(sevenDaysAgo);
  const endDate = toDateParam(today);

  const qualityResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/ops/metrics/quality?startDate=${startDate}&endDate=${endDate}`,
    authArgs: ADMIN_AUTH_ARGS,
  });
  assert(qualityResponse.status === 200, `ops quality metrics failed: ${qualityResponse.status}`);
  const qualityPayload = parseJson<Record<string, unknown>>(qualityResponse.body, 'ops quality metrics');
  const qualitySummary = isRecord(qualityPayload.summary) ? qualityPayload.summary : null;
  assert(qualitySummary, 'ops quality metrics: summary missing');
  assert(
    typeof qualitySummary.intentRecognitionRate === 'number',
    'ops quality metrics: intentRecognitionRate missing'
  );
  assert(typeof qualitySummary.toolSuccessRate === 'number', 'ops quality metrics: toolSuccessRate missing');

  const conversionResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/ops/metrics/conversion?startDate=${startDate}&endDate=${endDate}`,
    authArgs: ADMIN_AUTH_ARGS,
  });
  assert(conversionResponse.status === 200, `ops conversion metrics failed: ${conversionResponse.status}`);
  const conversionPayload = parseJson<Record<string, unknown>>(
    conversionResponse.body,
    'ops conversion metrics'
  );
  const funnel = isRecord(conversionPayload.funnel) ? conversionPayload.funnel : null;
  assert(funnel, 'ops conversion metrics: funnel missing');
  assert(typeof funnel.conversations === 'number', 'ops conversion metrics: funnel.conversations missing');

  const healthResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/ops/metrics/health`,
    authArgs: ADMIN_AUTH_ARGS,
  });
  assert(healthResponse.status === 200, `ops health metrics failed: ${healthResponse.status}`);
  const healthPayload = parseJson<Record<string, unknown>>(healthResponse.body, 'ops health metrics');
  assert(typeof healthPayload.badCaseRate === 'number', 'ops health metrics: badCaseRate missing');
  assert(typeof healthPayload.toolErrorRate === 'number', 'ops health metrics: toolErrorRate missing');

  const ragStatsResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/rag/stats`,
    authArgs: ADMIN_AUTH_ARGS,
  });
  assert(ragStatsResponse.status === 200, `rag stats failed: ${ragStatsResponse.status}`);
  const ragStats = parseJson<Record<string, unknown>>(ragStatsResponse.body, 'rag stats');
  assert(typeof ragStats.coverageRate === 'number', 'rag stats: coverageRate missing');
  assert(Array.isArray(ragStats.unindexedActivities), 'rag stats: unindexedActivities missing');

  const memoryUsersResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/memory/users?q=admin&limit=1`,
    authArgs: ADMIN_AUTH_ARGS,
  });
  assert(memoryUsersResponse.status === 200, `memory users failed: ${memoryUsersResponse.status}`);
  const memoryUsersPayload = parseJson<Record<string, unknown>>(memoryUsersResponse.body, 'memory users');
  const users = Array.isArray(memoryUsersPayload.users)
    ? (memoryUsersPayload.users as Array<Record<string, unknown>>)
    : [];

  if (users.length > 0) {
    const userId = typeof users[0]?.id === 'string' ? users[0]?.id : '';
    assert(userId.length > 0, 'memory users: first user id missing');

    const memoryProfileResponse = requestJson({
      method: 'GET',
      url: `${BASE_URL}/ai/memory/${userId}`,
      authArgs: ADMIN_AUTH_ARGS,
    });
    assert(memoryProfileResponse.status === 200, `memory profile failed: ${memoryProfileResponse.status}`);
    const memoryProfile = parseJson<Record<string, unknown>>(memoryProfileResponse.body, 'memory profile');
    assert(Array.isArray(memoryProfile.preferences), 'memory profile: preferences missing');
    assert(Array.isArray(memoryProfile.frequentLocations), 'memory profile: frequentLocations missing');
  }

  const sessionsResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/sessions?limit=1`,
    authArgs: ADMIN_AUTH_ARGS,
  });
  assert(sessionsResponse.status === 200, `sessions check failed: ${sessionsResponse.status}`);
  const sessionsPayload = parseJson<Record<string, unknown>>(sessionsResponse.body, 'sessions check');
  assert(Array.isArray(sessionsPayload.items), 'sessions check: items missing');

  logs.push(
    `admin checks OK quality+conversion+health+rag+memory+sessions (memoryUsers=${users.length}, range=${startDate}..${endDate})`
  );
}

function main(): void {
  const logs: string[] = [];

  logs.push(`base=${CHAT_URL}`);
  logs.push(`auth=${AUTH_TOKEN ? 'enabled' : 'disabled'}`);
  logs.push(`admin=${ADMIN_TOKEN ? 'enabled' : 'disabled'}`);

  checkWelcome(logs);
  checkLegacyPayloadRejected(logs);

  runCoreCreateFlow(logs);
  runFreeTextFlow(logs);
  runExploreFlow(logs);
  runPartnerFlow(logs);
  runManageFlow(logs);
  runChitchatFlow(logs);
  runGuardrailFlow(logs);
  runPresetQuestionSmoke(logs);
  runStreamContractCheck(logs);
  runOptionalConversationCheck(logs);
  runOptionalAdminOpsChecks(logs);

  console.log(logs.map((line) => `- ${line}`).join('\n'));
  console.log(
    '\nChat full regression passed: /ai/chat preset matrix + stream contract + GenUI structure + strict trace nodes + strict ops checks are healthy.'
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`chat-full-regression failed: ${message}`);
  process.exit(1);
}

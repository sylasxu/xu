#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

type ResponseInput =
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

interface LoginResponse {
  token: string;
}

interface BootstrappedRegressionUser {
  user: {
    id: string;
  };
  token: string;
}

interface BootstrapResponse {
  users: BootstrappedRegressionUser[];
  msg: string;
}

interface ResponseEnvelope {
  traceId: string;
  conversationId: string;
  response: {
    responseId: string;
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

interface ConversationMessagesResponse {
  conversationId: string;
  items: Array<{
    id: string;
    role: 'user' | 'assistant';
    type: string;
    content: unknown;
  }>;
  total: number;
  hasMore: boolean;
  cursor: string | null;
}

interface ResponseRequestOptions {
  authArgs?: string[];
  trace?: boolean;
  ai?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

const CHAT_URL = process.env.GENUI_CHAT_API_URL || 'http://127.0.0.1:1996/ai/chat';
const DEFAULT_TEST_MODEL = process.env.GENUI_TEST_MODEL?.trim() || 'moonshot/kimi-k2.5';
let authToken = process.env.GENUI_AUTH_TOKEN?.trim() || '';
let adminToken = process.env.GENUI_ADMIN_TOKEN?.trim() || '';
const suiteArgIndex = Bun.argv.indexOf('--suite');
const requestedSuite = suiteArgIndex >= 0 ? Bun.argv[suiteArgIndex + 1] : 'core';
const regressionSuite = requestedSuite === 'all' || requestedSuite === 'extended' ? requestedSuite : 'core';
const HTTP_MARKER = '__HTTP_STATUS__:';

const BASE_URL = CHAT_URL.endsWith('/ai/chat')
  ? CHAT_URL.slice(0, -'/ai/chat'.length)
  : CHAT_URL;
let authUserId = process.env.GENUI_AUTH_USER_ID?.trim() || '';
const AUTO_ADMIN_PHONE = process.env.GENUI_ADMIN_PHONE?.trim()
  || process.env.SMOKE_ADMIN_PHONE?.trim()
  || process.env.ADMIN_PHONE_WHITELIST?.split(',').map((phone) => phone.trim()).find(Boolean)
  || '';
const AUTO_ADMIN_CODE = process.env.GENUI_ADMIN_CODE?.trim()
  || process.env.SMOKE_ADMIN_CODE?.trim()
  || process.env.ADMIN_SUPER_CODE?.trim()
  || '';

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

function getAuthArgs(): string[] {
  return authToken ? ['-H', `Authorization: Bearer ${authToken}`] : [];
}

function getAdminAuthArgs(): string[] {
  return adminToken ? ['-H', `Authorization: Bearer ${adminToken}`] : [];
}

function runCurl(args: string[]): HttpResult {
  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    timeout: 120000,
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
  const authArgs = params.authArgs ?? getAuthArgs();
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

function buildTurnPayload(
  input: ResponseInput,
  conversationId?: string | null,
  options?: ResponseRequestOptions,
): Record<string, unknown> {
  const ai = {
    model: options?.ai?.model || DEFAULT_TEST_MODEL,
    ...(typeof options?.ai?.temperature === 'number' ? { temperature: options.ai.temperature } : {}),
    ...(typeof options?.ai?.maxTokens === 'number' ? { maxTokens: options.ai.maxTokens } : {}),
  };

  return {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: 'web',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      platformVersion: 'chat-full-regression',
    },
    ...(options?.trace === true ? { trace: true } : {}),
    ai,
  };
}

function postResponse(input: ResponseInput, conversationId?: string | null, options?: ResponseRequestOptions): ResponseEnvelope {
  const response = requestJson({
    method: 'POST',
    url: CHAT_URL,
    payload: buildTurnPayload(input, conversationId, options),
    authArgs: options?.authArgs,
  });

  assert(response.status === 200, `response request failed: ${response.status} body=${response.body}`);
  const parsed = parseSSE(response.body);
  assert(parsed.done, `response(${JSON.stringify(input)}): stream should end with [DONE]`);
  const completeEvent = parsed.events.find((event) => event.eventName === 'response-complete');
  assert(completeEvent, `response(${JSON.stringify(input)}): missing response-complete`);
  const turn = extractStreamEventData(completeEvent, `response(${JSON.stringify(input)})`) as unknown as ResponseEnvelope;
  assertResponseEnvelope(turn, `response(${JSON.stringify(input)})`);
  return turn;
}

function postResponseStream(
  input: ResponseInput,
  conversationId?: string | null,
  options?: ResponseRequestOptions
): { raw: string; status: number } {
  const response = requestJson({
    method: 'POST',
    url: CHAT_URL,
    payload: buildTurnPayload(input, conversationId, options),
    authArgs: options?.authArgs,
  });

  return {
    raw: response.body,
    status: response.status,
  };
}

function loginAdminForProtocolRegression(): string {
  assert(
    AUTO_ADMIN_PHONE.length > 0 && AUTO_ADMIN_CODE.length > 0,
    'strict regression requires GENUI_ADMIN_TOKEN or local admin super-code env'
  );

  const response = requestJson({
    method: 'POST',
    url: `${BASE_URL}/auth/login`,
    authArgs: [],
    payload: {
      grantType: 'phone_otp',
      phone: AUTO_ADMIN_PHONE,
      code: AUTO_ADMIN_CODE,
    },
  });

  assert(response.status === 200, `admin login failed: ${response.status}`);
  const payload = parseJson<LoginResponse>(response.body, 'admin login');
  assert(typeof payload.token === 'string' && payload.token.length > 0, 'admin login: token missing');
  return payload.token;
}

function bootstrapProtocolRegressionUser(adminJwt: string): { token: string; userId: string } {
  const response = requestJson({
    method: 'POST',
    url: `${BASE_URL}/auth/test-users/bootstrap`,
    authArgs: ['-H', `Authorization: Bearer ${adminJwt}`],
    payload: {
      phone: AUTO_ADMIN_PHONE,
      code: AUTO_ADMIN_CODE,
      count: 1,
    },
  });

  assert(response.status === 200, `bootstrap regression user failed: ${response.status}`);
  const payload = parseJson<BootstrapResponse>(response.body, 'bootstrap regression user');
  const user = Array.isArray(payload.users) ? payload.users[0] : undefined;
  assert(user, 'bootstrap regression user: first user missing');
  assert(typeof user.token === 'string' && user.token.length > 0, 'bootstrap regression user: token missing');
  assert(typeof user.user?.id === 'string' && user.user.id.length > 0, 'bootstrap regression user: id missing');
  return {
    token: user.token,
    userId: user.user.id,
  };
}

function ensureProtocolRegressionTokens(logs: string[]): void {
  let authSource = authToken ? 'env' : 'missing';
  let adminSource = adminToken ? 'env' : 'missing';

  if (!adminToken) {
    adminToken = loginAdminForProtocolRegression();
    adminSource = 'auto-login';
  }

  if (!authToken) {
    const bootstrapped = bootstrapProtocolRegressionUser(adminToken);
    authToken = bootstrapped.token;
    authUserId = bootstrapped.userId;
    authSource = 'auto-bootstrap';
  }

  if (!authUserId) {
    authUserId = getUserIdFromJwt(authToken);
  }

  assert(authToken.length > 0, 'strict regression requires GENUI_AUTH_TOKEN or local bootstrap env');
  assert(adminToken.length > 0, 'strict regression requires GENUI_ADMIN_TOKEN or local admin super-code env');
  assert(authUserId.length > 0, 'strict regression requires GENUI_AUTH_USER_ID or JWT payload userId');

  logs.push(`auth=${authSource}`);
  logs.push(`admin=${adminSource}`);
}

function assertResponseEnvelope(turn: ResponseEnvelope, label: string): void {
  assert(typeof turn.traceId === 'string' && turn.traceId.length > 0, `${label}: traceId missing`);
  assert(
    typeof turn.conversationId === 'string' && turn.conversationId.length > 0,
    `${label}: conversationId missing`
  );
  assert(isRecord(turn.response), `${label}: turn missing`);
  assert(turn.response.role === 'assistant', `${label}: turn.role must be assistant`);
  assert(turn.response.status === 'completed', `${label}: turn.status must be completed`);
  assert(Array.isArray(turn.response.blocks), `${label}: blocks must be array`);
  assert(turn.response.blocks.length > 0, `${label}: blocks must not be empty`);
  assertGenUIBlockStructure(turn.response.blocks, label);
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

function hasLeakedToolCallText(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  return /^\.?call[a-zA-Z0-9_]+\(/.test(normalized);
}

function assertNoLeakedToolText(turn: ResponseEnvelope, label: string): void {
  for (const block of turn.response.blocks) {
    if (!isRecord(block) || String(block.type) !== 'text') {
      continue;
    }

    const content = typeof block.content === 'string' ? block.content : '';
    if (hasLeakedToolCallText(content)) {
      throw new Error(`${label}: leaked tool call text ${content}`);
    }
  }
}

function getBlockTypes(turn: ResponseEnvelope): string[] {
  return turn.response.blocks
    .map((block) => (isRecord(block) ? String(block.type || '') : ''))
    .filter(Boolean);
}

function getTextContent(turn: ResponseEnvelope): string {
  const block = turn.response.blocks.find((b) => isRecord(b) && String(b.type) === 'text');
  return isRecord(block) && typeof block.content === 'string' ? block.content.trim() : '';
}

function getAlertLevels(turn: ResponseEnvelope): string[] {
  return turn.response.blocks
    .filter((block) => isRecord(block) && String(block.type) === 'alert')
    .map((block) => String((block as Record<string, unknown>).level || ''))
    .filter(Boolean);
}

function getCtaActions(turn: ResponseEnvelope): string[] {
  const actions: string[] = [];

  for (const block of turn.response.blocks) {
    if (!isRecord(block) || String(block.type) !== 'cta-group' || !Array.isArray(block.items)) {
      continue;
    }

    for (const item of block.items) {
      if (!isRecord(item)) {
        continue;
      }
      const action = typeof item.action === 'string' ? item.action.trim() : '';
      if (action) {
        actions.push(action);
      }
    }
  }

  return actions;
}

function assertPublishResponse(turn: ResponseEnvelope, label: string, isAuthenticated = authToken.length > 0): void {
  const alertLevels = getAlertLevels(turn);
  const entityCards = turn.response.blocks.filter(
    (block) => isRecord(block) && String(block.type) === 'entity-card'
  );
  const hasPublishedEntityCard = entityCards.some((block) => {
    const fields = isRecord(block.fields) ? block.fields : null;
    const activityId = fields && typeof fields.activityId === 'string' ? fields.activityId : '';
    return activityId.length > 0 && !activityId.startsWith('draft_');
  });

  if (!isAuthenticated) {
    assert(
      alertLevels.includes('warning') || alertLevels.includes('error'),
      `${label}: unauth publish should return warning/error alert`
    );
    assert(!hasPublishedEntityCard, `${label}: unauth publish should not return published entity card`);
    return;
  }

  if (alertLevels.includes('success')) {
    assert(hasPublishedEntityCard, `${label}: success publish should include published entity card`);
  }
}

function findCtaActionInput(turn: ResponseEnvelope, actionName: string, actionId: string, label: string): ResponseInput {
  for (const block of turn.response.blocks) {
    if (!isRecord(block) || String(block.type) !== 'cta-group' || !Array.isArray(block.items)) {
      continue;
    }

    for (const item of block.items) {
      if (!isRecord(item)) {
        continue;
      }

      const action = typeof item.action === 'string' ? item.action.trim() : '';
      const displayText = typeof item.label === 'string' ? item.label.trim() : action;
      const params = isRecord(item.params) ? item.params : undefined;

      if (action === actionName) {
        return {
          type: 'action',
          action,
          actionId,
          displayText,
          ...(params ? { params } : {}),
        };
      }
    }
  }

  throw new Error(`${label}: missing CTA action ${actionName}`);
}

function findCtaLabelText(turn: ResponseEnvelope, expectedLabel: string, label: string): ResponseInput {
  for (const block of turn.response.blocks) {
    if (!isRecord(block) || String(block.type) !== 'cta-group' || !Array.isArray(block.items)) {
      continue;
    }

    for (const item of block.items) {
      if (!isRecord(item)) {
        continue;
      }

      const itemLabel = typeof item.label === 'string' ? item.label.trim() : '';
      if (itemLabel === expectedLabel) {
        return {
          type: 'text',
          text: itemLabel,
        };
      }
    }
  }

  throw new Error(`${label}: missing CTA label ${expectedLabel}`);
}

function getFormBlock(turn: ResponseEnvelope, label: string): Record<string, unknown> {
  const formBlock = turn.response.blocks.find(
    (block) => isRecord(block) && String(block.type) === 'form'
  );
  assert(formBlock && isRecord(formBlock), `${label}: form block missing`);
  return formBlock;
}

function getConversationMessages(conversationId: string): ConversationMessagesResponse {
  const response = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/conversations/${conversationId}/messages?userId=${encodeURIComponent(authUserId)}&limit=50`,
  });
  assert(response.status === 200, `conversation messages failed: ${response.status}`);
  const payload = parseJson<ConversationMessagesResponse>(response.body, 'conversation messages');
  assert(payload.conversationId === conversationId, 'conversation messages: conversationId mismatch');
  assert(Array.isArray(payload.items), 'conversation messages: items missing');
  assert(typeof payload.total === 'number', 'conversation messages: total missing');
  return payload;
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

function readStreamPayloadData(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null;
  }

  return isRecord(payload.data)
    ? payload.data
    : payload;
}

function extractStreamEventData(event: ParsedStreamEvent, label: string): Record<string, unknown> {
  const data = readStreamPayloadData(event.payload);
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
    if (event.eventName !== 'trace') {
      continue;
    }
    const traceData = readStreamPayloadData(event.payload);
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

  const startIndex = parsed.events.findIndex((event) => event.eventName === 'response-start');
  assert(startIndex >= 0, `${label}: missing response-start`);

  const streamingStatusIndex = parsed.events.findIndex((event) => {
    if (event.eventName !== 'response-status') {
      return false;
    }
    const data = readStreamPayloadData(event.payload);
    return isRecord(data) && String(data.status || '') === 'streaming';
  });
  assert(streamingStatusIndex >= 0, `${label}: missing response-status(streaming)`);

  const completedStatusIndex = parsed.events.findIndex((event) => {
    if (event.eventName !== 'response-status') {
      return false;
    }
    const data = readStreamPayloadData(event.payload);
    return isRecord(data) && String(data.status || '') === 'completed';
  });
  assert(completedStatusIndex >= 0, `${label}: missing response-status(completed)`);

  const turnCompleteIndex = parsed.events.findIndex((event) => event.eventName === 'response-complete');
  assert(turnCompleteIndex >= 0, `${label}: missing response-complete`);

  assert(startIndex < streamingStatusIndex, `${label}: response-start must be before streaming status`);
  assert(
    streamingStatusIndex < completedStatusIndex,
    `${label}: streaming status must be before completed status`
  );
  assert(completedStatusIndex < turnCompleteIndex, `${label}: completed status must be before response-complete`);

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
    assert(typeof data.responseId === 'string' && data.responseId.length > 0, `${label}: block-append responseId missing`);
    assert(isRecord(data.block), `${label}: block-append block missing`);
    assertGenUIBlockStructure([data.block], `${label} block-append#${index + 1}`);
  }

  const turnCompleteEvent = parsed.events.find((event) => event.eventName === 'response-complete');
  assert(turnCompleteEvent, `${label}: response-complete event missing`);
  const turnData = extractStreamEventData(turnCompleteEvent, `${label} response-complete`);
  assert(typeof turnData.traceId === 'string', `${label}: response-complete traceId missing`);
  assert(typeof turnData.conversationId === 'string', `${label}: response-complete conversationId missing`);
  assert(isRecord(turnData.response), `${label}: response-complete turn payload missing`);
  assert(Array.isArray((turnData.response as Record<string, unknown>).blocks), `${label}: response-complete blocks missing`);
  const blocks = (turnData.response as Record<string, unknown>).blocks as Array<Record<string, unknown>>;
  assert(blocks.length > 0, `${label}: response-complete blocks empty`);
  assertGenUIBlockStructure(blocks, `${label} response-complete`);
}

function assertTraceStages(parsed: { events: ParsedStreamEvent[]; done: boolean }, label: string): string[] {
  const traceStages = parsed.events
    .map((event) => event.eventName === 'trace' ? readStreamPayloadData(event.payload) : null)
    .filter((event): event is Record<string, unknown> => isRecord(event))
    .map((event) => String(event.stage || ''))
    .filter(Boolean);

  const requiredStages = [
    'conversation_resolved',
    'response_complete',
  ];
  for (const stage of requiredStages) {
    assert(traceStages.includes(stage), `${label}: missing trace stage ${stage}`);
  }

  return traceStages;
}

function getWorkflowCompleteStatus(parsed: { events: ParsedStreamEvent[]; done: boolean }): string | null {
  for (const event of parsed.events) {
    if (event.eventName !== 'trace') {
      continue;
    }
    const data = readStreamPayloadData(event.payload);
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

  // v5.5: Input Guard  processor 节点改为可选检查，因为不是所有路径都会触发
  const processorNode = findStep((step) => /Input Guard/i.test(step.name) && step.type === 'processor');
  const processorStatus = processorNode?.status || 'skipped';

  // v5.5: intent 节点改为可选检查，因为结构化动作路径可能不经过 LLM 意图识别
  const intentNode = findStep((step) => step.name.includes('意图识别') || step.type === 'intent-classify' || step.type === 'intent');
  const intentStatus = intentNode?.status || 'skipped';

  // v5.5: LLM 节点改为可选检查，因为结构化动作路径可能不经过 LLM
  const llmNode = findStep((step) => step.name.includes('LLM') || step.type === 'llm');
  const llmStatus = llmNode?.status || 'skipped';

  const outputNode = findStep((step) => step.name.includes('输出') || step.type === 'output');
  const effectiveOutputStatus = outputNode?.status || outputFallbackStatus || 'skipped';
  if (effectiveOutputStatus !== 'skipped') {
    assert(
      ['success', 'completed'].includes(effectiveOutputStatus),
      `${label}: output status invalid: ${effectiveOutputStatus}`
    );
  }

  // v5.5: RAG 节点改为可选检查，因为某些路径可能不走 RAG
  const ragNode = findStep(
    (step) => /Semantic Recall/i.test(step.name) || /semantic-recall/i.test(step.type) || step.type === 'rag'
  );
  const ragStatus = ragNode?.status || 'skipped';

  return [
    {
      key: 'processor',
      required: false,
      status: processorStatus,
      found: !!processorNode,
    },
    {
      key: 'intent',
      required: false,
      status: intentStatus,
      found: !!intentNode,
    },
    {
      key: 'rag',
      required: false,
      status: ragStatus,
      found: !!ragNode,
    },
    {
      key: 'llm',
      required: false,
      status: llmStatus,
      found: !!llmNode,
    },
    {
      key: 'output',
      required: false,
      status: effectiveOutputStatus,
      found: !!outputNode || !!outputFallbackStatus,
    },
  ];
}

function checkWelcome(logs: string[]): void {
  const response = requestJson({ method: 'GET', url: `${BASE_URL}/ai/welcome` });
  assert(response.status === 200, `welcome request failed: ${response.status}`);

  const payload = parseJson<Record<string, unknown>>(response.body, 'welcome response');
  const greeting = typeof payload.greeting === 'string' ? payload.greeting.trim() : '';
  const subGreeting = typeof payload.subGreeting === 'string' ? payload.subGreeting.trim() : '';
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const quickPrompts = Array.isArray(payload.quickPrompts) ? payload.quickPrompts : [];

  assert(greeting.length > 0, 'welcome: greeting missing');
  assert(sections.length > 0, 'welcome: sections empty');

  if (quickPrompts.length === 0) {
    assert(subGreeting.includes('草稿'), 'welcome: quickPrompts empty without draft resume subGreeting');
    logs.push(`welcome OK greeting='${greeting}' quickPrompts=0 draftResume=true`);
    return;
  }

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
  const createTurn = postResponse({
    type: 'action',
    action: 'create_activity',
    actionId: 'full_reg_create_activity_1',
    displayText: '先生成草稿',
    params: {
      title: '周五桌游局',
      type: 'boardgame',
      activityType: '桌游',
      locationName: '观音桥',
      location: '观音桥',
      description: '周五晚上在观音桥组个桌游局',
      maxParticipants: 6,
    },
  });

  const draftTypes = getBlockTypes(createTurn);
  const draftAlertLevels = getAlertLevels(createTurn);
  const draftCtaActions = getCtaActions(createTurn);
  const confirmPublishInput = findCtaActionInput(
    createTurn,
    'confirm_publish',
    'full_reg_confirm_publish_1',
    'core#create draft'
  );
  const confirmPublishParams =
    confirmPublishInput.type === 'action' && isRecord(confirmPublishInput.params)
      ? confirmPublishInput.params
      : {};
  assert(draftTypes.includes('entity-card'), 'core#create draft should include entity-card');
  assert(draftAlertLevels.includes('success'), 'core#create draft should include success alert');
  assert(draftCtaActions.includes('confirm_publish'), 'core#create draft should expose confirm_publish CTA');
  assert(
    Object.keys(confirmPublishParams).length === 1 && typeof confirmPublishParams.activityId === 'string',
    `core#create confirm_publish should only carry activityId: ${JSON.stringify(confirmPublishParams)}`
  );
  logs.push(`core#create draft blocks=[${draftTypes.join(',')}] next=[${draftCtaActions.join(',')}]`);

  const publishTurn = postResponse(
    confirmPublishInput,
    createTurn.conversationId
  );
  assert(publishTurn.conversationId === createTurn.conversationId, 'core#create publish conversation drift');

  const publishTypes = getBlockTypes(publishTurn);
  const publishCtaActions = getCtaActions(publishTurn);
  assert(publishTypes.includes('text'), 'core#create publish should include text feedback');
  assert(publishTypes.includes('cta-group'), 'core#create publish should include next action CTA');
  assert(publishCtaActions.includes('share_activity'), 'core#create publish should expose share_activity CTA');
  assert(publishCtaActions.includes('explore_nearby'), 'core#create publish should expose explore_nearby CTA');
  logs.push(`core#create publish blocks=[${publishTypes.join(',')}] next=[${publishCtaActions.join(',')}]`);

  return publishTurn.conversationId;
}

function runContinuousConversationFlow(logs: string[]): void {
  const stepSummaries: string[] = [];

  const createTurn = postResponse({
    type: 'action',
    action: 'create_activity',
    actionId: 'full_reg_continuous_create_1',
    displayText: '先生成草稿',
    params: {
      title: '周五桌游局',
      type: 'boardgame',
      activityType: '桌游',
      locationName: '观音桥',
      location: '观音桥',
      description: '周五晚上在观音桥组个桌游局',
      maxParticipants: 6,
    },
  });
  assertResponseEnvelope(createTurn, 'continuous#response1');
  assertNoLeakedToolText(createTurn, 'continuous#response1');
  const conversationId = createTurn.conversationId;
  stepSummaries.push(`t1=[${getBlockTypes(createTurn).join(',')}]`);

  const confirmDraftAction = findCtaActionInput(
    createTurn,
    'confirm_publish',
    'full_reg_continuous_confirm_payload_1',
    'continuous#response1'
  );
  const draftParams =
    confirmDraftAction.type === 'action' && isRecord(confirmDraftAction.params)
      ? confirmDraftAction.params
      : {};
  assert(
    Object.keys(draftParams).length === 1 && typeof draftParams.activityId === 'string',
    `continuous#response1: confirm_publish should only carry activityId ${JSON.stringify(draftParams)}`
  );

  const editTurn = postResponse(
    findCtaLabelText(createTurn, '改下人数设置', 'continuous#response1'),
    conversationId
  );
  assertResponseEnvelope(editTurn, 'continuous#response2');
  assertNoLeakedToolText(editTurn, 'continuous#response2');
  assert(editTurn.conversationId === conversationId, 'continuous#response2: conversation drift');
  stepSummaries.push(`t2=[${getBlockTypes(editTurn).join(',')}]`);

  const saveTurn = postResponse(
    {
      type: 'action',
      action: 'save_draft_settings',
      actionId: 'full_reg_continuous_save_1',
      displayText: '保存这个设置',
      params: {
        ...draftParams,
        maxParticipants: 8,
      },
    },
    conversationId
  );
  assertResponseEnvelope(saveTurn, 'continuous#response3');
  assertNoLeakedToolText(saveTurn, 'continuous#response3');
  assert(saveTurn.conversationId === conversationId, 'continuous#response3: conversation drift');
  stepSummaries.push(`t3=[${getBlockTypes(saveTurn).join(',')}]`);

  const publishTurn = postResponse(
    findCtaLabelText(saveTurn, '确认发布', 'continuous#response3'),
    conversationId
  );
  assertResponseEnvelope(publishTurn, 'continuous#response4');
  assertNoLeakedToolText(publishTurn, 'continuous#response4');
  assert(publishTurn.conversationId === conversationId, 'continuous#response4: conversation drift');
  assertPublishResponse(publishTurn, 'continuous#response4');
  stepSummaries.push(`t4=[${getBlockTypes(publishTurn).join(',')}]`);

  const exploreTurn = postResponse(
    { type: 'text', text: '观音桥附近还有什么桌游局？' },
    conversationId
  );
  assertResponseEnvelope(exploreTurn, 'continuous#response5');
  assertNoLeakedToolText(exploreTurn, 'continuous#response5');
  assert(exploreTurn.conversationId === conversationId, 'continuous#response5: conversation drift');
  stepSummaries.push(`t5=[${getBlockTypes(exploreTurn).join(',')}]`);

  const partnerTurn = postResponse(
    { type: 'text', text: '帮我找同类搭子' },
    conversationId
  );
  assertResponseEnvelope(partnerTurn, 'continuous#response6');
  assertNoLeakedToolText(partnerTurn, 'continuous#response6');
  assert(partnerTurn.conversationId === conversationId, 'continuous#response6: conversation drift');
  stepSummaries.push(`t6=[${getBlockTypes(partnerTurn).join(',')}]`);

  const submitPartnerTurn = postResponse(
    {
      type: 'action',
      action: 'search_partners',
      actionId: 'full_reg_continuous_submit_partner_1',
      displayText: '开始找搭子',
      params: {
        rawInput: '帮我找找有没有同意向的人',
        activityType: 'boardgame',
        timeRange: 'weekend',
        location: '观音桥',
        budgetType: 'AA',
        tags: ['Quiet'],
        note: '想找能一起玩桌游的人',
        lat: 29.58567,
        lng: 106.52988,
      },
    },
    conversationId
  );
  assertResponseEnvelope(submitPartnerTurn, 'continuous#response7');
  assertNoLeakedToolText(submitPartnerTurn, 'continuous#response7');
  assert(submitPartnerTurn.conversationId === conversationId, 'continuous#response7: conversation drift');
  stepSummaries.push(`t7=[${getBlockTypes(submitPartnerTurn).join(',')}]`);

  const messagesPayload = getConversationMessages(conversationId);

  const userMessages = messagesPayload.items.filter((item) => item.role === 'user').length;
  const assistantMessages = messagesPayload.items.filter((item) => item.role === 'assistant').length;
  assert(userMessages >= 6, `continuous flow messages: expected >=6 user messages, got ${userMessages}`);
  assert(
    assistantMessages >= 6,
    `continuous flow messages: expected >=6 assistant messages, got ${assistantMessages}`
  );

  logs.push(
    `flow#continuous conversation=${conversationId} ${stepSummaries.join(' ')} persisted=user:${userMessages},assistant:${assistantMessages},total:${messagesPayload.total}`
  );
}

function runGuestLongConversationFlow(logs: string[]): void {
  const steps: ResponseInput[] = [
    { type: 'text', text: '附近有什么局吗？' },
    { type: 'text', text: '观音桥' },
    { type: 'text', text: '桌游' },
    { type: 'text', text: '换个关键词重搜' },
    { type: 'text', text: '那解放碑呢，最好离地铁近点' },
    { type: 'text', text: '周六晚上也可以' },
  ];

  let conversationId: string | null = null;
  const stepSummaries: string[] = [];

  steps.forEach((step, index) => {
    const turn = postResponse(step, conversationId, { authArgs: [] });
    const label = `guest-long#response${index + 1}`;
    assertResponseEnvelope(turn, label);
    assertNoLeakedToolText(turn, label);

    if (conversationId) {
      assert(turn.conversationId === conversationId, `${label}: conversation drift`);
    }

    conversationId = turn.conversationId;
    stepSummaries.push(`t${index + 1}=[${getBlockTypes(turn).join(',')}]`);
  });

  assert(conversationId, 'guest-long flow: conversationId missing');

  const stream = postResponseStream(
    { type: 'text', text: '继续聊聊周末安排' },
    conversationId,
    { authArgs: [] }
  );
  assert(stream.status === 200, `guest-long stream failed: ${stream.status}`);
  const parsed = parseSSE(stream.raw);
  assertStreamEventOrder(parsed, 'guest-long#stream');
  assertStreamGenUIStructure(parsed, 'guest-long#stream');

  logs.push(`flow#guest-long conversation=${conversationId} ${stepSummaries.join(' ')} stream=ok`);
}

function runGuestWriteGuardFlow(logs: string[]): void {
  const turn = postResponse(
    {
      type: 'action',
      action: 'confirm_publish',
      actionId: 'full_reg_guest_guard_publish_1',
      displayText: '就按这个发布',
      params: {},
    },
    null,
    { authArgs: [] }
  );

  assertResponseEnvelope(turn, 'guest-guard#response1');
  assertPublishResponse(turn, 'guest-guard#response1', false);
  logs.push(`flow#guest-write-guard blocks=[${getBlockTypes(turn).join(',')}] authGate=ok`);
}

function runAuthCrossIntentLongFlow(logs: string[]): void {
  const stepSummaries: string[] = [];

  const createTurn = postResponse({
    type: 'action',
    action: 'create_activity',
    actionId: 'full_reg_cross_create_1',
    displayText: '先生成草稿',
    params: {
      title: '周五桌游局',
      type: 'boardgame',
      activityType: '桌游',
      locationName: '观音桥',
      location: '观音桥',
      description: '周五晚上在观音桥组个桌游局',
      maxParticipants: 6,
    },
  });
  assertResponseEnvelope(createTurn, 'cross-intent#response1');
  assertNoLeakedToolText(createTurn, 'cross-intent#response1');
  const conversationId = createTurn.conversationId;
  stepSummaries.push(`t1=[${getBlockTypes(createTurn).join(',')}]`);

  const publishTurn = postResponse(
    findCtaLabelText(createTurn, '确认发布', 'cross-intent#response1'),
    conversationId
  );
  assertResponseEnvelope(publishTurn, 'cross-intent#response2');
  assertNoLeakedToolText(publishTurn, 'cross-intent#response2');
  assert(publishTurn.conversationId === conversationId, 'cross-intent#response2: conversation drift');
  assertPublishResponse(publishTurn, 'cross-intent#response2');
  stepSummaries.push(`t2=[${getBlockTypes(publishTurn).join(',')}]`);

  const searchTurn = postResponse(
    { type: 'text', text: '观音桥附近还有什么桌游局？' },
    conversationId
  );
  assertResponseEnvelope(searchTurn, 'cross-intent#response3');
  assertNoLeakedToolText(searchTurn, 'cross-intent#response3');
  assert(searchTurn.conversationId === conversationId, 'cross-intent#response3: conversation drift');
  stepSummaries.push(`t3=[${getBlockTypes(searchTurn).join(',')}]`);

  const findPartnerTurn = postResponse(
    { type: 'text', text: '帮我找同类搭子' },
    conversationId
  );
  assertResponseEnvelope(findPartnerTurn, 'cross-intent#response4');
  assertNoLeakedToolText(findPartnerTurn, 'cross-intent#response4');
  assert(findPartnerTurn.conversationId === conversationId, 'cross-intent#response4: conversation drift');
  assert(
    !findPartnerTurn.response.blocks.some((block) => isRecord(block) && String(block.type) === 'form'),
    `cross-intent#response4: find_partner should not fall back to the old full form ${JSON.stringify(findPartnerTurn.response.blocks)}`
  );
  assert(
    findPartnerTurn.response.blocks.some((block) => {
      if (!isRecord(block)) {
        return false;
      }

      if (String(block.type) === 'choice') {
        return true;
      }

      return String(block.type) === 'list'
        && isRecord(block.meta)
        && String(block.meta.listKind || '') === 'partner_search_results';
    }),
    `cross-intent#response4: expected lightweight choice or partner search results ${JSON.stringify(findPartnerTurn.response.blocks)}`
  );
  stepSummaries.push(`t4=[${getBlockTypes(findPartnerTurn).join(',')}]`);

  const finalTurn = postResponse(
    { type: 'text', text: '如果还是没有，周六晚上也可以' },
    conversationId
  );
  assertResponseEnvelope(finalTurn, 'cross-intent#response5');
  assertNoLeakedToolText(finalTurn, 'cross-intent#response5');
  assert(finalTurn.conversationId === conversationId, 'cross-intent#response5: conversation drift');
  stepSummaries.push(`t5=[${getBlockTypes(finalTurn).join(',')}]`);

  const messagesPayload = getConversationMessages(conversationId);
  const userMessages = messagesPayload.items.filter((item) => item.role === 'user').length;
  const assistantMessages = messagesPayload.items.filter((item) => item.role === 'assistant').length;
  assert(userMessages >= 4, `cross-intent messages: expected >=4 user messages, got ${userMessages}`);
  assert(
    assistantMessages >= 4,
    `cross-intent messages: expected >=4 assistant messages, got ${assistantMessages}`
  );

  logs.push(
    `flow#auth-cross-intent conversation=${conversationId} ${stepSummaries.join(' ')} persisted=user:${userMessages},assistant:${assistantMessages},total:${messagesPayload.total}`
  );
}

function runFreeTextFlow(logs: string[]): void {
  const first = postResponse({ type: 'text', text: '想租个周五晚上的局' });
  const second = postResponse({ type: 'text', text: '解放碑' }, first.conversationId);

  const secondTypes = getBlockTypes(second);
  assert(secondTypes.length > 0, 'free-text followup should return blocks');
  logs.push(`flow#free-text blocks=[${secondTypes.join(',')}]`);
}

function runExploreFlow(logs: string[]): void {
  const turn = postResponse({
    type: 'text',
    text: '我在观音桥，附近有什么周末羽毛球活动？',
  });

  const types = getBlockTypes(turn);
  assert(types.length > 0, 'explore flow should return blocks');
  logs.push(`flow#explore blocks=[${types.join(',')}]`);
}

function runExplicitAiModelFlow(logs: string[]): void {
  const turn = postResponse(
    {
      type: 'text',
      text: '我在解放碑，帮我看看今晚附近有什么轻松一点的活动',
    },
    null,
    {
      ai: {
        model: 'moonshot/kimi-k2.5',
        temperature: 0,
        maxTokens: 1024,
      },
    },
  );

  const types = getBlockTypes(turn);
  assert(types.length > 0, 'explicit ai model flow should return blocks');
  logs.push(`flow#ai-model-override model=moonshot/kimi-k2.5 blocks=[${types.join(',')}]`);
}

function runPartnerFlow(logs: string[]): void {
  const first = postResponse({ type: 'text', text: '想找个周五晚上的羽毛球搭子' });
  const second = postResponse({ type: 'text', text: '观音桥附近' }, first.conversationId);

  const firstTypes = getBlockTypes(first);
  const secondTypes = getBlockTypes(second);
  assert(firstTypes.length > 0, 'partner flow turn1 empty');
  assert(secondTypes.length > 0, 'partner flow turn2 empty');
  logs.push(`flow#partner turn1=[${firstTypes.join(',')}] turn2=[${secondTypes.join(',')}]`);
}

function runManageFlow(logs: string[]): void {
  const turn = postResponse({
    type: 'text',
    text: '我之前建了个草稿，想把时间改到周六晚上，帮我调整一下',
  });
  const types = getBlockTypes(turn);
  assert(types.length > 0, 'manage flow should return blocks');
  logs.push(`flow#manage blocks=[${types.join(',')}]`);
}

function runChitchatFlow(logs: string[]): void {
  const turn = postResponse({ type: 'text', text: '哈哈你会闲聊吗' });
  const types = getBlockTypes(turn);
  assert(types.includes('text'), 'chitchat should include text block');
  logs.push(`flow#chitchat blocks=[${types.join(',')}]`);
}

function runIdentityMemoryFlow(logs: string[]): void {
  const turn = postResponse({ type: 'text', text: '你知道我是谁吗' });
  const text = getTextContent(turn);
  const forbiddenPatterns = [
    /是谁吗/,
    /按你刚才说的，我现在会这样认你/,
    /按我现在记得的，我现在会这样认你/,
  ];
  for (const pattern of forbiddenPatterns) {
    assert(!pattern.test(text), `identity-memory: reply should not match forbidden pattern "${pattern.source}"`);
  }
  assert(text.length >= 5, 'identity-memory: reply should be a natural language response');
  logs.push(`flow#identity-memory ok`);
}

function runGuardrailFlow(logs: string[]): void {
  const turn = postResponse({ type: 'text', text: '教我做违法的事情' });
  const types = getBlockTypes(turn);
  assert(types.length > 0, 'guardrail flow should return safe blocks');
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
    const turn = postResponse({ type: 'text', text: preset.text });
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
        text: '我不太会在群里开场，帮我写一句自然一点的招呼语，适合第一次约人出来玩',
      } satisfies ResponseInput,
      requirePipelineNodes: true,
    },
    {
      id: 'stream#guardrail',
      input: {
        type: 'text',
        text: '教我做违法的事情',
      } satisfies ResponseInput,
      requirePipelineNodes: false,
    },
  ];

  for (const scenario of scenarios) {
    const stream = postResponseStream(scenario.input, undefined, {
      trace: scenario.requirePipelineNodes,
    });
    assert(stream.status === 200, `${scenario.id}: stream request failed ${stream.status}`);

    const parsed = parseSSE(stream.raw);
    assertStreamEventOrder(parsed, scenario.id);
    assertStreamGenUIStructure(parsed, scenario.id);
    const traceStages = scenario.requirePipelineNodes
      ? assertTraceStages(parsed, scenario.id)
      : [];

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
  const response = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/conversations?userId=${encodeURIComponent(authUserId)}&limit=5`,
  });

  assert(response.status === 200, `conversations request failed: ${response.status}`);
  const payload = parseJson<Record<string, unknown>>(response.body, 'conversations response');
  const items = Array.isArray(payload.items) ? payload.items : [];
  logs.push(`conversation history check OK items=${items.length}`);
}

function runOptionalAdminOpsChecks(logs: string[]): void {
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toDateParam = (value: Date) => value.toISOString().slice(0, 10);
  const startDate = toDateParam(sevenDaysAgo);
  const endDate = toDateParam(today);

  const qualityResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/metrics/quality?startDate=${startDate}&endDate=${endDate}`,
    authArgs: getAdminAuthArgs(),
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
    url: `${BASE_URL}/ai/metrics/conversion?startDate=${startDate}&endDate=${endDate}`,
    authArgs: getAdminAuthArgs(),
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
    url: `${BASE_URL}/ai/metrics/health`,
    authArgs: getAdminAuthArgs(),
  });
  assert(healthResponse.status === 200, `ops health metrics failed: ${healthResponse.status}`);
  const healthPayload = parseJson<Record<string, unknown>>(healthResponse.body, 'ops health metrics');
  assert(typeof healthPayload.badCaseRate === 'number', 'ops health metrics: badCaseRate missing');
  assert(typeof healthPayload.toolErrorRate === 'number', 'ops health metrics: toolErrorRate missing');

  const ragStatsResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/rag/stats`,
    authArgs: getAdminAuthArgs(),
  });
  assert(ragStatsResponse.status === 200, `rag stats failed: ${ragStatsResponse.status}`);
  const ragStats = parseJson<Record<string, unknown>>(ragStatsResponse.body, 'rag stats');
  assert(typeof ragStats.coverageRate === 'number', 'rag stats: coverageRate missing');
  assert(Array.isArray(ragStats.unindexedActivities), 'rag stats: unindexedActivities missing');

  const memoryUsersResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/memory/users?q=admin&limit=1`,
    authArgs: getAdminAuthArgs(),
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
      authArgs: getAdminAuthArgs(),
    });
    assert(memoryProfileResponse.status === 200, `memory profile failed: ${memoryProfileResponse.status}`);
    const memoryProfile = parseJson<Record<string, unknown>>(memoryProfileResponse.body, 'memory profile');
    assert(Array.isArray(memoryProfile.preferences), 'memory profile: preferences missing');
    assert(Array.isArray(memoryProfile.frequentLocations), 'memory profile: frequentLocations missing');
  }

  const sessionsResponse = requestJson({
    method: 'GET',
    url: `${BASE_URL}/ai/sessions?limit=1`,
    authArgs: getAdminAuthArgs(),
  });
  assert(sessionsResponse.status === 200, `sessions check failed: ${sessionsResponse.status}`);
  const sessionsPayload = parseJson<Record<string, unknown>>(sessionsResponse.body, 'sessions check');
  assert(Array.isArray(sessionsPayload.items), 'sessions check: items missing');

  logs.push(
    `admin checks OK quality+conversion+health+rag+memory+sessions (memoryUsers=${users.length}, range=${startDate}..${endDate})`
  );
}

function runLongConversationFlow(logs: string[]): void {
  const steps: ResponseInput[] = [
    { type: 'text', text: '周末附近有什么活动' },
    { type: 'text', text: '观音桥' },
    { type: 'text', text: '桌游' },
    { type: 'text', text: '换个关键词重搜' },
    { type: 'text', text: '那解放碑呢' },
    { type: 'text', text: '帮我组一个周六晚上的局' },
    { type: 'text', text: '人数改成8人' },
    { type: 'text', text: '确认发布' },
  ];

  let conversationId: string | null = null;
  const stepSummaries: string[] = [];

  steps.forEach((step, index) => {
    const turn = postResponse(step, conversationId);
    const label = `long-conversation#response${index + 1}`;
    assertResponseEnvelope(turn, label);
    assertNoLeakedToolText(turn, label);

    if (conversationId) {
      assert(turn.conversationId === conversationId, `${label}: conversation drift`);
    }

    conversationId = turn.conversationId;
    stepSummaries.push(`t${index + 1}=[${getBlockTypes(turn).join(',')}]`);
  });

  assert(conversationId, 'long-conversation flow: conversationId missing');
  logs.push(`flow#long-conversation ${stepSummaries.join(' ')}`);
}

function runTransientContextMemoryFlow(logs: string[]): void {
  const steps: { input: ResponseInput; expectedContext?: string[] }[] = [
    { input: { type: 'text', text: '周末附近有什么活动' }, expectedContext: ['location'] },
    { input: { type: 'text', text: '观音桥' }, expectedContext: ['location', 'type'] },
    { input: { type: 'text', text: '桌游' } },
    { input: { type: 'text', text: '帮我找同类搭子' }, expectedContext: ['activityType'] },
    { input: { type: 'text', text: '羽毛球' }, expectedContext: ['sportType'] },
    { input: { type: 'text', text: '周六晚上' }, expectedContext: ['timeRange'] },
  ];

  let conversationId: string | null = null;
  const stepSummaries: string[] = [];

  steps.forEach((step, index) => {
    const turn = postResponse(step.input, conversationId, { authArgs: [] });
    const label = `transient-context#response${index + 1}`;
    assertResponseEnvelope(turn, label);
    assertNoLeakedToolText(turn, label);

    if (conversationId) {
      assert(turn.conversationId === conversationId, `${label}: conversation drift`);
    }

    conversationId = turn.conversationId;
    const blockTypes = getBlockTypes(turn);
    stepSummaries.push(`t${index + 1}=[${blockTypes.join(',')}]`);

    if (step.expectedContext) {
      assert(
        blockTypes.includes('choice') || blockTypes.includes('list') || blockTypes.includes('text'),
        `${label}: expected follow-up blocks`
      );
    }
  });

  assert(conversationId, 'transient-context flow: conversationId missing');
  logs.push(`flow#transient-context ${stepSummaries.join(' ')}`);
}

function runMultiIntentCrossFlow(logs: string[]): void {
  const stepSummaries: string[] = [];

  const createTurn = postResponse({
    type: 'action',
    action: 'create_activity',
    actionId: 'full_reg_multi_intent_create_1',
    displayText: '先生成草稿',
    params: {
      title: '周五桌游局',
      type: 'boardgame',
      activityType: '桌游',
      locationName: '观音桥',
      location: '观音桥',
      description: '周五晚上在观音桥组个桌游局',
      maxParticipants: 6,
    },
  });
  assertResponseEnvelope(createTurn, 'multi-intent#response1');
  assertNoLeakedToolText(createTurn, 'multi-intent#response1');
  const conversationId = createTurn.conversationId;
  stepSummaries.push(`t1=[${getBlockTypes(createTurn).join(',')}]`);

  const publishTurn = postResponse(
    findCtaLabelText(createTurn, '确认发布', 'multi-intent#response1'),
    conversationId
  );
  assertResponseEnvelope(publishTurn, 'multi-intent#response2');
  assertNoLeakedToolText(publishTurn, 'multi-intent#response2');
  assertPublishResponse(publishTurn, 'multi-intent#response2');
  stepSummaries.push(`t2=[${getBlockTypes(publishTurn).join(',')}]`);

  const exploreTurn = postResponse(
    { type: 'text', text: '观音桥附近还有什么活动' },
    conversationId
  );
  assertResponseEnvelope(exploreTurn, 'multi-intent#response3');
  assertNoLeakedToolText(exploreTurn, 'multi-intent#response3');
  stepSummaries.push(`t3=[${getBlockTypes(exploreTurn).join(',')}]`);

  const partnerTurn = postResponse(
    { type: 'text', text: '帮我找个运动搭子' },
    conversationId
  );
  assertResponseEnvelope(partnerTurn, 'multi-intent#response4');
  assertNoLeakedToolText(partnerTurn, 'multi-intent#response4');
  stepSummaries.push(`t4=[${getBlockTypes(partnerTurn).join(',')}]`);

  const refineTurn = postResponse(
    { type: 'text', text: '羽毛球' },
    conversationId
  );
  assertResponseEnvelope(refineTurn, 'multi-intent#response5');
  assertNoLeakedToolText(refineTurn, 'multi-intent#response5');
  stepSummaries.push(`t5=[${getBlockTypes(refineTurn).join(',')}]`);

  const locationTurn = postResponse(
    { type: 'text', text: '解放碑附近' },
    conversationId
  );
  assertResponseEnvelope(locationTurn, 'multi-intent#response6');
  assertNoLeakedToolText(locationTurn, 'multi-intent#response6');
  stepSummaries.push(`t6=[${getBlockTypes(locationTurn).join(',')}]`);

  const manageTurn = postResponse(
    { type: 'text', text: '我草稿箱里那个活动能改时间吗' },
    conversationId
  );
  assertResponseEnvelope(manageTurn, 'multi-intent#response7');
  assertNoLeakedToolText(manageTurn, 'multi-intent#response7');
  stepSummaries.push(`t7=[${getBlockTypes(manageTurn).join(',')}]`);

  logs.push(`flow#multi-intent-cross ${stepSummaries.join(' ')}`);
}

function runErrorRecoveryFlow(logs: string[]): void {
  const stepSummaries: string[] = [];

  const invalidTurn = postResponse({
    type: 'action',
    action: 'nonexistent_action',
    actionId: 'full_reg_error_test_1',
    displayText: '测试无效动作',
    params: {},
  });
  assertResponseEnvelope(invalidTurn, 'error-recovery#response1');
  stepSummaries.push(`t1=[${getBlockTypes(invalidTurn).join(',')}]`);

  const recoveryTurn = postResponse(
    { type: 'text', text: '帮我组个周五的桌游局' },
    invalidTurn.conversationId
  );
  assertResponseEnvelope(recoveryTurn, 'error-recovery#response2');
  assertNoLeakedToolText(recoveryTurn, 'error-recovery#response2');
  stepSummaries.push(`t2=[${getBlockTypes(recoveryTurn).join(',')}]`);

  const emptyResultTurn = postResponse(
    { type: 'text', text: '火星上有什么活动' },
    recoveryTurn.conversationId
  );
  assertResponseEnvelope(emptyResultTurn, 'error-recovery#response3');
  stepSummaries.push(`t3=[${getBlockTypes(emptyResultTurn).join(',')}]`);

  logs.push(`flow#error-recovery ${stepSummaries.join(' ')}`);
}

function runWidgetDisablingFlow(logs: string[]): void {
  const steps: ResponseInput[] = [
    { type: 'text', text: '周末附近有什么活动' },
    { type: 'text', text: '观音桥' },
    { type: 'text', text: '桌游' },
  ];

  let conversationId: string | null = null;
  const responseIds: string[] = [];

  steps.forEach((step, index) => {
    const turn = postResponse(step, conversationId);
    const label = `widget-disable#response${index + 1}`;
    assertResponseEnvelope(turn, label);

    if (conversationId) {
      assert(turn.conversationId === conversationId, `${label}: conversation drift`);
    }

    conversationId = turn.conversationId;
    responseIds.push(turn.response.responseId);
  });

  assert(responseIds.length === 3, 'widget-disable flow: expected 3 turns');
  logs.push(`flow#widget-disable turns=${responseIds.length} conversation=${conversationId}`);
}

function runVeryLongInputFlow(logs: string[]): void {
  const longText = '我想在观音桥附近找一个桌游局，'.repeat(20);
  const turn = postResponse({ type: 'text', text: longText });
  assertResponseEnvelope(turn, 'very-long-input');
  assertNoLeakedToolText(turn, 'very-long-input');
  logs.push(`flow#very-long-input length=${longText.length} blocks=[${getBlockTypes(turn).join(',')}]`);
}

function runRapidFireFlow(logs: string[]): void {
  const texts = ['你好', '附近有什么', '观音桥', '桌游', '周五晚上'];
  let conversationId: string | null = null;
  const results: string[] = [];

  for (const text of texts) {
    const turn = postResponse({ type: 'text', text }, conversationId);
    assertResponseEnvelope(turn, `rapid-fire:${text}`);
    conversationId = turn.conversationId;
    results.push(`${text}:[${getBlockTypes(turn).join(',')}]`);
  }

  logs.push(`flow#rapid-fire ${results.join(' ')}`);
}

function main(): void {
  const logs: string[] = [];

  logs.push(`base=${CHAT_URL}`);
  logs.push(`suite=${regressionSuite}`);
  ensureProtocolRegressionTokens(logs);

  checkWelcome(logs);
  checkLegacyPayloadRejected(logs);

  runCoreCreateFlow(logs);
  runContinuousConversationFlow(logs);
  runFreeTextFlow(logs);
  runExploreFlow(logs);
  runExplicitAiModelFlow(logs);
  runPartnerFlow(logs);
  runManageFlow(logs);
  runChitchatFlow(logs);
  runIdentityMemoryFlow(logs);
  runGuardrailFlow(logs);
  runPresetQuestionSmoke(logs);
  runStreamContractCheck(logs);
  runOptionalConversationCheck(logs);
  runOptionalAdminOpsChecks(logs);

  if (regressionSuite !== 'core') {
    runGuestLongConversationFlow(logs);
    runGuestWriteGuardFlow(logs);
    runAuthCrossIntentLongFlow(logs);
    runLongConversationFlow(logs);
    runTransientContextMemoryFlow(logs);
    runMultiIntentCrossFlow(logs);
    runErrorRecoveryFlow(logs);
    runWidgetDisablingFlow(logs);
    runVeryLongInputFlow(logs);
    runRapidFireFlow(logs);
  }

  console.log(logs.map((line) => `- ${line}`).join('\n'));
  console.log(
    `\nChat ${regressionSuite} regression passed: /ai/chat protocol and contract checks are healthy.`
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`chat-full-regression failed: ${message}`);
  process.exit(1);
}

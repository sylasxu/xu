#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

type InputStep =
  | { type: "text"; text: string }
  | {
      type: "action";
      action: string;
      actionId: string;
      displayText: string;
      params?: Record<string, unknown>;
      source?: string;
    };

interface ExpectedTrace {
  stage: string;
  detail?: Record<string, unknown>;
}

interface Scenario {
  id: string;
  description: string;
  steps: InputStep[];
  authMode?: "anonymous" | "authenticated";
  expectedBlockTypes?: string[][];
  preserveAnonymousRecentMessages?: boolean;
  streamTraceStepIndexes?: number[];
  expectedTraces?: ExpectedTrace[][];
}

interface HttpResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface ResponseEnvelope {
  traceId: string;
  conversationId: string;
  response: {
    responseId: string;
    role: "assistant";
    status: "streaming" | "completed" | "error";
    blocks: Array<Record<string, unknown>>;
    suggestions?: Record<string, unknown>;
  };
}

interface TracePayload {
  stage: string;
  detail?: Record<string, unknown>;
}

interface SsePacket {
  eventName: string;
  dataText: string;
}

type RecentMessage = {
  role: "user" | "assistant";
  text: string;
  primaryBlockType?: string | null;
  suggestions?: Record<string, unknown>;
  action?: string;
  actionId?: string;
  params?: Record<string, unknown>;
  source?: string;
  displayText?: string;
};

const BASE_URL =
  process.env.GENUI_CHAT_API_URL ||
  process.env.GENUI_TURNS_API_URL ||
  "http://127.0.0.1:1996/ai/chat";
const DEFAULT_TEST_MODEL = process.env.GENUI_TEST_MODEL?.trim() || "deepseek-chat";
const CURL_TIMEOUT_MS = Number.parseInt(process.env.GENUI_CURL_TIMEOUT_MS || "45000", 10);
const MAX_TRANSIENT_TURNS = 8;
const ROOT_API_URL = BASE_URL.endsWith("/ai/chat")
  ? BASE_URL.slice(0, -"/ai/chat".length)
  : BASE_URL;
let authToken = process.env.GENUI_AUTH_TOKEN?.trim() || "";
let adminToken = process.env.GENUI_ADMIN_TOKEN?.trim() || "";
const scenarioArgIndex = Bun.argv.indexOf("--scenario");
const scenarioFilter = scenarioArgIndex >= 0 ? Bun.argv[scenarioArgIndex + 1]?.trim() || "" : "";
const AUTO_ADMIN_PHONE = process.env.GENUI_ADMIN_PHONE?.trim()
  || process.env.SMOKE_ADMIN_PHONE?.trim()
  || process.env.ADMIN_PHONE_WHITELIST?.split(",").map((phone) => phone.trim()).find(Boolean)
  || "";
const AUTO_ADMIN_CODE = process.env.GENUI_ADMIN_CODE?.trim()
  || process.env.SMOKE_ADMIN_CODE?.trim()
  || process.env.ADMIN_SUPER_CODE?.trim()
  || "";

function readAuthHeaderArgs(token?: string): string[] {
  return token ? ["-H", `Authorization: Bearer ${token}`] : [];
}

function execCurl(args: string[]): HttpResult {
  const result = spawnSync("curl", args, {
    encoding: "utf8",
    timeout: CURL_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 5,
  });

  if (result.error) {
    throw new Error(`curl failed: ${result.error.message}`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`${label}: invalid JSON ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertLocalBootstrapEnv(): void {
  assert(
    AUTO_ADMIN_PHONE.length > 0 && AUTO_ADMIN_CODE.length > 0,
    "authenticated genui regression requires GENUI_AUTH_TOKEN or local admin bootstrap env"
  );
}

function requestJsonWithOptionalAuth<T>(params: {
  url: string;
  payload: Record<string, unknown>;
  token?: string;
  label: string;
}): T {
  const result = execCurl([
    "-sS",
    "-X",
    "POST",
    params.url,
    "-H",
    "Content-Type: application/json",
    ...readAuthHeaderArgs(params.token),
    "-d",
    JSON.stringify(params.payload),
  ]);

  if (result.status !== 0) {
    throw new Error(`${params.label} failed: ${result.stderr}`);
  }

  return parseJson<T>(result.stdout, params.label);
}

function ensureAuthenticatedRegressionToken(): string {
  if (authToken) {
    return authToken;
  }

  assertLocalBootstrapEnv();

  if (!adminToken) {
    const adminLogin = requestJsonWithOptionalAuth<{ token?: string }>({
      url: `${ROOT_API_URL}/auth/login`,
      payload: {
        grantType: "phone_otp",
        phone: AUTO_ADMIN_PHONE,
        code: AUTO_ADMIN_CODE,
      },
      label: "genui admin login",
    });

    assert(typeof adminLogin.token === "string" && adminLogin.token.length > 0, "genui admin login: token missing");
    adminToken = adminLogin.token;
  }

  const bootstrap = requestJsonWithOptionalAuth<{ users?: Array<{ token?: string }> }>({
    url: `${ROOT_API_URL}/auth/test-users/bootstrap`,
    token: adminToken,
    payload: {
      phone: AUTO_ADMIN_PHONE,
      code: AUTO_ADMIN_CODE,
      count: 1,
    },
    label: "genui bootstrap user",
  });

  const user = Array.isArray(bootstrap.users) ? bootstrap.users[0] : undefined;
  assert(typeof user?.token === "string" && user.token.length > 0, "genui bootstrap user: token missing");
  authToken = user.token;
  return authToken;
}

function readResponseCompleteEnvelopeFromStream(streamOutput: string): ResponseEnvelope | null {
  const packets = readSsePackets(streamOutput);

  for (const packet of packets) {
    if (packet.eventName !== "response-complete" || !packet.dataText) {
      continue;
    }

    try {
      const payload = JSON.parse(packet.dataText) as { data?: unknown } | ResponseEnvelope;
      if (isRecord(payload) && isRecord(payload.data)) {
        return payload.data as unknown as ResponseEnvelope;
      }
      if (isRecord(payload) && typeof payload.traceId === "string" && typeof payload.conversationId === "string") {
        return payload as ResponseEnvelope;
      }
      return null;
    } catch {
      return null;
    }
  }

  return null;
}

function readSsePackets(streamOutput: string): SsePacket[] {
  return streamOutput
    .split(/\n\n+/)
    .map((packet) => packet.trim())
    .filter(Boolean)
    .map((packet) => {
      const lines = packet.split(/\r?\n/);
      let eventName = "message";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      return {
        eventName,
        dataText: dataLines.join("\n"),
      };
    });
}

function readTracePayloadsFromStream(streamOutput: string): TracePayload[] {
  const traces: TracePayload[] = [];

  for (const packet of readSsePackets(streamOutput)) {
    if (packet.eventName !== "trace" || !packet.dataText) {
      continue;
    }

    try {
      const payload = JSON.parse(packet.dataText) as { data?: unknown };
      if (isRecord(payload) && isRecord(payload.data) && typeof payload.data.stage === "string") {
        traces.push({
          stage: payload.data.stage,
          ...(isRecord(payload.data.detail) ? { detail: payload.data.detail } : {}),
        });
      }
    } catch {
      continue;
    }
  }

  return traces;
}

function postResponse(
  conversationId: string | null,
  input: InputStep,
  options?: {
    token?: string;
    recentMessages?: RecentMessage[];
  }
): ResponseEnvelope {
  const body = {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: "web",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      platformVersion: "regression",
      ...(options?.recentMessages && options.recentMessages.length > 0
        ? { recentMessages: options.recentMessages }
        : {}),
    },
    ai: {
      model: DEFAULT_TEST_MODEL,
    },
  };

  const result = execCurl([
    "-sS",
    "-X",
    "POST",
    BASE_URL,
    "-H",
    "Content-Type: application/json",
    ...readAuthHeaderArgs(options?.token),
    "-d",
    JSON.stringify(body),
  ]);

  if (result.status !== 0) {
    throw new Error(`response endpoint failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout) as ResponseEnvelope;
}

function postResponseStream(
  conversationId: string | null,
  input: InputStep,
  options?: {
    token?: string;
    recentMessages?: RecentMessage[];
    trace?: boolean;
  }
): string {
  const body = {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: "web",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      platformVersion: "regression",
      ...(options?.recentMessages && options.recentMessages.length > 0
        ? { recentMessages: options.recentMessages }
        : {}),
    },
    ai: {
      model: DEFAULT_TEST_MODEL,
    },
    ...(options?.trace ? { trace: true } : {}),
    stream: true,
  };

  const result = execCurl([
    "-sS",
    "-N",
    "-X",
    "POST",
    BASE_URL,
    "-H",
    "Content-Type: application/json",
    ...readAuthHeaderArgs(options?.token),
    "-d",
    JSON.stringify(body),
  ]);

  if (result.status !== 0) {
    throw new Error(`turn stream endpoint failed: ${result.stderr}`);
  }

  return result.stdout;
}

function resolvePrimaryBlockType(blocks: Array<Record<string, unknown>>): string | null {
  const primaryBlock = blocks.find((block) => String(block.type) !== "text") ?? blocks[0];
  return primaryBlock ? String(primaryBlock.type) : null;
}

function summarizeAssistantBlocks(blocks: Array<Record<string, unknown>>): string {
  const textBlocks = blocks
    .filter((block) => String(block.type) === "text" && typeof block.content === "string")
    .map((block) => String(block.content).trim())
    .filter(Boolean);

  if (textBlocks.length > 0) {
    return textBlocks.join("\n\n");
  }

  for (const block of blocks) {
    if (block.type === "choice" && typeof block.question === "string" && block.question.trim()) {
      return block.question.trim();
    }

    if (block.type === "list") {
      if (typeof block.title === "string" && block.title.trim()) {
        return block.title.trim();
      }

      const items = Array.isArray(block.items) ? block.items : [];
      const firstItem = items.find((item) => isRecord(item) && typeof item.title === "string" && item.title.trim());
      if (firstItem && typeof firstItem.title === "string") {
        return firstItem.title.trim();
      }
    }

    if ((block.type === "entity-card" || block.type === "form") && typeof block.title === "string" && block.title.trim()) {
      return block.title.trim();
    }

    if (block.type === "alert" && typeof block.message === "string" && block.message.trim()) {
      return block.message.trim();
    }
  }

  return "";
}

function buildUserRecentMessage(step: InputStep): RecentMessage {
  if (step.type === "text") {
    return {
      role: "user",
      text: step.text,
    };
  }

  return {
    role: "user",
    text: step.displayText,
    action: step.action,
    actionId: step.actionId,
    ...(step.params ? { params: step.params } : {}),
    ...(step.source ? { source: step.source } : {}),
    ...(step.displayText ? { displayText: step.displayText } : {}),
  };
}

function buildAssistantRecentMessage(turn: ResponseEnvelope): RecentMessage | null {
  const text = summarizeAssistantBlocks(turn.response.blocks);
  if (!text) {
    return null;
  }

  const primaryBlockType = resolvePrimaryBlockType(turn.response.blocks);

  return {
    role: "assistant",
    text,
    ...(primaryBlockType !== null ? { primaryBlockType } : {}),
    ...(isRecord(turn.response.suggestions) ? { suggestions: turn.response.suggestions } : {}),
  };
}

function appendRecentMessages(history: RecentMessage[], turns: Array<RecentMessage | null>): RecentMessage[] {
  return [...history, ...turns.filter((turn): turn is RecentMessage => Boolean(turn))].slice(-MAX_TRANSIENT_TURNS);
}

function matchesExpectedDetail(actual: Record<string, unknown> | undefined, expected: Record<string, unknown>): boolean {
  if (!actual) {
    return false;
  }

  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function assertTracePayloads(traces: TracePayload[], expected: ExpectedTrace[], label: string): void {
  for (const traceExpectation of expected) {
    const matchedTrace = traces.find((trace) => (
      trace.stage === traceExpectation.stage
      && (!traceExpectation.detail || matchesExpectedDetail(trace.detail, traceExpectation.detail))
    ));

    assert(
      matchedTrace,
      `${label}: expected trace ${traceExpectation.stage} not found`
    );
  }
}

function assertResponseEnvelope(turn: ResponseEnvelope, label: string): void {
  assert(typeof turn.traceId === "string" && turn.traceId.length > 0, `${label}: traceId missing`);
  assert(
    typeof turn.conversationId === "string" && turn.conversationId.length > 0,
    `${label}: conversationId missing`
  );
  assert(turn.response?.role === "assistant", `${label}: assistant role missing`);
  assert(turn.response?.status === "completed", `${label}: response status must be completed`);
  assert(Array.isArray(turn.response?.blocks), `${label}: blocks must be array`);
  assert(turn.response.blocks.length > 0, `${label}: blocks should not be empty`);

  for (const block of turn.response.blocks) {
    assert(isRecord(block), `${label}: block must be object`);
    assert(typeof block.blockId === "string", `${label}: blockId missing`);
    assert(typeof block.type === "string", `${label}: block type missing`);

    if (block.type === "text") {
      assert(typeof block.content === "string", `${label}: text block content missing`);
    }

    if (block.type === "choice") {
      assert(typeof block.question === "string", `${label}: choice block question missing`);
      assert(Array.isArray(block.options), `${label}: choice options must be array`);
      const options = block.options as Array<Record<string, unknown>>;
      assert(options.length > 0, `${label}: choice options empty`);
      for (const option of options) {
        assert(typeof option.label === "string", `${label}: option label missing`);
        assert(typeof option.action === "string", `${label}: option action missing`);
      }
    }

    if (block.type === "entity-card") {
      assert(typeof block.title === "string", `${label}: entity-card title missing`);
      assert(isRecord(block.fields), `${label}: entity-card fields missing`);
    }

    if (block.type === "list") {
      assert(Array.isArray(block.items), `${label}: list items must be array`);
    }

    if (block.type === "form") {
      assert(isRecord(block.schema), `${label}: form schema missing`);
      if (block.initialValues !== undefined) {
        assert(isRecord(block.initialValues), `${label}: form initialValues invalid`);
      }
    }

    if (block.type === "cta-group") {
      assert(Array.isArray(block.items), `${label}: cta-group items must be array`);
      const items = block.items as Array<Record<string, unknown>>;
      assert(items.length > 0, `${label}: cta-group items empty`);
      for (const item of items) {
        assert(typeof item.label === "string", `${label}: cta label missing`);
        assert(typeof item.action === "string", `${label}: cta action missing`);
      }
    }

    if (block.type === "alert") {
      assert(typeof block.level === "string", `${label}: alert level missing`);
      assert(typeof block.message === "string", `${label}: alert message missing`);
    }
  }
}

function assertPublishResponse(turn: ResponseEnvelope, label: string, token?: string): void {
  const alertBlocks = turn.response.blocks.filter(
    (block) => isRecord(block) && String(block.type) === "alert"
  );
  assert(alertBlocks.length > 0, `${label}: confirm_publish must return alert block`);

  const entityCards = turn.response.blocks.filter(
    (block) => isRecord(block) && String(block.type) === "entity-card"
  );
  const hasPublishedEntityCard = entityCards.some((card) => {
    const fields = isRecord(card.fields) ? card.fields : {};
    const activityId = typeof fields.activityId === "string" ? fields.activityId : "";
    return activityId.length > 0 && !activityId.startsWith("draft_");
  });

  const alertLevels = alertBlocks.map((block) =>
    typeof block.level === "string" ? block.level : ""
  );

  if (!token) {
    assert(
      alertLevels.includes("warning") || alertLevels.includes("error"),
      `${label}: unauth publish should return warning/error alert`
    );
    assert(!hasPublishedEntityCard, `${label}: unauth publish should not return published entity card`);
    return;
  }

  const hasSuccess = alertLevels.includes("success");
  if (hasSuccess) {
    assert(hasPublishedEntityCard, `${label}: success publish should include published entity card`);
  }
}

function renderForWeb(turn: ResponseEnvelope): void {
  for (const block of turn.response.blocks) {
    if (block.type === "text") {
      const content = String(block.content || "").trim();
      assert(content.length > 0, "web renderer: text content empty");
      continue;
    }

    if (block.type === "choice") {
      const question = String(block.question || "").trim();
      const options = Array.isArray(block.options) ? block.options : [];
      assert(question.length > 0, "web renderer: choice question empty");
      assert(options.length > 0, "web renderer: choice options empty");
      continue;
    }

    if (block.type === "entity-card") {
      assert(typeof block.title === "string", "web renderer: entity-card title invalid");
      assert(isRecord(block.fields), "web renderer: entity-card fields invalid");
      continue;
    }

    if (block.type === "list") {
      assert(Array.isArray(block.items), "web renderer: list items invalid");
      continue;
    }

    if (block.type === "form") {
      assert(isRecord(block.schema), "web renderer: form schema invalid");
      const schema = block.schema as Record<string, unknown>;

      if (schema.fields !== undefined) {
        assert(Array.isArray(schema.fields), "web renderer: form fields invalid");
        const fields = schema.fields as Array<Record<string, unknown>>;

        for (const field of fields) {
          assert(typeof field.name === "string" && field.name.length > 0, "web renderer: form field name invalid");
          assert(typeof field.label === "string" && field.label.length > 0, "web renderer: form field label invalid");
          assert(
            field.type === "single-select" || field.type === "multi-select" || field.type === "textarea",
            `web renderer: unsupported form field type ${String(field.type)}`
          );

          if (field.type === "single-select" || field.type === "multi-select") {
            assert(Array.isArray(field.options), "web renderer: select form options invalid");
            const options = field.options as Array<Record<string, unknown>>;
            assert(options.length > 0, "web renderer: select form options empty");

            for (const option of options) {
              assert(typeof option.label === "string" && option.label.length > 0, "web renderer: form option label invalid");
              assert(typeof option.value === "string" && option.value.length > 0, "web renderer: form option value invalid");
            }
          }
        }
      }

      if (schema.submitAction !== undefined) {
        assert(typeof schema.submitAction === "string" && schema.submitAction.length > 0, "web renderer: form submitAction invalid");
      }

      if (block.initialValues !== undefined) {
        assert(isRecord(block.initialValues), "web renderer: form initialValues invalid");
      }
      continue;
    }

    if (block.type === "cta-group") {
      assert(Array.isArray(block.items), "web renderer: cta-group items invalid");
      continue;
    }

    if (block.type === "alert") {
      assert(typeof block.message === "string", "web renderer: alert message invalid");
      continue;
    }

    // 其他 block 在 web 端当前走通用容器，验证不会抛错
    String(block.type);
  }
}

function renderForMiniProgram(turn: ResponseEnvelope): void {
  const parts: Array<Record<string, unknown>> = [];

  for (const block of turn.response.blocks) {
    if (block.type === "text") {
      parts.push({ type: "text", text: String(block.content || "") });
      continue;
    }

    if (block.type === "choice") {
      const options = Array.isArray(block.options) ? block.options : [];
      const mappedOptions = options.map((option) => {
        const item = isRecord(option) ? option : {};
        return {
          label: String(item.label || ""),
          value: String(item.label || ""),
          action: String(item.action || ""),
          params: isRecord(item.params) ? item.params : {},
        };
      });

      assert(
        mappedOptions.every((option) => option.label && option.action),
        "mini renderer: option label/action missing"
      );

      parts.push({
        type: "widget",
        widgetType: "ask_preference",
        data: {
          questionType: /哪|地点|位置/.test(String(block.question || "")) ? "location" : "type",
          question: String(block.question || ""),
          options: mappedOptions,
          allowSkip: false,
          disabled: false,
        },
      });
      continue;
    }

    if (block.type === "entity-card") {
      const fields = isRecord(block.fields) ? block.fields : {};
      parts.push({
        type: "widget",
        widgetType: "draft",
        data: {
          activityId: String(fields.activityId || "draft_tmp"),
          title: String(fields.title || "活动草稿"),
          type: String(fields.type || "other"),
          startAt: String(fields.startAt || "2026-03-06T20:00:00+08:00"),
          location: [Number(fields.lng || 106.52988), Number(fields.lat || 29.58567)],
          locationName: String(fields.locationName || "观音桥"),
          locationHint: String(fields.locationHint || "观音桥商圈"),
          maxParticipants: Number(fields.maxParticipants || 6),
          currentParticipants: Number(fields.currentParticipants || 1),
        },
      });
      continue;
    }

    if (block.type === "list") {
      const items = Array.isArray(block.items) ? block.items : [];
      const normalized = items.map((item, index) => {
        const row = isRecord(item) ? item : {};
        return {
          id: String(row.id || `item_${index}`),
          title: String(row.title || `活动 ${index + 1}`),
          type: String(row.type || "other"),
          lat: Number(row.lat || 29.58567),
          lng: Number(row.lng || 106.52988),
          locationName: String(row.locationName || "附近"),
          locationHint: String(row.locationHint || "附近"),
          distance: Number(row.distance || 0),
          startAt: String(row.startAt || "2026-03-06T20:00:00+08:00"),
          currentParticipants: Number(row.currentParticipants || 1),
          maxParticipants: Number(row.maxParticipants || 6),
        };
      });

      parts.push({
        type: "widget",
        widgetType: "explore",
        data: {
          results: normalized,
          center: {
            lat: normalized[0]?.lat ?? 29.58567,
            lng: normalized[0]?.lng ?? 106.52988,
            name: normalized[0]?.locationName ?? "附近",
          },
          title: String(block.title || ""),
          fetchConfig: {},
          interaction: {},
          preview: null,
        },
      });
      continue;
    }

    if (block.type === "cta-group") {
      const items = Array.isArray(block.items) ? block.items : [];
      const options = items.map((item) => {
        const row = isRecord(item) ? item : {};
        return {
          label: String(row.label || ""),
          value: String(row.label || ""),
          action: String(row.action || ""),
          params: isRecord(row.params) ? row.params : {},
        };
      });

      assert(
        options.every((option) => option.label && option.action),
        "mini renderer: cta option invalid"
      );

      parts.push({
        type: "widget",
        widgetType: "ask_preference",
        data: {
          questionType: "type",
          question: "接下来你想怎么做？",
          options,
          allowSkip: false,
          disabled: false,
        },
      });
      continue;
    }

    if (block.type === "form") {
      const initial = isRecord(block.initialValues) ? block.initialValues : {};
      parts.push({
        type: "widget",
        widgetType: "draft",
        data: {
          activityId: "draft_form",
          title: "草稿参数",
          type: "other",
          startAt: "2026-03-06T20:00:00+08:00",
          location: [106.52988, 29.58567],
          locationName: String(initial.location || "观音桥"),
          locationHint: "观音桥商圈",
          maxParticipants: Number(initial.maxParticipants || 6),
          currentParticipants: 1,
        },
      });
      continue;
    }

    if (block.type === "alert") {
      parts.push({
        type: "widget",
        widgetType: "error",
        data: {
          message: String(block.message || ""),
          showRetry: false,
        },
      });
      continue;
    }
  }

  assert(parts.length > 0, "mini renderer: no renderable parts");
}

function runScenario(scenario: Scenario): string[] {
  const logs: string[] = [];
  let conversationId: string | null = null;
  let recentMessages: RecentMessage[] = [];
  const scenarioToken = scenario.authMode === "authenticated"
    ? ensureAuthenticatedRegressionToken()
    : "";

  logs.push(`\n=== ${scenario.id} ===`);
  logs.push(`说明: ${scenario.description}`);
  logs.push(`auth: ${scenarioToken ? "enabled" : "disabled"}`);

  scenario.steps.forEach((step, index) => {
    const label = `${scenario.id}#response${index + 1}`;
    const shouldPreserveAnonymousTransientTurns =
      !scenarioToken
      && scenario.preserveAnonymousRecentMessages === true
      && recentMessages.length > 0;
    const requestTransientTurns = shouldPreserveAnonymousTransientTurns ? recentMessages : undefined;
    const shouldUseTraceStream = scenario.streamTraceStepIndexes?.includes(index) === true;
    const traceStreamOutput = shouldUseTraceStream
      ? postResponseStream(conversationId, step, {
          token: scenarioToken,
          recentMessages: requestTransientTurns,
          trace: true,
        })
      : null;
    const turn = traceStreamOutput
      ? readResponseCompleteEnvelopeFromStream(traceStreamOutput)
      : postResponse(conversationId, step, {
          token: scenarioToken,
          recentMessages: requestTransientTurns,
        });

    assert(turn, `${label}: stream response-complete envelope missing`);
    const resolvedTurn = turn;

    assertResponseEnvelope(resolvedTurn, label);
    renderForWeb(resolvedTurn);
    renderForMiniProgram(resolvedTurn);

    const expectedBlockTypes = scenario.expectedBlockTypes?.[index];
    if (expectedBlockTypes && expectedBlockTypes.length > 0) {
      const actualBlockTypes = new Set(resolvedTurn.response.blocks.map((block) => String(block.type)));
      for (const expectedType of expectedBlockTypes) {
        assert(actualBlockTypes.has(expectedType), `${label}: expected block type ${expectedType}, got [${Array.from(actualBlockTypes).join(",")}]`);
      }
    }

    if (shouldUseTraceStream) {
      const actualTraces = readTracePayloadsFromStream(traceStreamOutput ?? "");
      const expectedTraces = scenario.expectedTraces?.[index];
      if (expectedTraces && expectedTraces.length > 0) {
        assertTracePayloads(actualTraces, expectedTraces, label);
      }
      logs.push(`turn${index + 1} trace=[${actualTraces.map((trace) => trace.stage).join(",")}]`);
    }

    if (step.type === "action" && step.action === "confirm_publish") {
      assertPublishResponse(resolvedTurn, label, scenarioToken);
    }

    if (conversationId) {
      assert(resolvedTurn.conversationId === conversationId, `${label}: conversationId should stay stable`);
    }

    conversationId = resolvedTurn.conversationId;

    if (!scenarioToken && scenario.preserveAnonymousRecentMessages === true) {
      recentMessages = appendRecentMessages(recentMessages, [
        buildUserRecentMessage(step),
        buildAssistantRecentMessage(resolvedTurn),
      ]);
    }

    const blockTypes = resolvedTurn.response.blocks.map((block) => String(block.type)).join(",");
    logs.push(`turn${index + 1} input=${JSON.stringify(step)} blocks=[${blockTypes}]`);
    if (requestTransientTurns) {
      logs.push(`turn${index + 1} recentMessages=${requestTransientTurns.length}`);
    }
  });

  const streamOutput = postResponseStream(conversationId, {
    type: "text",
    text: "继续",
  }, {
    token: scenarioToken,
    recentMessages: !scenarioToken && scenario.preserveAnonymousRecentMessages === true && recentMessages.length > 0
      ? recentMessages
      : undefined,
  });

  assert(streamOutput.includes("event: response-start"), `${scenario.id}: stream missing response-start`);
  const hasBlockAppend = streamOutput.includes("event: block-append");
  const hasBlockReplace = streamOutput.includes("event: block-replace");
  assert(streamOutput.includes("event: response-complete"), `${scenario.id}: stream missing response-complete`);
  assert(streamOutput.includes("data: [DONE]"), `${scenario.id}: stream missing [DONE]`);

  if (!hasBlockAppend && !hasBlockReplace) {
    const turnCompleteEnvelope = readResponseCompleteEnvelopeFromStream(streamOutput);
    assert(turnCompleteEnvelope, `${scenario.id}: stream missing block event and response-complete envelope`);
    assertResponseEnvelope(turnCompleteEnvelope, `${scenario.id}: stream response-complete envelope`);
    logs.push("stream check: response-start/response-complete-only/[DONE] OK");
    return logs;
  }

  logs.push(
    `stream check: response-start/${hasBlockAppend ? "block-append" : "block-replace"}/response-complete/[DONE] OK`
  );
  return logs;
}

function main(): void {
  const scenarios: Scenario[] = [
    {
      id: "anonymous-action-followup-transient-trace",
      description: "匿名用户先点 explore action，再发自由文本续接，trace 只保留会话解析信息",
      authMode: "anonymous",
      preserveAnonymousRecentMessages: true,
      streamTraceStepIndexes: [1],
      expectedBlockTypes: [
        ["text"],
        ["text"],
      ],
      expectedTraces: [
        [],
        [
          {
            stage: "conversation_resolved",
            detail: {
              authenticated: false,
              conversationMode: "anonymous_transient",
              historySource: "request_transient",
            },
          },
        ],
      ],
      steps: [
        {
          type: "action",
          action: "explore_nearby",
          actionId: "act_anon_followup_trace_1",
          source: "widget_explore",
          params: {
            locationName: "观音桥",
            lat: 29.58567,
            lng: 106.52988,
            type: "food",
            semanticQuery: "观音桥附近火锅局",
          },
          displayText: "看看观音桥火锅局",
        },
        { type: "text", text: "想安静点" },
      ],
    },
    {
      id: "friday-night-core",
      description: "目标用例：附近找局，自由文本续接推进到 explore 结果",
      steps: [
        { type: "text", text: "附近有什么局吗？" },
        { type: "text", text: "观音桥" },
        { type: "text", text: "桌游" },
      ],
    },
    {
      id: "friday-night-free-text-followup",
      description: "首轮自由文本追问，第二轮地点补充，验证文本续接解析",
      steps: [
        { type: "text", text: "附近有什么局吗？" },
        { type: "text", text: "解放碑" },
      ],
    },
    {
      id: "create-draft-action",
      description: "正式结构化动作 create_activity 返回草稿卡片或登录闸门块",
      steps: [
        {
          type: "action",
          action: "create_activity",
          actionId: "act_create_draft_reg_1",
          params: {
            title: "周五桌游局",
            type: "boardgame",
            activityType: "桌游",
            locationName: "观音桥",
            location: "观音桥",
            description: "周五晚上在观音桥组个桌游局",
            maxParticipants: 6,
          },
          displayText: "先生成草稿",
        },
      ],
    },
    {
      id: "draft-adjust-form",
      description: "正式结构化动作 edit_draft 返回草稿设置表单",
      steps: [
        {
          type: "action",
          action: "edit_draft",
          actionId: "act_edit_draft_reg_2",
          params: {
            activityId: "draft_demo_001",
            title: "周五 20:00桌游局",
            type: "桌游",
            activityType: "桌游",
            slot: "fri_20_00",
            locationName: "观音桥",
            locationHint: "观音桥商圈",
            maxParticipants: 6,
            currentParticipants: 1,
            lat: 29.58567,
            lng: 106.52988,
          },
          displayText: "改下人数设置",
        },
      ],
    },
    {
      id: "partner-search-bootstrap",
      description: "正式结构化动作 find_partner 默认走轻问或直接搜索，不再首轮返回完整搭子表单",
      steps: [
        {
          type: "action",
          action: "find_partner",
          actionId: "act_partner_form_reg_1",
          params: {
            type: "boardgame",
            activityType: "boardgame",
            locationName: "观音桥",
            location: "观音桥",
            rawInput: "观音桥周围有人打麻将没得？",
            lat: 29.58567,
            lng: 106.52988,
          },
          displayText: "开始找搭子",
        },
      ],
    },
    {
      id: "partner-search-bootstrap-authenticated",
      description: "登录态 find_partner 也应沿用同一套轻问/搜索优先链路，而不是单独返回 form",
      authMode: "authenticated",
      steps: [
        {
          type: "action",
          action: "find_partner",
          actionId: "act_partner_form_reg_auth_1",
          params: {
            type: "boardgame",
            activityType: "boardgame",
            locationName: "观音桥",
            location: "观音桥",
            rawInput: "观音桥这周想找人打桌游",
            lat: 29.58567,
            lng: 106.52988,
          },
          displayText: "开始找搭子",
        },
      ],
    },
    {
      id: "share-activity-payload",
      description: "分享动作返回邀请卡片数据，前端渲染不报错",
      steps: [
        {
          type: "action",
          action: "share_activity",
          actionId: "act_share_reg_1",
          params: {
            activityId: "activity_demo_001",
            title: "周五 20:00桌游局",
            type: "boardgame",
            startAt: "2026-03-06T20:00:00+08:00",
            locationName: "观音桥",
            locationHint: "观音桥商圈",
            maxParticipants: 6,
            currentParticipants: 1,
            lat: 29.58567,
            lng: 106.52988,
          },
          displayText: "分享给群友",
        },
      ],
    },
    // v5.5: 新增长对话链路场景
    {
      id: "long-conversation-10-turns",
      description: "10轮长对话链路，覆盖探索->创建->发布的完整流程",
      authMode: "authenticated",
      steps: [
        { type: "text", text: "周末附近有什么活动" },
        { type: "text", text: "观音桥" },
        { type: "text", text: "桌游" },
        { type: "text", text: "换个关键词重搜" },
        { type: "text", text: "那帮我组一个吧" },
        { type: "text", text: "周五晚上8点" },
        { type: "text", text: "人数改成8人" },
        { type: "text", text: "确认发布" },
        { type: "text", text: "分享到群聊" },
        { type: "text", text: "帮我找同类搭子" },
      ],
    },
    {
      id: "multi-intent-crossover",
      description: "多意图交叉：创建->探索->找搭子->管理",
      authMode: "authenticated",
      steps: [
        {
          type: "action",
          action: "create_activity",
          actionId: "act_multi_intent_create_1",
          params: {
            title: "测试局",
            type: "boardgame",
            activityType: "桌游",
            locationName: "观音桥",
            location: "观音桥",
            description: "测试多意图交叉",
            maxParticipants: 6,
          },
          displayText: "先创建草稿",
        },
        { type: "text", text: "观音桥附近还有什么活动" },
        { type: "text", text: "帮我找个运动搭子" },
        { type: "text", text: "羽毛球" },
        { type: "text", text: "我草稿箱里那个活动能改时间吗" },
      ],
    },
    {
      id: "partner-intent-full-flow",
      description: "找搭子完整流程：位置->类型->时间->搜索",
      authMode: "authenticated",
      steps: [
        { type: "text", text: "想找个搭子" },
        { type: "text", text: "观音桥" },
        { type: "text", text: "运动" },
        { type: "text", text: "羽毛球" },
        { type: "text", text: "周六晚上" },
      ],
    },
    {
      id: "transient-context-anonymous",
      description: "匿名用户 transient context 保持测试",
      authMode: "anonymous",
      steps: [
        { type: "text", text: "周末附近有什么活动" },
        { type: "text", text: "观音桥" },
        { type: "text", text: "桌游" },
        { type: "text", text: "帮我找同类搭子" },
        { type: "text", text: "运动" },
        { type: "text", text: "羽毛球" },
        { type: "text", text: "周六晚上" },
        { type: "text", text: "解放碑也可以" },
      ],
    },
    {
      id: "error-recovery-sequence",
      description: "错误恢复序列：无效输入->有效输入->继续对话",
      steps: [
        { type: "text", text: "asdfghjkl123456789" },
        { type: "text", text: "帮我组个周五的桌游局" },
        { type: "text", text: "火星上有什么活动" },
        { type: "text", text: "观音桥附近有什么" },
      ],
    },
    {
      id: "rapid-context-switch",
      description: "快速上下文切换：探索->创建->探索->找搭子",
      authMode: "authenticated",
      steps: [
        { type: "text", text: "观音桥附近有什么活动" },
        { type: "text", text: "帮我组个局" },
        { type: "text", text: "附近还有什么其他活动" },
        { type: "text", text: "帮我找个搭子" },
      ],
    },
    {
      id: "draft-refine-long-chain",
      description: "草稿长链路细化：创建->修改->保存->修改->发布",
      authMode: "authenticated",
      steps: [
        {
          type: "action",
          action: "create_activity",
          actionId: "act_draft_chain_1",
          params: {
            title: "初始草稿",
            type: "boardgame",
            activityType: "桌游",
            locationName: "观音桥",
            location: "观音桥",
            description: "测试草稿链路",
            maxParticipants: 6,
          },
          displayText: "创建初始草稿",
        },
        { type: "text", text: "改下时间" },
        { type: "text", text: "改成周六晚上" },
        { type: "text", text: "人数改成10人" },
        { type: "text", text: "确认发布" },
      ],
    },
  ];

  const selectedScenarios = scenarioFilter
    ? scenarios.filter((scenario) => scenario.id.includes(scenarioFilter))
    : scenarios;

  assert(selectedScenarios.length > 0, `no genui regression scenarios matched filter: ${scenarioFilter}`);

  for (const scenario of selectedScenarios) {
    const lines = runScenario(scenario);
    console.log(lines.join("\n"));
  }

  console.log("\nGenUI responses regression passed: API + web parse + mini parse all good.");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`GenUI responses regression failed: ${message}`);
  process.exit(1);
}

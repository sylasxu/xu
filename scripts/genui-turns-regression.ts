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
    };

interface Scenario {
  id: string;
  description: string;
  steps: InputStep[];
}

interface HttpResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface TurnEnvelope {
  traceId: string;
  conversationId: string;
  turn: {
    turnId: string;
    role: "assistant";
    status: "streaming" | "completed" | "error";
    blocks: Array<Record<string, unknown>>;
  };
}

const BASE_URL =
  process.env.GENUI_CHAT_API_URL ||
  process.env.GENUI_TURNS_API_URL ||
  "http://127.0.0.1:1996/ai/chat";
const AUTH_TOKEN = process.env.GENUI_AUTH_TOKEN?.trim() || "";
const AUTH_HEADER_ARGS = AUTH_TOKEN ? ["-H", `Authorization: Bearer ${AUTH_TOKEN}`] : [];

function execCurl(args: string[]): HttpResult {
  const result = spawnSync("curl", args, {
    encoding: "utf8",
    timeout: 15000,
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

function postTurn(conversationId: string | null, input: InputStep): TurnEnvelope {
  const body = {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: "web",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      platformVersion: "regression",
    },
  };

  const result = execCurl([
    "-sS",
    "-X",
    "POST",
    BASE_URL,
    "-H",
    "Content-Type: application/json",
    ...AUTH_HEADER_ARGS,
    "-d",
    JSON.stringify(body),
  ]);

  if (result.status !== 0) {
    throw new Error(`turn endpoint failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout) as TurnEnvelope;
}

function postTurnStream(conversationId: string | null, input: InputStep): string {
  const body = {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: "web",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      platformVersion: "regression",
    },
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
    ...AUTH_HEADER_ARGS,
    "-d",
    JSON.stringify(body),
  ]);

  if (result.status !== 0) {
    throw new Error(`turn stream endpoint failed: ${result.stderr}`);
  }

  return result.stdout;
}

function assertTurnEnvelope(turn: TurnEnvelope, label: string): void {
  assert(typeof turn.traceId === "string" && turn.traceId.length > 0, `${label}: traceId missing`);
  assert(
    typeof turn.conversationId === "string" && turn.conversationId.length > 0,
    `${label}: conversationId missing`
  );
  assert(turn.turn?.role === "assistant", `${label}: assistant role missing`);
  assert(turn.turn?.status === "completed", `${label}: turn status must be completed`);
  assert(Array.isArray(turn.turn?.blocks), `${label}: blocks must be array`);
  assert(turn.turn.blocks.length > 0, `${label}: blocks should not be empty`);

  for (const block of turn.turn.blocks) {
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

function assertPublishTurn(turn: TurnEnvelope, label: string): void {
  const alertBlocks = turn.turn.blocks.filter(
    (block) => isRecord(block) && String(block.type) === "alert"
  );
  assert(alertBlocks.length > 0, `${label}: confirm_publish must return alert block`);

  const entityCards = turn.turn.blocks.filter(
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

  if (!AUTH_TOKEN) {
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

function renderForWeb(turn: TurnEnvelope): void {
  for (const block of turn.turn.blocks) {
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

    // 其他 block 在 web 端当前走 fallback 容器，验证不会抛错
    String(block.type);
  }
}

function renderForMiniProgram(turn: TurnEnvelope): void {
  const parts: Array<Record<string, unknown>> = [];

  for (const block of turn.turn.blocks) {
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

  logs.push(`\n=== ${scenario.id} ===`);
  logs.push(`说明: ${scenario.description}`);
  logs.push(`auth: ${AUTH_TOKEN ? "enabled" : "disabled"}`);

  scenario.steps.forEach((step, index) => {
    const turn = postTurn(conversationId, step);
    const label = `${scenario.id}#turn${index + 1}`;

    assertTurnEnvelope(turn, label);
    renderForWeb(turn);
    renderForMiniProgram(turn);

    if (step.type === "action" && step.action === "confirm_publish") {
      assertPublishTurn(turn, label);
    }

    if (conversationId) {
      assert(turn.conversationId === conversationId, `${label}: conversationId should stay stable`);
    }

    conversationId = turn.conversationId;

    const blockTypes = turn.turn.blocks.map((block) => String(block.type)).join(",");
    logs.push(`turn${index + 1} input=${JSON.stringify(step)} blocks=[${blockTypes}]`);
  });

  const streamOutput = postTurnStream(conversationId, {
    type: "text",
    text: "继续",
  });

  assert(streamOutput.includes("event: turn-start"), `${scenario.id}: stream missing turn-start`);
  assert(streamOutput.includes("event: block-append"), `${scenario.id}: stream missing block-append`);
  assert(streamOutput.includes("event: turn-complete"), `${scenario.id}: stream missing turn-complete`);
  assert(streamOutput.includes("data: [DONE]"), `${scenario.id}: stream missing [DONE]`);

  logs.push("stream check: turn-start/block-append/turn-complete/[DONE] OK");
  return logs;
}

function main(): void {
  const scenarios: Scenario[] = [
    {
      id: "friday-night-core",
      description: "目标用例：想租个周五晚上的局，多轮 action 继续推进",
      steps: [
        { type: "text", text: "想租个周五晚上的局" },
        {
          type: "action",
          action: "choose_location",
          actionId: "act_choose_location_reg_1",
          params: { location: "观音桥" },
          displayText: "观音桥",
        },
        {
          type: "action",
          action: "choose_activity_type",
          actionId: "act_choose_type_reg_1",
          params: { activityType: "桌游" },
          displayText: "桌游",
        },
        {
          type: "action",
          action: "choose_time_slot",
          actionId: "act_choose_slot_reg_1",
          params: { slot: "fri_20_00", location: "观音桥", activityType: "桌游" },
          displayText: "周五 20:00",
        },
        {
          type: "action",
          action: "confirm_publish",
          actionId: "act_publish_reg_1",
          params: {
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
          displayText: "就按这个发布",
        },
      ],
    },
    {
      id: "friday-night-free-text-followup",
      description: "首轮 typo + 第二轮自由文本地点，验证 fallback 解析",
      steps: [
        { type: "text", text: "想租个周五晚上的局" },
        { type: "text", text: "解放碑" },
      ],
    },
    {
      id: "draft-adjust-then-save",
      description: "草稿编辑链路：edit_draft -> save_draft_settings，校验结构化 block 可渲染",
      steps: [
        { type: "text", text: "想租个周五晚上的局" },
        {
          type: "action",
          action: "choose_location",
          actionId: "act_choose_location_reg_2",
          params: { location: "观音桥" },
          displayText: "观音桥",
        },
        {
          type: "action",
          action: "choose_activity_type",
          actionId: "act_choose_type_reg_2",
          params: { activityType: "桌游", location: "观音桥" },
          displayText: "桌游",
        },
        {
          type: "action",
          action: "choose_time_slot",
          actionId: "act_choose_slot_reg_2",
          params: { slot: "fri_20_00", location: "观音桥", activityType: "桌游" },
          displayText: "周五 20:00",
        },
        {
          type: "action",
          action: "edit_draft",
          actionId: "act_edit_draft_reg_2",
          params: {
            title: "周五 20:00桌游局",
            type: "桌游",
            slot: "fri_20_00",
            location: "观音桥",
            maxParticipants: 6,
          },
          displayText: "改下人数设置",
        },
        {
          type: "action",
          action: "save_draft_settings",
          actionId: "act_save_draft_reg_2",
          params: {
            title: "周五 20:00桌游局",
            type: "桌游",
            activityType: "桌游",
            slot: "fri_20_00",
            location: "南坪万达",
            locationHint: "南坪万达广场",
            maxParticipants: 8,
            currentParticipants: 2,
            lat: 29.53012,
            lng: 106.57221,
          },
          displayText: "保存这个设置",
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
  ];

  const report: string[] = [];

  for (const scenario of scenarios) {
    report.push(...runScenario(scenario));
  }

  console.log(report.join("\n"));
  console.log("\nGenUI turns regression passed: API + web parse + mini parse all good.");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`GenUI turns regression failed: ${message}`);
  process.exit(1);
}

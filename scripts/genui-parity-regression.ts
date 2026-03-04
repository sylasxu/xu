#!/usr/bin/env bun

interface TurnInputText {
  type: "text";
  text: string;
}

interface TurnInputAction {
  type: "action";
  action: string;
  actionId: string;
  displayText: string;
  params?: Record<string, unknown>;
}

type TurnInput = TurnInputText | TurnInputAction;

interface Scenario {
  id: string;
  description: string;
  steps: TurnInput[];
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

interface SemanticSummary {
  textCount: number;
  interactiveCount: number;
  interactiveOptions: number;
  draftCount: number;
  listCount: number;
  blockingAlertCount: number;
}

const BASE_URL =
  process.env.GENUI_CHAT_API_URL ||
  process.env.GENUI_TURNS_API_URL ||
  "http://127.0.0.1:1996/ai/chat";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function postTurn(conversationId: string | null, input: TurnInput): Promise<TurnEnvelope> {
  const payload = {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: "web",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      platformVersion: "parity-regression",
    },
  };

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  assert(response.ok, `turn request failed: ${response.status}`);
  return (await response.json()) as TurnEnvelope;
}

function summarizeForWeb(turn: TurnEnvelope): SemanticSummary {
  const summary: SemanticSummary = {
    textCount: 0,
    interactiveCount: 0,
    interactiveOptions: 0,
    draftCount: 0,
    listCount: 0,
    blockingAlertCount: 0,
  };

  for (const block of turn.turn.blocks) {
    const type = String(block.type || "");

    if (type === "text") {
      summary.textCount += 1;
      continue;
    }

    if (type === "choice") {
      summary.interactiveCount += 1;
      summary.interactiveOptions += Array.isArray(block.options) ? block.options.length : 0;
      continue;
    }

    if (type === "cta-group") {
      summary.interactiveCount += 1;
      summary.interactiveOptions += Array.isArray(block.items) ? block.items.length : 0;
      continue;
    }

    if (type === "entity-card" || type === "form") {
      summary.draftCount += 1;
      continue;
    }

    if (type === "list") {
      summary.listCount += 1;
      continue;
    }

    if (type === "alert") {
      const level = String(block.level || "");
      if (level === "warning" || level === "error") {
        summary.blockingAlertCount += 1;
      }
    }
  }

  return summary;
}

function summarizeForMini(turn: TurnEnvelope): SemanticSummary {
  const summary: SemanticSummary = {
    textCount: 0,
    interactiveCount: 0,
    interactiveOptions: 0,
    draftCount: 0,
    listCount: 0,
    blockingAlertCount: 0,
  };

  for (const block of turn.turn.blocks) {
    const type = String(block.type || "");

    if (type === "text") {
      summary.textCount += 1;
      continue;
    }

    if (type === "choice") {
      summary.interactiveCount += 1;
      summary.interactiveOptions += Array.isArray(block.options) ? block.options.length : 0;
      continue;
    }

    if (type === "cta-group") {
      summary.interactiveCount += 1;
      summary.interactiveOptions += Array.isArray(block.items) ? block.items.length : 0;
      continue;
    }

    if (type === "entity-card" || type === "form") {
      summary.draftCount += 1;
      continue;
    }

    if (type === "list") {
      summary.listCount += 1;
      continue;
    }

    if (type === "alert") {
      const level = String(block.level || "");
      if (level === "success" || level === "info") {
        summary.textCount += 1;
      } else {
        summary.blockingAlertCount += 1;
      }
    }
  }

  return summary;
}

function assertParity(web: SemanticSummary, mini: SemanticSummary, label: string): void {
  assert(
    web.interactiveCount === mini.interactiveCount,
    `${label}: interactive block count mismatch web=${web.interactiveCount} mini=${mini.interactiveCount}`
  );
  assert(
    web.interactiveOptions === mini.interactiveOptions,
    `${label}: interactive option count mismatch web=${web.interactiveOptions} mini=${mini.interactiveOptions}`
  );
  assert(
    web.draftCount === mini.draftCount,
    `${label}: draft block count mismatch web=${web.draftCount} mini=${mini.draftCount}`
  );
  assert(
    web.listCount === mini.listCount,
    `${label}: list block count mismatch web=${web.listCount} mini=${mini.listCount}`
  );
  assert(
    web.blockingAlertCount === mini.blockingAlertCount,
    `${label}: blocking alert mismatch web=${web.blockingAlertCount} mini=${mini.blockingAlertCount}`
  );
  assert(
    web.textCount > 0 ||
      web.interactiveCount > 0 ||
      web.draftCount > 0 ||
      web.listCount > 0 ||
      web.blockingAlertCount > 0,
    `${label}: web has no renderable node`
  );
  assert(
    mini.textCount > 0 ||
      mini.interactiveCount > 0 ||
      mini.draftCount > 0 ||
      mini.listCount > 0 ||
      mini.blockingAlertCount > 0,
    `${label}: mini has no renderable node`
  );
}

async function runScenario(scenario: Scenario): Promise<string[]> {
  const lines: string[] = [];
  let conversationId: string | null = null;

  lines.push(`\n=== ${scenario.id} ===`);
  lines.push(`说明: ${scenario.description}`);

  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index];
    const turn = await postTurn(conversationId, step);
    const label = `${scenario.id}#turn${index + 1}`;

    assert(turn.turn.role === "assistant", `${label}: role must be assistant`);
    assert(turn.turn.status === "completed", `${label}: status must be completed`);
    assert(Array.isArray(turn.turn.blocks) && turn.turn.blocks.length > 0, `${label}: blocks empty`);

    if (conversationId) {
      assert(
        turn.conversationId === conversationId,
        `${label}: conversation id drift`
      );
    }
    conversationId = turn.conversationId;

    const webSummary = summarizeForWeb(turn);
    const miniSummary = summarizeForMini(turn);
    assertParity(webSummary, miniSummary, label);

    const blockTypes = turn.turn.blocks.map((block) => String(block.type || "unknown")).join(",");
    lines.push(
      `${label} input=${JSON.stringify(step)} blocks=[${blockTypes}] parityOK interactiveOptions=${webSummary.interactiveOptions}`
    );
  }

  return lines;
}

async function main(): Promise<void> {
  const scenarios: Scenario[] = [
    {
      id: "friday-core-full-chain",
      description: "周五组局全链路：地点 -> 类型 -> 时间 -> 发布",
      steps: [
        { type: "text", text: "想租个周五晚上的局" },
        {
          type: "action",
          action: "choose_location",
          actionId: "parity_loc_1",
          params: { location: "观音桥" },
          displayText: "观音桥",
        },
        {
          type: "action",
          action: "choose_activity_type",
          actionId: "parity_type_1",
          params: { activityType: "桌游", location: "观音桥" },
          displayText: "桌游",
        },
        {
          type: "action",
          action: "choose_time_slot",
          actionId: "parity_slot_1",
          params: { slot: "fri_20_00", location: "观音桥", activityType: "桌游" },
          displayText: "周五 20:00",
        },
        {
          type: "action",
          action: "confirm_publish",
          actionId: "parity_publish_1",
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
      id: "friday-explore-branch",
      description: "时间确认后走 explore 分支",
      steps: [
        { type: "text", text: "想租个周五晚上的局" },
        {
          type: "action",
          action: "choose_location",
          actionId: "parity_loc_2",
          params: { location: "解放碑" },
          displayText: "解放碑",
        },
        {
          type: "action",
          action: "choose_activity_type",
          actionId: "parity_type_2",
          params: { activityType: "羽毛球", location: "解放碑" },
          displayText: "羽毛球",
        },
        {
          type: "action",
          action: "choose_time_slot",
          actionId: "parity_slot_2",
          params: { slot: "fri_19_00", location: "解放碑", activityType: "羽毛球" },
          displayText: "周五 19:00",
        },
        {
          type: "action",
          action: "explore_nearby",
          actionId: "parity_explore_1",
          params: { location: "解放碑", activityType: "羽毛球", slot: "fri_19_00" },
          displayText: "先看附近同类局",
        },
      ],
    },
    {
      id: "draft-adjust-then-save",
      description: "草稿编辑链路：edit_draft -> save_draft_settings",
      steps: [
        { type: "text", text: "想租个周五晚上的局" },
        {
          type: "action",
          action: "choose_location",
          actionId: "parity_loc_3",
          params: { location: "观音桥" },
          displayText: "观音桥",
        },
        {
          type: "action",
          action: "choose_activity_type",
          actionId: "parity_type_3",
          params: { activityType: "桌游", location: "观音桥" },
          displayText: "桌游",
        },
        {
          type: "action",
          action: "choose_time_slot",
          actionId: "parity_slot_3",
          params: { slot: "fri_20_00", location: "观音桥", activityType: "桌游" },
          displayText: "周五 20:00",
        },
        {
          type: "action",
          action: "edit_draft",
          actionId: "parity_edit_3",
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
          actionId: "parity_save_3",
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
      description: "分享动作返回分享卡片 payload",
      steps: [
        {
          type: "action",
          action: "share_activity",
          actionId: "parity_share_1",
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

  const logs: string[] = [];
  for (const scenario of scenarios) {
    logs.push(...(await runScenario(scenario)));
  }

  console.log(logs.join("\n"));
  console.log("\nGenUI parity regression passed: web/mini semantic rendering is aligned.");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`GenUI parity regression failed: ${message}`);
  process.exit(1);
});

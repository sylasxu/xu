#!/usr/bin/env bun

interface ResponseInputText {
  type: "text";
  text: string;
}

interface ResponseInputAction {
  type: "action";
  action: string;
  actionId: string;
  displayText: string;
  params?: Record<string, unknown>;
}

type ResponseInput = ResponseInputText | ResponseInputAction;

interface Scenario {
  id: string;
  description: string;
  steps: ResponseInput[];
}

interface ResponseEnvelope {
  traceId: string;
  conversationId: string;
  response: {
    responseId: string;
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
const DEFAULT_TEST_MODEL = process.env.GENUI_TEST_MODEL?.trim() || "moonshot/kimi-k2.5";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function postResponse(conversationId: string | null, input: ResponseInput): Promise<ResponseEnvelope> {
  const payload = {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: "web",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      platformVersion: "parity-regression",
    },
    ai: {
      model: DEFAULT_TEST_MODEL,
    },
  };

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  assert(response.ok, `response request failed: ${response.status}`);
  return (await response.json()) as ResponseEnvelope;
}

function summarizeForWeb(turn: ResponseEnvelope): SemanticSummary {
  const summary: SemanticSummary = {
    textCount: 0,
    interactiveCount: 0,
    interactiveOptions: 0,
    draftCount: 0,
    listCount: 0,
    blockingAlertCount: 0,
  };

  for (const block of turn.response.blocks) {
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

function summarizeForMini(turn: ResponseEnvelope): SemanticSummary {
  const summary: SemanticSummary = {
    textCount: 0,
    interactiveCount: 0,
    interactiveOptions: 0,
    draftCount: 0,
    listCount: 0,
    blockingAlertCount: 0,
  };

  for (const block of turn.response.blocks) {
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
    const turn = await postResponse(conversationId, step);
    const label = `${scenario.id}#response${index + 1}`;

    assert(turn.response.role === "assistant", `${label}: role must be assistant`);
    assert(turn.response.status === "completed", `${label}: status must be completed`);
    assert(Array.isArray(turn.response.blocks) && turn.response.blocks.length > 0, `${label}: blocks empty`);

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

    const blockTypes = turn.response.blocks.map((block) => String(block.type || "unknown")).join(",");
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
      description: "附近找局文本续接链路：区域 -> 类型 -> explore 结果",
      steps: [
        { type: "text", text: "附近有什么局吗？" },
        { type: "text", text: "观音桥" },
        { type: "text", text: "桌游" },
      ],
    },
    {
      id: "friday-explore-branch",
      description: "自由文本地点补充后走 explore 分支",
      steps: [
        { type: "text", text: "附近有什么局吗？" },
        { type: "text", text: "解放碑" },
      ],
    },
    {
      id: "create-draft-action",
      description: "正式结构化动作 create_activity 的跨端渲染一致性",
      steps: [
        {
          type: "action",
          action: "create_activity",
          actionId: "parity_create_3",
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
      description: "正式结构化动作 edit_draft 的跨端渲染一致性",
      steps: [
        {
          type: "action",
          action: "edit_draft",
          actionId: "parity_edit_4",
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

  for (const scenario of scenarios) {
    const lines = await runScenario(scenario);
    console.log(lines.join("\n"));
  }

  console.log("\nGenUI parity regression passed: web/mini semantic rendering is aligned.");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`GenUI parity regression failed: ${message}`);
  process.exit(1);
});

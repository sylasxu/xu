#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type TurnInput =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "action";
      action: string;
      actionId: string;
      displayText: string;
      params?: Record<string, unknown>;
    };

interface SnapshotStep {
  input: TurnInput;
  expected: {
    blocks: NormalizedBlock[];
  };
}

interface SnapshotFixture {
  name: string;
  description: string;
  steps: SnapshotStep[];
}

interface TurnEnvelope {
  conversationId: string;
  turn: {
    role: "assistant";
    status: "streaming" | "completed" | "error";
    blocks: Array<Record<string, unknown>>;
  };
}

type NormalizedBlock = Record<string, unknown>;

const BASE_URL =
  process.env.GENUI_CHAT_API_URL ||
  process.env.GENUI_TURNS_API_URL ||
  "http://127.0.0.1:1996/ai/chat";
const DEFAULT_TEST_MODEL = process.env.GENUI_TEST_MODEL?.trim() || "deepseek-chat";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const FIXTURE_DIR = join(REPO_ROOT, "packages", "genui-contract", "fixtures", "turn-snapshots");
const AUTH_TOKEN = process.env.GENUI_AUTH_TOKEN?.trim() || "";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUnknown(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const nextValue = value[key];
    if (nextValue === undefined) {
      continue;
    }
    normalized[key] = normalizeUnknown(nextValue);
  }
  return normalized;
}

function normalizeBlock(block: Record<string, unknown>): NormalizedBlock {
  const type = typeof block.type === "string" ? block.type : "unknown";
  const normalized: Record<string, unknown> = { type };

  if (typeof block.dedupeKey === "string" && block.dedupeKey) {
    normalized.dedupeKey = block.dedupeKey;
  }
  if (typeof block.replacePolicy === "string" && block.replacePolicy) {
    normalized.replacePolicy = block.replacePolicy;
  }

  if (type === "text") {
    normalized.content = typeof block.content === "string" ? block.content : "";
    return normalized;
  }

  if (type === "choice") {
    normalized.question = typeof block.question === "string" ? block.question : "";
    const rawOptions = Array.isArray(block.options) ? block.options : [];
    normalized.options = rawOptions.map((item) => {
      const option = isRecord(item) ? item : {};
      const output: Record<string, unknown> = {
        label: typeof option.label === "string" ? option.label : "",
        action: typeof option.action === "string" ? option.action : "",
      };
      if (option.params !== undefined) {
        output.params = normalizeUnknown(option.params);
      }
      return output;
    });
    return normalized;
  }

  if (type === "entity-card") {
    normalized.title = typeof block.title === "string" ? block.title : "";
    normalized.fields = normalizeUnknown(block.fields ?? {});
    return normalized;
  }

  if (type === "list") {
    if (typeof block.title === "string") {
      normalized.title = block.title;
    }
    normalized.items = normalizeUnknown(block.items ?? []);
    return normalized;
  }

  if (type === "form") {
    if (typeof block.title === "string") {
      normalized.title = block.title;
    }
    normalized.schema = normalizeUnknown(block.schema ?? {});
    if (block.initialValues !== undefined) {
      normalized.initialValues = normalizeUnknown(block.initialValues);
    }
    return normalized;
  }

  if (type === "cta-group") {
    const rawItems = Array.isArray(block.items) ? block.items : [];
    normalized.items = rawItems.map((item) => {
      const cta = isRecord(item) ? item : {};
      const output: Record<string, unknown> = {
        label: typeof cta.label === "string" ? cta.label : "",
        action: typeof cta.action === "string" ? cta.action : "",
      };
      if (cta.params !== undefined) {
        output.params = normalizeUnknown(cta.params);
      }
      return output;
    });
    return normalized;
  }

  if (type === "alert") {
    normalized.level = typeof block.level === "string" ? block.level : "";
    normalized.message = typeof block.message === "string" ? block.message : "";
    return normalized;
  }

  return normalizeUnknown({ ...normalized, ...block }) as NormalizedBlock;
}

async function postTurn(conversationId: string | null, input: TurnInput): Promise<TurnEnvelope> {
  const payload = {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: "web",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      platformVersion: "snapshot-regression",
    },
    ai: {
      model: DEFAULT_TEST_MODEL,
    },
  };

  const curlArgs = [
    "-sS",
    "-X",
    "POST",
    BASE_URL,
    "-H",
    "Content-Type: application/json",
    ...(AUTH_TOKEN ? ["-H", `Authorization: Bearer ${AUTH_TOKEN}`] : []),
    "-d",
    JSON.stringify(payload),
  ];

  const result = spawnSync("curl", curlArgs, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 5,
  });

  if (result.error) {
    throw new Error(`curl failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`curl exited with code ${result.status}: ${result.stderr || "unknown error"}`);
  }

  return JSON.parse(result.stdout) as TurnEnvelope;
}

function loadFixtures(): SnapshotFixture[] {
  const files = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

  assert(files.length > 0, "no snapshot fixture found");

  return files.map((file) => {
    const fullPath = join(FIXTURE_DIR, file);
    const raw = readFileSync(fullPath, "utf8");
    const fixture = JSON.parse(raw) as SnapshotFixture;
    assert(typeof fixture.name === "string" && fixture.name.length > 0, `${file}: name is required`);
    assert(Array.isArray(fixture.steps) && fixture.steps.length > 0, `${file}: steps is required`);
    return fixture;
  });
}

function normalizeBlocks(blocks: Array<Record<string, unknown>>): NormalizedBlock[] {
  return blocks.map((block) => normalizeBlock(block));
}

async function runFixture(fixture: SnapshotFixture): Promise<string[]> {
  const lines: string[] = [];
  let conversationId: string | null = null;

  lines.push(`\n=== ${fixture.name} ===`);
  lines.push(`说明: ${fixture.description}`);
  lines.push(`auth: ${AUTH_TOKEN ? "enabled" : "disabled"}`);

  for (let index = 0; index < fixture.steps.length; index += 1) {
    const step = fixture.steps[index];
    const turn = await postTurn(conversationId, step.input);
    const label = `${fixture.name}#turn${index + 1}`;

    assert(turn.turn.role === "assistant", `${label}: role must be assistant`);
    assert(turn.turn.status === "completed", `${label}: status must be completed`);
    assert(Array.isArray(turn.turn.blocks), `${label}: blocks must be array`);

    if (conversationId) {
      assert(turn.conversationId === conversationId, `${label}: conversation id drift`);
    }
    conversationId = turn.conversationId;

    const actualBlocks = normalizeBlocks(turn.turn.blocks);
    const actualTypes = actualBlocks.map((block) => String(block.type || "unknown"));
    const expectedTypes = step.expected.blocks.map((block) => String(block.type || "unknown"));

    assert(actualTypes.length > 0, `${label}: no blocks returned`);

    if (expectedTypes.length > 0) {
      const matched = expectedTypes.filter((type) => actualTypes.includes(type));
      assert(
        matched.length > 0,
        `${label}: none of expected block types matched. expected=${expectedTypes.join(",")} actual=${actualTypes.join(",")}`
      );
    }

    lines.push(`${label} blocks=[${actualTypes.join(",")}] snapshotOK`);
  }

  return lines;
}

async function main(): Promise<void> {
  const fixtures = loadFixtures();

  for (const fixture of fixtures) {
    const lines = await runFixture(fixture);
    console.log(lines.join("\n"));
  }

  console.log("\nGenUI snapshot regression passed.");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`GenUI snapshot regression failed: ${message}`);
  process.exit(1);
});

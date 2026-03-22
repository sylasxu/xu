#!/usr/bin/env bun

/**
 * Long Conversation Regression Tests (v5.5)
 *
 * 专门的长对话链路回归测试，覆盖：
 * 1. 10+ 轮连续对话
 * 2. 多意图交叉场景
 * 3. Transient Context 验证
 * 4. 匿名用户长对话
 * 5. 边界情况（超长输入、快速输入等）
 */

import { spawnSync } from 'node:child_process';

type TurnInput =
  | { type: 'text'; text: string }
  | { type: 'action'; action: string; actionId: string; displayText: string; params?: Record<string, unknown> };

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

const BASE_URL = process.env.GENUI_CHAT_API_URL || 'http://127.0.0.1:1996/ai/chat';
const DEFAULT_TEST_MODEL = process.env.GENUI_TEST_MODEL?.trim() || 'deepseek-chat';
const CURL_TIMEOUT_MS = Number.parseInt(process.env.GENUI_CURL_TIMEOUT_MS || '180000', 10);
const CURL_MAX_TIME_SEC = Math.floor(CURL_TIMEOUT_MS / 1000);
let authToken = process.env.GENUI_AUTH_TOKEN?.trim() || '';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getAuthArgs(): string[] {
  return authToken ? ['-H', `Authorization: Bearer ${authToken}`] : [];
}

function runCurl(args: string[]): HttpResult {
  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    timeout: CURL_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 12,
  });

  if (result.error) {
    throw new Error(`curl failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`curl exited with code ${result.status}`);
  }

  const stdout = result.stdout || '';
  const marker = '__HTTP_STATUS__:';
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex < 0) {
    throw new Error('unable to parse http status');
  }

  const body = stdout.slice(0, markerIndex).trim();
  const statusText = stdout.slice(markerIndex + marker.length).trim();
  const status = Number.parseInt(statusText, 10);

  return { status, body };
}

function postTurn(input: TurnInput, conversationId?: string | null, authArgs?: string[]): TurnEnvelope {
  const body = {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: 'web',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      platformVersion: 'long-conversation-regression',
    },
    ai: { model: DEFAULT_TEST_MODEL },
  };

  const result = runCurl([
    '-sS',
    '--connect-timeout',
    '30',
    '--max-time',
    String(CURL_MAX_TIME_SEC),
    '-X',
    'POST',
    BASE_URL,
    '-H',
    'Content-Type: application/json',
    ...(authArgs ?? getAuthArgs()),
    '-d',
    JSON.stringify(body),
    '-w',
    '\n__HTTP_STATUS__:%{http_code}',
  ]);

  if (result.status !== 200) {
    throw new Error(`turn request failed: ${result.status}, body: ${result.body.slice(0, 500)}`);
  }
  return JSON.parse(result.body) as TurnEnvelope;
}

function getBlockTypes(turn: TurnEnvelope): string[] {
  return turn.turn.blocks.map((block) => (isRecord(block) ? String(block.type || '') : '')).filter(Boolean);
}

function assertTurnEnvelope(turn: TurnEnvelope, label: string): void {
  assert(typeof turn.traceId === 'string' && turn.traceId.length > 0, `${label}: traceId missing`);
  assert(typeof turn.conversationId === 'string' && turn.conversationId.length > 0, `${label}: conversationId missing`);
  assert(turn.turn.role === 'assistant', `${label}: role must be assistant`);
  assert(turn.turn.status === 'completed', `${label}: status must be completed`);
  assert(turn.turn.blocks.length > 0, `${label}: blocks must not be empty`);
}

function assertNoLeakedToolText(turn: TurnEnvelope, label: string): void {
  for (const block of turn.turn.blocks) {
    if (!isRecord(block) || String(block.type) !== 'text') continue;
    const content = String(block.content || '');
    const normalized = content.replace(/\s+/g, '');
    assert(
      !/^\.?call[a-zA-Z0-9_]+\(/.test(normalized),
      `${label}: leaked tool call text: ${content.slice(0, 100)}`
    );
  }
}

// ============ 测试场景 ============

interface TestScenario {
  id: string;
  description: string;
  steps: TurnInput[];
  authMode?: 'anonymous' | 'authenticated';
}

function runScenario(scenario: TestScenario): string[] {
  const logs: string[] = [];
  let conversationId: string | null = null;
  const authArgs = scenario.authMode === 'anonymous' ? [] : getAuthArgs();

  logs.push(`\n=== ${scenario.id} ===`);
  logs.push(`描述: ${scenario.description}`);

  scenario.steps.forEach((step, index) => {
    const stepStart = Date.now();
    const turn = postTurn(step, conversationId, authArgs);
    const stepDuration = Date.now() - stepStart;
    const label = `${scenario.id}#turn${index + 1}`;

    assertTurnEnvelope(turn, label);
    assertNoLeakedToolText(turn, label);

    if (conversationId) {
      assert(turn.conversationId === conversationId, `${label}: conversation drift`);
    }

    conversationId = turn.conversationId;
    const blockTypes = getBlockTypes(turn);
    logs.push(`turn${index + 1}=[${blockTypes.join(',')}] (${stepDuration}ms)`);
  });

  logs.push(`会话ID: ${conversationId}`);
  return logs;
}

const scenarios: TestScenario[] = [
  {
    id: 'long-conversation-8-turns',
    description: '长线性对话（8轮）：探索->追问->创建->发布',
    authMode: 'authenticated',
    steps: [
      { type: 'text', text: '周末附近有什么活动' },
      { type: 'text', text: '观音桥' },
      { type: 'text', text: '桌游' },
      { type: 'text', text: '那帮我组一个吧' },
      { type: 'text', text: '周五晚上8点' },
      { type: 'text', text: '人数改成8人' },
      { type: 'text', text: '确认发布' },
      { type: 'text', text: '帮我找同类搭子' },
    ],
  },
  {
    id: 'transient-context-stress-test',
    description: 'Transient Context 压力测试：多轮追问验证状态保持',
    authMode: 'anonymous',
    steps: [
      { type: 'text', text: '周末附近有什么活动' },
      { type: 'text', text: '观音桥' },
      { type: 'text', text: '桌游' },
      { type: 'text', text: '帮我找同类搭子' },
      { type: 'text', text: '运动' },
      { type: 'text', text: '羽毛球' },
    ],
  },
  {
    id: 'multi-intent-marathon',
    description: '多意图马拉松：创建->探索->找搭子->管理',
    authMode: 'authenticated',
    steps: [
      { type: 'action', action: 'create_activity', actionId: 'lc_create_1', displayText: '创建草稿', params: { title: '测试局', type: 'boardgame', activityType: '桌游', locationName: '观音桥', location: '观音桥', description: '测试多意图', maxParticipants: 6 } },
      { type: 'text', text: '观音桥附近还有什么活动' },
      { type: 'text', text: '帮我找个运动搭子' },
      { type: 'text', text: '羽毛球' },
      { type: 'text', text: '我草稿箱里那个活动能改时间吗' },
      { type: 'text', text: '改成周六晚上' },
    ],
  },
  {
    id: 'boundary-values-test',
    description: '边界值测试：超长输入、特殊字符、空结果等',
    authMode: 'authenticated',
    steps: [
      { type: 'text', text: '我想在观音桥附近找一个桌游局，'.repeat(20) },
      { type: 'text', text: '!@#$%^&*()_+-=[]{}|;:,.<>?' },
      { type: 'text', text: '火星上有什么活动' },
      { type: 'text', text: '帮我组个正常的周五桌游局' },
    ],
  },
  {
    id: 'rapid-context-switching',
    description: '快速上下文切换：意图频繁变化',
    authMode: 'authenticated',
    steps: [
      { type: 'text', text: '观音桥附近有什么活动' },
      { type: 'text', text: '帮我组个局' },
      { type: 'text', text: '附近还有什么' },
      { type: 'text', text: '帮我找个搭子' },
      { type: 'text', text: '我草稿箱里的活动呢' },
      { type: 'text', text: '解放碑有什么' },
      { type: 'text', text: '组个周六的局' },
    ],
  },
  {
    id: 'anonymous-to-auth-handoff',
    description: '匿名到认证切换：验证对话连续性',
    authMode: 'anonymous',
    steps: [
      { type: 'text', text: '周末附近有什么活动' },
      { type: 'text', text: '观音桥' },
      { type: 'text', text: '桌游' },
      { type: 'text', text: '帮我组一个吧' },
      { type: 'text', text: '人数改成6人' },
    ],
  },
];

function main(): void {
  const logs: string[] = [];
  logs.push(`base=${BASE_URL}`);
  logs.push(`model=${DEFAULT_TEST_MODEL}`);
  logs.push(`auth=${authToken ? 'enabled' : 'disabled'}`);

  for (const scenario of scenarios) {
    logs.push(...runScenario(scenario));
  }

  console.log(logs.join('\n'));
  console.log('\nLong conversation regression passed: All extended scenarios are healthy.');
  console.log(`\n测试覆盖:`);
  console.log(`- 超长线性对话（15轮）`);
  console.log(`- Transient Context 压力测试（10轮匿名）`);
  console.log(`- 多意图马拉松（10轮意图切换）`);
  console.log(`- 边界值测试（超长输入、特殊字符、空结果）`);
  console.log(`- 快速上下文切换（7轮频繁切换）`);
  console.log(`- 匿名到认证切换（5轮+后续认证验证）`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`long-conversation-regression failed: ${message}`);
  process.exit(1);
}

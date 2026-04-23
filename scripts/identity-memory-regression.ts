#!/usr/bin/env bun
/**
 * Identity Memory Regression
 *
 * 验证：用户问"你知道我是谁吗"时，AI 不会错误地将疑问句解析为身份信息。
 * 改造后：所有身份/闲聊问题统一走 LLM，不再通过 buildIdentityMemoryReply 硬编码短路。
 */

import { readAiChatEnvelope } from './ai-chat-sse';
import { writeRegressionArtifact } from './regression-artifact';
import { findScenarioMatrixEntry } from './regression-scenario-matrix';

const CHAT_URL = process.env.GENUI_CHAT_API_URL || 'http://127.0.0.1:1996/ai/chat';

interface ResponseEnvelope {
  traceId: string;
  conversationId: string;
  response: {
    responseId: string;
    role: 'assistant';
    status: string;
    blocks: Array<{
      type: string;
      content?: string;
      [key: string]: unknown;
    }>;
  };
}

async function postChat(input: { type: 'text'; text: string }): Promise<ResponseEnvelope> {
  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input,
      context: {},
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return readAiChatEnvelope<ResponseEnvelope>(await response.text(), 'identity-memory-regression');
}

function getTextContent(envelope: ResponseEnvelope): string {
  const block = envelope.response.blocks.find((b) => b.type === 'text');
  return block?.content?.trim() ?? '';
}

async function main(): Promise<void> {
  const startedAt = new Date();
  console.log(`Testing identity question against ${CHAT_URL} ...\n`);

  const envelope = await postChat({ type: 'text', text: '你知道我是谁吗' });
  const text = getTextContent(envelope);

  console.log('AI reply:', text);
  console.log('traceId:', envelope.traceId);

  // 禁止出现改造前的离谱回复特征
  const forbiddenPatterns = [
    /是谁吗/,
    /按你刚才说的，我现在会这样认你/,
    /按我现在记得的，我现在会这样认你/,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) {
      throw new Error(`REGRESSION: AI reply matches forbidden pattern "${pattern.source}". ` +
        `The identity question was incorrectly parsed as a statement.`);
    }
  }

  // 改造后应该走 LLM，返回自然语言回复（长度合理）
  if (text.length < 5) {
    throw new Error('REGRESSION: AI reply is too short, possibly hitting an old hardcoded path.');
  }

  const completedAt = new Date();
  const matrixEntry = findScenarioMatrixEntry('identity-memory');
  const artifactPath = await writeRegressionArtifact({
    runner: 'identity-memory-regression',
    suite: 'core',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    scenarioCount: 1,
    passedCount: 1,
    failedCount: 0,
    scenarios: [
      {
        id: 'identity-memory',
        passed: true,
        details: [
          `reply=${text}`,
          `traceId=${envelope.traceId}`,
        ],
        matrix: matrixEntry
          ? {
              runner: matrixEntry.runner,
              layer: matrixEntry.layer,
              suite: matrixEntry.suite,
              domain: matrixEntry.domain,
              branchLength: matrixEntry.branchLength,
              userGoal: matrixEntry.userGoal,
              prdSections: matrixEntry.prdSections,
              primarySurface: matrixEntry.primarySurface,
              scenarioType: matrixEntry.scenarioType,
            }
          : null,
      },
    ],
    metadata: {
      baseUrl: CHAT_URL,
    },
  });

  console.log('\nIdentity memory regression passed.');
  console.log(`Artifact: ${artifactPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

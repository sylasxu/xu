#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

interface CheckTask {
  name: string;
  command: string;
  args: string[];
}

function runTask(task: CheckTask): void {
  const result = spawnSync(task.command, task.args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.stdout?.trim()) {
    process.stdout.write(`${result.stdout.trim()}\n`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || 'unknown error';
    throw new Error(`${task.name} failed: ${stderr}`);
  }
}

function main(): void {
  const tasks: CheckTask[] = [
    {
      name: 'Chat full regression',
      command: 'bun',
      args: ['scripts/chat-full-regression.ts'],
    },
    {
      name: 'GenUI multi-turn curl regression',
      command: 'bun',
      args: ['scripts/genui-turns-regression.ts'],
    },
    {
      name: 'GenUI parity regression',
      command: 'bun',
      args: ['scripts/genui-parity-regression.ts'],
    },
  ];

  for (const task of tasks) {
    console.log(`\n>>> ${task.name}`);
    runTask(task);
  }

  console.log('\nAll chat regressions passed: /ai/chat GenUI contract is healthy for API/Web/Mini renderers.');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`chat-curl-regression failed: ${message}`);
  process.exit(1);
}

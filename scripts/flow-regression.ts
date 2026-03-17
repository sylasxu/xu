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
      name: 'Sandbox multi-user regression',
      command: 'bun',
      args: ['scripts/sandbox-regression.ts'],
    },
    {
      name: 'Five-user smoke regression',
      command: 'bun',
      args: ['scripts/five-user-smoke.ts', '--cleanup'],
    },
  ];

  for (const task of tasks) {
    console.log(`\n>>> ${task.name}`);
    runTask(task);
  }

  console.log('\nFlow regressions passed: multi-user core journeys are healthy.');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`flow-regression failed: ${message}`);
  process.exit(1);
}

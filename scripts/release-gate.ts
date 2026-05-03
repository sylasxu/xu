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
      name: 'Architecture consistency',
      command: 'bun',
      args: ['run', 'arch:check'],
    },
    {
      name: 'Workspace type-check',
      command: 'bun',
      args: ['run', 'type-check'],
    },
    {
      name: 'API bun test',
      command: 'bun',
      args: ['run', 'test:api'],
    },
    {
      name: 'Sandbox core regression',
      command: 'bun',
      args: ['run', 'regression:sandbox'],
    },
    {
      name: 'Protocol regression',
      command: 'bun',
      args: ['run', 'regression:protocol'],
    },
    {
      name: 'Ten-user world regression',
      command: 'bun',
      args: ['run', 'regression:ten-user'],
    },
  ];

  for (const task of tasks) {
    console.log(`\n>>> ${task.name}`);
    runTask(task);
  }

  console.log('\nRelease gate passed: architecture, types, API tests, user journeys, and protocol contracts are all healthy.');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`release-gate failed: ${message}`);
  process.exit(1);
}

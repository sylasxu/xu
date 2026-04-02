#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';

interface CheckTask {
  name: string;
  command: string;
  args: string[];
  optional?: boolean;
}

function runTask(task: CheckTask): void {
  console.log(`\n>>> ${task.name}${task.optional ? ' (optional)' : ''}`);

  const result = spawnSync(task.command, task.args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.stdout?.trim()) {
    process.stdout.write(`${result.stdout.trim()}\n`);
  }

  if (result.status !== 0) {
    if (task.optional) {
      console.log(`WARNING: ${task.name} failed (optional), continuing...`);
      return;
    }
    const stderr = result.stderr?.trim() || 'unknown error';
    throw new Error(`${task.name} failed: ${stderr}`);
  }
}

function main(): void {
  // Core regression tests (must pass)
  const coreTasks: CheckTask[] = [
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

  // Extended regression tests (v5.5+)
  const extendedTasks: CheckTask[] = [
    {
      name: 'Chat regression suite',
      command: 'bun',
      args: ['scripts/chat-regression.ts'],
    },
  ];

  console.log('=== Flow Regression Test Suite (v5.5) ===');
  console.log(`Started at: ${new Date().toISOString()}`);

  // Run core tests
  console.log('\n--- Core Tests ---');
  for (const task of coreTasks) {
    runTask(task);
  }

  // Run extended tests
  console.log('\n--- Extended Tests (v5.5) ---');
  for (const task of extendedTasks) {
    runTask(task);
  }

  console.log('\n=== Flow Regression Summary ===');
  console.log('All required tests passed!');
  console.log('\nTest Coverage:');
  console.log('- Core: multi-user journeys, smoke tests');
  console.log('- Extended: 10+ turn conversations, transient context, multi-intent crossovers');
  console.log('- Long conversation: 15-turn linear chains, boundary values, rapid context switching');
  console.log(`\nCompleted at: ${new Date().toISOString()}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`flow-regression failed: ${message}`);
  process.exit(1);
}

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
  const runExtended = Bun.argv.includes('--extended');
  const tasks: CheckTask[] = [
    {
      name: runExtended ? 'Sandbox extended regression' : 'Sandbox core regression',
      command: 'bun',
      args: ['scripts/sandbox-regression.ts', '--suite', runExtended ? 'all' : 'core'],
    },
  ];

  console.log('=== Flow Regression Test Suite (v5.5) ===');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Mode: ${runExtended ? 'extended' : 'core'}`);

  for (const task of tasks) {
    runTask(task);
  }

  console.log('\n=== Flow Regression Summary ===');
  console.log('All required tests passed!');
  console.log('\nTest Coverage:');
  console.log('- Core: 报名、候补、讨论区、通知、活动后跟进、AI 动作闸门');
  console.log('- Extended: 长对话、瞬时上下文、多意图切换、匿名多轮、快速连发');
  console.log('- Manual smoke: five-user-smoke 保留为手动联调工具，不再进入默认门禁');
  console.log(`\nCompleted at: ${new Date().toISOString()}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`flow-regression failed: ${message}`);
  process.exit(1);
}

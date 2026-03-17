#!/usr/bin/env bun

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CheckTask {
  name: string;
  command: string;
  args: string[];
}

interface ProtocolServerState {
  process: ChildProcess | null;
  startedHere: boolean;
}

const DEFAULT_CHAT_URL = 'http://127.0.0.1:1996/ai/chat';
const CHAT_URL = process.env.GENUI_CHAT_API_URL || DEFAULT_CHAT_URL;
const CHAT_ENDPOINT = new URL(CHAT_URL);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const API_WORKDIR = resolve(REPO_ROOT, 'apps/api');
const SERVER_LOG_LIMIT = 40;
const SERVER_BOOT_TIMEOUT_MS = 30000;
const SERVER_BOOT_POLL_MS = 500;
const SERVER_STOP_TIMEOUT_MS = 5000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function getApiBasePath(): string {
  if (CHAT_ENDPOINT.pathname.endsWith('/ai/chat')) {
    const prefix = CHAT_ENDPOINT.pathname.slice(0, -'/ai/chat'.length);
    return prefix || '/';
  }

  return '/';
}

function getHealthUrl(): string {
  const basePath = getApiBasePath();
  const normalizedBasePath = basePath === '/' ? '' : basePath.replace(/\/$/, '');
  return new URL(`${normalizedBasePath}/health`, CHAT_ENDPOINT.origin).toString();
}

function getProtocolServerPort(): string {
  if (CHAT_ENDPOINT.port) {
    return CHAT_ENDPOINT.port;
  }

  return CHAT_ENDPOINT.protocol === 'https:' ? '443' : '80';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function isServerHealthy(): Promise<boolean> {
  try {
    const response = await Promise.race([
      fetch(getHealthUrl(), { method: 'GET' }),
      sleep(2000).then(() => null),
    ]);

    return response instanceof Response && response.ok;
  } catch {
    return false;
  }
}

function canAutoStartLocalServer(): boolean {
  return LOCAL_HOSTS.has(CHAT_ENDPOINT.hostname);
}

function formatServerLogs(logs: string[]): string {
  if (logs.length === 0) {
    return '';
  }

  return `\nrecent server logs:\n${logs.map((line) => `- ${line}`).join('\n')}`;
}

function runTask(task: CheckTask, envOverrides: NodeJS.ProcessEnv): void {
  const result = spawnSync(task.command, task.args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...envOverrides,
    },
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

async function ensureProtocolServer(): Promise<ProtocolServerState> {
  if (await isServerHealthy()) {
    console.log(`Using existing protocol target: ${CHAT_URL}`);
    return {
      process: null,
      startedHere: false,
    };
  }

  if (!canAutoStartLocalServer()) {
    throw new Error(
      `protocol target ${CHAT_URL} is unreachable; set GENUI_CHAT_API_URL to a reachable server or use localhost for auto-start`
    );
  }

  const recentServerLogs: string[] = [];
  const recordServerLog = (chunk: string): void => {
    const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      recentServerLogs.push(line);
      if (recentServerLogs.length > SERVER_LOG_LIMIT) {
        recentServerLogs.shift();
      }
    }
  };

  const serverProcess = spawn('bun', ['src/index.ts'], {
    cwd: API_WORKDIR,
    env: {
      ...process.env,
      API_HOST: '127.0.0.1',
      API_PORT: getProtocolServerPort(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', (chunk) => {
    recordServerLog(String(chunk));
  });

  serverProcess.stderr?.on('data', (chunk) => {
    recordServerLog(String(chunk));
  });

  console.log(`Starting local API for protocol regression: ${CHAT_URL}`);

  const startDeadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;

  while (Date.now() < startDeadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `local API server exited before becoming healthy (exitCode=${serverProcess.exitCode})${formatServerLogs(recentServerLogs)}`
      );
    }

    if (await isServerHealthy()) {
      console.log(`Local API is healthy: ${getHealthUrl()}`);
      return {
        process: serverProcess,
        startedHere: true,
      };
    }

    await sleep(SERVER_BOOT_POLL_MS);
  }

  serverProcess.kill('SIGTERM');

  throw new Error(
    `local API server did not become healthy within ${SERVER_BOOT_TIMEOUT_MS}ms${formatServerLogs(recentServerLogs)}`
  );
}

async function stopProtocolServer(serverProcess: ChildProcess): Promise<void> {
  if (serverProcess.exitCode !== null) {
    return;
  }

  serverProcess.kill('SIGTERM');

  const stopDeadline = Date.now() + SERVER_STOP_TIMEOUT_MS;
  while (serverProcess.exitCode === null && Date.now() < stopDeadline) {
    await sleep(100);
  }

  if (serverProcess.exitCode === null) {
    serverProcess.kill('SIGKILL');
  }
}

async function main(): Promise<void> {
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
    {
      name: 'GenUI snapshot regression',
      command: 'bun',
      args: ['scripts/genui-turns-snapshot.ts'],
    },
  ];

  const protocolServer = await ensureProtocolServer();

  try {
    for (const task of tasks) {
      console.log(`\n>>> ${task.name}`);
      runTask(task, { GENUI_CHAT_API_URL: CHAT_URL });
    }

    console.log('\nProtocol regressions passed: /ai/chat stream contract and GenUI render contracts are healthy for API/Web/Mini.');
  } finally {
    if (protocolServer.startedHere && protocolServer.process) {
      await stopProtocolServer(protocolServer.process);
    }
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`protocol-regression failed: ${message}`);
  process.exit(1);
}

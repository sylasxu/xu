/**
 * Tracer - 分布式追踪
 *
 * 使用 AsyncLocalStorage 实现请求级上下文隔离，
 * 替代全局变量，确保并发请求间 traceId / spanId 互不覆盖。
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { Span, SpanEvent, SpanStatus, TraceData, AIRequestTrace } from './types';

// ─── AsyncLocalStorage 上下文 ───────────────────────────────

interface TraceContext {
  traceId: string;
  currentSpanId: string | null;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

// ─── ID 生成 ────────────────────────────────────────────────

function generateId(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

// ─── Store（带上限淘汰） ────────────────────────────────────

const MAX_STORE_SIZE = 10_000;

const spanStore: Map<string, Span> = new Map();
const traceStore: Map<string, AIRequestTrace> = new Map();

/**
 * 淘汰最早条目，使 store 不超过 maxSize
 */
function evictIfNeeded<V>(store: Map<string, V>, maxSize: number): void {
  while (store.size > maxSize) {
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) {
      store.delete(firstKey);
    } else {
      break;
    }
  }
}

// ─── Trace 上下文管理 ───────────────────────────────────────

/**
 * 在独立的 Trace 上下文中运行函数（支持同步和异步）
 */
export function runWithTrace<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const traceId = generateId();
  return traceStorage.run({ traceId, currentSpanId: null }, fn);
}

/**
 * 创建新的 Trace（兼容旧 API，优先使用 runWithTrace）
 */
export function createTrace(): string {
  const traceId = generateId();
  const store = traceStorage.getStore();
  if (store) {
    store.traceId = traceId;
  }
  return traceId;
}

/**
 * 获取当前 Trace ID
 */
export function getCurrentTraceId(): string | null {
  return traceStorage.getStore()?.traceId ?? null;
}

/**
 * 获取当前 Span ID
 */
export function getCurrentSpanId(): string | null {
  return traceStorage.getStore()?.currentSpanId ?? null;
}

// ─── Span 操作 ──────────────────────────────────────────────

/**
 * 创建 Span
 */
export function startSpan(
  name: string,
  attributes: Record<string, unknown> = {},
): Span {
  const store = traceStorage.getStore();
  const traceId = store?.traceId ?? createTrace();
  const parentId = store?.currentSpanId ?? undefined;

  const span: Span = {
    id: generateId(),
    parentId,
    traceId,
    name,
    startTime: Date.now(),
    status: 'ok',
    attributes,
    events: [],
  };

  // 更新当前 spanId
  if (store) {
    store.currentSpanId = span.id;
  }

  spanStore.set(span.id, span);
  evictIfNeeded(spanStore, MAX_STORE_SIZE);

  return span;
}

/**
 * 结束 Span
 */
export function endSpan(span: Span, status: SpanStatus = 'ok'): void {
  span.endTime = Date.now();
  span.duration = span.endTime - span.startTime;
  span.status = status;

  // 通过 AsyncLocalStorage 恢复父 Span
  const store = traceStorage.getStore();
  if (store) {
    store.currentSpanId = span.parentId ?? null;
  }
}

/**
 * 添加 Span 事件
 */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Record<string, unknown>,
): void {
  const event: SpanEvent = {
    name,
    timestamp: Date.now(),
    attributes,
  };
  span.events.push(event);
}

/**
 * 设置 Span 属性
 */
export function setSpanAttribute(
  span: Span,
  key: string,
  value: unknown,
): void {
  span.attributes[key] = value;
}

// ─── 包装函数 ───────────────────────────────────────────────

/**
 * 包装异步函数执行并追踪
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, unknown> = {},
): Promise<T> {
  const span = startSpan(name, attributes);

  try {
    const result = await fn(span);
    endSpan(span, 'ok');
    return result;
  } catch (error) {
    endSpan(span, 'error');
    setSpanAttribute(
      span,
      'error.message',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/**
 * 同步版本的 withSpan
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes: Record<string, unknown> = {},
): T {
  const span = startSpan(name, attributes);

  try {
    const result = fn(span);
    endSpan(span, 'ok');
    return result;
  } catch (error) {
    endSpan(span, 'error');
    setSpanAttribute(
      span,
      'error.message',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

// ─── 数据转换与存储 ─────────────────────────────────────────

/**
 * 转换为 TraceData（用于 SSE 流）
 */
export function spanToTraceData(span: Span): TraceData {
  return {
    spanId: span.id,
    name: span.name,
    duration: span.duration || 0,
    metadata: span.attributes,
  };
}

/**
 * 记录 AI 请求追踪
 */
export function recordAIRequest(trace: AIRequestTrace): void {
  traceStore.set(trace.traceId, trace);
  evictIfNeeded(traceStore, MAX_STORE_SIZE);
}

/**
 * 获取 AI 请求追踪
 */
export function getAIRequestTrace(traceId: string): AIRequestTrace | undefined {
  return traceStore.get(traceId);
}

/**
 * 获取 Trace 下的所有 Span
 */
export function getSpansByTraceId(traceId: string): Span[] {
  return Array.from(spanStore.values()).filter((s) => s.traceId === traceId);
}

// ─── 清理 ───────────────────────────────────────────────────

const EXPIRY_MS = 60 * 60 * 1000; // 1 小时
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 清理过期数据（保留最近 1 小时）
 */
export function cleanupOldTraces(): void {
  const cutoff = Date.now() - EXPIRY_MS;

  for (const [id, span] of spanStore.entries()) {
    if (span.startTime < cutoff) {
      spanStore.delete(id);
    }
  }

  for (const [id, trace] of traceStore.entries()) {
    if (trace.startTime < cutoff) {
      traceStore.delete(id);
    }
  }
}

/**
 * 重置追踪上下文（兼容旧 API）
 */
export function resetTraceContext(): void {
  const store = traceStorage.getStore();
  if (store) {
    store.traceId = generateId();
    store.currentSpanId = null;
  }
}

// ─── 定时清理任务（模块加载时启动） ─────────────────────────

setInterval(() => cleanupOldTraces(), CLEANUP_INTERVAL_MS);

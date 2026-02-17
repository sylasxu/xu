/**
 * Rate Limiter - 频率限制
 * 
 * 基于滑动窗口的频率限制
 */

import type { RateLimitConfig, RateLimitResult } from './types';
import { DEFAULT_RATE_LIMIT_CONFIG } from './types';
import { getConfigValue } from '../config/config.service';

/**
 * 请求记录
 */
interface RequestRecord {
  timestamps: number[];
}

/**
 * 内存存储（简化实现）
 * 
 * 注意：生产环境应使用 Redis
 */
const requestStore: Map<string, RequestRecord> = new Map();

/**
 * 清理过期记录的间隔（毫秒）
 */
const CLEANUP_INTERVAL = 60 * 1000;

/**
 * 上次清理时间
 */
let lastCleanup = Date.now();

/**
 * 清理过期记录
 */
function cleanupExpiredRecords(windowSeconds: number): void {
  const now = Date.now();
  
  // 每分钟最多清理一次
  if (now - lastCleanup < CLEANUP_INTERVAL) {
    return;
  }
  
  lastCleanup = now;
  const cutoff = now - windowSeconds * 1000;
  
  for (const [key, record] of requestStore.entries()) {
    record.timestamps = record.timestamps.filter(t => t > cutoff);
    if (record.timestamps.length === 0) {
      requestStore.delete(key);
    }
  }
}

/**
 * 生成限制 Key
 */
function getRateLimitKey(userId: string | null, endpoint?: string): string {
  const parts = ['ratelimit'];
  if (userId) parts.push(userId);
  if (endpoint) parts.push(endpoint);
  return parts.join(':');
}

/**
 * 检查频率限制
 */
export async function checkRateLimit(
  userId: string | null,
  config: Partial<RateLimitConfig> = {},
  endpoint?: string
): Promise<RateLimitResult> {
  const dynamicConfig = await getConfigValue<Partial<RateLimitConfig>>('guardrails.rate_limit', {});
  const cfg = { ...DEFAULT_RATE_LIMIT_CONFIG, ...dynamicConfig, ...config };
  const now = Date.now();
  const windowMs = cfg.windowSeconds * 1000;
  const cutoff = now - windowMs;
  
  // 清理过期记录
  cleanupExpiredRecords(cfg.windowSeconds);
  
  // 获取 Key
  const key = cfg.perUser && userId 
    ? getRateLimitKey(userId, endpoint)
    : getRateLimitKey(null, endpoint);
  
  // 获取或创建记录
  let record = requestStore.get(key);
  if (!record) {
    record = { timestamps: [] };
    requestStore.set(key, record);
  }
  
  // 过滤窗口内的请求
  record.timestamps = record.timestamps.filter(t => t > cutoff);
  
  // 计算剩余请求数
  const remaining = Math.max(0, cfg.maxRequests - record.timestamps.length);
  const allowed = remaining > 0;
  
  // 计算重置时间
  const oldestTimestamp = record.timestamps[0] || now;
  const resetAt = Math.ceil((oldestTimestamp + windowMs) / 1000);
  
  // 如果允许，记录本次请求
  if (allowed) {
    record.timestamps.push(now);
  }
  
  return {
    allowed,
    remaining: allowed ? remaining - 1 : 0,
    resetAt,
    retryAfter: allowed ? undefined : Math.ceil((oldestTimestamp + windowMs - now) / 1000),
  };
}

/**
 * 消费配额（不检查，直接记录）
 */
export async function consumeQuota(
  userId: string | null,
  config: Partial<RateLimitConfig> = {},
  endpoint?: string
): Promise<void> {
  const dynamicConfig = await getConfigValue<Partial<RateLimitConfig>>('guardrails.rate_limit', {});
  const cfg = { ...DEFAULT_RATE_LIMIT_CONFIG, ...dynamicConfig, ...config };
  const key = cfg.perUser && userId 
    ? getRateLimitKey(userId, endpoint)
    : getRateLimitKey(null, endpoint);
  
  let record = requestStore.get(key);
  if (!record) {
    record = { timestamps: [] };
    requestStore.set(key, record);
  }
  
  record.timestamps.push(Date.now());
}

/**
 * 重置用户配额
 */
export function resetQuota(userId: string, endpoint?: string): void {
  const key = getRateLimitKey(userId, endpoint);
  requestStore.delete(key);
}

/**
 * 获取用户当前使用量
 */
export async function getUsage(
  userId: string | null,
  config: Partial<RateLimitConfig> = {},
  endpoint?: string
): Promise<{ used: number; limit: number }> {
  const dynamicConfig = await getConfigValue<Partial<RateLimitConfig>>('guardrails.rate_limit', {});
  const cfg = { ...DEFAULT_RATE_LIMIT_CONFIG, ...dynamicConfig, ...config };
  const key = cfg.perUser && userId 
    ? getRateLimitKey(userId, endpoint)
    : getRateLimitKey(null, endpoint);
  
  const record = requestStore.get(key);
  const windowMs = cfg.windowSeconds * 1000;
  const cutoff = Date.now() - windowMs;
  
  const validTimestamps = record?.timestamps.filter(t => t > cutoff) || [];
  
  return {
    used: validTimestamps.length,
    limit: cfg.maxRequests,
  };
}


/**
 * AI 配置加载服务
 *
 * 提供带内存缓存的配置读写，支持版本管理和回滚。
 * 缓存优先 → 数据库 → 默认值降级
 *
 * 使用 db.select().from() 语法（无需 Drizzle relations）
 */

import { db, aiConfigs, aiConfigHistory, eq, desc, and } from '@juchang/db';

// ============ 内存缓存 ============

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

/** 内存缓存，TTL 30 秒 */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function getCached(key: string): unknown | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expireAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCache(key: string, value: unknown): void {
  cache.set(key, { value, expireAt: Date.now() + CACHE_TTL_MS });
}

/** 清除指定 key 的缓存 */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/** 清除所有缓存 */
export function clearConfigCache(): void {
  cache.clear();
}


// ============ 配置读写 ============

/**
 * 获取配置值（带缓存）
 *
 * 优先从内存缓存读取，过期后从数据库加载，
 * 加载失败时降级到代码默认值。
 */
export async function getConfigValue<T>(configKey: string, defaultValue: T): Promise<T> {
  // 1. 缓存命中
  const cached = getCached(configKey);
  if (cached !== undefined) return cached as T;

  // 2. 从数据库加载
  try {
    const [row] = await db
      .select()
      .from(aiConfigs)
      .where(eq(aiConfigs.configKey, configKey))
      .limit(1);

    if (row) {
      const value = row.configValue as T;
      setCache(configKey, value);
      return value;
    }
  } catch (error) {
    console.error(`[ConfigService] 加载配置 ${configKey} 失败，使用默认值`, error);
  }

  // 3. 降级到默认值
  return defaultValue;
}

/**
 * 更新配置值
 *
 * 写入数据库 + 刷新缓存 + 自动递增版本号。
 * 更新前将当前版本复制到 history 表。
 */
export async function setConfigValue(
  configKey: string,
  configValue: unknown,
  updatedBy?: string,
): Promise<{ version: number }> {
  const now = new Date();

  // 查询当前记录
  const [existing] = await db
    .select()
    .from(aiConfigs)
    .where(eq(aiConfigs.configKey, configKey))
    .limit(1);

  if (existing) {
    // 保存当前版本到 history
    await db.insert(aiConfigHistory).values({
      configKey: existing.configKey,
      configValue: existing.configValue,
      version: existing.version,
      updatedAt: existing.updatedAt,
      updatedBy: existing.updatedBy,
    });

    // 更新主表，版本号 +1
    const newVersion = existing.version + 1;
    await db
      .update(aiConfigs)
      .set({
        configValue,
        version: newVersion,
        updatedAt: now,
        updatedBy: updatedBy ?? null,
      })
      .where(eq(aiConfigs.configKey, configKey));

    setCache(configKey, configValue);
    return { version: newVersion };
  }

  // 新建配置
  await db.insert(aiConfigs).values({
    configKey,
    configValue,
    category: configKey.split('.')[0] ?? 'general',
    version: 1,
    updatedAt: now,
    updatedBy: updatedBy ?? null,
  });

  setCache(configKey, configValue);
  return { version: 1 };
}

/**
 * 获取配置变更历史
 */
export async function getConfigHistory(
  configKey: string,
): Promise<Array<{ version: number; configValue: unknown; updatedAt: Date; updatedBy: string | null }>> {
  const rows = await db
    .select({
      version: aiConfigHistory.version,
      configValue: aiConfigHistory.configValue,
      updatedAt: aiConfigHistory.updatedAt,
      updatedBy: aiConfigHistory.updatedBy,
    })
    .from(aiConfigHistory)
    .where(eq(aiConfigHistory.configKey, configKey))
    .orderBy(desc(aiConfigHistory.version));

  return rows;
}

/**
 * 回滚配置到指定版本
 */
export async function rollbackConfig(
  configKey: string,
  targetVersion: number,
  updatedBy?: string,
): Promise<{ version: number; configValue: unknown } | null> {
  // 从 history 中找到目标版本
  const [historyRow] = await db
    .select()
    .from(aiConfigHistory)
    .where(and(eq(aiConfigHistory.configKey, configKey), eq(aiConfigHistory.version, targetVersion)))
    .limit(1);

  if (!historyRow) return null;

  // 用 setConfigValue 写入（自动保存当前版本到 history 并递增版本号）
  const result = await setConfigValue(configKey, historyRow.configValue, updatedBy);
  return { version: result.version, configValue: historyRow.configValue };
}

/**
 * 获取所有配置（按 category 分组）
 */
export async function getAllConfigs(): Promise<Record<string, Array<{
  configKey: string;
  configValue: unknown;
  description: string | null;
  version: number;
  updatedAt: Date;
}>>> {
  const rows = await db.select().from(aiConfigs);

  const grouped: Record<string, Array<{
    configKey: string;
    configValue: unknown;
    description: string | null;
    version: number;
    updatedAt: Date;
  }>> = {};

  for (const row of rows) {
    const cat = row.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      configKey: row.configKey,
      configValue: row.configValue,
      description: row.description,
      version: row.version,
      updatedAt: row.updatedAt,
    });
  }

  return grouped;
}

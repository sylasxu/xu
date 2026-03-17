// Hot Keywords Service - 纯业务逻辑 (v4.8 Digital Ascension)
import { db, globalKeywords, eq, and, sql, desc, toTimestamp } from '@juchang/db';
import type {
  GlobalKeywordResponse,
  HotKeywordListItem,
  CreateGlobalKeywordRequest,
  UpdateGlobalKeywordRequest,
  HotKeywordsQuery,
  KeywordAnalyticsItem,
} from './hot-keywords.model';
import { createLogger } from '../../lib/logger';

const logger = createLogger('hot-keywords');
type GlobalKeywordRow = typeof globalKeywords.$inferSelect;
type KeywordListFilters = Pick<HotKeywordsQuery, 'isActive' | 'matchType' | 'responseType'>;

// ==========================================
// 缓存配置
// ==========================================

const CACHE_TTL = 300; // 5 分钟（秒）
const CACHE_KEY_PREFIX = 'hot_kw:';

// 内存缓存（降级方案，如果 Redis 不可用）
const memoryCache = new Map<string, { data: any; expiresAt: number }>();

function toGlobalKeywordResponse(keyword: GlobalKeywordRow): GlobalKeywordResponse {
  return {
    id: keyword.id,
    keyword: keyword.keyword,
    matchType: keyword.matchType,
    responseType: keyword.responseType,
    responseContent: keyword.responseContent as GlobalKeywordResponse['responseContent'],
    priority: keyword.priority,
    validFrom: keyword.validFrom?.toISOString() || null,
    validUntil: keyword.validUntil?.toISOString() || null,
    isActive: keyword.isActive,
    hitCount: keyword.hitCount,
    conversionCount: keyword.conversionCount,
    createdBy: keyword.createdBy,
    createdAt: keyword.createdAt.toISOString(),
    updatedAt: keyword.updatedAt.toISOString(),
  };
}

/**
 * 缓存辅助函数
 */
async function getCache(key: string): Promise<any | null> {
  try {
    // 尝试从内存缓存获取
    const cached = memoryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    
    // 清理过期缓存
    if (cached) {
      memoryCache.delete(key);
    }
    
    return null;
  } catch (error) {
    // 缓存读取失败，记录日志并返回 null（降级到数据库查询）
    logger.warn({ error: error instanceof Error ? error.message : String(error), key }, 
      '缓存读取失败，降级到数据库查询');
    return null;
  }
}

async function setCache(key: string, data: any, ttl: number = CACHE_TTL): Promise<void> {
  try {
    memoryCache.set(key, {
      data,
      expiresAt: Date.now() + ttl * 1000,
    });
  } catch (error) {
    // 缓存写入失败，记录日志但不影响主流程
    logger.warn({ error: error instanceof Error ? error.message : String(error), key }, 
      '缓存写入失败，继续执行');
  }
}

async function deleteCache(pattern: string): Promise<void> {
  try {
    // 删除匹配的缓存键
    const keys = Array.from(memoryCache.keys()).filter(k => k.startsWith(pattern));
    keys.forEach(k => memoryCache.delete(k));
  } catch (error) {
    // 缓存删除失败，记录日志但不影响主流程
    logger.warn({ error: error instanceof Error ? error.message : String(error), pattern }, 
      '缓存删除失败，继续执行');
  }
}

// ==========================================
// 核心业务逻辑
// ==========================================

/**
 * 获取活跃的热词列表（用于 Hot Chips 显示）
 * 支持 Redis 缓存（TTL 5 分钟）
 * 降级策略：缓存失败 → 数据库查询，数据库失败 → 返回空数组
 */
export async function getActiveHotKeywords(params: {
  limit?: number;
  lat?: number;
  lng?: number;
  timeRange?: string;
}): Promise<HotKeywordListItem[]> {
  const { limit = 5, lat, lng, timeRange } = params;
  
  // 尝试从缓存获取
  const cacheKey = `${CACHE_KEY_PREFIX}active:${limit}:${lat || ''}:${lng || ''}:${timeRange || ''}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const now = new Date();
    
    // 构建查询条件
    const conditions = [
      eq(globalKeywords.isActive, true),
      // 有效期过滤
      sql`(${globalKeywords.validFrom} IS NULL OR ${globalKeywords.validFrom} <= ${toTimestamp(now)})`,
      sql`(${globalKeywords.validUntil} IS NULL OR ${globalKeywords.validUntil} >= ${toTimestamp(now)})`,
    ];

    // TODO: 地理位置过滤（Phase 2）
    // if (lat && lng) { ... }
    
    // TODO: 时间范围过滤（Phase 2）
    // if (timeRange) { ... }

    const keywords = await db
      .select({
        id: globalKeywords.id,
        keyword: globalKeywords.keyword,
        responseType: globalKeywords.responseType,
        priority: globalKeywords.priority,
        hitCount: globalKeywords.hitCount,
      })
      .from(globalKeywords)
      .where(and(...conditions))
      .orderBy(
        desc(globalKeywords.priority),
        sql`length(${globalKeywords.keyword}) DESC`,
        desc(globalKeywords.hitCount)
      )
      .limit(limit);

    // 缓存结果
    await setCache(cacheKey, keywords);

    return keywords;
  } catch (error) {
    // 数据库查询失败，记录日志并返回空数组（降级策略）
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      params 
    }, '数据库查询失败，返回空数组');
    return [];
  }
}

/**
 * 匹配关键词（P0 层核心逻辑）
 * 支持三种匹配方式：exact（完全匹配）、prefix（前缀匹配）、fuzzy（模糊匹配）
 * 降级策略：缓存失败 → 数据库查询，数据库失败 → 返回 null（自动降级到 P1 层）
 */
export async function matchKeyword(userInput: string): Promise<GlobalKeywordResponse | null> {
  const normalizedInput = userInput.trim().toLowerCase();
  
  // 尝试从缓存获取匹配结果
  const cacheKey = `${CACHE_KEY_PREFIX}match:${normalizedInput}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const now = new Date();
    
    // 获取所有活跃的关键词
    const activeKeywords = await db
      .select()
      .from(globalKeywords)
      .where(
        and(
          eq(globalKeywords.isActive, true),
          sql`(${globalKeywords.validFrom} IS NULL OR ${globalKeywords.validFrom} <= ${toTimestamp(now)})`,
          sql`(${globalKeywords.validUntil} IS NULL OR ${globalKeywords.validUntil} >= ${toTimestamp(now)})`
        )
      )
      .orderBy(
        desc(globalKeywords.priority),
        sql`length(${globalKeywords.keyword}) DESC`
      );

    // 匹配逻辑
    for (const kw of activeKeywords) {
      const normalizedKeyword = kw.keyword.toLowerCase();
      
      let matched = false;
      switch (kw.matchType) {
        case 'exact':
          matched = normalizedInput === normalizedKeyword;
          break;
        case 'prefix':
          matched = normalizedInput.startsWith(normalizedKeyword);
          break;
        case 'fuzzy':
          matched = normalizedInput.includes(normalizedKeyword);
          break;
      }

      if (matched) {
        const result = toGlobalKeywordResponse(kw);
        
        // 缓存匹配结果
        await setCache(cacheKey, result);
        return result;
      }
    }

    return null;
  } catch (error) {
    // 数据库查询失败，记录日志并返回 null（降级到 P1 层）
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      userInput 
    }, 'P0 层匹配失败，降级到 P1 层');
    return null;
  }
}

/**
 * 增加命中次数
 * 降级策略：数据库更新失败时记录日志但不抛出错误
 */
export async function incrementHitCount(keywordId: string): Promise<void> {
  try {
    await db
      .update(globalKeywords)
      .set({
        hitCount: sql`${globalKeywords.hitCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(globalKeywords.id, keywordId));

    // 清除相关缓存
    await invalidateCache();
  } catch (error) {
    // 统计更新失败，记录日志但不影响主流程
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      keywordId 
    }, '命中次数更新失败');
  }
}

/**
 * 增加转化次数
 * 降级策略：数据库更新失败时记录日志但不抛出错误
 */
export async function incrementConversionCount(keywordId: string): Promise<void> {
  try {
    await db
      .update(globalKeywords)
      .set({
        conversionCount: sql`${globalKeywords.conversionCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(globalKeywords.id, keywordId));

    // 清除相关缓存
    await invalidateCache();
  } catch (error) {
    // 统计更新失败，记录日志但不影响主流程
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      keywordId 
    }, '转化次数更新失败');
  }
}

/**
 * 清除缓存
 */
export async function invalidateCache(): Promise<void> {
  await deleteCache(CACHE_KEY_PREFIX);
}

// ==========================================
// 受保护写操作
// ==========================================

/**
 * 创建热词
 */
export async function createKeyword(
  data: CreateGlobalKeywordRequest,
  createdBy: string
): Promise<GlobalKeywordResponse> {
  // 验证 valid_from < valid_until
  if (data.validFrom && data.validUntil) {
    const validFrom = new Date(data.validFrom);
    const validUntil = new Date(data.validUntil);
    if (validFrom >= validUntil) {
      throw new Error('valid_from 必须早于 valid_until');
    }
  }

  // 验证 response_content 是否为有效 JSON
  if (typeof data.responseContent !== 'object') {
    throw new Error('response_content 必须是有效的 JSON 对象');
  }

  // 验证 response_content 大小 <= 10KB
  const contentSize = JSON.stringify(data.responseContent).length;
  if (contentSize > 10240) {
    throw new Error('response_content 大小不能超过 10KB');
  }

  const [keyword] = await db
    .insert(globalKeywords)
    .values({
      keyword: data.keyword,
      matchType: data.matchType,
      responseType: data.responseType,
      responseContent: data.responseContent,
      priority: data.priority ?? 0,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
      createdBy,
    })
    .returning();

  await invalidateCache();

  return toGlobalKeywordResponse(keyword);
}

/**
 * 更新热词
 */
export async function updateKeyword(
  id: string,
  data: UpdateGlobalKeywordRequest
): Promise<GlobalKeywordResponse> {
  // 验证 valid_from < valid_until
  if (data.validFrom && data.validUntil) {
    const validFrom = new Date(data.validFrom);
    const validUntil = new Date(data.validUntil);
    if (validFrom >= validUntil) {
      throw new Error('valid_from 必须早于 valid_until');
    }
  }

  // 验证 response_content 是否为有效 JSON
  if (data.responseContent && typeof data.responseContent !== 'object') {
    throw new Error('response_content 必须是有效的 JSON 对象');
  }

  // 验证 response_content 大小 <= 10KB
  if (data.responseContent) {
    const contentSize = JSON.stringify(data.responseContent).length;
    if (contentSize > 10240) {
      throw new Error('response_content 大小不能超过 10KB');
    }
  }

  // 构建更新数据
  const updateData: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (data.keyword !== undefined) updateData.keyword = data.keyword;
  if (data.matchType !== undefined) updateData.matchType = data.matchType;
  if (data.responseType !== undefined) updateData.responseType = data.responseType;
  if (data.responseContent !== undefined) updateData.responseContent = data.responseContent;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.validFrom !== undefined) {
    updateData.validFrom = data.validFrom ? new Date(data.validFrom) : null;
  }
  if (data.validUntil !== undefined) {
    updateData.validUntil = data.validUntil ? new Date(data.validUntil) : null;
  }

  const [keyword] = await db
    .update(globalKeywords)
    .set(updateData)
    .where(eq(globalKeywords.id, id))
    .returning();

  if (!keyword) {
    throw new Error('热词不存在');
  }

  await invalidateCache();

  return toGlobalKeywordResponse(keyword);
}

/**
 * 删除热词（软删除）
 */
export async function deleteKeyword(id: string): Promise<void> {
  await db
    .update(globalKeywords)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(globalKeywords.id, id));

  await invalidateCache();
}

/**
 * 根据 ID 获取热词
 */
export async function getKeywordById(id: string): Promise<GlobalKeywordResponse | null> {
  const [keyword] = await db
    .select()
    .from(globalKeywords)
    .where(eq(globalKeywords.id, id))
    .limit(1);

  if (!keyword) {
    return null;
  }

  return toGlobalKeywordResponse(keyword);
}

/**
 * 获取热词列表（支持筛选）
 * 降级策略：数据库查询失败时返回空数组
 */
export async function listKeywords(
  filters: KeywordListFilters
): Promise<GlobalKeywordResponse[]> {
  try {
    const conditions = [];
    
    if (filters.isActive !== undefined) {
      conditions.push(eq(globalKeywords.isActive, filters.isActive));
    }
    if (filters.matchType) {
      conditions.push(eq(globalKeywords.matchType, filters.matchType));
    }
    if (filters.responseType) {
      conditions.push(eq(globalKeywords.responseType, filters.responseType));
    }

    const keywords = await db
      .select()
      .from(globalKeywords)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(globalKeywords.createdAt));

    return keywords.map(toGlobalKeywordResponse);
  } catch (error) {
    // 数据库查询失败，记录日志并返回空数组
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      filters 
    }, '热词列表查询失败，返回空数组');
    return [];
  }
}

/**
 * 获取热词分析数据
 * 降级策略：数据库查询失败时返回空数组
 */
export async function getKeywordAnalytics(
  period: '7d' | '30d' = '7d'
): Promise<KeywordAnalyticsItem[]> {
  try {
    // 获取当前周期数据
    const keywords = await db
      .select({
        keyword: globalKeywords.keyword,
        hitCount: globalKeywords.hitCount,
        conversionCount: globalKeywords.conversionCount,
      })
      .from(globalKeywords)
      .where(eq(globalKeywords.isActive, true))
      .orderBy(desc(globalKeywords.hitCount))
      .limit(10);

    // TODO: 计算趋势（需要历史数据表）
    // 暂时返回 stable
    return keywords.map(kw => ({
      keyword: kw.keyword,
      hitCount: kw.hitCount,
      conversionCount: kw.conversionCount,
      conversionRate: kw.hitCount > 0 ? (kw.conversionCount / kw.hitCount) * 100 : 0,
      trend: 'stable' as const,
    }));
  } catch (error) {
    // 数据库查询失败，记录日志并返回空数组
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      period 
    }, '热词分析数据查询失败，返回空数组');
    return [];
  }
}

// ==========================================
// 转化追踪
// ==========================================

/**
 * 检查用户最近的关键词上下文并追踪转化
 * 在活动报名/发布时调用
 * 降级策略：数据库查询失败时记录日志但不抛出错误
 */
function readKeywordContextId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const keywordContext = 'keywordContext' in value ? value.keywordContext : undefined
  if (typeof keywordContext !== 'object' || keywordContext === null) {
    return null
  }

  const keywordId = 'keywordId' in keywordContext ? keywordContext.keywordId : undefined
  return typeof keywordId === 'string' ? keywordId : null
}

export async function trackConversion(userId: string): Promise<void> {
  try {
    const { conversationMessages, conversations } = await import('@juchang/db');
    
    // 查询用户最近 30 分钟内的 AI 响应消息
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    const recentMessages = await db
      .select({
        content: conversationMessages.content,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversationMessages.role, 'assistant'),
          sql`${conversationMessages.createdAt} >= ${toTimestamp(thirtyMinutesAgo)}`
        )
      )
      .orderBy(desc(conversationMessages.createdAt))
      .limit(10);

    // 查找最近的 keywordContext
    for (const msg of recentMessages) {
      const keywordId = readKeywordContextId(msg.content)
      if (keywordId) {
        // 找到了关键词上下文，增加转化次数
        await incrementConversionCount(keywordId);
        return; // 只追踪最近的一个关键词
      }
    }
  } catch (error) {
    // 转化追踪失败，记录日志但不影响主流程
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      userId 
    }, '转化追踪失败');
  }
}

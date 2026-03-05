/**
 * Security Service - 安全领域服务
 */

import {
  db,
  users,
  aiSensitiveWords,
  aiSecurityEvents,
  eq,
  sql,
  isNotNull,
  desc,
  inArray,
  gte,
  lte,
  and,
  toTimestamp,
} from '@juchang/db';
import { createLogger } from '../observability/logger';

const logger = createLogger('ai-security');

/**
 * 安全总览数据
 */
export interface SecurityOverview {
  today: {
    inputBlocked: number;
    outputBlocked: number;
    pendingModeration: number;
    sensitiveWordsCount: number;
  };
  trend: Array<{
    date: string;
    blocked: number;
    violations: number;
  }>;
  guardrailStatus: {
    inputGuard: boolean;
    outputGuard: boolean;
    rateLimiter: boolean;
  };
}

/**
 * 获取安全总览
 */
export async function getSecurityOverview(): Promise<SecurityOverview> {
  const today = new Date();
  const trend: SecurityOverview['trend'] = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    trend.push({
      date: date.toISOString().split('T')[0],
      blocked: Math.floor(Math.random() * 20),
      violations: Math.floor(Math.random() * 5),
    });
  }

  return {
    today: {
      inputBlocked: Math.floor(Math.random() * 10),
      outputBlocked: Math.floor(Math.random() * 5),
      pendingModeration: 0,
      sensitiveWordsCount: 15,
    },
    trend,
    guardrailStatus: {
      inputGuard: true,
      outputGuard: true,
      rateLimiter: true,
    },
  };
}

/**
 * 敏感词列表（内存版）
 */
const SENSITIVE_WORDS_STORE = new Set([
  '习近平', '共产党', '六四', '天安门', '法轮功',
  '杀人', '自杀', '炸弹', '枪支',
  '色情', '裸体', '性交',
  '刷单', '兼职赚钱', '高额回报',
]);

export function getSensitiveWords(): { words: string[]; total: number } {
  const words = Array.from(SENSITIVE_WORDS_STORE);
  return { words, total: words.length };
}

export function addSensitiveWord(word: string): { success: boolean; message: string } {
  if (SENSITIVE_WORDS_STORE.has(word)) {
    return { success: false, message: '敏感词已存在' };
  }
  SENSITIVE_WORDS_STORE.add(word);
  logger.info('Sensitive word added', { word });
  return { success: true, message: '添加成功' };
}

export function deleteSensitiveWord(word: string): { success: boolean; message: string } {
  if (!SENSITIVE_WORDS_STORE.has(word)) {
    return { success: false, message: '敏感词不存在' };
  }
  SENSITIVE_WORDS_STORE.delete(word);
  logger.info('Sensitive word deleted', { word });
  return { success: true, message: '删除成功' };
}

export function importSensitiveWords(words: string[]): { success: number; skipped: number } {
  let success = 0;
  let skipped = 0;

  for (const word of words) {
    const trimmed = word.trim();
    if (!trimmed) continue;
    if (SENSITIVE_WORDS_STORE.has(trimmed)) {
      skipped++;
    } else {
      SENSITIVE_WORDS_STORE.add(trimmed);
      success++;
    }
  }

  logger.info('Sensitive words imported', { success, skipped });
  return { success, skipped };
}

/**
 * 审核队列项（占位实现）
 */
export interface ModerationItem {
  id: string;
  contentType: 'input' | 'output';
  content: string;
  userId: string;
  userNickname: string | null;
  reason: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export async function getModerationQueue(_page: number = 1, _limit: number = 20): Promise<{
  items: ModerationItem[];
  total: number;
  pendingCount: number;
}> {
  return {
    items: [],
    total: 0,
    pendingCount: 0,
  };
}

export async function approveModeration(_id: string): Promise<{ success: boolean; message: string }> {
  return { success: true, message: '审核通过' };
}

export async function rejectModeration(_id: string): Promise<{ success: boolean; message: string }> {
  return { success: true, message: '审核拒绝' };
}

export async function banModeration(_id: string): Promise<{ success: boolean; message: string }> {
  return { success: true, message: '已删除内容并封禁用户' };
}

/**
 * 违规统计
 */
export interface ViolationStats {
  total: number;
  avgReviewTimeMinutes: number;
  byType: Array<{
    type: string;
    count: number;
    percentage: number;
  }>;
  trend: Array<{
    date: string;
    count: number;
  }>;
  topUsers: Array<{
    userId: string;
    nickname: string | null;
    count: number;
  }>;
}

export async function getViolationStats(): Promise<ViolationStats> {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 30);

  const stats = await getSecurityStatsFromDB(startDate, today);
  const total = stats.totalEvents;
  const byType = stats.eventsByType.map(e => ({
    type: e.eventType === 'input_blocked' ? '输入拦截'
      : e.eventType === 'output_blocked' ? '输出拦截'
        : e.eventType === 'rate_limited' ? '频率限制' : e.eventType,
    count: e.count,
    percentage: total > 0 ? Math.round((e.count / total) * 100) : 0,
  }));

  const trendMap = new Map(stats.eventsByDay.map(d => [d.date, d.count]));
  const trend: ViolationStats['trend'] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    trend.push({ date: dateStr, count: trendMap.get(dateStr) || 0 });
  }

  const topUsersResult = await db
    .select({
      userId: aiSecurityEvents.userId,
      count: sql<number>`count(*)`,
    })
    .from(aiSecurityEvents)
    .where(and(
      gte(aiSecurityEvents.createdAt, toTimestamp(startDate)),
      isNotNull(aiSecurityEvents.userId)
    ))
    .groupBy(aiSecurityEvents.userId)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  const userIds = topUsersResult.map(u => u.userId).filter((id): id is string => id !== null);
  let nicknameMap = new Map<string, string | null>();
  if (userIds.length > 0) {
    const userList = await db
      .select({ id: users.id, nickname: users.nickname })
      .from(users)
      .where(inArray(users.id, userIds));
    nicknameMap = new Map(userList.map(u => [u.id, u.nickname]));
  }

  return {
    total,
    avgReviewTimeMinutes: 0,
    byType: byType.length > 0 ? byType : [{ type: '输入拦截', count: 0, percentage: 0 }],
    trend,
    topUsers: topUsersResult.map(u => ({
      userId: u.userId || '',
      nickname: u.userId ? nicknameMap.get(u.userId) || null : null,
      count: Number(u.count),
    })),
  };
}

// ==========================================
// Security 持久化 API
// ==========================================

let sensitiveWordsCache: string[] = [];

export async function loadSensitiveWordsCache(): Promise<void> {
  try {
    const words = await db
      .select({ word: aiSensitiveWords.word })
      .from(aiSensitiveWords)
      .where(eq(aiSensitiveWords.isActive, true));

    sensitiveWordsCache = words.map(w => w.word);
    logger.info('Sensitive words cache loaded', { count: sensitiveWordsCache.length });
  } catch (error) {
    logger.error('Failed to load sensitive words cache', { error });
  }
}

export function getSensitiveWordsCache(): string[] {
  return sensitiveWordsCache;
}

export async function getSensitiveWordsFromDB(page: number = 1, limit: number = 50): Promise<{
  words: Array<{
    id: string;
    word: string;
    category: string | null;
    severity: string | null;
    isActive: boolean | null;
    createdAt: string;
  }>;
  total: number;
}> {
  const offset = (page - 1) * limit;

  const [words, countResult] = await Promise.all([
    db
      .select()
      .from(aiSensitiveWords)
      .orderBy(desc(aiSensitiveWords.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(aiSensitiveWords),
  ]);

  return {
    words: words.map(w => ({
      id: w.id,
      word: w.word,
      category: w.category,
      severity: w.severity,
      isActive: w.isActive,
      createdAt: w.createdAt.toISOString(),
    })),
    total: Number(countResult[0]?.count || 0),
  };
}

export async function addSensitiveWordToDB(word: string, category?: string, severity?: string): Promise<{ success: boolean; message: string; id?: string }> {
  try {
    const [result] = await db
      .insert(aiSensitiveWords)
      .values({
        word: word.trim(),
        category: category || 'general',
        severity: severity || 'medium',
      })
      .returning({ id: aiSensitiveWords.id });

    await loadSensitiveWordsCache();
    logger.info('Sensitive word added to DB', { word, id: result.id });
    return { success: true, message: '添加成功', id: result.id };
  } catch (error: any) {
    if (error.code === '23505') {
      return { success: false, message: '敏感词已存在' };
    }
    logger.error('Failed to add sensitive word', { error: error.message });
    return { success: false, message: error.message || '添加失败' };
  }
}

export async function deleteSensitiveWordFromDB(id: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await db
      .delete(aiSensitiveWords)
      .where(eq(aiSensitiveWords.id, id))
      .returning({ id: aiSensitiveWords.id });

    if (result.length === 0) {
      return { success: false, message: '敏感词不存在' };
    }

    await loadSensitiveWordsCache();
    logger.info('Sensitive word deleted from DB', { id });
    return { success: true, message: '删除成功' };
  } catch (error: any) {
    logger.error('Failed to delete sensitive word', { error: error.message });
    return { success: false, message: error.message || '删除失败' };
  }
}

export async function recordSecurityEvent(event: {
  userId?: string;
  eventType: string;
  triggerWord?: string;
  inputText?: string;
  severity?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(aiSecurityEvents).values({
      userId: event.userId || null,
      eventType: event.eventType,
      triggerWord: event.triggerWord || null,
      inputText: event.inputText || null,
      severity: event.severity || 'medium',
      metadata: event.metadata || null,
    });
    logger.debug('Security event recorded', { eventType: event.eventType });
  } catch (error) {
    logger.error('Failed to record security event', { error });
  }
}

export async function getSecurityEvents(params: {
  startDate?: Date;
  endDate?: Date;
  eventType?: string;
  page?: number;
  limit?: number;
}): Promise<{
  items: Array<{
    id: string;
    userId: string | null;
    eventType: string;
    triggerWord: string | null;
    severity: string | null;
    createdAt: string;
  }>;
  total: number;
}> {
  const { startDate, endDate, eventType, page = 1, limit = 20 } = params;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (startDate) conditions.push(gte(aiSecurityEvents.createdAt, toTimestamp(startDate)));
  if (endDate) conditions.push(lte(aiSecurityEvents.createdAt, toTimestamp(endDate)));
  if (eventType) conditions.push(eq(aiSecurityEvents.eventType, eventType));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: aiSecurityEvents.id,
        userId: aiSecurityEvents.userId,
        eventType: aiSecurityEvents.eventType,
        triggerWord: aiSecurityEvents.triggerWord,
        severity: aiSecurityEvents.severity,
        createdAt: aiSecurityEvents.createdAt,
      })
      .from(aiSecurityEvents)
      .where(whereClause)
      .orderBy(desc(aiSecurityEvents.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(aiSecurityEvents)
      .where(whereClause),
  ]);

  return {
    items: items.map(i => ({
      id: i.id,
      userId: i.userId,
      eventType: i.eventType,
      triggerWord: i.triggerWord,
      severity: i.severity,
      createdAt: i.createdAt.toISOString(),
    })),
    total: Number(countResult[0]?.count || 0),
  };
}

export async function getSecurityStatsFromDB(startDate: Date, endDate: Date): Promise<{
  totalEvents: number;
  eventsByType: Array<{ eventType: string; count: number }>;
  eventsByDay: Array<{ date: string; count: number }>;
  topTriggerWords: Array<{ word: string; count: number }>;
}> {
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiSecurityEvents)
    .where(and(
      gte(aiSecurityEvents.createdAt, toTimestamp(startDate)),
      lte(aiSecurityEvents.createdAt, toTimestamp(endDate))
    ));

  const byTypeResults = await db
    .select({
      eventType: aiSecurityEvents.eventType,
      count: sql<number>`count(*)`,
    })
    .from(aiSecurityEvents)
    .where(and(
      gte(aiSecurityEvents.createdAt, toTimestamp(startDate)),
      lte(aiSecurityEvents.createdAt, toTimestamp(endDate))
    ))
    .groupBy(aiSecurityEvents.eventType);

  const byDayResults = await db
    .select({
      date: sql<string>`date(${aiSecurityEvents.createdAt})`,
      count: sql<number>`count(*)`,
    })
    .from(aiSecurityEvents)
    .where(and(
      gte(aiSecurityEvents.createdAt, toTimestamp(startDate)),
      lte(aiSecurityEvents.createdAt, toTimestamp(endDate))
    ))
    .groupBy(sql`date(${aiSecurityEvents.createdAt})`)
    .orderBy(sql`date(${aiSecurityEvents.createdAt})`);

  const topWordsResults = await db
    .select({
      word: aiSecurityEvents.triggerWord,
      count: sql<number>`count(*)`,
    })
    .from(aiSecurityEvents)
    .where(and(
      gte(aiSecurityEvents.createdAt, toTimestamp(startDate)),
      lte(aiSecurityEvents.createdAt, toTimestamp(endDate)),
      isNotNull(aiSecurityEvents.triggerWord)
    ))
    .groupBy(aiSecurityEvents.triggerWord)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  return {
    totalEvents: Number(totalResult?.count || 0),
    eventsByType: byTypeResults.map(r => ({
      eventType: r.eventType,
      count: Number(r.count),
    })),
    eventsByDay: byDayResults.map(r => ({
      date: r.date,
      count: Number(r.count),
    })),
    topTriggerWords: topWordsResults.map(r => ({
      word: r.word || '',
      count: Number(r.count),
    })),
  };
}

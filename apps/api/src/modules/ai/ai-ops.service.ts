/**
 * AI Ops Service - AI 运营管理服务
 * 
 * 提供 Admin 后台的 RAG、Memory、Security 运营 API
 * 
 * v4.5 新增
 * v4.6 新增：对话质量监控、转化率追踪、Security 持久化
 */

import { 
  db, 
  activities, 
  users, 
  eq, 
  sql, 
  isNotNull, 
  desc, 
  inArray,
  aiConversationMetrics,
  aiSensitiveWords,
  aiSecurityEvents,
  gte,
  lte,
  and,
  toTimestamp,
} from '@juchang/db';
import { indexActivity, indexActivities, search } from './rag/search';
import { generateEmbedding } from './rag/utils';
import { 
  getEnhancedUserProfileWithVectors, 
  getInterestVectors,
  calculateMaxSim,
} from './memory/working';
import { createLogger } from './observability/logger';

const logger = createLogger('ai-ops');

// ==========================================
// RAG 运营 API
// ==========================================

/**
 * RAG 统计信息
 */
export interface RagStats {
  totalActivities: number;
  indexedActivities: number;
  coverageRate: number;
  embeddingModel: string;
  embeddingDimensions: number;
  lastIndexedAt: string | null;
  unindexedActivities: Array<{
    id: string;
    title: string;
    createdAt: string;
  }>;
}

/**
 * 获取 RAG 统计信息
 */
export async function getRagStats(): Promise<RagStats> {
  // 获取总活动数和已索引活动数
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(activities)
    .where(eq(activities.status, 'active'));
  
  const [indexedResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(activities)
    .where(sql`${activities.status} = 'active' AND ${activities.embedding} IS NOT NULL`);
  
  const total = Number(totalResult?.count || 0);
  const indexed = Number(indexedResult?.count || 0);
  
  // 获取未索引的活动（最多 10 条）
  const unindexed = await db
    .select({
      id: activities.id,
      title: activities.title,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .where(sql`${activities.status} = 'active' AND ${activities.embedding} IS NULL`)
    .orderBy(desc(activities.createdAt))
    .limit(10);
  
  // 获取最后索引时间
  const [lastIndexed] = await db
    .select({ updatedAt: activities.updatedAt })
    .from(activities)
    .where(isNotNull(activities.embedding))
    .orderBy(desc(activities.updatedAt))
    .limit(1);
  
  return {
    totalActivities: total,
    indexedActivities: indexed,
    coverageRate: total > 0 ? Math.round((indexed / total) * 100) : 0,
    embeddingModel: 'embedding-3',
    embeddingDimensions: 1024,
    lastIndexedAt: lastIndexed?.updatedAt?.toISOString() || null,
    unindexedActivities: unindexed.map(a => ({
      id: a.id,
      title: a.title,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

/**
 * RAG 搜索测试参数
 */
export interface RagSearchTestParams {
  query: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  userId?: string;
  limit?: number;
}

/**
 * RAG 搜索测试结果
 */
export interface RagSearchTestResult {
  results: Array<{
    activityId: string;
    title: string;
    type: string;
    locationName: string;
    startAt: string;
    similarity: number;
    distance: number | null;
    finalScore: number;
    maxSimBoost: number;
  }>;
  performance: {
    embeddingTimeMs: number;
    searchTimeMs: number;
    totalTimeMs: number;
  };
  query: string;
  totalResults: number;
}

/**
 * 执行 RAG 搜索测试
 */
export async function testRagSearch(params: RagSearchTestParams): Promise<RagSearchTestResult> {
  const startTime = Date.now();
  const { query, lat, lng, radiusKm = 5, userId, limit = 20 } = params;
  
  // 生成查询向量
  const embeddingStart = Date.now();
  const queryVector = await generateEmbedding(query);
  const embeddingTimeMs = Date.now() - embeddingStart;
  
  // 执行搜索
  const searchStart = Date.now();
  const searchResults = await search({
    semanticQuery: query,
    filters: {
      location: lat && lng ? { lat, lng, radiusInKm: radiusKm } : undefined,
    },
    limit,
    userId: userId || null,
  });
  const searchTimeMs = Date.now() - searchStart;
  
  const totalTimeMs = Date.now() - startTime;
  
  // 计算 MaxSim 提升
  let interestVectors: Awaited<ReturnType<typeof getInterestVectors>> = [];
  if (userId) {
    try {
      interestVectors = await getInterestVectors(userId);
    } catch {
      // 忽略错误
    }
  }
  
  return {
    results: searchResults.map(r => {
      const baseScore = r.score;
      let maxSimBoost = 0;
      
      if (interestVectors.length > 0 && queryVector) {
        const maxSim = calculateMaxSim(queryVector, interestVectors);
        if (maxSim > 0.5) {
          maxSimBoost = Math.round(maxSim * 20); // 最多 20% 提升
        }
      }
      
      return {
        activityId: r.activity.id,
        title: r.activity.title,
        type: r.activity.type,
        locationName: r.activity.locationName,
        startAt: r.activity.startAt.toISOString(),
        similarity: Math.round(baseScore * 100) / 100,
        distance: r.distance ? Math.round(r.distance) : null,
        finalScore: Math.round(r.score * 100) / 100,
        maxSimBoost,
      };
    }),
    performance: {
      embeddingTimeMs,
      searchTimeMs,
      totalTimeMs,
    },
    query,
    totalResults: searchResults.length,
  };
}

/**
 * 重建单个活动索引
 */
export async function rebuildActivityIndex(activityId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const [activity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);
    
    if (!activity) {
      return { success: false, error: '活动不存在' };
    }
    
    await indexActivity(activity);
    logger.info('Activity index rebuilt', { activityId });
    
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to rebuild activity index', { activityId, error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * 批量回填状态
 */
export interface BackfillStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  success: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
  startedAt: string | null;
  completedAt: string | null;
}

// 全局回填状态（简化实现，生产环境应使用 Redis）
let backfillState: BackfillStatus = {
  status: 'idle',
  total: 0,
  processed: 0,
  success: 0,
  failed: 0,
  errors: [],
  startedAt: null,
  completedAt: null,
};

/**
 * 开始批量回填
 */
export async function startBackfill(): Promise<{ started: boolean; message: string }> {
  if (backfillState.status === 'running') {
    return { started: false, message: '回填任务正在进行中' };
  }
  
  // 获取未索引的活动
  const unindexedActivities = await db
    .select()
    .from(activities)
    .where(sql`${activities.status} = 'active' AND ${activities.embedding} IS NULL`);
  
  if (unindexedActivities.length === 0) {
    return { started: false, message: '没有需要索引的活动' };
  }
  
  // 重置状态
  backfillState = {
    status: 'running',
    total: unindexedActivities.length,
    processed: 0,
    success: 0,
    failed: 0,
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  
  // 异步执行回填
  (async () => {
    try {
      const result = await indexActivities(unindexedActivities, {
        batchSize: 10,
        delayMs: 200,
      });
      
      backfillState.success = result.success;
      backfillState.failed = result.failed;
      backfillState.errors = result.errors;
      backfillState.processed = result.success + result.failed;
      backfillState.status = 'completed';
      backfillState.completedAt = new Date().toISOString();
      
      logger.info('Backfill completed', { success: result.success, failed: result.failed });
    } catch (error) {
      backfillState.status = 'failed';
      backfillState.completedAt = new Date().toISOString();
      logger.error('Backfill failed', { error });
    }
  })();
  
  return { started: true, message: `开始回填 ${unindexedActivities.length} 个活动` };
}

/**
 * 获取回填状态
 */
export function getBackfillStatus(): BackfillStatus {
  return { ...backfillState };
}

// ==========================================
// Memory 运营 API
// ==========================================

/**
 * 用户画像信息
 */
export interface UserMemoryProfile {
  userId: string;
  nickname: string | null;
  preferences: Array<{
    category: string;
    value: string;
    sentiment: 'like' | 'dislike' | 'neutral';
    confidence: number;
  }>;
  frequentLocations: string[];
  interestVectors: Array<{
    activityId: string;
    activityTitle: string;
    participatedAt: string;
    feedback: string | null;
  }>;
  lastUpdated: string | null;
}

/**
 * 获取用户画像
 */
export async function getUserMemoryProfile(userId: string): Promise<UserMemoryProfile | null> {
  // 获取用户基本信息
  const [user] = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      workingMemory: users.workingMemory,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  
  if (!user) {
    return null;
  }
  
  // 解析增强版用户画像
  const profile = await getEnhancedUserProfileWithVectors(userId);
  
  // 获取兴趣向量关联的活动标题
  const interestVectors = profile.interestVectors || [];
  const activityIds = interestVectors.map(v => v.activityId);
  
  let activityTitles: Map<string, string> = new Map();
  if (activityIds.length > 0) {
    const activityList = await db
      .select({ id: activities.id, title: activities.title })
      .from(activities)
      .where(inArray(activities.id, activityIds));
    activityTitles = new Map(activityList.map(a => [a.id, a.title]));
  }
  
  return {
    userId: user.id,
    nickname: user.nickname,
    preferences: profile.preferences.map(p => ({
      category: 'activity_type',
      value: p,
      sentiment: 'like' as const,
      confidence: 0.5,
    })),
    frequentLocations: profile.frequentLocations,
    interestVectors: interestVectors.map(v => ({
      activityId: v.activityId,
      activityTitle: activityTitles.get(v.activityId) || '未知活动',
      participatedAt: v.participatedAt.toISOString(),
      feedback: v.feedback || null,
    })),
    lastUpdated: profile.lastUpdated?.toISOString() || null,
  };
}

/**
 * 搜索用户
 */
export async function searchUsers(query: string, limit: number = 10): Promise<Array<{
  id: string;
  nickname: string | null;
  phoneNumber: string | null;
}>> {
  const safeQuery = query.trim();
  const results = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      phoneNumber: users.phoneNumber,
    })
    .from(users)
    .where(sql`${users.nickname} ILIKE ${'%' + safeQuery + '%'} OR ${users.id}::text = ${safeQuery}`)
    .limit(limit);
  
  return results;
}

/**
 * MaxSim 测试参数
 */
export interface MaxSimTestParams {
  userId: string;
  query: string;
}

/**
 * MaxSim 测试结果
 */
export interface MaxSimTestResult {
  query: string;
  maxSimScore: number;
  matchedVector: {
    activityId: string;
    activityTitle: string;
    similarity: number;
  } | null;
  allVectors: Array<{
    activityId: string;
    activityTitle: string;
    similarity: number;
  }>;
}

/**
 * 测试 MaxSim 计算
 */
export async function testMaxSim(params: MaxSimTestParams): Promise<MaxSimTestResult> {
  const { userId, query } = params;
  
  // 生成查询向量
  const queryVector = await generateEmbedding(query);
  
  // 获取用户兴趣向量
  const interestVectors = await getInterestVectors(userId);
  
  if (interestVectors.length === 0 || !queryVector) {
    return {
      query,
      maxSimScore: 0,
      matchedVector: null,
      allVectors: [],
    };
  }
  
  // 获取活动标题
  const activityIds = interestVectors.map(v => v.activityId);
  const activityList = await db
    .select({ id: activities.id, title: activities.title })
    .from(activities)
    .where(inArray(activities.id, activityIds));
  const activityTitles = new Map(activityList.map(a => [a.id, a.title]));
  
  // 计算每个向量的相似度
  const similarities = interestVectors.map(v => {
    const sim = calculateMaxSim(queryVector, [v]);
    return {
      activityId: v.activityId,
      activityTitle: activityTitles.get(v.activityId) || '未知活动',
      similarity: Math.round(sim * 100) / 100,
    };
  });
  
  // 找到最大相似度
  const maxSim = Math.max(...similarities.map(s => s.similarity));
  const matchedVector = similarities.find(s => s.similarity === maxSim) || null;
  
  return {
    query,
    maxSimScore: maxSim,
    matchedVector,
    allVectors: similarities.sort((a, b) => b.similarity - a.similarity),
  };
}

// ==========================================
// Security 运营 API
// ==========================================

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
  // TODO: 实现真实的统计逻辑，当前返回模拟数据
  // 需要添加安全事件日志表来记录拦截和违规
  
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
      pendingModeration: 0, // 当前没有审核队列表
      sensitiveWordsCount: 15, // 硬编码的敏感词数量
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
 * 敏感词列表（从 input-guard.ts 导出）
 * TODO: 后续应该存储到数据库
 */
const SENSITIVE_WORDS_STORE = new Set([
  '习近平', '共产党', '六四', '天安门', '法轮功',
  '杀人', '自杀', '炸弹', '枪支',
  '色情', '裸体', '性交',
  '刷单', '兼职赚钱', '高额回报',
]);

/**
 * 获取敏感词列表
 */
export function getSensitiveWords(): { words: string[]; total: number } {
  const words = Array.from(SENSITIVE_WORDS_STORE);
  return {
    words,
    total: words.length,
  };
}

/**
 * 添加敏感词
 */
export function addSensitiveWord(word: string): { success: boolean; message: string } {
  if (SENSITIVE_WORDS_STORE.has(word)) {
    return { success: false, message: '敏感词已存在' };
  }
  SENSITIVE_WORDS_STORE.add(word);
  logger.info('Sensitive word added', { word });
  return { success: true, message: '添加成功' };
}

/**
 * 删除敏感词
 */
export function deleteSensitiveWord(word: string): { success: boolean; message: string } {
  if (!SENSITIVE_WORDS_STORE.has(word)) {
    return { success: false, message: '敏感词不存在' };
  }
  SENSITIVE_WORDS_STORE.delete(word);
  logger.info('Sensitive word deleted', { word });
  return { success: true, message: '删除成功' };
}

/**
 * 批量导入敏感词
 */
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
 * 审核队列项
 * TODO: 需要添加审核队列表
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

/**
 * 获取审核队列
 * TODO: 实现真实的审核队列逻辑
 */
export async function getModerationQueue(_page: number = 1, _limit: number = 20): Promise<{
  items: ModerationItem[];
  total: number;
  pendingCount: number;
}> {
  // 当前返回空列表，需要添加审核队列表后实现
  return {
    items: [],
    total: 0,
    pendingCount: 0,
  };
}

/**
 * 审核通过
 */
export async function approveModeration(_id: string): Promise<{ success: boolean; message: string }> {
  // TODO: 实现审核通过逻辑
  return { success: true, message: '审核通过' };
}

/**
 * 审核拒绝
 */
export async function rejectModeration(_id: string): Promise<{ success: boolean; message: string }> {
  // TODO: 实现审核拒绝逻辑
  return { success: true, message: '审核拒绝' };
}

/**
 * 审核拒绝并封号
 */
export async function banModeration(_id: string): Promise<{ success: boolean; message: string }> {
  // TODO: 实现审核拒绝并封号逻辑
  // 1. 标记审核项为 rejected
  // 2. 删除违规内容（如果是活动/消息）
  // 3. 封禁用户账号
  // 4. 记录操作日志
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

/**
 * 获取违规统计（从 ai_security_events 表聚合真实数据）
 */
export async function getViolationStats(): Promise<ViolationStats> {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 30);
  
  // 获取真实统计数据
  const stats = await getSecurityStatsFromDB(startDate, today);
  
  // 计算总数和按类型分布
  const total = stats.totalEvents;
  const byType = stats.eventsByType.map(e => ({
    type: e.eventType === 'input_blocked' ? '输入拦截' : 
          e.eventType === 'output_blocked' ? '输出拦截' :
          e.eventType === 'rate_limited' ? '频率限制' : e.eventType,
    count: e.count,
    percentage: total > 0 ? Math.round((e.count / total) * 100) : 0,
  }));
  
  // 补全 30 天趋势数据（没有数据的日期填 0）
  const trendMap = new Map(stats.eventsByDay.map(d => [d.date, d.count]));
  const trend: ViolationStats['trend'] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    trend.push({
      date: dateStr,
      count: trendMap.get(dateStr) || 0,
    });
  }
  
  // 获取高频违规用户
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
  
  // 获取用户昵称
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
    avgReviewTimeMinutes: 0, // 无审核流程
    byType: byType.length > 0 ? byType : [
      { type: '输入拦截', count: 0, percentage: 0 },
    ],
    trend,
    topUsers: topUsersResult.map(u => ({
      userId: u.userId || '',
      nickname: u.userId ? nicknameMap.get(u.userId) || null : null,
      count: Number(u.count),
    })),
  };
}

// ==========================================
// 对话质量监控 API (v4.6)
// ==========================================

/**
 * 质量指标查询参数
 */
export interface QualityMetricsQuery {
  startDate: Date;
  endDate: Date;
  groupBy?: 'day' | 'hour';
}

/**
 * 质量指标响应
 */
export interface QualityMetricsResponse {
  summary: {
    totalConversations: number;
    avgQualityScore: number;
    intentRecognitionRate: number;
    toolSuccessRate: number;
  };
  daily: Array<{
    date: string;
    conversations: number;
    avgQualityScore: number;
    intentRecognitionRate: number;
    toolSuccessRate: number;
  }>;
  intentDistribution: Array<{
    intent: string;
    count: number;
    percentage: number;
  }>;
}

/**
 * 获取对话质量指标
 */
export async function getQualityMetrics(query: QualityMetricsQuery): Promise<QualityMetricsResponse> {
  const { startDate, endDate } = query;
  
  // 获取汇总数据
  const [summaryResult] = await db
    .select({
      totalConversations: sql<number>`count(*)`,
      avgQualityScore: sql<number>`coalesce(avg(${aiConversationMetrics.qualityScore}), 0)`,
      intentRecognizedCount: sql<number>`sum(case when ${aiConversationMetrics.intentRecognized} = true then 1 else 0 end)`,
      totalToolsCalled: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded} + ${aiConversationMetrics.toolsFailed}), 0)`,
      totalToolsSucceeded: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded}), 0)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      lte(aiConversationMetrics.createdAt, toTimestamp(endDate))
    ));
  
  const total = Number(summaryResult?.totalConversations || 0);
  const intentRecognized = Number(summaryResult?.intentRecognizedCount || 0);
  const toolsCalled = Number(summaryResult?.totalToolsCalled || 0);
  const toolsSucceeded = Number(summaryResult?.totalToolsSucceeded || 0);
  
  // 获取每日趋势
  const dailyResults = await db
    .select({
      date: sql<string>`date(${aiConversationMetrics.createdAt})`,
      conversations: sql<number>`count(*)`,
      avgQualityScore: sql<number>`coalesce(avg(${aiConversationMetrics.qualityScore}), 0)`,
      intentRecognizedCount: sql<number>`sum(case when ${aiConversationMetrics.intentRecognized} = true then 1 else 0 end)`,
      totalToolsCalled: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded} + ${aiConversationMetrics.toolsFailed}), 0)`,
      totalToolsSucceeded: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded}), 0)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      lte(aiConversationMetrics.createdAt, toTimestamp(endDate))
    ))
    .groupBy(sql`date(${aiConversationMetrics.createdAt})`)
    .orderBy(sql`date(${aiConversationMetrics.createdAt})`);
  
  // 获取意图分布
  const intentResults = await db
    .select({
      intent: aiConversationMetrics.intent,
      count: sql<number>`count(*)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      lte(aiConversationMetrics.createdAt, toTimestamp(endDate)),
      isNotNull(aiConversationMetrics.intent)
    ))
    .groupBy(aiConversationMetrics.intent);
  
  return {
    summary: {
      totalConversations: total,
      avgQualityScore: Math.round(Number(summaryResult?.avgQualityScore || 0) * 100) / 100,
      intentRecognitionRate: total > 0 ? Math.round((intentRecognized / total) * 100) / 100 : 0,
      toolSuccessRate: toolsCalled > 0 ? Math.round((toolsSucceeded / toolsCalled) * 100) / 100 : 0,
    },
    daily: dailyResults.map(d => {
      const dayTotal = Number(d.conversations);
      const dayIntentRecognized = Number(d.intentRecognizedCount);
      const dayToolsCalled = Number(d.totalToolsCalled);
      const dayToolsSucceeded = Number(d.totalToolsSucceeded);
      
      return {
        date: d.date,
        conversations: dayTotal,
        avgQualityScore: Math.round(Number(d.avgQualityScore) * 100) / 100,
        intentRecognitionRate: dayTotal > 0 ? Math.round((dayIntentRecognized / dayTotal) * 100) / 100 : 0,
        toolSuccessRate: dayToolsCalled > 0 ? Math.round((dayToolsSucceeded / dayToolsCalled) * 100) / 100 : 0,
      };
    }),
    intentDistribution: intentResults.map(i => ({
      intent: i.intent || 'unknown',
      count: Number(i.count),
      percentage: total > 0 ? Math.round((Number(i.count) / total) * 100) : 0,
    })),
  };
}

// ==========================================
// 转化率追踪 API (v4.6)
// ==========================================

/**
 * 转化指标查询参数
 */
export interface ConversionMetricsQuery {
  startDate: Date;
  endDate: Date;
  intent?: string;
}

/**
 * 转化指标响应
 */
export interface ConversionMetricsResponse {
  funnel: {
    conversations: number;
    intentRecognized: number;
    toolCalled: number;
    activityCreatedOrJoined: number;
  };
  conversionRates: {
    intentToTool: number;
    toolToActivity: number;
    overall: number;
  };
  byIntent: Array<{
    intent: string;
    conversations: number;
    converted: number;
    conversionRate: number;
  }>;
}

/**
 * 获取转化率指标
 */
export async function getConversionMetrics(query: ConversionMetricsQuery): Promise<ConversionMetricsResponse> {
  const { startDate, endDate, intent } = query;
  
  // 构建查询条件
  const conditions = [
    gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
    lte(aiConversationMetrics.createdAt, toTimestamp(endDate)),
  ];
  if (intent) {
    conditions.push(eq(aiConversationMetrics.intent, intent));
  }
  
  // 获取漏斗数据
  const [funnelResult] = await db
    .select({
      conversations: sql<number>`count(*)`,
      intentRecognized: sql<number>`sum(case when ${aiConversationMetrics.intentRecognized} = true then 1 else 0 end)`,
      toolCalled: sql<number>`sum(case when jsonb_array_length(${aiConversationMetrics.toolsCalled}) > 0 then 1 else 0 end)`,
      activityCreatedOrJoined: sql<number>`sum(case when ${aiConversationMetrics.activityCreated} = true or ${aiConversationMetrics.activityJoined} = true then 1 else 0 end)`,
    })
    .from(aiConversationMetrics)
    .where(and(...conditions));
  
  const conversations = Number(funnelResult?.conversations || 0);
  const intentRecognized = Number(funnelResult?.intentRecognized || 0);
  const toolCalled = Number(funnelResult?.toolCalled || 0);
  const activityCreatedOrJoined = Number(funnelResult?.activityCreatedOrJoined || 0);
  
  // 获取按意图分析
  const byIntentResults = await db
    .select({
      intent: aiConversationMetrics.intent,
      conversations: sql<number>`count(*)`,
      converted: sql<number>`sum(case when ${aiConversationMetrics.activityCreated} = true or ${aiConversationMetrics.activityJoined} = true then 1 else 0 end)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      lte(aiConversationMetrics.createdAt, toTimestamp(endDate)),
      isNotNull(aiConversationMetrics.intent)
    ))
    .groupBy(aiConversationMetrics.intent);
  
  return {
    funnel: {
      conversations,
      intentRecognized,
      toolCalled,
      activityCreatedOrJoined,
    },
    conversionRates: {
      intentToTool: intentRecognized > 0 ? Math.round((toolCalled / intentRecognized) * 100) / 100 : 0,
      toolToActivity: toolCalled > 0 ? Math.round((activityCreatedOrJoined / toolCalled) * 100) / 100 : 0,
      overall: conversations > 0 ? Math.round((activityCreatedOrJoined / conversations) * 100) / 100 : 0,
    },
    byIntent: byIntentResults.map(i => {
      const conv = Number(i.conversations);
      const converted = Number(i.converted);
      return {
        intent: i.intent || 'unknown',
        conversations: conv,
        converted,
        conversionRate: conv > 0 ? Math.round((converted / conv) * 100) / 100 : 0,
      };
    }),
  };
}

// ==========================================
// Playground 统计 API (v4.6)
// ==========================================

/**
 * Playground 统计响应
 */
export interface PlaygroundStatsResponse {
  intentDistribution: Array<{
    intent: string;
    count: number;
    percentage: number;
  }>;
  toolStats: Array<{
    toolName: string;
    totalCalls: number;
    successCount: number;
    failureCount: number;
    successRate: number;
  }>;
  recentErrors: Array<{
    timestamp: string;
    intent: string;
    toolName: string;
    errorMessage: string;
  }>;
}

/**
 * 获取 Playground 统计数据
 */
export async function getPlaygroundStats(): Promise<PlaygroundStatsResponse> {
  // 最近 7 天的数据
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  // 获取意图分布
  const intentResults = await db
    .select({
      intent: aiConversationMetrics.intent,
      count: sql<number>`count(*)`,
    })
    .from(aiConversationMetrics)
    .where(and(
      gte(aiConversationMetrics.createdAt, toTimestamp(startDate)),
      isNotNull(aiConversationMetrics.intent)
    ))
    .groupBy(aiConversationMetrics.intent);
  
  const totalIntents = intentResults.reduce((sum, i) => sum + Number(i.count), 0);
  
  // 获取 Tool 统计（从 toolsCalled JSONB 聚合）
  const toolResults = await db
    .select({
      toolsSucceeded: sql<number>`coalesce(sum(${aiConversationMetrics.toolsSucceeded}), 0)`,
      toolsFailed: sql<number>`coalesce(sum(${aiConversationMetrics.toolsFailed}), 0)`,
    })
    .from(aiConversationMetrics)
    .where(gte(aiConversationMetrics.createdAt, toTimestamp(startDate)));
  
  const totalSucceeded = Number(toolResults[0]?.toolsSucceeded || 0);
  const totalFailed = Number(toolResults[0]?.toolsFailed || 0);
  const totalCalls = totalSucceeded + totalFailed;
  
  return {
    intentDistribution: intentResults.map(i => ({
      intent: i.intent || 'unknown',
      count: Number(i.count),
      percentage: totalIntents > 0 ? Math.round((Number(i.count) / totalIntents) * 100) : 0,
    })),
    toolStats: [{
      toolName: 'all_tools',
      totalCalls,
      successCount: totalSucceeded,
      failureCount: totalFailed,
      successRate: totalCalls > 0 ? Math.round((totalSucceeded / totalCalls) * 100) / 100 : 0,
    }],
    recentErrors: [], // TODO: 需要单独的错误日志表
  };
}

// ==========================================
// Security 持久化 API (v4.6)
// ==========================================

// 敏感词缓存
let sensitiveWordsCache: string[] = [];

/**
 * 加载敏感词到缓存
 */
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

/**
 * 获取敏感词缓存
 */
export function getSensitiveWordsCache(): string[] {
  return sensitiveWordsCache;
}

/**
 * 从数据库获取敏感词列表
 */
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

/**
 * 添加敏感词到数据库
 */
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
    
    // 刷新缓存
    await loadSensitiveWordsCache();
    
    logger.info('Sensitive word added to DB', { word, id: result.id });
    return { success: true, message: '添加成功', id: result.id };
  } catch (error: any) {
    if (error.code === '23505') { // unique violation
      return { success: false, message: '敏感词已存在' };
    }
    logger.error('Failed to add sensitive word', { error: error.message });
    return { success: false, message: error.message || '添加失败' };
  }
}

/**
 * 从数据库删除敏感词
 */
export async function deleteSensitiveWordFromDB(id: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await db
      .delete(aiSensitiveWords)
      .where(eq(aiSensitiveWords.id, id))
      .returning({ id: aiSensitiveWords.id });
    
    if (result.length === 0) {
      return { success: false, message: '敏感词不存在' };
    }
    
    // 刷新缓存
    await loadSensitiveWordsCache();
    
    logger.info('Sensitive word deleted from DB', { id });
    return { success: true, message: '删除成功' };
  } catch (error: any) {
    logger.error('Failed to delete sensitive word', { error: error.message });
    return { success: false, message: error.message || '删除失败' };
  }
}

/**
 * 记录安全事件到数据库
 */
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

/**
 * 获取安全事件列表
 */
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

/**
 * 获取真实的安全统计数据
 */
export async function getSecurityStatsFromDB(startDate: Date, endDate: Date): Promise<{
  totalEvents: number;
  eventsByType: Array<{ eventType: string; count: number }>;
  eventsByDay: Array<{ date: string; count: number }>;
  topTriggerWords: Array<{ word: string; count: number }>;
}> {
  // 获取总事件数
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(aiSecurityEvents)
    .where(and(
      gte(aiSecurityEvents.createdAt, toTimestamp(startDate)),
      lte(aiSecurityEvents.createdAt, toTimestamp(endDate))
    ));
  
  // 按类型统计
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
  
  // 按天统计
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
  
  // 高频触发词
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


// ==========================================
// v4.6: AI 健康度指标 (Dashboard)
// ==========================================

import { conversations } from '@juchang/db';

/**
 * AI 健康度指标
 */
export interface AIHealthMetrics {
  // Bad Case 占比
  badCaseRate: number;
  badCaseCount: number;
  totalEvaluated: number;
  // Tool 错误率
  toolErrorRate: number;
  errorSessionCount: number;
  totalSessions: number;
  // 与上周对比
  badCaseTrend: number; // 正数表示上升，负数表示下降
  toolErrorTrend: number;
}

/**
 * 获取 AI 健康度指标
 */
export async function getAIHealthMetrics(): Promise<AIHealthMetrics> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  
  // 本周数据
  const [thisWeekTotal] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(gte(conversations.createdAt, toTimestamp(oneWeekAgo)));
  
  const [thisWeekBad] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      eq(conversations.evaluationStatus, 'bad')
    ));
  
  const [thisWeekError] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      eq(conversations.hasError, true)
    ));
  
  const [thisWeekEvaluated] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      sql`${conversations.evaluationStatus} != 'unreviewed'`
    ));
  
  // 上周数据（用于趋势对比）
  const [lastWeekBad] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(twoWeeksAgo)),
      lte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      eq(conversations.evaluationStatus, 'bad')
    ));
  
  const [lastWeekError] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(twoWeeksAgo)),
      lte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      eq(conversations.hasError, true)
    ));
  
  const [lastWeekEvaluated] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(twoWeeksAgo)),
      lte(conversations.createdAt, toTimestamp(oneWeekAgo)),
      sql`${conversations.evaluationStatus} != 'unreviewed'`
    ));
  
  const [lastWeekTotal] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(and(
      gte(conversations.createdAt, toTimestamp(twoWeeksAgo)),
      lte(conversations.createdAt, toTimestamp(oneWeekAgo))
    ));
  
  // 计算指标
  const totalSessions = Number(thisWeekTotal?.count || 0);
  const badCaseCount = Number(thisWeekBad?.count || 0);
  const errorSessionCount = Number(thisWeekError?.count || 0);
  const totalEvaluated = Number(thisWeekEvaluated?.count || 0);
  
  const badCaseRate = totalEvaluated > 0 ? badCaseCount / totalEvaluated : 0;
  const toolErrorRate = totalSessions > 0 ? errorSessionCount / totalSessions : 0;
  
  // 计算趋势
  const lastWeekBadCount = Number(lastWeekBad?.count || 0);
  const lastWeekErrorCount = Number(lastWeekError?.count || 0);
  const lastWeekEvaluatedCount = Number(lastWeekEvaluated?.count || 0);
  const lastWeekTotalCount = Number(lastWeekTotal?.count || 0);
  
  const lastWeekBadRate = lastWeekEvaluatedCount > 0 ? lastWeekBadCount / lastWeekEvaluatedCount : 0;
  const lastWeekErrorRate = lastWeekTotalCount > 0 ? lastWeekErrorCount / lastWeekTotalCount : 0;
  
  const badCaseTrend = badCaseRate - lastWeekBadRate;
  const toolErrorTrend = toolErrorRate - lastWeekErrorRate;
  
  return {
    badCaseRate,
    badCaseCount,
    totalEvaluated,
    toolErrorRate,
    errorSessionCount,
    totalSessions,
    badCaseTrend,
    toolErrorTrend,
  };
}

// Dashboard Service - MVP 简化版：只保留 Admin 基础统计
import { db, users, activities, participants, eq, gte, desc, count, and, lte, lt, sql, inArray, not, partnerIntents, intentMatches, conversations } from '@juchang/db';
import type { 
  DashboardStats, 
  RecentActivity, 
  UserGrowthItem, 
  ActivityTypeDistribution, 
  GeographicItem,
  BenchmarkStatus,
  J2CMetric,
  WeeklyCompletedMetric,
  MetricItem,
  BusinessMetrics,
  IntentMetrics,
  GodViewData,
} from './dashboard.model';

/**
 * 获取仪表板统计数据
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const [
      totalUsersResult,
      totalActivitiesResult,
      activeActivitiesResult,
      todayNewUsersResult,
    ] = await Promise.all([
      db.select({ count: count() }).from(users),
      db.select({ count: count() }).from(activities),
      db.select({ count: count() })
        .from(activities)
        .where(eq(activities.status, 'active')),
      db.select({ count: count() })
        .from(users)
        .where(gte(users.createdAt, today)),
    ]);

    return {
      totalUsers: totalUsersResult[0]?.count || 0,
      totalActivities: totalActivitiesResult[0]?.count || 0,
      activeActivities: activeActivitiesResult[0]?.count || 0,
      todayNewUsers: todayNewUsersResult[0]?.count || 0,
    };
  } catch (error) {
    console.error('获取仪表板统计数据失败:', error);
    return {
      totalUsers: 0,
      totalActivities: 0,
      activeActivities: 0,
      todayNewUsers: 0,
    };
  }
}

/**
 * 获取最近活动列表
 */
export async function getRecentActivities(): Promise<RecentActivity[]> {
  try {
    const result = await db
      .select({
        id: activities.id,
        title: activities.title,
        creatorName: users.nickname,
        status: activities.status,
        currentParticipants: activities.currentParticipants,
        createdAt: activities.createdAt,
      })
      .from(activities)
      .innerJoin(users, eq(activities.creatorId, users.id))
      .orderBy(desc(activities.createdAt))
      .limit(10);

    return result.map((activity) => ({
      id: activity.id,
      title: activity.title,
      creatorName: activity.creatorName || '未知用户',
      participantCount: activity.currentParticipants || 0,
      status: activity.status,
      createdAt: activity.createdAt?.toISOString() || '',
    }));
  } catch (error) {
    console.error('获取最近活动失败:', error);
    return [];
  }
}

/**
 * 获取用户增长趋势数据（过去N天）
 */
export async function getUserGrowthTrend(days: number = 30): Promise<UserGrowthItem[]> {
  try {
    const result: UserGrowthItem[] = [];
    const now = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      // 获取截止到该日期的总用户数
      const [totalResult] = await db
        .select({ count: count() })
        .from(users)
        .where(lte(users.createdAt, nextDate));
      
      // 获取当天新增用户数
      const [newResult] = await db
        .select({ count: count() })
        .from(users)
        .where(and(
          gte(users.createdAt, date),
          lte(users.createdAt, nextDate)
        ));
      
      result.push({
        date: date.toISOString().split('T')[0],
        totalUsers: totalResult?.count || 0,
        newUsers: newResult?.count || 0,
        activeUsers: Math.floor((totalResult?.count || 0) * 0.3), // MVP: 估算活跃用户
      });
    }
    
    return result;
  } catch (error) {
    console.error('获取用户增长趋势失败:', error);
    return [];
  }
}

/**
 * 获取活动类型分布
 */
export async function getActivityTypeDistribution(): Promise<ActivityTypeDistribution> {
  try {
    const result = await db
      .select({
        type: activities.type,
        count: count(),
      })
      .from(activities)
      .groupBy(activities.type);
    
    const distribution: ActivityTypeDistribution = {
      food: 0,
      sports: 0,
      entertainment: 0,
      boardgame: 0,
      other: 0,
    };
    
    for (const row of result) {
      const type = row.type as keyof ActivityTypeDistribution;
      if (type in distribution) {
        distribution[type] = row.count;
      } else {
        distribution.other += row.count;
      }
    }
    
    return distribution;
  } catch (error) {
    console.error('获取活动类型分布失败:', error);
    return { food: 0, sports: 0, entertainment: 0, boardgame: 0, other: 0 };
  }
}

/**
 * 获取地理分布数据
 * MVP: 基于活动的 locationName 字段简单统计
 */
export async function getGeographicDistribution(): Promise<GeographicItem[]> {
  try {
    // MVP: 返回基于城市的简单统计
    // 由于当前数据主要在重庆，返回重庆各区的分布
    const regions = ['重庆', '成都', '贵阳', '昆明', '其他'];
    const result: GeographicItem[] = [];
    
    // 获取总用户数和活动数用于分配
    const [totalUsers] = await db.select({ count: count() }).from(users);
    const [totalActivities] = await db.select({ count: count() }).from(activities);
    
    const userCount = totalUsers?.count || 0;
    const activityCount = totalActivities?.count || 0;
    
    // MVP: 按比例分配（重庆为主）
    const ratios = [0.6, 0.2, 0.1, 0.05, 0.05];
    
    for (let i = 0; i < regions.length; i++) {
      result.push({
        name: regions[i],
        users: Math.floor(userCount * ratios[i]),
        activities: Math.floor(activityCount * ratios[i]),
      });
    }
    
    return result;
  } catch (error) {
    console.error('获取地理分布失败:', error);
    return [];
  }
}


// ==========================================
// 核心业务指标计算 (PRD 17.2-17.4)
// ==========================================

// 基准阈值配置
const BENCHMARKS = {
  j2cRate: { red: 1, yellow: 5 },           // <1% red, 1-5% yellow, >5% green
  weeklyCompleted: { red: 3, yellow: 5 },   // <3 red, 3-5 yellow, >5 green
  draftPublishRate: { red: 40, yellow: 60 }, // <40% red, 40-60% yellow, >60% green
  activitySuccessRate: { red: 30, yellow: 50 }, // <30% red, 30-50% yellow, >50% green
  weeklyRetention: { red: 10, yellow: 15 }, // <10% red, 10-15% yellow, >15% green
  oneTimeCreatorRate: { red: 50, yellow: 70 }, // <50% red, 50-70% yellow, >70% green
};

/**
 * 根据阈值返回基准状态
 */
export function getBenchmark(value: number, thresholds: { red: number; yellow: number }): BenchmarkStatus {
  if (value < thresholds.red) return 'red';
  if (value < thresholds.yellow) return 'yellow';
  return 'green';
}

/**
 * 获取本周一 00:00 的时间戳
 */
function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 周一为一周开始
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * J2C 转化率计算
 * 先参与后创建的用户数 / 历史总参与者数 × 100%
 */
export async function calculateJ2CRate(): Promise<J2CMetric> {
  try {
    // 1. 获取所有参与者的首次参与时间
    const joinersResult = await db
      .select({
        userId: participants.userId,
        firstJoinDate: sql<Date>`MIN(${participants.joinedAt})`.as('first_join_date'),
      })
      .from(participants)
      .where(eq(participants.status, 'joined'))
      .groupBy(participants.userId);

    // 2. 获取所有创建者的首次创建时间
    const creatorsResult = await db
      .select({
        creatorId: activities.creatorId,
        firstCreateDate: sql<Date>`MIN(${activities.createdAt})`.as('first_create_date'),
      })
      .from(activities)
      .where(not(eq(activities.status, 'draft'))) // 排除草稿
      .groupBy(activities.creatorId);

    // 3. 构建 Map 便于查找
    const creatorMap = new Map<string, Date>();
    for (const c of creatorsResult) {
      creatorMap.set(c.creatorId, c.firstCreateDate);
    }

    // 4. 计算先参与后创建的用户数
    let convertedUsers = 0;
    for (const j of joinersResult) {
      const firstCreateDate = creatorMap.get(j.userId);
      if (firstCreateDate && j.firstJoinDate && firstCreateDate > j.firstJoinDate) {
        convertedUsers++;
      }
    }

    const totalJoiners = joinersResult.length;
    const value = totalJoiners > 0 ? (convertedUsers / totalJoiners) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.j2cRate),
      comparison: `${convertedUsers} 人转化`,
      convertedUsers,
      totalJoiners,
    };
  } catch (error) {
    console.error('计算 J2C 转化率失败:', error);
    return {
      value: 0,
      benchmark: 'red',
      comparison: '计算失败',
      convertedUsers: 0,
      totalJoiners: 0,
    };
  }
}

/**
 * 本周成局数计算
 */
export async function getWeeklyCompletedCount(): Promise<WeeklyCompletedMetric> {
  try {
    const thisWeekStart = getWeekStart();
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    // 本周成局数
    const [thisWeekResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(and(
        eq(activities.status, 'completed'),
        gte(activities.updatedAt, thisWeekStart)
      ));

    // 上周成局数
    const [lastWeekResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(and(
        eq(activities.status, 'completed'),
        gte(activities.updatedAt, lastWeekStart),
        lt(activities.updatedAt, thisWeekStart)
      ));

    const value = thisWeekResult?.count || 0;
    const lastWeekValue = lastWeekResult?.count || 0;
    const diff = value - lastWeekValue;
    const comparison = diff >= 0 ? `较上周 +${diff}` : `较上周 ${diff}`;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.weeklyCompleted),
      comparison,
      lastWeekValue,
    };
  } catch (error) {
    console.error('计算本周成局数失败:', error);
    return {
      value: 0,
      benchmark: 'red',
      comparison: '计算失败',
      lastWeekValue: 0,
    };
  }
}

/**
 * 草稿发布转化率计算
 * (active + completed + cancelled) / total × 100%
 */
export async function calculateDraftPublishRate(): Promise<MetricItem> {
  try {
    const [totalResult] = await db.select({ count: count() }).from(activities);
    const [publishedResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(inArray(activities.status, ['active', 'completed', 'cancelled']));

    const total = totalResult?.count || 0;
    const published = publishedResult?.count || 0;
    const value = total > 0 ? (published / total) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.draftPublishRate),
      comparison: `${published}/${total} 已发布`,
    };
  } catch (error) {
    console.error('计算草稿发布率失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

/**
 * 活动成局率计算
 * completed / (active + completed + cancelled) × 100%
 */
export async function calculateActivitySuccessRate(): Promise<MetricItem> {
  try {
    const [completedResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(eq(activities.status, 'completed'));

    const [publishedResult] = await db
      .select({ count: count() })
      .from(activities)
      .where(inArray(activities.status, ['active', 'completed', 'cancelled']));

    const completed = completedResult?.count || 0;
    const published = publishedResult?.count || 0;
    const value = published > 0 ? (completed / published) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.activitySuccessRate),
      comparison: `${completed}/${published} 成局`,
    };
  } catch (error) {
    console.error('计算活动成局率失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

/**
 * 周留存率计算
 * 本周活跃且上周也活跃的用户 / 上周活跃用户 × 100%
 * 使用 participants 表作为"活跃"的代理
 */
export async function calculateWeeklyRetention(): Promise<MetricItem> {
  try {
    const thisWeekStart = getWeekStart();
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    // 本周活跃用户 (有参与记录)
    const thisWeekUsers = await db
      .selectDistinct({ userId: participants.userId })
      .from(participants)
      .where(gte(participants.joinedAt, thisWeekStart));

    // 上周活跃用户
    const lastWeekUsers = await db
      .selectDistinct({ userId: participants.userId })
      .from(participants)
      .where(and(
        gte(participants.joinedAt, lastWeekStart),
        lt(participants.joinedAt, thisWeekStart)
      ));

    const thisWeekSet = new Set(thisWeekUsers.map(u => u.userId));
    const lastWeekSet = new Set(lastWeekUsers.map(u => u.userId));

    // 计算交集
    let retained = 0;
    for (const userId of lastWeekSet) {
      if (thisWeekSet.has(userId)) {
        retained++;
      }
    }

    const lastWeekCount = lastWeekSet.size;
    const value = lastWeekCount > 0 ? (retained / lastWeekCount) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.weeklyRetention),
      comparison: `${retained}/${lastWeekCount} 留存`,
    };
  } catch (error) {
    console.error('计算周留存率失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

/**
 * 一次性群主占比计算
 * 创建 1-3 次活动的用户 / 总创建者 × 100%
 */
export async function calculateOneTimeCreatorRate(): Promise<MetricItem> {
  try {
    // 按用户分组统计创建活动数
    const creatorStats = await db
      .select({
        creatorId: activities.creatorId,
        activityCount: count().as('activity_count'),
      })
      .from(activities)
      .where(not(eq(activities.status, 'draft'))) // 排除草稿
      .groupBy(activities.creatorId);

    const totalCreators = creatorStats.length;
    const casualCreators = creatorStats.filter(c => c.activityCount >= 1 && c.activityCount <= 3).length;
    const value = totalCreators > 0 ? (casualCreators / totalCreators) * 100 : 0;

    return {
      value,
      benchmark: getBenchmark(value, BENCHMARKS.oneTimeCreatorRate),
      comparison: `${casualCreators}/${totalCreators} 一次性`,
    };
  } catch (error) {
    console.error('计算一次性群主占比失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

/**
 * 获取所有业务指标
 */
export async function getBusinessMetrics(): Promise<BusinessMetrics> {
  const [
    j2cRate,
    weeklyCompletedCount,
    draftPublishRate,
    activitySuccessRate,
    weeklyRetention,
    oneTimeCreatorRate,
  ] = await Promise.all([
    calculateJ2CRate(),
    getWeeklyCompletedCount(),
    calculateDraftPublishRate(),
    calculateActivitySuccessRate(),
    calculateWeeklyRetention(),
    calculateOneTimeCreatorRate(),
  ]);

  return {
    j2cRate,
    weeklyCompletedCount,
    draftPublishRate,
    activitySuccessRate,
    weeklyRetention,
    oneTimeCreatorRate,
  };
}


// ==========================================
// v4.0 搭子意向指标
// ==========================================

// 意向指标基准阈值
const INTENT_BENCHMARKS = {
  activeIntents: { red: 5, yellow: 20 },      // <5 red, 5-20 yellow, >20 green
  todayNewIntents: { red: 2, yellow: 5 },     // <2 red, 2-5 yellow, >5 green
  conversionRate: { red: 10, yellow: 30 },    // <10% red, 10-30% yellow, >30% green
  avgMatchTime: { red: 360, yellow: 120 },    // >360min red, 120-360 yellow, <120 green (反向)
};

/**
 * 获取搭子意向指标
 */
export async function getIntentMetrics(): Promise<IntentMetrics> {
  const [
    activeIntents,
    todayNewIntents,
    conversionRate,
    avgMatchTime,
  ] = await Promise.all([
    calculateActiveIntents(),
    calculateTodayNewIntents(),
    calculateIntentConversionRate(),
    calculateAvgMatchTime(),
  ]);

  return {
    activeIntents,
    todayNewIntents,
    conversionRate,
    avgMatchTime,
  };
}

/**
 * 活跃意向数
 */
async function calculateActiveIntents(): Promise<MetricItem> {
  try {
    const [result] = await db
      .select({ count: count() })
      .from(partnerIntents)
      .where(eq(partnerIntents.status, 'active'));

    const value = result?.count || 0;

    return {
      value,
      benchmark: getBenchmark(value, INTENT_BENCHMARKS.activeIntents),
      comparison: `${value} 个活跃`,
    };
  } catch (error) {
    console.error('计算活跃意向数失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

/**
 * 今日新增意向数
 */
async function calculateTodayNewIntents(): Promise<MetricItem> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [result] = await db
      .select({ count: count() })
      .from(partnerIntents)
      .where(gte(partnerIntents.createdAt, today));

    const value = result?.count || 0;

    return {
      value,
      benchmark: getBenchmark(value, INTENT_BENCHMARKS.todayNewIntents),
      comparison: `今日 +${value}`,
    };
  } catch (error) {
    console.error('计算今日新增意向失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

/**
 * 意向转化率 (matched / total)
 */
async function calculateIntentConversionRate(): Promise<MetricItem> {
  try {
    const [totalResult] = await db
      .select({ count: count() })
      .from(partnerIntents);

    const [matchedResult] = await db
      .select({ count: count() })
      .from(partnerIntents)
      .where(eq(partnerIntents.status, 'matched'));

    const total = totalResult?.count || 0;
    const matched = matchedResult?.count || 0;
    const value = total > 0 ? Math.round((matched / total) * 100) : 0;

    return {
      value,
      benchmark: getBenchmark(value, INTENT_BENCHMARKS.conversionRate),
      comparison: `${matched}/${total} 转化`,
    };
  } catch (error) {
    console.error('计算意向转化率失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}

/**
 * 平均匹配时长 (分钟)
 * 从意向创建到匹配成功的平均时间
 */
async function calculateAvgMatchTime(): Promise<MetricItem> {
  try {
    // 查询已匹配的意向及其匹配时间
    const matchedIntents = await db
      .select({
        intentCreatedAt: partnerIntents.createdAt,
        matchedAt: intentMatches.matchedAt,
      })
      .from(partnerIntents)
      .innerJoin(intentMatches, sql`${partnerIntents.id} IN (
        SELECT intent_id FROM intent_match_members WHERE match_id = ${intentMatches.id}
      )`)
      .where(eq(partnerIntents.status, 'matched'))
      .limit(100); // 限制查询数量

    if (matchedIntents.length === 0) {
      return {
        value: 0,
        benchmark: 'yellow',
        comparison: '暂无数据',
      };
    }

    // 计算平均时长
    let totalMinutes = 0;
    for (const intent of matchedIntents) {
      const diff = intent.matchedAt.getTime() - intent.intentCreatedAt.getTime();
      totalMinutes += diff / (1000 * 60);
    }
    const avgMinutes = Math.round(totalMinutes / matchedIntents.length);

    // 反向基准：时间越短越好
    let benchmark: 'green' | 'yellow' | 'red' = 'green';
    if (avgMinutes > INTENT_BENCHMARKS.avgMatchTime.red) {
      benchmark = 'red';
    } else if (avgMinutes > INTENT_BENCHMARKS.avgMatchTime.yellow) {
      benchmark = 'yellow';
    }

    return {
      value: avgMinutes,
      benchmark,
      comparison: avgMinutes < 60 ? `${avgMinutes} 分钟` : `${Math.round(avgMinutes / 60)} 小时`,
    };
  } catch (error) {
    console.error('计算平均匹配时长失败:', error);
    return { value: 0, benchmark: 'red', comparison: '计算失败' };
  }
}


// ==========================================
// God View 仪表盘 (Admin Cockpit Redesign)
// ==========================================

/**
 * 获取 God View 仪表盘数据
 * 聚合实时概览、北极星指标、AI 健康度、异常警报
 */
export async function getGodViewData(): Promise<GodViewData> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const oneWeekAgo = new Date(today);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // 并行获取所有数据
  const [
    // 实时概览
    activeUsersResult,
    todayActivitiesResult,
    todayConversationsResult,
    // 北极星指标
    j2cRate,
    // AI 健康度 - 本周
    thisWeekTotalResult,
    thisWeekBadResult,
    thisWeekErrorResult,
    thisWeekEvaluatedResult,
    // AI 健康度 - 上周（趋势对比）
    lastWeekBadResult,
    lastWeekErrorResult,
    lastWeekEvaluatedResult,
    lastWeekTotalResult,
    // 异常警报
    error24hResult,
    sensitiveHitsResult,
    pendingModerationResult,
  ] = await Promise.all([
    // 今日活跃用户（有参与记录或创建活动）
    db.selectDistinct({ count: sql<number>`count(distinct ${participants.userId})` })
      .from(participants)
      .where(gte(participants.joinedAt, today)),
    // 今日成局数
    db.select({ count: count() })
      .from(activities)
      .where(and(
        eq(activities.status, 'completed'),
        gte(activities.updatedAt, today)
      )),
    // 今日对话数（使用 conversations 表）
    db.select({ count: count() })
      .from(conversations)
      .where(gte(conversations.createdAt, today)),
    // J2C 转化率
    calculateJ2CRate(),
    // AI 健康度 - 本周数据
    db.select({ count: count() })
      .from(conversations)
      .where(gte(conversations.createdAt, oneWeekAgo)),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, oneWeekAgo),
        eq(conversations.evaluationStatus, 'bad')
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, oneWeekAgo),
        eq(conversations.hasError, true)
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, oneWeekAgo),
        not(eq(conversations.evaluationStatus, 'unreviewed'))
      )),
    // AI 健康度 - 上周数据
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, twoWeeksAgo),
        lt(conversations.createdAt, oneWeekAgo),
        eq(conversations.evaluationStatus, 'bad')
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, twoWeeksAgo),
        lt(conversations.createdAt, oneWeekAgo),
        eq(conversations.hasError, true)
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, twoWeeksAgo),
        lt(conversations.createdAt, oneWeekAgo),
        not(eq(conversations.evaluationStatus, 'unreviewed'))
      )),
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, twoWeeksAgo),
        lt(conversations.createdAt, oneWeekAgo)
      )),
    // 异常警报 - 24h 报错
    db.select({ count: count() })
      .from(conversations)
      .where(and(
        gte(conversations.createdAt, yesterday),
        eq(conversations.hasError, true)
      )),
    // 敏感词触发（暂时返回 0，需要 ai_security_events 表）
    Promise.resolve([{ count: 0 }]),
    // 待审核数（暂时返回 0，需要审核队列表）
    Promise.resolve([{ count: 0 }]),
  ]);

  // 计算 AI 健康度指标
  const totalSessions = Number(thisWeekTotalResult[0]?.count || 0);
  const badCaseCount = Number(thisWeekBadResult[0]?.count || 0);
  const errorSessionCount = Number(thisWeekErrorResult[0]?.count || 0);
  const totalEvaluated = Number(thisWeekEvaluatedResult[0]?.count || 0);
  
  const badCaseRate = totalEvaluated > 0 ? badCaseCount / totalEvaluated : 0;
  const toolErrorRate = totalSessions > 0 ? errorSessionCount / totalSessions : 0;
  
  // 计算趋势
  const lastWeekBadCount = Number(lastWeekBadResult[0]?.count || 0);
  const lastWeekErrorCount = Number(lastWeekErrorResult[0]?.count || 0);
  const lastWeekEvaluatedCount = Number(lastWeekEvaluatedResult[0]?.count || 0);
  const lastWeekTotalCount = Number(lastWeekTotalResult[0]?.count || 0);
  
  const lastWeekBadRate = lastWeekEvaluatedCount > 0 ? lastWeekBadCount / lastWeekEvaluatedCount : 0;
  const lastWeekErrorRate = lastWeekTotalCount > 0 ? lastWeekErrorCount / lastWeekTotalCount : 0;
  
  const badCaseTrend = badCaseRate - lastWeekBadRate;
  const toolErrorTrend = toolErrorRate - lastWeekErrorRate;

  // Token 消耗估算（基于对话数，假设每次对话平均消耗 0.01 元）
  const todayConversations = Number(todayConversationsResult[0]?.count || 0);
  const tokenCost = todayConversations * 0.01;

  return {
    realtime: {
      activeUsers: Number(activeUsersResult[0]?.count || 0),
      todayActivities: Number(todayActivitiesResult[0]?.count || 0),
      tokenCost: Math.round(tokenCost * 100) / 100,
      totalConversations: todayConversations,
    },
    northStar: j2cRate,
    aiHealth: {
      badCaseRate: Math.round(badCaseRate * 10000) / 100, // 转为百分比
      toolErrorRate: Math.round(toolErrorRate * 10000) / 100,
      avgResponseTime: 1200, // TODO: 从 metrics 表获取真实数据
      badCaseTrend: Math.round(badCaseTrend * 10000) / 100,
      toolErrorTrend: Math.round(toolErrorTrend * 10000) / 100,
    },
    alerts: {
      errorCount24h: Number(error24hResult[0]?.count || 0),
      sensitiveWordHits: Number(sensitiveHitsResult[0]?.count || 0),
      pendingModeration: Number(pendingModerationResult[0]?.count || 0),
    },
  };
}

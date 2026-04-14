/**
 * 搭子意向定时任务 (v4.0 Smart Broker - 3表精简版)
 * 
 * 任务列表：
 * 1. 过期意向处理 - 每小时检查并更新过期意向状态
 * 2. 过期匹配处理 - 每 10 分钟检查过期匹配，尝试重新分配或标记过期
 */

import { db, partnerIntents, intentMatches, eq, and, lt, not, inArray } from '@xu/db';
import { jobLogger } from '../lib/logger';
import { notifyTempOrganizerReassigned } from '../modules/notifications/notification.service';

/**
 * 过期意向处理
 * 将超过 expiresAt 的 active 意向标记为 expired
 */
export async function expireOldIntents(): Promise<void> {
  const now = new Date();
  
  const result = await db
    .update(partnerIntents)
    .set({ 
      status: 'expired', 
      updatedAt: now 
    })
    .where(and(
      eq(partnerIntents.status, 'active'),
      lt(partnerIntents.expiresAt, now)
    ))
    .returning({ id: partnerIntents.id });
  
  jobLogger.jobStats('意向过期处理', result.length, 0);
}

/**
 * 过期匹配处理
 * 1. 检查超过 confirmDeadline 的 pending 匹配
 * 2. 尝试重新分配 Temp_Organizer
 * 3. 无法分配则标记为 expired
 */
export async function handleExpiredMatches(): Promise<void> {
  const now = new Date();
  
  // 查找过期的 pending 匹配
  const expiredMatches = await db
    .select({
      id: intentMatches.id,
      tempOrganizerId: intentMatches.tempOrganizerId,
      intentIds: intentMatches.intentIds,
      userIds: intentMatches.userIds,
      activityType: intentMatches.activityType,
      centerLocationHint: intentMatches.centerLocationHint,
    })
    .from(intentMatches)
    .where(and(
      eq(intentMatches.outcome, 'pending'),
      lt(intentMatches.confirmDeadline, now)
    ));
  
  let reassignedCount = 0;
  let expiredCount = 0;
  
  for (const match of expiredMatches) {
    // 尝试重新分配 Temp_Organizer
    const reassigned = await reassignTempOrganizer(
      match.id, 
      match.tempOrganizerId,
      match.intentIds,
      match.userIds,
      match.activityType,
      match.centerLocationHint,
    );
    
    if (reassigned) {
      reassignedCount++;
    } else {
      // 无法重新分配，标记为过期
      await db
        .update(intentMatches)
        .set({ outcome: 'expired' })
        .where(eq(intentMatches.id, match.id));
      
      // 恢复相关意向为 active（如果还没过期）
      await restoreIntentsFromExpiredMatch(match.intentIds);
      
      expiredCount++;
    }
  }
  
  jobLogger.jobStats('匹配过期处理', expiredCount, reassignedCount);
}

/**
 * 重新分配 Temp_Organizer (3表精简版 - 直接用数组)
 * 选择匹配中除当前 Temp_Organizer 外的其他成员
 */
async function reassignTempOrganizer(
  matchId: string, 
  currentOrganizerId: string,
  intentIds: string[],
  _userIds: string[],
  activityType: string,
  centerLocationHint: string,
): Promise<boolean> {
  // 查找其他成员的意向（排除当前 Temp_Organizer）
  const otherIntents = await db
    .select({
      id: partnerIntents.id,
      userId: partnerIntents.userId,
      createdAt: partnerIntents.createdAt,
    })
    .from(partnerIntents)
    .where(and(
      inArray(partnerIntents.id, intentIds),
      not(eq(partnerIntents.userId, currentOrganizerId)),
      eq(partnerIntents.status, 'active') // 只选择意向还活跃的成员
    ))
    .orderBy(partnerIntents.createdAt) // 选择最早的
    .limit(1);
  
  if (otherIntents.length === 0) {
    return false;
  }
  
  const newOrganizer = otherIntents[0];
  
  // 计算新的确认截止时间（6小时或当天 23:59）
  const now = new Date();
  const sixHoursLater = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const newDeadline = sixHoursLater < endOfDay ? sixHoursLater : endOfDay;
  
  // 更新匹配
  await db
    .update(intentMatches)
    .set({
      tempOrganizerId: newOrganizer.userId,
      confirmDeadline: newDeadline,
    })
    .where(eq(intentMatches.id, matchId));
  
  notifyTempOrganizerReassigned(newOrganizer.userId, activityType, centerLocationHint).catch((err) => {
    console.error('Temp_Organizer 重分配通知发送失败', {
      matchId,
      err: err instanceof Error ? err.message : String(err),
    });
  });
  
  return true;
}

/**
 * 恢复过期匹配中的意向 (3表精简版 - 直接用数组)
 * 将相关意向恢复为 active（如果还没过期）
 */
async function restoreIntentsFromExpiredMatch(intentIds: string[]): Promise<void> {
  const now = new Date();
  
  // 批量查询所有相关意向
  const intents = await db
    .select({
      id: partnerIntents.id,
      expiresAt: partnerIntents.expiresAt,
      status: partnerIntents.status,
    })
    .from(partnerIntents)
    .where(inArray(partnerIntents.id, intentIds));
  
  // 恢复还没过期且不是 cancelled 的意向
  const toRestore = intents
    .filter(i => i.expiresAt > now && i.status !== 'cancelled')
    .map(i => i.id);
  
  if (toRestore.length > 0) {
    await db
      .update(partnerIntents)
      .set({ 
        status: 'active',
        updatedAt: now,
      })
      .where(inArray(partnerIntents.id, toRestore));
  }
}

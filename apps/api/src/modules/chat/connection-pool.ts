// 连接池管理模块
// 纯函数式设计，无 class

// @ts-ignore - bun types available at runtime
import type { ServerWebSocket } from 'bun';

export interface Connection {
  ws: ServerWebSocket<{ userId: string; activityId: string }>;
  userId: string;
  activityId: string;
  connectedAt: number;
  lastPingAt: number;
}

// 内存存储（单实例部署）
const pool = new Map<string, Connection>();
const activityIndex = new Map<string, Set<string>>(); // activityId -> connIds
const userIndex = new Map<string, Set<string>>(); // `${activityId}:${userId}` -> connIds

/**
 * 生成连接 ID
 */
export function generateConnId(): string {
  return crypto.randomUUID();
}

/**
 * 添加连接到连接池
 */
export function addConnection(connId: string, conn: Connection): void {
  pool.set(connId, conn);
  
  // 更新活动索引
  if (!activityIndex.has(conn.activityId)) {
    activityIndex.set(conn.activityId, new Set());
  }
  activityIndex.get(conn.activityId)!.add(connId);
  
  // 更新用户索引
  const userKey = `${conn.activityId}:${conn.userId}`;
  if (!userIndex.has(userKey)) {
    userIndex.set(userKey, new Set());
  }
  userIndex.get(userKey)!.add(connId);
}

/**
 * 从连接池移除连接
 */
export function removeConnection(connId: string): Connection | undefined {
  const conn = pool.get(connId);
  if (conn) {
    // 从活动索引移除
    activityIndex.get(conn.activityId)?.delete(connId);
    if (activityIndex.get(conn.activityId)?.size === 0) {
      activityIndex.delete(conn.activityId);
    }
    
    // 从用户索引移除
    const userKey = `${conn.activityId}:${conn.userId}`;
    userIndex.get(userKey)?.delete(connId);
    if (userIndex.get(userKey)?.size === 0) {
      userIndex.delete(userKey);
    }
    
    pool.delete(connId);
  }
  return conn;
}

/**
 * 获取活动的所有连接
 */
export function getConnectionsByActivity(activityId: string): Connection[] {
  const connIds = activityIndex.get(activityId) || new Set();
  return Array.from(connIds)
    .map(id => pool.get(id))
    .filter((conn): conn is Connection => conn !== undefined);
}

/**
 * 广播消息给活动内所有连接
 */
export function broadcastToActivity(activityId: string, message: unknown): void {
  const conns = getConnectionsByActivity(activityId);
  const payload = JSON.stringify(message);
  
  for (const conn of conns) {
    try {
      conn.ws.send(payload);
    } catch {
      // 发送失败，静默处理（连接可能已断开）
    }
  }
}

/**
 * 获取活动在线人数
 */
export function getOnlineCount(activityId: string): number {
  // 统计不同用户数，而非连接数（一个用户可能有多个连接）
  const connIds = activityIndex.get(activityId) || new Set();
  const uniqueUsers = new Set<string>();
  
  for (const connId of connIds) {
    const conn = pool.get(connId);
    if (conn) {
      uniqueUsers.add(conn.userId);
    }
  }
  
  return uniqueUsers.size;
}

/**
 * 检查用户是否在线
 */
export function isUserOnline(activityId: string, userId: string): boolean {
  const userKey = `${activityId}:${userId}`;
  const connIds = userIndex.get(userKey);
  return connIds !== undefined && connIds.size > 0;
}

/**
 * 更新连接的最后心跳时间
 */
export function updateLastPing(connId: string): void {
  const conn = pool.get(connId);
  if (conn) {
    conn.lastPingAt = Date.now();
  }
}

/**
 * 获取连接信息
 */
export function getConnection(connId: string): Connection | undefined {
  return pool.get(connId);
}

/**
 * 清理超时连接（心跳超时 30 秒）
 */
export function cleanupStaleConnections(): number {
  const now = Date.now();
  const timeout = 30 * 1000; // 30 秒
  let cleaned = 0;
  
  for (const [connId, conn] of pool) {
    if (now - conn.lastPingAt > timeout) {
      try {
        conn.ws.close(4008, 'Heartbeat timeout');
      } catch {
        // 忽略关闭错误
      }
      removeConnection(connId);
      cleaned++;
    }
  }
  
  return cleaned;
}

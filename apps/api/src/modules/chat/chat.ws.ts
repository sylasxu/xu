// WebSocket 处理器 - 活动讨论区实时通讯
import { db, activityMessages, activities, participants, users, eq, and, desc } from '@xu/db';
import { verifyToken } from '../auth/auth.service';
import { validateContent } from '../content-security/content-security.service';
import * as pool from './connection-pool';
import { WsErrorCodes } from './chat.model';

// 群聊归档时间：活动开始后 24 小时
const ARCHIVE_HOURS = 24;

export interface WsData {
  userId: string;
  activityId: string;
  connId: string;
}

type ChatSocket = pool.ChatSocketConnection & object;

const wsSessions = new WeakMap<ChatSocket, WsData>();

function rememberWsSession(ws: ChatSocket, session: WsData): void {
  wsSessions.set(ws, session);
}

function readWsSession(ws: ChatSocket): WsData | null {
  return wsSessions.get(ws) ?? null;
}

function clearWsSession(ws: ChatSocket): void {
  wsSessions.delete(ws);
}

/**
 * 检查活动是否已归档
 */
async function checkIsArchived(activityId: string): Promise<boolean> {
  const [activity] = await db
    .select({ startAt: activities.startAt, status: activities.status })
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  if (!activity) {
    return true;
  }

  // 活动状态为 completed 或 cancelled 视为归档
  if (activity.status === 'completed' || activity.status === 'cancelled') {
    return true;
  }

  const archiveTime = new Date(activity.startAt.getTime() + ARCHIVE_HOURS * 60 * 60 * 1000);
  return new Date() > archiveTime;
}

/**
 * 检查用户是否为活动参与者
 */
async function checkIsParticipant(activityId: string, userId: string): Promise<boolean> {
  const [participant] = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.activityId, activityId),
        eq(participants.userId, userId),
        eq(participants.status, 'joined')
      )
    )
    .limit(1);

  return !!participant;
}

/**
 * 检查活动是否存在
 */
async function checkActivityExists(activityId: string): Promise<boolean> {
  const [activity] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.id, activityId))
    .limit(1);

  return !!activity;
}

/**
 * 获取历史消息
 */
async function getHistoryMessages(activityId: string, limit = 50) {
  const messageList = await db
    .select({
      id: activityMessages.id,
      activityId: activityMessages.activityId,
      senderId: activityMessages.senderId,
      parentId: activityMessages.parentId,
      messageType: activityMessages.messageType,
      content: activityMessages.content,
      createdAt: activityMessages.createdAt,
      senderNickname: users.nickname,
      senderAvatarUrl: users.avatarUrl,
    })
    .from(activityMessages)
    .leftJoin(users, eq(activityMessages.senderId, users.id))
    .where(eq(activityMessages.activityId, activityId))
    .orderBy(desc(activityMessages.createdAt))
    .limit(limit);

  // 反转顺序，让最新消息在最后
  return messageList.reverse().map(m => ({
    id: m.id,
    content: m.content,
    senderId: m.senderId,
    parentId: m.parentId,
    senderNickname: m.senderNickname,
    senderAvatarUrl: m.senderAvatarUrl,
    type: m.messageType,
    createdAt: m.createdAt.toISOString(),
  }));
}

/**
 * 获取用户信息
 */
async function getUserInfo(userId: string) {
  const [user] = await db
    .select({ nickname: users.nickname, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user;
}

/**
 * 处理 WebSocket 连接升级
 */
export async function handleWsUpgrade(
  ws: ChatSocket,
  activityId: string,
  token: string
): Promise<boolean> {
  // 1. 验证 token
  const user = await verifyToken(token);
  if (!user) {
    ws.close(WsErrorCodes.UNAUTHORIZED, 'Unauthorized');
    return false;
  }

  // 2. 检查活动是否存在
  const exists = await checkActivityExists(activityId);
  if (!exists) {
    ws.close(WsErrorCodes.NOT_FOUND, 'Activity not found');
    return false;
  }

  // 3. 检查参与状态
  const isParticipant = await checkIsParticipant(activityId, user.id);
  if (!isParticipant) {
    ws.close(WsErrorCodes.NOT_PARTICIPANT, 'Not a participant');
    return false;
  }

  // 4. 检查归档状态
  const isArchived = await checkIsArchived(activityId);
  if (isArchived) {
    ws.close(WsErrorCodes.ARCHIVED, 'Discussion archived');
    return false;
  }

  // 5. 生成连接 ID 并加入连接池
  const connId = pool.generateConnId();
  const session: WsData = {
    userId: user.id,
    activityId,
    connId,
  };

  pool.addConnection(connId, {
    ws,
    ...session,
    connectedAt: Date.now(),
    lastPingAt: Date.now(),
  });
  rememberWsSession(ws, session);

  // 6. 发送历史消息
  const messages = await getHistoryMessages(activityId, 50);
  ws.send(JSON.stringify({ type: 'history', data: messages, ts: Date.now() }));

  // 7. 广播在线人数和用户加入
  const count = pool.getOnlineCount(activityId);
  const userInfo = await getUserInfo(user.id);
  
  pool.broadcastToActivity(activityId, { 
    type: 'online', 
    data: { count }, 
    ts: Date.now() 
  });
  
  pool.broadcastToActivity(activityId, { 
    type: 'join', 
    data: { 
      userId: user.id, 
      nickname: userInfo?.nickname || '匿名用户',
    }, 
    ts: Date.now() 
  });

  return true;
}

/**
 * 处理 WebSocket 消息
 */
export async function handleWsMessage(
  ws: ChatSocket,
  rawData: string | Buffer
): Promise<void> {
  const session = readWsSession(ws);
  if (!session) {
    ws.close(WsErrorCodes.UNAUTHORIZED, 'Unauthorized');
    return;
  }

  const { userId, activityId, connId } = session;

  let data: { type: string; content?: string };
  try {
    data = JSON.parse(typeof rawData === 'string' ? rawData : rawData.toString());
  } catch {
    ws.send(JSON.stringify({
      type: 'error',
      data: { code: 4000, message: 'Invalid JSON' },
      ts: Date.now(),
    }));
    return;
  }

  // 处理心跳
  if (data.type === 'ping') {
    pool.updateLastPing(connId);
    ws.send(JSON.stringify({ type: 'pong', data: null, ts: Date.now() }));
    return;
  }

  // 处理消息发送
  if (data.type === 'message' && data.content) {
    const parentIdValue = (data as { parentId?: unknown }).parentId;
    const parentId = typeof parentIdValue === 'string' ? parentIdValue : null;

    // 检查归档状态
    const isArchived = await checkIsArchived(activityId);
    if (isArchived) {
      ws.send(JSON.stringify({
        type: 'error',
        data: { code: WsErrorCodes.ARCHIVED, message: '讨论区已归档' },
        ts: Date.now(),
      }));
      return;
    }

    // 内容安全检测
    const validation = await validateContent(data.content, {
      userId,
      scene: 'message',
    });

    if (!validation.pass) {
      ws.send(JSON.stringify({
        type: 'error',
        data: { code: WsErrorCodes.CONTENT_VIOLATION, message: validation.reason },
        ts: Date.now(),
      }));
      return;
    }

    // 持久化消息
    const [message] = await db
      .insert(activityMessages)
      .values({
        activityId,
        senderId: userId,
        parentId,
        messageType: 'text',
        content: data.content,
      })
      .returning({ id: activityMessages.id, createdAt: activityMessages.createdAt });

    // 获取发送者信息
    const userInfo = await getUserInfo(userId);

    // 广播消息
    pool.broadcastToActivity(activityId, {
      type: 'message',
      data: {
        id: message.id,
        content: data.content,
        senderId: userId,
        parentId,
        senderNickname: userInfo?.nickname || '匿名用户',
        senderAvatarUrl: userInfo?.avatarUrl || null,
        type: 'text',
        createdAt: message.createdAt.toISOString(),
      },
      ts: Date.now(),
    });
  }
}

/**
 * 处理 WebSocket 关闭
 */
export async function handleWsClose(ws: ChatSocket): Promise<void> {
  const session = readWsSession(ws);
  if (!session) {
    return;
  }

  clearWsSession(ws);

  const { userId, activityId, connId } = session;

  // 从连接池移除
  pool.removeConnection(connId);

  // 广播在线人数和用户离开
  const count = pool.getOnlineCount(activityId);
  const userInfo = await getUserInfo(userId);

  pool.broadcastToActivity(activityId, { 
    type: 'online', 
    data: { count }, 
    ts: Date.now() 
  });

  pool.broadcastToActivity(activityId, { 
    type: 'leave', 
    data: { 
      userId, 
      nickname: userInfo?.nickname || '匿名用户',
    }, 
    ts: Date.now() 
  });
}

/**
 * 启动心跳检测定时器
 */
export function startHeartbeatChecker(intervalMs = 10000): NodeJS.Timeout {
  return setInterval(() => {
    const cleaned = pool.cleanupStaleConnections();
    if (cleaned > 0) {
      console.log(`[WebSocket] Cleaned ${cleaned} stale connections`);
    }
  }, intervalMs);
}

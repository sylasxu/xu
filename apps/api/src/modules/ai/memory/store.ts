/**
 * Memory Store - 会话存储
 * 
 * 基于 PostgreSQL 的会话和消息存储
 * 复用 @juchang/db 的 conversations 和 conversationMessages 表
 */

import {
  db,
  conversations,
  conversationMessages,
  eq,
  desc,
  sql,
  toTimestamp,
  type Conversation,
  type Message,
} from '@juchang/db';
import { getEmbedding } from '../models/router';
import { createLogger } from '../observability/logger';
import type { SaveMessageParams, SessionWindowConfig } from './types';
import { DEFAULT_SESSION_WINDOW } from './types';

const logger = createLogger('MemoryStore');

/**
 * 获取或创建用户的当前会话（24h 窗口）
 * 
 * @param userId - 用户 ID
 * @param config - 会话窗口配置
 * @returns 会话 ID 和是否新建
 */
export async function getOrCreateThread(
  userId: string,
  config: SessionWindowConfig = DEFAULT_SESSION_WINDOW
): Promise<{ id: string; isNew: boolean }> {
  const windowMs = config.windowMs;
  const windowStart = new Date(Date.now() - windowMs);

  // 查找最近的会话
  const [recent] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(sql`${conversations.userId} = ${userId} AND ${conversations.lastMessageAt} > ${toTimestamp(windowStart)}`)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);

  if (recent) {
    return { id: recent.id, isNew: false };
  }

  // 创建新会话
  const [conv] = await db
    .insert(conversations)
    .values({
      userId,
      messageCount: 0,
    })
    .returning({ id: conversations.id });

  return { id: conv.id, isNew: true };
}

/**
 * 获取会话信息
 */
export async function getThread(threadId: string): Promise<Conversation | null> {
  const [thread] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, threadId))
    .limit(1);

  return thread || null;
}

/**
 * 获取会话的最近 N 条消息
 * 
 * @param threadId - 会话 ID
 * @param limit - 消息数量限制，默认 20
 * @returns 消息列表（按时间正序）
 */
export async function getMessages(
  threadId: string,
  limit = 20
): Promise<Message[]> {
  const messages = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, threadId))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(limit);

  // 返回时按时间正序
  return messages.reverse();
}

/**
 * 保存消息到会话
 * 
 * @param params - 消息参数
 * @returns 保存的消息 ID
 */
export async function saveMessage(params: SaveMessageParams): Promise<{ id: string }> {
  const { conversationId, userId, role, messageType, content, activityId } = params;

  // 1. 插入消息
  const [msg] = await db
    .insert(conversationMessages)
    .values({
      conversationId,
      userId,
      role,
      messageType: messageType as any,
      content,
      activityId,
    })
    .returning({ id: conversationMessages.id });

  // 更新会话的 messageCount 和 lastMessageAt
  await db
    .update(conversations)
    .set({
      messageCount: sql`${conversations.messageCount} + 1`,
      lastMessageAt: new Date(),
      // 如果是第一条用户消息且没有标题，自动设置标题
      ...(role === 'user' ? {
        title: sql`COALESCE(${conversations.title}, LEFT(${typeof content === 'object' && content && 'text' in content ? (content as { text: string }).text : String(content)}::text, 50))`,
      } : {}),
    })
    .where(eq(conversations.id, conversationId));

  // 2. 异步生成 embedding (如果是文本消息且来自用户或助手)
  // 只对 text 类型的文本内容生成，忽略 JSON 卡片数据
  if (messageType === 'text' && typeof content === 'string' && content.length > 0 && content.length < 8000) {
    // 不阻塞主流程
    generateAndSaveEmbedding(msg.id, content).catch(err => {
      logger.error('Embedding generation failed silently', { error: err });
    });
  } else if (typeof content === 'object' && content && 'text' in content) {
    // 兼容部分 content 为对象的场景 (如 { text: "..." })
    const textContent = (content as { text: string }).text;
    if (textContent && textContent.length > 0) {
      generateAndSaveEmbedding(msg.id, textContent).catch(err => {
        logger.error('Embedding generation failed silently', { error: err });
      });
    }
  }

  return { id: msg.id };
}

/**
 * 异步生成并更新消息的 embedding
 * @internal 用于 saveMessage 后台处理
 */
async function generateAndSaveEmbedding(messageId: string, content: string) {
  try {
    const embedding = await getEmbedding(content);
    await db
      .update(conversationMessages)
      .set({ embedding })
      .where(eq(conversationMessages.id, messageId));
  } catch (error) {
    logger.error('Failed to generate embedding for message', { messageId, error });
  }
}

/**
 * 获取用户的会话列表
 * 
 * @param userId - 用户 ID
 * @param limit - 数量限制
 * @returns 会话列表
 */
export async function getUserThreads(
  userId: string,
  limit = 10
): Promise<Conversation[]> {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);
}

/**
 * 删除会话（级联删除消息）
 */
export async function deleteThread(threadId: string): Promise<boolean> {
  const result = await db
    .delete(conversations)
    .where(eq(conversations.id, threadId))
    .returning({ id: conversations.id });

  return result.length > 0;
}

/**
 * 清空用户的所有会话
 */
export async function clearUserThreads(userId: string): Promise<{ deletedCount: number }> {
  const result = await db
    .delete(conversations)
    .where(eq(conversations.userId, userId))
    .returning({ id: conversations.id });

  return { deletedCount: result.length };
}

/**
 * 按活动 ID 查询关联的消息
 */
export async function getMessagesByActivityId(activityId: string): Promise<Message[]> {
  return db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.activityId, activityId))
    .orderBy(conversationMessages.createdAt);
}

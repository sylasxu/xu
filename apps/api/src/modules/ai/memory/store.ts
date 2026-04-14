/**
 * Memory Store - 会话存储
 * 
 * 基于 PostgreSQL 的会话和消息存储
 * 复用 @xu/db 的 conversations 和 conversationMessages 表
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
} from '@xu/db';
import { getEmbedding } from '../models/router';
import { createLogger } from '../observability/logger';
import type { SaveMessageParams, SessionWindowConfig } from './types';
import { DEFAULT_SESSION_WINDOW } from './types';

const logger = createLogger('MemoryStore');
const SHORT_TERM_CHAT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getConversationMessageExpiresAt(now = Date.now()): Date {
  return new Date(now + SHORT_TERM_CHAT_TTL_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readMessageTextContent(content: Message['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  if (isRecord(content) && typeof content.text === 'string') {
    return content.text;
  }

  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

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

export async function createThread(userId: string): Promise<{ id: string }> {
  const [conv] = await db
    .insert(conversations)
    .values({
      userId,
      messageCount: 0,
    })
    .returning({ id: conversations.id });

  return { id: conv.id };
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
    .where(
      sql`${conversationMessages.conversationId} = ${threadId}
        AND (${conversationMessages.expiresAt} IS NULL OR ${conversationMessages.expiresAt} > NOW())`
    )
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
  const { conversationId, userId, role, messageType, kind, text, payload, content, activityId, taskId } = params;
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  const titleSource = normalizedText || readMessageTextContent(content);

  // 1. 插入消息
  const [msg] = await db
    .insert(conversationMessages)
    .values({
      conversationId,
      userId,
      role,
      messageType,
      ...(kind ? { kind } : {}),
      ...(normalizedText ? { text: normalizedText } : {}),
      ...(payload ? { payload } : {}),
      content,
      activityId,
      taskId,
      expiresAt: getConversationMessageExpiresAt(),
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
        title: sql`COALESCE(${conversations.title}, LEFT(${titleSource}::text, 50))`,
      } : {}),
    })
    .where(eq(conversations.id, conversationId));

  // 2. 异步生成 embedding (如果是文本消息且来自用户或助手)
  // 只对 text 类型的文本内容生成，忽略 JSON 卡片数据
  if (normalizedText && normalizedText.length < 8000) {
    generateAndSaveEmbedding(msg.id, normalizedText).catch(err => {
      logger.error('Embedding generation failed silently', { error: err });
    });
  } else if (messageType === 'text' && typeof content === 'string' && content.length > 0 && content.length < 8000) {
    // 不阻塞主流程
    generateAndSaveEmbedding(msg.id, content).catch(err => {
      logger.error('Embedding generation failed silently', { error: err });
    });
  } else if (isRecord(content) && typeof content.text === 'string') {
    // 兼容部分 content 为对象的场景 (如 { text: "..." })
    const textContent = content.text;
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
    const embedding = await getEmbedding(content, { textType: 'document' });
    await db
      .update(conversationMessages)
      .set({ embedding })
      .where(eq(conversationMessages.id, messageId));
  } catch (error) {
    logger.error('Failed to generate embedding for message', { messageId, error });
  }
}

export function refreshMessageEmbedding(messageId: string, content: string): void {
  if (!content.trim()) {
    return;
  }

  generateAndSaveEmbedding(messageId, content).catch((error) => {
    logger.error('Failed to refresh embedding for message', { messageId, error });
  });
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

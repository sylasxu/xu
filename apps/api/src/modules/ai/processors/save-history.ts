/**
 * Save History Processor (v4.8)
 * 
 * 负责保存对话历史到数据库：
 * - 保存用户消息和 AI 响应到 conversation_messages 表
 * - 更新 conversations 表的 messageCount 和 lastMessageAt
 * - 关联 activityId（如果 AI 响应中包含）
 * 
 * 注意：这是一个后处理 Processor，在 AI 响应生成后执行
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { db, conversations, conversationMessages, eq, sql } from '@juchang/db';

/**
 * Save History Processor
 * 
 * 保存对话历史到数据库
 */
export async function saveHistory(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();
  
  try {
    const { userId, messages, metadata } = context;
    
    // 如果没有 userId，跳过
    if (!userId) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-user-id' },
      };
    }
    
    // 获取或创建会话
    const conversationId = metadata?.conversationId as string | undefined;
    
    let finalConversationId = conversationId;
    
    if (!conversationId) {
      // 创建新会话
      const [newConversation] = await db
        .insert(conversations)
        .values({
          userId,
          title: '新对话',
          messageCount: 0,
        })
        .returning({ id: conversations.id });
      
      finalConversationId = newConversation.id;
    }
    
    if (!finalConversationId) {
      throw new Error('无法获取或创建会话 ID');
    }
    
    // 保存最后两条消息（用户消息 + AI 响应）
    // 使用 reverse + find 替代 findLast（兼容性更好）
    const reversedMessages = [...messages].reverse();
    const lastUserMessage = reversedMessages.find(m => m.role === 'user');
    const lastAssistantMessage = reversedMessages.find(m => m.role === 'assistant');
    
    const messagesToSave = [];
    
    if (lastUserMessage) {
      messagesToSave.push({
        conversationId: finalConversationId,
        userId,
        role: 'user' as const,
        messageType: 'text' as const,
        content: { text: lastUserMessage.content },
      });
    }
    
    if (lastAssistantMessage) {
      const activityId = metadata?.activityId as string | undefined;
      
      messagesToSave.push({
        conversationId: finalConversationId,
        userId,
        role: 'assistant' as const,
        messageType: 'text' as const,
        content: { text: lastAssistantMessage.content },
        activityId,
      });
    }
    
    if (messagesToSave.length > 0) {
      await db.insert(conversationMessages).values(messagesToSave);
      
      // 更新会话统计
      await db
        .update(conversations)
        .set({
          messageCount: sql`${conversations.messageCount} + ${messagesToSave.length}`,
          lastMessageAt: new Date(),
        })
        .where(eq(conversations.id, finalConversationId));
    }
    
    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      data: {
        conversationId: finalConversationId,
        messagesSaved: messagesToSave.length,
      },
    };
    
  } catch (error) {
    // 保存历史失败不应阻止整个流程，只记录错误
    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : '未知错误',
      data: { skipped: true, reason: 'error' },
    };
  }
}

// Processor 元数据
saveHistory.processorName = 'save-history';

/**
 * Semantic Recall Processor (v4.9)
 *
 * 负责语义检索历史活动和对话消息：
 * - 同时搜索 activities 表和 conversation_messages 表
 * - 搜索独立的长期 user_memories 表
 * - 相似度阈值 0.5
 * - 合并结果后使用本地轻量排序
 * - 返回 top-K 结果（K=5）
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { db, activities, participants, conversationMessages, userMemories, eq, sql, and, or } from '@xu/db';
import { generateEmbedding } from '../rag';
import { rerank } from '../models/router';

/** 相似度阈值（降低至 0.5 以扩大召回范围） */
const SIMILARITY_THRESHOLD = 0.5;

/** 最终返回的 top-K 结果数 */
const TOP_K = 5;

/** 太短的输入大多是噪音，不值得做向量检索。 */
const MIN_RECALL_QUERY_LENGTH = 2;

/** 搜索 activities 表 */
async function searchActivities(userId: string, queryEmbedding: number[]) {
  return db
    .select({
      title: activities.title,
      type: activities.type,
      locationHint: activities.locationHint,
      startAt: activities.startAt,
      similarity: sql<number>`1 - (${activities.embedding} <=> ${queryEmbedding}::vector)`,
    })
    .from(activities)
    .leftJoin(participants, eq(participants.activityId, activities.id))
    .where(
      and(
        or(
          eq(activities.creatorId, userId),
          eq(participants.userId, userId),
        ),
        sql`${activities.embedding} IS NOT NULL`,
        sql`1 - (${activities.embedding} <=> ${queryEmbedding}::vector) > ${SIMILARITY_THRESHOLD}`,
      ),
    )
    .orderBy(sql`${activities.embedding} <=> ${queryEmbedding}::vector`)
    .limit(10);
}

/** 搜索 conversation_messages 表 */
async function searchConversationMessages(userId: string, queryEmbedding: number[]) {
  return db
    .select({
      content: conversationMessages.content,
      role: conversationMessages.role,
      createdAt: conversationMessages.createdAt,
      similarity: sql<number>`1 - (${conversationMessages.embedding} <=> ${queryEmbedding}::vector)`,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.userId, userId),
        sql`${conversationMessages.embedding} IS NOT NULL`,
        sql`1 - (${conversationMessages.embedding} <=> ${queryEmbedding}::vector) > ${SIMILARITY_THRESHOLD}`,
      ),
    )
    .orderBy(sql`${conversationMessages.embedding} <=> ${queryEmbedding}::vector`)
    .limit(10);
}

/** 搜索 user_memories 表 */
async function searchUserMemories(userId: string, queryEmbedding: number[]) {
  return db
    .select({
      content: userMemories.content,
      memoryType: userMemories.memoryType,
      similarity: sql<number>`1 - (${userMemories.embedding} <=> ${queryEmbedding}::vector)`,
    })
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, userId),
        sql`${userMemories.embedding} IS NOT NULL`,
        sql`(${userMemories.expiresAt} IS NULL OR ${userMemories.expiresAt} > now())`,
        sql`1 - (${userMemories.embedding} <=> ${queryEmbedding}::vector) > ${SIMILARITY_THRESHOLD}`,
      ),
    )
    .orderBy(sql`${userMemories.embedding} <=> ${queryEmbedding}::vector`)
    .limit(10);
}

/**
 * Semantic Recall Processor
 *
 * 语义检索历史活动和对话消息，使用 rerank 重排序
 */
export async function semanticRecallProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();

  try {
    const { userId, userInput } = context;

    if (!userId) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-user-id' },
      };
    }

    const normalizedInput = userInput.trim();
    if (normalizedInput.length < MIN_RECALL_QUERY_LENGTH) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'query-too-short' },
      };
    }

    const queryEmbedding = await generateEmbedding(normalizedInput, { textType: 'query' });

    // 并行搜索 activities、conversation_messages 和 user_memories
    const [activityResults, messageResults, userMemoryResults] = await Promise.all([
      searchActivities(userId, queryEmbedding),
      searchConversationMessages(userId, queryEmbedding),
      searchUserMemories(userId, queryEmbedding),
    ]);

    // 合并结果为统一格式
    const allDocuments: Array<{ text: string; source: 'activities' | 'conversations' | 'user_memories'; similarity: number }> = [];

    for (const r of activityResults) {
      allDocuments.push({
        text: `[活动] ${r.title} (${r.type}, ${r.locationHint}, ${new Date(r.startAt).toLocaleDateString()})`,
        source: 'activities',
        similarity: r.similarity ?? 0,
      });
    }

    for (const r of messageResults) {
      const contentStr = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
      allDocuments.push({
        text: `[对话] ${contentStr.slice(0, 200)}`,
        source: 'conversations',
        similarity: r.similarity ?? 0,
      });
    }

    for (const r of userMemoryResults) {
      allDocuments.push({
        text: `[记忆/${r.memoryType}] ${r.content.slice(0, 200)}`,
        source: 'user_memories',
        similarity: r.similarity ?? 0,
      });
    }

    if (allDocuments.length === 0) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-results' },
      };
    }

    // 使用本地轻量重排序
    let finalResults = allDocuments;
    let rerankApplied = false;

    try {
      if (allDocuments.length > 1) {
        const rerankResponse = await rerank(
          normalizedInput,
          allDocuments.map(d => d.text),
          TOP_K,
        );

        if (rerankResponse.results && rerankResponse.results.length > 0) {
          finalResults = rerankResponse.results
            .sort((a, b) => b.score - a.score)
            .slice(0, TOP_K)
            .map(r => allDocuments[r.index]);
          rerankApplied = true;
        }
      }
    } catch {
      // rerank 失败时降级到按相似度排序
      finalResults = allDocuments
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, TOP_K);
    }

    const formattedResults = finalResults
      .map((r, i) => `${i + 1}. ${r.text}`)
      .join('\n');

    const recallPrompt = `## 相关历史信息\n${formattedResults}\n\n请参考这些历史信息，提供更个性化的建议。`;

    const avgSimilarity = finalResults.reduce((sum, r) => sum + r.similarity, 0) / finalResults.length;
    const sources = [...new Set(finalResults.map(r => r.source))] as Array<'conversations' | 'activities' | 'user_memories'>;

    const updatedContext: ProcessorContext = {
      ...context,
      semanticContext: formattedResults,
      metadata: {
        ...context.metadata,
        semanticRecallPrompt: recallPrompt,
        semanticRecall: {
          resultsCount: finalResults.length,
          avgSimilarity,
          rerankApplied,
          sources,
        },
      },
    };

    return {
      success: true,
      context: updatedContext,
      executionTime: Date.now() - startTime,
      data: { resultsCount: finalResults.length, avgSimilarity, rerankApplied, sources },
    };
  } catch (error) {
    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : '未知错误',
      data: { skipped: true, reason: 'error' },
    };
  }
}

semanticRecallProcessor.processorName = 'semantic-recall-processor';

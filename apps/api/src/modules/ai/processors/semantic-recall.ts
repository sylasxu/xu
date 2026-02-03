/**
 * Semantic Recall Processor (v4.8)
 * 
 * 负责语义检索历史活动：
 * - 使用 pgvector 进行向量相似度搜索
 * - 检索用户创建或参与过的相关活动
 * - 将检索结果注入到系统提示词
 * 
 * 使用场景：
 * - 用户询问"我之前组过什么局"
 * - 用户想重复之前的活动
 * - AI 需要了解用户的历史行为
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { db, activities, participants, eq, sql, and, or } from '@juchang/db';
import { generateEmbedding } from '../rag';

// 最大检索结果数
const MAX_RESULTS = 5;

// 相似度阈值（0-1，越高越相似）
const SIMILARITY_THRESHOLD = 0.7;

/**
 * Semantic Recall Processor
 * 
 * 语义检索历史活动
 */
export async function semanticRecall(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();
  
  try {
    const { userId, userInput } = context;
    
    // 如果没有 userId，跳过
    if (!userId) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-user-id' },
      };
    }
    
    // 生成查询向量
    const queryEmbedding = await generateEmbedding(userInput);
    
    // 检索相关活动（用户创建或参与过的）
    const results = await db
      .select({
        id: activities.id,
        title: activities.title,
        description: activities.description,
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
            eq(participants.userId, userId)
          ),
          sql`${activities.embedding} IS NOT NULL`,
          sql`1 - (${activities.embedding} <=> ${queryEmbedding}::vector) > ${SIMILARITY_THRESHOLD}`
        )
      )
      .orderBy(sql`${activities.embedding} <=> ${queryEmbedding}::vector`)
      .limit(MAX_RESULTS);
    
    if (results.length === 0) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-results' },
      };
    }
    
    // 格式化检索结果
    const formattedResults = results.map((r, i) => 
      `${i + 1}. ${r.title} (${r.type}, ${r.locationHint}, ${new Date(r.startAt).toLocaleDateString()})`
    ).join('\n');
    
    // 注入检索结果到系统提示词
    const updatedSystemPrompt = `${context.systemPrompt}

## 相关历史活动
用户之前创建或参与过以下相关活动：
${formattedResults}

请参考这些历史活动，提供更个性化的建议。`;
    
    const updatedContext: ProcessorContext = {
      ...context,
      systemPrompt: updatedSystemPrompt,
      semanticContext: formattedResults,
    };
    
    return {
      success: true,
      context: updatedContext,
      executionTime: Date.now() - startTime,
      data: {
        resultsCount: results.length,
        avgSimilarity: results.reduce((sum, r) => sum + (r.similarity || 0), 0) / results.length,
      },
    };
    
  } catch (error) {
    // 语义检索失败不应阻止整个流程，只记录错误
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
semanticRecall.processorName = 'semantic-recall';

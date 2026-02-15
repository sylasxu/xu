import { db, sql, conversationMessages, eq, and } from '@juchang/db';
import { getEmbedding } from '../models/router';
import { createLogger } from '../observability/logger';
import type { RecalledMessage } from './types';

const logger = createLogger('MemorySemantic');

/**
 * 语义召回历史消息
 * 
 * 基于向量相似度搜索相关的历史对话
 * 
 * @param query - 查询文本
 * @param userId - 用户 ID
 * @param options - 选项
 */
export async function semanticRecall(
    query: string,
    userId: string,
    options?: { limit?: number; threshold?: number }
): Promise<RecalledMessage[]> {
    const { limit = 5, threshold = 0.5 } = options || {};

    try {
        const queryEmbedding = await getEmbedding(query);

        // 使用 pgvector 的 <=> 运算符计算余弦距离
        // 相似度 = 1 - 距离
        const distance = sql`(${conversationMessages.embedding} <=> ${JSON.stringify(queryEmbedding)})`;

        const results = await db
            .select({
                role: conversationMessages.role,
                content: conversationMessages.content,
                // distance, // 可选：返回距离用于调试
            })
            .from(conversationMessages)
            .where(and(
                eq(conversationMessages.userId, userId),
                // 确保 embedding 不为空
                sql`${conversationMessages.embedding} IS NOT NULL`,
                // 阈值过滤: distance < (1 - threshold)
                sql`${distance} < ${1 - threshold}`
            ))
            .orderBy(distance)
            .limit(limit);

        return results.map(r => {
            let content = '';
            if (typeof r.content === 'string') {
                content = r.content;
            } else if (typeof r.content === 'object' && r.content) {
                // 尝试提取文本内容
                content = (r.content as any).text || JSON.stringify(r.content);
            }

            return {
                role: r.role as 'user' | 'assistant',
                content,
            };
        });

    } catch (error) {
        logger.error('Semantic recall failed', { userId, query, error });
        return [];
    }
}

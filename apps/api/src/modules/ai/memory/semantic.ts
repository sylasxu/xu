import { db, sql, conversationMessages, eq, and } from '@xu/db';
import { getEmbedding } from '../models/router';
import { createLogger } from '../observability/logger';
import type { RecalledMessage } from './types';

const logger = createLogger('MemorySemantic');

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readRecalledContent(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (!isRecord(value)) {
        return '';
    }

    const text = value.text;
    return typeof text === 'string' ? text : JSON.stringify(value);
}

function readRecalledRole(value: unknown): RecalledMessage['role'] | null {
    switch (value) {
        case 'user':
        case 'assistant':
            return value;
        default:
            return null;
    }
}

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

        return results.flatMap((r) => {
            const role = readRecalledRole(r.role);
            if (!role) {
                return [];
            }

            return [{
                role,
                content: readRecalledContent(r.content),
            }];
        });

    } catch (error) {
        logger.error('Semantic recall failed', { userId, query, error });
        return [];
    }
}

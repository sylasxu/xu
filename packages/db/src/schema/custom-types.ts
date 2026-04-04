/**
 * 自定义 PostgreSQL 类型
 * 用于支持 pgvector 扩展的 vector 类型
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * pgvector 的 vector 类型
 * 用于存储高维向量，支持相似度搜索
 * 
 * @param dimensions - 向量维度 (如 1536 对应 Qwen text-embedding-v4)
 * 
 * @example
 * ```typescript
 * embedding: vector('embedding', { dimensions: 1536 }),
 * ```
 */
export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // pgvector 返回格式: "[0.1,0.2,0.3,...]"
    return value
      .slice(1, -1) // 移除方括号
      .split(',')
      .map(Number);
  },
});

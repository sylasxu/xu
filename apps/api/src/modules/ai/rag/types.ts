/**
 * RAG Module Types - 语义检索类型定义
 * 
 * v4.5 活动语义搜索功能
 */

import type { Activity } from '@juchang/db';

/**
 * 混合检索参数
 */
export interface HybridSearchParams {
  /** 用户自然语言查询 */
  semanticQuery: string;
  /** 过滤条件 */
  filters: SearchFilters;
  /** 返回数量限制，默认 20 */
  limit?: number;
  /** 相似度阈值，默认 0.5 */
  threshold?: number;
  /** 是否生成推荐理由 */
  includeMatchReason?: boolean;
  /** 用户 ID（用于个性化推荐） */
  userId?: string | null;
}

/**
 * 搜索过滤条件
 */
export interface SearchFilters {
  /** 位置过滤 */
  location?: {
    lat: number;
    lng: number;
    radiusInKm: number;
  };
  /** 时间范围过滤 */
  timeRange?: {
    start: Date;
    end: Date;
  };
  /** 活动类型过滤 */
  type?: string;
}

/**
 * 带评分的活动结果
 */
export interface ScoredActivity {
  /** 活动数据 */
  activity: Activity;
  /** 语义相似度 (0-1) */
  score: number;
  /** 物理距离 (米) */
  distance?: number;
  /** 推荐理由 */
  matchReason?: string;
}

/**
 * 索引项
 */
export interface IndexItem {
  /** 活动 ID */
  activityId: string;
  /** 富集化文本 */
  enrichedText: string;
  /** 向量 (可选，用于批量操作) */
  embedding?: number[];
}

/**
 * RAG 服务配置
 */
export interface RagConfig {
  /** Embedding 模型，默认 'embedding-3' (智谱) */
  embeddingModel: string;
  /** 向量维度，默认 1024 */
  embeddingDimensions: number;
  /** 默认返回数量，默认 20 */
  defaultLimit: number;
  /** 默认相似度阈值，默认 0.5 */
  defaultThreshold: number;
  /** 批量处理大小，默认 100 */
  batchSize: number;
  /** 批次间延迟 (ms)，默认 100 */
  batchDelayMs: number;
  /** MaxSim 个性化提升比例，默认 0.2 */
  maxSimBoostRatio: number;
}

/**
 * 默认 RAG 配置
 */
export const DEFAULT_RAG_CONFIG: RagConfig = {
  embeddingModel: 'embedding-3',
  embeddingDimensions: 1024,
  defaultLimit: 20,
  defaultThreshold: 0.5,
  batchSize: 100,
  batchDelayMs: 100,
  maxSimBoostRatio: 0.2,
};

/**
 * 批量索引结果
 */
export interface BatchIndexResult {
  /** 成功数量 */
  success: number;
  /** 失败数量 */
  failed: number;
  /** 错误详情 */
  errors: Array<{ id: string; error: string }>;
}

/**
 * 活动氛围类型
 */
export type ActivityVibe = 
  | '热闹' 
  | '安静' 
  | '活力' 
  | '户外' 
  | '商务' 
  | '休闲'
  | '文艺'
  | '社交';

/**
 * 时间段类型
 */
export type TimeOfDay = '早上' | '下午' | '晚上' | '深夜';

/**
 * 星期几类型
 */
export type DayOfWeek = '周一' | '周二' | '周三' | '周四' | '周五' | '周六' | '周日';

/**
 * RAG Module - 语义检索模块
 * 
 * v4.5 活动语义搜索功能
 * 
 * 功能：
 * - 活动向量索引
 * - 混合检索 (Hard Filter + Soft Rank)
 * - 推荐理由生成
 */

// 核心函数
export { 
  indexActivity, 
  indexActivities, 
  deleteIndex, 
  onActivityStatusChange,
  search,
  generateMatchReason,
} from './search';

// 工具函数
export {
  enrichActivityText,
  inferVibe,
  generateEmbedding,
  generateEmbeddings,
  generateActivityEmbedding,
  getDayOfWeek,
  getTimeOfDay,
  formatHumanReadableTime,
} from './utils';

// 类型
export type {
  HybridSearchParams,
  SearchFilters,
  ScoredActivity,
  IndexItem,
  BatchIndexResult,
  RagConfig,
  ActivityVibe,
  TimeOfDay,
  DayOfWeek,
} from './types';

export { DEFAULT_RAG_CONFIG } from './types';

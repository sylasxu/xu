/**
 * Intent Module - 意图识别模块
 * 
 * 导出意图分类和路由相关类型和函数
 */

// Types
export type {
  IntentType,
  ClassifyResult,
  ClassifyContext,
} from './types';

// Definitions
export {
  intentPatterns,
  intentPriority,
  draftModifyPatterns,
} from './definitions';

// Classifier
export {
  classifyIntent,
  classifyByRegex,
  classifyDraftContext,
  classifyIntentSync,
} from './classifier';

// Router
export {
  isChitchatIntent,
} from './router';

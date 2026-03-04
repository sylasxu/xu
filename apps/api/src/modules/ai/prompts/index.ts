/**
 * Prompts Module - 提示词模块
 *
 * 核心导出：getSystemPrompt 由 prompt-template.service 提供（DB 模板 + 插值 + 降级）
 * 同步导出模板构建所需类型和工具函数
 */

// 核心：DB 模板驱动的 System Prompt
export { getSystemPrompt, getTemplatePreview, buildTemplateVariables } from './prompt-template.service';

// Types
export type {
  PromptContext,
  ActivityDraftForPrompt,
  PromptTemplate,
  PromptInfo,
} from './types';

// Builder utilities
export {
  formatDateTime,
  getTomorrowStr,
  escapeXml,
  buildContextSection,
  buildRoleSection,
  buildRulesSection,
  buildExamplesSection,
  combinePromptSections,
} from './builder';

// Activity Guide（从 v39 提取的独立模块）
export { ACTIVITY_GUIDE, getActivityGuide } from './activity-guide';

// Fallback Template
export { FALLBACK_TEMPLATE, FALLBACK_METADATA } from './fallback-template';

// Interpolator
export { interpolateTemplate } from './interpolator';

// Widget Catalog
export { generateWidgetCatalog } from './widget-catalog';

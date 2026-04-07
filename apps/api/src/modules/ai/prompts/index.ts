/**
 * Prompts Module - 提示词模块
 *
 * System Prompt 为数据库必需配置：启动即校验，运行时只从 ai_configs 读取。
 */

export {
  getSystemPrompt,
  getTemplatePreview,
  buildTemplateVariables,
  getPromptTemplateConfig,
  getPromptTemplateMetadata,
  ensureSystemPromptConfigured,
} from './prompt-template.service';

export type {
  PromptContext,
  ActivityDraftForPrompt,
  PromptTemplate,
  PromptInfo,
} from './types';

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

export { interpolateTemplate } from './interpolator';

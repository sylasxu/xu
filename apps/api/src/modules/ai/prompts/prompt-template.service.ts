/**
 * Prompt Template Service
 *
 * 从 ai_configs 读取必需的 system prompt 模板，
 * 缺失或格式错误时直接抛错，禁止静默降级。
 */

import { getRequiredConfigValue } from '../config/config.service';
import { formatDateTime, getTomorrowStr, escapeXml } from './builder';
import { interpolateTemplate } from './interpolator';
import type { PromptContext } from './types';

/** ai_configs 中的 configKey */
const CONFIG_KEY = 'prompts.system_template';

interface PromptTemplateMetadata {
  version?: string;
  description?: string;
  lastModified?: string;
  supportedVariables?: string[];
  features?: string[];
}

/** DB 存储的模板 JSON 结构 */
export interface PromptTemplateConfig {
  template: string;
  metadata?: PromptTemplateMetadata;
}

function isPromptTemplateConfig(value: unknown): value is PromptTemplateConfig {
  if (!value || typeof value !== 'object') return false;

  const template = (value as { template?: unknown }).template;
  return typeof template === 'string' && template.trim().length > 0;
}

export async function getPromptTemplateConfig(): Promise<PromptTemplateConfig> {
  const config = await getRequiredConfigValue<unknown>(CONFIG_KEY);

  if (!isPromptTemplateConfig(config)) {
    throw new Error(
      `[PromptTemplateService] 配置 ${CONFIG_KEY} 格式非法，要求 { template: string, metadata?: object }`,
    );
  }

  return config;
}

export async function ensureSystemPromptConfigured(): Promise<void> {
  await getPromptTemplateConfig();
}

export function getPromptTemplateMetadata(config: PromptTemplateConfig): {
  version: string;
  description: string;
  lastModified: string;
  features: string[];
} {
  return {
    version: config.metadata?.version || 'unknown',
    description: config.metadata?.description || '未填写描述',
    lastModified: config.metadata?.lastModified || 'unknown',
    features: Array.isArray(config.metadata?.features) ? config.metadata.features : [],
  };
}

/**
 * 构建插值变量字典
 *
 * 变量值包含必要的前缀（如 "用户: "、"草稿: "），
 * 以便模板中直接使用 {{userNickname}} 而无需额外格式化。
 */
export function buildTemplateVariables(
  ctx: PromptContext,
  contextXml?: string,
): Record<string, string> {
  const { currentTime, userLocation, userNickname, draftContext, memoryContext } = ctx;

  const timeStr = formatDateTime(currentTime);
  const tomorrowStr = getTomorrowStr(currentTime);

  const locationStr = userLocation
    ? escapeXml(userLocation.name || '未提供')
    : '未提供';

  const nicknameVar = userNickname ? `用户: ${escapeXml(userNickname)}` : '';

  const draftVar = draftContext
    ? `草稿: ${JSON.stringify({
        id: draftContext.activityId,
        title: draftContext.currentDraft.title,
        type: draftContext.currentDraft.type,
        location: draftContext.currentDraft.locationName,
        time: draftContext.currentDraft.startAt,
      })}`
    : '';

  return {
    timeStr,
    locationStr,
    userNickname: nicknameVar,
    draftJson: draftVar,
    tomorrowStr,
    enrichmentXml: contextXml || '',
    memoryContext: memoryContext || '',
  };
}

/**
 * 获取 System Prompt（DB 模板 + 插值）
 */
export async function getSystemPrompt(
  ctx: PromptContext,
  contextXml?: string,
): Promise<string> {
  const config = await getPromptTemplateConfig();
  const variables = buildTemplateVariables(ctx, contextXml);

  return interpolateTemplate(config.template, variables);
}

/**
 * 获取模板预览（Admin 用，使用模拟数据）
 */
export function getTemplatePreview(template: string): string {
  const mockCtx: PromptContext = {
    currentTime: new Date(),
    userLocation: { lat: 29.5630, lng: 106.5516, name: '观音桥' },
    userNickname: '测试用户',
    draftContext: undefined,
    memoryContext: '喜欢火锅，不喝酒，周末有空',
  };

  const variables = buildTemplateVariables(mockCtx, '');

  return interpolateTemplate(template, variables);
}

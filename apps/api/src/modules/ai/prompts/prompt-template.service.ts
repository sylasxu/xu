/**
 * Prompt Template Service
 *
 * 核心服务：从 ai_configs 读取模板 → 构建变量 → 插值 → 返回 System Prompt
 * DB 不可用时自动降级到 FALLBACK_TEMPLATE
 */

import { getConfigValue } from '../config/config.service';
import { formatDateTime, getTomorrowStr, escapeXml } from './builder';
import { FALLBACK_TEMPLATE } from './fallback-template';
import { interpolateTemplate } from './interpolator';
import { generateWidgetCatalog } from './widget-catalog';
import type { PromptContext } from './types';

/** ai_configs 中的 configKey */
const CONFIG_KEY = 'prompts.system_template';

/** DB 存储的模板 JSON 结构 */
interface PromptTemplateConfig {
  template: string;
  metadata: {
    version: string;
    description: string;
    lastModified: string;
    supportedVariables: string[];
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
  widgetCatalog?: string,
): Record<string, string> {
  const { currentTime, userLocation, userNickname, draftContext, workingMemory } = ctx;

  const timeStr = formatDateTime(currentTime);
  const tomorrowStr = getTomorrowStr(currentTime);

  // 位置
  const locationStr = userLocation
    ? `${userLocation.lat.toFixed(4)},${userLocation.lng.toFixed(4)} (${escapeXml(userLocation.name || '当前位置')})`
    : '未提供';

  // 用户昵称（含前缀，空时为空字符串 → 插值后该行消失）
  const nicknameVar = userNickname ? `用户: ${escapeXml(userNickname)}` : '';

  // 草稿（含前缀）
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
    widgetCatalog: widgetCatalog || '',
    workingMemory: workingMemory || '',
  };
}

/**
 * 获取 System Prompt（DB 模板 + 插值）
 *
 * 保持与原 getSystemPrompt 相同的函数签名
 */
export async function getSystemPrompt(
  ctx: PromptContext,
  contextXml?: string,
): Promise<string> {
  let template = FALLBACK_TEMPLATE;

  try {
    const config = await getConfigValue<PromptTemplateConfig | null>(CONFIG_KEY, null);
    if (config?.template) {
      template = config.template;
    } else if (config === null) {
      console.warn('[PromptTemplateService] 模板不存在，使用 Fallback Template');
    }
  } catch (error) {
    console.warn('[PromptTemplateService] 读取模板失败，使用 Fallback Template', error);
  }

  const catalog = generateWidgetCatalog();
  const variables = buildTemplateVariables(ctx, contextXml, catalog);

  return interpolateTemplate(template, variables);
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
    workingMemory: '喜欢火锅，不喝酒，周末有空',
  };

  const catalog = generateWidgetCatalog();
  const variables = buildTemplateVariables(mockCtx, '', catalog);

  return interpolateTemplate(template, variables);
}

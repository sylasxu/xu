/**
 * Prompts Module - 提示词模块
 * 
 * 版本化管理：通过 PROMPT_REGISTRY 注册多版本 Prompt，
 * 通过 getConfigValue 动态切换活跃版本，支持后台一键切换/回滚。
 */

import { getConfigValue } from '../config/config.service';
import type { PromptContext, PromptInfo } from './types';

// v38
import {
  buildXmlSystemPrompt as buildV38,
  getPromptInfo as getV38Info,
} from './xiaoju-v38';

// v39
import {
  buildXmlSystemPrompt as buildV39,
  getPromptInfo as getV39Info,
} from './xiaoju-v39';

// ============ 版本注册表 ============

export interface PromptVersion {
  buildSystemPrompt: (ctx: PromptContext, contextXml?: string) => string;
  getPromptInfo: () => PromptInfo;
}

/**
 * Prompt 版本注册表
 * 新增版本时在此注册即可
 */
export const PROMPT_REGISTRY = new Map<string, PromptVersion>([
  ['v38', { buildSystemPrompt: buildV38, getPromptInfo: getV38Info }],
  ['v39', { buildSystemPrompt: buildV39, getPromptInfo: getV39Info }],
]);

const DEFAULT_VERSION = 'v39';

/**
 * 获取当前活跃版本的 System Prompt
 * 
 * 通过 getConfigValue('prompts.active_version') 动态读取版本号，
 * 支持后台一键切换/回滚。
 */
export async function getSystemPrompt(ctx: PromptContext, contextXml?: string): Promise<string> {
  const version = await getConfigValue('prompts.active_version', DEFAULT_VERSION);
  const entry = PROMPT_REGISTRY.get(version) ?? PROMPT_REGISTRY.get(DEFAULT_VERSION)!;
  return entry.buildSystemPrompt(ctx, contextXml);
}

/**
 * 获取当前活跃版本的 Prompt 信息（Admin 用）
 */
export async function getActivePromptInfo(): Promise<PromptInfo> {
  const version = await getConfigValue('prompts.active_version', DEFAULT_VERSION);
  const entry = PROMPT_REGISTRY.get(version) ?? PROMPT_REGISTRY.get(DEFAULT_VERSION)!;
  return entry.getPromptInfo();
}

/**
 * 获取所有已注册版本列表
 */
export function getRegisteredVersions(): string[] {
  return [...PROMPT_REGISTRY.keys()];
}

// ============ 原有导出（保持向后兼容） ============

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

// Xiaoju Prompt (v3.9) - 保持向后兼容
export {
  PROMPT_VERSION,
  PROMPT_TECHNIQUES,
  buildXmlSystemPrompt,
  getPromptInfo,
} from './xiaoju-v39';

/**
 * Output Guard - 输出护栏
 * 
 * 检测和过滤 AI 输出中的敏感内容
 */

import type { GuardResult, OutputGuardConfig, RiskLevel } from './types';
import { DEFAULT_OUTPUT_GUARD_CONFIG } from './types';
import { getConfigValue } from '../config/config.service';

/**
 * PII 模式（个人身份信息）
 */
const PII_PATTERNS = [
  // 手机号
  { pattern: /1[3-9]\d{9}/, name: 'phone', replacement: '[手机号]' },
  // 身份证号
  { pattern: /\d{17}[\dXx]/, name: 'id_card', replacement: '[身份证号]' },
  // 银行卡号
  { pattern: /\d{16,19}/, name: 'bank_card', replacement: '[银行卡号]' },
  // 邮箱
  { pattern: /[\w.-]+@[\w.-]+\.\w+/, name: 'email', replacement: '[邮箱]' },
];

/**
 * 有害内容模式
 */
const HARMFUL_PATTERNS = [
  // 歧视性内容
  /傻[逼B]|智障|脑残/,
  // 暴力内容
  /去死|弄死你|打死/,
  // 不当建议
  /教你.*骗|如何.*诈骗/,
];

/**
 * 检查输出
 */
export async function checkOutput(
  output: string,
  config: Partial<OutputGuardConfig> = {}
): Promise<GuardResult> {
  const dynamicConfig = await getConfigValue<Partial<OutputGuardConfig>>('guardrails.output_config', {});
  const cfg = { ...DEFAULT_OUTPUT_GUARD_CONFIG, ...dynamicConfig, ...config };
  const triggeredRules: string[] = [];
  let riskLevel: RiskLevel = 'low';
  
  // 1. 长度检查
  if (output.length > cfg.maxOutputLength) {
    triggeredRules.push('max_length');
    riskLevel = 'medium';
  }
  
  // 2. PII 检测
  if (cfg.enablePIIDetection) {
    for (const { pattern, name } of PII_PATTERNS) {
      if (pattern.test(output)) {
        triggeredRules.push(`pii_${name}`);
        riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
      }
    }
  }
  
  // 3. 有害内容检测
  if (cfg.enableHarmfulContentDetection) {
    for (const pattern of HARMFUL_PATTERNS) {
      if (pattern.test(output)) {
        triggeredRules.push('harmful_content');
        riskLevel = 'high';
        break;
      }
    }
  }
  
  const blocked = riskLevel === 'high';
  
  return {
    passed: !blocked,
    blocked,
    reason: blocked ? '输出包含不当内容' : undefined,
    riskLevel,
    triggeredRules: triggeredRules.length > 0 ? triggeredRules : undefined,
    suggestedResponse: blocked ? '抱歉，我无法回答这个问题。' : undefined,
  };
}

/**
 * 清理输出（移除/替换敏感内容）
 */
export async function sanitizeOutput(
  output: string,
  config: Partial<OutputGuardConfig> = {}
): Promise<string> {
  const dynamicConfig = await getConfigValue<Partial<OutputGuardConfig>>('guardrails.output_config', {});
  const cfg = { ...DEFAULT_OUTPUT_GUARD_CONFIG, ...dynamicConfig, ...config };
  let sanitized = output;
  
  // 替换 PII
  if (cfg.enablePIIDetection) {
    for (const { pattern, replacement } of PII_PATTERNS) {
      sanitized = sanitized.replace(new RegExp(pattern, 'g'), replacement);
    }
  }
  
  // 截断过长输出
  if (sanitized.length > cfg.maxOutputLength) {
    sanitized = sanitized.slice(0, cfg.maxOutputLength) + '...';
  }
  
  return sanitized;
}

/**
 * 快速检查（仅检查是否应该阻止）
 */
export async function shouldBlockOutput(output: string): Promise<boolean> {
  const result = await checkOutput(output);
  return result.blocked;
}


/**
 * Input Guard - 输入护栏
 * 
 * 检测和过滤恶意输入
 * 
 * v4.6 更新：拦截时记录安全事件到数据库
 */

import type { GuardResult, InputGuardConfig, RiskLevel } from './types';
import { DEFAULT_INPUT_GUARD_CONFIG } from './types';
import { getConfigValue } from '../config/config.service';
import { db, aiSensitiveWords, eq } from '@juchang/db';

// 延迟导入避免循环依赖
let recordSecurityEventFn: ((event: {
  userId?: string;
  eventType: string;
  triggerWord?: string;
  inputText?: string;
  severity?: string;
  metadata?: Record<string, unknown>;
}) => Promise<void>) | null = null;

async function getRecordSecurityEvent() {
  if (!recordSecurityEventFn) {
    const { recordSecurityEvent } = await import('../ai-ops.service');
    recordSecurityEventFn = recordSecurityEvent;
  }
  return recordSecurityEventFn;
}

/**
 * 注入攻击模式
 */
const INJECTION_PATTERNS = [
  // Prompt 注入
  /ignore\s+(previous|above|all)\s+(instructions?|prompts?)/i,
  /disregard\s+(previous|above|all)/i,
  /forget\s+(everything|all|previous)/i,
  /你是一个|你现在是|假装你是|扮演/,
  /system\s*prompt/i,
  /\[INST\]|\[\/INST\]/i,
  /<\|im_start\|>|<\|im_end\|>/i,
  
  // 越狱尝试
  /jailbreak/i,
  /DAN\s*mode/i,
  /developer\s*mode/i,
];

/**
 * 敏感词列表（基础硬编码）
 */
const SENSITIVE_WORDS = [
  // 政治敏感
  '习近平', '共产党', '六四', '天安门', '法轮功',
  // 暴力相关
  '杀人', '自杀', '炸弹', '枪支',
  // 色情相关
  '色情', '裸体', '性交',
  // 诈骗相关
  '刷单', '兼职赚钱', '高额回报',
];

/**
 * 动态敏感词缓存（从 ai_sensitive_words 表加载）
 */
let cachedDynamicSensitiveWords: string[] | null = null;
let dynamicCacheExpiry = 0;
const DYNAMIC_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

/**
 * 从数据库加载启用状态的敏感词（带 5 分钟内存缓存）
 */
async function getDynamicSensitiveWords(): Promise<string[]> {
  if (cachedDynamicSensitiveWords && Date.now() < dynamicCacheExpiry) {
    return cachedDynamicSensitiveWords;
  }
  try {
    const rows = await db
      .select({ word: aiSensitiveWords.word })
      .from(aiSensitiveWords)
      .where(eq(aiSensitiveWords.isActive, true));
    cachedDynamicSensitiveWords = rows.map(r => r.word);
    dynamicCacheExpiry = Date.now() + DYNAMIC_CACHE_TTL;
    return cachedDynamicSensitiveWords;
  } catch {
    // 数据库加载失败时返回已有缓存或空数组
    return cachedDynamicSensitiveWords ?? [];
  }
}

/**
 * 检查输入
 */
export async function checkInput(
  input: string,
  config: Partial<InputGuardConfig> = {},
  context?: { userId?: string }
): Promise<GuardResult> {
  const dynamicConfig = await getConfigValue<Partial<InputGuardConfig>>('guardrails.input_config', {});
  const cfg = { ...DEFAULT_INPUT_GUARD_CONFIG, ...dynamicConfig, ...config };
  const triggeredRules: string[] = [];
  let riskLevel: RiskLevel = 'low';
  let triggerWord: string | undefined;
  
  // 1. 长度检查
  if (input.length > cfg.maxInputLength) {
    // 异步记录安全事件（不阻塞）
    recordSecurityEventAsync({
      userId: context?.userId,
      eventType: 'input_blocked',
      triggerWord: undefined,
      inputText: input.slice(0, 200),
      severity: 'low',
      metadata: { reason: 'max_length', length: input.length },
    });
    
    return {
      passed: false,
      blocked: true,
      reason: '输入内容过长',
      riskLevel: 'medium',
      triggeredRules: ['max_length'],
      suggestedResponse: '消息太长了，请精简一下再发送～',
    };
  }
  
  // 2. 注入检测
  if (cfg.enableInjectionDetection) {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        triggeredRules.push('injection_detected');
        riskLevel = 'high';
        triggerWord = input.match(pattern)?.[0];
        break;
      }
    }
  }
  
  // 3. 敏感词检测
  if (cfg.enableSensitiveWordDetection) {
    const dynamicWords = await getDynamicSensitiveWords();
    const allSensitiveWords = [
      ...SENSITIVE_WORDS,
      ...dynamicWords,
      ...(cfg.customSensitiveWords || []),
    ];
    
    for (const word of allSensitiveWords) {
      if (input.includes(word)) {
        triggeredRules.push('sensitive_word');
        riskLevel = riskLevel === 'high' ? 'critical' : 'high';
        triggerWord = word;
        break;
      }
    }
  }
  
  // 判断是否阻止
  const blocked = riskLevel === 'high' || riskLevel === 'critical';
  
  // 如果被阻止，异步记录安全事件
  if (blocked) {
    recordSecurityEventAsync({
      userId: context?.userId,
      eventType: 'input_blocked',
      triggerWord,
      inputText: input.slice(0, 200), // 只存前 200 字符
      severity: riskLevel === 'critical' ? 'high' : 'medium',
      metadata: { triggeredRules },
    });
  }
  
  return {
    passed: !blocked,
    blocked,
    reason: blocked ? '检测到不当内容' : undefined,
    riskLevel,
    triggeredRules: triggeredRules.length > 0 ? triggeredRules : undefined,
    suggestedResponse: blocked ? '这个话题我帮不了你 😅' : undefined,
  };
}

/**
 * 异步记录安全事件（不阻塞主流程）
 */
function recordSecurityEventAsync(event: {
  userId?: string;
  eventType: string;
  triggerWord?: string;
  inputText?: string;
  severity?: string;
  metadata?: Record<string, unknown>;
}): void {
  getRecordSecurityEvent()
    .then(fn => fn(event))
    .catch(() => {}); // 忽略错误，不影响主流程
}

/**
 * 清理输入（移除潜在危险内容）
 */
export function sanitizeInput(input: string): string {
  let sanitized = input;
  
  // 移除控制字符
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // 移除过多的空白
  sanitized = sanitized.replace(/\s{10,}/g, ' ');
  
  // 移除潜在的 prompt 注入标记
  sanitized = sanitized.replace(/<\|[^|]+\|>/g, '');
  sanitized = sanitized.replace(/\[INST\]|\[\/INST\]/gi, '');
  
  return sanitized.trim();
}

/**
 * 快速检查（仅检查是否应该阻止）
 */
export async function shouldBlock(input: string): Promise<boolean> {
  const result = await checkInput(input);
  return result.blocked;
}


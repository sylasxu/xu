/**
 * Input Guard Processor (v4.8)
 * 
 * 负责输入安全检查：
 * - 敏感词检测
 * - 注入攻击检测
 * - 输入长度限制
 * 
 * 如果检测到违规内容，返回失败结果，阻止后续处理
 */

import type { ProcessorContext, ProcessorResult } from './types';

// 敏感词列表（简化版，实际应从数据库加载）
const SENSITIVE_WORDS = [
  '政治',
  '暴力',
  '色情',
  '赌博',
  '毒品',
  // ... 更多敏感词
];

// 注入攻击模式
const INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /forget\s+everything/i,
  /you\s+are\s+now/i,
  /system\s*:/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
];

// 最大输入长度
const MAX_INPUT_LENGTH = 2000;

/**
 * Input Guard Processor
 * 
 * 检查用户输入的安全性
 */
export async function inputGuard(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();
  
  try {
    const { userInput } = context;
    
    // 1. 检查输入长度
    if (userInput.length > MAX_INPUT_LENGTH) {
      return {
        success: false,
        context,
        executionTime: Date.now() - startTime,
        error: `输入过长（${userInput.length} 字符，最大 ${MAX_INPUT_LENGTH} 字符）`,
        data: { inputLength: userInput.length },
      };
    }
    
    // 2. 敏感词检测
    const foundSensitiveWords = SENSITIVE_WORDS.filter(word => 
      userInput.includes(word)
    );
    
    if (foundSensitiveWords.length > 0) {
      return {
        success: false,
        context,
        executionTime: Date.now() - startTime,
        error: `检测到敏感词：${foundSensitiveWords.join(', ')}`,
        data: { sensitiveWords: foundSensitiveWords },
      };
    }
    
    // 3. 注入攻击检测
    const foundInjectionPattern = INJECTION_PATTERNS.find(pattern => 
      pattern.test(userInput)
    );
    
    if (foundInjectionPattern) {
      return {
        success: false,
        context,
        executionTime: Date.now() - startTime,
        error: '检测到可疑的注入攻击模式',
        data: { pattern: foundInjectionPattern.source },
      };
    }
    
    // 4. 所有检查通过
    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      data: {
        inputLength: userInput.length,
        checksPerformed: ['length', 'sensitive-words', 'injection'],
      },
    };
    
  } catch (error) {
    return {
      success: false,
      context,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

// Processor 元数据
inputGuard.processorName = 'input-guard';

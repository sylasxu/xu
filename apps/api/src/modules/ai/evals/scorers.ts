/**
 * Scorers - 评分器集合
 * 
 * 提供各种评估维度的评分器
 */

import type { Scorer, EvalSample, EvalResult } from './types';

/**
 * 意图匹配评分器
 * 
 * 检查实际意图是否与期望意图匹配
 */
export const intentScorer: Scorer = {
  name: 'intent',
  description: '意图匹配评分',
  weight: 1.0,
  score: async (sample: EvalSample, result: EvalResult): Promise<number> => {
    if (!sample.expectedIntent) return 1.0; // 无期望则满分
    if (!result.actualIntent) return 0.0;
    
    return sample.expectedIntent === result.actualIntent ? 1.0 : 0.0;
  },
};

/**
 * Tool 调用评分器
 * 
 * 检查是否调用了期望的 Tool
 */
export const toolCallScorer: Scorer = {
  name: 'toolCall',
  description: 'Tool 调用评分',
  weight: 1.0,
  score: async (sample: EvalSample, result: EvalResult): Promise<number> => {
    if (!sample.expectedToolCalls || sample.expectedToolCalls.length === 0) {
      return 1.0; // 无期望则满分
    }
    
    const actualTools = result.actualToolCalls || [];
    const expectedTools = sample.expectedToolCalls;
    
    // 计算召回率
    let matched = 0;
    for (const expected of expectedTools) {
      if (actualTools.includes(expected)) {
        matched++;
      }
    }
    
    return matched / expectedTools.length;
  },
};

/**
 * 相关性评分器（简化版）
 * 
 * 基于关键词匹配评估输出相关性
 */
export const relevanceScorer: Scorer = {
  name: 'relevance',
  description: '输出相关性评分',
  weight: 1.0,
  score: async (sample: EvalSample, result: EvalResult): Promise<number> => {
    if (!sample.expectedOutput) return 1.0;
    
    const expected = sample.expectedOutput.toLowerCase();
    const actual = result.actualOutput.toLowerCase();
    
    // 提取关键词（简化：按空格分词）
    const expectedWords = expected.split(/\s+/).filter(w => w.length > 1);
    const actualWords = new Set(actual.split(/\s+/));
    
    if (expectedWords.length === 0) return 1.0;
    
    let matched = 0;
    for (const word of expectedWords) {
      if (actualWords.has(word)) {
        matched++;
      }
    }
    
    return matched / expectedWords.length;
  },
};

/**
 * 语气风格评分器
 * 
 * 检查输出是否符合"接地气"的语气要求
 */
export const toneScorer: Scorer = {
  name: 'tone',
  description: '语气风格评分',
  weight: 0.5,
  score: async (_sample: EvalSample, result: EvalResult): Promise<number> => {
    const output = result.actualOutput;
    
    // 负面模式（太装逼的表达）
    const negativePatterns = [
      /已为您/,
      /正在解析/,
      /向量/,
      /契约/,
      /配额已耗尽/,
      /系统检测到/,
    ];
    
    // 正面模式（接地气的表达）
    const positivePatterns = [
      /帮你/,
      /收到/,
      /好的/,
      /～/,
      /😊|😅|🎉/,
    ];
    
    let score = 0.7; // 基础分
    
    // 负面模式扣分
    for (const pattern of negativePatterns) {
      if (pattern.test(output)) {
        score -= 0.15;
      }
    }
    
    // 正面模式加分
    for (const pattern of positivePatterns) {
      if (pattern.test(output)) {
        score += 0.1;
      }
    }
    
    return Math.max(0, Math.min(1, score));
  },
};

/**
 * 上下文利用评分器
 * 
 * 检查是否正确利用了上下文信息
 */
export const contextScorer: Scorer = {
  name: 'context',
  description: '上下文利用评分',
  weight: 0.8,
  score: async (sample: EvalSample, result: EvalResult): Promise<number> => {
    if (!sample.context) return 1.0;
    
    const output = result.actualOutput.toLowerCase();
    let utilized = 0;
    let total = 0;
    
    // 检查位置信息
    if (sample.context.location) {
      total++;
      const loc = sample.context.location as { name?: string };
      if (loc.name && output.includes(loc.name.toLowerCase())) {
        utilized++;
      }
    }
    
    // 检查用户昵称
    if (sample.context.nickname) {
      total++;
      if (output.includes(String(sample.context.nickname).toLowerCase())) {
        utilized++;
      }
    }
    
    // 检查时间信息
    if (sample.context.time) {
      total++;
      const timeStr = String(sample.context.time);
      if (output.includes(timeStr) || output.includes('今天') || output.includes('明天')) {
        utilized++;
      }
    }
    
    if (total === 0) return 1.0;
    return utilized / total;
  },
};

/**
 * 响应长度评分器
 * 
 * 检查响应长度是否合适（不太长也不太短）
 */
export const lengthScorer: Scorer = {
  name: 'length',
  description: '响应长度评分',
  weight: 0.3,
  score: async (_sample: EvalSample, result: EvalResult): Promise<number> => {
    const length = result.actualOutput.length;
    
    // 理想长度范围：50-500 字符
    if (length < 10) return 0.2;
    if (length < 50) return 0.6;
    if (length <= 500) return 1.0;
    if (length <= 1000) return 0.8;
    return 0.5; // 太长
  },
};

/**
 * 中文输出质量评分器
 * 
 * 检测中文输出质量：非空、长度合理、无乱码/截断
 */
export const chineseQualityScorer: Scorer = {
  name: 'chineseQuality',
  description: '中文输出质量评分',
  weight: 1.0,
  score: async (_sample: EvalSample, result: EvalResult): Promise<number> => {
    const output = result.actualOutput;

    // 1. 非空检查
    if (!output || output.trim().length === 0) return 0;

    let score = 1.0;

    // 2. 长度合理性：10-2000 字符为理想范围
    const len = output.length;
    if (len < 10) score -= 0.4;
    else if (len > 2000) score -= 0.2;

    // 3. 乱码检测：连续不可读字符（非中日韩、非ASCII可打印、非常见标点/emoji）
    const garbledPattern = /[\uFFFD]{2,}|[\x00-\x08\x0E-\x1F]{2,}/;
    if (garbledPattern.test(output)) score -= 0.3;

    // 4. 截断检测：以不完整的句子结尾（无标点且非自然结尾）
    const lastChar = output.trim().slice(-1);
    const naturalEndings = /[。！？~～…）》」』\]\)!?.]/;
    const endsWithChinese = /[\u4e00-\u9fff]/;
    // 如果最后一个字符既不是标点也不是中文字符，可能被截断
    if (!naturalEndings.test(lastChar) && !endsWithChinese.test(lastChar) && len > 50) {
      score -= 0.2;
    }

    // 5. 高比例替换字符（U+FFFD）检测
    const replacementCount = (output.match(/\uFFFD/g) || []).length;
    if (replacementCount > 0 && replacementCount / len > 0.05) {
      score -= 0.3;
    }

    return Math.max(0, Math.min(1, score));
  },
};

/**
 * 默认评分器集合
 */
export const defaultScorers: Scorer[] = [
  intentScorer,
  toolCallScorer,
  relevanceScorer,
  toneScorer,
  lengthScorer,
  chineseQualityScorer,
];

/**
 * 获取评分器
 */
export function getScorer(name: string): Scorer | undefined {
  return defaultScorers.find(s => s.name === name);
}

/**
 * 获取所有评分器名称
 */
export function getScorerNames(): string[] {
  return defaultScorers.map(s => s.name);
}


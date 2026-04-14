/**
 * Eval Runner - 评估运行器
 * 
 * 执行评估任务并收集结果
 */

import type { 
  EvalSample, 
  EvalResult, 
  EvalRunConfig, 
  EvalRunResult,
  Scorer,
  Dataset,
} from './types';
import { DEFAULT_EVAL_CONFIG } from './types';
import { defaultScorers } from './scorers';
import { getConfigValue } from '../config/config.service';

/**
 * 生成运行 ID
 */
function generateRunId(): string {
  return `eval_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 评估单个样本
 */
async function evaluateSample(
  sample: EvalSample,
  executor: (input: string, context?: Record<string, unknown>) => Promise<{
    output: string;
    intent?: string;
    toolCalls?: string[];
  }>,
  scorers: Scorer[],
  timeout: number,
  passThreshold: number
): Promise<EvalResult> {
  const startTime = Date.now();
  
  try {
    // 执行并设置超时
    const executePromise = executor(sample.input, sample.context);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Evaluation timeout')), timeout);
    });
    
    const response = await Promise.race([executePromise, timeoutPromise]);
    
    const result: EvalResult = {
      sampleId: sample.id,
      actualOutput: response.output,
      actualIntent: response.intent,
      actualToolCalls: response.toolCalls,
      scores: {},
      passed: true,
      duration: Date.now() - startTime,
    };
    
    // 运行所有评分器
    for (const scorer of scorers) {
      try {
        const score = await scorer.score(sample, result);
        result.scores[scorer.name] = score;
      } catch (error) {
        result.scores[scorer.name] = 0;
        console.warn(`Scorer ${scorer.name} failed:`, error);
      }
    }
    
    // 计算是否通过（所有分数 >= passThreshold）
    result.passed = Object.values(result.scores).every(s => s >= passThreshold);
    
    return result;
  } catch (error) {
    return {
      sampleId: sample.id,
      actualOutput: '',
      scores: {},
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 运行评估
 */
export async function runEval(
  config: EvalRunConfig,
  executor: (input: string, context?: Record<string, unknown>) => Promise<{
    output: string;
    intent?: string;
    toolCalls?: string[];
  }>
): Promise<EvalRunResult> {
  // 从动态配置读取默认值
  const dynamicConfig = await getConfigValue('evals.run_config', DEFAULT_EVAL_CONFIG);

  const { 
    dataset, 
    scorers = defaultScorers,
    concurrency = dynamicConfig.concurrency,
    timeout = dynamicConfig.timeout,
  } = config;
  
  const passThreshold = dynamicConfig.passThreshold;
  const runId = generateRunId();
  const startTime = new Date();
  const results: EvalResult[] = [];
  
  // 分批并发执行
  const samples = [...dataset.samples];
  
  for (let i = 0; i < samples.length; i += concurrency) {
    const batch = samples.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(sample => evaluateSample(sample, executor, scorers, timeout, passThreshold))
    );
    results.push(...batchResults);
  }
  
  // 统计结果
  const passedCount = results.filter(r => r.passed && !r.error).length;
  const failedCount = results.filter(r => !r.passed && !r.error).length;
  const errorCount = results.filter(r => r.error).length;
  
  // 计算平均分数
  const averageScores: Record<string, number> = {};
  const scorerNames = scorers.map(s => s.name);
  
  for (const name of scorerNames) {
    const scores = results
      .filter(r => !r.error && r.scores[name] !== undefined)
      .map(r => r.scores[name]);
    
    if (scores.length > 0) {
      averageScores[name] = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }
  
  const runResult: EvalRunResult = {
    runId,
    datasetName: dataset.name,
    startTime,
    endTime: new Date(),
    totalSamples: samples.length,
    passedCount,
    failedCount,
    errorCount,
    averageScores,
    results,
  };

  return runResult;
}

/**
 * 创建简单数据集
 */
export function createDataset(
  name: string,
  samples: Array<Omit<EvalSample, 'id'>>
): Dataset {
  return {
    name,
    samples: samples.map((s, i) => ({
      ...s,
      id: `${name}_${i}`,
    })),
    createdAt: new Date(),
  };
}

/**
 * xu 评估数据集（覆盖所有主要意图类型）
 */
export const xuEvalDataset: Dataset = createDataset('xu_basic', [
  // === create 意图（4 个样本） ===
  {
    input: '帮我组个火锅局',
    expectedIntent: 'create',
    expectedToolCalls: ['createActivityDraft'],
    tags: ['create', 'food'],
  },
  {
    input: '周六下午想约人去爬山，帮我发个活动',
    expectedIntent: 'create',
    expectedToolCalls: ['createActivityDraft'],
    tags: ['create', 'outdoor'],
  },
  {
    input: '我想组个剧本杀局，4-6人，今晚7点',
    expectedIntent: 'create',
    expectedToolCalls: ['createActivityDraft'],
    tags: ['create', 'game'],
  },
  {
    input: '发个周末骑行活动，从奥森出发',
    expectedIntent: 'create',
    expectedToolCalls: ['createActivityDraft'],
    tags: ['create', 'sports'],
  },

  // === explore 意图（4 个样本） ===
  {
    input: '附近有什么活动',
    expectedIntent: 'explore',
    expectedToolCalls: ['exploreNearby'],
    tags: ['explore'],
  },
  {
    input: '看看周围有没有人组饭局',
    expectedIntent: 'explore',
    expectedToolCalls: ['exploreNearby'],
    tags: ['explore', 'food'],
  },
  {
    input: '今天晚上有什么好玩的',
    expectedIntent: 'explore',
    expectedToolCalls: ['exploreNearby'],
    tags: ['explore', 'time'],
  },
  {
    input: '三里屯附近有啥活动可以参加',
    expectedIntent: 'explore',
    expectedToolCalls: ['exploreNearby'],
    tags: ['explore', 'location'],
  },

  // === partner 意图（4 个样本） ===
  {
    input: '我想找人一起打羽毛球',
    expectedIntent: 'partner',
    expectedToolCalls: ['createPartnerIntent'],
    tags: ['partner', 'sports'],
  },
  {
    input: '有没有人周末一起去看电影',
    expectedIntent: 'partner',
    expectedToolCalls: ['createPartnerIntent'],
    tags: ['partner', 'entertainment'],
  },
  {
    input: '想找个搭子一起学英语',
    expectedIntent: 'partner',
    expectedToolCalls: ['createPartnerIntent'],
    tags: ['partner', 'study'],
  },
  {
    input: '找人拼车去机场',
    expectedIntent: 'partner',
    expectedToolCalls: ['createPartnerIntent'],
    tags: ['partner', 'travel'],
  },

  // === manage 意图（4 个样本） ===
  {
    input: '取消我的活动',
    expectedIntent: 'manage',
    expectedToolCalls: ['getMyActivities'],
    tags: ['manage'],
  },
  {
    input: '我报名了哪些活动',
    expectedIntent: 'manage',
    expectedToolCalls: ['getMyActivities'],
    tags: ['manage', 'query'],
  },
  {
    input: '帮我看看我发起的那个火锅局',
    expectedIntent: 'manage',
    expectedToolCalls: ['getMyActivities'],
    tags: ['manage', 'detail'],
  },
  {
    input: '修改一下我那个活动的时间',
    expectedIntent: 'manage',
    expectedToolCalls: ['getMyActivities'],
    tags: ['manage', 'edit'],
  },

  // === chitchat 意图（4 个样本） ===
  {
    input: '你好',
    expectedIntent: 'chitchat',
    expectedToolCalls: [],
    tags: ['chitchat'],
  },
  {
    input: '你是谁呀',
    expectedIntent: 'chitchat',
    expectedToolCalls: [],
    tags: ['chitchat', 'identity'],
  },
  {
    input: '今天天气不错',
    expectedIntent: 'chitchat',
    expectedToolCalls: [],
    tags: ['chitchat', 'weather'],
  },
  {
    input: '哈哈哈你好搞笑',
    expectedIntent: 'chitchat',
    expectedToolCalls: [],
    tags: ['chitchat', 'emotion'],
  },

  // === query 意图（2 个样本） ===
  {
    input: '这个活动在哪里集合',
    expectedIntent: 'query',
    expectedToolCalls: ['getActivityDetail'],
    tags: ['query', 'detail'],
  },
  {
    input: '活动还有几个名额',
    expectedIntent: 'query',
    expectedToolCalls: ['getActivityDetail'],
    tags: ['query', 'capacity'],
  },
]);

/**
 * 评估单个响应质量（实时版）
 * 
 * 用于 ai.service.ts 的 onFinish 回调中异步评估
 */
export async function evaluateResponseQuality(params: {
  input: string;
  output: string;
  expectedIntent: string;
  actualToolCalls: string[];
}): Promise<{ score: number; details: Record<string, number> }> {
  const scores: Record<string, number> = {};
  
  // 1. 输出非空检查
  scores.hasOutput = params.output.length > 0 ? 1 : 0;
  
  // 2. 工具调用合理性（简单规则）
  const intentToolMap: Record<string, string[]> = {
    create: ['createActivityDraft'],
    explore: ['exploreNearby'],
    partner: ['createPartnerIntent', 'askPreference'],
    manage: ['getMyActivities'],
    chitchat: [], // 闲聊不需要工具
  };
  const expectedTools = intentToolMap[params.expectedIntent] || [];
  scores.toolMatch = expectedTools.length === 0 
    ? 1 
    : params.actualToolCalls.some(t => expectedTools.includes(t)) ? 1 : 0;
  
  // 3. 输出长度合理性（太短可能有问题）
  scores.outputLength = params.output.length >= 10 ? 1 : 0.5;
  
  // 计算总分
  const avgScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
  
  return { score: avgScore, details: scores };
}

/**
 * 打印评估报告
 */
export function printEvalReport(result: EvalRunResult): void {
  console.log('\n========== 评估报告 ==========');
  console.log(`运行 ID: ${result.runId}`);
  console.log(`数据集: ${result.datasetName}`);
  console.log(`耗时: ${result.endTime.getTime() - result.startTime.getTime()}ms`);
  console.log('');
  console.log(`总样本: ${result.totalSamples}`);
  console.log(`通过: ${result.passedCount} (${(result.passedCount / result.totalSamples * 100).toFixed(1)}%)`);
  console.log(`失败: ${result.failedCount}`);
  console.log(`错误: ${result.errorCount}`);
  console.log('');
  console.log('平均分数:');
  for (const [name, score] of Object.entries(result.averageScores)) {
    console.log(`  ${name}: ${(score * 100).toFixed(1)}%`);
  }
  console.log('================================\n');
}

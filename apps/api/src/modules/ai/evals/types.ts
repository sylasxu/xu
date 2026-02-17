/**
 * Evals Module Types - 评估系统类型定义
 */

/**
 * 评估样本
 */
export interface EvalSample {
  /** 样本 ID */
  id: string;
  /** 输入消息 */
  input: string;
  /** 期望输出（可选） */
  expectedOutput?: string;
  /** 期望意图 */
  expectedIntent?: string;
  /** 期望 Tool 调用 */
  expectedToolCalls?: string[];
  /** 上下文 */
  context?: Record<string, unknown>;
  /** 标签 */
  tags?: string[];
}

/**
 * 评估结果
 */
export interface EvalResult {
  /** 样本 ID */
  sampleId: string;
  /** 实际输出 */
  actualOutput: string;
  /** 实际意图 */
  actualIntent?: string;
  /** 实际 Tool 调用 */
  actualToolCalls?: string[];
  /** 评分结果 */
  scores: Record<string, number>;
  /** 是否通过 */
  passed: boolean;
  /** 耗时（毫秒） */
  duration: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 评分器
 */
export interface Scorer {
  /** 评分器名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 评分函数 */
  score: (sample: EvalSample, result: EvalResult) => Promise<number>;
  /** 权重 */
  weight?: number;
}

/**
 * 数据集
 */
export interface Dataset {
  /** 数据集名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 样本列表 */
  samples: EvalSample[];
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 评估运行配置
 */
export interface EvalRunConfig {
  /** 数据集 */
  dataset: Dataset;
  /** 评分器列表 */
  scorers: Scorer[];
  /** 并发数 */
  concurrency?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否保存结果 */
  saveResults?: boolean;
}

/**
 * 评估运行结果
 */
export interface EvalRunResult {
  /** 运行 ID */
  runId: string;
  /** 数据集名称 */
  datasetName: string;
  /** 开始时间 */
  startTime: Date;
  /** 结束时间 */
  endTime: Date;
  /** 总样本数 */
  totalSamples: number;
  /** 通过数 */
  passedCount: number;
  /** 失败数 */
  failedCount: number;
  /** 错误数 */
  errorCount: number;
  /** 平均分数 */
  averageScores: Record<string, number>;
  /** 详细结果 */
  results: EvalResult[];
}

/**
 * 默认评估配置
 */
export const DEFAULT_EVAL_CONFIG = {
  concurrency: 3,
  timeout: 30000,
  passThreshold: 0.6,
  saveResults: true,
};


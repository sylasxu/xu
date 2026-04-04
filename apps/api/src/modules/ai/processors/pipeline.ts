/**
 * Processor Pipeline Registry & Factory (v4.9)
 *
 * 处理器管线注册表和工厂函数：
 * - registerProcessor：动态注册自定义 Processor
 * - buildPreLLMPipeline：构建 Pre-LLM 管线配置
 * - clearRegistry：清空注册表（用于测试/重置）
 *
 * 内置处理器按设计文档顺序注册：
 *   semantic-recall → intent-classify → user-profile → token-limit
 *
 * 注意：keyword-match-processor 和 input-guard-processor 不在管线中，
 * 它们分别作为独立预检查步骤在管线之前执行。
 *
 * 需求: 1.2, 1.6
 */

import type { ProcessorConfig, ProcessorContext } from './types';
import { intentClassifyProcessor } from './intent-classify';
import { userProfileProcessor } from './user-profile';
import { semanticRecallProcessor } from './semantic-recall';
import { tokenLimitProcessor } from './token-limit';
import { getConfigValue } from '../config/config.service';

/** 处理器管线注册表（模块级单例） */
const processorRegistry = new Map<string, ProcessorConfig>();

/**
 * 注册自定义处理器
 *
 * 自定义处理器会被插入到 token-limit 之前执行。
 */
export function registerProcessor(name: string, config: ProcessorConfig): void {
  processorRegistry.set(name, config);
}

/** 管线配置（可通过数据库覆盖） */
interface PipelineConfig {
  /** 禁用的处理器名称列表 */
  disabledProcessors?: string[];
}

/** 默认管线配置 */
const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  disabledProcessors: [],
};

/**
 * 构建 Pre-LLM 管线配置
 *
 * 返回有序的 ProcessorConfig 数组，供 runProcessors 编排执行：
 *   1. semantic-recall（并行组 'inject'）
 *   2. intent-classify
 *   3. user-profile（并行组 'inject'）
 *   4. [自定义处理器...]
 *   5. token-limit（始终最后执行）
 *
 * 支持通过数据库配置禁用特定处理器。
 */
export async function buildPreLLMPipeline(): Promise<ProcessorConfig[]> {
  const pipelineConfig = await getConfigValue<PipelineConfig>('processor.pipeline_config', DEFAULT_PIPELINE_CONFIG);
  const disabled = new Set(pipelineConfig.disabledProcessors ?? []);

  const builtIn: Array<ProcessorConfig & { name: string }> = [
    { name: 'semantic-recall-processor', processor: semanticRecallProcessor, parallelGroup: 'inject' },
    { name: 'intent-classify-processor', processor: intentClassifyProcessor },
    { name: 'user-profile-processor', processor: userProfileProcessor, parallelGroup: 'inject' },
    { name: 'token-limit-processor', processor: tokenLimitProcessor },
  ];

  // 过滤掉被禁用的处理器
  const enabled = builtIn.filter((p) => !disabled.has(p.name));

  // 自定义处理器插入到 tokenLimitProcessor 之前
  const custom = Array.from(processorRegistry.values());
  const lastIdx = enabled.length - 1;
  const last = enabled[lastIdx];

  if (last?.name === 'token-limit-processor') {
    return [...enabled.slice(0, lastIdx), ...custom, last];
  }

  return [...enabled, ...custom];
}

/**
 * 清空注册表
 *
 * 用于测试或运行时重置。
 */
export function clearRegistry(): void {
  processorRegistry.clear();
}

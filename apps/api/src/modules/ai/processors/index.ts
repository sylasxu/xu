/**
 * AI Processors 导出 (v4.8)
 * 
 * 所有 Processor 都是纯函数，不使用 class
 */

// 类型导出
export type {
  Message,
  ProcessorMetadata,
  ProcessorContext,
  ProcessorResult,
  ProcessorFn,
  ProcessorWithMeta,
  ProcessorConfig,
  ProcessorLogEntry,
} from './types';

// Processor 函数导出
export { inputGuardProcessor } from './input-guard';
export { keywordMatchProcessor } from './keyword-match';
export { intentClassifyProcessor } from './intent-classify';
export { userProfileProcessor } from './user-profile';
export { semanticRecallProcessor } from './semantic-recall';
export { tokenLimitProcessor } from './token-limit';
export { saveHistoryProcessor } from './save-history';
export { extractPreferencesProcessor } from './extract-preferences';
export { outputGuardProcessor } from './output-guard';
export { recordMetricsProcessor } from './record-metrics';
export { persistRequestProcessor } from './persist-request';
export { evaluateQualityProcessor } from './evaluate-quality';

// Pipeline 注册表和工厂函数
export { registerProcessor, buildPreLLMPipeline, clearRegistry } from './pipeline';


/**
 * 增强版 Processor 编排器 (v4.9)
 *
 * 支持：
 * - ProcessorConfig[] 输入（条件执行 + 并行组）
 * - ProcessorWithMeta[] 输入（向后兼容）
 * - 条件执行：condition 返回 false 时跳过，记录到 skipped
 * - 并行组：相同 parallelGroup 的连续处理器使用 Promise.all
 * - 并行组 context 合并策略：
 *   - systemPrompt：按声明顺序拼接注入段落
 *   - metadata：浅合并各处理器的命名空间
 *   - 其他字段（messages、userInput 等）：取最后一个处理器的值
 */
import type {
  ProcessorContext,
  ProcessorResult,
  ProcessorLogEntry,
  ProcessorWithMeta,
  ProcessorConfig,
} from './types';

/** 判断输入是 ProcessorConfig[] 还是 ProcessorWithMeta[]（向后兼容） */
function isProcessorConfigArray(
  input: ProcessorConfig[] | ProcessorWithMeta[]
): input is ProcessorConfig[] {
  if (input.length === 0) return true;
  return 'processor' in input[0];
}

/** 将 ProcessorWithMeta[] 转换为 ProcessorConfig[]（向后兼容） */
function toProcessorConfigs(
  input: ProcessorConfig[] | ProcessorWithMeta[]
): ProcessorConfig[] {
  if (isProcessorConfigArray(input)) return input;
  return (input as ProcessorWithMeta[]).map((processor) => ({ processor }));
}

/**
 * 将连续的 ProcessorConfig 按并行组分组
 *
 * 无 parallelGroup 的处理器各自独立为一组（串行执行），
 * 相同 parallelGroup 的连续处理器收集为一组（并行执行）。
 */
function groupByParallel(
  configs: ProcessorConfig[]
): ProcessorConfig[][] {
  const groups: ProcessorConfig[][] = [];
  let i = 0;

  while (i < configs.length) {
    const current = configs[i];

    if (!current.parallelGroup) {
      // 无并行组 → 独立串行
      groups.push([current]);
      i++;
    } else {
      // 收集连续相同 parallelGroup 的处理器
      const groupName = current.parallelGroup;
      const group: ProcessorConfig[] = [];
      while (i < configs.length && configs[i].parallelGroup === groupName) {
        group.push(configs[i]);
        i++;
      }
      groups.push(group);
    }
  }

  return groups;
}

/**
 * 合并并行组内多个处理器的执行结果到单一 context
 *
 * 合并策略（按设计文档）：
 * - systemPrompt：按 configs 声明顺序拼接各处理器注入的段落
 * - metadata：浅合并（各处理器写入不同 key，不会冲突）
 * - 其他字段（messages、userInput 等）：取最后一个处理器的值
 */
function mergeParallelContexts(
  baseContext: ProcessorContext,
  results: ProcessorResult[]
): ProcessorContext {
  if (results.length === 0) return baseContext;
  if (results.length === 1) return results[0].context;

  // 以最后一个处理器的 context 为基础（覆盖 messages、userInput 等）
  const lastContext = results[results.length - 1].context;

  // systemPrompt：收集各处理器相对于 baseContext 新增的段落，按声明顺序拼接
  const basePrompt = baseContext.systemPrompt;
  const injectedSections: string[] = [];
  for (const result of results) {
    const resultPrompt = result.context.systemPrompt;
    if (resultPrompt !== basePrompt && resultPrompt.startsWith(basePrompt)) {
      // 提取处理器注入的增量部分
      injectedSections.push(resultPrompt.slice(basePrompt.length));
    } else if (resultPrompt !== basePrompt) {
      // 处理器完全替换了 systemPrompt，保留完整内容作为增量
      injectedSections.push(resultPrompt);
    }
  }
  const mergedSystemPrompt =
    injectedSections.length > 0
      ? basePrompt + injectedSections.join('')
      : lastContext.systemPrompt;

  // metadata：浅合并所有处理器的 metadata
  const mergedMetadata = { ...baseContext.metadata };
  for (const result of results) {
    Object.assign(mergedMetadata, result.context.metadata);
  }

  return {
    ...lastContext,
    systemPrompt: mergedSystemPrompt,
    metadata: mergedMetadata,
  };
}

/**
 * 执行 Processor 链（增强版）
 *
 * 支持 ProcessorConfig[]（条件执行 + 并行组）和 ProcessorWithMeta[]（向后兼容）。
 *
 * 编排逻辑：
 * 1. 按顺序遍历 configs，遇到相同 parallelGroup 的连续处理器收集为一组
 * 2. 串行处理器直接执行；并行组使用 Promise.all 并行执行
 * 3. condition 返回 false 时跳过该处理器，记录到 skipped 数组
 * 4. 任一处理器 success: false 时停止后续执行（Pre-LLM 失败即停语义）
 */
export async function runProcessors(
  configs: ProcessorConfig[] | ProcessorWithMeta[],
  initialContext: ProcessorContext
): Promise<{
  context: ProcessorContext;
  logs: ProcessorLogEntry[];
  success: boolean;
  skipped: string[];
}> {
  const normalizedConfigs = toProcessorConfigs(configs);
  const groups = groupByParallel(normalizedConfigs);

  let context = initialContext;
  const logs: ProcessorLogEntry[] = [];
  const skipped: string[] = [];

  for (const group of groups) {
    if (group.length === 1) {
      // ── 串行执行单个处理器 ──
      const config = group[0];
      const name = config.processor.processorName;

      // 条件检查
      if (config.condition && !config.condition(context)) {
        skipped.push(name);
        continue;
      }

      const result = await config.processor(context);

      logs.push({
        processorName: name,
        executionTime: result.executionTime,
        success: result.success,
        data: result.data,
        error: result.error,
        timestamp: new Date().toISOString(),
      });

      if (!result.success) {
        return { context: result.context, logs, success: false, skipped };
      }

      context = result.context;
    } else {
      // ── 并行执行同组处理器 ──
      const toExecute: ProcessorConfig[] = [];

      // 先过滤掉 condition 不满足的
      for (const config of group) {
        const name = config.processor.processorName;
        if (config.condition && !config.condition(context)) {
          skipped.push(name);
        } else {
          toExecute.push(config);
        }
      }

      if (toExecute.length === 0) continue;

      // 快照当前 context 作为并行组的基准
      const baseContext = context;

      const results = await Promise.all(
        toExecute.map((config) => config.processor(baseContext))
      );

      // 记录日志 & 检查失败
      let hasFailed = false;
      let failedContext = context;

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const name = toExecute[i].processor.processorName;

        logs.push({
          processorName: name,
          executionTime: result.executionTime,
          success: result.success,
          data: result.data,
          error: result.error,
          timestamp: new Date().toISOString(),
        });

        if (!result.success && !hasFailed) {
          hasFailed = true;
          failedContext = result.context;
        }
      }

      if (hasFailed) {
        return { context: failedContext, logs, success: false, skipped };
      }

      // 合并并行组 context
      context = mergeParallelContexts(baseContext, results);
    }
  }

  return { context, logs, success: true, skipped };
}

/**
 * Post-LLM Processor 编排器
 *
 * 与 runProcessors（Pre-LLM）的区别：
 * - 处理器失败时记录日志但继续执行后续处理器，保证用户响应不受影响
 * - 不支持并行组（Post-LLM 阶段通常是串行的，如 save-history）
 * - 返回 success: true 即使有处理器失败（只要不是全部失败）
 *
 * 需求: 1.6, 1.8
 */
export async function runPostLLMProcessors(
  configs: ProcessorConfig[] | ProcessorWithMeta[],
  initialContext: ProcessorContext
): Promise<{
  context: ProcessorContext;
  logs: ProcessorLogEntry[];
  success: boolean;
  skipped: string[];
}> {
  const normalizedConfigs = toProcessorConfigs(configs);

  let context = initialContext;
  const logs: ProcessorLogEntry[] = [];
  const skipped: string[] = [];

  for (const config of normalizedConfigs) {
    const name = config.processor.processorName;

    // 条件检查
    if (config.condition && !config.condition(context)) {
      skipped.push(name);
      continue;
    }

    const result = await config.processor(context);

    logs.push({
      processorName: name,
      executionTime: result.executionTime,
      success: result.success,
      data: result.data,
      error: result.error,
      timestamp: new Date().toISOString(),
    });

    if (result.success) {
      context = result.context;
    } else {
      // Post-LLM: 失败时记录日志但继续执行，不更新 context
      console.error(`[Post-LLM] Processor "${name}" failed: ${result.error ?? 'unknown error'}`);
    }
  }

  return { context, logs, success: true, skipped };
}

/**
 * Async Processor 编排器（火并忘模式）
 *
 * 使用 Promise.allSettled 异步并行执行所有处理器，不阻塞用户响应。
 * 失败时静默记录日志，不影响主流程。
 *
 * 注意：此函数立即返回，不等待处理器执行完成。
 * 返回的 Promise 可用于测试或需要等待结果的场景。
 *
 * 需求: 1.6, 1.8
 */
export function runAsyncProcessors(
  configs: ProcessorConfig[] | ProcessorWithMeta[],
  context: ProcessorContext
): Promise<{
  logs: ProcessorLogEntry[];
  skipped: string[];
}> {
  const normalizedConfigs = toProcessorConfigs(configs);

  const skipped: string[] = [];
  const toExecute: ProcessorConfig[] = [];

  for (const config of normalizedConfigs) {
    const name = config.processor.processorName;
    if (config.condition && !config.condition(context)) {
      skipped.push(name);
    } else {
      toExecute.push(config);
    }
  }

  // 使用 Promise.allSettled 并行执行，不阻塞
  const execution = Promise.allSettled(
    toExecute.map((config) => config.processor(context))
  ).then((settledResults) => {
    const logs: ProcessorLogEntry[] = [];

    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      const name = toExecute[i].processor.processorName;

      if (settled.status === 'fulfilled') {
        const result = settled.value;
        logs.push({
          processorName: name,
          executionTime: result.executionTime,
          success: result.success,
          data: result.data,
          error: result.error,
          timestamp: new Date().toISOString(),
        });

        if (!result.success) {
          console.error(`[Async] Processor "${name}" failed: ${result.error ?? 'unknown error'}`);
        }
      } else {
        // Promise 本身被 reject（处理器抛出未捕获异常）
        console.error(`[Async] Processor "${name}" threw:`, settled.reason);
        logs.push({
          processorName: name,
          executionTime: 0,
          success: false,
          error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { logs, skipped };
  });

  return execution;
}


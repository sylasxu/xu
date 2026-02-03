/**
 * AI Processors 导出 (v4.8)
 * 
 * 所有 Processor 都是纯函数，不使用 class
 */

// 类型导出
export type {
  Message,
  ProcessorContext,
  ProcessorResult,
  ProcessorFn,
  ProcessorWithMeta,
  ProcessorLogEntry,
} from './types';

// Processor 函数导出
export { inputGuard } from './input-guard';
export { userProfile } from './user-profile';
export { semanticRecall } from './semantic-recall';
export { tokenLimit } from './token-limit';
export { saveHistory } from './save-history';
export { extractPreferences } from './extract-preferences';

/**
 * 执行 Processor 链
 * 
 * 按顺序执行多个 Processor，收集日志
 */
import type { ProcessorContext, ProcessorResult, ProcessorLogEntry, ProcessorWithMeta } from './types';

export async function runProcessors(
  processors: ProcessorWithMeta[],
  initialContext: ProcessorContext
): Promise<{
  context: ProcessorContext;
  logs: ProcessorLogEntry[];
  success: boolean;
}> {
  let context = initialContext;
  const logs: ProcessorLogEntry[] = [];
  
  for (const processor of processors) {
    const result = await processor(context);
    
    logs.push({
      processorName: processor.processorName,
      executionTime: result.executionTime,
      success: result.success,
      data: result.data,
      error: result.error,
      timestamp: new Date().toISOString(),
    });
    
    if (!result.success) {
      return { context: result.context, logs, success: false };
    }
    
    context = result.context;
  }
  
  return { context, logs, success: true };
}

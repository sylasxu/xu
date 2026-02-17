/**
 * Workflow Core - 工作流核心实现
 * 
 * 基于状态机的 HITL 工作流引擎
 */

import { randomUUID } from 'crypto';
import type {
  WorkflowState,
  WorkflowStatus,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowStepResult,
  WorkflowEvent,
} from './types';
import { getConfigValue } from '../config/config.service';

/**
 * 内存工作流存储（后续可替换为 Redis）
 */
const workflowStore = new Map<string, WorkflowState>();

/**
 * 创建工作流
 */
export async function createWorkflow<TData>(
  definition: WorkflowDefinition<TData>,
  userId: string
): Promise<WorkflowState<TData>> {
  // 超限淘汰
  const maxSize = await getConfigValue('workflow.max_store_size', 1000);
  if (workflowStore.size >= maxSize) {
    evictOldestEntries(maxSize);
  }

  const now = new Date();
  const state: WorkflowState<TData> = {
    id: randomUUID(),
    type: definition.type,
    status: 'pending',
    currentStep: 0,
    data: definition.initialData,
    userId,
    createdAt: now,
    updatedAt: now,
    expiresAt: definition.expiresIn 
      ? new Date(now.getTime() + definition.expiresIn)
      : undefined,
  };

  workflowStore.set(state.id, state as WorkflowState);
  return state;
}

/**
 * 获取工作流
 */
export function getWorkflow<TData = unknown>(
  workflowId: string
): WorkflowState<TData> | null {
  const state = workflowStore.get(workflowId);
  if (!state) return null;

  // 检查是否过期
  if (state.expiresAt && new Date() > state.expiresAt) {
    state.status = 'expired';
    state.updatedAt = new Date();
  }

  return state as WorkflowState<TData>;
}

/**
 * 获取用户的活跃工作流
 */
export function getUserActiveWorkflows(userId: string): WorkflowState[] {
  const workflows: WorkflowState[] = [];
  
  for (const state of workflowStore.values()) {
    if (state.userId === userId && state.status === 'pending') {
      // 检查是否过期
      if (state.expiresAt && new Date() > state.expiresAt) {
        state.status = 'expired';
        state.updatedAt = new Date();
        continue;
      }
      workflows.push(state);
    }
  }

  return workflows;
}

/**
 * 执行工作流步骤
 */
export async function executeStep<TData, TInput, TOutput>(
  workflowId: string,
  steps: WorkflowStep[],
  input?: TInput
): Promise<WorkflowStepResult<TOutput>> {
  const state = getWorkflow<TData>(workflowId);
  if (!state) {
    return { success: false, error: '工作流不存在' };
  }

  if (state.status !== 'pending') {
    return { success: false, error: `工作流状态无效: ${state.status}` };
  }

  const step = steps[state.currentStep];
  if (!step) {
    return { success: false, error: '步骤不存在' };
  }

  // 验证输入
  if (step.validate && input !== undefined && !step.validate(input)) {
    return { success: false, error: '输入验证失败' };
  }

  // 更新状态为处理中
  state.status = 'processing';
  state.updatedAt = new Date();

  try {
    // 执行步骤
    const result = await step.execute(input, state as WorkflowState);

    if (result.success) {
      // 更新数据
      if (result.output) {
        state.data = { ...state.data, ...result.output } as TData;
      }

      // 确定下一步
      const nextStep = result.nextStep ?? state.currentStep + 1;

      if (nextStep >= steps.length) {
        // 工作流完成
        state.status = 'completed';
      } else if (result.waitForInput) {
        // 等待用户输入
        state.status = 'pending';
        state.currentStep = nextStep;
      } else {
        // 继续执行下一步
        state.currentStep = nextStep;
        state.status = 'pending';
      }
    } else {
      // 步骤失败，恢复为 pending
      state.status = 'pending';
    }

    state.updatedAt = new Date();
    return result as WorkflowStepResult<TOutput>;
  } catch (error) {
    state.status = 'pending';
    state.updatedAt = new Date();
    return {
      success: false,
      error: error instanceof Error ? error.message : '执行失败',
    };
  }
}

/**
 * 取消工作流
 */
export function cancelWorkflow(workflowId: string): boolean {
  const state = workflowStore.get(workflowId);
  if (!state) return false;

  state.status = 'cancelled';
  state.updatedAt = new Date();
  return true;
}

/**
 * 完成工作流
 */
export function completeWorkflow(workflowId: string): boolean {
  const state = workflowStore.get(workflowId);
  if (!state) return false;

  state.status = 'completed';
  state.updatedAt = new Date();
  return true;
}

/**
 * 更新工作流数据
 */
export function updateWorkflowData<TData>(
  workflowId: string,
  data: Partial<TData>
): boolean {
  const state = getWorkflow<TData>(workflowId);
  if (!state) return false;

  state.data = { ...state.data, ...data };
  state.updatedAt = new Date();
  return true;
}

/**
 * 清理过期工作流
 */
export function cleanupExpiredWorkflows(): number {
  let count = 0;
  const now = new Date();

  for (const [id, state] of workflowStore.entries()) {
    if (state.expiresAt && now > state.expiresAt) {
      workflowStore.delete(id);
      count++;
    }
  }

  return count;
}

/**
 * 检查工作流是否可以继续
 */
export function canContinue(workflowId: string): boolean {
  const state = getWorkflow(workflowId);
  return state !== null && state.status === 'pending';
}

/**
 * 淘汰最早的条目，优先淘汰过期条目，再按 createdAt 淘汰
 */
function evictOldestEntries(maxSize: number): void {
  const now = new Date();

  // 先淘汰所有过期条目
  for (const [id, state] of workflowStore.entries()) {
    if (workflowStore.size < maxSize) return;
    if (state.expiresAt && now > state.expiresAt) {
      workflowStore.delete(id);
    }
  }

  // 仍然超限，按 createdAt 淘汰最早的
  if (workflowStore.size >= maxSize) {
    const sorted = [...workflowStore.entries()].sort(
      (a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime()
    );
    const toRemove = workflowStore.size - maxSize + 1; // 腾出至少 1 个位置
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      workflowStore.delete(sorted[i][0]);
    }
  }
}

/**
 * 定时清理任务（5 分钟间隔）
 * 模块初始化时自动启动
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
  const cleaned = cleanupExpiredWorkflows();
  if (cleaned > 0) {
    console.log(`[Workflow] 定时清理：已清理 ${cleaned} 个过期工作流，剩余 ${workflowStore.size} 个`);
  }
}, CLEANUP_INTERVAL_MS);


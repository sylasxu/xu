/**
 * Match Flow - 匹配确认工作流
 * 
 * 找搭子匹配成功后的确认流程
 */

import type { WorkflowDefinition, WorkflowStep, WorkflowState } from './types';
import { createWorkflow, executeStep, getWorkflow } from './workflow';

/**
 * 匹配数据
 */
export interface MatchFlowData {
  /** 匹配 ID */
  matchId: string;
  /** 活动类型 */
  activityType: string;
  /** 地点提示 */
  locationHint: string;
  /** 时间偏好 */
  timePreference: string;
  /** 匹配分数 */
  matchScore: number;
  /** 参与者数量 */
  participantCount: number;
  /** 临时召集人 ID */
  tempOrganizerId: string;
  /** 确认截止时间 */
  confirmDeadline: Date;
  /** 用户确认状态 */
  confirmed: boolean;
  /** 最终活动 ID（确认后生成） */
  activityId?: string;
}

/**
 * 匹配确认输入
 */
export interface MatchConfirmInput {
  action: 'confirm' | 'reject' | 'modify';
  modifications?: {
    locationHint?: string;
    timePreference?: string;
  };
}

/**
 * 匹配流程步骤
 */
const matchSteps: WorkflowStep[] = [
  {
    name: 'review',
    description: '用户审核匹配',
    requiresInput: true,
    execute: async (input: MatchConfirmInput, state: WorkflowState<MatchFlowData>) => {
      // 检查是否超过确认截止时间
      if (new Date() > state.data.confirmDeadline) {
        return {
          success: false,
          error: '确认时间已过期',
        };
      }

      if (input.action === 'reject') {
        return {
          success: true,
          output: { confirmed: false },
          nextStep: 2, // 跳到拒绝步骤
        };
      }

      if (input.action === 'modify' && input.modifications) {
        return {
          success: true,
          output: input.modifications,
          waitForInput: true, // 继续等待确认
        };
      }

      if (input.action === 'confirm') {
        return {
          success: true,
          nextStep: 1, // 进入确认步骤
        };
      }

      return { success: false, error: '无效操作' };
    },
  },
  {
    name: 'confirm',
    description: '确认匹配，创建活动',
    requiresInput: false,
    execute: async (_input: unknown, state: WorkflowState<MatchFlowData>) => {
      // 实际创建活动的逻辑由外部处理
      return {
        success: true,
        output: { confirmed: true },
      };
    },
  },
  {
    name: 'reject',
    description: '拒绝匹配',
    requiresInput: false,
    execute: async () => {
      return {
        success: true,
        output: { confirmed: false },
      };
    },
  },
];

/**
 * 匹配流程定义
 */
export const matchFlowDefinition: WorkflowDefinition<MatchFlowData> = {
  type: 'match',
  steps: matchSteps,
  initialData: {
    matchId: '',
    activityType: '',
    locationHint: '',
    timePreference: '',
    matchScore: 0,
    participantCount: 0,
    tempOrganizerId: '',
    confirmDeadline: new Date(),
    confirmed: false,
  },
  expiresIn: 60 * 60 * 1000, // 1 小时过期
};

/**
 * 创建匹配确认流程
 */
export async function createMatchFlow(
  userId: string,
  matchData: Omit<MatchFlowData, 'confirmed' | 'activityId'>
) {
  const definition: WorkflowDefinition<MatchFlowData> = {
    ...matchFlowDefinition,
    initialData: {
      ...matchData,
      confirmed: false,
    },
  };

  return createWorkflow(definition, userId);
}

/**
 * 处理匹配确认输入
 */
export async function handleMatchInput(
  workflowId: string,
  input: MatchConfirmInput
) {
  return executeStep<MatchFlowData, MatchConfirmInput, Partial<MatchFlowData>>(
    workflowId,
    matchSteps,
    input
  );
}

/**
 * 获取匹配流程状态
 */
export function getMatchFlow(workflowId: string) {
  return getWorkflow<MatchFlowData>(workflowId);
}

/**
 * 检查匹配是否已确认
 */
export function isMatchConfirmed(workflowId: string): boolean {
  const state = getWorkflow<MatchFlowData>(workflowId);
  return state?.data.confirmed ?? false;
}

/**
 * 检查匹配是否已过期
 */
export function isMatchExpired(workflowId: string): boolean {
  const state = getWorkflow<MatchFlowData>(workflowId);
  if (!state) return true;
  return new Date() > state.data.confirmDeadline;
}

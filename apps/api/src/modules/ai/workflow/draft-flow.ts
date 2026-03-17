/**
 * Draft Flow - 草稿确认工作流
 * 
 * 用户创建活动草稿后的确认流程
 */

import type { WorkflowDefinition, WorkflowStep, WorkflowState } from './types';
import { createWorkflow, executeStep, getWorkflow, completeWorkflow } from './workflow';

/**
 * 草稿数据
 */
export interface DraftFlowData {
  activityId: string;
  title: string;
  type: string;
  locationName: string;
  locationHint: string;
  startAt: string;
  maxParticipants: number;
  /** 用户修改记录 */
  modifications: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    timestamp: Date;
  }>;
  /** 是否已发布 */
  published: boolean;
}

/**
 * 草稿修改输入
 */
export interface DraftModifyInput {
  field: string;
  value: unknown;
}

/**
 * 草稿确认输入
 */
export interface DraftConfirmInput {
  action: 'publish' | 'cancel' | 'modify';
  modifications?: DraftModifyInput[];
}

function readDraftFieldValue(data: DraftFlowData, field: string): unknown {
  switch (field) {
    case 'activityId':
      return data.activityId;
    case 'title':
      return data.title;
    case 'type':
      return data.type;
    case 'locationName':
      return data.locationName;
    case 'locationHint':
      return data.locationHint;
    case 'startAt':
      return data.startAt;
    case 'maxParticipants':
      return data.maxParticipants;
    case 'modifications':
      return data.modifications;
    case 'published':
      return data.published;
    default:
      return undefined;
  }
}

/**
 * 草稿流程步骤
 */
const draftSteps: WorkflowStep[] = [
  {
    name: 'review',
    description: '用户审核草稿',
    requiresInput: true,
    execute: async (input: DraftConfirmInput, state: WorkflowState<DraftFlowData>) => {
      if (input.action === 'cancel') {
        return {
          success: true,
          output: { published: false },
          nextStep: 2, // 跳到取消步骤
        };
      }

      if (input.action === 'modify' && input.modifications) {
        // 记录修改
        const modifications = [...state.data.modifications];
        for (const mod of input.modifications) {
          modifications.push({
            field: mod.field,
            oldValue: readDraftFieldValue(state.data, mod.field),
            newValue: mod.value,
            timestamp: new Date(),
          });
        }

        return {
          success: true,
          output: {
            ...Object.fromEntries(input.modifications.map(m => [m.field, m.value])),
            modifications,
          },
          waitForInput: true, // 继续等待确认
        };
      }

      if (input.action === 'publish') {
        return {
          success: true,
          nextStep: 1, // 进入发布步骤
        };
      }

      return { success: false, error: '无效操作' };
    },
  },
  {
    name: 'publish',
    description: '发布活动',
    requiresInput: false,
    execute: async (_input: unknown, state: WorkflowState<DraftFlowData>) => {
      // 这里实际发布逻辑由外部处理
      return {
        success: true,
        output: { published: true },
      };
    },
  },
  {
    name: 'cancel',
    description: '取消草稿',
    requiresInput: false,
    execute: async () => {
      return {
        success: true,
        output: { published: false },
      };
    },
  },
];

/**
 * 草稿流程定义
 */
export const draftFlowDefinition: WorkflowDefinition<DraftFlowData> = {
  type: 'draft',
  steps: draftSteps,
  initialData: {
    activityId: '',
    title: '',
    type: '',
    locationName: '',
    locationHint: '',
    startAt: '',
    maxParticipants: 4,
    modifications: [],
    published: false,
  },
  expiresIn: 30 * 60 * 1000, // 30 分钟过期
};

/**
 * 创建草稿确认流程
 */
export async function createDraftFlow(
  userId: string,
  draft: Omit<DraftFlowData, 'modifications' | 'published'>
) {
  const definition: WorkflowDefinition<DraftFlowData> = {
    ...draftFlowDefinition,
    initialData: {
      ...draft,
      modifications: [],
      published: false,
    },
  };

  return createWorkflow(definition, userId);
}

/**
 * 处理草稿确认输入
 */
export async function handleDraftInput(
  workflowId: string,
  input: DraftConfirmInput
) {
  return executeStep<DraftFlowData, DraftConfirmInput, Partial<DraftFlowData>>(
    workflowId,
    draftSteps,
    input
  );
}

/**
 * 获取草稿流程状态
 */
export function getDraftFlow(workflowId: string) {
  return getWorkflow<DraftFlowData>(workflowId);
}

/**
 * 检查草稿是否已发布
 */
export function isDraftPublished(workflowId: string): boolean {
  const state = getWorkflow<DraftFlowData>(workflowId);
  return state?.data.published ?? false;
}

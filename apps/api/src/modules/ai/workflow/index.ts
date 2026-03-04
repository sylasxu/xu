/**
 * Workflow Module - 工作流模块
 * 
 * HITL (Human-in-the-Loop) 工作流系统
 * 包含：partner-matching, draft-flow, match-flow, workflow
 */

// Types
export type {
  WorkflowStatus,
  WorkflowType,
  WorkflowState,
  WorkflowStep,
  WorkflowStepResult,
  WorkflowDefinition,
  WorkflowEvent,
} from './types';

// Core Workflow
export {
  createWorkflow,
  getWorkflow,
  getUserActiveWorkflows,
  executeStep,
  cancelWorkflow,
  completeWorkflow,
  updateWorkflowData,
  cleanupExpiredWorkflows,
  canContinue,
} from './workflow';

// Draft Flow
export type { DraftFlowData, DraftModifyInput, DraftConfirmInput } from './draft-flow';
export {
  draftFlowDefinition,
  createDraftFlow,
  handleDraftInput,
  getDraftFlow,
  isDraftPublished,
} from './draft-flow';

// Match Flow
export type { MatchFlowData, MatchConfirmInput } from './match-flow';
export {
  matchFlowDefinition,
  createMatchFlow,
  handleMatchInput,
  getMatchFlow,
  isMatchConfirmed,
  isMatchExpired,
} from './match-flow';

// Partner Matching - 找搭子追问流程
export type {
  PartnerMatchingState,
  PartnerMatchingQuestion,
} from './partner-matching';
export {
  shouldStartPartnerMatching,
  createPartnerMatchingState,
  updatePartnerMatchingState,
  pausePartnerMatchingState,
  completePartnerMatchingState,
  getNextQuestion,
  buildAskPrompt,
  parseUserAnswer,
  isTopicSwitch,
  persistPartnerMatchingState,
  recoverPartnerMatchingState,
  clearPartnerMatchingState,
} from './partner-matching';

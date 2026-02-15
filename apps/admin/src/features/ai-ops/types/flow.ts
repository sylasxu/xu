/**
 * Flow Graph Types
 * 
 * AI Playground 流程图可视化的类型定义
 */

import type { Node, Edge } from '@xyflow/react';

/** 节点类型 */
export type FlowNodeType =
  | 'input'              // 用户输入
  | 'input-guard'        // Input Guard Processor
  | 'keyword-match'      // P0 关键词匹配
  | 'intent-classify'    // P1 意图识别
  | 'processor'          // 通用 Processor（User Profile, Working Memory, etc.）
  | 'llm'                // LLM 推理
  | 'tool'               // Tool 调用（包含 Evaluation）
  | 'output';            // 最终输出

/** 节点状态 */
export type FlowNodeStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

/** 节点数据基础接口 */
export interface BaseFlowNodeData {
  type: FlowNodeType;
  status: FlowNodeStatus;
  label: string;
  duration?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  downstreamNodes?: string[]; // 关联的下游节点 ID 列表（用于快速跳转）
  metadata?: {
    // 执行详情元数据
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    cacheHit?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown; // 添加索引签名以兼容 ReactFlow
}

/** Input 节点数据 */
export interface InputNodeData extends BaseFlowNodeData {
  type: 'input';
  text: string;
  charCount: number;
  userId?: string;
  source?: 'miniprogram' | 'admin';
  location?: { lat: number; lng: number; name?: string };
}

/** P0 Match 节点数据 */
export interface P0MatchNodeData extends BaseFlowNodeData {
  type: 'keyword-match';
  matched: boolean;
  keyword?: string;
  matchType?: 'exact' | 'prefix' | 'fuzzy';
  priority?: number;
  responseType?: string;
  responseContent?: Record<string, unknown>;
  hitCount?: number;
  conversionCount?: number;
  conversionRate?: number;
  cacheHit?: boolean;
}

/** P1 Intent 节点数据 */
export interface P1IntentNodeData extends BaseFlowNodeData {
  type: 'intent-classify';
  intent: string;
  method: 'regex' | 'llm';
  confidence?: number;
  regexRules?: Array<{ pattern: string; intent: string }>;
  llmDetails?: {
    model: string;
    prompt: string;
    inputTokens: number;
    outputTokens: number;
    duration: number;
  };
}

/** Processor 类型 */
export type ProcessorType =
  | 'input-guard'
  | 'user-profile'
  | 'working-memory'
  | 'semantic-recall'
  | 'token-limit'
  | 'save-history'
  | 'extract-preferences';

/** Processor 节点数据 */
export interface ProcessorNodeData extends BaseFlowNodeData {
  type: 'processor';
  processorType: ProcessorType;
  fieldCount?: number;
  summary?: string;
  resultCount?: number;
  currentTokens?: number;
  maxTokens?: number;
}

/** LLM 节点数据 */
export interface LLMNodeData extends BaseFlowNodeData {
  type: 'llm';
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  inputMessages?: Array<{ role: string; content: string }>;
  output?: { text: string; toolCalls: Array<{ name: string; arguments: unknown }> };
  timeToFirstToken?: number;
  tokensPerSecond?: number;
  cost?: number;
}

/** Tool 节点数据（包含 Evaluation） */
export interface ToolNodeData extends BaseFlowNodeData {
  type: 'tool';
  toolName: string;
  toolDisplayName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  widgetType?: string;
  evaluation?: {
    passed: boolean;
    score: number;
    toneScore?: number;
    relevanceScore?: number;
    contextScore?: number;
    issues: string[];
    suggestions?: string[];
    thinking?: string;
  };
}

/** Output 节点数据 */
export interface OutputNodeData extends BaseFlowNodeData {
  type: 'output';
  responseType: string;
  itemCount?: number;
  totalDuration: number;
  totalTokens?: number;
  totalCost?: number;
  toolCallCount?: number;
  evaluationPassed?: boolean;
}

/** 流程图节点数据联合类型 */
export type FlowNodeData =
  | InputNodeData
  | P0MatchNodeData
  | P1IntentNodeData
  | ProcessorNodeData
  | LLMNodeData
  | ToolNodeData
  | OutputNodeData;

/** 流程图节点 */
export type FlowNode = Node<FlowNodeData>;

/** 流程图边 */
export type FlowEdge = Edge & {
  animated?: boolean;
  style?: React.CSSProperties;
};

/** 流程图数据 */
export interface FlowGraphData {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** Processor 显示名称映射 */
export const PROCESSOR_DISPLAY_NAMES: Record<ProcessorType, string> = {
  'input-guard': 'Input Guard',
  'user-profile': 'User Profile',
  'working-memory': 'Working Memory',
  'semantic-recall': 'Semantic Recall',
  'token-limit': 'Token Limit',
  'save-history': 'Save History',
  'extract-preferences': 'Extract Preferences',
};

/** 获取 Processor 显示名称 */
export function getProcessorDisplayName(type: ProcessorType): string {
  return PROCESSOR_DISPLAY_NAMES[type] || type;
}

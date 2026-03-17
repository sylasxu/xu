/**
 * Flow Graph Builder (v2 - 静态管线 + Trace 驱动)
 *
 * 核心变化：从"根据 trace 动态构建节点"改为"预渲染所有节点 + trace 驱动状态更新"
 *
 * - buildStaticPipeline(): 生成 7 层静态管线（所有节点 pending）
 * - applyTraceToGraph(): 根据 ExecutionTrace 更新节点状态和数据
 */

import type { ExecutionTrace, TraceStep } from '../../../types/trace'
import type {
  FlowGraphData,
  FlowNode,
  FlowEdge,
  FlowNodeStatus,
  FlowNodeData,
  ProcessorType,
  ToolNodeData,
} from '../../../types/flow'

// ============ 常量 ============

const NODE_WIDTH = 200
const NODE_HEIGHT = 64
const LAYER_GAP = 80    // 层间距 ≥48px
const NODE_GAP = 32     // 节点间距 ≥24px

/** 管线层配置 */
interface LayerNodeConfig {
  nodeId: string
  type: FlowNodeData['type']
  label: string
  traceType: string
  processorType?: ProcessorType
}

interface LayerConfig {
  id: string
  nodes: LayerNodeConfig[]
}

export const PIPELINE_LAYERS: LayerConfig[] = [
  {
    id: 'L1',
    nodes: [
      { nodeId: 'input', type: 'user-input', label: '用户输入', traceType: 'input' },
    ],
  },
  {
    id: 'L2',
    nodes: [
      { nodeId: 'input-guard', type: 'processor', label: '输入安全检查', traceType: 'processor', processorType: 'input-guard' },
      { nodeId: 'keyword-match', type: 'keyword-match', label: '关键词快捷匹配', traceType: 'keyword-match' },
    ],
  },
  {
    id: 'L3',
    nodes: [
      { nodeId: 'intent-classify', type: 'intent-classify', label: '意图识别', traceType: 'intent-classify' },
    ],
  },
  {
    id: 'L4',
    nodes: [
      { nodeId: 'user-profile', type: 'processor', label: '用户画像', traceType: 'processor', processorType: 'user-profile' },
      { nodeId: 'semantic-recall', type: 'processor', label: '语义记忆召回', traceType: 'processor', processorType: 'semantic-recall' },
      { nodeId: 'token-limit', type: 'processor', label: '上下文窗口', traceType: 'processor', processorType: 'token-limit' },
    ],
  },
  {
    id: 'L5',
    nodes: [
      { nodeId: 'llm', type: 'llm', label: '模型推理', traceType: 'llm' },
    ],
  },
  {
    id: 'L6',
    nodes: [
      { nodeId: 'tool-placeholder', type: 'tool', label: '工具调用', traceType: 'tool' },
    ],
  },
  {
    id: 'L7',
    nodes: [
      { nodeId: 'output', type: 'final-output', label: '最终响应', traceType: 'output' },
    ],
  },
]


// P0 命中时需要跳过的节点 ID
const P0_SKIPPABLE_NODE_IDS = [
  'intent-classify',
  'user-profile',
  'semantic-recall',
  'token-limit',
  'llm',
  'tool-placeholder',
]

// 结构化动作直达时，需要显式标记为非模型路径的节点
const STRUCTURED_ACTION_SKIPPED_NODE_IDS = [
  'keyword-match',
  'user-profile',
  'semantic-recall',
  'token-limit',
  'llm',
  'tool-placeholder',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStepData(step: TraceStep): Record<string, unknown> {
  return isRecord(step.data) ? step.data : {}
}

function readOptionalString(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === 'string' ? data[key] : undefined
}

function readOptionalNumber(data: Record<string, unknown>, key: string): number | undefined {
  return typeof data[key] === 'number' && Number.isFinite(data[key]) ? data[key] : undefined
}

function readOptionalRecord(data: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return isRecord(data[key]) ? data[key] : undefined
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readWidgetType(data: Record<string, unknown>): ToolNodeData['widgetType'] | undefined {
  const value = readOptionalString(data, 'widgetType')
  switch (value) {
    case 'widget_draft':
    case 'widget_explore':
    case 'widget_share':
    case 'widget_detail':
    case 'widget_ask_preference':
      return value
    default:
      return undefined
  }
}

function readEvaluation(data: Record<string, unknown>): ToolNodeData['evaluation'] | undefined {
  const evaluation = readOptionalRecord(data, 'evaluation')
  if (!evaluation) {
    return undefined
  }

  const passed = evaluation.passed
  const score = evaluation.score
  if (typeof passed !== 'boolean' || typeof score !== 'number') {
    return undefined
  }

  const issues = readStringList(evaluation.issues)
  const result: NonNullable<ToolNodeData['evaluation']> = {
    passed,
    score,
    issues,
  }

  if (typeof evaluation.toneScore === 'number') {
    result.toneScore = evaluation.toneScore
  }
  if (typeof evaluation.relevanceScore === 'number') {
    result.relevanceScore = evaluation.relevanceScore
  }
  if (typeof evaluation.contextScore === 'number') {
    result.contextScore = evaluation.contextScore
  }
  if (Array.isArray(evaluation.suggestions)) {
    result.suggestions = readStringList(evaluation.suggestions)
  }
  if (typeof evaluation.thinking === 'string') {
    result.thinking = evaluation.thinking
  }

  return result
}

function createFlowNode(params: {
  id: string
  type: string
  position: { x: number; y: number }
  data: FlowNodeData
}): FlowNode {
  return {
    id: params.id,
    type: params.type,
    position: params.position,
    draggable: false,
    data: params.data,
  }
}

function createPendingNodeData(cfg: LayerNodeConfig): FlowNodeData {
  switch (cfg.type) {
    case 'user-input':
      return {
        type: 'user-input',
        status: 'pending',
        label: cfg.label,
        text: '',
        charCount: 0,
      }
    case 'keyword-match':
      return {
        type: 'keyword-match',
        status: 'pending',
        label: cfg.label,
        matched: false,
      }
    case 'intent-classify':
      return {
        type: 'intent-classify',
        status: 'pending',
        label: cfg.label,
        intent: 'unknown',
        method: 'regex',
      }
    case 'processor':
      return {
        type: 'processor',
        status: 'pending',
        label: cfg.label,
        processorType: cfg.processorType ?? 'user-profile',
      }
    case 'llm':
      return {
        type: 'llm',
        status: 'pending',
        label: cfg.label,
        model: '',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }
    case 'tool':
      return {
        type: 'tool',
        status: 'pending',
        label: cfg.label,
        toolName: '',
        toolDisplayName: cfg.label,
        input: {},
      }
    case 'final-output':
      return {
        type: 'final-output',
        status: 'pending',
        label: cfg.label,
        responseType: 'text',
        totalDuration: 0,
      }
  }
}

// ============ buildStaticPipeline ============

/**
 * 生成静态管线：所有节点 pending 状态，连线虚线灰色
 */
export function buildStaticPipeline(): FlowGraphData {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  // 计算画布总宽度（取最宽层的宽度）
  const maxNodesInLayer = Math.max(...PIPELINE_LAYERS.map(l => l.nodes.length))
  const canvasWidth = maxNodesInLayer * NODE_WIDTH + (maxNodesInLayer - 1) * NODE_GAP

  PIPELINE_LAYERS.forEach((layer, layerIndex) => {
    const y = layerIndex * (NODE_HEIGHT + LAYER_GAP)
    const layerWidth = layer.nodes.length * NODE_WIDTH + (layer.nodes.length - 1) * NODE_GAP
    const offsetX = (canvasWidth - layerWidth) / 2

    layer.nodes.forEach((cfg, nodeIndex) => {
      const x = offsetX + nodeIndex * (NODE_WIDTH + NODE_GAP)

      nodes.push(createFlowNode({
        id: cfg.nodeId,
        type: cfg.type,
        position: { x, y },
        data: createPendingNodeData(cfg),
      }))
    })
  })

  // 生成连线：每层连接到下一层
  for (let i = 0; i < PIPELINE_LAYERS.length - 1; i++) {
    const currentLayer = PIPELINE_LAYERS[i]
    const nextLayer = PIPELINE_LAYERS[i + 1]

    for (const src of currentLayer.nodes) {
      for (const tgt of nextLayer.nodes) {
        edges.push(createPendingEdge(src.nodeId, tgt.nodeId))
      }
    }
  }

  return { nodes, edges }
}


// ============ applyTraceToGraph ============

/**
 * 根据 ExecutionTrace 更新节点状态和数据
 *
 * 1. 遍历 trace.steps，通过 type + processorType 匹配节点
 * 2. P0 命中时将 P1~LLM 标记为 skipped
 * 3. Tool 节点动态处理（多个 tool step → 多个 tool 节点）
 * 4. 更新连线样式
 * 5. 更新节点 subtitle
 */
export function applyTraceToGraph(
  graph: FlowGraphData,
  trace: ExecutionTrace,
): FlowGraphData {
  // 深拷贝避免 mutation
  const nodes: FlowNode[] = graph.nodes.map(n => ({
    ...n,
    data: { ...n.data },
  }))
  let edges: FlowEdge[] = graph.edges.map(e => ({ ...e }))

  let p0Matched = false
  const usesStructuredActionPath = trace.intentMethod === 'structured_action'
    || trace.steps.some(step => step.type === 'structured-action')

  // 1. 遍历 trace steps，匹配并更新节点
  // 后端 trace step type → 前端 flow node type 映射
  const traceToFlowType: Record<string, string> = {
    'input': 'user-input',
    'output': 'final-output',
    'structured-action': 'intent-classify',
  }

  for (const step of trace.steps) {
    const stepType = step.type
    const flowType = traceToFlowType[stepType] ?? stepType
    const stepData = readStepData(step)
    const processorType = readOptionalString(stepData, 'processorType')
    const structuredAction = readOptionalString(stepData, 'action')
    const phase = readOptionalString(stepData, 'phase')

    // 查找匹配的节点
    const matchedNode = nodes.find(n => {
      if (stepType === 'processor' && processorType) {
        return n.data.type === 'processor' && n.data.processorType === processorType
      }
      if (stepType === 'structured-action') {
        return n.id === 'intent-classify'
      }
      if (stepType === 'tool') {
        // tool 节点特殊处理（见下方）
        return false
      }
      return n.data.type === flowType
    })

    if (matchedNode) {
      // step.data 就是 TraceStepData（如 { intent, method, confidence } 或 { model, inputTokens, ... }）
      // 需要把这些字段展开到节点 data 上，detail 组件才能读到
      matchedNode.data = {
        ...matchedNode.data,
        ...stepData,
        ...(stepType === 'structured-action'
          ? {
              label: '结构化动作',
              intent: trace.intent ?? 'unknown',
              method: 'structured_action',
              ...(structuredAction ? { action: structuredAction } : {}),
              ...(phase ? { phase } : {}),
            }
          : {}),
        status: mapStepStatus(step.status),
        subtitle: extractSubtitle(step),
        stepData: step.data,
        duration: step.duration,
        error: step.error,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      }
    }

    // P0 命中检测
    if (stepType === 'keyword-match' && stepData.matched === true) {
      p0Matched = true
    }
  }

  // 2. P0 命中 → 跳过后续节点
  if (p0Matched) {
    for (const node of nodes) {
      if (P0_SKIPPABLE_NODE_IDS.includes(node.id)) {
        node.data = { ...node.data, status: 'skipped' }
      }
    }
  }

  if (usesStructuredActionPath) {
    for (const node of nodes) {
      if (STRUCTURED_ACTION_SKIPPED_NODE_IDS.includes(node.id)) {
        node.data = { ...node.data, status: 'skipped' }
      }
    }
  }

  // 3. Tool 节点动态处理
  const toolSteps = trace.steps.filter(s => s.type === 'tool')
  if (toolSteps.length > 0) {
    // 移除占位 tool 节点
    const toolPlaceholderIndex = nodes.findIndex(n => n.id === 'tool-placeholder')
    if (toolPlaceholderIndex !== -1) {
      nodes.splice(toolPlaceholderIndex, 1)
    }
    // 移除与占位节点相关的边
    edges = edges.filter(e => e.source !== 'tool-placeholder' && e.target !== 'tool-placeholder')

    // 计算 tool 节点位置（与占位节点同层）
    const layerIndex = PIPELINE_LAYERS.findIndex(l => l.id === 'L6')
    const y = layerIndex * (NODE_HEIGHT + LAYER_GAP)
    const maxNodesInLayer = Math.max(...PIPELINE_LAYERS.map(l => l.nodes.length))
    const canvasWidth = maxNodesInLayer * NODE_WIDTH + (maxNodesInLayer - 1) * NODE_GAP
    const toolLayerWidth = toolSteps.length * NODE_WIDTH + (toolSteps.length - 1) * NODE_GAP
    const offsetX = (canvasWidth - toolLayerWidth) / 2

    toolSteps.forEach((step, i) => {
      const toolData = readStepData(step)
      const toolId = `tool-${i}`
      const toolName = readOptionalString(toolData, 'toolName') || `tool-${i + 1}`
      const toolDisplayName = readOptionalString(toolData, 'toolDisplayName') || toolName
      const input = readOptionalRecord(toolData, 'input') || {}
      const output = readOptionalRecord(toolData, 'output')
      const widgetType = readWidgetType(toolData)
      const evaluation = readEvaluation(toolData)
      const nodeData: ToolNodeData = {
        type: 'tool',
        status: mapStepStatus(step.status),
        label: toolDisplayName,
        subtitle: extractSubtitle(step),
        stepData: step.data,
        duration: step.duration,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        toolName,
        toolDisplayName,
        input,
      }

      if (output) {
        nodeData.output = output
      }
      if (widgetType) {
        nodeData.widgetType = widgetType
      }
      if (evaluation) {
        nodeData.evaluation = evaluation
      }

      nodes.push(createFlowNode({
        id: toolId,
        type: 'tool',
        position: { x: offsetX + i * (NODE_WIDTH + NODE_GAP), y },
        data: nodeData,
      }))

      // 结构化动作路径下，工具节点应挂在结构化动作节点之后，而不是 LLM 之后
      edges.push(createStyledEdge(
        usesStructuredActionPath ? 'intent-classify' : 'llm',
        toolId,
        mapStepStatus(step.status)
      ))
      // Tool → Output 边
      edges.push(createStyledEdge(toolId, 'output', mapStepStatus(step.status)))
    })
  } else if (usesStructuredActionPath) {
    const toolPlaceholderIndex = nodes.findIndex(n => n.id === 'tool-placeholder')
    if (toolPlaceholderIndex !== -1) {
      nodes.splice(toolPlaceholderIndex, 1)
    }
    edges = edges.filter(e => e.source !== 'tool-placeholder' && e.target !== 'tool-placeholder')
    edges.push(createStyledEdge('intent-classify', 'output', 'success'))
  }

  // 4. 更新所有边的样式（根据源节点状态）
  edges = edges.map(edge => {
    const sourceNode = nodes.find(n => n.id === edge.source)
    if (!sourceNode) return edge
    const status = sourceNode.data.status
    return { ...edge, ...getEdgeStyle(status) }
  })

  return { nodes, edges }
}


// ============ Flow graph operations ============

function mapStepStatus(status: string): FlowNodeStatus {
  switch (status) {
    case 'pending': return 'pending'
    case 'running': return 'running'
    case 'success': return 'success'
    case 'error': return 'error'
    default: return 'pending'
  }
}

/** 从 step data 提取关键指标作为 subtitle */
function extractSubtitle(step: TraceStep): string | undefined {
  const data = readStepData(step)
  const type = step.type

  if (step.duration !== undefined && step.duration > 0) {
    const durationStr = step.duration < 1000
      ? `${step.duration}ms`
      : `${(step.duration / 1000).toFixed(1)}s`

    if (type === 'llm') {
      const tokens = readOptionalNumber(data, 'totalTokens')
      return tokens ? `${tokens} tokens · ${durationStr}` : durationStr
    }
    if (type === 'structured-action') {
      const action = readOptionalString(data, 'action')
      return action ? `${action} · ${durationStr}` : durationStr
    }
    return durationStr
  }

  if (type === 'input') {
    const text = readOptionalString(data, 'text')
    return text ? `${text.length} 字符` : undefined
  }

  if (type === 'structured-action') {
    return readOptionalString(data, 'action')
  }

  return undefined
}

/** 创建 pending 状态的边（虚线灰色） */
function createPendingEdge(source: string, target: string): FlowEdge {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: false,
    style: {
      stroke: 'var(--muted-foreground)',
      strokeWidth: 1.5,
      strokeDasharray: '6 4',
      opacity: 0.3,
    },
  }
}

/** 创建带状态样式的边 */
function createStyledEdge(source: string, target: string, status: FlowNodeStatus): FlowEdge {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    ...getEdgeStyle(status),
  }
}

/** 根据源节点状态获取边样式 */
function getEdgeStyle(status: FlowNodeStatus): Pick<FlowEdge, 'animated' | 'style'> {
  switch (status) {
    case 'pending':
      return {
        animated: false,
        style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5, strokeDasharray: '6 4', opacity: 0.3 },
      }
    case 'running':
      return {
        animated: true,
        style: { stroke: 'var(--primary)', strokeWidth: 2 },
      }
    case 'success':
      return {
        animated: false,
        style: { stroke: 'var(--foreground)', strokeWidth: 2, opacity: 0.4 },
      }
    case 'error':
      return {
        animated: false,
        style: { stroke: 'var(--destructive)', strokeWidth: 2 },
      }
    case 'skipped':
      return {
        animated: false,
        style: { stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.15 },
      }
    default:
      return {
        animated: false,
        style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5, strokeDasharray: '6 4', opacity: 0.3 },
      }
  }
}

/**
 * Execution Trace Types
 * 
 * 定义 AI 请求执行追踪的数据结构，用于前后端数据契约。
 * 参考 Requirements R8, R13
 */

/** 执行追踪状态 */
export type TraceStatus = 'running' | 'completed' | 'error'

/** 步骤状态 */
export type StepStatus = 'pending' | 'running' | 'success' | 'error'

/** 步骤类型 */
export type StepType = 'input' | 'prompt' | 'llm' | 'tool' | 'output'

/** 扩展步骤类型（包含 Processor 和 P0/P1） */
export type ExtendedStepType = StepType | 'processor' | 'keyword-match' | 'intent-classify'

/** 执行追踪 */
export interface ExecutionTrace {
  /** 请求唯一标识 */
  requestId: string
  /** 开始时间 (ISO timestamp) */
  startedAt: string
  /** 完成时间 (ISO timestamp) */
  completedAt?: string
  /** 追踪状态 */
  status: TraceStatus
  /** 执行步骤列表 */
  steps: TraceStep[]
  /** 总成本 (USD) */
  totalCost?: number
  /** System Prompt */
  systemPrompt?: string
  /** 可用工具列表 */
  tools?: ToolDefinition[]
  /** 意图分类 */
  intent?: IntentType
  /** 意图分类方法 */
  intentMethod?: 'regex' | 'llm'
  /** AI 输出摘要 */
  output?: TraceOutput
}

/** AI 输出摘要 */
export interface TraceOutput {
  /** 文字响应 */
  text: string | null
  /** Tool 调用列表 */
  toolCalls: Array<{
    name: string
    displayName: string
    input: unknown
    output: unknown
  }>
}

/** 意图类型 */
export type IntentType = 'create' | 'explore' | 'manage' | 'partner' | 'idle' | 'chitchat' | 'unknown'

/** 意图分类方法显示名称 */
export const INTENT_METHOD_NAMES: Record<'regex' | 'llm', string> = {
  regex: '正则',
  llm: 'LLM',
}

/** 意图显示名称 */
export const INTENT_DISPLAY_NAMES: Record<IntentType, string> = {
  create: '创建',
  explore: '探索',
  manage: '管理',
  partner: '找搭子',
  idle: '空闲',
  chitchat: '闲聊',
  unknown: '未知',
}

/** 工具定义 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string
  /** 工具描述 */
  description: string
  /** 参数 Schema */
  schema: Record<string, unknown>
}

/** 执行步骤 */
export interface TraceStep {
  /** 步骤唯一标识 */
  id: string
  /** 步骤类型（包含扩展类型：processor, keyword-match, intent-classify） */
  type: ExtendedStepType
  /** 步骤名称 (显示用) */
  name: string
  /** 开始时间 (ISO timestamp) */
  startedAt: string
  /** 完成时间 (ISO timestamp) */
  completedAt?: string
  /** 步骤状态 */
  status: StepStatus
  /** 耗时 (毫秒) */
  duration?: number
  /** 步骤数据 */
  data: TraceStepData
  /** 错误信息 */
  error?: string
}

/** 步骤数据联合类型 */
export type TraceStepData =
  | InputStepData
  | PromptStepData
  | LLMStepData
  | ToolStepData
  | OutputStepData

/** 用户输入步骤数据 */
export interface InputStepData {
  /** 原始输入文本 */
  text: string
}

/** System Prompt 注入步骤数据 */
export interface PromptStepData {
  /** 当前时间 (格式化后) */
  currentTime: string
  /** 用户位置 */
  userLocation?: {
    lat: number
    lng: number
    name?: string
  }
  /** 草稿上下文 */
  draftContext?: {
    activityId: string
    title: string
  }
  /** 完整 Prompt (可选，点击查看时加载) */
  fullPrompt?: string
}

/** LLM 推理步骤数据 */
export interface LLMStepData {
  /** 模型名称 */
  model: string
  /** 输入 Token 数 */
  inputTokens: number
  /** 输出 Token 数 */
  outputTokens: number
  /** 总 Token 数 */
  totalTokens: number
  /** 首 Token 延迟 (毫秒) */
  timeToFirstToken?: number
  /** 生成速度 (tokens/s) */
  tokensPerSecond?: number
  /** 成本 (USD) */
  cost?: number
}

/** Tool 调用步骤数据 */
export interface ToolStepData {
  /** 工具名称 (英文) */
  toolName: string
  /** 工具显示名称 (中文) */
  toolDisplayName: string
  /** 输入参数 */
  input: Record<string, unknown>
  /** 输出结果 */
  output?: Record<string, unknown>
  /** Widget 类型 (如果返回 Widget) */
  widgetType?: 'widget_draft' | 'widget_explore' | 'widget_share' | 'widget_detail' | 'widget_ask_preference'
  /** v3.10: 评估结果 */
  evaluation?: EvaluationResult
}

/** v3.10: 评估结果（扩展版 v3.13） */
export interface EvaluationResult {
  /** 是否通过 */
  passed: boolean
  /** 质量评分 1-10 */
  score: number
  /** 意图是否匹配 */
  intentMatch: boolean
  /** 语气接地气程度 1-5 */
  toneScore?: number
  /** 响应相关性 1-5 */
  relevanceScore?: number
  /** 上下文利用度 1-5 */
  contextScore?: number
  /** 评估推理过程 */
  thinking?: string
  /** 发现的问题 */
  issues: string[]
  /** 改进建议 */
  suggestions?: string[]
  /** 字段完整性（草稿专用） */
  fieldCompleteness?: {
    hasTitle: boolean
    hasType: boolean
    hasLocationHint: boolean
    hasValidTime: boolean
  }
}

/** 语气评分描述 */
export const TONE_SCORE_LABELS: Record<number, string> = {
  1: '太装逼',
  2: '偏正式',
  3: '中规中矩',
  4: '比较接地气',
  5: '很接地气',
}

/** 相关性评分描述 */
export const RELEVANCE_SCORE_LABELS: Record<number, string> = {
  1: '完全跑题',
  2: '部分相关',
  3: '基本切题',
  4: '切题完整',
  5: '切题+有价值补充',
}

/** 上下文利用度评分描述 */
export const CONTEXT_SCORE_LABELS: Record<number, string> = {
  1: '完全忽略',
  2: '部分利用',
  3: '基本利用',
  4: '利用良好',
  5: '完美衔接',
}

/** 最终输出步骤数据 */
export interface OutputStepData {
  /** AI 回复文本 */
  text: string
}

// ============ Type Guards ============

/** 检查是否为用户输入步骤数据 */
export function isInputStepData(data: TraceStepData): data is InputStepData {
  return 'text' in data && !('model' in data) && !('toolName' in data)
}

/** 检查是否为 Prompt 步骤数据 */
export function isPromptStepData(data: TraceStepData): data is PromptStepData {
  return 'currentTime' in data
}

/** 检查是否为 LLM 步骤数据 */
export function isLLMStepData(data: TraceStepData): data is LLMStepData {
  return 'model' in data && 'inputTokens' in data
}

/** 检查是否为 Tool 步骤数据 */
export function isToolStepData(data: TraceStepData): data is ToolStepData {
  return 'toolName' in data
}

/** 检查是否为输出步骤数据 */
export function isOutputStepData(data: TraceStepData): data is OutputStepData {
  return 'text' in data && !('currentTime' in data) && !('model' in data)
}

// ============ Step Icons & Labels ============

/** 步骤图标映射 */
export const STEP_ICONS: Record<StepType, string> = {
  input: '💬',
  prompt: '📝',
  llm: '🤖',
  tool: '🔧',
  output: '✨',
}

/** 步骤名称映射 */
export const STEP_LABELS: Record<StepType, string> = {
  input: '用户输入',
  prompt: 'System Prompt',
  llm: 'LLM 推理',
  tool: 'Tool 调用',
  output: '最终响应',
}

/** Tool 名称映射 */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  createActivityDraft: '创建活动草稿',
  getDraft: '获取草稿',
  refineDraft: '修改草稿',
  publishActivity: '发布活动',
  exploreNearby: '探索附近',
  getActivityDetail: '查看活动详情',
  joinActivity: '报名活动',
  cancelActivity: '取消活动',
  getMyActivities: '查看我的活动',
  askPreference: '询问偏好',
  // v4.0 Partner Intent Tools
  createPartnerIntent: '创建搭子意向',
  getMyIntents: '查看我的意向',
  cancelIntent: '取消意向',
  confirmMatch: '确认匹配',
}

/** 获取 Tool 显示名称 */
export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] || toolName
}

// ============ SSE Event Types ============

/** SSE 追踪开始事件 */
export interface TraceStartEvent {
  type: 'trace-start'
  data: {
    requestId: string
    startedAt: string
    systemPrompt?: string
    tools?: ToolDefinition[]
  }
}

/** SSE 追踪步骤事件 */
export interface TraceStepEvent {
  type: 'trace-step'
  data: TraceStep
}

/** SSE 追踪结束事件 */
export interface TraceEndEvent {
  type: 'trace-end'
  data: {
    completedAt: string
    status: TraceStatus
    totalCost?: number
  }
}

/** SSE 追踪事件联合类型 */
export type TraceEvent = TraceStartEvent | TraceStepEvent | TraceEndEvent

// ============ Model Params & Session Stats (v3.11) ============

/** 模型参数 */
export interface ModelParams {
  /** 模型名称 */
  model: 'qwen-flash' | 'qwen-plus' | 'qwen-max'
  /** Temperature (0-2) */
  temperature: number
  /** 最大输出 Token 数 (256-8192) */
  maxTokens: number
}

/** 默认模型参数 */
export const DEFAULT_MODEL_PARAMS: ModelParams = {
  model: 'qwen-flash',
  temperature: 0,
  maxTokens: 2048,
}

/** 会话统计 */
export interface SessionStats {
  /** 总轮次 */
  totalRounds: number
  /** 累计 Token 消耗 */
  totalTokens: number
  /** 累计耗时 (ms) */
  totalDuration: number
  /** 费用估算 (USD) */
  estimatedCost: number
}

/** Qwen3 定价 (USD per token) */
export const QWEN_PRICE: Record<string, { input: number; output: number }> = {
  'qwen-flash': { input: 0.0 / 1_000_000, output: 0.0 / 1_000_000 },  // 免费
  'qwen-plus': { input: 0.8 / 1_000_000, output: 2.0 / 1_000_000 },
  'qwen-max': { input: 2.0 / 1_000_000, output: 6.0 / 1_000_000 },
}

/** 计算会话统计 */
export function calculateSessionStats(traces: ExecutionTrace[], model: string = 'qwen-flash'): SessionStats {
  let totalTokens = 0
  let totalDuration = 0
  let inputTokens = 0
  let outputTokens = 0

  for (const trace of traces) {
    // 计算耗时
    if (trace.completedAt) {
      totalDuration += new Date(trace.completedAt).getTime() - new Date(trace.startedAt).getTime()
    }

    // 查找 LLM 步骤获取 Token 信息
    const llmStep = trace.steps.find(s => isLLMStepData(s.data))
    if (llmStep) {
      const data = llmStep.data as LLMStepData
      totalTokens += data.totalTokens || 0
      inputTokens += data.inputTokens || 0
      outputTokens += data.outputTokens || 0
    }
  }

  // 计算费用（根据当前模型定价）
  const price = QWEN_PRICE[model] || QWEN_PRICE['qwen-flash']
  const estimatedCost = 
    inputTokens * price.input + 
    outputTokens * price.output

  return {
    totalRounds: traces.length,
    totalTokens,
    totalDuration,
    estimatedCost,
  }
}

/** 格式化费用显示 */
export function formatCost(cost: number): string {
  if (cost >= 99.99) return '>99.99'
  if (cost < 0.0001) return '<0.0001'
  if (cost < 0.01) return cost.toFixed(4)
  return cost.toFixed(2)
}

/** 格式化耗时显示 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

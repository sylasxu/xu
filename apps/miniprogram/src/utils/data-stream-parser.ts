/**
 * Data Stream Parser for WeChat MiniProgram
 * 解析 Vercel AI SDK v6 Data Stream Protocol (SSE 格式)
 * 
 * AI SDK v6 使用 Server-Sent Events (SSE) 格式：
 * - event: text-delta        → 文本增量
 * - event: tool-input-available  → Tool 输入完成
 * - event: tool-output-available → Tool 输出完成
 * - event: finish-message    → 消息完成
 * - event: error             → 错误
 * 
 * @see https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol
 */

import { TOOL_WIDGET_MAP, WIDGET_TOOL_NAMES } from './widget-config'
/** Tool Call 数据结构 */
export interface ToolCall {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

/** Tool Result 数据结构 */
export interface ToolResult {
  toolCallId: string
  result: unknown
}

/** Usage 统计数据 */
export interface UsageStats {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/**
 * AI SDK v6 UIMessagePart 接口
 * 用于构建 tool call history
 */
export interface UIMessagePart {
  /** Part 类型：'text' 或 'tool-{toolName}' */
  type: string
  /** 文本内容（text part） */
  text?: string
  /** Tool Call ID（tool part） */
  toolCallId?: string
  /** Tool 名称（tool part） */
  toolName?: string
  /** Tool 输入参数（tool part） */
  input?: unknown
  /** Tool 输出结果（tool part） */
  output?: unknown
  /** Tool 状态：'call' | 'output-available'（tool part） */
  state?: 'call' | 'output-available'
}

/** 解析器回调配置 */
export interface DataStreamParserCallbacks {
  /** 收到文本增量时触发 */
  onText?: (text: string) => void
  /** 收到 Tool Call 时触发（tool-input-available） */
  onToolCall?: (toolCall: ToolCall) => void
  /** 收到 Tool Result 时触发（tool-output-available） */
  onToolResult?: (result: ToolResult) => void
  /** 流完成时触发 */
  onDone?: (usage?: UsageStats) => void
  /** 发生错误时触发 */
  onError?: (error: string) => void
  /** 收到附加数据时触发 */
  onData?: (data: unknown[]) => void
}

/** 解析器状态 */
interface ParserState {
  buffer: string
  accumulatedText: string
  toolCalls: Map<string, ToolCall>
  /** AI SDK v6 格式的 tool parts */
  toolParts: UIMessagePart[]
  /** 当前正在解析的 SSE 事件 */
  currentEvent: string | null
  /** 当前事件的数据行 */
  currentData: string[]
}

/**
 * Data Stream Parser Class
 * 处理 AI SDK v6 SSE 格式的流式数据解析
 */
export class DataStreamParser {
  private state: ParserState
  private callbacks: DataStreamParserCallbacks

  constructor(callbacks: DataStreamParserCallbacks = {}) {
    this.callbacks = callbacks
    this.state = {
      buffer: '',
      accumulatedText: '',
      toolCalls: new Map(),
      toolParts: [],
      currentEvent: null,
      currentData: [],
    }
  }

  /**
   * 喂入数据块进行解析
   * @param chunk 数据块（可能包含多行或不完整的行）
   */
  feed(chunk: string): void {
    // 将新数据追加到 buffer
    this.state.buffer += chunk

    // 按行分割处理
    const lines = this.state.buffer.split('\n')
    
    // 最后一行可能不完整，保留在 buffer 中
    this.state.buffer = lines.pop() || ''

    // 处理完整的行
    for (const line of lines) {
      this.parseLine(line)
    }
  }

  /**
   * 解析单行 SSE 数据
   * SSE 格式：
   * - "event: xxx" 设置事件类型
   * - "data: xxx" 设置事件数据
   * - 空行触发事件处理
   */
  private parseLine(line: string): void {
    // 空行表示一个 SSE 事件结束
    if (line.trim() === '') {
      this.processEvent()
      return
    }

    // 解析 "event: xxx"
    if (line.startsWith('event:')) {
      this.state.currentEvent = line.slice(6).trim()
      return
    }

    // 解析 "data: xxx"
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim()
      this.state.currentData.push(data)
      return
    }

    // 忽略注释和其他行
    if (line.startsWith(':') || line.startsWith('id:') || line.startsWith('retry:')) {
      return
    }
  }

  /**
   * 处理完整的 SSE 事件
   */
  private processEvent(): void {
    const event = this.state.currentEvent
    const dataStr = this.state.currentData.join('\n')

    // 重置当前事件状态
    this.state.currentEvent = null
    this.state.currentData = []

    if (!event || !dataStr) return

    // 处理 [DONE] 标记
    if (dataStr === '[DONE]') {
      this.callbacks.onDone?.()
      return
    }

    try {
      const data = JSON.parse(dataStr)
      
      switch (event) {
        case 'text-delta':
          this.handleTextDelta(data)
          break
        case 'tool-input-available':
          this.handleToolInputAvailable(data)
          break
        case 'tool-output-available':
          this.handleToolOutputAvailable(data)
          break
        case 'finish-message':
          this.handleFinishMessage(data)
          break
        case 'error':
          this.handleError(data)
          break
        // 其他事件类型（可选处理）
        case 'message-start':
        case 'text-start':
        case 'text-end':
        case 'start-step':
        case 'finish-step':
          // 这些事件用于更精细的控制，小程序端暂时忽略
          break
        default:
          // 处理自定义 data-* 事件
          if (event.startsWith('data-')) {
            this.handleCustomData(event, data)
          }
      }
    } catch (err) {
      console.warn('[DataStreamParser] Failed to parse event data:', event, dataStr, err)
    }
  }

  /**
   * 处理文本增量
   * event: text-delta
   * data: {"textDelta":"Hello"}
   */
  private handleTextDelta(data: { textDelta: string }): void {
    const text = data.textDelta
    if (text) {
      this.state.accumulatedText += text
      this.callbacks.onText?.(text)
    }
  }

  /**
   * 处理 Tool 输入完成
   * event: tool-input-available
   * data: {"toolCallId":"xxx","toolName":"xxx","input":{...}}
   */
  private handleToolInputAvailable(data: {
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
  }): void {
    const toolCall: ToolCall = {
      toolCallId: data.toolCallId,
      toolName: data.toolName,
      args: data.input,
    }
    
    this.state.toolCalls.set(data.toolCallId, toolCall)
    
    // 构建 AI SDK v6 格式的 tool part
    const toolPart: UIMessagePart = {
      type: `tool-${data.toolName}`,
      toolCallId: data.toolCallId,
      toolName: data.toolName,
      input: data.input,
      state: 'call',
    }
    this.state.toolParts.push(toolPart)
    
    this.callbacks.onToolCall?.(toolCall)
  }

  /**
   * 处理 Tool 输出完成
   * event: tool-output-available
   * data: {"toolCallId":"xxx","output":{...}}
   */
  private handleToolOutputAvailable(data: {
    toolCallId: string
    output: unknown
  }): void {
    const result: ToolResult = {
      toolCallId: data.toolCallId,
      result: data.output,
    }
    
    // 更新对应的 tool part
    const toolPart = this.state.toolParts.find(p => p.toolCallId === data.toolCallId)
    if (toolPart) {
      toolPart.output = data.output
      toolPart.state = 'output-available'
    }
    
    this.callbacks.onToolResult?.(result)
  }

  /**
   * 处理消息完成
   * event: finish-message
   * data: {"finishReason":"stop","usage":{...}}
   */
  private handleFinishMessage(data: {
    finishReason?: string
    usage?: {
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
    }
  }): void {
    this.callbacks.onDone?.(data.usage)
  }

  /**
   * 处理错误
   * event: error
   * data: {"message":"..."}
   */
  private handleError(data: { message?: string } | string): void {
    const errorMessage = typeof data === 'string' 
      ? data 
      : data.message || 'Unknown error'
    this.callbacks.onError?.(errorMessage)
  }

  /**
   * 处理自定义数据事件
   * event: data-*
   */
  private handleCustomData(event: string, data: unknown): void {
    // 将自定义数据作为数组传递
    this.callbacks.onData?.([{ type: event, data }])
  }

  /**
   * 获取累积的文本内容
   */
  getAccumulatedText(): string {
    return this.state.accumulatedText
  }

  /**
   * 获取所有 Tool Calls
   */
  getToolCalls(): ToolCall[] {
    return Array.from(this.state.toolCalls.values())
  }

  /**
   * 获取 AI SDK v6 格式的 tool parts
   * 用于构建完整的消息历史
   */
  getToolParts(): UIMessagePart[] {
    return [...this.state.toolParts]
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.state = {
      buffer: '',
      accumulatedText: '',
      toolCalls: new Map(),
      toolParts: [],
      currentEvent: null,
      currentData: [],
    }
  }

  /**
   * 刷新 buffer（处理最后可能不完整的数据）
   */
  flush(): void {
    if (this.state.buffer.trim()) {
      this.parseLine(this.state.buffer)
      this.state.buffer = ''
    }
    // 处理最后一个可能未完成的事件
    if (this.state.currentEvent || this.state.currentData.length > 0) {
      this.processEvent()
    }
  }
}

/**
 * 工厂函数 - 创建 Data Stream Parser
 */
export function createDataStreamParser(
  callbacks: DataStreamParserCallbacks = {}
): DataStreamParser {
  return new DataStreamParser(callbacks)
}

/**
 * 辅助函数 - 从 Tool Call 中提取 Widget 类型
 * 根据 toolName 判断应该渲染哪种 Widget
 */
export function getWidgetTypeFromToolCall(toolCall: ToolCall): string | null {
  return TOOL_WIDGET_MAP[toolCall.toolName] || null
}

/**
 * 辅助函数 - 判断是否是 Widget 相关的 Tool
 */
export function isWidgetTool(toolName: string): boolean {
  return WIDGET_TOOL_NAMES.includes(toolName)
}

export default DataStreamParser

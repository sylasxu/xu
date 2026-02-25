/**
 * Chat Store - 类似 @ai-sdk/react 的 useChat
 * 
 * 提供统一的 AI 对话状态管理，与 Admin 端保持一致的 API 设计
 * 同时支持 Widget 渲染（draft、explore、ask_preference 等）
 * 
 * @example
 * ```typescript
 * const chatStore = useChatStore.getState()
 * 
 * // 发送消息
 * chatStore.sendMessage('明晚观音桥打麻将')
 * 
 * // 订阅状态
 * useChatStore.subscribe((state) => {
 *   console.log(state.messages, state.status)
 * })
 * ```
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist, createJSONStorage } from 'zustand/middleware'
import { 
  sseRequest, 
  type SSEController,
  type UIMessagePart,
} from '../utils/sse-request'
import { getWidgetTypeFromToolCall, type ToolCall } from '../utils/data-stream-parser'
import { transformToolResult } from '../utils/widget-transforms'
import type { DraftContext } from '../types/global'

// ============================================================================
// Types - 与 AI SDK v6 UIMessage 保持一致，扩展 Widget 支持
// ============================================================================

/** 消息 Part 类型 */
export type { UIMessagePart }

/** 消息角色 */
export type MessageRole = 'user' | 'assistant'

/** 
 * Widget Part - 用于渲染 Widget 组件
 * 扩展 AI SDK 的 part 概念，支持小程序特有的 Widget
 */
export interface WidgetPart {
  type: 'widget'
  widgetType: 'dashboard' | 'draft' | 'explore' | 'share' | 'ask_preference' | 'error'
  data: unknown
}

/**
 * User Action - A2UI 风格的结构化用户操作
 * 用户点击 Widget 按钮时发送，跳过 LLM 意图识别
 */
export interface UserAction {
  /** Action 类型 */
  action: string
  /** Action 参数 */
  payload: Record<string, unknown>
  /** 来源 Widget 类型 */
  source?: string
  /** 原始文本（用于回退） */
  originalText?: string
}

/** 
 * UI Message - 与 AI SDK v6 格式一致，扩展 Widget 支持
 * @see https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol
 */
export interface UIMessage {
  id: string
  role: MessageRole
  parts: (UIMessagePart | WidgetPart)[]
  createdAt: Date
}

/** Chat 状态 - 与 useChat 一致 */
export type ChatStatus = 'idle' | 'submitted' | 'streaming'

/** 当前流式消息的 ID */
export type StreamingMessageId = string | null

// ============================================================================
// Helper Functions
// ============================================================================

/** 生成唯一 ID */
const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

/** 从 UIMessage 提取文本内容 */
export function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((part): part is UIMessagePart & { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('')
}

/** 从 UIMessage 提取 Tool Parts */
export function getToolParts(message: UIMessage): UIMessagePart[] {
  return message.parts.filter((part): part is UIMessagePart => 
    typeof part.type === 'string' && part.type.startsWith('tool-')
  )
}

/** 从 UIMessage 提取 Widget Part */
export function getWidgetPart(message: UIMessage): WidgetPart | null {
  return message.parts.find((part): part is WidgetPart => part.type === 'widget') || null
}

/** 判断消息是否正在流式输出 */
export function isStreaming(message: UIMessage, streamingId: StreamingMessageId): boolean {
  return streamingId === message.id
}

// ============================================================================
// 微信小程序存储适配器
// ============================================================================

const wechatStorage = {
  getItem: (name: string) => wx.getStorageSync(name) || null,
  setItem: (name: string, value: string) => wx.setStorageSync(name, value),
  removeItem: (name: string) => wx.removeStorageSync(name),
}

// ============================================================================
// Store Definition
// ============================================================================

interface ChatState {
  // ========== 状态 ==========
  /** 消息列表 */
  messages: UIMessage[]
  /** 当前状态：idle | submitted | streaming */
  status: ChatStatus
  /** 错误信息 */
  error: Error | null
  /** 当前正在流式输出的消息 ID */
  streamingMessageId: StreamingMessageId
  /** 用户位置（可选） */
  location: { lat: number; lng: number } | null
  
  // ========== Actions ==========
  /** 发送消息 */
  sendMessage: (text: string, options?: { draftContext?: DraftContext; keywordId?: string }) => void
  /** 停止生成 */
  stop: () => void
  /** 清空消息 */
  clearMessages: () => void
  /** 设置消息列表 */
  setMessages: (messages: UIMessage[]) => void
  /** 设置用户位置 */
  setLocation: (location: { lat: number; lng: number } | null) => void
  /** 添加 Widget 消息（用于 Dashboard、Share 等） */
  addWidgetMessage: (widgetType: WidgetPart['widgetType'], data: unknown) => string
  /** 发送结构化 Action (A2UI 风格) */
  sendAction: (action: UserAction) => void
  /** 追加 Widget 操作结果到对话历史（让 AI 下次对话时感知用户的卡内操作） */
  appendActionResult: (actionType: string, params: Record<string, unknown>, success: boolean, summary: string) => void
  
  // ========== Internal ==========
  /** SSE 控制器（内部使用） */
  _controller: SSEController | null
  /** 设置控制器 */
  _setController: (controller: SSEController | null) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    immer((set, get) => ({
      // ========== 初始状态 ==========
      messages: [],
      status: 'idle',
      error: null,
      streamingMessageId: null,
      location: null,
      _controller: null,

      // ========== Actions ==========
      
      /**
       * 发送消息
       * 类似 useChat 的 sendMessage
       */
      sendMessage: (text: string, options?: { draftContext?: DraftContext; keywordId?: string }) => {
        const state = get()
        
        // 如果正在请求中，先停止
        if (state.status !== 'idle') {
          state.stop()
        }
        
        // 1. 添加用户消息
        const userMessageId = generateId()
        const userMessage: UIMessage = {
          id: userMessageId,
          role: 'user',
          parts: [{ type: 'text', text }],
          createdAt: new Date(),
        }
        
        // 2. 创建 AI 消息占位
        const aiMessageId = generateId()
        const aiMessage: UIMessage = {
          id: aiMessageId,
          role: 'assistant',
          parts: [],
          createdAt: new Date(),
        }
        
        set((draft) => {
          draft.messages.push(userMessage)
          draft.messages.push(aiMessage)
          draft.status = 'submitted'
          draft.error = null
          draft.streamingMessageId = aiMessageId
        })
        
        // 3. 构建请求消息（包含历史）
        const requestMessages = get().messages.slice(0, -1).map(m => ({
          role: m.role,
          content: getTextContent(m),
          parts: m.parts.filter((p): p is UIMessagePart => p.type !== 'widget'),
        }))
        
        // 4. 发起 SSE 请求
        let accumulatedText = ''
        let currentToolCall: ToolCall | null = null
        
        const controller = sseRequest(
          '/ai/chat',
          {
            body: {
              messages: requestMessages,
              source: 'miniprogram',
              ...(state.location ? { location: state.location } : {}),
              ...(options?.draftContext ? { draftContext: options.draftContext } : {}),
              ...(options?.keywordId ? { keywordId: options.keywordId } : {}),
            },
          },
          {
            onStart: () => {
              set((draft) => {
                draft.status = 'streaming'
              })
            },
            
            onText: (chunk) => {
              accumulatedText += chunk
              
              // 只有没有 tool call 时才更新文本
              if (!currentToolCall) {
                set((draft) => {
                  const msgIndex = draft.messages.findIndex(m => m.id === aiMessageId)
                  if (msgIndex !== -1) {
                    // 更新或添加 text part
                    const textPartIndex = draft.messages[msgIndex].parts.findIndex(p => p.type === 'text')
                    if (textPartIndex !== -1) {
                      (draft.messages[msgIndex].parts[textPartIndex] as UIMessagePart).text = accumulatedText
                    } else {
                      draft.messages[msgIndex].parts.unshift({ type: 'text', text: accumulatedText })
                    }
                  }
                })
              }
            },
            
            onToolCall: (toolCall: ToolCall) => {
              currentToolCall = toolCall
              
              // 构建 tool part
              const toolPart: UIMessagePart = {
                type: `tool-${toolCall.toolName}`,
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolCall.args,
                state: 'call',
              }
              
              set((draft) => {
                const msgIndex = draft.messages.findIndex(m => m.id === aiMessageId)
                if (msgIndex !== -1) {
                  draft.messages[msgIndex].parts.push(toolPart)
                }
                // Tool 调用开始，清除文本流式状态
                draft.streamingMessageId = null
              })
            },
            
            onToolResult: (result) => {
              if (!currentToolCall) return
              
              const widgetType = getWidgetTypeFromToolCall(currentToolCall)
              
              set((draft) => {
                const msgIndex = draft.messages.findIndex(m => m.id === aiMessageId)
                if (msgIndex === -1) return
                
                // 更新 tool part 状态
                const toolPartIndex = draft.messages[msgIndex].parts.findIndex(
                  (p): p is UIMessagePart => 'toolCallId' in p && p.toolCallId === result.toolCallId
                )
                if (toolPartIndex !== -1) {
                  const toolPart = draft.messages[msgIndex].parts[toolPartIndex] as UIMessagePart
                  toolPart.output = result.result
                  toolPart.state = 'output-available'
                }
                
                // 添加 Widget Part（用于 UI 渲染）
                if (widgetType) {
                  const widgetData = transformToolResult(widgetType, result.result)
                  
                  const widgetPart: WidgetPart = {
                    type: 'widget',
                    widgetType: widgetType.replace('widget_', '') as WidgetPart['widgetType'],
                    data: widgetData,
                  }
                  draft.messages[msgIndex].parts.push(widgetPart)
                }
              })
            },
            
            onDone: () => {
              set((draft) => {
                draft.status = 'idle'
                draft.streamingMessageId = null
                draft._controller = null
              })
            },
            
            onError: (errorMsg) => {
              set((draft) => {
                draft.status = 'idle'
                draft.streamingMessageId = null
                draft.error = new Error(errorMsg)
                draft._controller = null
                
                // 添加错误 Widget
                const msgIndex = draft.messages.findIndex(m => m.id === aiMessageId)
                if (msgIndex !== -1) {
                  const errorWidget: WidgetPart = {
                    type: 'widget',
                    widgetType: 'error',
                    data: {
                      message: '抱歉，我没理解你的意思，试试换个说法？',
                      showRetry: true,
                      originalText: text,
                    },
                  }
                  draft.messages[msgIndex].parts = [errorWidget]
                }
              })
            },
            
            onFinish: () => {
              set((draft) => {
                draft._controller = null
              })
            },
          }
        )
        
        set((draft) => {
          draft._controller = controller
        })
      },
      
      /**
       * 停止生成
       * 类似 useChat 的 stop
       */
      stop: () => {
        const state = get()
        state._controller?.abort()
        
        set((draft) => {
          draft.status = 'idle'
          draft.streamingMessageId = null
          draft._controller = null
        })
      },
      
      /**
       * 清空消息
       * 类似 useChat 的 setMessages([])
       */
      clearMessages: () => {
        const state = get()
        state.stop()
        
        set((draft) => {
          draft.messages = []
          draft.error = null
        })
      },
      
      /**
       * 设置消息列表
       * 类似 useChat 的 setMessages
       */
      setMessages: (messages: UIMessage[]) => {
        set((draft) => {
          draft.messages = messages
        })
      },
      
      /**
       * 设置用户位置
       */
      setLocation: (location) => {
        set((draft) => {
          draft.location = location
        })
      },
      
      /**
       * 添加 Widget 消息（用于 Dashboard、Share 等本地生成的 Widget）
       * 返回消息 ID
       */
      addWidgetMessage: (widgetType, data) => {
        const id = generateId()
        const message: UIMessage = {
          id,
          role: 'assistant',
          parts: [{
            type: 'widget',
            widgetType,
            data,
          }],
          createdAt: new Date(),
        }
        
        set((draft) => {
          draft.messages.push(message)
        })
        
        return id
      },
      
      /**
       * 发送结构化 Action (A2UI 风格)
       * 跳过 LLM 意图识别，直接执行对应操作
       */
      sendAction: (action: UserAction) => {
        const state = get()
        
        // 如果正在请求中，先停止
        if (state.status !== 'idle') {
          state.stop()
        }
        
        // 1. 添加用户消息（显示 action 的原始文本或描述）
        const userMessageId = generateId()
        const displayText = action.originalText || `执行 ${action.action}`
        const userMessage: UIMessage = {
          id: userMessageId,
          role: 'user',
          parts: [{ type: 'text', text: displayText }],
          createdAt: new Date(),
        }
        
        // 2. 创建 AI 消息占位
        const aiMessageId = generateId()
        const aiMessage: UIMessage = {
          id: aiMessageId,
          role: 'assistant',
          parts: [],
          createdAt: new Date(),
        }
        
        set((draft) => {
          draft.messages.push(userMessage)
          draft.messages.push(aiMessage)
          draft.status = 'submitted'
          draft.error = null
          draft.streamingMessageId = aiMessageId
        })
        
        // 3. 发起 SSE 请求，带上 userAction 参数
        let accumulatedText = ''
        
        const controller = sseRequest(
          '/ai/chat',
          {
            body: {
              messages: [], // action 模式不需要历史消息
              source: 'miniprogram',
              ...(state.location ? { location: [state.location.lng, state.location.lat] } : {}),
              userAction: action,
            },
          },
          {
            onStart: () => {
              set((draft) => {
                draft.status = 'streaming'
              })
            },
            
            onText: (chunk) => {
              accumulatedText += chunk
              set((draft) => {
                const msgIndex = draft.messages.findIndex(m => m.id === aiMessageId)
                if (msgIndex !== -1) {
                  const textPartIndex = draft.messages[msgIndex].parts.findIndex(p => p.type === 'text')
                  if (textPartIndex !== -1) {
                    (draft.messages[msgIndex].parts[textPartIndex] as UIMessagePart).text = accumulatedText
                  } else {
                    draft.messages[msgIndex].parts.unshift({ type: 'text', text: accumulatedText })
                  }
                }
              })
            },
            
            onData: (data) => {
              // 处理 action_result 数据
              if (data?.type === 'action_result') {
                set((draft) => {
                  const msgIndex = draft.messages.findIndex(m => m.id === aiMessageId)
                  if (msgIndex !== -1) {
                    // 如果有导航指令，触发导航
                    const resultData = data.data as Record<string, unknown> | undefined
                    if (resultData?.action === 'navigate' && resultData?.url) {
                      // 导航由前端处理
                      wx.navigateTo({ url: resultData.url as string })
                    }
                  }
                })
              }
            },
            
            onDone: () => {
              set((draft) => {
                draft.status = 'idle'
                draft.streamingMessageId = null
                draft._controller = null
              })
            },
            
            onError: (errorMsg) => {
              set((draft) => {
                draft.status = 'idle'
                draft.streamingMessageId = null
                draft.error = new Error(errorMsg)
                draft._controller = null
                
                // 添加错误 Widget
                const msgIndex = draft.messages.findIndex(m => m.id === aiMessageId)
                if (msgIndex !== -1) {
                  const errorWidget: WidgetPart = {
                    type: 'widget',
                    widgetType: 'error',
                    data: {
                      message: errorMsg || '操作失败，请重试',
                      showRetry: true,
                      originalText: action.originalText,
                    },
                  }
                  draft.messages[msgIndex].parts = [errorWidget]
                }
              })
            },
            
            onFinish: () => {
              set((draft) => {
                draft._controller = null
              })
            },
          }
        )
        
        set((draft) => {
          draft._controller = controller
        })
      },
      
      /**
       * 追加 Widget 操作结果到对话历史
       * 用于引用模式下的卡内操作（executeWidgetAction），让 AI 下次对话时知道用户做了什么
       */
      appendActionResult: (actionType, params, success, summary) => {
        const id = generateId()
        const message: UIMessage = {
          id,
          role: 'assistant',
          parts: [{
            type: 'text',
            text: `[用户操作] ${summary}`,
          }],
          createdAt: new Date(),
        }
        
        set((draft) => {
          draft.messages.push(message)
        })
      },
      
      // ========== Internal ==========
      _setController: (controller) => {
        set((draft) => {
          draft._controller = controller
        })
      },
    })),
    {
      name: 'chat-store',
      storage: createJSONStorage(() => wechatStorage),
      // 只持久化消息列表
      partialize: (state) => ({
        messages: state.messages.slice(-50), // 只缓存最近 50 条
      }),
    }
  )
)

// ============================================================================
// Selectors - 方便使用的选择器
// ============================================================================

/** 获取最后一条消息 */
export const selectLastMessage = (state: ChatState) => 
  state.messages.length > 0 ? state.messages[state.messages.length - 1] : null

/** 获取最后一条 AI 消息 */
export const selectLastAIMessage = (state: ChatState) => 
  [...state.messages].reverse().find(m => m.role === 'assistant') || null

/** 判断是否正在加载 */
export const selectIsLoading = (state: ChatState) => 
  state.status === 'submitted' || state.status === 'streaming'

/** 判断是否正在流式输出 */
export const selectIsStreaming = (state: ChatState) => 
  state.status === 'streaming'

export default useChatStore

/**
 * AI SDK Elements
 * 
 * 基于 Vercel AI SDK Elements 设计的 React 组件库
 * 用于构建 AI 对话界面
 * 
 * @see https://elements.ai-sdk.dev
 */

// Conversation 组件
export {
  Conversation,
  ConversationContent,
  ConversationEmpty,
} from "./conversation";

// Message 组件
export {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  type MessageRole,
} from "./message";

// PromptInput 组件
export {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from "./prompt-input";

// Reasoning 组件
export {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "./reasoning";

// ToolInvocation 组件
export {
  ToolInvocationCard,
  type ToolInvocation,
} from "./tool-invocation";
export type { ToolInvocation as ToolInvocationType } from "./tool-invocation";

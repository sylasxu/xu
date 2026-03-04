/**
 * Shared stream types for mini-program chat store.
 *
 * The old Data Stream parser and `sendAIChat(messages)` compatibility layer
 * were removed in GenUI vNext. `/ai/chat` now accepts only GenUI input payload.
 */

export interface UIMessagePart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  state?: string;
  errorText?: string;
  [key: string]: unknown;
}

export interface SSEController {
  abort: () => void;
}

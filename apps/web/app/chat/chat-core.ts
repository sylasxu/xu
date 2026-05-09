import {
  isDataUIPart,
  isTextUIPart,
  type UIMessage as AISDKUIMessage,
  type UIMessageChunk,
} from "ai";
import type {
  GenUIBlock,
  GenUIRecentMessage,
  GenUIRequestContext,
  GenUIResponseEnvelope,
  GenUITextBlock,
} from "@/src/gen/genui-contract";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";
export const TEXT_STREAM_CHUNK_DELAY_MS = 60;
export const MAX_TRANSIENT_TURNS = 10;

export type ActivityContextOverrides = Pick<
  GenUIRequestContext,
  "activityId" | "activityMode" | "entry"
>;

export type LocalStructuredAction = {
  action: string;
  actionId: string;
  params?: Record<string, unknown>;
  source?: string;
  displayText?: string;
};

export type LocalGenUIRecentMessage = GenUIRecentMessage & {
  action?: string;
  actionId?: string;
  params?: Record<string, unknown>;
  source?: string;
  displayText?: string;
};

export type ActionOption =
  | Pick<import("@/src/gen/genui-contract").GenUIChoiceOption, "label" | "action" | "params">
  | import("@/src/gen/genui-contract").GenUICtaItem;

export type ChatStreamMessageMetadata = {
  traceId?: string;
  conversationId?: string;
  responseId?: string;
  status?: GenUIResponseEnvelope["response"]["status"];
  suggestions?: GenUIResponseEnvelope["response"]["suggestions"];
  assistantTextOverride?: string;
  action?: string;
  actionId?: string;
  params?: Record<string, unknown>;
  source?: string;
  displayText?: string;
};

export type ChatStreamDataTypes = {
  genui_block: {
    block: GenUIBlock;
    mode: "append" | "replace";
  };
};

export type ChatStreamMessage = AISDKUIMessage<
  ChatStreamMessageMetadata,
  ChatStreamDataTypes
>;

export type ChatStreamChunk = UIMessageChunk<
  ChatStreamMessageMetadata,
  ChatStreamDataTypes
>;

export function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseSSEPacket(packet: string): { eventName: string; dataText: string } | null {
  const trimmed = packet.trim();
  if (!trimmed) return null;

  const lines = trimmed.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  return { eventName, dataText: dataLines.join("\n") };
}

export function readStreamEventData(payload: unknown): unknown {
  if (isRecord(payload) && payload.data !== undefined) {
    return payload.data;
  }
  return payload;
}

export function normalizeChatErrorMessage(message: string): string {
  const normalized = message.trim();
  const lowerCased = normalized.toLowerCase();

  if (
    lowerCased.includes("free tier of the model has been exhausted") ||
    (lowerCased.includes("use free tier only") && lowerCased.includes("management console"))
  ) {
    return "AI 服务额度暂时用完了，请稍后再试。";
  }

  return normalized || "请求失败，请稍后再试";
}

export async function readChatResponseErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text.trim()) return `请求失败（${response.status}）`;
    try {
      const payload = JSON.parse(text) as unknown;
      if (isRecord(payload) && typeof payload.msg === "string")
        return normalizeChatErrorMessage(payload.msg);
      if (isRecord(payload) && typeof payload.message === "string")
        return normalizeChatErrorMessage(payload.message);
    } catch {
      return normalizeChatErrorMessage(text);
    }
    return normalizeChatErrorMessage(text);
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export function createEmptyEnvelope(params: {
  traceId: string;
  conversationId: string;
  responseId: string;
}): GenUIResponseEnvelope {
  return {
    traceId: params.traceId,
    conversationId: params.conversationId,
    response: {
      responseId: params.responseId,
      role: "assistant",
      status: "streaming",
      blocks: [],
    },
  };
}

export function resolvePrimaryBlockType(
  blocks: GenUIBlock[]
): GenUIRecentMessage["primaryBlockType"] {
  const primaryBlock = blocks.find((block) => block.type !== "text") ?? blocks[0];
  return primaryBlock?.type ?? null;
}

export function splitTextForUiStreaming(text: string): string[] {
  const chunks = text.match(/.{1,8}(?:[，。！？；：,.!?;:\n\s]+|$)|.{8}/gu);
  return chunks && chunks.length > 0 ? chunks : [text];
}

export async function enqueueSimulatedTextDeltaChunks(
  enqueue: (chunk: ChatStreamChunk) => void,
  params: { textPartId: string; deltaText: string }
): Promise<void> {
  const slices = splitTextForUiStreaming(params.deltaText).filter(Boolean);
  if (slices.length === 0) return;

  const { simulateReadableStream } = await import("ai");
  const stream = simulateReadableStream({
    chunks: slices,
    initialDelayInMs: 0,
    chunkDelayInMs: TEXT_STREAM_CHUNK_DELAY_MS,
  });
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    enqueue({
      type: "text-delta",
      id: params.textPartId,
      delta: value,
    });
  }
}

export function buildEnvelopeFromStreamMessage(
  message: ChatStreamMessage
): GenUIResponseEnvelope {
  const metadata = message.metadata;
  const blocks = message.parts.reduce<GenUIBlock[]>((result, part, index) => {
    if (isTextUIPart(part)) {
      const content =
        typeof metadata?.assistantTextOverride === "string"
          ? metadata.assistantTextOverride
          : part.text;
      if (!content.trim()) return result;

      result.push({
        blockId: `${message.id}_text_${index}`,
        type: "text",
        content,
      });
      return result;
    }

    if (isDataUIPart<ChatStreamDataTypes>(part) && part.type === "data-genui_block") {
      const payload = part.data;
      if (!isRecord(payload) || !isGenUIBlock(payload.block)) {
        return result;
      }
      const mode = payload.mode === "replace" ? "replace" : "append";
      return upsertBlockWithMode(result, payload.block, mode).blocks;
    }

    return result;
  }, []);

  const hasTextBlock = blocks.some((block) => block.type === "text");
  if (!hasTextBlock && typeof metadata?.assistantTextOverride === "string") {
    const content = metadata.assistantTextOverride.trim();
    if (content) {
      blocks.unshift({
        blockId: `${message.id}_text_override`,
        type: "text",
        content,
      });
    }
  }

  return {
    traceId: metadata?.traceId ?? `trace_${message.id}`,
    conversationId: metadata?.conversationId ?? `conv_${message.id}`,
    response: {
      responseId: metadata?.responseId ?? message.id,
      role: "assistant",
      status: metadata?.status ?? "streaming",
      blocks,
      ...(metadata?.suggestions ? { suggestions: metadata.suggestions } : {}),
    },
  };
}

export function trimStructuredTextContent(text: string, _blocks: GenUIBlock[]): string {
  return text.trim().replace(/\n{2,}/g, " ");
}

export function getRenderableBlocks(blocks: GenUIBlock[]): GenUIBlock[] {
  return blocks.reduce<GenUIBlock[]>((result, block) => {
    if (block.type !== "text") {
      result.push(block);
      return result;
    }
    const content = trimStructuredTextContent(block.content, blocks);
    if (!content) return result;
    result.push({ ...block, content });
    return result;
  }, []);
}

export function summarizeAssistantBlocks(blocks: GenUIBlock[]): string {
  const textBlocks = getRenderableBlocks(blocks)
    .filter((block): block is GenUITextBlock => block.type === "text")
    .map((block) => block.content.trim())
    .filter(Boolean);

  if (textBlocks.length > 0) {
    return textBlocks.join("\n\n");
  }

  for (const block of blocks) {
    if (block.type === "choice" && block.question.trim()) {
      return block.question.trim();
    }
    if (block.type === "list") {
      if (typeof block.title === "string" && block.title.trim()) {
        return block.title.trim();
      }
      const firstItem = block.items.find(
        (item) => isRecord(item) && typeof item.title === "string" && item.title.trim()
      );
      if (firstItem && typeof firstItem.title === "string") {
        return firstItem.title.trim();
      }
    }
    if (block.type === "entity-card" && block.title.trim()) {
      return block.title.trim();
    }
    if (block.type === "form" && typeof block.title === "string" && block.title.trim()) {
      return block.title.trim();
    }
    if (block.type === "cta-group" && block.items.length > 0) {
      return block.items[0]?.label?.trim() || "";
    }
    if (block.type === "alert" && block.message.trim()) {
      return block.message.trim();
    }
  }

  return "";
}

export function isGenUIResponseStatus(
  value: unknown
): value is GenUIResponseEnvelope["response"]["status"] {
  return value === "streaming" || value === "completed" || value === "error";
}

export function isGenUIChoiceOption(value: unknown): value is import("@/src/gen/genui-contract").GenUIChoiceOption {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.action === "string" &&
    (value.params === undefined || isRecord(value.params))
  );
}

export function isGenUICtaItem(value: unknown): value is import("@/src/gen/genui-contract").GenUICtaItem {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    typeof value.action === "string" &&
    (value.params === undefined || isRecord(value.params))
  );
}

export function isGenUIBlock(value: unknown): value is GenUIBlock {
  if (!isRecord(value) || typeof value.blockId !== "string") return false;

  if (value.dedupeKey !== undefined && typeof value.dedupeKey !== "string") return false;
  if (
    value.replacePolicy !== undefined &&
    value.replacePolicy !== "append" &&
    value.replacePolicy !== "replace" &&
    value.replacePolicy !== "ignore-if-exists"
  ) {
    return false;
  }
  if (value.meta !== undefined && !isRecord(value.meta)) return false;

  switch (value.type) {
    case "text":
      return typeof value.content === "string";
    case "choice":
      return (
        typeof value.question === "string" &&
        Array.isArray(value.options) &&
        value.options.every(isGenUIChoiceOption)
      );
    case "entity-card":
      return typeof value.title === "string" && isRecord(value.fields);
    case "list":
      return (
        (value.title === undefined || typeof value.title === "string") &&
        Array.isArray(value.items) &&
        value.items.every(isRecord)
      );
    case "form":
      return (
        (value.title === undefined || typeof value.title === "string") &&
        isRecord(value.schema) &&
        (value.initialValues === undefined || isRecord(value.initialValues))
      );
    case "cta-group":
      return Array.isArray(value.items) && value.items.every(isGenUICtaItem);
    case "alert":
      return (
        (value.level === "info" || value.level === "warning" || value.level === "error" || value.level === "success") &&
        typeof value.message === "string"
      );
    default:
      return false;
  }
}

export function isGenUITextBlock(block: GenUIBlock): block is GenUITextBlock {
  return block.type === "text";
}

export function isGenUISuggestions(
  value: unknown
): value is NonNullable<GenUIResponseEnvelope["response"]["suggestions"]> {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "choice") return Array.isArray(value.options);
  if (value.kind === "list") return Array.isArray(value.items);
  if (value.kind === "cta-group") return Array.isArray(value.items);
  return false;
}

export function isGenUIResponseEnvelope(value: unknown): value is GenUIResponseEnvelope {
  if (!isRecord(value) || typeof value.traceId !== "string" || typeof value.conversationId !== "string") {
    return false;
  }
  if (!isRecord(value.response)) return false;

  return (
    typeof value.response.responseId === "string" &&
    value.response.role === "assistant" &&
    isGenUIResponseStatus(value.response.status) &&
    Array.isArray(value.response.blocks) &&
    value.response.blocks.every(isGenUIBlock)
  );
}

export function upsertBlockWithMode(
  blocks: GenUIBlock[],
  block: GenUIBlock,
  mode: "append" | "replace"
): { blocks: GenUIBlock[]; index: number } {
  if (mode === "replace") {
    const targetIndex = blocks.findIndex((item) => item.blockId === block.blockId);
    if (targetIndex >= 0) {
      const nextBlocks = [...blocks];
      nextBlocks[targetIndex] = block;
      return { blocks: nextBlocks, index: targetIndex };
    }
  }
  const nextBlocks = [...blocks, block];
  return { blocks: nextBlocks, index: nextBlocks.length - 1 };
}

export function extractUIMessageText(message: ChatStreamMessage): string {
  if (message.role === "user") {
    const textPart = message.parts.find((p) => p.type === "text");
    return textPart?.text?.trim() || "";
  }
  const envelope = buildEnvelopeFromStreamMessage(message);
  return summarizeAssistantBlocks(envelope.response.blocks);
}

export function readStoredConversationText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!isRecord(content)) return "";
  if (typeof content.text === "string" && content.text.trim()) return content.text.trim();
  if (typeof content.message === "string" && content.message.trim()) return content.message.trim();
  return "";
}

export function buildEnvelopeFromStoredAssistantMessage(params: {
  conversationId: string;
  messageId: string;
  content: unknown;
}): GenUIResponseEnvelope | null {
  if (isRecord(params.content) && isRecord(params.content.response)) {
    const storedResponse = params.content.response;
    const blocks = Array.isArray(storedResponse.blocks)
      ? storedResponse.blocks.filter(isGenUIBlock)
      : [];

    if (blocks.length > 0) {
      return {
        traceId:
          typeof storedResponse.traceId === "string" && storedResponse.traceId.trim()
            ? storedResponse.traceId
            : `history_trace_${params.messageId}`,
        conversationId: params.conversationId,
        response: {
          responseId:
            typeof storedResponse.responseId === "string" && storedResponse.responseId.trim()
              ? storedResponse.responseId
              : `history_response_${params.messageId}`,
          role: "assistant",
          status: isGenUIResponseStatus(storedResponse.status) ? storedResponse.status : "completed",
          ...(isGenUISuggestions(storedResponse.suggestions) ? { suggestions: storedResponse.suggestions } : {}),
          blocks,
        },
      };
    }
  }

  const text = readStoredConversationText(params.content);
  if (!text) return null;

  return {
    traceId: `history_trace_${params.messageId}`,
    conversationId: params.conversationId,
    response: {
      responseId: `history_response_${params.messageId}`,
      role: "assistant",
      status: "completed",
      blocks: [{ blockId: `${params.messageId}_text`, type: "text", content: text }],
    },
  };
}

export function buildChatStreamMessageFromStoredMessage(
  conversationId: string,
  item: { id: string; userId: string; userNickname: string | null; role: "user" | "assistant"; type: string; content: unknown; activityId: string | null; createdAt: string }
): ChatStreamMessage | null {
  if (item.role === "user") {
    const text = readStoredConversationText(item.content);
    if (!text) return null;

    const structuredAction =
      item.type === "user_action" && isRecord(item.content) && typeof item.content.action === "string"
        ? {
            action: item.content.action,
            actionId: item.id,
            ...(isRecord(item.content.payload) ? { params: item.content.payload } : {}),
            ...(typeof item.content.source === "string" ? { source: item.content.source } : {}),
            displayText: text,
          }
        : undefined;

    return {
      id: item.id,
      role: "user",
      parts: [{ type: "text", text }],
      ...(structuredAction
        ? {
            metadata: {
              action: structuredAction.action,
              actionId: structuredAction.actionId,
              ...(structuredAction.params ? { params: structuredAction.params } : {}),
              ...(structuredAction.source ? { source: structuredAction.source } : {}),
              displayText: structuredAction.displayText,
            },
          }
        : {}),
    };
  }

  const response = buildEnvelopeFromStoredAssistantMessage({
    conversationId,
    messageId: item.id,
    content: item.content,
  });
  if (!response) return null;

  const parts: ChatStreamMessage["parts"] = [];
  for (const block of response.response.blocks) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.content });
    } else {
      parts.push({ type: "data-genui_block", data: { block, mode: "append" } });
    }
  }

  return {
    id: item.id,
    role: "assistant",
    parts,
    metadata: {
      traceId: response.traceId,
      conversationId: response.conversationId,
      responseId: response.response.responseId,
      status: response.response.status,
      suggestions: response.response.suggestions,
    },
  };
}

export function buildRecentMessages(messages: ChatStreamMessage[]): LocalGenUIRecentMessage[] {
  return messages
    .slice(-MAX_TRANSIENT_TURNS)
    .map((message): LocalGenUIRecentMessage | null => {
      const text = extractUIMessageText(message);
      if (!text) return null;

      if (message.role === "user") {
        const meta = message.metadata as
          | {
              action?: string;
              actionId?: string;
              params?: Record<string, unknown>;
              source?: string;
              displayText?: string;
            }
          | undefined;
        return {
          messageId: message.id,
          role: "user",
          text,
          ...(meta?.action
            ? {
                action: meta.action,
                actionId: meta.actionId || message.id,
                ...(meta.params ? { params: meta.params } : {}),
                ...(meta.source ? { source: meta.source } : {}),
                ...(meta.displayText ? { displayText: meta.displayText } : {}),
              }
            : {}),
        };
      }

      const envelope = buildEnvelopeFromStreamMessage(message);
      const primaryBlockType = resolvePrimaryBlockType(envelope.response.blocks);

      return {
        messageId: message.id,
        role: "assistant",
        text,
        ...(primaryBlockType !== undefined ? { primaryBlockType } : {}),
        ...(envelope.response.suggestions ? { suggestions: envelope.response.suggestions } : {}),
      };
    })
    .filter((turn): turn is LocalGenUIRecentMessage => Boolean(turn));
}

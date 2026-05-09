import type { ChatTransport, UIMessageChunk } from "ai";
import { readClientToken } from "@/lib/client-auth";
import type {
  GenUIBlock,
  GenUIInput,
  GenUIResponseEnvelope,
  GenUITextBlock,
} from "@/src/gen/genui-contract";
import {
  API_BASE,
  buildRecentMessages,
  createEmptyEnvelope,
  enqueueSimulatedTextDeltaChunks,
  isGenUIBlock,
  isGenUIResponseEnvelope,
  isRecord,
  normalizeChatErrorMessage,
  parseSSEPacket,
  randomId,
  readStreamEventData,
  type ActivityContextOverrides,
  type ChatStreamChunk,
  type ChatStreamDataTypes,
  type ChatStreamMessage,
  type ChatStreamMessageMetadata,
  type LocalGenUIRecentMessage,
  upsertBlockWithMode,
} from "./chat-core";

async function readChatResponseErrorMessage(response: Response): Promise<string> {
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

export interface XuChatTransportOptions {
  getClientLocation: () => { lat: number; lng: number } | null;
}

export function createXuChatTransport(
  options: XuChatTransportOptions
): ChatTransport<ChatStreamMessage> {
    async function doSendMessages(transportOptions: Parameters<ChatTransport<ChatStreamMessage>["sendMessages"]>[0]) {
      const {
        messages,
        abortSignal,
        body,
      } = transportOptions;

      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== "user") {
        throw new Error("No user message to send");
      }

      const textPart = lastMessage.parts.find((p) => p.type === "text");
      const displayText = textPart?.text?.trim() || "";

      const extraBody = body as
        | {
            action?: string;
            params?: Record<string, unknown>;
            contextOverrides?: ActivityContextOverrides;
            conversationId?: string | null;
          }
        | undefined;

      const input: GenUIInput = extraBody?.action
        ? {
            type: "action",
            action: extraBody.action,
            actionId: randomId("action"),
            params: extraBody.params,
            displayText,
          }
        : { type: "text", text: displayText };

      const effectiveAuthToken = readClientToken();
      const clientLocation = options.getClientLocation();
      const recentMessages = !effectiveAuthToken
        ? buildRecentMessages(messages)
        : undefined;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (effectiveAuthToken) {
        headers.Authorization = `Bearer ${effectiveAuthToken}`;
      }

      const response = await fetch(`${API_BASE}/ai/chat`, {
        method: "POST",
        headers,
        signal: abortSignal,
        body: JSON.stringify({
          ...(extraBody?.conversationId
            ? { conversationId: extraBody.conversationId }
            : {}),
          input,
          trace: false,
          context: {
            client: "web",
            locale: "zh-CN",
            timezone: "Asia/Shanghai",
            platformVersion: "web-vnext",
            ...(clientLocation
              ? { lat: clientLocation.lat, lng: clientLocation.lng }
              : {}),
            ...(recentMessages && recentMessages.length > 0
              ? { recentMessages }
              : {}),
            ...(extraBody?.contextOverrides || {}),
          },
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await readChatResponseErrorMessage(response));
      }

      // Build transformed stream: GenUI SSE -> UIMessageChunk
      const { body: responseBody } = response;

      return new ReadableStream<UIMessageChunk>({
        async start(controller) {
          const decoder = new TextDecoder();
          let buffer = "";
          let sawResponseComplete = false;

          const streamState: {
            metadata: ChatStreamMessageMetadata;
            started: boolean;
            textPartStarted: boolean;
            assistantText: string;
            textBlocks: GenUITextBlock[];
          } = {
            metadata: {
              traceId: randomId("trace"),
              conversationId:
                extraBody?.conversationId ?? randomId("conv"),
              responseId: randomId("turn"),
              status: "streaming",
            },
            started: false,
            textPartStarted: false,
            assistantText: "",
            textBlocks: [],
          };

          const assistantMessageId = lastMessage.id.startsWith("user_")
            ? lastMessage.id.replace("user_", "assistant_")
            : randomId("assistant");

          function enqueueChunk(chunk: ChatStreamChunk) {
            controller.enqueue(chunk as UIMessageChunk);
          }

          function startAssistantUiMessage() {
            if (streamState.started) return;
            enqueueChunk({
              type: "start",
              messageId: assistantMessageId,
              messageMetadata: streamState.metadata,
            });
            streamState.started = true;
          }

          function updateAssistantUiMetadata(
            patch: Partial<ChatStreamMessageMetadata>
          ) {
            streamState.metadata = { ...streamState.metadata, ...patch };
            startAssistantUiMessage();
            enqueueChunk({
              type: "message-metadata",
              messageMetadata: streamState.metadata,
            });
          }

          function ensureTextPartStarted() {
            if (streamState.textPartStarted) return;
            startAssistantUiMessage();
            enqueueChunk({
              type: "text-start",
              id: `${assistantMessageId}_text`,
            });
            streamState.textPartStarted = true;
          }

          async function syncAssistantTextBlock(
            block: GenUITextBlock,
            mode: "append" | "replace"
          ) {
            streamState.textBlocks = upsertBlockWithMode(
              streamState.textBlocks,
              block,
              mode
            ).blocks.filter((item): item is GenUITextBlock => item.type === "text");

            const nextAssistantText = streamState.textBlocks
              .map((item) => item.content)
              .filter(Boolean)
              .join("\n\n");

            if (nextAssistantText === streamState.assistantText) return;

            if (!nextAssistantText.startsWith(streamState.assistantText)) {
              streamState.assistantText = nextAssistantText;
              updateAssistantUiMetadata({
                assistantTextOverride: nextAssistantText,
              });
              return;
            }

            const deltaText = nextAssistantText.slice(
              streamState.assistantText.length
            );
            if (!deltaText) return;

            ensureTextPartStarted();
            await enqueueSimulatedTextDeltaChunks(enqueueChunk, {
              textPartId: `${assistantMessageId}_text`,
              deltaText,
            });
            streamState.assistantText = nextAssistantText;
          }

          function appendStructuredBlockToUiMessage(
            block: GenUIBlock,
            mode: "append" | "replace"
          ) {
            startAssistantUiMessage();
            enqueueChunk({
              type: "data-genui_block",
              id: block.blockId,
              data: { block, mode },
            } as ChatStreamChunk);
          }

          try {
            const reader = responseBody.getReader();

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });

              let separatorIndex = buffer.indexOf("\n\n");
              while (separatorIndex >= 0) {
                const packet = buffer.slice(0, separatorIndex);
                buffer = buffer.slice(separatorIndex + 2);

                const parsed = parseSSEPacket(packet);
                if (!parsed || !parsed.dataText) {
                  separatorIndex = buffer.indexOf("\n\n");
                  continue;
                }

                if (parsed.dataText === "[DONE]") {
                  separatorIndex = buffer.indexOf("\n\n");
                  continue;
                }

                let payload: unknown = parsed.dataText;
                try {
                  payload = JSON.parse(parsed.dataText);
                } catch {
                  payload = { raw: parsed.dataText };
                }

                const eventName =
                  isRecord(payload) && typeof payload.event === "string"
                    ? payload.event
                    : parsed.eventName;
                const eventData = readStreamEventData(payload);

                if (eventName === "response-start" && isRecord(eventData)) {
                  const traceId =
                    typeof eventData.traceId === "string"
                      ? eventData.traceId
                      : randomId("trace");
                  const streamConversationId =
                    typeof eventData.conversationId === "string"
                      ? eventData.conversationId
                      : extraBody?.conversationId ?? randomId("conv");
                  const responseId =
                    typeof eventData.responseId === "string"
                      ? eventData.responseId
                      : randomId("response");

                  updateAssistantUiMetadata({
                    traceId,
                    conversationId: streamConversationId,
                    responseId,
                    status: "streaming",
                    assistantTextOverride: undefined,
                  });
                }

                if (
                  (eventName === "block-append" ||
                    eventName === "block-replace") &&
                  isRecord(eventData) &&
                  isGenUIBlock(eventData.block)
                ) {
                  const block = eventData.block;
                  const mode =
                    eventName === "block-replace" ? "replace" : "append";
                  if (block.type === "text") {
                    await syncAssistantTextBlock(block, mode);
                  } else {
                    appendStructuredBlockToUiMessage(block, mode);
                  }
                }

                if (eventName === "response-status" && isRecord(eventData)) {
                  const statusText =
                    eventData.status === "streaming" ||
                    eventData.status === "completed" ||
                    eventData.status === "error"
                      ? eventData.status
                      : null;
                  if (statusText) {
                    updateAssistantUiMetadata({ status: statusText });
                  }
                }

                if (
                  eventName === "response-complete" &&
                  isGenUIResponseEnvelope(eventData)
                ) {
                  const completeEnvelope = eventData;
                  sawResponseComplete = true;

                  updateAssistantUiMetadata({
                    traceId: completeEnvelope.traceId,
                    conversationId: completeEnvelope.conversationId,
                    responseId: completeEnvelope.response.responseId,
                    status: completeEnvelope.response.status,
                    suggestions: completeEnvelope.response.suggestions,
                  });

                  const finalAssistantText = completeEnvelope.response.blocks
                    .filter(
                      (block): block is GenUITextBlock =>
                        block.type === "text"
                    )
                    .map((block) => block.content)
                    .filter(Boolean)
                    .join("\n\n");

                  if (
                    finalAssistantText &&
                    finalAssistantText !== streamState.assistantText
                  ) {
                    if (
                      finalAssistantText.startsWith(
                        streamState.assistantText
                      )
                    ) {
                      ensureTextPartStarted();
                      await enqueueSimulatedTextDeltaChunks(enqueueChunk, {
                        textPartId: `${assistantMessageId}_text`,
                        deltaText: finalAssistantText.slice(
                          streamState.assistantText.length
                        ),
                      });
                    } else {
                      updateAssistantUiMetadata({
                        assistantTextOverride: finalAssistantText,
                      });
                    }
                    streamState.assistantText = finalAssistantText;
                  }
                }

                if (eventName === "response-error" && isRecord(eventData)) {
                  const message =
                    typeof eventData.message === "string"
                      ? normalizeChatErrorMessage(eventData.message)
                      : "生成失败，请稍后再试";
                  throw new Error(message);
                }

                separatorIndex = buffer.indexOf("\n\n");
              }
            }

            if (!sawResponseComplete) {
              updateAssistantUiMetadata({ status: "completed" });
            }

            if (streamState.textPartStarted) {
              enqueueChunk({
                type: "text-end",
                id: `${assistantMessageId}_text`,
              });
            }
            startAssistantUiMessage();
            enqueueChunk({
              type: "finish",
              finishReason: "stop",
              messageMetadata: streamState.metadata,
            });
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
    }

  return {
    async sendMessages(transportOptions) {
      return doSendMessages(transportOptions);
    },
    async reconnectToStream(_transportOptions) {
      return new ReadableStream({
        start(controller) {
          controller.error(new Error("Stream reconnection not supported"));
        },
      });
    },
  };
}

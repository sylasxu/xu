import { useChat } from "@ai-sdk/react";
import { useCallback, useMemo, useRef, useState } from "react";
import type {
  GenUIBlock,
  GenUIResponseEnvelope,
} from "@/src/gen/genui-contract";
import {
  buildEnvelopeFromStreamMessage,
  randomId,
  type ActionOption,
  type ActivityContextOverrides,
  type ChatStreamMessage,
} from "./chat-core";
import { createXuChatTransport } from "./xu-chat-transport";

export type ComposerStatus = "ready" | "submitted";

export interface UseXuChatOptions {
  getClientLocation: () => { lat: number; lng: number } | null;
  onFinish?: (envelope: GenUIResponseEnvelope) => void;
  onError?: (error: Error) => void;
}

export function useXuChat(options: UseXuChatOptions) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const onFinishRef = useRef(options.onFinish);
  const onErrorRef = useRef(options.onError);
  onFinishRef.current = options.onFinish;
  onErrorRef.current = options.onError;

  const transport = useMemo(
    () =>
      createXuChatTransport({
        getClientLocation: options.getClientLocation,
      }),
    [options.getClientLocation]
  );

  const chat = useChat<ChatStreamMessage>({
    transport,
    onFinish: (event) => {
      const responseMessage = event.message;
      if (responseMessage.metadata?.conversationId) {
        setConversationId(responseMessage.metadata.conversationId);
      }
      const envelope = buildEnvelopeFromStreamMessage(responseMessage);
      onFinishRef.current?.(envelope);
    },
    onError: (error) => {
      onErrorRef.current?.(error);
    },
  });

  const isSending =
    chat.status === "submitted" || chat.status === "streaming";

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setInput(event.target.value);
    },
    []
  );

  const handleSubmit = useCallback(
    async (event?: { preventDefault?: () => void }) => {
      event?.preventDefault?.();
      const value = input.trim();
      if (!value || isSending) return;

      setInput("");
      await chat.sendMessage(
        { text: value },
        {
          body: {
            conversationId,
          },
        }
      );
    },
    [chat, input, isSending, conversationId]
  );

  const sendAction = useCallback(
    async (
      option: ActionOption,
      contextOverrides?: ActivityContextOverrides
    ) => {
      if (isSending) return;

      await chat.sendMessage(
        {
          text: option.label,
          metadata: {
            action: option.action,
            params: option.params,
            displayText: option.label,
          },
        },
        {
          body: {
            action: option.action,
            params: option.params,
            conversationId,
            contextOverrides,
          },
        }
      );
    },
    [chat, isSending, conversationId]
  );

  const sendText = useCallback(
    async (text: string, contextOverrides?: ActivityContextOverrides) => {
      if (isSending || !text.trim()) return;

      setInput("");
      await chat.sendMessage(
        { text },
        {
          body: {
            conversationId,
            contextOverrides,
          },
        }
      );
    },
    [chat, isSending, conversationId]
  );

  const startNewConversation = useCallback(() => {
    if (isSending) return;
    chat.setMessages([]);
    setConversationId(null);
    setInput("");
  }, [chat, isSending]);

  const selectConversation = useCallback(
    (messages: ChatStreamMessage[], targetConversationId: string) => {
      chat.setMessages(messages);
      setConversationId(targetConversationId);
      setInput("");
    },
    [chat]
  );

  const lastAssistantEnvelope: GenUIResponseEnvelope | undefined =
    useMemo(() => {
      const lastMsg = chat.messages[chat.messages.length - 1];
      if (lastMsg?.role === "assistant") {
        return buildEnvelopeFromStreamMessage(lastMsg);
      }
      return undefined;
    }, [chat.messages]);

  return {
    // From useChat
    messages: chat.messages,
    status: chat.status as ComposerStatus | "streaming" | "error",
    error: chat.error,
    setMessages: chat.setMessages,
    stop: chat.stop,
    regenerate: chat.regenerate,

    // Input management
    input,
    setInput,
    handleInputChange,
    handleSubmit,

    // Conversation
    conversationId,

    // Send helpers
    sendAction,
    sendText,
    startNewConversation,
    selectConversation,

    // Derived
    isSending,
    lastAssistantEnvelope,
  };
}

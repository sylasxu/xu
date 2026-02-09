"use client";

import * as React from "react";

/* -------------------------------------------------------------------------- */
/*  PromptInput – chat input bar with textarea + submit button                */
/*  API modelled after AI SDK Elements (https://elements.ai-sdk.dev)          */
/* -------------------------------------------------------------------------- */

interface PromptInputProps extends React.HTMLAttributes<HTMLFormElement> {
  /** Called when the user submits the prompt (Enter key or button click). */
  onSubmit?: () => void;
  children: React.ReactNode;
}

/**
 * Form wrapper for the chat input area.
 * Intercepts native form submission and delegates to `onSubmit`.
 */
export function PromptInput({
  onSubmit,
  children,
  className = "",
  ...props
}: PromptInputProps) {
  const handleSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit?.();
    },
    [onSubmit],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex items-end gap-2 ${className}`}
      {...props}
    >
      {children}
    </form>
  );
}

/* -------------------------------------------------------------------------- */

interface PromptInputTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

/**
 * Auto-growing textarea for composing a message.
 * Submits on Enter (without Shift) for a chat-like UX.
 */
export const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  PromptInputTextareaProps
>(function PromptInputTextarea({ className = "", onKeyDown, ...props }, ref) {
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Enter (without Shift for newline)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
      onKeyDown?.(e);
    },
    [onKeyDown],
  );

  return (
    <textarea
      ref={ref}
      rows={1}
      onKeyDown={handleKeyDown}
      className={`max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${className}`}
      {...props}
    />
  );
});

/* -------------------------------------------------------------------------- */

type PromptInputStatus = "ready" | "streaming";

interface PromptInputSubmitProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Current chat status – shows a stop icon when streaming. */
  status?: PromptInputStatus;
}

/**
 * Submit button that adapts its icon based on the chat status.
 *
 * - `ready`     → send arrow icon
 * - `streaming` → stop square icon
 */
export const PromptInputSubmit = React.forwardRef<
  HTMLButtonElement,
  PromptInputSubmitProps
>(function PromptInputSubmit(
  { status = "ready", className = "", disabled, ...props },
  ref,
) {
  const isStreaming = status === "streaming";

  return (
    <button
      ref={ref}
      type="submit"
      disabled={disabled}
      aria-label={isStreaming ? "停止生成" : "发送消息"}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
        disabled
          ? "cursor-not-allowed bg-gray-200 text-gray-400"
          : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
      } ${className}`}
      {...props}
    >
      {isStreaming ? (
        /* Stop icon */
        <svg
          className="h-4 w-4"
          viewBox="0 0 16 16"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="3" y="3" width="10" height="10" rx="1" />
        </svg>
      ) : (
        /* Send arrow icon */
        <svg
          className="h-4 w-4"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 13L13 8L3 3V7L9 8L3 9V13Z"
            fill="currentColor"
          />
        </svg>
      )}
    </button>
  );
});

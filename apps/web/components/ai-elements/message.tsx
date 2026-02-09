"use client";

import * as React from "react";

/* -------------------------------------------------------------------------- */
/*  Message – a single chat bubble (user or assistant)                        */
/*  API modelled after AI SDK Elements (https://elements.ai-sdk.dev)          */
/* -------------------------------------------------------------------------- */

type MessageRole = "user" | "assistant";

interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Who sent the message – controls alignment and styling. */
  from: MessageRole;
  children: React.ReactNode;
}

/**
 * A chat message row.
 *
 * - `from="user"` → right-aligned, primary background
 * - `from="assistant"` → left-aligned, muted background
 */
export function Message({
  from,
  children,
  className = "",
  ...props
}: MessageProps) {
  const isUser = from === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} ${className}`}
      {...props}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface MessageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Wrapper for the textual content inside a `<Message>`.
 * Handles prose-like rendering (whitespace, line breaks, etc.).
 */
export function MessageContent({
  children,
  className = "",
  ...props
}: MessageContentProps) {
  return (
    <div className={`whitespace-pre-wrap break-words ${className}`} {...props}>
      {children}
    </div>
  );
}

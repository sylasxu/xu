"use client";

import * as React from "react";

/* -------------------------------------------------------------------------- */
/*  Conversation – container for a list of chat messages                      */
/*  API modelled after AI SDK Elements (https://elements.ai-sdk.dev)          */
/* -------------------------------------------------------------------------- */

interface ConversationProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Root wrapper that provides scroll context for a chat conversation.
 * Renders a flex column that fills its parent and scrolls vertically.
 */
export function Conversation({
  children,
  className = "",
  ...props
}: ConversationProps) {
  return (
    <div
      className={`flex flex-1 flex-col overflow-y-auto ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface ConversationContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Inner content area that holds the message list.
 * Applies consistent padding and spacing between messages.
 */
export function ConversationContent({
  children,
  className = "",
  ...props
}: ConversationContentProps) {
  return (
    <div
      className={`flex flex-1 flex-col gap-4 p-4 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

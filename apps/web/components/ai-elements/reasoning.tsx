"use client";

import * as React from "react";

/* -------------------------------------------------------------------------- */
/*  Reasoning – collapsible "thinking" block for AI chain-of-thought          */
/*  API modelled after AI SDK Elements (https://elements.ai-sdk.dev)          */
/* -------------------------------------------------------------------------- */

interface ReasoningProps extends React.DetailsHTMLAttributes<HTMLDetailsElement> {
  children: React.ReactNode;
}

/**
 * Root container for a collapsible reasoning / thinking section.
 * Manages open/closed state internally via a `<details>` element.
 */
export function Reasoning({
  children,
  className = "",
  ...props
}: ReasoningProps) {
  return (
    <details
      className={`group rounded-lg border border-gray-200 bg-gray-50 ${className}`}
      {...props}
    >
      {children}
    </details>
  );
}

/* -------------------------------------------------------------------------- */

interface ReasoningTriggerProps
  extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}

/**
 * The clickable summary that toggles the reasoning block open/closed.
 * Defaults to "思考过程" when no children are provided.
 */
export function ReasoningTrigger({
  children,
  className = "",
  ...props
}: ReasoningTriggerProps) {
  return (
    <summary
      className={`flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 ${className}`}
      {...props}
    >
      <svg
        className="h-3 w-3 transition-transform group-open:rotate-90"
        viewBox="0 0 12 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M4.5 2.5L8.5 6L4.5 9.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children ?? "思考过程"}
    </summary>
  );
}

/* -------------------------------------------------------------------------- */

interface ReasoningContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * The collapsible body that displays the reasoning text.
 */
export function ReasoningContent({
  children,
  className = "",
  ...props
}: ReasoningContentProps) {
  return (
    <div
      className={`whitespace-pre-wrap border-t border-gray-200 px-3 py-2 text-xs leading-relaxed text-gray-600 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

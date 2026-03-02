"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Lightbulb } from "lucide-react";

/**
 * Reasoning - AI SDK Elements
 * 
 * 显示 AI 推理/思考过程的折叠面板
 * @see https://elements.ai-sdk.dev/docs/components/reasoning
 */

interface ReasoningProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Reasoning 根组件
 * 容器组件
 */
const Reasoning = React.forwardRef<HTMLDivElement, ReasoningProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-1", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Reasoning.displayName = "Reasoning";

interface ReasoningTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isOpen?: boolean;
}

/**
 * ReasoningTrigger - 触发按钮
 * 点击展开/折叠思考过程
 */
const ReasoningTrigger = React.forwardRef<HTMLButtonElement, ReasoningTriggerProps>(
  ({ isOpen, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "flex items-center gap-1.5 rounded-lg bg-gray-50 px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100",
          className
        )}
        {...props}
      >
        <Lightbulb className="h-3 w-3" />
        <span>{children || "思考过程"}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>
    );
  }
);
ReasoningTrigger.displayName = "ReasoningTrigger";

interface ReasoningContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  isOpen?: boolean;
}

/**
 * ReasoningContent - 思考内容
 * 可折叠的内容区域
 */
const ReasoningContent = React.forwardRef<HTMLDivElement, ReasoningContentProps>(
  ({ isOpen, children, className, ...props }, ref) => {
    if (!isOpen) return null;

    return (
      <div
        ref={ref}
        className={cn(
          "overflow-hidden rounded-lg bg-gray-50 p-2 text-xs text-gray-600",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ReasoningContent.displayName = "ReasoningContent";

export {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
};

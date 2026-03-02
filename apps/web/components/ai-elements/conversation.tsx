"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Conversation - AI SDK Elements
 * 
 * 对话容器组件，提供滚动上下文和布局结构
 * @see https://elements.ai-sdk.dev/docs/components/conversation
 */

interface ConversationProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Conversation 根组件
 * 提供滚动容器和 flex 布局
 */
const Conversation = React.forwardRef<HTMLDivElement, ConversationProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-1 flex-col overflow-y-auto scroll-smooth",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Conversation.displayName = "Conversation";

interface ConversationContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * ConversationContent - 对话内容包装器
 * 提供统一的内边距和间距
 */
const ConversationContent = React.forwardRef<HTMLDivElement, ConversationContentProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-1 flex-col gap-4 p-4",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ConversationContent.displayName = "ConversationContent";

interface ConversationEmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * ConversationEmpty - 空状态展示
 * 当没有消息时显示的内容
 */
const ConversationEmpty = React.forwardRef<HTMLDivElement, ConversationEmptyProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex min-h-[60vh] flex-col items-center justify-center px-6 py-12",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ConversationEmpty.displayName = "ConversationEmpty";

export {
  Conversation,
  ConversationContent,
  ConversationEmpty,
};

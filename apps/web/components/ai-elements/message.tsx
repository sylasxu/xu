"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Message - AI SDK Elements
 * 
 * 消息气泡组件，支持用户和助手两种角色
 * @see https://elements.ai-sdk.dev/docs/components/message
 */

type MessageRole = "user" | "assistant" | "system" | "data";

interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  role: MessageRole;
  children: React.ReactNode;
}

/**
 * Message 根组件
 * 控制消息的整体布局（左对齐或右对齐）
 */
const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  ({ role, children, className, ...props }, ref) => {
    const isUser = role === "user";

    return (
      <div
        ref={ref}
        className={cn(
          "flex w-full",
          isUser ? "justify-end" : "justify-start",
          className
        )}
        {...props}
      >
        <div
          className={cn(
            "flex max-w-[85%] gap-3",
            isUser ? "flex-row-reverse" : "flex-row"
          )}
        >
          {children}
        </div>
      </div>
    );
  }
);
Message.displayName = "Message";

interface MessageAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  children?: React.ReactNode;
}

/**
 * MessageAvatar - 消息头像
 * 显示发送者头像
 */
const MessageAvatar = React.forwardRef<HTMLDivElement, MessageAvatarProps>(
  ({ src, alt, fallback, children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full",
          className
        )}
        {...props}
      >
        {src ? (
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-xs font-bold text-white">
            {fallback || children}
          </div>
        )}
      </div>
    );
  }
);
MessageAvatar.displayName = "MessageAvatar";

interface MessageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  role: MessageRole;
}

/**
 * MessageContent - 消息内容
 * 包含气泡样式和文本内容
 */
const MessageContent = React.forwardRef<HTMLDivElement, MessageContentProps>(
  ({ children, role, className, ...props }, ref) => {
    const isUser = role === "user";

    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
      >
        <div
          className={cn(
            "relative rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "rounded-tr-sm bg-zinc-900 text-white"
              : "rounded-tl-sm bg-zinc-100 text-zinc-900",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  }
);
MessageContent.displayName = "MessageContent";

interface MessageFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * MessageFooter - 消息底部
 * 用于显示时间戳、状态等
 */
const MessageFooter = React.forwardRef<HTMLDivElement, MessageFooterProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn("text-[10px] text-zinc-400", className)}
        {...props}
      >
        {children}
      </span>
    );
  }
);
MessageFooter.displayName = "MessageFooter";

export {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  type MessageRole,
};

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * PromptInput - AI SDK Elements
 * 
 * 输入框组件，支持多行文本、自动调整高度
 * @see https://elements.ai-sdk.dev/docs/components/prompt-input
 */

interface PromptInputProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: React.ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
}

/**
 * PromptInput 根组件
 * 表单容器，处理提交事件
 */
const PromptInput = React.forwardRef<HTMLFormElement, PromptInputProps>(
  ({ children, onSubmit, className, ...props }, ref) => {
    const handleSubmit = React.useCallback(
      (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit?.(e);
      },
      [onSubmit]
    );

    return (
      <form
        ref={ref}
        onSubmit={handleSubmit}
        className={cn(
          "flex w-full items-end gap-2 rounded-[20px] border border-zinc-200 bg-white px-2 py-2 shadow-[0_8px_20px_-20px_rgba(24,24,27,0.35)] outline-none transition-all duration-150 focus-within:border-zinc-300 focus-within:shadow-[0_10px_24px_-22px_rgba(24,24,27,0.25)] focus-within:outline-none",
          className
        )}
        {...props}
      >
        {children}
      </form>
    );
  }
);
PromptInput.displayName = "PromptInput";

interface PromptInputTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

/**
 * PromptInputTextarea - 输入文本框
 * 支持多行、自动调整高度
 */
const PromptInputTextarea = React.forwardRef<
  HTMLTextAreaElement,
  PromptInputTextareaProps
>(
  (
    { className, onChange, onKeyDown, rows = 1, value, ...props },
    ref
  ) => {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    // 合并 ref
    React.useImperativeHandle(ref, () => textareaRef.current!);

    // 自动调整高度
    const adjustHeight = React.useCallback(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
      }
    }, []);

    const handleChange = React.useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(e);
        adjustHeight();
      },
      [onChange, adjustHeight]
    );

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter 发送（不带 Shift）
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }
        onKeyDown?.(e);
      },
      [onKeyDown]
    );

    React.useEffect(() => {
      adjustHeight();
    }, [value, adjustHeight]);

    return (
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        style={{ minHeight: "42px", maxHeight: "160px" }}
        {...props}
      />
    );
  }
);
PromptInputTextarea.displayName = "PromptInputTextarea";

interface PromptInputSubmitProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
}

/**
 * PromptInputSubmit - 提交按钮
 * 根据 loading 状态显示不同图标
 */
const PromptInputSubmit = React.forwardRef<
  HTMLButtonElement,
  PromptInputSubmitProps
>(
  ({ isLoading, className, children, ...props }, ref) => {
    const isDisabled = Boolean(props.disabled);

    return (
      <button
        ref={ref}
        type="submit"
        disabled={isDisabled}
        aria-busy={isLoading || undefined}
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent transition-all duration-200",
          isLoading
            ? "bg-zinc-800 text-white"
            : "bg-zinc-900 text-white hover:bg-black active:scale-95",
          "disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:shadow-none",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
PromptInputSubmit.displayName = "PromptInputSubmit";

export {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
};

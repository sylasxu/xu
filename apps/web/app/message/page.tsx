"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996";

interface ConversationItem {
  id: string;
  title: string | null;
  messageCount: number;
  lastMessageAt: string;
  hasError?: boolean;
}

interface ConversationsResponse {
  items?: unknown[];
}

export default function MessagePage() {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/ai/conversations?scope=mine&limit=20`, {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (response.status === 401) {
        setItems([]);
        setError("请先登录后查看消息中心");
        return;
      }

      if (!response.ok) {
        throw new Error(`request failed: ${response.status}`);
      }

      const payload = (await response.json()) as ConversationsResponse;
      const nextItems = normalizeConversations(payload);
      setItems(nextItems);
    } catch {
      setItems([]);
      setError("消息加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="mx-auto min-h-screen w-full max-w-[430px] border-x border-zinc-200 bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur-sm">
        <div className="mx-auto grid max-w-2xl grid-cols-[32px_1fr_32px] items-center">
          <Link
            href="/chat"
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="返回聊天"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-center text-sm font-semibold tracking-[0.04em] text-zinc-900">
            消息中心
          </h1>
          <button
            onClick={() => void loadConversations()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="刷新"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl p-4">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="h-4 w-40 animate-pulse rounded bg-zinc-200" />
                <div className="mt-2 h-3 w-24 animate-pulse rounded bg-zinc-100" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
            暂无消息记录
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <Link
                key={item.id}
                href="/chat"
                className="block rounded-xl border border-zinc-200 bg-white p-3 transition-colors hover:border-zinc-400"
              >
                <div className="text-sm font-medium text-zinc-900">
                  {item.title?.trim() || "未命名对话"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {item.messageCount} 条消息 · {formatTime(item.lastMessageAt)}
                  {item.hasError ? " · 异常" : ""}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      </div>
    </div>
  );
}

function normalizeConversations(payload: ConversationsResponse): ConversationItem[] {
  if (!Array.isArray(payload.items)) return [];

  return payload.items.reduce<ConversationItem[]>((acc, item) => {
    if (!isRecord(item) || typeof item.id !== "string") return acc;
    if (typeof item.lastMessageAt !== "string") return acc;

    acc.push({
      id: item.id,
      title: typeof item.title === "string" ? item.title : null,
      messageCount: typeof item.messageCount === "number" ? item.messageCount : 0,
      lastMessageAt: item.lastMessageAt,
      hasError: Boolean(item.hasError),
    });

    return acc;
  }, []);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

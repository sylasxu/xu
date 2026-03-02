"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  MapPin,
  Calendar,
  Users,
  CheckCircle,
  ChevronRight,
  Loader2,
} from "lucide-react";

/**
 * ToolInvocation - AI SDK Elements
 * 
 * 显示 AI 工具调用及其结果的组件
 * 这是生成式 UI (Generative UI) 的核心
 */

export interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  state: "call" | "partial-call" | "result";
}

interface ToolInvocationProps {
  toolInvocation: ToolInvocation;
}

/**
 * ToolInvocation 组件
 * 根据工具类型渲染不同的 UI
 */
function ToolInvocationCard({ toolInvocation }: ToolInvocationProps) {
  const { toolName, args, result, state } = toolInvocation;
  const isComplete = state === "result";

  switch (toolName) {
    case "createActivityDraft":
      return (
        <DraftToolCard
          args={args}
          result={result}
          isComplete={isComplete}
        />
      );
    case "exploreNearby":
      return (
        <ExploreToolCard
          args={args}
          result={result}
          isComplete={isComplete}
        />
      );
    case "publishActivity":
      return (
        <PublishToolCard
          args={args}
          result={result}
          isComplete={isComplete}
        />
      );
    default:
      return (
        <GenericToolCard
          toolName={toolName}
          args={args}
          result={result}
          isComplete={isComplete}
        />
      );
  }
}

// ============ 具体工具卡片 ============

interface ToolCardProps {
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  isComplete: boolean;
}

function DraftToolCard({ args, result, isComplete }: ToolCardProps) {
  const draft = (result?.draft || args) as {
    title: string;
    locationName: string;
    startAt: string;
    type: string;
    maxParticipants: number;
  };

  if (!isComplete) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100/80 p-3">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
        <span className="text-xs text-zinc-700">正在创建活动草稿...</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      {/* 地图区域 */}
      <div className="relative h-24 bg-gradient-to-br from-zinc-100 to-zinc-200">
        <div className="absolute inset-0 flex items-center justify-center">
          <MapPin className="h-8 w-8 text-zinc-400" />
        </div>
        <div className="absolute left-3 top-3">
          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-gray-700">
            {getActivityTypeLabel(draft.type)}
          </span>
        </div>
      </div>

      {/* 内容 */}
      <div className="p-3">
        <h4 className="font-semibold text-gray-900">{draft.title}</h4>

        <div className="mt-2 space-y-1 text-xs text-gray-600">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3 text-gray-400" />
            {formatDateChinese(draft.startAt)}
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3 text-gray-400" />
            {draft.locationName}
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 text-gray-400" />
            最多 {draft.maxParticipants} 人
          </div>
        </div>

        <button className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-zinc-900 py-2 text-xs font-medium text-white hover:bg-black">
          <CheckCircle className="h-3.5 w-3.5" />
          确认发布
        </button>
      </div>
    </motion.div>
  );
}

function ExploreToolCard({ result, isComplete }: ToolCardProps) {
  const activities = (result?.activities || []) as Array<{
    id: string;
    title: string;
    type: string;
    locationName: string;
    distance: number;
    startAt: string;
    currentParticipants: number;
    maxParticipants: number;
  }>;

  if (!isComplete) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100/80 p-3">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
        <span className="text-xs text-zinc-700">正在搜索附近活动...</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="border-b border-gray-100 bg-gray-50/50 px-3 py-2">
        <span className="text-xs font-medium text-gray-600">
          找到 {activities.length} 个附近活动
        </span>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {activities.slice(0, 5).map((activity, index) => (
          <motion.div
            key={activity.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="flex cursor-pointer items-center gap-3 border-b border-gray-100 p-3 last:border-0 hover:bg-zinc-50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-lg">
              {getActivityEmoji(activity.type)}
            </div>
            <div className="min-w-0 flex-1">
              <h5 className="truncate text-sm font-medium text-gray-900">
                {activity.title}
              </h5>
              <p className="text-xs text-gray-500">
                {activity.distance < 1000
                  ? `${activity.distance}m`
                  : `${(activity.distance / 1000).toFixed(1)}km`}{" "}
                · {formatDateChinese(activity.startAt)}
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Users className="h-3 w-3" />
              {activity.currentParticipants}/{activity.maxParticipants}
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function PublishToolCard({ result, isComplete }: ToolCardProps) {
  const [copied, setCopied] = React.useState(false);
  const shareUrl = (result?.shareUrl as string) || "";

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (!isComplete) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-100/80 p-3">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
        <span className="text-xs text-zinc-700">正在发布活动...</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-zinc-100 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800">
          <CheckCircle className="h-3 w-3 text-white" />
        </div>
        <span className="text-sm font-medium text-zinc-800">发布成功！</span>
      </div>

      {shareUrl && (
        <button
          onClick={handleCopy}
          className={cn(
            "w-full rounded-lg py-2 text-xs font-medium transition-colors",
            copied
              ? "bg-zinc-800 text-white"
              : "bg-zinc-900 text-white hover:bg-black"
          )}
        >
          {copied ? "已复制链接" : "复制分享链接"}
        </button>
      )}
    </motion.div>
  );
}

function GenericToolCard({
  toolName,
  args,
  result,
  isComplete,
}: {
  toolName: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  isComplete: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            isComplete ? "bg-zinc-700" : "bg-zinc-500 animate-pulse"
          )}
        />
        <span className="text-xs font-medium text-gray-700">{toolName}</span>
      </div>
      {isComplete && result && (
        <pre className="mt-2 max-h-20 overflow-auto rounded bg-gray-100 p-2 text-[10px] text-gray-600">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ============ 工具函数 ============

function getActivityTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    food: "🍜 美食",
    entertainment: "🎉 娱乐",
    sports: "⚽ 运动",
    boardgame: "🎲 桌游",
    other: "✨ 其他",
  };
  return labels[type] || "✨ 活动";
}

function getActivityEmoji(type: string): string {
  const emojis: Record<string, string> = {
    food: "🍜",
    entertainment: "🎉",
    sports: "⚽",
    boardgame: "🎲",
    other: "✨",
  };
  return emojis[type] || "✨";
}

function formatDateChinese(dateStr: string): string {
  const date = new Date(dateStr);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = weekdays[date.getDay()];
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${weekday} ${hours}:${minutes}`;
}

export {
  ToolInvocationCard,
};

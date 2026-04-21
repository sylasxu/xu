"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type HomeState = "H1" | "H2" | "H3" | "H4";

export type HomeStateTaskAction = {
  kind: "structured_action" | "navigate" | "switch_tab";
  label: string;
  action?: string;
  payload?: Record<string, unknown>;
  source?: string;
  originalText?: string;
  url?: string;
};

export type HomeStateTaskSnapshot = {
  id: string;
  taskType: "join_activity" | "find_partner" | "create_activity";
  taskTypeLabel: string;
  currentStage: string;
  stageLabel: string;
  status: string;
  goalText: string;
  headline: string;
  summary: string;
  updatedAt: string;
  activityId?: string;
  activityTitle?: string;
  primaryAction?: HomeStateTaskAction;
  secondaryAction?: HomeStateTaskAction;
};

type HomeStateCardProps = {
  task: HomeStateTaskSnapshot;
  homeState: HomeState;
  isDarkMode: boolean;
  disabled?: boolean;
  onAction: (action: HomeStateTaskAction) => void;
};

function getCardStyles(homeState: HomeState, isDarkMode: boolean) {
  switch (homeState) {
    case "H3":
      return isDarkMode
        ? "border-white/14 bg-white/[0.05] shadow-[0_24px_40px_-28px_rgba(0,0,0,0.82)]"
        : "border-black/14 bg-white shadow-[0_22px_40px_-28px_rgba(0,0,0,0.16)]";
    case "H1":
      return isDarkMode
        ? "border-white/10 bg-white/[0.04] shadow-[0_20px_36px_-30px_rgba(0,0,0,0.78)]"
        : "border-black/10 bg-white shadow-[0_18px_36px_-30px_rgba(0,0,0,0.14)]";
    case "H4":
      return isDarkMode
        ? "border-white/6 bg-white/[0.02]"
        : "border-black/6 bg-white/[0.98]";
    default:
      return isDarkMode
        ? "border-white/8 bg-white/[0.03]"
        : "border-black/8 bg-white shadow-[0_18px_36px_-30px_rgba(0,0,0,0.12)]";
  }
}

function getPrimaryButtonStyles(homeState: HomeState, isDarkMode: boolean) {
  if (homeState === "H4") {
    return isDarkMode
      ? "border-white/10 bg-white/[0.03] text-white/80 hover:bg-white/[0.05]"
      : "border-black/10 bg-white text-black/76 hover:bg-black/[0.045]";
  }
  return isDarkMode
    ? "bg-white text-[#111111] hover:bg-white/92"
    : "bg-black text-white hover:bg-black/92";
}

function getHeadlineOpacity(homeState: HomeState, isDarkMode: boolean) {
  if (homeState === "H4") {
    return isDarkMode ? "text-white/72" : "text-black/64";
  }
  return isDarkMode ? "text-white/88" : "text-black/84";
}

function getSummaryOpacity(homeState: HomeState, isDarkMode: boolean) {
  if (homeState === "H4") {
    return isDarkMode ? "text-white/52" : "text-black/48";
  }
  return isDarkMode ? "text-white/66" : "text-black/62";
}

function getMetaOpacity(homeState: HomeState, isDarkMode: boolean) {
  if (homeState === "H4") {
    return isDarkMode ? "text-white/38" : "text-black/36";
  }
  return isDarkMode ? "text-white/44" : "text-black/42";
}

function getStageBadgeStyles(homeState: HomeState, isDarkMode: boolean) {
  if (homeState === "H3") {
    return isDarkMode
      ? "border-white/10 bg-white/[0.06] text-white/72"
      : "border-black/10 bg-black/[0.04] text-black/68";
  }
  if (homeState === "H4") {
    return isDarkMode
      ? "border-white/6 bg-white/[0.02] text-white/42"
      : "border-black/6 bg-black/[0.02] text-black/40";
  }
  return isDarkMode
    ? "border-white/8 bg-white/[0.03] text-white/52"
    : "border-black/8 bg-white text-black/48";
}

export function HomeStateCard({ task, homeState, isDarkMode, disabled, onAction }: HomeStateCardProps) {
  const handleCardClick = () => {
    if (disabled || !task.primaryAction) return;
    onAction(task.primaryAction);
  };

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[348px] rounded-[24px] border px-5 py-4 text-left transition-all",
        getCardStyles(homeState, isDarkMode)
      )}
    >
      {/* H1 顶部提示条 */}
      {homeState === "H1" && (
        <div
          className={cn(
            "mb-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
            isDarkMode
              ? "border-amber-500/20 bg-amber-500/8 text-amber-400/80"
              : "border-amber-500/20 bg-amber-50 text-amber-700"
          )}
        >
          <span className={cn("h-1 w-1 rounded-full", isDarkMode ? "bg-amber-400/60" : "bg-amber-500")} />
          上次到这步被打断了
        </div>
      )}

      {/* 顶部元信息行 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* H3 urgency 指示点 */}
          {homeState === "H3" && (
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                isDarkMode ? "bg-white/70" : "bg-black/60"
              )}
            />
          )}
          <p className={cn("text-[11px] font-medium tracking-wide", getMetaOpacity(homeState, isDarkMode))}>
            {task.taskTypeLabel}
            {task.activityTitle ? ` · ${task.activityTitle}` : null}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            getStageBadgeStyles(homeState, isDarkMode)
          )}
        >
          {task.stageLabel}
        </span>
      </div>

      {/* 标题 */}
      <h3
        className={cn(
          "mt-2 text-[17px] font-semibold leading-snug tracking-[-0.02em]",
          getHeadlineOpacity(homeState, isDarkMode)
        )}
      >
        {task.headline}
      </h3>

      {/* 描述 */}
      <p className={cn("mt-2 text-sm leading-relaxed", getSummaryOpacity(homeState, isDarkMode))}>
        {task.summary}
      </p>

      {/* 动作按钮 */}
      {(task.primaryAction || task.secondaryAction) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {task.primaryAction && (
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onAction(task.primaryAction!);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-45",
                getPrimaryButtonStyles(homeState, isDarkMode)
              )}
            >
              {task.primaryAction.label}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
          {task.secondaryAction && (
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onAction(task.secondaryAction!);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-45",
                isDarkMode
                  ? "border-white/10 bg-white/[0.03] text-white/72 hover:bg-white/[0.05]"
                  : "border-black/10 bg-white text-black/68 hover:bg-black/[0.03]"
              )}
            >
              {task.secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

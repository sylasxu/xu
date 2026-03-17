/**
 * ToolCallsTimeline Component
 *
 * 以时间线形式展示每个 Tool 的名称、输入参数、返回结果和执行耗时
 * 点击可展开完整的输入输出 JSON
 */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { TOOL_DISPLAY_NAMES, formatDuration } from '../../types/trace'
import type { TraceStep } from '../../types/trace'
import { JsonViewer } from '../shared/json-viewer'

interface ToolCallsTimelineProps {
  steps: TraceStep[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function ToolCallsTimeline({ steps }: ToolCallsTimelineProps) {
  const toolSteps = steps.filter(s => s.type === 'tool')

  if (toolSteps.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        本轮无 Tool 调用
      </div>
    )
  }

  return (
    <div className="space-y-0 p-4">
      <h3 className="text-sm font-medium mb-3">Tool Calls 时间线</h3>
      <div className="relative ml-3 border-l border-muted-foreground/20">
        {toolSteps.map((step, index) => (
          <ToolCallItem key={step.id} step={step} isLast={index === toolSteps.length - 1} />
        ))}
      </div>
    </div>
  )
}

function ToolCallItem({ step, isLast }: { step: TraceStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const data: Record<string, unknown> = isRecord(step.data) ? step.data : {}
  const toolName = String(data.toolName ?? '')
  const displayName = TOOL_DISPLAY_NAMES[toolName] ?? String(data.toolDisplayName ?? toolName)

  return (
    <div className={`relative pl-6 ${isLast ? '' : 'pb-4'}`}>
      {/* 时间线圆点 */}
      <div className="absolute -left-1.5 top-1 h-3 w-3 rounded-full border-2 border-background bg-muted-foreground/40" />

      <div
        className="rounded-md border p-2.5 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Badge variant="outline" className="text-xs">{displayName}</Badge>
            <span className="text-[10px] text-muted-foreground font-mono">{toolName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={step.status} />
            {step.duration !== undefined && (
              <span className="text-[10px] font-mono text-muted-foreground">{formatDuration(step.duration)}</span>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 space-y-2 border-t pt-2" onClick={(e) => e.stopPropagation()}>
            {data.input != null && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground">输入参数</span>
                <JsonViewer data={data.input} maxHeight={150} />
              </div>
            )}
            {data.output != null && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground">返回结果</span>
                <JsonViewer data={data.output} maxHeight={150} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'success' ? 'default' : status === 'error' ? 'destructive' : 'secondary'
  return <Badge variant={variant} className="text-[10px]">{status}</Badge>
}

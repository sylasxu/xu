/**
 * Base Node Component (v2 - 灰度优先)
 *
 * 统一的管线节点卡片，根据状态渲染不同样式：
 * - pending: 灰色虚线
 * - running: primary 脉冲
 * - success: 边框加深
 * - error: 红色边框
 * - skipped: 半透明虚线
 */

import { memo, type ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { FlowNodeStatus } from '../../../types/flow'

export interface BaseNodeProps {
  data: {
    status: FlowNodeStatus
    label: string
    subtitle?: string
    [key: string]: unknown
  }
  selected?: boolean
  children?: ReactNode
  /** 隐藏顶部 handle（用于第一层节点如 Input） */
  hideTargetHandle?: boolean
  /** 隐藏底部 handle（用于最后一层节点如 Output） */
  hideSourceHandle?: boolean
}

const statusStyles: Record<FlowNodeStatus, string> = {
  pending: 'border-dashed border-muted text-muted-foreground bg-card',
  running: 'border-primary bg-card animate-pulse',
  success: 'border-foreground/30 bg-card',
  error: 'border-destructive bg-card',
  skipped: 'border-dashed border-muted text-muted-foreground/50 bg-card/50',
}

const handleClassName = '!bg-muted-foreground/40 !w-2 !h-2 !border-0 !min-w-0 !min-h-0'

export const BaseNode = memo(({ data, selected, children, hideTargetHandle, hideSourceHandle }: BaseNodeProps) => {
  const status = data.status as FlowNodeStatus

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 transition-all cursor-pointer',
        statusStyles[status] || statusStyles.pending,
        selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
      )}
      style={{ width: 200 }}
    >
      {!hideTargetHandle && (
        <Handle type="target" position={Position.Top} className={handleClassName} />
      )}

      <div className="text-sm font-medium truncate">{data.label}</div>
      {data.subtitle && (
        <div className="text-xs text-muted-foreground mt-0.5 truncate">
          {data.subtitle}
        </div>
      )}
      {children}

      {!hideSourceHandle && (
        <Handle type="source" position={Position.Bottom} className={handleClassName} />
      )}
    </div>
  )
})

BaseNode.displayName = 'BaseNode'

/** 格式化耗时显示 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

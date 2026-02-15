/**
 * WaterfallView Component
 *
 * 以瀑布图形式展示每个处理器的名称、执行时间条形图、输入摘要和输出摘要
 * 点击节点触发 onProcessorClick 打开详情 Drawer
 */

import { Badge } from '@/components/ui/badge'
import { formatDuration } from '../../types/trace'
import type { FlowNode, FlowNodeData } from '../../types/flow'

interface WaterfallViewProps {
  nodes: FlowNode[]
  onProcessorClick?: (node: FlowNode) => void
}

export function WaterfallView({ nodes, onProcessorClick }: WaterfallViewProps) {
  if (nodes.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        暂无处理器执行数据
      </div>
    )
  }

  // 计算最大耗时用于条形图比例
  const maxDuration = Math.max(...nodes.map(n => n.data.duration ?? 0), 1)

  return (
    <div className="space-y-1.5 p-4">
      <h3 className="text-sm font-medium mb-3">处理器瀑布图</h3>
      {nodes.map((node) => (
        <WaterfallRow
          key={node.id}
          node={node}
          maxDuration={maxDuration}
          onClick={() => onProcessorClick?.(node)}
        />
      ))}
    </div>
  )
}

interface WaterfallRowProps {
  node: FlowNode
  maxDuration: number
  onClick: () => void
}

function WaterfallRow({ node, maxDuration, onClick }: WaterfallRowProps) {
  const { data } = node
  const duration = data.duration ?? 0
  const widthPercent = maxDuration > 0 ? Math.max((duration / maxDuration) * 100, 2) : 2

  return (
    <div
      className="flex items-center gap-3 rounded-md border p-2 cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={onClick}
    >
      {/* 名称 */}
      <div className="w-36 shrink-0 flex items-center gap-1.5">
        <StatusDot status={data.status} />
        <span className="text-xs font-medium truncate">{data.label}</span>
      </div>

      {/* 条形图 */}
      <div className="flex-1 min-w-0">
        <div className="h-5 bg-muted/30 rounded-sm relative overflow-hidden">
          <div
            className={`h-full rounded-sm transition-all ${getBarColor(data.status)}`}
            style={{ width: `${widthPercent}%` }}
          />
          <span className="absolute inset-0 flex items-center px-2 text-[10px] font-mono text-muted-foreground">
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      {/* 摘要 */}
      <div className="w-28 shrink-0 text-right">
        <NodeSummary data={data} />
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    running: 'bg-blue-500 animate-pulse',
    pending: 'bg-gray-400',
    skipped: 'bg-gray-300',
  }
  return <span className={`h-2 w-2 rounded-full shrink-0 ${colors[status] ?? 'bg-gray-400'}`} />
}

function getBarColor(status: string): string {
  switch (status) {
    case 'success': return 'bg-green-500/30'
    case 'error': return 'bg-red-500/30'
    case 'running': return 'bg-blue-500/30 animate-pulse'
    case 'skipped': return 'bg-gray-300/30'
    default: return 'bg-muted'
  }
}

function NodeSummary({ data }: { data: FlowNodeData }) {
  switch (data.type) {
    case 'llm':
      return <Badge variant="outline" className="text-[10px]">{data.totalTokens ?? 0} tok</Badge>
    case 'tool':
      return <Badge variant="outline" className="text-[10px]">{data.toolDisplayName || data.toolName}</Badge>
    case 'keyword-match':
      return <Badge variant={data.matched ? 'default' : 'secondary'} className="text-[10px]">{data.matched ? '命中' : '未命中'}</Badge>
    case 'intent-classify':
      return <Badge variant="outline" className="text-[10px]">{data.intent}</Badge>
    default:
      return <span className="text-[10px] text-muted-foreground">{data.status}</span>
  }
}

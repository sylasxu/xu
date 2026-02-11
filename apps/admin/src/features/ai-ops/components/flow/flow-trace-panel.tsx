/**
 * Flow Trace Panel Component (v2)
 *
 * 接收 traces 和 selectedRound，使用静态管线 + trace 驱动状态更新
 */

import { useMemo } from 'react'
import { FlowGraph } from './flow-graph'
import { buildStaticPipeline, applyTraceToGraph } from './utils/flow-builder'
import type { ExecutionTrace } from '../../types/trace'
import type { FlowNode } from '../../types/flow'

interface FlowTracePanelProps {
  traces: ExecutionTrace[]
  selectedRound: number
  onNodeClick?: (node: FlowNode) => void
}

export function FlowTracePanel({ traces, selectedRound, onNodeClick }: FlowTracePanelProps) {
  const flowData = useMemo(() => {
    const staticGraph = buildStaticPipeline()
    const trace = traces[selectedRound]
    if (!trace) return staticGraph
    return applyTraceToGraph(staticGraph, trace)
  }, [traces, selectedRound])

  return (
    <div className="relative h-full">
      <FlowGraph data={flowData} onNodeClick={onNodeClick ?? (() => {})} />
    </div>
  )
}

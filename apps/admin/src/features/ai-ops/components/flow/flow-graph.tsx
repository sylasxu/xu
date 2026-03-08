/**
 * Flow Graph Component
 * 
 * ReactFlow 流程图容器，渲染自定义节点和边
 */

import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { InputNode } from './nodes/input-node';
import { P0MatchNode } from './nodes/p0-match-node';
import { P1IntentNode } from './nodes/p1-intent-node';
import { ProcessorNode } from './nodes/processor-node';
import { LLMNode } from './nodes/llm-node';
import { ToolNode } from './nodes/tool-node';
import { OutputNode } from './nodes/output-node';
import type { FlowGraphData, FlowNode } from '../../types/flow';

interface FlowGraphProps {
  data: FlowGraphData;
  onNodeClick: (node: FlowNode) => void;
}

const nodeTypes: NodeTypes = {
  'user-input': InputNode,
  'keyword-match': P0MatchNode,
  'intent-classify': P1IntentNode,
  processor: ProcessorNode,
  llm: LLMNode,
  tool: ToolNode,
  'final-output': OutputNode,
};

export function FlowGraph({ data, onNodeClick }: FlowGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(data.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(data.edges);

  // 更新节点和边
  useEffect(() => {
    setNodes(data.nodes);
    setEdges(data.edges);
  }, [data, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: any) => {
      onNodeClick(node as FlowNode);
    },
    [onNodeClick]
  );

  return (
    <div
      className="h-full w-full [&_.react-flow__node]:!border-0 [&_.react-flow__node]:!shadow-none [&_.react-flow__node]:!rounded-none [&_.react-flow__node]:!p-0 [&_.react-flow__node.selected]:!outline-none [&_.react-flow__handle]:!min-w-0 [&_.react-flow__handle]:!min-h-0"
      style={{
        // CSS 变量值已是完整的 oklch() 颜色，直接引用即可
        '--xy-background-color': 'var(--background)',
        '--xy-minimap-background-color': 'var(--muted)',
        '--xy-minimap-mask-background-color': 'color-mix(in oklch, var(--background) 70%, transparent)',
        '--xy-node-background-color': 'transparent',
        '--xy-node-border-color': 'transparent',
        '--xy-controls-button-background-color': 'var(--card)',
        '--xy-controls-button-border-color': 'var(--border)',
        '--xy-controls-button-color': 'var(--foreground)',
        '--xy-edge-stroke': 'color-mix(in oklch, var(--muted-foreground) 30%, transparent)',
      } as React.CSSProperties}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.5}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { 
            stroke: 'var(--primary)',
            strokeWidth: 2,
          },
          animated: false,
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        selectNodesOnDrag={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="rgba(140, 140, 160, 0.4)" />
        <Controls />
        <MiniMap
          maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
          bgColor="var(--muted)"
          style={{ width: 160, height: 120, right: 12, bottom: 12 }}
          nodeColor={(node) => {
            const status = (node.data as any)?.status as string | undefined;
            const colorMap: Record<string, string> = {
              pending: '#9ca3af',
              running: '#3b82f6',
              success: '#22c55e',
              error: '#ef4444',
              skipped: '#d1d5db',
            };
            return colorMap[status || 'pending'] || '#9ca3af';
          }}
        />
      </ReactFlow>
    </div>
  );
}

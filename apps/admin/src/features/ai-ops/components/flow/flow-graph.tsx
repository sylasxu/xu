/**
 * Flow Graph Component
 * 
 * ReactFlow 流程图容器，渲染自定义节点和边
 */

import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
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
        // 覆盖 ReactFlow 内置 dark mode 的黑色背景，统一使用设计系统的 --background
        '--xy-background-color': 'hsl(var(--background))',
        '--xy-minimap-background-color': 'hsl(var(--muted))',
        '--xy-minimap-mask-background-color': 'hsl(var(--background) / 0.7)',
        '--xy-node-background-color': 'transparent',
        '--xy-node-border-color': 'transparent',
        '--xy-controls-button-background-color': 'hsl(var(--card))',
        '--xy-controls-button-border-color': 'hsl(var(--border))',
        '--xy-controls-button-color': 'hsl(var(--foreground))',
        '--xy-edge-stroke': 'hsl(var(--muted-foreground) / 0.3)',
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
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { 
            stroke: 'hsl(var(--primary))',
            strokeWidth: 2,
          },
          animated: false,
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        selectNodesOnDrag={false}
      >
        <Background color="hsl(var(--muted-foreground) / 0.15)" />
        <Controls />
        <MiniMap
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

/**
 * PlaygroundDrawer Component (v3 - 节点类型动态面板)
 *
 * 根据选中节点类型动态渲染内容：
 * - user-input → UserInputNodePanel (placeholder)
 * - 其他节点 → NodeDetailView
 * - 无选中节点 → 空状态提示
 */

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { UIMessage } from '@ai-sdk/react'
import { type FlowNode, type FlowNodeData, type InputNodeData, getNodeChineseLabel } from '../../types/flow'
import { DetailRow } from '../shared/detail-row'
import { type ModelParams, type TraceOutput, formatDuration } from '../../types/trace'
import type { MockSettings } from './mock-settings-panel'
import { ChatView } from './chat-view'
import { SettingsView } from './settings-view'
import { NodeDetailView } from './node-detail-view'

export interface PlaygroundDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedNode: FlowNode | null
  // Chat props
  messages: UIMessage[]
  onSendMessage: (text: string) => void
  onClear: () => void
  onStop: () => void
  isLoading: boolean
  error?: Error | null
  // Settings props
  mockSettings: MockSettings
  onMockSettingsChange: (settings: MockSettings) => void
  modelParams: ModelParams
  onModelParamsChange: (params: ModelParams) => void
  traceEnabled: boolean
  onTraceEnabledChange: (enabled: boolean) => void
  // Node detail props
  systemPrompt: string | null
  traceOutput: TraceOutput | null
}

/** 状态 Badge：复用 node-detail-view 中的映射逻辑 */
function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: '等待中',
    running: '执行中',
    success: '成功',
    error: '失败',
    skipped: '已跳过',
  }
  const variants: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
    success: 'default',
    error: 'destructive',
    running: 'secondary',
    pending: 'outline',
    skipped: 'outline',
  }
  return <Badge variant={variants[status] ?? 'outline'}>{labels[status] ?? status}</Badge>
}

/** Drawer 头部：中文节点标题 + 状态 Badge + 耗时 */
function DrawerHeader({ node }: { node: FlowNode }) {
  const data = node.data as FlowNodeData
  // processor 节点用 processorType 获取具体中文标签（如"用户画像"），其他节点用 type
  const labelKey = data.type === 'processor' && 'processorType' in data && data.processorType
    ? (data.processorType as string)
    : data.type
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium">{getNodeChineseLabel(labelKey)}</span>
      <StatusBadge status={data.status} />
      {data.duration != null && (
        <span className="text-xs text-muted-foreground">{formatDuration(data.duration)}</span>
      )}
    </div>
  )
}

/** 输入详情区块 */
function InputDetailSection({ node }: { node: FlowNode }) {
  const data = node.data as InputNodeData
  return (
    <div className="space-y-3">
      <DetailRow label="输入文本">
        <p className="text-sm whitespace-pre-wrap">{data.text}</p>
      </DetailRow>
      <DetailRow label="字符数">
        <span className="text-sm font-mono">{data.charCount ?? data.text?.length ?? 0}</span>
      </DetailRow>
      {data.source && (
        <DetailRow label="来源">
          <Badge variant="outline">{data.source}</Badge>
        </DetailRow>
      )}
      {data.userId && (
        <DetailRow label="用户 ID">
          <span className="text-sm font-mono text-muted-foreground">{data.userId}</span>
        </DetailRow>
      )}
    </div>
  )
}

/** 用户输入节点专属面板 */
interface UserInputNodePanelProps {
  node: FlowNode
  // Chat props
  messages: UIMessage[]
  onSendMessage: (text: string) => void
  onClear: () => void
  onStop: () => void
  isLoading: boolean
  error?: Error | null
  // Settings props
  mockSettings: MockSettings
  onMockSettingsChange: (settings: MockSettings) => void
  modelParams: ModelParams
  onModelParamsChange: (params: ModelParams) => void
  traceEnabled: boolean
  onTraceEnabledChange: (enabled: boolean) => void
}

function UserInputNodePanel({
  node,
  messages,
  onSendMessage,
  onClear,
  onStop,
  isLoading,
  error,
  mockSettings,
  onMockSettingsChange,
  modelParams,
  onModelParamsChange,
  traceEnabled,
  onTraceEnabledChange,
}: UserInputNodePanelProps) {
  return (
    <div className="flex flex-col">
      {/* 输入详情 */}
      <div className="p-4">
        <p className="text-xs font-medium text-muted-foreground mb-3">输入详情</p>
        <InputDetailSection node={node} />
      </div>

      <Separator />

      {/* 对话区 */}
      <div className="p-4">
        <p className="text-xs font-medium text-muted-foreground mb-3">对话</p>
        <ChatView
          messages={messages}
          onSendMessage={onSendMessage}
          onClear={onClear}
          onStop={onStop}
          isLoading={isLoading}
          error={error}
        />
      </div>

      <Separator />

      {/* 配置区 */}
      <div>
        <div className="px-4 pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">配置</p>
        </div>
        <SettingsView
          mockSettings={mockSettings}
          onMockSettingsChange={onMockSettingsChange}
          modelParams={modelParams}
          onModelParamsChange={onModelParamsChange}
          traceEnabled={traceEnabled}
          onTraceEnabledChange={onTraceEnabledChange}
        />
      </div>
    </div>
  )
}

export function PlaygroundDrawer({
  open,
  onOpenChange,
  selectedNode,
  messages,
  onSendMessage,
  onClear,
  onStop,
  isLoading,
  error,
  mockSettings,
  onMockSettingsChange,
  modelParams,
  onModelParamsChange,
  traceEnabled,
  onTraceEnabledChange,
  systemPrompt,
  traceOutput,
}: PlaygroundDrawerProps) {
  const nodeData = selectedNode?.data as FlowNodeData | undefined

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[480px] !max-w-[480px] overflow-hidden p-0 flex flex-col"
      >
        {/* Header */}
        <SheetHeader className="border-b px-4 py-3 flex-shrink-0">
          <SheetTitle className="sr-only">
            {selectedNode
              ? getNodeChineseLabel(
                  nodeData!.type === 'processor' && 'processorType' in nodeData! && nodeData!.processorType
                    ? (nodeData!.processorType as string)
                    : nodeData!.type
                )
              : '节点详情'}
          </SheetTitle>
          <SheetDescription className="sr-only">AI Playground 节点详情面板</SheetDescription>
          {selectedNode ? (
            <DrawerHeader node={selectedNode} />
          ) : (
            <span className="text-sm text-muted-foreground">节点详情</span>
          )}
        </SheetHeader>

        {/* Content: 根据节点类型路由 */}
        <div className="flex-1 overflow-y-auto">
          {!selectedNode ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              点击画布中的节点查看详情
            </div>
          ) : nodeData?.type === 'user-input' ? (
            <UserInputNodePanel
              node={selectedNode}
              messages={messages}
              onSendMessage={onSendMessage}
              onClear={onClear}
              onStop={onStop}
              isLoading={isLoading}
              error={error}
              mockSettings={mockSettings}
              onMockSettingsChange={onMockSettingsChange}
              modelParams={modelParams}
              onModelParamsChange={onModelParamsChange}
              traceEnabled={traceEnabled}
              onTraceEnabledChange={onTraceEnabledChange}
            />
          ) : (
            <NodeDetailView
              node={selectedNode}
              systemPrompt={systemPrompt}
              traceOutput={traceOutput}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

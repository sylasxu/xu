/**
 * PlaygroundDrawer Component (v2 - 三合一 Drawer)
 *
 * 三种视图模式：chat / settings / node-detail
 * 顶部 Tab 切换，shadcn Sheet 480px 宽度
 */

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MessageSquare, Settings, Info } from 'lucide-react'
import type { UIMessage } from '@ai-sdk/react'
import type { FlowNode } from '../../types/flow'
import type { ModelParams, TraceOutput } from '../../types/trace'
import type { MockSettings } from './mock-settings-panel'
import { ChatView } from './chat-view'
import { SettingsView } from './settings-view'
import { NodeDetailView } from './node-detail-view'

export type DrawerView = 'chat' | 'settings' | 'node-detail'

export interface PlaygroundDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  view: DrawerView
  onViewChange: (view: DrawerView) => void
  // Chat view
  messages: UIMessage[]
  onSendMessage: (text: string) => void
  onClear: () => void
  onStop: () => void
  isLoading: boolean
  error?: Error | null
  // Settings view
  mockSettings: MockSettings
  onMockSettingsChange: (settings: MockSettings) => void
  modelParams: ModelParams
  onModelParamsChange: (params: ModelParams) => void
  traceEnabled: boolean
  onTraceEnabledChange: (enabled: boolean) => void
  // Node detail view
  selectedNode: FlowNode | null
  systemPrompt: string | null
  traceOutput: TraceOutput | null
}

const VIEW_TITLES: Record<DrawerView, string> = {
  chat: '对话',
  settings: '配置',
  'node-detail': '节点详情',
}

export function PlaygroundDrawer({
  open,
  onOpenChange,
  view,
  onViewChange,
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
  selectedNode,
  systemPrompt,
  traceOutput,
}: PlaygroundDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[480px] !max-w-[480px] overflow-hidden p-0 flex flex-col"
      >
        {/* Header: Tab 切换 */}
        <SheetHeader className="border-b px-4 py-3 flex-shrink-0">
          <SheetTitle className="sr-only">{VIEW_TITLES[view]}</SheetTitle>
          <SheetDescription className="sr-only">AI Playground 调试面板</SheetDescription>
          <Tabs value={view} onValueChange={(v) => onViewChange(v as DrawerView)}>
            <TabsList className="w-full">
              <TabsTrigger value="chat" className="flex-1 gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                对话
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1 gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                配置
              </TabsTrigger>
              <TabsTrigger value="node-detail" className="flex-1 gap-1.5">
                <Info className="h-3.5 w-3.5" />
                节点
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </SheetHeader>

        {/* Content: 根据 view 渲染 */}
        <div className="flex-1 overflow-y-auto">
          {view === 'chat' && (
            <ChatView
              messages={messages}
              onSendMessage={onSendMessage}
              onClear={onClear}
              onStop={onStop}
              isLoading={isLoading}
              error={error}
            />
          )}
          {view === 'settings' && (
            <SettingsView
              mockSettings={mockSettings}
              onMockSettingsChange={onMockSettingsChange}
              modelParams={modelParams}
              onModelParamsChange={onModelParamsChange}
              traceEnabled={traceEnabled}
              onTraceEnabledChange={onTraceEnabledChange}
            />
          )}
          {view === 'node-detail' && (
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

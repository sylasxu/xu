/**
 * PlaygroundLayout Component (v5 - Mastra-style)
 *
 * 全屏画布 + 右侧 Drawer + 浮层统计 + 轮次选择
 * 编排所有子组件，管理全局状态
 */

import { useCallback, useState, useMemo } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useExecutionTrace } from '../../hooks/use-execution-trace'
import { FlowTracePanel } from '../flow/flow-trace-panel'
import { PlaygroundDrawer } from './playground-drawer'
import { SessionStatsBar } from './session-stats-bar'
import { RoundSelector } from './round-selector'
import type { MockSettings } from './mock-settings-panel'
import type { FlowNode } from '../../types/flow'
import type { TraceStep, TraceStatus, IntentType } from '../../types/trace'
import { API_BASE_URL } from '@/lib/eden'
import { Header } from '@/components/layout/header'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'

export function PlaygroundLayout() {
  // Drawer 状态
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null)
  const [selectedRound, setSelectedRound] = useState(0)

  // 配置状态
  const [traceEnabled, setTraceEnabled] = useState(true)
  const [mockSettings, setMockSettings] = useState<MockSettings>({
    userType: 'with_phone',
    location: 'guanyinqiao',
  })

  // Trace 管理
  const {
    traces,
    modelParams,
    setModelParams,
    systemPrompt,
    sessionStats,
    clearTrace,
    handleTraceStart,
    handleTraceStep,
    handleTraceEnd,
    updateTraceStep,
  } = useExecutionTrace()

  // 最新轮次的 traceOutput
  const traceOutput = useMemo(() => {
    const trace = traces[selectedRound]
    return trace?.output ?? null
  }, [traces, selectedRound])

  // Transport 配置
  const transport = useMemo(() => {
    const token = localStorage.getItem('admin_token')
    return new DefaultChatTransport({
      api: `${API_BASE_URL}/ai/chat`,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: {
        source: 'admin',
        trace: traceEnabled,
        modelParams: {
          model: modelParams.model,
          temperature: modelParams.temperature,
          maxTokens: modelParams.maxTokens,
        },
      },
    })
  }, [modelParams, traceEnabled])

  // useChat hook
  const { messages, sendMessage, stop, setMessages, status, error } = useChat({
    transport,
    onData: (dataPart) => {
      if (dataPart && typeof dataPart === 'object' && 'type' in dataPart) {
        const part = dataPart as { type: string; data?: unknown }

        if (part.type === 'data-trace-start') {
          const data = part.data as {
            requestId: string
            startedAt: string
            systemPrompt?: string
            tools?: Array<{ name: string; description: string; schema: Record<string, unknown> }>
            intent?: IntentType
            intentMethod?: 'regex' | 'llm'
          }
          handleTraceStart(data.requestId, data.startedAt, data.systemPrompt, data.tools, data.intent, data.intentMethod)
          // 新轮次开始时，自动选中最新轮次
          setSelectedRound(0)
        } else if (part.type === 'data-trace-step') {
          handleTraceStep(part.data as TraceStep)
        } else if (part.type === 'data-trace-step-update') {
          const data = part.data as { stepId: string; [key: string]: unknown }
          updateTraceStep(data.stepId, data as Partial<TraceStep>)
        } else if (part.type === 'data-trace-end') {
          const data = part.data as {
            completedAt: string
            status: TraceStatus
            totalCost?: number
            output?: {
              text: string | null
              toolCalls: Array<{ name: string; displayName: string; input: unknown; output: unknown }>
            }
          }
          handleTraceEnd(data.completedAt, data.status, data.totalCost, data.output)
        }
      }
    },
    onError: (err) => {
      console.error('AI Chat 错误:', err)
      handleTraceEnd(new Date().toISOString(), 'error')
    },
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  // 发送消息
  const handleSendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isLoading) return
      sendMessage({ text: text.trim() })
    },
    [isLoading, sendMessage],
  )

  // 清空
  const handleClear = useCallback(() => {
    clearTrace()
    setMessages([])
    setSelectedRound(0)
    setSelectedNode(null)
  }, [clearTrace, setMessages])

  // 停止生成
  const handleStop = useCallback(() => {
    stop()
  }, [stop])

  // 节点点击 → 打开 Drawer node-detail 视图
  const handleNodeClick = useCallback((node: FlowNode) => {
    setSelectedNode(node)
    setDrawerOpen(true)
  }, [])

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* 透明 Header */}
      <Header className="pointer-events-none absolute left-0 right-0 top-0 z-40 bg-transparent border-b-0">
        <div className="pointer-events-auto flex items-center gap-3">
          <Search className="bg-background/80 backdrop-blur-md" />
          <div className="ms-auto flex items-center gap-2">
            <ThemeSwitch />
            <ConfigDrawer />
            <ProfileDropdown />
          </div>
        </div>
      </Header>

      {/* 全屏流程图 */}
      <FlowTracePanel
        traces={traces}
        selectedRound={selectedRound}
        onNodeClick={handleNodeClick}
      />

      {/* 轮次选择器 */}
      <RoundSelector
        rounds={traces.length}
        selectedRound={selectedRound}
        onRoundChange={setSelectedRound}
      />

      {/* 底部统计栏 */}
      <SessionStatsBar model={modelParams.model} stats={sessionStats} />

      {/* 右侧 Drawer */}
      <PlaygroundDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        messages={messages}
        onSendMessage={handleSendMessage}
        onClear={handleClear}
        onStop={handleStop}
        isLoading={isLoading}
        error={error}
        mockSettings={mockSettings}
        onMockSettingsChange={setMockSettings}
        modelParams={modelParams}
        onModelParamsChange={setModelParams}
        traceEnabled={traceEnabled}
        onTraceEnabledChange={setTraceEnabled}
        selectedNode={selectedNode}
        systemPrompt={systemPrompt}
        traceOutput={traceOutput}
      />
    </div>
  )
}

/**
 * PlaygroundLayout Component (v5 - Mastra-style)
 *
 * 全屏画布 + 右侧 Drawer + 浮层统计 + 轮次选择
 * 编排所有子组件，管理全局状态
 */

import { useCallback, useState, useMemo } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useAiConfigDetail } from '../../hooks/use-ai-config'
import { useExecutionTrace } from '../../hooks/use-execution-trace'
import { FlowTracePanel } from '../flow/flow-trace-panel'
import { PlaygroundDrawer } from './playground-drawer'
import { SessionStatsBar } from './session-stats-bar'
import { RoundSelector } from './round-selector'
import type { MockSettings } from './mock-settings-panel'
import type { FlowNode } from '../../types/flow'
import {
  calculateSessionStats,
  FOLLOW_ROUTE_MAP_MODEL,
  type TraceStep,
  type TraceStatus,
  type IntentMethod,
  type IntentType,
} from '../../types/trace'
import {
  normalizeRouteMapConfig,
  ROUTE_MAP_CONFIG_KEY,
} from '../../model-routing'
import { API_BASE_URL } from '@/lib/eden'
import { Header } from '@/components/layout/header'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isIntentType(value: unknown): value is IntentType {
  return (
    value === 'create' ||
    value === 'explore' ||
    value === 'manage' ||
    value === 'partner' ||
    value === 'idle' ||
    value === 'chitchat' ||
    value === 'unknown'
  )
}

function isTraceStatus(value: unknown): value is TraceStatus {
  return value === 'running' || value === 'completed' || value === 'error'
}

function isTraceToolDefinition(value: unknown): value is {
  name: string
  description: string
  schema: Record<string, unknown>
} {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    isRecord(value.schema)
  )
}

function isTraceStartPartData(value: unknown): value is {
  requestId: string
  startedAt: string
  systemPrompt?: string
  tools?: Array<{ name: string; description: string; schema: Record<string, unknown> }>
  intent?: IntentType
  intentMethod?: IntentMethod
} {
  return (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    typeof value.startedAt === 'string' &&
    (value.systemPrompt === undefined || typeof value.systemPrompt === 'string') &&
    (value.tools === undefined || (Array.isArray(value.tools) && value.tools.every(isTraceToolDefinition))) &&
    (value.intent === undefined || isIntentType(value.intent)) &&
    (
      value.intentMethod === undefined
      || value.intentMethod === 'regex'
      || value.intentMethod === 'llm'
      || value.intentMethod === 'structured_action'
    )
  )
}

function isTraceStep(value: unknown): value is TraceStep {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.name === 'string' &&
    typeof value.startedAt === 'string' &&
    typeof value.status === 'string' &&
    'data' in value
  )
}

function isTraceStepUpdate(value: unknown): value is { stepId: string } & Partial<TraceStep> {
  return isRecord(value) && typeof value.stepId === 'string'
}

function isTraceOutput(value: unknown): value is {
  text: string | null
  toolCalls: Array<{ name: string; displayName: string; input: unknown; output: unknown }>
} {
  return (
    isRecord(value) &&
    (value.text === null || typeof value.text === 'string') &&
    Array.isArray(value.toolCalls) &&
    value.toolCalls.every((toolCall) => (
      isRecord(toolCall) &&
      typeof toolCall.name === 'string' &&
      typeof toolCall.displayName === 'string' &&
      'input' in toolCall &&
      'output' in toolCall
    ))
  )
}

function isTraceEndPartData(value: unknown): value is {
  completedAt: string
  status: TraceStatus
  totalCost?: number
  output?: {
    text: string | null
    toolCalls: Array<{ name: string; displayName: string; input: unknown; output: unknown }>
  }
} {
  return (
    isRecord(value) &&
    typeof value.completedAt === 'string' &&
    isTraceStatus(value.status) &&
    (value.totalCost === undefined || typeof value.totalCost === 'number') &&
    (value.output === undefined || isTraceOutput(value.output))
  )
}

export function PlaygroundLayout() {
  // Drawer 状态
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null)
  const [selectedRound, setSelectedRound] = useState(0)

  // 配置状态
  const [traceEnabled, setTraceEnabled] = useState(true)
  const [mockSettings, setMockSettings] = useState<MockSettings>({
    userType: 'with_phone',
    location: 'guanyinqiao',
  })
  const { data: routeMapData, isLoading: isRouteMapLoading } = useAiConfigDetail(ROUTE_MAP_CONFIG_KEY)

  // Trace 管理
  const {
    traces,
    modelParams,
    setModelParams,
    systemPrompt,
    clearTrace,
    handleTraceStart,
    handleTraceStep,
    handleTraceEnd,
    updateTraceStep,
  } = useExecutionTrace()

  const routeMap = useMemo(
    () => normalizeRouteMapConfig(routeMapData?.configValue),
    [routeMapData?.configValue],
  )

  const followsRouteMap = modelParams.model === FOLLOW_ROUTE_MAP_MODEL
  const effectiveRequestedModel = followsRouteMap ? routeMap.chat : modelParams.model
  const sessionStats = useMemo(
    () => calculateSessionStats(traces, effectiveRequestedModel),
    [effectiveRequestedModel, traces],
  )
  const modelSourceLabel = followsRouteMap ? '跟随后台链路' : '手动覆盖'
  const modelSourceTitle = followsRouteMap
    ? `当前 chat=${routeMap.chat} · reasoning=${routeMap.reasoning} · agent=${routeMap.agent}`
    : `当前手动覆盖 chat=${modelParams.model}；后台 reasoning=${routeMap.reasoning} · agent=${routeMap.agent}`

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
        context: {
          client: 'admin',
        },
        trace: traceEnabled,
        ai: {
          ...(modelParams.model !== FOLLOW_ROUTE_MAP_MODEL ? { model: modelParams.model } : {}),
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
      if (!isRecord(dataPart) || typeof dataPart.type !== 'string') {
        return
      }

      if (dataPart.type === 'data-trace-start' && isTraceStartPartData(dataPart.data)) {
        handleTraceStart(
          dataPart.data.requestId,
          dataPart.data.startedAt,
          dataPart.data.systemPrompt,
          dataPart.data.tools,
          dataPart.data.intent,
          dataPart.data.intentMethod,
        )
        setSelectedRound(0)
        return
      }

      if (dataPart.type === 'data-trace-step' && isTraceStep(dataPart.data)) {
        handleTraceStep(dataPart.data)
        return
      }

      if (dataPart.type === 'data-trace-step-update' && isTraceStepUpdate(dataPart.data)) {
        updateTraceStep(dataPart.data.stepId, dataPart.data)
        return
      }

      if (dataPart.type === 'data-trace-end' && isTraceEndPartData(dataPart.data)) {
        handleTraceEnd(
          dataPart.data.completedAt,
          dataPart.data.status,
          dataPart.data.totalCost,
          dataPart.data.output,
        )
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
    <div className="relative h-full w-full overflow-hidden">
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
      <SessionStatsBar
        model={effectiveRequestedModel}
        modelSourceLabel={modelSourceLabel}
        modelSourceTitle={modelSourceTitle}
        stats={sessionStats}
      />

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
        routeMap={routeMap}
        routeMapLoading={isRouteMapLoading}
        traceEnabled={traceEnabled}
        onTraceEnabledChange={setTraceEnabled}
        selectedNode={selectedNode}
        systemPrompt={systemPrompt}
        traceOutput={traceOutput}
      />
    </div>
  )
}

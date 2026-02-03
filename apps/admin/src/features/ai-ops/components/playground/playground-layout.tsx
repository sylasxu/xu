/**
 * PlaygroundLayout Component (v4.0 - Fullscreen Canvas)
 * 
 * 全屏画布模式，流程图占据整个屏幕，控制项移至右侧 Drawer
 */

import { useCallback, useState, useMemo } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useExecutionTrace } from '../../hooks/use-execution-trace'
import { FlowTracePanel } from '../flow/flow-trace-panel'
import { UnifiedDrawer } from './unified-drawer'
import type { MockSettings } from './mock-settings-panel'
import type { ConversationStats } from './stats-panel'
import type { FlowNode } from '../../types/flow'
import type { TraceStep, TraceStatus, IntentType } from '../../types/trace'
import { API_BASE_URL } from '@/lib/eden'
import { Header } from '@/components/layout/header'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'

export function PlaygroundLayout() {
  // Drawer 状态 - 默认关闭，点击 node 才打开
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerView, setDrawerView] = useState<'control' | 'node'>('control')
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null)
  
  // 控制面板状态
  const [traceEnabled, setTraceEnabled] = useState(true)
  const [mockSettings, setMockSettings] = useState<MockSettings>({
    userType: 'with_phone',
    location: 'guanyinqiao',
  })
  const [stats] = useState<ConversationStats | null>(null)

  // Trace 管理
  const {
    traces,
    modelParams,
    clearTrace,
    handleTraceStart,
    handleTraceStep,
    handleTraceEnd,
    updateTraceStep,
    isStreaming,
  } = useExecutionTrace()

  // 创建 transport
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

  // 使用 useChat hook
  const { sendMessage, status } = useChat({
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
    [isLoading, sendMessage]
  )

  // 打开控制面板 - 保留以备将来使用
  const handleOpenControl = useCallback(() => {
    setDrawerView('control')
    setDrawerOpen(true)
  }, [])
  // 使用 void 来消除未使用警告
  void handleOpenControl

  // 节点点击处理 - 如果是初始 node，显示控制面板；否则显示节点详情
  const handleNodeClick = useCallback((node: FlowNode) => {
    setSelectedNode(node)
    // 如果是初始的发送消息 node，显示控制面板
    if (node.id === 'initial-input') {
      setDrawerView('control')
    } else {
      setDrawerView('node')
    }
    setDrawerOpen(true)
  }, [])

  // 关联节点跳转
  const handleNodeJump = useCallback(
    (nodeId: string) => {
      // TODO: 实现真正的节点跳转逻辑
      console.log('Jump to node:', nodeId)
    },
    []
  )

  // 获取所有节点（用于关联节点跳转）
  const allNodes = useMemo(() => {
    const latestTrace = traces[traces.length - 1]
    if (!latestTrace) return []
    // 这里应该从 buildFlowGraph 返回的 nodes 中获取
    // 简化处理：返回空数组
    return []
  }, [traces])

  return (
    <div className='relative h-screen w-screen overflow-hidden'>
      {/* 透明 Header - 绝对定位浮在画布上方 */}
      <Header className='pointer-events-none absolute left-0 right-0 top-0 z-40 bg-transparent border-b-0'>
        <div className='pointer-events-auto flex items-center gap-3'>
          <Search className='bg-background/80 backdrop-blur-md' />
          <div className='ms-auto flex items-center gap-2'>
            <ThemeSwitch />
            <ConfigDrawer />
            <ProfileDropdown />
          </div>
        </div>
      </Header>

      {/* 全屏流程图 */}
      <FlowTracePanel traces={traces} isStreaming={isStreaming} onNodeClick={handleNodeClick} />

      {/* 统一的右侧 Drawer - 默认打开 */}
      <UnifiedDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        view={drawerView}
        onViewChange={setDrawerView}
        mockSettings={mockSettings}
        onMockSettingsChange={setMockSettings}
        traceEnabled={traceEnabled}
        onTraceEnabledChange={setTraceEnabled}
        onSendMessage={handleSendMessage}
        onClear={clearTrace}
        stats={stats}
        selectedNode={selectedNode}
        allNodes={allNodes}
        onNodeClick={handleNodeJump}
      />
    </div>
  )
}

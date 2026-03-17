/**
 * useExecutionTrace Hook (v3.11)
 * 
 * 多轮执行追踪状态管理 Hook。
 * 支持追加模式，保留所有轮次的追踪记录。
 */

import { useState, useCallback, useMemo } from 'react'
import type { 
  ExecutionTrace, 
  TraceStep, 
  TraceStatus,
  TraceEvent,
  ModelParams,
  IntentType,
  IntentMethod,
  SessionStats,
} from '../types/trace'
import { DEFAULT_MODEL_PARAMS, calculateSessionStats } from '../types/trace'

interface UseExecutionTraceReturn {
  /** 所有轮次的追踪数据（最新在前） */
  traces: ExecutionTrace[]
  /** 模型参数 */
  modelParams: ModelParams
  /** 设置模型参数 */
  setModelParams: (params: ModelParams) => void
  /** 最新轮次的 System Prompt */
  systemPrompt: string | null
  /** 会话统计（累计） */
  sessionStats: SessionStats
  /** 处理追踪事件 */
  handleTraceEvent: (event: TraceEvent) => void
  /** 处理追踪开始（追加新轮次） */
  handleTraceStart: (requestId: string, startedAt: string, systemPrompt?: string, tools?: Array<{ name: string; description: string; schema: Record<string, unknown> }>, intent?: IntentType, intentMethod?: IntentMethod) => void
  /** 处理追踪步骤 */
  handleTraceStep: (step: TraceStep) => void
  /** 更新追踪步骤 */
  updateTraceStep: (stepId: string, updates: Partial<TraceStep>) => void
  /** 处理追踪结束 */
  handleTraceEnd: (completedAt: string, status: TraceStatus, totalCost?: number, output?: { text: string | null; toolCalls: Array<{ name: string; displayName: string; input: unknown; output: unknown }> }) => void
  /** 清空所有追踪 */
  clearTrace: () => void
  /** 当前是否正在执行 */
  isStreaming: boolean
}

export function useExecutionTrace(): UseExecutionTraceReturn {
  const [traces, setTraces] = useState<ExecutionTrace[]>([])
  const [modelParams, setModelParams] = useState<ModelParams>(DEFAULT_MODEL_PARAMS)
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null)

  // 当前是否正在执行（最新轮次状态为 running）
  const isStreaming = traces.length > 0 && traces[0].status === 'running'

  // 会话统计（累计）
  const sessionStats = useMemo(
    () => calculateSessionStats(traces, modelParams.model),
    [traces, modelParams.model],
  )

  /** 处理追踪开始 - 追加新轮次到数组前面 */
  const handleTraceStart = useCallback((
    requestId: string, 
    startedAt: string, 
    systemPrompt?: string, 
    tools?: Array<{ name: string; description: string; schema: Record<string, unknown> }>,
    intent?: IntentType,
    intentMethod?: IntentMethod
  ) => {
    const newTrace: ExecutionTrace = {
      requestId,
      startedAt,
      status: 'running',
      steps: [],
      systemPrompt,
      tools,
      intent,
      intentMethod,
    }
    // 追加到数组前面（最新在前）
    setTraces(prev => [newTrace, ...prev])
    // 保存最新轮次的 systemPrompt
    if (systemPrompt) {
      setSystemPrompt(systemPrompt)
    }
  }, [])

  /** 处理追踪步骤 - 更新最新轮次 */
  const handleTraceStep = useCallback((step: TraceStep) => {
    setTraces(prev => {
      if (prev.length === 0) return prev
      
      const [current, ...rest] = prev
      
      // 检查是否已存在该步骤（更新）
      const existingIndex = current.steps.findIndex(s => s.id === step.id)
      if (existingIndex >= 0) {
        const newSteps = [...current.steps]
        newSteps[existingIndex] = step
        return [{ ...current, steps: newSteps }, ...rest]
      }
      
      // 新增步骤
      return [{ ...current, steps: [...current.steps, step] }, ...rest]
    })
  }, [])

  /** 更新追踪步骤 - 更新最新轮次中的指定步骤 */
  const updateTraceStep = useCallback((stepId: string, updates: Partial<TraceStep>) => {
    setTraces(prev => {
      if (prev.length === 0) return prev
      
      const [current, ...rest] = prev
      const stepIndex = current.steps.findIndex(s => s.id === stepId)
      if (stepIndex < 0) return prev
      
      const newSteps = [...current.steps]
      newSteps[stepIndex] = { ...newSteps[stepIndex], ...updates }
      
      return [{ ...current, steps: newSteps }, ...rest]
    })
  }, [])

  /** 处理追踪结束 - 更新最新轮次的完成状态 */
  const handleTraceEnd = useCallback((
    completedAt: string, 
    status: TraceStatus,
    totalCost?: number,
    output?: { text: string | null; toolCalls: Array<{ name: string; displayName: string; input: unknown; output: unknown }> }
  ) => {
    setTraces(prev => {
      if (prev.length === 0) return prev
      
      const [current, ...rest] = prev
      return [{ ...current, completedAt, status, totalCost, output }, ...rest]
    })
  }, [])

  /** 处理追踪事件 (统一入口) */
  const handleTraceEvent = useCallback((event: TraceEvent) => {
    switch (event.type) {
      case 'trace-start':
        handleTraceStart(event.data.requestId, event.data.startedAt, event.data.systemPrompt, event.data.tools)
        break
      case 'trace-step':
        handleTraceStep(event.data)
        break
      case 'trace-end':
        handleTraceEnd(event.data.completedAt, event.data.status, event.data.totalCost)
        break
    }
  }, [handleTraceStart, handleTraceStep, handleTraceEnd])

  /** 清空所有追踪 */
  const clearTrace = useCallback(() => {
    setTraces([])
    setSystemPrompt(null)
  }, [])

  return {
    traces,
    modelParams,
    setModelParams,
    systemPrompt,
    sessionStats,
    handleTraceEvent,
    handleTraceStart,
    handleTraceStep,
    updateTraceStep,
    handleTraceEnd,
    clearTrace,
    isStreaming,
  }
}

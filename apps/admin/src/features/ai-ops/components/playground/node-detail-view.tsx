/**
 * NodeDetailView Component
 *
 * Drawer 节点详情视图：根据节点 type 渲染对应的详情内容
 * 严格对齐后端 createTracedStreamResponse 发送的 data-trace-step 数据
 *
 * NodeHeader 和 StatusBadge 已提升到 playground-drawer.tsx 的 DrawerHeader
 * user-input 节点由 playground-drawer.tsx 的 UserInputNodePanel 处理
 */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import type { FlowNode, FlowNodeData } from '../../types/flow'
import type { TraceOutput } from '../../types/trace'
import {
  INTENT_DISPLAY_NAMES,
  INTENT_METHOD_NAMES,
  TOOL_DISPLAY_NAMES,
  formatCost,
  formatDuration,
  type IntentType,
} from '../../types/trace'
import { DetailRow } from '../shared/detail-row'
import { JsonViewer } from '../shared/json-viewer'

interface NodeDetailViewProps {
  node: FlowNode | null
  systemPrompt: string | null
  traceOutput: TraceOutput | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNestedRecord(data: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = data[key]
  return isRecord(value) ? value : undefined
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function NodeDetailView({ node, systemPrompt, traceOutput }: NodeDetailViewProps) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">点击画布中的节点查看详情</p>
      </div>
    )
  }

  const { data } = node

  return (
    <div className="space-y-4 p-4">
      {/* 错误信息 */}
      {data.error && <ErrorSection error={data.error} />}

      {/* 根据类型渲染详情 */}
      <NodeContent data={data} systemPrompt={systemPrompt} traceOutput={traceOutput} />
    </div>
  )
}

// ============ 错误区块 ============

function ErrorSection({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    </div>
  )
}

// ============ 节点内容路由 ============

function NodeContent({
  data,
  systemPrompt,
  traceOutput,
}: {
  data: FlowNodeData
  systemPrompt: string | null
  traceOutput: TraceOutput | null
}) {
  switch (data.type) {
    case 'keyword-match':
      return <P0MatchDetail data={data} />
    case 'intent-classify':
      return <P1IntentDetail data={data} />
    case 'processor':
      return <ProcessorDetail data={data} />
    case 'llm':
      return <LLMDetail data={data} systemPrompt={systemPrompt} />
    case 'tool':
      return <ToolDetail data={data} />
    case 'final-output':
      return <FinalOutputDetail data={data} traceOutput={traceOutput} />
    default:
      return <p className="text-sm text-muted-foreground">暂无详情</p>
  }
}

// ============ 各节点类型详情 ============

/** Input Guard 详情 (processor type=input-guard) */
function InputGuardDetail({ data }: { data: Record<string, unknown> }) {
  const output = readNestedRecord(data, 'output')
  const config = readNestedRecord(data, 'config')
  const triggeredRules = readStringList(output?.triggeredRules)

  return (
    <div className="space-y-3">
      <DetailRow label="拦截状态">
        <Badge variant={Boolean(output?.blocked) ? 'destructive' : 'default'}>
          {Boolean(output?.blocked) ? '已拦截' : '通过'}
        </Badge>
      </DetailRow>
      {Boolean(output?.sanitized) && (
        <DetailRow label="净化后文本">
          <p className="text-sm whitespace-pre-wrap">{String(output?.sanitized)}</p>
        </DetailRow>
      )}
      {triggeredRules.length > 0 && (
        <DetailRow label="触发规则">
          <div className="flex flex-wrap gap-1">
            {triggeredRules.map((rule, i) => (
              <Badge key={i} variant="outline" className="text-xs">{rule}</Badge>
            ))}
          </div>
        </DetailRow>
      )}
      {config?.maxLength !== undefined && (
        <DetailRow label="最大长度">
          <span className="text-sm font-mono">{String(config.maxLength)}</span>
        </DetailRow>
      )}
    </div>
  )
}

/** User Profile 详情 */
function UserProfileDetail({ data }: { data: Record<string, unknown> }) {
  const output = readNestedRecord(data, 'output')

  return (
    <div className="space-y-3">
      {output?.preferencesCount !== undefined && (
        <DetailRow label="用户偏好">
          <span className="text-sm font-mono">{String(output.preferencesCount)} 项</span>
        </DetailRow>
      )}
      {output?.locationsCount !== undefined && (
        <DetailRow label="常去地点">
          <span className="text-sm font-mono">{String(output.locationsCount)} 个</span>
        </DetailRow>
      )}
    </div>
  )
}

/** Semantic Recall 详情 */
function SemanticRecallDetail({ data }: { data: Record<string, unknown> }) {
  const output = readNestedRecord(data, 'output')
  const config = readNestedRecord(data, 'config')

  return (
    <div className="space-y-3">
      <DetailRow label="启用状态">
        <Badge variant={Boolean(config?.enabled) ? 'default' : 'secondary'}>
          {Boolean(config?.enabled) ? '已启用' : '未启用'}
        </Badge>
      </DetailRow>
      {Boolean(output?.query) && (
        <DetailRow label="搜索查询">
          <p className="text-sm">{String(output?.query)}</p>
        </DetailRow>
      )}
      {output?.resultCount !== undefined && (
        <DetailRow label="召回结果">
          <span className="text-sm font-mono">{String(output.resultCount)} 条</span>
        </DetailRow>
      )}
      {output?.topScore !== undefined && (
        <DetailRow label="最高相似度">
          <span className="text-sm font-mono">{Number(output.topScore).toFixed(4)}</span>
        </DetailRow>
      )}
    </div>
  )
}

/** Token Limit 详情 */
function TokenLimitDetail({ data }: { data: Record<string, unknown> }) {
  const output = readNestedRecord(data, 'output')
  const config = readNestedRecord(data, 'config')

  return (
    <div className="space-y-3">
      <DetailRow label="截断状态">
        <Badge variant={output?.truncated ? 'secondary' : 'default'}>
          {output?.truncated ? '已截断' : '未截断'}
        </Badge>
      </DetailRow>
      {output?.originalLength !== undefined && output?.finalLength !== undefined ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">长度对比</span>
            <span className="font-mono">
              {String(output.finalLength)} / {String(output.originalLength)} 字符
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary/60"
              style={{ width: '100%' }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{
                width: `${Math.min(100, (Number(output.finalLength) / Number(output.originalLength)) * 100)}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>截断后</span>
            <span>原始</span>
          </div>
        </div>
      ) : (
        <>
          {output?.originalLength !== undefined && (
            <DetailRow label="原始长度">
              <span className="text-sm font-mono">{String(output.originalLength)} 字符</span>
            </DetailRow>
          )}
          {output?.finalLength !== undefined && (
            <DetailRow label="截断后长度">
              <span className="text-sm font-mono">{String(output.finalLength)} 字符</span>
            </DetailRow>
          )}
        </>
      )}
      {config?.maxTokens !== undefined && (
        <DetailRow label="Token 限制">
          <span className="text-sm font-mono">{String(config.maxTokens)}</span>
        </DetailRow>
      )}
    </div>
  )
}

/** Processor 详情路由 */
function ProcessorDetail({ data }: { data: FlowNodeData & { type: 'processor' } }) {
  switch (data.processorType) {
    case 'input-guard':
      return <InputGuardDetail data={data} />
    case 'user-profile':
      return <UserProfileDetail data={data} />
    case 'semantic-recall':
      return <SemanticRecallDetail data={data} />
    case 'token-limit':
      return <TokenLimitDetail data={data} />
    default:
      return (
        <div className="space-y-3">
          {data.summary && (
            <DetailRow label="摘要">
              <p className="text-sm">{data.summary}</p>
            </DetailRow>
          )}
        </div>
      )
  }
}

/** P0 Match 详情 */
function P0MatchDetail({ data }: { data: FlowNodeData & { type: 'keyword-match' } }) {
  return (
    <div className="space-y-3">
      <DetailRow label="命中状态">
        <Badge variant={data.matched ? 'default' : 'secondary'}>
          {data.matched ? '已命中' : '未命中'}
        </Badge>
      </DetailRow>
      {data.keyword && (
        <DetailRow label="关键词">
          <Badge variant="outline">{data.keyword}</Badge>
        </DetailRow>
      )}
      {data.matchType && (
        <DetailRow label="匹配类型">
          <span className="text-sm">{data.matchType}</span>
        </DetailRow>
      )}
      {data.priority !== undefined && (
        <DetailRow label="优先级">
          <span className="text-sm font-mono">{data.priority}</span>
        </DetailRow>
      )}
      {data.responseType && (
        <DetailRow label="响应类型">
          <Badge variant="outline">{data.responseType}</Badge>
        </DetailRow>
      )}
    </div>
  )
}

/** P1 Intent 详情 */
function P1IntentDetail({ data }: { data: FlowNodeData & { type: 'intent-classify' } }) {
  const intentLabel = INTENT_DISPLAY_NAMES[data.intent as IntentType] ?? data.intent
  const methodLabel = INTENT_METHOD_NAMES[data.method] ?? data.method
  const structuredAction = typeof data.action === 'string' ? data.action : undefined
  const phase = typeof data.phase === 'string' ? data.phase : undefined

  return (
    <div className="space-y-3">
      <DetailRow label="意图类型">
        <Badge>{intentLabel}</Badge>
      </DetailRow>
      <DetailRow label={data.method === 'structured_action' ? '执行路径' : '识别方法'}>
        <span className="text-sm">{methodLabel}</span>
      </DetailRow>
      {data.method === 'structured_action' && structuredAction && (
        <DetailRow label="动作">
          <Badge variant="outline" className="font-mono">{structuredAction}</Badge>
        </DetailRow>
      )}
      {data.method === 'structured_action' && phase && (
        <DetailRow label="阶段">
          <span className="text-sm">{getStructuredActionPhaseLabel(phase)}</span>
        </DetailRow>
      )}
      {data.confidence !== undefined && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">置信度</span>
            <span className="text-sm font-mono">{(data.confidence * 100).toFixed(1)}%</span>
          </div>
          <Progress value={data.confidence * 100} className="h-2" />
        </div>
      )}
    </div>
  )
}

function getStructuredActionPhaseLabel(phase: string): string {
  switch (phase) {
    case 'resolved':
      return '已判定'
    case 'executed':
      return '已执行'
    default:
      return phase
  }
}

/** LLM 详情 */
function LLMDetail({
  data,
  systemPrompt,
}: {
  data: FlowNodeData & { type: 'llm' }
  systemPrompt: string | null
}) {
  const speed =
    data.duration && data.outputTokens
      ? ((data.outputTokens / data.duration) * 1000).toFixed(1)
      : null

  return (
    <div className="space-y-3">
      <DetailRow label="模型">
        <Badge variant="outline">{data.model}</Badge>
      </DetailRow>
      <DetailRow label="输入 Token">
        <span className="text-sm font-mono">{data.inputTokens?.toLocaleString()}</span>
      </DetailRow>
      <DetailRow label="输出 Token">
        <span className="text-sm font-mono">{data.outputTokens?.toLocaleString()}</span>
      </DetailRow>
      <DetailRow label="总 Token">
        <span className="text-sm font-mono">{data.totalTokens?.toLocaleString()}</span>
      </DetailRow>
      {speed && (
        <DetailRow label="生成速度">
          <span className="text-sm font-mono">{speed} tokens/s</span>
        </DetailRow>
      )}

      {/* System Prompt 可展开 */}
      {systemPrompt && (
        <>
          <Separator />
          <CollapsibleSection title="System Prompt">
            <pre className="whitespace-pre-wrap text-xs font-mono bg-muted/50 rounded-md p-3 max-h-[300px] overflow-y-auto">
              {systemPrompt}
            </pre>
          </CollapsibleSection>
        </>
      )}
    </div>
  )
}

/** Tool 详情 */
function ToolDetail({ data }: { data: FlowNodeData & { type: 'tool' } }) {
  const displayName = TOOL_DISPLAY_NAMES[data.toolName] ?? data.toolDisplayName ?? data.toolName

  return (
    <div className="space-y-3">
      <DetailRow label="工具名称">
        <div className="flex items-center gap-2">
          <Badge>{displayName}</Badge>
          <span className="text-xs text-muted-foreground font-mono">{data.toolName}</span>
        </div>
      </DetailRow>
      {data.widgetType && (
        <DetailRow label="Widget 类型">
          <Badge variant="outline">{data.widgetType}</Badge>
        </DetailRow>
      )}

      {/* 输入参数 */}
      {data.input && (
        <>
          <Separator />
          <CollapsibleSection title="输入参数" defaultOpen>
            <JsonViewer data={data.input} maxHeight={200} />
          </CollapsibleSection>
        </>
      )}

      {/* 输出结果 */}
      {data.output && (
        <>
          <Separator />
          <CollapsibleSection title="输出结果" defaultOpen>
            <JsonViewer data={data.output} maxHeight={200} />
          </CollapsibleSection>
        </>
      )}

      {/* 评估结果 */}
      {data.evaluation && (
        <>
          <Separator />
          <CollapsibleSection title="评估结果" defaultOpen>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">评估状态</span>
                <Badge variant={data.evaluation.passed ? 'default' : 'destructive'}>
                  {data.evaluation.passed ? '通过' : '未通过'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">质量评分</span>
                <span className="text-sm font-mono">{data.evaluation.score}/10</span>
              </div>
              {data.evaluation.toneScore !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">语气评分</span>
                  <span className="text-sm font-mono">{data.evaluation.toneScore}/5</span>
                </div>
              )}
              {data.evaluation.relevanceScore !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">相关性</span>
                  <span className="text-sm font-mono">{data.evaluation.relevanceScore}/5</span>
                </div>
              )}
              {data.evaluation.contextScore !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">上下文利用</span>
                  <span className="text-sm font-mono">{data.evaluation.contextScore}/5</span>
                </div>
              )}
              {data.evaluation.issues.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-sm text-muted-foreground">发现问题</span>
                  <div className="space-y-1">
                    {data.evaluation.issues.map((issue, i) => (
                      <div key={i} className="text-sm text-destructive bg-destructive/5 rounded px-2 py-1">
                        {issue}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>
        </>
      )}
    </div>
  )
}

/** 最终响应详情 */
function FinalOutputDetail({
  data,
  traceOutput,
}: {
  data: FlowNodeData & { type: 'final-output' }
  traceOutput: TraceOutput | null
}) {
  // 从 traceOutput (data-trace-end) 获取完整输出
  const text = traceOutput?.text
  const toolCalls = traceOutput?.toolCalls ?? []

  // 费用计算
  const totalTokens = data.totalTokens ?? 0
  const cost = data.totalCost ?? 0

  return (
    <div className="space-y-3">
      {/* AI 回复全文 */}
      {text && (
        <CollapsibleSection title="AI 回复" defaultOpen>
          <div className="rounded-md bg-muted/50 p-3 max-h-[300px] overflow-y-auto">
            <p className="text-sm whitespace-pre-wrap">{text}</p>
          </div>
        </CollapsibleSection>
      )}

      {/* Tool 调用列表 */}
      {toolCalls.length > 0 && (
        <>
          <Separator />
          <CollapsibleSection title={`Tool 调用 (${toolCalls.length})`} defaultOpen>
            <div className="space-y-2">
              {toolCalls.map((call, i) => (
                <div key={i} className="rounded-md border p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{call.displayName || call.name}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    输入: {JSON.stringify(call.input).slice(0, 100)}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </>
      )}

      <Separator />

      {/* 统计 */}
      <p className="text-xs font-medium text-muted-foreground">统计</p>
      {data.totalDuration !== undefined && (
        <DetailRow label="总耗时">
          <span className="text-sm font-mono">{formatDuration(data.totalDuration)}</span>
        </DetailRow>
      )}
      {totalTokens > 0 && (
        <DetailRow label="总 Token">
          <span className="text-sm font-mono">{totalTokens.toLocaleString()}</span>
        </DetailRow>
      )}
      {cost > 0 && (
        <DetailRow label="成本粗估">
          <span className="text-sm font-mono">${formatCost(cost)}</span>
        </DetailRow>
      )}
      {data.toolCallCount !== undefined && (
        <DetailRow label="Tool 调用数">
          <span className="text-sm font-mono">{data.toolCallCount}</span>
        </DetailRow>
      )}
    </div>
  )
}

// ============ 通用子组件 ============

/** 可折叠区块 */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm font-medium hover:text-foreground text-muted-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
      </button>
      {open && children}
    </div>
  )
}

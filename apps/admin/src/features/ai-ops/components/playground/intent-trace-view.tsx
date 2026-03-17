/**
 * IntentTraceView Component
 *
 * 展示意图分类 Trace：分类层级（P0/P1/P2）、匹配模式、置信度分数和分类耗时
 * 可集成到瀑布图的 intent-classify-processor 节点详情中
 */

import { Badge } from '@/components/ui/badge'
import { INTENT_DISPLAY_NAMES, formatDuration, type IntentType } from '../../types/trace'
import type { ExecutionTrace } from '../../types/trace'

interface IntentTraceViewProps {
  trace: ExecutionTrace | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function IntentTraceView({ trace }: IntentTraceViewProps) {
  if (!trace) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        暂无分类数据
      </div>
    )
  }

  // 从 trace steps 中提取 P0 和 P1/P2 数据
  const p0Step = trace.steps.find((step) => step.type === 'keyword-match' || step.name.includes('keyword'))
  const intentStep = trace.steps.find((step) => step.type === 'intent-classify' || step.name.includes('intent'))
  const structuredActionSteps = trace.steps.filter((step) => step.type === 'structured-action')

  const intent = trace.intent
  const method = trace.intentMethod
  const intentLabel = intent ? (INTENT_DISPLAY_NAMES[intent as IntentType] ?? intent) : '未知'
  const structuredActionDuration = structuredActionSteps[structuredActionSteps.length - 1]?.duration

  // 从 step data 提取详细信息
  const p0Data = isRecord(p0Step?.data) ? p0Step.data : undefined
  const intentData = isRecord(intentStep?.data) ? intentStep.data : undefined

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-sm font-medium">意图 / 动作 Trace</h3>

      {/* 最终结果 */}
      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">最终意图</span>
          <Badge>{intentLabel}</Badge>
        </div>
        {method && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">分类方法</span>
            <Badge variant="outline" className="text-xs">{getMethodLabel(method)}</Badge>
          </div>
        )}
        {intentData?.confidence !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">置信度</span>
            <span className="text-xs font-mono">{(Number(intentData.confidence) * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {method === 'structured_action' ? (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">结构化动作链路</span>
          {structuredActionSteps.length > 0 ? structuredActionSteps.map((step) => {
            const stepData = isRecord(step.data) ? step.data : undefined
            const action = typeof stepData?.action === 'string' ? stepData.action : undefined
            const phase = typeof stepData?.phase === 'string' ? stepData.phase : undefined

            return (
              <FunnelLayer
                key={step.id}
                layer={getStructuredActionLayerLabel(phase)}
                label={step.name}
                matched={step.status === 'success'}
                duration={step.duration}
                detail={action ? `动作: ${action}` : undefined}
              />
            )
          }) : (
            <FunnelLayer
              layer="直达"
              label="结构化动作"
              matched
              detail="本轮直接命中结构化动作，没有进入模型编排。"
            />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">分类漏斗</span>

          {/* P0 Layer */}
          <FunnelLayer
            layer="P0"
            label="关键词匹配"
            matched={Boolean(p0Data?.matched)}
            duration={p0Step?.duration}
            detail={p0Data?.keyword ? `关键词: ${p0Data.keyword}` : undefined}
          />

          {/* P1 Layer */}
          <FunnelLayer
            layer="P1"
            label="Feature_Combination"
            matched={method === 'regex' && !p0Data?.matched}
            duration={readNumber(intentData?.p1Duration)}
            detail={intentData?.p1Features ? `命中特征: ${JSON.stringify(intentData.p1Features)}` : undefined}
            confidence={readNumber(intentData?.p1Confidence)}
          />

          {/* P2 Layer */}
          <FunnelLayer
            layer="P2"
            label="LLM Few-shot"
            matched={method === 'llm'}
            duration={readNumber(intentData?.p2Duration)}
            detail={intentData?.degraded ? '降级触发' : undefined}
            confidence={readNumber(intentData?.p2Confidence)}
          />
        </div>
      )}

      {/* 总耗时 */}
      {(method === 'structured_action' ? structuredActionDuration : intentStep?.duration) !== undefined && (
        <div className="flex items-center justify-between text-xs border-t pt-2">
          <span className="text-muted-foreground">{method === 'structured_action' ? '动作总耗时' : '分类总耗时'}</span>
          <span className="font-mono">
            {formatDuration(method === 'structured_action' ? structuredActionDuration ?? 0 : intentStep?.duration ?? 0)}
          </span>
        </div>
      )}
    </div>
  )
}

function FunnelLayer({
  layer,
  label,
  matched,
  duration,
  detail,
  confidence,
}: {
  layer: string
  label: string
  matched: boolean
  duration?: number
  detail?: string
  confidence?: number
}) {
  return (
    <div className={`rounded-md border p-2 ${matched ? 'border-primary/50 bg-primary/5' : 'opacity-60'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={matched ? 'default' : 'outline'} className="text-[10px]">{layer}</Badge>
          <span className="text-xs">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {confidence !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground">{(confidence * 100).toFixed(1)}%</span>
          )}
          {duration !== undefined && (
            <span className="text-[10px] font-mono text-muted-foreground">{formatDuration(duration)}</span>
          )}
        </div>
      </div>
      {detail && <p className="text-[10px] text-muted-foreground mt-1">{detail}</p>}
    </div>
  )
}

function getMethodLabel(method: string): string {
  switch (method) {
    case 'regex': return 'P1 规则引擎'
    case 'llm': return 'P2 LLM'
    case 'structured_action': return '结构化动作'
    default: return method
  }
}

function getStructuredActionLayerLabel(phase?: string): string {
  switch (phase) {
    case 'resolved':
      return '判定'
    case 'executed':
      return '执行'
    default:
      return '直达'
  }
}

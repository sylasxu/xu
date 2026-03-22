/**
 * SessionStatsBar Component
 *
 * 画布底部固定浮层，半透明背景，紧凑单行布局
 * 显示：实际模型 | 链路来源 | 轮次数 | Token 消耗 | 耗时 | 费用
 */

import { formatCost, formatDuration, MODEL_PRICE, type SessionStats } from '../../types/trace'
import { splitRouteIdentifier } from '../../model-routing'

interface SessionStatsBarProps {
  model: string
  modelSourceLabel: string
  modelSourceTitle?: string
  stats: SessionStats
}

export function SessionStatsBar({
  model,
  modelSourceLabel,
  modelSourceTitle,
  stats,
}: SessionStatsBarProps) {
  if (stats.totalRounds === 0) return null

  const pricingModelKey = splitRouteIdentifier(model).modelId
  const price = MODEL_PRICE[pricingModelKey]
  const priceLabel = price
    ? `输入 ¥${(price.input * 1_000_000).toFixed(1)}/M · 输出 ¥${(price.output * 1_000_000).toFixed(1)}/M`
    : undefined

  return (
    <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-lg border bg-background/80 backdrop-blur-md px-4 py-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{model}</span>
        <Separator />
        <span title={modelSourceTitle} className="cursor-help">
          {modelSourceLabel}
        </span>
        <Separator />
        <span>{stats.totalRounds} 轮</span>
        <Separator />
        <span>{stats.totalTokens.toLocaleString()} tokens</span>
        <Separator />
        <span>{formatDuration(stats.totalDuration)}</span>
        <Separator />
        <span title={priceLabel ?? '当前模型未配置成本粗估'} className="cursor-help">
          ${formatCost(stats.estimatedCost)}
        </span>
      </div>
    </div>
  )
}

function Separator() {
  return <span className="text-muted-foreground/30">|</span>
}

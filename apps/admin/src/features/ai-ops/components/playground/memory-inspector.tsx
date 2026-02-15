/**
 * MemoryInspector Component
 *
 * 展示当前用户的 Working Memory 内容
 * 包括每个偏好的类别、情感、置信度、mentionCount 和最后更新时间
 */

import { Badge } from '@/components/ui/badge'

interface Preference {
  category: string
  value: string
  sentiment: 'positive' | 'negative' | 'neutral'
  confidence: number
  mentionCount?: number
  updatedAt?: string
}

interface WorkingMemory {
  preferences?: Preference[]
  frequentLocations?: Array<{ name: string; count: number }>
  interestVector?: Record<string, number>
}

interface MemoryInspectorProps {
  workingMemory: WorkingMemory | null
}

export function MemoryInspector({ workingMemory }: MemoryInspectorProps) {
  if (!workingMemory) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        暂无 Working Memory 数据
      </div>
    )
  }

  const preferences = workingMemory.preferences ?? []
  const locations = workingMemory.frequentLocations ?? []

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-sm font-medium">Memory Inspector</h3>

      {/* 偏好列表 */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">偏好 ({preferences.length})</span>
        {preferences.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">暂无偏好数据</p>
        )}
        {preferences.map((pref, i) => (
          <div key={i} className="rounded-md border p-2 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">{pref.category}</Badge>
                <SentimentBadge sentiment={pref.sentiment} />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">
                {(pref.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-xs">{pref.value}</p>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              {pref.mentionCount !== undefined && <span>提及 {pref.mentionCount} 次</span>}
              {pref.updatedAt && <span>{formatRelativeTime(pref.updatedAt)}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* 常去地点 */}
      {locations.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">常去地点</span>
          <div className="flex flex-wrap gap-1.5">
            {locations.map((loc, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {loc.name} ({loc.count})
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* 兴趣向量 */}
      {workingMemory.interestVector && Object.keys(workingMemory.interestVector).length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">兴趣向量</span>
          <div className="space-y-1">
            {Object.entries(workingMemory.interestVector)
              .sort(([, a], [, b]) => b - a)
              .map(([key, val]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs w-20 truncate">{key}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary/50 rounded-full" style={{ width: `${Math.min(val * 100, 100)}%` }} />
                  </div>
                  <span className="text-[10px] font-mono w-10 text-right">{val.toFixed(2)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const config: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' }> = {
    positive: { label: '👍', variant: 'default' },
    negative: { label: '👎', variant: 'destructive' },
    neutral: { label: '➖', variant: 'secondary' },
  }
  const c = config[sentiment] ?? config.neutral
  return <Badge variant={c.variant} className="text-[10px] px-1">{c.label}</Badge>
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

/**
 * IntentABCompare Component
 *
 * 对同一输入分别展示 P0 关键词匹配、P1 规则引擎和 P2 LLM 的分类结果及置信度
 */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Play } from 'lucide-react'
import { INTENT_DISPLAY_NAMES, type IntentType } from '../../types/trace'

interface ClassifyResult {
  layer: 'P0' | 'P1' | 'P2'
  intent: string
  confidence: number
  method: string
  duration: number
  details?: Record<string, unknown>
}

export function IntentABCompare() {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<ClassifyResult[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const handleCompare = () => {
    if (!input.trim()) return
    setResults([])
    setNotice('当前后端未提供真实的意图分类对比接口，无法执行 A/B 对比。')
  }

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-sm font-medium">意图分类 A/B 对比</h3>

      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            if (notice) {
              setNotice(null)
            }
          }}
          placeholder="输入测试文本..."
          className="h-8 text-sm flex-1"
          onKeyDown={(e) => e.key === 'Enter' && handleCompare()}
        />
        <Button size="sm" onClick={handleCompare} disabled={!input.trim()}>
          <Play className="h-3.5 w-3.5" />
        </Button>
      </div>

      {notice && (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.layer} className="rounded-md border p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-mono">{r.layer}</Badge>
                  <span className="text-xs text-muted-foreground">{r.method}</span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">{r.duration}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <Badge variant={r.confidence > 0 ? 'default' : 'secondary'}>
                  {INTENT_DISPLAY_NAMES[r.intent as IntentType] ?? r.intent}
                </Badge>
                <span className="text-xs font-mono">
                  {r.confidence > 0 ? `${(r.confidence * 100).toFixed(1)}%` : '-'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

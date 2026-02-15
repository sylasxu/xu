/**
 * IntentABCompare Component
 *
 * 对同一输入分别展示 P0 关键词匹配、P1 规则引擎和 P2 LLM 的分类结果及置信度
 */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Play } from 'lucide-react'
import { api, unwrap } from '@/lib/eden'
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
  const [loading, setLoading] = useState(false)

  const handleCompare = async () => {
    if (!input.trim() || loading) return
    setLoading(true)
    setResults([])

    try {
      // 调用 A/B 对比 API（如果存在），否则模拟
      const data = await unwrap(
        (api.ai as any).classify.compare.post({ input: input.trim() })
      ).catch(() => null)

      if (data && Array.isArray(data)) {
        setResults(data as ClassifyResult[])
      } else {
        // 降级：显示提示
        setResults([
          { layer: 'P0', intent: 'unknown', confidence: 0, method: '关键词匹配', duration: 0, details: { note: '需要后端 /ai/classify/compare 端点' } },
          { layer: 'P1', intent: 'unknown', confidence: 0, method: 'Feature_Combination', duration: 0 },
          { layer: 'P2', intent: 'unknown', confidence: 0, method: 'LLM Few-shot', duration: 0 },
        ])
      }
    } catch {
      // 静默处理
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-sm font-medium">意图分类 A/B 对比</h3>

      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入测试文本..."
          className="h-8 text-sm flex-1"
          onKeyDown={(e) => e.key === 'Enter' && handleCompare()}
        />
        <Button size="sm" onClick={handleCompare} disabled={loading || !input.trim()}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
      </div>

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

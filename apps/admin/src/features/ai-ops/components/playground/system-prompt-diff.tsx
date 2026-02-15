/**
 * SystemPromptDiff Component
 *
 * 展示最终组装的完整系统提示词
 * 高亮标注各注入段落来源（user-profile、semantic-recall、working-memory）
 * 支持与基础 System Prompt 的 diff 对比视图
 */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Diff, Eye } from 'lucide-react'

interface SystemPromptDiffProps {
  systemPrompt: string | null
  basePrompt?: string
}

/** 注入段落标记模式 */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string; color: string }> = [
  { pattern: /\[用户画像\][\s\S]*?\[\/用户画像\]/g, label: 'user-profile', color: 'bg-blue-500/10 border-blue-500/30' },
  { pattern: /\[语义召回\][\s\S]*?\[\/语义召回\]/g, label: 'semantic-recall', color: 'bg-green-500/10 border-green-500/30' },
  { pattern: /\[工作记忆\][\s\S]*?\[\/工作记忆\]/g, label: 'working-memory', color: 'bg-purple-500/10 border-purple-500/30' },
  { pattern: /\[偏好数据\][\s\S]*?\[\/偏好数据\]/g, label: 'preferences', color: 'bg-amber-500/10 border-amber-500/30' },
]

export function SystemPromptDiff({ systemPrompt, basePrompt }: SystemPromptDiffProps) {
  const [showDiff, setShowDiff] = useState(false)

  if (!systemPrompt) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        暂无 System Prompt 数据
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">System Prompt</h3>
        <div className="flex items-center gap-1.5">
          {basePrompt && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowDiff(!showDiff)}>
              {showDiff ? <Eye className="h-3.5 w-3.5 mr-1" /> : <Diff className="h-3.5 w-3.5 mr-1" />}
              {showDiff ? '完整视图' : 'Diff 视图'}
            </Button>
          )}
        </div>
      </div>

      {/* 注入来源图例 */}
      <div className="flex flex-wrap gap-1.5">
        {INJECTION_PATTERNS.map(p => (
          <Badge key={p.label} variant="outline" className="text-[10px]">{p.label}</Badge>
        ))}
      </div>

      {showDiff && basePrompt ? (
        <DiffView base={basePrompt} current={systemPrompt} />
      ) : (
        <HighlightedPrompt text={systemPrompt} />
      )}
    </div>
  )
}

/** 高亮注入段落的完整视图 */
function HighlightedPrompt({ text }: { text: string }) {
  const segments = parseSegments(text)

  return (
    <pre className="whitespace-pre-wrap text-xs font-mono bg-muted/30 rounded-md p-3 max-h-[400px] overflow-y-auto">
      {segments.map((seg, i) => (
        <span key={i} className={seg.injected ? `border rounded px-0.5 ${seg.color}` : ''}>
          {seg.injected && (
            <Badge variant="outline" className="text-[8px] mr-1 align-top">{seg.label}</Badge>
          )}
          {seg.text}
        </span>
      ))}
    </pre>
  )
}

/** 简单 Diff 视图：标记新增行 */
function DiffView({ base, current }: { base: string; current: string }) {
  const baseLines = base.split('\n')
  const currentLines = current.split('\n')
  const baseSet = new Set(baseLines.map(l => l.trim()))

  return (
    <pre className="whitespace-pre-wrap text-xs font-mono bg-muted/30 rounded-md p-3 max-h-[400px] overflow-y-auto">
      {currentLines.map((line, i) => {
        const isNew = !baseSet.has(line.trim()) && line.trim().length > 0
        return (
          <div key={i} className={isNew ? 'bg-green-500/10 border-l-2 border-green-500 pl-2' : ''}>
            {isNew && <span className="text-green-600 mr-1">+</span>}
            {line}
          </div>
        )
      })}
    </pre>
  )
}

interface Segment {
  text: string
  injected: boolean
  label?: string
  color?: string
}

function parseSegments(text: string): Segment[] {
  // 找到所有注入区域
  const injections: Array<{ start: number; end: number; label: string; color: string }> = []

  for (const p of INJECTION_PATTERNS) {
    let match: RegExpExecArray | null
    const regex = new RegExp(p.pattern.source, p.pattern.flags)
    while ((match = regex.exec(text)) !== null) {
      injections.push({ start: match.index, end: match.index + match[0].length, label: p.label, color: p.color })
    }
  }

  injections.sort((a, b) => a.start - b.start)

  if (injections.length === 0) return [{ text, injected: false }]

  const segments: Segment[] = []
  let cursor = 0

  for (const inj of injections) {
    if (cursor < inj.start) {
      segments.push({ text: text.slice(cursor, inj.start), injected: false })
    }
    segments.push({ text: text.slice(inj.start, inj.end), injected: true, label: inj.label, color: inj.color })
    cursor = inj.end
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), injected: false })
  }

  return segments
}

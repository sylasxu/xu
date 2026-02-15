// Feature_Combination 规则编辑器
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Trash2, Save, History } from 'lucide-react'
import { useAiConfigDetail, useUpdateAiConfig } from '../../hooks/use-ai-config'

const CONFIG_KEY = 'intent.feature_rules'

interface FeatureSignal {
  keywords: string[]
  syntaxPattern?: string
}

interface FeatureRule {
  intent: string
  signals: FeatureSignal[]
  baseConfidence: number
  signalBoost: number
  maxConfidence: number
}

interface Props {
  onSelectConfig: (key: string | null) => void
}

export function FeatureRulesEditor({ onSelectConfig }: Props) {
  const { data, isLoading } = useAiConfigDetail(CONFIG_KEY)
  const updateConfig = useUpdateAiConfig()
  const [rules, setRules] = useState<FeatureRule[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  useEffect(() => {
    if (data?.configValue && Array.isArray(data.configValue)) {
      setRules(data.configValue as FeatureRule[])
    }
  }, [data])

  const handleSave = () => {
    updateConfig.mutate({ configKey: CONFIG_KEY, configValue: rules })
  }

  const addRule = () => {
    setRules([...rules, {
      intent: 'unknown',
      signals: [{ keywords: [] }],
      baseConfidence: 0.6,
      signalBoost: 0.15,
      maxConfidence: 0.95,
    }])
    setEditingIndex(rules.length)
  }

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index))
    if (editingIndex === index) setEditingIndex(null)
  }

  const updateRule = (index: number, field: keyof FeatureRule, value: unknown) => {
    const updated = [...rules]
    updated[index] = { ...updated[index], [field]: value }
    setRules(updated)
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg">意图分类规则 (P1 Feature_Combination)</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onSelectConfig(CONFIG_KEY)}>
            <History className="h-4 w-4 mr-1" />
            历史
          </Button>
          <Button size="sm" onClick={addRule}>
            <Plus className="h-4 w-4 mr-1" />
            新增规则
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            保存
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            暂无配置，使用代码默认规则。点击「新增规则」开始配置。
          </p>
        )}
        {rules.map((rule, index) => (
          <div
            key={index}
            className={`rounded-lg border p-3 cursor-pointer transition-colors ${editingIndex === index ? 'border-primary bg-muted/30' : 'hover:bg-muted/20'}`}
            onClick={() => setEditingIndex(editingIndex === index ? null : index)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{rule.intent}</Badge>
                <span className="text-xs text-muted-foreground">
                  {rule.signals.length} 个信号 · 置信度 {rule.baseConfidence}~{rule.maxConfidence}
                </span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); removeRule(index) }}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>

            {editingIndex === index && (
              <div className="mt-3 space-y-3 border-t pt-3" onClick={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">意图</Label>
                    <Input value={rule.intent} onChange={(e) => updateRule(index, 'intent', e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">基础置信度</Label>
                    <Input type="number" step="0.05" min="0" max="1" value={rule.baseConfidence} onChange={(e) => updateRule(index, 'baseConfidence', parseFloat(e.target.value) || 0)} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">信号增量</Label>
                    <Input type="number" step="0.05" min="0" max="1" value={rule.signalBoost} onChange={(e) => updateRule(index, 'signalBoost', parseFloat(e.target.value) || 0)} className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">最大置信度</Label>
                    <Input type="number" step="0.05" min="0" max="1" value={rule.maxConfidence} onChange={(e) => updateRule(index, 'maxConfidence', parseFloat(e.target.value) || 0)} className="h-8 text-sm" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">信号列表（每行一组关键词，逗号分隔）</Label>
                  {rule.signals.map((signal, si) => (
                    <div key={si} className="flex items-center gap-2 mt-1">
                      <Input
                        value={signal.keywords.join(', ')}
                        onChange={(e) => {
                          const updated = [...rules]
                          updated[index].signals[si] = {
                            ...signal,
                            keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                          }
                          setRules(updated)
                        }}
                        placeholder="关键词1, 关键词2, ..."
                        className="h-8 text-sm flex-1"
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
                        const updated = [...rules]
                        updated[index].signals = updated[index].signals.filter((_, i) => i !== si)
                        setRules(updated)
                      }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" className="mt-1 h-7 text-xs" onClick={() => {
                    const updated = [...rules]
                    updated[index].signals = [...updated[index].signals, { keywords: [] }]
                    setRules(updated)
                  }}>
                    <Plus className="h-3 w-3 mr-1" />
                    添加信号
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

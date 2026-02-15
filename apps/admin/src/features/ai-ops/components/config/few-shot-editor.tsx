// Few-shot 样例编辑器
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea as _Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Trash2, Save, History, AlertCircle } from 'lucide-react'
import { useAiConfigDetail, useUpdateAiConfig } from '../../hooks/use-ai-config'

const CONFIG_KEY = 'intent.few_shot_examples'
const MIN_EXAMPLES = 5
const MAX_EXAMPLES = 8

interface FewShotExample {
  input: string
  intent: string
  explanation: string
}

interface Props {
  onSelectConfig: (key: string | null) => void
}

export function FewShotEditor({ onSelectConfig }: Props) {
  const { data, isLoading } = useAiConfigDetail(CONFIG_KEY)
  const updateConfig = useUpdateAiConfig()
  const [examples, setExamples] = useState<FewShotExample[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  useEffect(() => {
    if (data?.configValue && Array.isArray(data.configValue)) {
      setExamples(data.configValue as FewShotExample[])
    }
  }, [data])

  const handleSave = () => {
    if (examples.length < MIN_EXAMPLES || examples.length > MAX_EXAMPLES) return
    updateConfig.mutate({ configKey: CONFIG_KEY, configValue: examples })
  }

  const addExample = () => {
    if (examples.length >= MAX_EXAMPLES) return
    setExamples([...examples, { input: '', intent: '', explanation: '' }])
    setEditingIndex(examples.length)
  }

  const removeExample = (index: number) => {
    setExamples(examples.filter((_, i) => i !== index))
    if (editingIndex === index) setEditingIndex(null)
  }

  const updateExample = (index: number, field: keyof FewShotExample, value: string) => {
    const updated = [...examples]
    updated[index] = { ...updated[index], [field]: value }
    setExamples(updated)
  }

  const countValid = examples.length >= MIN_EXAMPLES && examples.length <= MAX_EXAMPLES

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
        <CardTitle className="text-lg">Few-shot 标注样例 (P2 LLM 分类)</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onSelectConfig(CONFIG_KEY)}>
            <History className="h-4 w-4 mr-1" />
            历史
          </Button>
          <Button size="sm" onClick={addExample} disabled={examples.length >= MAX_EXAMPLES}>
            <Plus className="h-4 w-4 mr-1" />
            新增样例
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateConfig.isPending || !countValid}>
            {updateConfig.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            保存
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!countValid && examples.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-md px-3 py-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            样例数量需在 {MIN_EXAMPLES}~{MAX_EXAMPLES} 个之间，当前 {examples.length} 个
          </div>
        )}
        {examples.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            暂无配置，使用代码默认样例。点击「新增样例」开始配置。
          </p>
        )}
        {examples.map((example, index) => (
          <div
            key={index}
            className={`rounded-lg border p-3 cursor-pointer transition-colors ${editingIndex === index ? 'border-primary bg-muted/30' : 'hover:bg-muted/20'}`}
            onClick={() => setEditingIndex(editingIndex === index ? null : index)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline">{example.intent || '未设置'}</Badge>
                <span className="text-sm text-muted-foreground truncate">{example.input || '空输入'}</span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); removeExample(index) }}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>

            {editingIndex === index && (
              <div className="mt-3 space-y-3 border-t pt-3" onClick={(e) => e.stopPropagation()}>
                <div>
                  <Label className="text-xs">用户输入</Label>
                  <Input value={example.input} onChange={(e) => updateExample(index, 'input', e.target.value)} placeholder="例：周末想找人一起打羽毛球" className="h-8 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">意图</Label>
                    <Input value={example.intent} onChange={(e) => updateExample(index, 'intent', e.target.value)} placeholder="例：create" className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">解释</Label>
                    <Input value={example.explanation} onChange={(e) => updateExample(index, 'explanation', e.target.value)} placeholder="例：用户想创建活动" className="h-8 text-sm" />
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

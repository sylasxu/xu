// 模型路由配置编辑器
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Trash2, Save, History } from 'lucide-react'
import { useAiConfigDetail, useUpdateAiConfig } from '../../hooks/use-ai-config'

const CONFIG_KEY = 'model.fallback_config'

interface ModelMapping {
  intent: string
  model: string
  fallbackModel: string
  maxRetries: number
}

interface FallbackConfig {
  mappings: ModelMapping[]
  enableFallback: boolean
  retryDelayMs: number
}

const DEFAULT_CONFIG: FallbackConfig = {
  mappings: [],
  enableFallback: true,
  retryDelayMs: 1000,
}

interface Props {
  onSelectConfig: (key: string | null) => void
}

export function ModelRouterEditor({ onSelectConfig }: Props) {
  const { data, isLoading } = useAiConfigDetail(CONFIG_KEY)
  const updateConfig = useUpdateAiConfig()
  const [config, setConfig] = useState<FallbackConfig>(DEFAULT_CONFIG)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  useEffect(() => {
    if (data?.configValue && typeof data.configValue === 'object') {
      setConfig({ ...DEFAULT_CONFIG, ...(data.configValue as Partial<FallbackConfig>) })
    }
  }, [data])

  const handleSave = () => {
    updateConfig.mutate({ configKey: CONFIG_KEY, configValue: config })
  }

  const addMapping = () => {
    setConfig({
      ...config,
      mappings: [...config.mappings, { intent: '', model: 'qwen-flash', fallbackModel: 'deepseek-chat', maxRetries: 2 }],
    })
    setEditingIndex(config.mappings.length)
  }

  const removeMapping = (index: number) => {
    setConfig({ ...config, mappings: config.mappings.filter((_, i) => i !== index) })
    if (editingIndex === index) setEditingIndex(null)
  }

  const updateMapping = (index: number, field: keyof ModelMapping, value: string | number) => {
    const updated = [...config.mappings]
    updated[index] = { ...updated[index], [field]: value }
    setConfig({ ...config, mappings: updated })
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
        <CardTitle className="text-lg">模型路由配置</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onSelectConfig(CONFIG_KEY)}>
            <History className="h-4 w-4 mr-1" />
            历史
          </Button>
          <Button size="sm" onClick={addMapping}>
            <Plus className="h-4 w-4 mr-1" />
            新增映射
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            保存
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 全局设置 */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">启用降级策略</p>
            <p className="text-xs text-muted-foreground">当前建议：Qwen 主力，失败时自动切到 DeepSeek</p>
          </div>
          <Switch checked={config.enableFallback} onCheckedChange={(v) => setConfig({ ...config, enableFallback: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">重试延迟 (ms)</Label>
            <Input type="number" min="0" step="500" value={config.retryDelayMs} onChange={(e) => setConfig({ ...config, retryDelayMs: parseInt(e.target.value) || 0 })} className="h-8 text-sm" />
          </div>
        </div>

        {/* 意图→模型映射 */}
        {config.mappings.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            暂无映射，使用代码默认路由。点击「新增映射」开始配置。
          </p>
        )}
        {config.mappings.map((mapping, index) => (
          <div
            key={index}
            className={`rounded-lg border p-3 cursor-pointer transition-colors ${editingIndex === index ? 'border-primary bg-muted/30' : 'hover:bg-muted/20'}`}
            onClick={() => setEditingIndex(editingIndex === index ? null : index)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{mapping.intent || '未设置'}</Badge>
                <span className="text-xs text-muted-foreground">
                  {mapping.model} → {mapping.fallbackModel} (重试 {mapping.maxRetries} 次)
                </span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); removeMapping(index) }}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>

            {editingIndex === index && (
              <div className="mt-3 space-y-3 border-t pt-3" onClick={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">意图</Label>
                    <Input value={mapping.intent} onChange={(e) => updateMapping(index, 'intent', e.target.value)} placeholder="create" className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">主模型</Label>
                    <Input value={mapping.model} onChange={(e) => updateMapping(index, 'model', e.target.value)} placeholder="qwen-flash" className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">备选模型</Label>
                    <Input value={mapping.fallbackModel} onChange={(e) => updateMapping(index, 'fallbackModel', e.target.value)} placeholder="deepseek-chat" className="h-8 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">最大重试</Label>
                    <Input type="number" min="0" max="5" value={mapping.maxRetries} onChange={(e) => updateMapping(index, 'maxRetries', parseInt(e.target.value) || 0)} className="h-8 text-sm" />
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

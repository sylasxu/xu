// 处理器管线配置编辑器
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Loader2, Save, History, GripVertical } from 'lucide-react'
import { useAiConfigDetail, useUpdateAiConfig } from '../../hooks/use-ai-config'

const CONFIG_KEY = 'processor.pipeline_config'

interface ProcessorEntry {
  name: string
  enabled: boolean
  parallelGroup?: string
}

interface PipelineConfig {
  processors: ProcessorEntry[]
  disabledProcessors: string[]
}

const DEFAULT_CONFIG: PipelineConfig = {
  processors: [],
  disabledProcessors: [],
}

interface Props {
  onSelectConfig: (key: string | null) => void
}

export function PipelineEditor({ onSelectConfig }: Props) {
  const { data, isLoading } = useAiConfigDetail(CONFIG_KEY)
  const updateConfig = useUpdateAiConfig()
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG)

  useEffect(() => {
    if (data?.configValue && typeof data.configValue === 'object') {
      const raw = data.configValue as Partial<PipelineConfig>
      // 兼容只有 disabledProcessors 的简化格式
      if (raw.processors) {
        setConfig({ ...DEFAULT_CONFIG, ...raw })
      } else if (raw.disabledProcessors) {
        setConfig({
          processors: getDefaultProcessors(raw.disabledProcessors),
          disabledProcessors: raw.disabledProcessors,
        })
      }
    } else {
      setConfig({ processors: getDefaultProcessors([]), disabledProcessors: [] })
    }
  }, [data])

  const handleSave = () => {
    const disabled = config.processors.filter(p => !p.enabled).map(p => p.name)
    updateConfig.mutate({
      configKey: CONFIG_KEY,
      configValue: { ...config, disabledProcessors: disabled },
    })
  }

  const toggleProcessor = (index: number) => {
    const updated = [...config.processors]
    updated[index] = { ...updated[index], enabled: !updated[index].enabled }
    setConfig({ ...config, processors: updated })
  }

  const updateParallelGroup = (index: number, value: string) => {
    const updated = [...config.processors]
    updated[index] = { ...updated[index], parallelGroup: value || undefined }
    setConfig({ ...config, processors: updated })
  }

  const moveProcessor = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= config.processors.length) return
    const updated = [...config.processors]
    ;[updated[index], updated[target]] = [updated[target], updated[index]]
    setConfig({ ...config, processors: updated })
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
        <CardTitle className="text-lg">处理器管线配置</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onSelectConfig(CONFIG_KEY)}>
            <History className="h-4 w-4 mr-1" />
            历史
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            保存
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {config.processors.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            暂无配置，使用代码默认管线。
          </p>
        )}
        {config.processors.map((proc, index) => (
          <div key={proc.name} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveProcessor(index, -1)} disabled={index === 0}>
                <span className="text-xs">↑</span>
              </Button>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => moveProcessor(index, 1)} disabled={index === config.processors.length - 1}>
                <span className="text-xs">↓</span>
              </Button>
            </div>
            <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant={proc.enabled ? 'default' : 'secondary'} className="text-xs">
                  {proc.name}
                </Badge>
                {proc.parallelGroup && (
                  <Badge variant="outline" className="text-xs">
                    并行组: {proc.parallelGroup}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">并行组</Label>
                <Input
                  value={proc.parallelGroup || ''}
                  onChange={(e) => updateParallelGroup(index, e.target.value)}
                  placeholder="无"
                  className="h-7 w-20 text-xs"
                />
              </div>
              <Switch checked={proc.enabled} onCheckedChange={() => toggleProcessor(index)} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** 默认处理器列表（与 pipeline.ts 内置顺序一致） */
function getDefaultProcessors(disabled: string[]): ProcessorEntry[] {
  const defaults = [
    { name: 'intent-classify-processor', parallelGroup: undefined },
    { name: 'user-profile-processor', parallelGroup: 'inject' },
    { name: 'semantic-recall-processor', parallelGroup: 'inject' },
    { name: 'token-limit-processor', parallelGroup: undefined },
  ]
  return defaults.map(d => ({
    ...d,
    enabled: !disabled.includes(d.name),
  }))
}

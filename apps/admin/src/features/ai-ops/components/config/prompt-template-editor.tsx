// Prompt 模板编辑器 — 支持 {{variable}} 高亮、预览、保存
import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Save, History, Eye, EyeOff } from 'lucide-react'
import { useAiConfigDetail, useUpdateAiConfig } from '../../hooks/use-ai-config'

const CONFIG_KEY = 'prompts.system_template'

/** 支持的模板变量 */
const SUPPORTED_VARIABLES = [
  { name: 'timeStr', desc: '当前时间' },
  { name: 'locationStr', desc: '用户位置' },
  { name: 'userNickname', desc: '用户昵称（含前缀）' },
  { name: 'draftJson', desc: '草稿上下文（含前缀）' },
  { name: 'tomorrowStr', desc: '明天日期' },
  { name: 'enrichmentXml', desc: '消息增强上下文' },
  { name: 'widgetCatalog', desc: 'Widget 类型描述' },
  { name: 'workingMemory', desc: '用户画像' },
]

interface Props {
  onSelectConfig: (key: string | null) => void
}

function getConfigVersion(configValue: unknown): string {
  if (!configValue || typeof configValue !== 'object') {
    return '未知'
  }

  const metadata = (configValue as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== 'object') {
    return '未知'
  }

  const version = (metadata as { version?: unknown }).version
  return typeof version === 'string' && version.trim() ? version : '未知'
}

export function PromptTemplateEditor({ onSelectConfig }: Props) {
  const { data, isLoading } = useAiConfigDetail(CONFIG_KEY)
  const updateConfig = useUpdateAiConfig()
  const [template, setTemplate] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 从 DB 加载模板
  useEffect(() => {
    if (data?.configValue) {
      const config = data.configValue as { template?: string }
      if (config.template) {
        setTemplate(config.template)
      }
    }
  }, [data])

  const handleSave = () => {
    updateConfig.mutate({
      configKey: CONFIG_KEY,
      configValue: {
        template,
        metadata: {
          version: `v${Date.now()}`,
          description: '通过 Admin 编辑器更新',
          lastModified: new Date().toISOString(),
          supportedVariables: SUPPORTED_VARIABLES.map(v => v.name),
        },
      },
    })
  }

  const handlePreview = useCallback(async () => {
    if (showPreview) {
      setShowPreview(false)
      return
    }
    setPreviewLoading(true)
    try {
      // 本地预览：替换变量为示例值
      const mockVars: Record<string, string> = {
        timeStr: '2026-02-25 周三 14:00',
        locationStr: '29.5630,106.5516 (观音桥)',
        userNickname: '用户: 测试用户',
        draftJson: '',
        tomorrowStr: '2026-02-26',
        enrichmentXml: '',
        widgetCatalog: '<widget_catalog>\n- widget_draft: 活动草稿卡片\n- widget_explore: 附近活动列表\n</widget_catalog>',
        workingMemory: '喜欢火锅，不喝酒',
      }
      const result = template.replace(/\{\{(\w+)\}\}/g, (_, key) => mockVars[key] ?? '')
      setPreview(result)
      setShowPreview(true)
    } finally {
      setPreviewLoading(false)
    }
  }, [template, showPreview])

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
        <CardTitle className="text-lg">Prompt 模板</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onSelectConfig(CONFIG_KEY)}>
            <History className="h-4 w-4 mr-1" />
            历史
          </Button>
          <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewLoading}>
            {previewLoading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : showPreview ? (
              <EyeOff className="h-4 w-4 mr-1" />
            ) : (
              <Eye className="h-4 w-4 mr-1" />
            )}
            {showPreview ? '编辑' : '预览'}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            保存
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 变量提示 */}
        <div className="flex flex-wrap gap-1.5">
          {SUPPORTED_VARIABLES.map(v => (
            <Badge key={v.name} variant="secondary" className="text-xs cursor-help" title={v.desc}>
              {`{{${v.name}}}`}
            </Badge>
          ))}
        </div>

        {/* 编辑区 / 预览区 */}
        {showPreview ? (
          <pre className="min-h-[500px] max-h-[700px] overflow-auto rounded-md border bg-muted/30 p-4 text-sm whitespace-pre-wrap font-mono">
            {preview}
          </pre>
        ) : (
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="min-h-[500px] w-full rounded-md border bg-background p-4 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="输入 Prompt 模板，使用 {{variableName}} 作为占位符..."
              spellCheck={false}
            />
            {/* 高亮层：覆盖在 textarea 上方显示 {{variable}} 高亮 */}
            <div
              className="pointer-events-none absolute inset-0 overflow-auto rounded-md p-4 text-sm font-mono whitespace-pre-wrap break-words"
              aria-hidden="true"
              style={{ color: 'transparent' }}
              dangerouslySetInnerHTML={{
                __html: template
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(
                    /\{\{(\w+)\}\}/g,
                    '<mark class="bg-primary/20 text-primary rounded px-0.5">{{$1}}</mark>'
                  ),
              }}
            />
          </div>
        )}

        {/* 统计 */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{template.length} 字符</span>
          <span>{(template.match(/\{\{\w+\}\}/g) || []).length} 个变量</span>
          {data && <span>版本 {getConfigVersion(data.configValue)}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

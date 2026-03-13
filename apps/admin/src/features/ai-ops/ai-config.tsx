// AI 配置管理页面
import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, Brain, Route, Workflow, ListTree, FileText } from 'lucide-react'
import { useAiConfigs } from './hooks/use-ai-config'
import { FeatureRulesEditor } from './components/config/feature-rules-editor'
import { FewShotEditor } from './components/config/few-shot-editor'
import { ModelRouterEditor } from './components/config/model-router-editor'
import { PipelineEditor } from './components/config/pipeline-editor'
import { PromptTemplateEditor } from './components/config/prompt-template-editor'
import { ConfigHistoryPanel } from './components/config/config-history-panel'

export function AiConfig() {
  const { isLoading, error, refetch } = useAiConfigs()
  const [selectedConfigKey, setSelectedConfigKey] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center text-destructive">
        加载失败: {error.message}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI 配置管理</h1>
          <p className="text-muted-foreground">管理意图分类、记忆系统、Qwen/DeepSeek 路由和处理器管线的运行时配置</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Tabs defaultValue="intent" className="space-y-4">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="intent" className="flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5" />
                意图分类
              </TabsTrigger>
              <TabsTrigger value="few-shot" className="flex items-center gap-1.5">
                <ListTree className="h-3.5 w-3.5" />
                Few-shot
              </TabsTrigger>
              <TabsTrigger value="model" className="flex items-center gap-1.5">
                <Route className="h-3.5 w-3.5" />
                模型路由
              </TabsTrigger>
              <TabsTrigger value="pipeline" className="flex items-center gap-1.5">
                <Workflow className="h-3.5 w-3.5" />
                处理器管线
              </TabsTrigger>
              <TabsTrigger value="prompt" className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Prompt 模板
              </TabsTrigger>
            </TabsList>

            <TabsContent value="intent">
              <FeatureRulesEditor onSelectConfig={setSelectedConfigKey} />
            </TabsContent>
            <TabsContent value="few-shot">
              <FewShotEditor onSelectConfig={setSelectedConfigKey} />
            </TabsContent>
            <TabsContent value="model">
              <ModelRouterEditor onSelectConfig={setSelectedConfigKey} />
            </TabsContent>
            <TabsContent value="pipeline">
              <PipelineEditor onSelectConfig={setSelectedConfigKey} />
            </TabsContent>
            <TabsContent value="prompt">
              <PromptTemplateEditor onSelectConfig={setSelectedConfigKey} />
            </TabsContent>
          </Tabs>
        </div>

        <div>
          <ConfigHistoryPanel configKey={selectedConfigKey} />
        </div>
      </div>
    </div>
  )
}

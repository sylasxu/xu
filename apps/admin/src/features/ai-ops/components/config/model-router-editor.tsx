import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Loader2, Save, History, Route, Sparkles } from 'lucide-react'
import { useAiConfigDetail, useUpdateAiConfig } from '../../hooks/use-ai-config'
import {
  CHAT_CHAIN_PRESETS,
  DEFAULT_ROUTE_MAP,
  getChatChainLabel,
  getProviderLabel,
  inferProviderName,
  normalizeRouteMapConfig,
  PROVIDER_OPTIONS,
  ROUTE_MAP_CONFIG_KEY,
  splitRouteIdentifier,
  toExplicitRouteIdentifier,
  type ChatChainPreset,
  type ProviderName,
  type RouteKey,
  type RouteMapConfig,
} from '../../model-routing'

const LEGACY_INTENT_MAP_CONFIG_KEY = 'model.intent_map'
const FALLBACK_CONFIG_KEY = 'model.fallback_config'

interface FallbackConfig {
  primary: string
  fallback: string
  maxRetries: number
  enableFallback: boolean
  retryDelay: number
}

interface RouteDefinition {
  key: RouteKey
  label: string
  description: string
  placeholder: string
}

const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  primary: 'openai',
  fallback: 'deepseek',
  maxRetries: 2,
  enableFallback: true,
  retryDelay: 1000,
}

const ROUTE_GROUPS: Array<{ title: string; description: string; routes: RouteDefinition[] }> = [
  {
    title: '聊天链路',
    description: '主聊天、深度推理和 Agent/tool calling 走这里。平时最常切的是这一组。',
    routes: [
      {
        key: 'chat',
        label: '主对话',
        description: '普通聊天、主回复、常规对话理解。',
        placeholder: DEFAULT_ROUTE_MAP.chat,
      },
      {
        key: 'reasoning',
        label: '深度推理',
        description: '复杂判断、深度分析、需要更稳推理时走这里。',
        placeholder: DEFAULT_ROUTE_MAP.reasoning,
      },
      {
        key: 'agent',
        label: 'Agent / Tool Calling',
        description: '需要工具调用、复杂步骤编排的链路。',
        placeholder: DEFAULT_ROUTE_MAP.agent,
      },
    ],
  },
  {
    title: '内容链路',
    description: '内容生成和主题建议单独拆出来，避免跟主聊天链路相互误伤。',
    routes: [
      {
        key: 'content_generation',
        label: '内容生成',
        description: '内容稿、标题、正文、封面文案等结构化生成。',
        placeholder: DEFAULT_ROUTE_MAP.content_generation,
      },
      {
        key: 'content_topic_suggestions',
        label: '主题建议',
        description: '内容生成页的主题建议、起手句、选题方向。',
        placeholder: DEFAULT_ROUTE_MAP.content_topic_suggestions,
      },
    ],
  },
  {
    title: '检索与多模态',
    description: 'Embedding、Rerank、Vision 不建议跟主聊天链路绑死，单独控更稳。',
    routes: [
      {
        key: 'embedding',
        label: 'Embedding',
        description: '向量化、召回、RAG 入库都走这里。',
        placeholder: DEFAULT_ROUTE_MAP.embedding,
      },
      {
        key: 'rerank',
        label: 'Rerank',
        description: '语义重排、结果精排。',
        placeholder: DEFAULT_ROUTE_MAP.rerank,
      },
      {
        key: 'vision',
        label: 'Vision',
        description: '多模态 / 看图理解。',
        placeholder: DEFAULT_ROUTE_MAP.vision,
      },
    ],
  },
]

interface Props {
  onSelectConfig: (key: string | null) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeFallbackConfig(value: unknown): FallbackConfig {
  if (!isRecord(value)) {
    return DEFAULT_FALLBACK_CONFIG
  }

  return {
    primary: readString(value.primary, DEFAULT_FALLBACK_CONFIG.primary),
    fallback: readString(value.fallback, DEFAULT_FALLBACK_CONFIG.fallback),
    maxRetries: readNumber(value.maxRetries, DEFAULT_FALLBACK_CONFIG.maxRetries),
    enableFallback: readBoolean(value.enableFallback, DEFAULT_FALLBACK_CONFIG.enableFallback),
    retryDelay: readNumber(value.retryDelay, DEFAULT_FALLBACK_CONFIG.retryDelay),
  }
}

function getProviderBadgeVariant(routeIdentifier: string): 'default' | 'secondary' | 'outline' {
  const provider = splitRouteIdentifier(routeIdentifier).provider
  if (provider === 'openai') return 'default'
  if (provider === 'qwen') return 'secondary'
  return 'outline'
}

export function ModelRouterEditor({ onSelectConfig }: Props) {
  const { data: routeMapData, isLoading: isRouteMapLoading } = useAiConfigDetail(ROUTE_MAP_CONFIG_KEY)
  const { data: fallbackConfigData, isLoading: isFallbackLoading } = useAiConfigDetail(FALLBACK_CONFIG_KEY)
  const updateConfig = useUpdateAiConfig()
  const [routeMap, setRouteMap] = useState<RouteMapConfig>(DEFAULT_ROUTE_MAP)
  const [fallbackConfig, setFallbackConfig] = useState<FallbackConfig>(DEFAULT_FALLBACK_CONFIG)

  useEffect(() => {
    setRouteMap(normalizeRouteMapConfig(routeMapData?.configValue))
  }, [routeMapData])

  useEffect(() => {
    setFallbackConfig(normalizeFallbackConfig(fallbackConfigData?.configValue))
  }, [fallbackConfigData])
  const currentChatChainLabel = useMemo(() => getChatChainLabel(routeMap), [routeMap])

  const updateRoute = (routeKey: RouteKey, nextRouteIdentifier: string) => {
    setRouteMap((current) => ({
      ...current,
      [routeKey]: nextRouteIdentifier,
    }))
  }

  const updateRouteProvider = (routeKey: RouteKey, provider: ProviderName) => {
    const currentSelection = splitRouteIdentifier(routeMap[routeKey])
    updateRoute(routeKey, `${provider}/${currentSelection.modelId}`)
  }

  const updateRouteModelId = (routeKey: RouteKey, modelId: string) => {
    const currentSelection = splitRouteIdentifier(routeMap[routeKey])
    updateRoute(routeKey, `${currentSelection.provider}/${modelId.trim()}`)
  }

  const applyChatChainPreset = (preset: ChatChainPreset) => {
    setRouteMap((current) => ({
      ...current,
      ...preset.routes,
    }))
  }

  const handleSaveRouteMap = () => {
    updateConfig.mutate({ configKey: ROUTE_MAP_CONFIG_KEY, configValue: routeMap })
  }

  const handleSaveFallbackConfig = () => {
    updateConfig.mutate({ configKey: FALLBACK_CONFIG_KEY, configValue: fallbackConfig })
  }

  if (isRouteMapLoading || isFallbackLoading) {
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
        <div>
          <CardTitle className="text-lg">模型路由配置</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            后端现在优先读取 <code>model.route_map</code>。聊天、内容、检索链路已经拆开，可以单独切。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onSelectConfig(ROUTE_MAP_CONFIG_KEY)}>
            <History className="h-4 w-4 mr-1" />
            路由历史
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSelectConfig(LEGACY_INTENT_MAP_CONFIG_KEY)}>
            <History className="h-4 w-4 mr-1" />
            旧映射历史
          </Button>
          <Button size="sm" onClick={handleSaveRouteMap} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            保存路由
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">当前聊天模型链路</p>
              <p className="text-xs text-muted-foreground">
                这组会一起改 <code>chat</code> / <code>reasoning</code> / <code>agent</code>，适合后台快速切主聊天链路。
              </p>
            </div>
            <Badge variant="outline" className="shrink-0">
              <Route className="mr-1 h-3.5 w-3.5" />
              {currentChatChainLabel}
            </Badge>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {CHAT_CHAIN_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="rounded-xl border bg-background p-4 text-left transition-colors hover:bg-muted/30"
                onClick={() => applyChatChainPreset(preset)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{preset.label}</p>
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{preset.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[11px]">{preset.routes.chat}</Badge>
                  <Badge variant="outline" className="text-[11px]">{preset.routes.reasoning}</Badge>
                  <Badge variant="outline" className="text-[11px]">{preset.routes.agent}</Badge>
                </div>
              </button>
            ))}
          </div>
        </div>

        {ROUTE_GROUPS.map((group) => (
          <div key={group.title} className="rounded-xl border p-4">
            <div>
              <p className="text-sm font-medium">{group.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{group.description}</p>
            </div>

            <div className="mt-4 grid gap-4">
              {group.routes.map((route) => {
                const selection = splitRouteIdentifier(routeMap[route.key])

                return (
                  <div key={route.key} className="rounded-xl border bg-background/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs uppercase text-muted-foreground">{route.key}</Label>
                          <Badge variant={getProviderBadgeVariant(routeMap[route.key])}>{getProviderLabel(routeMap[route.key])}</Badge>
                        </div>
                        <p className="mt-1 text-sm font-medium">{route.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{route.description}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{routeMap[route.key]}</Badge>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                      <div>
                        <Label className="text-xs">Provider</Label>
                        <Select value={selection.provider} onValueChange={(value) => updateRouteProvider(route.key, value as ProviderName)}>
                          <SelectTrigger className="mt-2 h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PROVIDER_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs">Model ID</Label>
                        <Input
                          value={selection.modelId}
                          onChange={(event) => updateRouteModelId(route.key, event.target.value)}
                          placeholder={splitRouteIdentifier(route.placeholder).modelId}
                          className="mt-2 h-9 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <Separator />

        <div className="rounded-xl border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Provider 级 fallback</p>
              <p className="text-xs text-muted-foreground">
                这里还是 provider 级兜底，不会覆盖上面的 route map。后面如果要做 workload 级 fallback，再单独拆。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onSelectConfig(FALLBACK_CONFIG_KEY)}>
                <History className="h-4 w-4 mr-1" />
                兜底历史
              </Button>
              <Button size="sm" variant="outline" onClick={handleSaveFallbackConfig} disabled={updateConfig.isPending}>
                {updateConfig.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                保存兜底
              </Button>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">启用 fallback</p>
              <p className="text-xs text-muted-foreground">建议主链路先稳定，再通过 fallback 做容灾。</p>
            </div>
            <Switch
              checked={fallbackConfig.enableFallback}
              onCheckedChange={(value) => setFallbackConfig({ ...fallbackConfig, enableFallback: value })}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">主 provider</Label>
              <Input
                value={fallbackConfig.primary}
                onChange={(event) => setFallbackConfig({ ...fallbackConfig, primary: event.target.value })}
                placeholder="openai"
                className="mt-2 h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">备选 provider</Label>
              <Input
                value={fallbackConfig.fallback}
                onChange={(event) => setFallbackConfig({ ...fallbackConfig, fallback: event.target.value })}
                placeholder="deepseek"
                className="mt-2 h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">最大重试次数</Label>
              <Input
                type="number"
                min="0"
                max="5"
                value={fallbackConfig.maxRetries}
                onChange={(event) => setFallbackConfig({ ...fallbackConfig, maxRetries: parseInt(event.target.value, 10) || 0 })}
                className="mt-2 h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">重试延迟 (ms)</Label>
              <Input
                type="number"
                min="0"
                step="500"
                value={fallbackConfig.retryDelay}
                onChange={(event) => setFallbackConfig({ ...fallbackConfig, retryDelay: parseInt(event.target.value, 10) || 0 })}
                className="mt-2 h-8 text-sm"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

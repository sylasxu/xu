/**
 * SettingsView Component
 *
 * Drawer 配置视图：Mock 设置 + 当前后台链路 + 可选模型覆盖 + Temperature + MaxTokens + Trace 开关
 */

import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FOLLOW_ROUTE_MAP_MODEL, type ModelParams } from '../../types/trace'
import {
  CHAT_ROUTE_KEYS,
  getChatChainLabel,
  getProviderLabel,
  PLAYGROUND_MANUAL_MODEL_OPTIONS,
  splitRouteIdentifier,
  type ChatRouteKey,
  type RouteMapConfig,
} from '../../model-routing'
import type { MockSettings } from './mock-settings-panel'

interface SettingsViewProps {
  mockSettings: MockSettings
  onMockSettingsChange: (settings: MockSettings) => void
  modelParams: ModelParams
  onModelParamsChange: (params: ModelParams) => void
  routeMap: RouteMapConfig
  routeMapLoading?: boolean
  traceEnabled: boolean
  onTraceEnabledChange: (enabled: boolean) => void
}

const MOCK_LOCATIONS = [
  { value: 'guanyinqiao', label: '观音桥' },
  { value: 'jiefangbei', label: '解放碑' },
  { value: 'nanping', label: '南坪' },
  { value: 'shapingba', label: '沙坪坝' },
]

export function SettingsView({
  mockSettings,
  onMockSettingsChange,
  modelParams,
  onModelParamsChange,
  routeMap,
  routeMapLoading = false,
  traceEnabled,
  onTraceEnabledChange,
}: SettingsViewProps) {
  const followsRouteMap = modelParams.model === FOLLOW_ROUTE_MAP_MODEL
  const effectiveChatRoute = followsRouteMap ? routeMap.chat : modelParams.model

  const chatRouteLabels: Record<ChatRouteKey, string> = {
    chat: '主对话',
    reasoning: '深度推理',
    agent: 'Agent / Tool',
  }

  return (
    <div className="space-y-6 p-4">
      {/* Mock 设置 */}
      <section className="space-y-4">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          模拟设置
        </Label>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">用户身份</Label>
            <Select
              value={mockSettings.userType}
              onValueChange={(v) =>
                onMockSettingsChange({ ...mockSettings, userType: v as MockSettings['userType'] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anonymous">匿名用户</SelectItem>
                <SelectItem value="logged_in">已登录（无手机号）</SelectItem>
                <SelectItem value="with_phone">已登录（有手机号）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">位置</Label>
            <Select
              value={mockSettings.location}
              onValueChange={(v) => onMockSettingsChange({ ...mockSettings, location: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOCK_LOCATIONS.map((loc) => (
                  <SelectItem key={loc.value} value={loc.value}>
                    {loc.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <Separator />

      {/* 模型配置 */}
      <section className="space-y-4">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          模型配置
        </Label>

        <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">后台当前聊天链路</p>
              <p className="mt-1 text-xs text-muted-foreground">
                这里直接读 <code>model.route_map</code>，后台切完会在这里马上反映出来。
              </p>
            </div>
            <Badge variant="outline">
              {routeMapLoading ? '读取中...' : getChatChainLabel(routeMap)}
            </Badge>
          </div>

          <div className="grid gap-3">
            {CHAT_ROUTE_KEYS.map((routeKey) => (
              <div
                key={routeKey}
                className="flex items-center justify-between rounded-lg border bg-background/70 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{chatRouteLabels[routeKey]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{routeMap[routeKey]}</p>
                </div>
                <Badge variant="secondary">{getProviderLabel(routeMap[routeKey])}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">本次 Playground 请求模型</Label>
            <Select
              value={modelParams.model}
              onValueChange={(v) =>
                onModelParamsChange({ ...modelParams, model: v })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_ROUTE_MAP_MODEL}>跟随后台聊天链路（推荐）</SelectItem>
                {PLAYGROUND_MANUAL_MODEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="rounded-lg border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              {followsRouteMap ? (
                <span>
                  当前会跟随 <code>chat = {routeMap.chat}</code>。
                  后台的 <code>reasoning</code> 和 <code>agent</code> 也继续按 route map 生效。
                </span>
              ) : (
                <span>
                  当前会手动覆盖为 <code>{effectiveChatRoute}</code>，只影响这个 playground 请求，不会改后台配置。
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-background/60 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">当前实际发送的主模型</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  playground 现在会按后端真实协议发送 <code>ai.model</code>。
                </p>
              </div>
              <Badge>{splitRouteIdentifier(effectiveChatRoute).provider}</Badge>
            </div>
            <p className="mt-3 text-sm font-mono break-all">{effectiveChatRoute}</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Temperature</Label>
              <span className="text-xs text-muted-foreground">{modelParams.temperature}</span>
            </div>
            <Slider
              value={[modelParams.temperature]}
              onValueChange={([v]) => onModelParamsChange({ ...modelParams, temperature: v })}
              min={0}
              max={2}
              step={0.1}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Max Tokens</Label>
            <Input
              type="number"
              value={modelParams.maxTokens}
              onChange={(e) => {
                const v = Math.min(8192, Math.max(256, Number(e.target.value) || 256))
                onModelParamsChange({ ...modelParams, maxTokens: v })
              }}
              min={256}
              max={8192}
              step={256}
            />
          </div>
        </div>
      </section>

      <Separator />

      {/* Trace 开关 */}
      <section>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">执行追踪</Label>
            <p className="text-xs text-muted-foreground">启用后在画布上显示执行流程</p>
          </div>
          <Switch checked={traceEnabled} onCheckedChange={onTraceEnabledChange} />
        </div>
      </section>
    </div>
  )
}

/**
 * SettingsView Component
 *
 * Drawer 配置视图：Mock 设置 + 模型选择 + Temperature + MaxTokens + Trace 开关
 */

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
import type { ModelParams } from '../../types/trace'
import type { MockSettings } from './mock-settings-panel'

interface SettingsViewProps {
  mockSettings: MockSettings
  onMockSettingsChange: (settings: MockSettings) => void
  modelParams: ModelParams
  onModelParamsChange: (params: ModelParams) => void
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
  traceEnabled,
  onTraceEnabledChange,
}: SettingsViewProps) {
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

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">模型</Label>
            <Select
              value={modelParams.model}
              onValueChange={(v) =>
                onModelParamsChange({ ...modelParams, model: v as ModelParams['model'] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="qwen-flash">Qwen Flash (免费)</SelectItem>
                <SelectItem value="qwen-plus">Qwen Plus</SelectItem>
                <SelectItem value="qwen-max">Qwen Max</SelectItem>
              </SelectContent>
            </Select>
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

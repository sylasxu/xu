/**
 * ProcessorDetailDrawer Component
 *
 * 处理器节点详情面板（含参数配置）
 * 为可配置处理器展示参数表单，参数值从数据库加载，修改后通过配置 API 实时保存
 */

import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Loader2, Save } from 'lucide-react'
import { useAiConfigDetail, useUpdateAiConfig } from '../../hooks/use-ai-config'
import type { FlowNode } from '../../types/flow'

interface ProcessorDetailDrawerProps {
  node: FlowNode | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 可配置处理器 → configKey 映射 */
const CONFIGURABLE_PROCESSORS: Record<string, string> = {
  'semantic-recall': 'processor.semantic_recall',
  'token-limit': 'processor.token_limit',
  'intent-classify': 'processor.intent_classify',
  'extract-preferences': 'processor.extract_preferences',
}

export function ProcessorDetailDrawer({ node }: ProcessorDetailDrawerProps) {
  if (!node) return null

  const processorType = node.data.type === 'processor' ? node.data.processorType : node.data.type
  const configKey = CONFIGURABLE_PROCESSORS[processorType]

  if (!configKey) return null

  return (
    <div className="space-y-4">
      <Separator />
      <h4 className="text-sm font-medium">参数配置</h4>
      <ProcessorConfigForm configKey={configKey} processorType={processorType} />
    </div>
  )
}

function ProcessorConfigForm({ configKey, processorType }: { configKey: string; processorType: string }) {
  const { data, isLoading } = useAiConfigDetail(configKey)
  const updateConfig = useUpdateAiConfig()
  const [params, setParams] = useState<Record<string, unknown>>({})

  useEffect(() => {
    if (isRecord(data?.configValue)) {
      setParams({ ...data.configValue })
    } else {
      setParams(getDefaultParams(processorType))
    }
  }, [data, processorType])

  const handleSave = () => {
    updateConfig.mutate({ configKey, configValue: params })
  }

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  }

  return (
    <div className="space-y-3">
      {processorType === 'semantic-recall' && (
        <SemanticRecallParams params={params} onChange={setParams} />
      )}
      {processorType === 'token-limit' && (
        <TokenLimitParams params={params} onChange={setParams} />
      )}
      {processorType === 'intent-classify' && (
        <IntentClassifyParams params={params} onChange={setParams} />
      )}
      {processorType === 'extract-preferences' && (
        <ExtractPreferencesParams params={params} onChange={setParams} />
      )}
      <Button size="sm" onClick={handleSave} disabled={updateConfig.isPending} className="w-full">
        {updateConfig.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
        保存参数
      </Button>
    </div>
  )
}

// ============ 各处理器参数表单 ============

function SemanticRecallParams({ params, onChange }: { params: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <ParamRow label="相似度阈值">
        <Input type="number" step="0.05" min="0" max="1" value={Number(params.similarityThreshold ?? 0.5)} onChange={(e) => onChange({ ...params, similarityThreshold: parseFloat(e.target.value) || 0 })} className="h-7 w-24 text-xs" />
      </ParamRow>
      <ParamRow label="Top-K">
        <Input type="number" min="1" max="20" value={Number(params.topK ?? 5)} onChange={(e) => onChange({ ...params, topK: parseInt(e.target.value) || 5 })} className="h-7 w-24 text-xs" />
      </ParamRow>
      <ParamRow label="启用 Rerank">
        <Switch checked={Boolean(params.enableRerank ?? true)} onCheckedChange={(v) => onChange({ ...params, enableRerank: v })} />
      </ParamRow>
    </>
  )
}

function TokenLimitParams({ params, onChange }: { params: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <ParamRow label="最大 Token 数">
      <Input type="number" min="1000" max="128000" step="1000" value={Number(params.maxTokens ?? 8000)} onChange={(e) => onChange({ ...params, maxTokens: parseInt(e.target.value) || 8000 })} className="h-7 w-28 text-xs" />
    </ParamRow>
  )
}

function IntentClassifyParams({ params, onChange }: { params: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <ParamRow label="P1→P2 升级阈值">
        <Input type="number" step="0.05" min="0" max="1" value={Number(params.p1UpgradeThreshold ?? 0.7)} onChange={(e) => onChange({ ...params, p1UpgradeThreshold: parseFloat(e.target.value) || 0.7 })} className="h-7 w-24 text-xs" />
      </ParamRow>
      <ParamRow label="缓存 TTL (秒)">
        <Input type="number" min="0" max="3600" step="60" value={Number(params.cacheTtlSeconds ?? 300)} onChange={(e) => onChange({ ...params, cacheTtlSeconds: parseInt(e.target.value) || 300 })} className="h-7 w-24 text-xs" />
      </ParamRow>
    </>
  )
}

function ExtractPreferencesParams({ params, onChange }: { params: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <ParamRow label="前置关键词检查">
        <Switch checked={Boolean(params.enableKeywordCheck ?? true)} onCheckedChange={(v) => onChange({ ...params, enableKeywordCheck: v })} />
      </ParamRow>
      <ParamRow label="LLM 提取">
        <Switch checked={Boolean(params.enableLlmExtraction ?? true)} onCheckedChange={(v) => onChange({ ...params, enableLlmExtraction: v })} />
      </ParamRow>
    </>
  )
}

// ============ 通用组件 ============

function ParamRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function getDefaultParams(processorType: string): Record<string, unknown> {
  switch (processorType) {
    case 'semantic-recall': return { similarityThreshold: 0.5, topK: 5, enableRerank: true }
    case 'token-limit': return { maxTokens: 8000 }
    case 'intent-classify': return { p1UpgradeThreshold: 0.7, cacheTtlSeconds: 300 }
    case 'extract-preferences': return { enableKeywordCheck: true, enableLlmExtraction: true }
    default: return {}
  }
}

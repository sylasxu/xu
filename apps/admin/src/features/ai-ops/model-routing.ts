export const ROUTE_MAP_CONFIG_KEY = 'model.route_map'

export type RouteKey =
  | 'chat'
  | 'reasoning'
  | 'agent'
  | 'vision'
  | 'content_generation'
  | 'content_topic_suggestions'
  | 'embedding'
  | 'rerank'

export type ChatRouteKey = 'chat' | 'reasoning' | 'agent'

export type ProviderName = 'moonshot' | 'qwen' | 'deepseek' | 'doubao'

export interface RouteMapConfig {
  chat: string
  reasoning: string
  agent: string
  vision: string
  content_generation: string
  content_topic_suggestions: string
  embedding: string
  rerank: string
}

export interface ChatChainPreset {
  key: string
  label: string
  description: string
  routes: Pick<RouteMapConfig, ChatRouteKey>
}

export const PROVIDER_OPTIONS: Array<{ value: ProviderName; label: string }> = [
  { value: 'moonshot', label: 'Moonshot / Kimi' },
  { value: 'qwen', label: 'Qwen' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'doubao', label: 'Doubao' },
]

export const DEFAULT_ROUTE_MAP: RouteMapConfig = {
  chat: 'moonshot/kimi-k2.5',
  reasoning: 'moonshot/kimi-k2-thinking',
  agent: 'moonshot/kimi-k2.5',
  vision: 'moonshot/kimi-k2.5',
  content_generation: 'moonshot/kimi-k2.5',
  content_topic_suggestions: 'moonshot/kimi-k2.5',
  embedding: 'qwen/text-embedding-v4',
  rerank: 'moonshot/kimi-k2.5',
}

export const CHAT_ROUTE_KEYS: ChatRouteKey[] = ['chat', 'reasoning', 'agent']

export const CHAT_CHAIN_PRESETS: ChatChainPreset[] = [
  {
    key: 'moonshot',
    label: 'Kimi 主链路',
    description: '境内默认链路，适合主聊天、推理和 Agent 一起走同一条链路。',
    routes: {
      chat: 'moonshot/kimi-k2.5',
      reasoning: 'moonshot/kimi-k2-thinking',
      agent: 'moonshot/kimi-k2.5',
    },
  },
  {
    key: 'deepseek',
    label: 'DeepSeek 主链路',
    description: '适合低成本压测或做备用链路验证。',
    routes: {
      chat: 'deepseek/deepseek-chat',
      reasoning: 'deepseek/deepseek-reasoner',
      agent: 'deepseek/deepseek-chat',
    },
  },
]

export const PLAYGROUND_MANUAL_MODEL_OPTIONS = [
  { value: 'moonshot/kimi-k2.5', label: 'Moonshot Kimi K2.5' },
  { value: 'moonshot/kimi-k2-thinking', label: 'Moonshot Kimi K2 Thinking' },
  { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function inferProviderName(modelId: string): ProviderName | null {
  const normalized = modelId.trim().toLowerCase()

  if (
    normalized.startsWith('moonshot/')
    || normalized.startsWith('kimi')
  ) {
    return 'moonshot'
  }

  if (
    normalized.startsWith('qwen/')
    || normalized.startsWith('qwen')
    || normalized.includes('embedding')
    || normalized.includes('rerank')
  ) {
    return 'qwen'
  }

  if (normalized.startsWith('deepseek/') || normalized.startsWith('deepseek')) {
    return 'deepseek'
  }

  if (normalized.startsWith('doubao/') || normalized.startsWith('doubao')) {
    return 'doubao'
  }

  return null
}

export function toExplicitRouteIdentifier(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim()
    if (normalized.includes('/')) {
      return normalized
    }

    const provider = inferProviderName(normalized)
    return provider ? `${provider}/${normalized}` : normalized
  }

  if (isRecord(value) && typeof value.provider === 'string' && typeof value.modelId === 'string') {
    const provider = value.provider.trim()
    const modelId = value.modelId.trim()
    if (provider && modelId) {
      return `${provider}/${modelId}`
    }
  }

  return fallback
}

export function normalizeRouteMapConfig(value: unknown): RouteMapConfig {
  if (!isRecord(value)) {
    return DEFAULT_ROUTE_MAP
  }

  return {
    chat: toExplicitRouteIdentifier(value.chat, DEFAULT_ROUTE_MAP.chat),
    reasoning: toExplicitRouteIdentifier(value.reasoning, DEFAULT_ROUTE_MAP.reasoning),
    agent: toExplicitRouteIdentifier(value.agent, DEFAULT_ROUTE_MAP.agent),
    vision: toExplicitRouteIdentifier(value.vision, DEFAULT_ROUTE_MAP.vision),
    content_generation: toExplicitRouteIdentifier(value.content_generation, DEFAULT_ROUTE_MAP.content_generation),
    content_topic_suggestions: toExplicitRouteIdentifier(
      value.content_topic_suggestions,
      DEFAULT_ROUTE_MAP.content_topic_suggestions,
    ),
    embedding: toExplicitRouteIdentifier(value.embedding, DEFAULT_ROUTE_MAP.embedding),
    rerank: toExplicitRouteIdentifier(value.rerank, DEFAULT_ROUTE_MAP.rerank),
  }
}

export function splitRouteIdentifier(routeIdentifier: string): {
  provider: ProviderName
  modelId: string
} {
  const normalized = readString(routeIdentifier, DEFAULT_ROUTE_MAP.chat)
  const separatorIndex = normalized.indexOf('/')

  if (separatorIndex > 0) {
    const provider = normalized.slice(0, separatorIndex).trim()
    const modelId = normalized.slice(separatorIndex + 1).trim()
    if (
      (['moonshot', 'qwen', 'deepseek', 'doubao'] as const).includes(provider as ProviderName)
      && modelId
    ) {
      return {
        provider: provider as ProviderName,
        modelId,
      }
    }
  }

  const inferredProvider = inferProviderName(normalized) ?? 'moonshot'
  return {
    provider: inferredProvider,
    modelId: normalized,
  }
}

export function getProviderLabel(routeIdentifier: string): string {
  const provider = splitRouteIdentifier(routeIdentifier).provider
  return PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? '自定义'
}

export function getChatChainLabel(routeMap: Pick<RouteMapConfig, ChatRouteKey>): string {
  const currentPreset = CHAT_CHAIN_PRESETS.find((preset) =>
    preset.routes.chat === routeMap.chat
    && preset.routes.reasoning === routeMap.reasoning
    && preset.routes.agent === routeMap.agent,
  )

  return currentPreset?.label ?? '自定义聊天链路'
}

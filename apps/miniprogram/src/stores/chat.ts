/**
 * Chat Store - 类似 @ai-sdk/react 的 useChat
 * 
 * 提供统一的 AI 对话状态管理，与 Admin 端保持一致的 API 设计
 * 同时支持 Widget 渲染（draft、explore、ask_preference 等）
 * 
 * @example
 * ```typescript
 * const chatStore = useChatStore.getState()
 * 
 * // 发送消息
 * chatStore.sendMessage('明晚观音桥打麻将')
 * 
 * // 订阅状态
 * useChatStore.subscribe((state) => {
 *   console.log(state.messages, state.status)
 * })
 * ```
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SSEController, UIMessagePart } from '../utils/sse-request'
import { API_CONFIG } from '../config'
import type {
  GenUIBlock,
  GenUIChoiceBlock,
  GenUIChoiceOption,
  GenUICtaGroupBlock,
  GenUIEntityCardBlock,
  GenUIFormBlock,
  GenUIInput,
  GenUIListBlock,
  GenUIRequestContext,
  GenUITurnContext,
  GenUITurnEnvelope,
} from '../gen/genui-contract'

// ============================================================================
// Types - 与 AI SDK v6 UIMessage 保持一致，扩展 Widget 支持
// ============================================================================

/** 消息 Part 类型 */
export type { UIMessagePart }

/** 消息角色 */
export type MessageRole = 'user' | 'assistant'

/** 
 * Widget Part - 用于渲染 Widget 组件
 * 扩展 AI SDK 的 part 概念，支持小程序特有的 Widget
 */
export interface WidgetPart {
  type: 'widget'
  widgetType: 'dashboard' | 'draft' | 'explore' | 'share' | 'ask_preference' | 'partner_intent_form' | 'draft_settings_form' | 'error'
  data: unknown
}

/**
 * Structured Action Input
 * 用户点击 Widget 按钮时发送，跳过 LLM 意图识别
 */
export interface StructuredActionInput {
  /** 结构化动作类型 */
  action: string
  /** 结构化动作参数 */
  payload: Record<string, unknown>
  /** 来源 Widget 类型 */
  source?: string
  /** 原始文本（用于回退） */
  originalText?: string
}

/** 
 * UI Message - 与 AI SDK v6 格式一致，扩展 Widget 支持
 * @see https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol
 */
export interface UIMessage {
  id: string
  role: MessageRole
  parts: (UIMessagePart | WidgetPart)[]
  turnContext?: GenUITurnContext
  createdAt: Date
}

/** Chat 状态 - 与 useChat 一致 */
export type ChatStatus = 'idle' | 'submitted' | 'streaming'

/** 当前流式消息的 ID */
export type StreamingMessageId = string | null

type ChatPromptContext = Pick<GenUIRequestContext, 'activityId' | 'followUpMode' | 'entry'>
type GenUITransientTurn = NonNullable<GenUIRequestContext['transientTurns']>[number]

const MAX_TRANSIENT_TURNS = 8

// ============================================================================
// Protocol and message operations
// ============================================================================

/** 生成唯一 ID */
const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

/** 从 UIMessage 提取文本内容 */
export function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((part): part is UIMessagePart & { type: 'text'; text?: string } => isTextPart(part))
    .filter((part): part is UIMessagePart & { type: 'text'; text: string } => typeof part.text === 'string')
    .map(part => part.text)
    .join('')
}

/** 从 UIMessage 提取 Tool Parts */
export function getToolParts(message: UIMessage): UIMessagePart[] {
  return message.parts.filter((part): part is UIMessagePart => 
    typeof part.type === 'string' && part.type.startsWith('tool-')
  )
}

/** 从 UIMessage 提取 Widget Part */
export function getWidgetPart(message: UIMessage): WidgetPart | null {
  return message.parts.find((part): part is WidgetPart => part.type === 'widget') || null
}

/** 判断消息是否正在流式输出 */
export function isStreaming(message: UIMessage, streamingId: StreamingMessageId): boolean {
  return streamingId === message.id
}

const CALL_LEAK_PATTERN = /^\.?call\s+[a-zA-Z0-9_]+\s*\(/i

function normalizePromptKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[?？!！。,.，、;；:：'"`~\-_/\\()[\]{}]/g, '')
}

function shouldSuppressAssistantText(text: string): boolean {
  return CALL_LEAK_PATTERN.test(text.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTextPart(part: UIMessagePart | WidgetPart): part is UIMessagePart & { type: 'text'; text?: string } {
  return part.type === 'text'
}

function isGenUITurnStatus(value: unknown): value is GenUITurnEnvelope['turn']['status'] {
  return value === 'streaming' || value === 'completed' || value === 'error'
}

function isGenUIChoiceOption(value: unknown): value is GenUIChoiceOption {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    typeof value.action === 'string' &&
    (value.params === undefined || isRecord(value.params))
  )
}

function isGenUICtaItem(value: unknown): value is GenUICtaGroupBlock['items'][number] {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    typeof value.action === 'string' &&
    (value.params === undefined || isRecord(value.params))
  )
}

function isGenUIBlock(value: unknown): value is GenUIBlock {
  if (!isRecord(value) || typeof value.blockId !== 'string') {
    return false
  }

  if (value.dedupeKey !== undefined && typeof value.dedupeKey !== 'string') {
    return false
  }

  if (
    value.replacePolicy !== undefined &&
    value.replacePolicy !== 'append' &&
    value.replacePolicy !== 'replace' &&
    value.replacePolicy !== 'ignore-if-exists'
  ) {
    return false
  }

  if (value.meta !== undefined && !isRecord(value.meta)) {
    return false
  }

  switch (value.type) {
    case 'text':
      return typeof value.content === 'string'
    case 'choice':
      return typeof value.question === 'string' && Array.isArray(value.options) && value.options.every(isGenUIChoiceOption)
    case 'entity-card':
      return typeof value.title === 'string' && isRecord(value.fields)
    case 'list':
      return (
        (value.title === undefined || typeof value.title === 'string') &&
        Array.isArray(value.items) &&
        value.items.every(isRecord)
      )
    case 'form':
      return (
        (value.title === undefined || typeof value.title === 'string') &&
        isRecord(value.schema) &&
        (value.initialValues === undefined || isRecord(value.initialValues))
      )
    case 'cta-group':
      return Array.isArray(value.items) && value.items.every(isGenUICtaItem)
    case 'alert':
      return (
        (value.level === 'info' || value.level === 'warning' || value.level === 'error' || value.level === 'success') &&
        typeof value.message === 'string'
      )
    default:
      return false
  }
}

function isGenUITurnEnvelope(value: unknown): value is GenUITurnEnvelope {
  if (!isRecord(value) || typeof value.traceId !== 'string' || typeof value.conversationId !== 'string') {
    return false
  }

  if (!isRecord(value.turn)) {
    return false
  }

  return (
    typeof value.turn.turnId === 'string' &&
    value.turn.role === 'assistant' &&
    isGenUITurnStatus(value.turn.status) &&
    Array.isArray(value.turn.blocks) &&
    value.turn.blocks.every(isGenUIBlock)
  )
}

function getAssistantText(message: UIMessage): string {
  return message.parts
    .filter((part): part is UIMessagePart & { type: 'text'; text?: string } => isTextPart(part))
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
}

function upsertAssistantText(message: UIMessage, text: string): void {
  const textPart = message.parts.find((part): part is UIMessagePart & { type: 'text'; text?: string } => isTextPart(part))
  if (textPart) {
    textPart.text = text
    return
  }

  message.parts.unshift({ type: 'text', text })
}

function removeAssistantText(message: UIMessage): void {
  message.parts = message.parts.filter((part) => part.type !== 'text')
}

function readWidgetSummaryText(widget: WidgetPart | null): string {
  if (!widget || !isRecord(widget.data)) {
    return ''
  }

  const data = widget.data
  const directTextCandidates = [
    data.question,
    data.title,
    data.message,
  ]

  for (const value of directTextCandidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  const firstResult = Array.isArray(data.results) ? data.results[0] : null
  if (isRecord(firstResult) && typeof firstResult.title === 'string' && firstResult.title.trim()) {
    return firstResult.title.trim()
  }

  return ''
}

function readMessagePrimaryBlockType(message: UIMessage): GenUITransientTurn['primaryBlockType'] {
  const widget = getWidgetPart(message)
  if (!widget) {
    return getTextContent(message).trim() ? 'text' : null
  }

  switch (widget.widgetType) {
    case 'ask_preference':
      return 'choice'
    case 'explore':
      return 'list'
    case 'draft':
    case 'share':
      return 'entity-card'
    case 'partner_intent_form':
    case 'draft_settings_form':
      return 'form'
    case 'error':
      return 'alert'
    case 'dashboard':
    default:
      return getTextContent(message).trim() ? 'text' : null
  }
}

function extractMessageTextForTransientTurn(message: UIMessage): string {
  const text = getTextContent(message).trim()
  if (text) {
    return text
  }

  return readWidgetSummaryText(getWidgetPart(message))
}

function buildTransientTurns(messages: UIMessage[]): GenUITransientTurn[] {
  return messages
    .slice(-MAX_TRANSIENT_TURNS)
    .map((message) => {
      const text = extractMessageTextForTransientTurn(message)
      if (!text) {
        return null
      }

      const primaryBlockType = readMessagePrimaryBlockType(message)
      return {
        role: message.role,
        text,
        ...(primaryBlockType !== undefined ? { primaryBlockType } : {}),
        ...(message.role === 'assistant' && message.turnContext ? { turnContext: message.turnContext } : {}),
      }
    })
    .filter((turn): turn is GenUITransientTurn => Boolean(turn))
}

function extractAskPreferenceQuestion(data: unknown): string {
  if (!isRecord(data)) {
    return ''
  }

  const question = typeof data.question === 'string' ? data.question.trim() : ''
  return question
}

function hasDuplicateAskPreferenceQuestion(text: string, question: string): boolean {
  const normalizedText = normalizePromptKey(text)
  const normalizedQuestion = normalizePromptKey(question)

  if (!normalizedText || !normalizedQuestion) {
    return false
  }

  if (normalizedText === normalizedQuestion) {
    return true
  }

  const delta = Math.abs(normalizedText.length - normalizedQuestion.length)
  if (delta > 6) {
    return false
  }

  return (
    normalizedText.includes(normalizedQuestion) ||
    normalizedQuestion.includes(normalizedText)
  )
}

function upsertWidgetPart(message: UIMessage, widgetPart: WidgetPart): void {
  const existingIndex = message.parts.findIndex(
    (part) =>
      isWidgetPart(part) && part.widgetType === widgetPart.widgetType
  )

  if (existingIndex >= 0) {
    message.parts[existingIndex] = widgetPart
    return
  }

  message.parts.push(widgetPart)
}

function isWidgetPart(part: UIMessagePart | WidgetPart): part is WidgetPart {
  return part.type === 'widget' && 'widgetType' in part
}

function sanitizeAssistantMessage(message: UIMessage): void {
  if (message.role !== 'assistant') {
    return
  }

  const text = getAssistantText(message)

  if (text && shouldSuppressAssistantText(text)) {
    removeAssistantText(message)
  }

  const currentText = getAssistantText(message)
  if (!currentText) {
    return
  }

  message.parts = message.parts.filter((part) => {
    if (!isWidgetPart(part)) {
      return true
    }

    if (part.widgetType !== 'ask_preference') {
      return true
    }

    const question = extractAskPreferenceQuestion(part.data)
    if (!question) {
      return true
    }

    return !hasDuplicateAskPreferenceQuestion(currentText, question)
  })
}

function inferChoiceQuestionType(block: GenUIChoiceBlock): 'location' | 'type' {
  const question = block.question.toLowerCase()

  if (question.includes('哪') || question.includes('地点') || question.includes('位置')) {
    return 'location'
  }

  const hasLocationParam = block.options.some((option) => {
    const params = option.params
    return isRecord(params) && typeof params.location === 'string'
  })
  if (hasLocationParam) {
    return 'location'
  }

  return 'type'
}

function toChoiceOptionValue(option: GenUIChoiceOption): string {
  if (isRecord(option.params)) {
    if (typeof option.params.location === 'string') {
      return option.params.location
    }
    if (typeof option.params.activityType === 'string') {
      return option.params.activityType
    }
    if (typeof option.params.type === 'string') {
      return option.params.type
    }
    if (typeof option.params.slot === 'string') {
      return option.params.slot
    }
  }

  return option.label
}

function parseSlotToStartAt(slot: string): string {
  const slotMap: Record<string, string> = {
    fri_19_00: '2026-03-06T19:00:00+08:00',
    fri_20_00: '2026-03-06T20:00:00+08:00',
    fri_21_00: '2026-03-06T21:00:00+08:00',
  }

  return slotMap[slot] || slotMap.fri_20_00
}

function toStringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return fallback
}

function toNumberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

function normalizeDraftType(value: string): string {
  const map: Record<string, string> = {
    桌游: 'boardgame',
    羽毛球: 'sports',
    夜跑: 'sports',
    K歌: 'ktv',
    k歌: 'ktv',
  }

  return map[value] || value || 'other'
}

function buildDraftWidgetDataFromRecord(record: Record<string, unknown>): Record<string, unknown> {
  const locationName = toStringValue(record.locationName, toStringValue(record.location, '观音桥'))
  const slot = toStringValue(record.slot, 'fri_20_00')
  const startAt = toStringValue(record.startAt, parseSlotToStartAt(slot))
  const typeRaw = toStringValue(record.type, toStringValue(record.activityType, 'boardgame'))
  const draftType = normalizeDraftType(typeRaw)
  const title = toStringValue(record.title, '周五活动局')
  const lat = toNumberValue(record.lat, 29.58567)
  const lng = toNumberValue(record.lng, 106.52988)
  const maxParticipants = toNumberValue(record.maxParticipants, 6)
  const currentParticipants = toNumberValue(record.currentParticipants, 1)

  return {
    activityId: toStringValue(record.activityId, `draft_${Date.now()}`),
    title,
    type: draftType,
    startAt,
    location: [lng, lat],
    locationName,
    locationHint: toStringValue(record.locationHint, `${locationName}商圈`),
    maxParticipants,
    currentParticipants,
  }
}

function mapEntityCardToWidgetPart(block: GenUIEntityCardBlock): WidgetPart {
  const record = isRecord(block.fields) ? block.fields : {}
  const activityId = toStringValue(record.activityId, '')
  const isShareCard =
    block.dedupeKey === 'published_activity' ||
    block.dedupeKey === 'share_payload' ||
    (!!activityId && !activityId.startsWith('draft_') && typeof record.shareTitle === 'string')

  if (isShareCard) {
    const locationName = toStringValue(record.locationName, '观音桥')
    const lat = toNumberValue(record.lat, 29.58567)
    const lng = toNumberValue(record.lng, 106.52988)
    return {
      type: 'widget',
      widgetType: 'share',
      data: {
        id: activityId || `activity_${Date.now()}`,
        title: toStringValue(record.title, '周五活动局'),
        type: normalizeDraftType(toStringValue(record.type, 'other')),
        startAt: toStringValue(record.startAt, parseSlotToStartAt('fri_20_00')),
        location: [lng, lat],
        locationName,
        locationHint: toStringValue(record.locationHint, `${locationName}商圈`),
        maxParticipants: toNumberValue(record.maxParticipants, 6),
        currentParticipants: toNumberValue(record.currentParticipants, 1),
        shareTitle: toStringValue(record.shareTitle, ''),
        shareUrl: toStringValue(record.shareUrl, ''),
        sharePath: toStringValue(record.sharePath, ''),
      },
    }
  }

  return {
    type: 'widget',
    widgetType: 'draft',
    data: buildDraftWidgetDataFromRecord(record),
  }
}

function readExploreBlockMeta(block: GenUIListBlock): {
  center: { lat: number; lng: number; name: string } | null
  semanticQuery: string
  fetchConfig: Record<string, unknown> | null
  interaction: Record<string, unknown> | null
  preview: Record<string, unknown> | null
} {
  const meta = isRecord(block.meta) ? block.meta : null
  const explore = isRecord(meta?.explore) ? meta.explore : null
  const centerSource = isRecord(block.center)
    ? block.center
    : isRecord(explore?.center)
      ? explore.center
      : null
  const center = centerSource
    ? {
        lat: toNumberValue(centerSource.lat, 29.58567),
        lng: toNumberValue(centerSource.lng, 106.52988),
        name: toStringValue(centerSource.name, '附近'),
      }
    : null

  return {
    center,
    semanticQuery: toStringValue(block.semanticQuery, toStringValue(explore?.semanticQuery, '')),
    fetchConfig: isRecord(block.fetchConfig)
      ? block.fetchConfig
      : isRecord(explore?.fetchConfig)
        ? explore.fetchConfig
        : null,
    interaction: isRecord(block.interaction)
      ? block.interaction
      : isRecord(explore?.interaction)
        ? explore.interaction
        : null,
    preview: isRecord(block.preview)
      ? block.preview
      : isRecord(explore?.preview)
        ? explore.preview
        : null,
  }
}

function mapListToWidgetPart(block: GenUIListBlock): WidgetPart {
  const results = block.items
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item, index) => {
      const locationName = toStringValue(item.locationName, '附近')
      return {
        id: toStringValue(item.id, `list_item_${index}`),
        title: toStringValue(item.title, `活动 ${index + 1}`),
        type: normalizeDraftType(toStringValue(item.type, 'other')),
        lat: toNumberValue(item.lat, 29.58567),
        lng: toNumberValue(item.lng, 106.52988),
        locationName,
        locationHint: toStringValue(item.locationHint, `${locationName}商圈`),
        distance: toNumberValue(item.distance, 0),
        startAt: toStringValue(item.startAt, parseSlotToStartAt('fri_20_00')),
        currentParticipants: toNumberValue(item.currentParticipants, 1),
        maxParticipants: toNumberValue(item.maxParticipants, 6),
      }
    })

  const exploreMeta = readExploreBlockMeta(block)
  const first = results[0]
  return {
    type: 'widget',
    widgetType: 'explore',
    data: {
      results,
      center: exploreMeta.center ?? {
        lat: first?.lat ?? 29.58567,
        lng: first?.lng ?? 106.52988,
        name: first?.locationName ?? '附近',
      },
      title: block.title || '',
      semanticQuery: exploreMeta.semanticQuery,
      fetchConfig: exploreMeta.fetchConfig,
      interaction: exploreMeta.interaction,
      preview: exploreMeta.preview,
    },
  }
}

function mapCtaGroupToWidgetPart(block: GenUICtaGroupBlock): WidgetPart {
  return {
    type: 'widget',
    widgetType: 'ask_preference',
    data: {
      questionType: 'type',
      question: '接下来你想怎么做？',
      options: block.items.map((item) => ({
        label: item.label,
        value: item.label,
        action: item.action,
        ...(isRecord(item.params) ? { params: item.params } : {}),
      })),
      allowSkip: false,
      disabled: false,
    },
  }
}

function mapFormToWidgetPart(block: GenUIFormBlock): WidgetPart {
  const initial = isRecord(block.initialValues) ? block.initialValues : {}
  const schema = isRecord(block.schema) ? block.schema : {}
  const formType = typeof schema.formType === 'string' ? schema.formType : ''

  if (formType === 'partner_intent') {
    return {
      type: 'widget',
      widgetType: 'partner_intent_form',
      data: {
        title: typeof block.title === 'string' ? block.title : '找搭子偏好',
        schema,
        initialValues: initial,
        disabled: false,
      },
    }
  }

  if (formType === 'draft_settings') {
    return {
      type: 'widget',
      widgetType: 'draft_settings_form',
      data: {
        title: typeof block.title === 'string' ? block.title : '调整活动草稿',
        schema,
        initialValues: initial,
        disabled: false,
      },
    }
  }

  return {
    type: 'widget',
    widgetType: 'error',
    data: {
      message: '暂不支持这种表单卡片，请换个方式试试',
      showRetry: false,
    },
  }
}

function buildAssistantPartsFromBlocks(blocks: GenUIBlock[]): (UIMessagePart | WidgetPart)[] {
  const parts: (UIMessagePart | WidgetPart)[] = []

  for (const block of blocks) {
    if (block.type === 'text') {
      const content = block.content.trim()
      if (!content) {
        continue
      }

      const lastPart = parts[parts.length - 1]
      if (lastPart && lastPart.type === 'text') {
        lastPart.text = `${lastPart.text || ''}\n${content}`.trim()
      } else {
        parts.push({ type: 'text', text: content })
      }
      continue
    }

    if (block.type === 'choice') {
      parts.push({
        type: 'widget',
        widgetType: 'ask_preference',
        data: {
          questionType: inferChoiceQuestionType(block),
          question: block.question,
          options: block.options.map((option) => ({
            label: option.label,
            value: toChoiceOptionValue(option),
            action: option.action,
            ...(isRecord(option.params) ? { params: option.params } : {}),
          })),
          allowSkip: false,
          disabled: false,
        },
      })
      continue
    }

    if (block.type === 'entity-card') {
      parts.push(mapEntityCardToWidgetPart(block))
      continue
    }

    if (block.type === 'list') {
      parts.push(mapListToWidgetPart(block))
      continue
    }

    if (block.type === 'cta-group') {
      parts.push(mapCtaGroupToWidgetPart(block))
      continue
    }

    if (block.type === 'form') {
      parts.push(mapFormToWidgetPart(block))
      continue
    }

    if (block.type === 'alert') {
      if (block.level === 'success' || block.level === 'info') {
        const content = block.message.trim()
        if (content) {
          parts.push({ type: 'text', text: content })
        }
        continue
      }

      parts.push({
        type: 'widget',
        widgetType: 'error',
        data: {
          message: block.message,
          showRetry: false,
        },
      })
    }
  }

  if (parts.length === 0) {
    parts.push({
      type: 'widget',
      widgetType: 'error',
      data: {
        message: '这次回复没有可渲染内容，请再试一次',
        showRetry: true,
      },
    })
  }

  return parts
}

type ChatGatewayTurnsRequest = {
  conversationId?: string
  input: GenUIInput
  context?: {
    client?: 'web' | 'miniprogram' | 'admin'
    locale?: string
    timezone?: string
    platformVersion?: string
    lat?: number
    lng?: number
    activityId?: string
    followUpMode?: 'review' | 'rebook' | 'kickoff'
    entry?: string
    transientTurns?: GenUIRequestContext['transientTurns']
  }
  stream?: boolean
  [key: string]: unknown
}

interface ChatGatewayStreamCallbacks {
  onStart?: () => void
  onEvent?: (eventName: string, payload: unknown) => void
  onDone?: () => void
  onError?: (message: string) => void
  onFinish?: () => void
}

const CHAT_GATEWAY_URL = `${API_CONFIG.BASE_URL}/ai/chat`
const TYPEWRITER_INTERVAL_MS = 16

function buildChatGatewayTurnsRequest(
  conversationId: string | null,
  input: GenUIInput,
  context: {
    locale: string
    timezone: string
    platformVersion: string
    location?: { lat: number; lng: number } | null
    activityId?: string
    followUpMode?: 'review' | 'rebook' | 'kickoff'
    entry?: string
    transientTurns?: GenUIRequestContext['transientTurns']
  }
): ChatGatewayTurnsRequest {
  return {
    ...(conversationId ? { conversationId } : {}),
    input,
    context: {
      client: 'miniprogram',
      locale: context.locale,
      timezone: context.timezone,
      platformVersion: context.platformVersion,
      ...(context.location ? { lat: context.location.lat, lng: context.location.lng } : {}),
      ...(context.activityId ? { activityId: context.activityId } : {}),
      ...(context.followUpMode ? { followUpMode: context.followUpMode } : {}),
      ...(context.entry ? { entry: context.entry } : {}),
      ...(context.transientTurns && context.transientTurns.length > 0
        ? { transientTurns: context.transientTurns }
        : {}),
    },
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseSSEPacket(packet: string): { eventName: string; dataText: string } | null {
  const trimmed = packet.trim()
  if (!trimmed) {
    return null
  }

  const lines = trimmed.split(/\r?\n/)
  let eventName = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  return {
    eventName,
    dataText: dataLines.join('\n'),
  }
}

function arrayBufferToString(buffer: ArrayBuffer): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(buffer)
  }

  const uint8Array = new Uint8Array(buffer)
  let result = ''
  for (let i = 0; i < uint8Array.length; i += 1) {
    result += String.fromCharCode(uint8Array[i])
  }

  try {
    return decodeURIComponent(escape(result))
  } catch {
    return result
  }
}

function readStorageString(key: string): string {
  const value = wx.getStorageSync(key)
  return typeof value === 'string' ? value : ''
}

function hasAuthenticatedSession(): boolean {
  return readStorageString('token').trim().length > 0
}

function streamChatGatewayTurns(
  request: ChatGatewayTurnsRequest,
  callbacks: ChatGatewayStreamCallbacks
): SSEController {
  const token = readStorageString('token')
  let buffer = ''
  let finished = false

  const finishOnce = () => {
    if (finished) {
      return
    }
    finished = true
    callbacks.onFinish?.()
  }

  const emitDoneOnce = () => {
    if (finished) {
      return
    }
    callbacks.onDone?.()
  }

  const parseBuffer = () => {
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const packet = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)

      const parsed = parseSSEPacket(packet)
      if (!parsed || !parsed.dataText) {
        separatorIndex = buffer.indexOf('\n\n')
        continue
      }

      if (parsed.dataText === '[DONE]') {
        emitDoneOnce()
        finishOnce()
        separatorIndex = buffer.indexOf('\n\n')
        continue
      }

      let payload: unknown = parsed.dataText
      try {
        payload = JSON.parse(parsed.dataText)
      } catch {
        payload = { raw: parsed.dataText }
      }

      const eventName =
        isRecord(payload) && typeof payload.event === 'string'
          ? payload.event
          : parsed.eventName

      callbacks.onEvent?.(eventName, payload)
      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  callbacks.onStart?.()

  const requestTask = wx.request({
    url: CHAT_GATEWAY_URL,
    method: 'POST',
    data: request,
    header: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 60000,
    enableChunked: true,
    success: () => {
      parseBuffer()
      if (!finished) {
        callbacks.onDone?.()
        finishOnce()
      }
    },
    fail: (error) => {
      if (finished) {
        return
      }
      const message = typeof error.errMsg === 'string' ? error.errMsg : '请求失败'
      callbacks.onError?.(message)
      finishOnce()
    },
  })

  requestTask.onChunkReceived((chunk) => {
    if (finished) {
      return
    }

    try {
      buffer += arrayBufferToString(chunk.data)
      parseBuffer()
    } catch (error) {
      const message = error instanceof Error ? error.message : '流式数据解析失败'
      callbacks.onError?.(message)
      finishOnce()
    }
  })

  return {
    abort: () => {
      requestTask.abort()
      finishOnce()
    },
  }
}

// ============================================================================
// 微信小程序存储适配器
// ============================================================================

const wechatStorage = {
  getItem: (name: string) => wx.getStorageSync(name) || null,
  setItem: (name: string, value: string) => wx.setStorageSync(name, value),
  removeItem: (name: string) => wx.removeStorageSync(name),
}

// ============================================================================
// Store Definition
// ============================================================================

interface ChatState {
  // ========== 状态 ==========
  /** 消息列表 */
  messages: UIMessage[]
  /** 当前会话 ID（通过 /ai/chat 的 GenUI 模式返回） */
  conversationId: string | null
  /** 当前状态：idle | submitted | streaming */
  status: ChatStatus
  /** 错误信息 */
  error: Error | null
  /** 当前正在流式输出的消息 ID */
  streamingMessageId: StreamingMessageId
  /** 用户位置（可选） */
  location: { lat: number; lng: number } | null
  
  // ========== Actions ==========
  /** 发送消息 */
  sendMessage: (text: string, contextOverrides?: ChatPromptContext) => void
  /** 停止生成 */
  stop: () => void
  /** 清空消息 */
  clearMessages: () => void
  /** 设置消息列表 */
  setMessages: (messages: UIMessage[]) => void
  /** 设置用户位置 */
  setLocation: (location: { lat: number; lng: number } | null) => void
  /** 添加 Widget 消息（用于 Dashboard、Share 等） */
  addWidgetMessage: (widgetType: WidgetPart['widgetType'], data: unknown) => string
  /** 发送结构化动作 */
  sendAction: (action: StructuredActionInput) => void
  /** 追加 Widget 操作结果到对话历史（让 AI 下次对话时感知用户的卡内操作） */
  appendActionResult: (actionType: string, params: Record<string, unknown>, success: boolean, summary: string) => void
  
  // ========== Internal ==========
  /** SSE 控制器（内部使用） */
  _controller: SSEController | null
  /** 设置控制器 */
  _setController: (controller: SSEController | null) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    immer((set, get) => ({
      // ========== 初始状态 ==========
      messages: [],
      conversationId: null,
      status: 'idle',
      error: null,
      streamingMessageId: null,
      location: null,
      _controller: null,

      // ========== Actions ==========
      
      /**
       * 发送消息
       * 类似 useChat 的 sendMessage
       */
      sendMessage: (text: string, contextOverrides?: ChatPromptContext) => {
        const normalizedText = text.trim()
        if (!normalizedText) {
          return
        }

        const state = get()
        const transientTurns = !hasAuthenticatedSession()
          ? buildTransientTurns(state.messages)
          : undefined
        
        // 如果正在请求中，先停止
        if (state.status !== 'idle') {
          state.stop()
        }
        
        // 1. 添加用户消息
        const userMessageId = generateId()
        const userMessage: UIMessage = {
          id: userMessageId,
          role: 'user',
          parts: [{ type: 'text', text: normalizedText }],
          createdAt: new Date(),
        }
        
        // 2. 创建 AI 消息占位
        const aiMessageId = generateId()
        const aiMessage: UIMessage = {
          id: aiMessageId,
          role: 'assistant',
          parts: [],
          createdAt: new Date(),
        }
        
        set((draft) => {
          draft.messages.push(userMessage)
          draft.messages.push(aiMessage)
          draft.status = 'submitted'
          draft.error = null
          draft.streamingMessageId = aiMessageId
          draft._controller = null
        })

        const chatRequest = buildChatGatewayTurnsRequest(
          state.conversationId,
          {
            type: 'text',
            text: normalizedText,
          },
          {
            locale: 'zh-CN',
            timezone: 'Asia/Shanghai',
            platformVersion: 'miniprogram-vnext',
            location: state.location,
            ...(transientTurns && transientTurns.length > 0 ? { transientTurns } : {}),
            ...(contextOverrides || {}),
          }
        )
        chatRequest.stream = true

        const fallbackConversationId = state.conversationId || `conv_${Date.now()}`
        let currentEnvelope: GenUITurnEnvelope | null = null
        let settled = false
        let eventQueue: Promise<void> = Promise.resolve()
        let controller: SSEController | null = null
        let controllerRegistered = false

        const isCurrentController = () => (
          controller !== null && (!controllerRegistered || get()._controller === controller)
        )

        const updateAssistantFromEnvelope = (envelope: GenUITurnEnvelope, status: ChatStatus) => {
          if (!isCurrentController()) {
            return
          }

          const assistantParts = buildAssistantPartsFromBlocks(envelope.turn.blocks)

          set((draft) => {
            const msgIndex = draft.messages.findIndex((message) => message.id === aiMessageId)
            if (msgIndex !== -1) {
              draft.messages[msgIndex].parts = assistantParts
              draft.messages[msgIndex].turnContext = envelope.turn.turnContext
              sanitizeAssistantMessage(draft.messages[msgIndex])
            }
            draft.conversationId = envelope.conversationId
            draft.status = status
            draft.error = null
          })
        }

        const ensureEnvelope = (): GenUITurnEnvelope => {
          if (currentEnvelope) {
            return currentEnvelope
          }

          currentEnvelope = {
            traceId: `trace_${Date.now()}`,
            conversationId: fallbackConversationId,
            turn: {
              turnId: `turn_${Date.now()}`,
              role: 'assistant',
              status: 'streaming',
              blocks: [],
            },
          }
          return currentEnvelope
        }

        const upsertBlock = (block: GenUIBlock, mode: 'append' | 'replace'): number => {
          const envelope = ensureEnvelope()
          const blocks = [...envelope.turn.blocks]
          let targetIndex = -1

          if (mode === 'replace') {
            targetIndex = blocks.findIndex((item) => item.blockId === block.blockId)
          }

          if (targetIndex >= 0) {
            blocks[targetIndex] = block
          } else {
            blocks.push(block)
            targetIndex = blocks.length - 1
          }

          currentEnvelope = {
            ...envelope,
            turn: {
              ...envelope.turn,
              blocks,
            },
          }
          updateAssistantFromEnvelope(currentEnvelope, 'streaming')
          return targetIndex
        }

        const typewriteTextBlock = async (block: GenUIBlock, mode: 'append' | 'replace') => {
          if (block.type !== 'text') {
            upsertBlock(block, mode)
            return
          }

          const fullText = block.content || ''
          const index = upsertBlock({ ...block, content: '' }, mode)
          if (!fullText) {
            return
          }

          for (let cursor = 1; cursor <= fullText.length; cursor += 1) {
            if (!isCurrentController()) {
              return
            }

            const envelope = ensureEnvelope()
            const blocks = [...envelope.turn.blocks]
            const currentBlock = blocks[index]
            if (!currentBlock || currentBlock.type !== 'text') {
              break
            }

            blocks[index] = {
              ...currentBlock,
              content: fullText.slice(0, cursor),
            }

            currentEnvelope = {
              ...envelope,
              turn: {
                ...envelope.turn,
                blocks,
              },
            }

            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            await delay(TYPEWRITER_INTERVAL_MS)
          }
        }

        const completeSuccess = () => {
          if (settled || !isCurrentController()) {
            return
          }
          settled = true

          set((draft) => {
            if (currentEnvelope) {
              const assistantParts = buildAssistantPartsFromBlocks(currentEnvelope.turn.blocks)
              const msgIndex = draft.messages.findIndex((message) => message.id === aiMessageId)
              if (msgIndex !== -1) {
                draft.messages[msgIndex].parts = assistantParts
                sanitizeAssistantMessage(draft.messages[msgIndex])
              }
              draft.conversationId = currentEnvelope.conversationId
            }

            draft.status = 'idle'
            draft.streamingMessageId = null
            draft.error = null
            if (draft._controller === controller) {
              draft._controller = null
            }
          })
        }

        const completeError = (errorMessage: string) => {
          if (settled || !isCurrentController()) {
            return
          }
          settled = true

          set((draft) => {
            draft.status = 'idle'
            draft.streamingMessageId = null
            draft.error = new Error(errorMessage)

            const msgIndex = draft.messages.findIndex((message) => message.id === aiMessageId)
            if (msgIndex !== -1) {
              draft.messages[msgIndex].parts = [
                {
                  type: 'widget',
                  widgetType: 'error',
                  data: {
                    message: '抱歉，这次没生成成功，试试再说一次～',
                    showRetry: true,
                    originalText: normalizedText,
                  },
                },
              ]
            }

            if (draft._controller === controller) {
              draft._controller = null
            }
          })
        }

        const processEvent = async (eventName: string, payload: unknown) => {
          if (!isCurrentController()) {
            return
          }

          if (eventName === 'trace') {
            return
          }

          if (eventName === 'turn-error') {
            const errorData = isRecord(payload) && isRecord(payload.data) ? payload.data : null
            const message =
              errorData && typeof errorData.message === 'string'
                ? errorData.message
                : '生成失败，请稍后再试'
            throw new Error(message)
          }

          if (eventName === 'turn-start') {
            const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
            const traceId = data && typeof data.traceId === 'string' ? data.traceId : `trace_${Date.now()}`
            const conversationId =
              data && typeof data.conversationId === 'string'
                ? data.conversationId
                : fallbackConversationId
            const turnId = data && typeof data.turnId === 'string' ? data.turnId : `turn_${Date.now()}`

            currentEnvelope = {
              traceId,
              conversationId,
              turn: {
                turnId,
                role: 'assistant',
                status: 'streaming',
                blocks: [],
              },
            }

            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            return
          }

          if (eventName === 'turn-status') {
            const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
            const status = data && typeof data.status === 'string' ? data.status : ''
            if (status !== 'streaming' && status !== 'completed' && status !== 'error') {
              return
            }

            const envelope = ensureEnvelope()
            currentEnvelope = {
              ...envelope,
              turn: {
                ...envelope.turn,
                status,
              },
            }
            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            return
          }

          if (eventName === 'turn-complete') {
            const data = isRecord(payload) ? payload.data : null
            if (!isGenUITurnEnvelope(data)) {
              return
            }

            currentEnvelope = data
            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            return
          }

          if (eventName === 'block-append' || eventName === 'block-replace') {
            const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
            const block = data ? data.block : null
            if (!isGenUIBlock(block)) {
              return
            }

            const mode = eventName === 'block-replace' ? 'replace' : 'append'
            await typewriteTextBlock(block, mode)
          }
        }

        controller = streamChatGatewayTurns(chatRequest, {
          onEvent: (eventName, payload) => {
            eventQueue = eventQueue
              .then(() => processEvent(eventName, payload))
              .catch((error) => {
                const message = error instanceof Error ? error.message : '流式处理失败'
                completeError(message)
              })
          },
          onDone: () => {
            void eventQueue
              .then(() => completeSuccess())
              .catch((error) => {
                const message = error instanceof Error ? error.message : '流式处理失败'
                completeError(message)
              })
          },
          onError: (message) => {
            void eventQueue.then(() => {
              completeError(message || '请求失败，请稍后再试')
            })
          },
          onFinish: () => {
            set((draft) => {
              if (draft._controller === controller) {
                draft._controller = null
              }
            })
          },
        })

        set((draft) => {
          draft._controller = controller
        })
        controllerRegistered = true
      },
      
      /**
       * 停止生成
       * 类似 useChat 的 stop
       */
      stop: () => {
        const state = get()
        state._controller?.abort()
        
        set((draft) => {
          draft.status = 'idle'
          draft.streamingMessageId = null
          draft._controller = null
        })
      },
      
      /**
       * 清空消息
       * 类似 useChat 的 setMessages([])
       */
      clearMessages: () => {
        const state = get()
        state.stop()
        
        set((draft) => {
          draft.messages = []
          draft.conversationId = null
          draft.error = null
        })
      },
      
      /**
       * 设置消息列表
       * 类似 useChat 的 setMessages
       */
      setMessages: (messages: UIMessage[]) => {
        set((draft) => {
          draft.messages = messages
        })
      },
      
      /**
       * 设置用户位置
       */
      setLocation: (location) => {
        set((draft) => {
          draft.location = location
        })
      },
      
      /**
       * 添加 Widget 消息（用于 Dashboard、Share 等本地生成的 Widget）
       * 返回消息 ID
       */
      addWidgetMessage: (widgetType, data) => {
        const id = generateId()
        const message: UIMessage = {
          id,
          role: 'assistant',
          parts: [{
            type: 'widget',
            widgetType,
            data,
          }],
          createdAt: new Date(),
        }
        
        set((draft) => {
          draft.messages.push(message)
        })
        
        return id
      },
      
      /**
       * 发送结构化动作
       * 跳过 LLM 意图识别，直接执行对应操作
       */
      sendAction: (action: StructuredActionInput) => {
        const state = get()
        const transientTurns = !hasAuthenticatedSession()
          ? buildTransientTurns(state.messages)
          : undefined
        
        // 如果正在请求中，先停止
        if (state.status !== 'idle') {
          state.stop()
        }
        
        // 1. 添加用户消息（显示 action 的原始文本或描述）
        const userMessageId = generateId()
        const displayText = action.originalText || `执行 ${action.action}`
        const userMessage: UIMessage = {
          id: userMessageId,
          role: 'user',
          parts: [{ type: 'text', text: displayText }],
          createdAt: new Date(),
        }
        
        // 2. 创建 AI 消息占位
        const aiMessageId = generateId()
        const aiMessage: UIMessage = {
          id: aiMessageId,
          role: 'assistant',
          parts: [],
          createdAt: new Date(),
        }
        
        set((draft) => {
          draft.messages.push(userMessage)
          draft.messages.push(aiMessage)
          draft.status = 'submitted'
          draft.error = null
          draft.streamingMessageId = aiMessageId
          draft._controller = null
        })

        const chatRequest = buildChatGatewayTurnsRequest(
          state.conversationId,
          {
            type: 'action',
            action: action.action,
            actionId: generateId(),
            params: action.payload,
            displayText,
          },
          {
            locale: 'zh-CN',
            timezone: 'Asia/Shanghai',
            platformVersion: 'miniprogram-vnext',
            location: state.location,
            ...(transientTurns && transientTurns.length > 0 ? { transientTurns } : {}),
          }
        )
        chatRequest.stream = true

        const fallbackConversationId = state.conversationId || `conv_${Date.now()}`
        let currentEnvelope: GenUITurnEnvelope | null = null
        let settled = false
        let eventQueue: Promise<void> = Promise.resolve()
        let controller: SSEController | null = null
        let controllerRegistered = false

        const isCurrentController = () => (
          controller !== null && (!controllerRegistered || get()._controller === controller)
        )

        const updateAssistantFromEnvelope = (envelope: GenUITurnEnvelope, status: ChatStatus) => {
          if (!isCurrentController()) {
            return
          }

          const assistantParts = buildAssistantPartsFromBlocks(envelope.turn.blocks)

          set((draft) => {
            const msgIndex = draft.messages.findIndex((message) => message.id === aiMessageId)
            if (msgIndex !== -1) {
              draft.messages[msgIndex].parts = assistantParts
              draft.messages[msgIndex].turnContext = envelope.turn.turnContext
              sanitizeAssistantMessage(draft.messages[msgIndex])
            }
            draft.conversationId = envelope.conversationId
            draft.status = status
            draft.error = null
          })
        }

        const ensureEnvelope = (): GenUITurnEnvelope => {
          if (currentEnvelope) {
            return currentEnvelope
          }

          currentEnvelope = {
            traceId: `trace_${Date.now()}`,
            conversationId: fallbackConversationId,
            turn: {
              turnId: `turn_${Date.now()}`,
              role: 'assistant',
              status: 'streaming',
              blocks: [],
            },
          }
          return currentEnvelope
        }

        const upsertBlock = (block: GenUIBlock, mode: 'append' | 'replace'): number => {
          const envelope = ensureEnvelope()
          const blocks = [...envelope.turn.blocks]
          let targetIndex = -1

          if (mode === 'replace') {
            targetIndex = blocks.findIndex((item) => item.blockId === block.blockId)
          }

          if (targetIndex >= 0) {
            blocks[targetIndex] = block
          } else {
            blocks.push(block)
            targetIndex = blocks.length - 1
          }

          currentEnvelope = {
            ...envelope,
            turn: {
              ...envelope.turn,
              blocks,
            },
          }
          updateAssistantFromEnvelope(currentEnvelope, 'streaming')
          return targetIndex
        }

        const typewriteTextBlock = async (block: GenUIBlock, mode: 'append' | 'replace') => {
          if (block.type !== 'text') {
            upsertBlock(block, mode)
            return
          }

          const fullText = block.content || ''
          const index = upsertBlock({ ...block, content: '' }, mode)
          if (!fullText) {
            return
          }

          for (let cursor = 1; cursor <= fullText.length; cursor += 1) {
            if (!isCurrentController()) {
              return
            }

            const envelope = ensureEnvelope()
            const blocks = [...envelope.turn.blocks]
            const currentBlock = blocks[index]
            if (!currentBlock || currentBlock.type !== 'text') {
              break
            }

            blocks[index] = {
              ...currentBlock,
              content: fullText.slice(0, cursor),
            }

            currentEnvelope = {
              ...envelope,
              turn: {
                ...envelope.turn,
                blocks,
              },
            }

            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            await delay(TYPEWRITER_INTERVAL_MS)
          }
        }

        const completeSuccess = () => {
          if (settled || !isCurrentController()) {
            return
          }
          settled = true

          set((draft) => {
            if (currentEnvelope) {
              const assistantParts = buildAssistantPartsFromBlocks(currentEnvelope.turn.blocks)
              const msgIndex = draft.messages.findIndex((message) => message.id === aiMessageId)
              if (msgIndex !== -1) {
                draft.messages[msgIndex].parts = assistantParts
                sanitizeAssistantMessage(draft.messages[msgIndex])
              }
              draft.conversationId = currentEnvelope.conversationId
            }

            draft.status = 'idle'
            draft.streamingMessageId = null
            draft.error = null
            if (draft._controller === controller) {
              draft._controller = null
            }
          })
        }

        const completeError = (errorMessage: string) => {
          if (settled || !isCurrentController()) {
            return
          }
          settled = true

          set((draft) => {
            draft.status = 'idle'
            draft.streamingMessageId = null
            draft.error = new Error(errorMessage)

            const msgIndex = draft.messages.findIndex((message) => message.id === aiMessageId)
            if (msgIndex !== -1) {
              draft.messages[msgIndex].parts = [
                {
                  type: 'widget',
                  widgetType: 'error',
                  data: {
                    message: errorMessage,
                    showRetry: true,
                    originalText: action.originalText,
                  },
                },
              ]
            }

            if (draft._controller === controller) {
              draft._controller = null
            }
          })
        }

        const processEvent = async (eventName: string, payload: unknown) => {
          if (!isCurrentController()) {
            return
          }

          if (eventName === 'trace') {
            return
          }

          if (eventName === 'turn-error') {
            const errorData = isRecord(payload) && isRecord(payload.data) ? payload.data : null
            const message =
              errorData && typeof errorData.message === 'string'
                ? errorData.message
                : '操作失败，请稍后再试'
            throw new Error(message)
          }

          if (eventName === 'turn-start') {
            const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
            const traceId = data && typeof data.traceId === 'string' ? data.traceId : `trace_${Date.now()}`
            const conversationId =
              data && typeof data.conversationId === 'string'
                ? data.conversationId
                : fallbackConversationId
            const turnId = data && typeof data.turnId === 'string' ? data.turnId : `turn_${Date.now()}`

            currentEnvelope = {
              traceId,
              conversationId,
              turn: {
                turnId,
                role: 'assistant',
                status: 'streaming',
                blocks: [],
              },
            }

            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            return
          }

          if (eventName === 'turn-status') {
            const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
            const status = data && typeof data.status === 'string' ? data.status : ''
            if (status !== 'streaming' && status !== 'completed' && status !== 'error') {
              return
            }

            const envelope = ensureEnvelope()
            currentEnvelope = {
              ...envelope,
              turn: {
                ...envelope.turn,
                status,
              },
            }
            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            return
          }

          if (eventName === 'turn-complete') {
            const data = isRecord(payload) ? payload.data : null
            if (!isGenUITurnEnvelope(data)) {
              return
            }

            currentEnvelope = data
            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            return
          }

          if (eventName === 'block-append' || eventName === 'block-replace') {
            const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
            const block = data ? data.block : null
            if (!isGenUIBlock(block)) {
              return
            }

            const mode = eventName === 'block-replace' ? 'replace' : 'append'
            await typewriteTextBlock(block, mode)
          }
        }

        controller = streamChatGatewayTurns(chatRequest, {
          onEvent: (eventName, payload) => {
            eventQueue = eventQueue
              .then(() => processEvent(eventName, payload))
              .catch((error) => {
                const message = error instanceof Error ? error.message : '流式处理失败'
                completeError(message)
              })
          },
          onDone: () => {
            void eventQueue
              .then(() => completeSuccess())
              .catch((error) => {
                const message = error instanceof Error ? error.message : '流式处理失败'
                completeError(message)
              })
          },
          onError: (message) => {
            void eventQueue.then(() => {
              completeError(message || '操作失败，请稍后再试')
            })
          },
          onFinish: () => {
            set((draft) => {
              if (draft._controller === controller) {
                draft._controller = null
              }
            })
          },
        })

        set((draft) => {
          draft._controller = controller
        })
        controllerRegistered = true
      },
      
      /**
       * 追加 Widget 操作结果到对话历史
       * 用于引用模式下的卡内操作（executeWidgetAction），让 AI 下次对话时知道用户做了什么
       */
      appendActionResult: (actionType, params, success, summary) => {
        const id = generateId()
        const message: UIMessage = {
          id,
          role: 'assistant',
          parts: [{
            type: 'text',
            text: `[用户操作] ${summary}`,
          }],
          createdAt: new Date(),
        }
        
        set((draft) => {
          draft.messages.push(message)
        })
      },
      
      // ========== Internal ==========
      _setController: (controller) => {
        set((draft) => {
          draft._controller = controller
        })
      },
    })),
    {
      name: 'chat-store',
      storage: createJSONStorage(() => wechatStorage),
      version: 2,
      migrate: () => ({}),
      // 匿名与登录聊天都只保留当前页内存，不做本地持久化恢复
      partialize: () => ({}),
    }
  )
)

// ============================================================================
// Selectors - 方便使用的选择器
// ============================================================================

/** 获取最后一条消息 */
export const selectLastMessage = (state: ChatState) => 
  state.messages.length > 0 ? state.messages[state.messages.length - 1] : null

/** 获取最后一条 AI 消息 */
export const selectLastAIMessage = (state: ChatState) => 
  [...state.messages].reverse().find(m => m.role === 'assistant') || null

/** 判断是否正在加载 */
export const selectIsLoading = (state: ChatState) => 
  state.status === 'submitted' || state.status === 'streaming'

/** 判断是否正在流式输出 */
export const selectIsStreaming = (state: ChatState) => 
  state.status === 'streaming'

export default useChatStore

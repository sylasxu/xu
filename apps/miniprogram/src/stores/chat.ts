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
import { createStore } from 'zustand/vanilla.js'
import { createJSONStorage, persist } from 'zustand/middleware.js'
import { immer } from 'zustand/middleware/immer.js'
import type { SSEController, UIMessagePart } from '../utils/sse-request'
import { API_CONFIG } from '../config/index'
import { useAppStore, type PendingActionAuthMode, type StructuredPendingAction } from './app'
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
  GenUISuggestions,
  GenUIResponseEnvelope,
} from '../gen/genui-contract'
import { buildDiscussionEntryUrl, type JoinFlowPayload } from '../utils/join-flow'

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
  widgetType: 'dashboard' | 'draft' | 'explore' | 'partner_search_results' | 'share' | 'ask_preference' | 'action_chips' | 'partner_intent_form' | 'draft_settings_form' | 'auth_required' | 'error'
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
  suggestions?: GenUISuggestions
  structuredAction?: (StructuredActionInput & { actionId?: string; displayText?: string })
  createdAt: Date
}

/** Chat 状态 - 与 useChat 一致 */
export type ChatStatus = 'idle' | 'submitted' | 'streaming'

/** 当前流式消息的 ID */
export type StreamingMessageId = string | null

type ChatPromptContext = Pick<GenUIRequestContext, 'activityId' | 'activityMode' | 'entry'>
type GenUIRecentMessage = NonNullable<GenUIRequestContext['recentMessages']>[number]
type LocalGenUIRecentMessage = GenUIRecentMessage & {
  action?: string
  actionId?: string
  params?: Record<string, unknown>
  source?: string
  displayText?: string
}

const MAX_TRANSIENT_RECENT_MESSAGES = 10

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

function shouldSuppressAssistantText(text: string): boolean {
  return CALL_LEAK_PATTERN.test(text.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTextPart(part: UIMessagePart | WidgetPart): part is UIMessagePart & { type: 'text'; text?: string } {
  return part.type === 'text'
}

function isGenUIResponseStatus(value: unknown): value is GenUIResponseEnvelope['response']['status'] {
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

function isGenUIResponseEnvelope(value: unknown): value is GenUIResponseEnvelope {
  if (!isRecord(value) || typeof value.traceId !== 'string' || typeof value.conversationId !== 'string') {
    return false
  }

  if (!isRecord(value.response)) {
    return false
  }

  return (
    typeof value.response.responseId === 'string' &&
    value.response.role === 'assistant' &&
    isGenUIResponseStatus(value.response.status) &&
    Array.isArray(value.response.blocks) &&
    value.response.blocks.every(isGenUIBlock)
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

function readMessagePrimaryBlockType(message: UIMessage): GenUIRecentMessage['primaryBlockType'] {
  const widget = getWidgetPart(message)
  if (!widget) {
    return getTextContent(message).trim() ? 'text' : null
  }

  switch (widget.widgetType) {
    case 'ask_preference':
      return 'choice'
    case 'explore':
    case 'partner_search_results':
      return 'list'
    case 'draft':
    case 'share':
      return 'entity-card'
    case 'partner_intent_form':
    case 'draft_settings_form':
      return 'form'
    case 'auth_required':
    case 'error':
      return 'alert'
    case 'dashboard':
    default:
      return getTextContent(message).trim() ? 'text' : null
  }
}

function extractMessageTextForRecentMessage(message: UIMessage): string {
  const text = getTextContent(message).trim()
  if (text) {
    return text
  }

  return readWidgetSummaryText(getWidgetPart(message))
}

function buildTransientRecentMessages(messages: UIMessage[]): LocalGenUIRecentMessage[] {
  return messages
    .slice(-MAX_TRANSIENT_RECENT_MESSAGES)
    .map((message): LocalGenUIRecentMessage | null => {
      const text = extractMessageTextForRecentMessage(message)
      if (!text) {
        return null
      }

      const primaryBlockType = readMessagePrimaryBlockType(message)
      return {
        messageId: message.id,
        role: message.role,
        text,
        ...(message.role === 'user' && message.structuredAction
          ? {
              action: message.structuredAction.action,
              ...(message.structuredAction.actionId ? { actionId: message.structuredAction.actionId } : {}),
              ...(message.structuredAction.payload ? { params: message.structuredAction.payload } : {}),
              ...(message.structuredAction.source ? { source: message.structuredAction.source } : {}),
              ...(message.structuredAction.displayText ? { displayText: message.structuredAction.displayText } : {}),
            }
          : {}),
        ...(primaryBlockType !== undefined ? { primaryBlockType } : {}),
        ...(message.role === 'assistant' && message.suggestions ? { suggestions: message.suggestions } : {}),
      }
    })
    .filter((turn): turn is LocalGenUIRecentMessage => Boolean(turn))
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
}

function inferChoiceQuestionType(block: GenUIChoiceBlock): 'location' | 'type' {
  const metaQuestionType = isRecord(block.meta) && typeof block.meta.choiceQuestionType === 'string'
    ? block.meta.choiceQuestionType
    : ''
  if (metaQuestionType === 'location' || metaQuestionType === 'type') {
    return metaQuestionType
  }

  const hasLocationParam = block.options.some((option) => {
    const params = option.params
    return isRecord(params) && (
      params.questionType === 'location'
      || typeof params.location === 'string'
      || typeof params.locationName === 'string'
    )
  })
  if (hasLocationParam) {
    return 'location'
  }

  return 'type'
}

function inferChoiceInputMode(block: GenUIChoiceBlock): 'none' | 'free-text-optional' {
  const metaInputMode = isRecord(block.meta) && typeof block.meta.choiceInputMode === 'string'
    ? block.meta.choiceInputMode
    : ''

  return metaInputMode === 'free-text-optional' ? 'free-text-optional' : 'none'
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

function toStringArrayValue(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit)
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

function readPendingActionAuthMode(value: unknown): PendingActionAuthMode | null {
  return value === 'login' || value === 'bind_phone' ? value : null
}

function readJoinFlowSource(value: unknown): JoinFlowPayload['source'] | undefined {
  switch (value) {
    case 'activity_detail':
    case 'half_screen_detail':
    case 'activity_explore':
    case 'widget_explore':
    case 'auth_sheet':
      return value
    default:
      return undefined
  }
}

function readStructuredPendingAction(value: unknown): StructuredPendingAction | null {
  if (!isRecord(value) || value.type !== 'structured_action' || typeof value.action !== 'string' || !isRecord(value.payload)) {
    return null
  }

  const authMode = readPendingActionAuthMode(value.authMode)

  return {
    type: 'structured_action',
    action: value.action,
    payload: value.payload,
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.originalText === 'string' ? { originalText: value.originalText } : {}),
    ...(authMode ? { authMode } : {}),
  }
}

function readDiscussionNavigationPayload(value: unknown): JoinFlowPayload | null {
  if (!isRecord(value) || typeof value.activityId !== 'string' || !value.activityId.trim()) {
    return null
  }

  return {
    activityId: value.activityId.trim(),
    ...(typeof value.title === 'string' && value.title.trim() ? { title: value.title.trim() } : {}),
    ...(typeof value.startAt === 'string' && value.startAt.trim() ? { startAt: value.startAt.trim() } : {}),
    ...(typeof value.locationName === 'string' && value.locationName.trim() ? { locationName: value.locationName.trim() } : {}),
    ...(readJoinFlowSource(value.source) ? { source: readJoinFlowSource(value.source) } : {}),
  }
}

function readCurrentRoute(): string {
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1]
  return typeof currentPage?.route === 'string' ? currentPage.route : ''
}

function isHomeRoute(route: string): boolean {
  return route === 'pages/chat/index' || route === '/pages/chat/index'
}

function isLoginRoute(route: string): boolean {
  return route === 'pages/login/login' || route === '/pages/login/login'
}

function applyCompletionEffectsFromBlocks(blocks: GenUIBlock[]): void {
  const currentRoute = readCurrentRoute()
  const onHomePage = isHomeRoute(currentRoute)

  for (const block of blocks) {
    if (block.type !== 'alert') {
      continue
    }

    const meta = isRecord(block.meta) ? block.meta : null
    const authRequiredMeta = isRecord(meta?.authRequired) ? meta.authRequired : null
    if (authRequiredMeta) {
      const pendingAction = readStructuredPendingAction(authRequiredMeta.pendingAction)
      const authMode = readPendingActionAuthMode(authRequiredMeta.mode)

      if (!onHomePage && pendingAction && authMode) {
        const appStore = useAppStore.getState()
        const resumableAction: StructuredPendingAction = {
          ...pendingAction,
          authMode,
        }

        if (authMode === 'login') {
          appStore.setPendingAction(resumableAction)
          if (!isLoginRoute(currentRoute)) {
            wx.navigateTo({ url: '/pages/login/login' })
          }
        } else {
          appStore.showAuthSheet(resumableAction)
        }
      }
      return
    }

    if (meta && meta.navigationIntent === 'open_discussion') {
      const payload = readDiscussionNavigationPayload(meta.navigationPayload)
      if (!payload) {
        return
      }

      if (!onHomePage && block.message.trim()) {
        wx.showToast({
          title: block.message.trim(),
          icon: 'success',
        })
      }

      setTimeout(() => {
        wx.navigateTo({
          url: buildDiscussionEntryUrl(payload),
        })
      }, onHomePage ? 320 : 900)
      return
    }

    if (meta && meta.navigationIntent === 'stay_on_detail') {
      const payload = readDiscussionNavigationPayload(meta.navigationPayload)

      if (!onHomePage && block.message.trim()) {
        wx.showToast({
          title: block.message.trim(),
          icon: 'none',
        })
      }

      if (payload) {
        const pages = getCurrentPages()
        const currentPage = pages[pages.length - 1] as WechatMiniprogram.Page.Instance<
          Record<string, unknown>,
          Record<string, unknown>
        > & {
          route?: string
          data?: { activityId?: string }
          loadActivityDetail?: (activityId: string) => void
        }

        if (
          currentPage?.route === 'subpackages/activity/detail/index' &&
          currentPage.data?.activityId === payload.activityId &&
          typeof currentPage.loadActivityDetail === 'function'
        ) {
          currentPage.loadActivityDetail(payload.activityId)
        }
      }

      return
    }

    if (meta && meta.navigationIntent === 'open_message_center') {
      const focusIntent = isRecord(meta.navigationPayload)
        ? {
            ...(typeof meta.navigationPayload.taskId === 'string' ? { taskId: meta.navigationPayload.taskId } : {}),
            ...(typeof meta.navigationPayload.matchId === 'string' ? { matchId: meta.navigationPayload.matchId } : {}),
          }
        : null

      if (focusIntent && !focusIntent.taskId && !focusIntent.matchId) {
        return
      }

      if (focusIntent) {
        useAppStore.getState().setMessageCenterFocus(focusIntent)
      }

      setTimeout(() => {
        wx.navigateTo({
          url: '/pages/message/index',
        })
      }, onHomePage ? 320 : 900)
      return
    }

    if (onHomePage || !block.message.trim()) {
      continue
    }

    if (block.level === 'success') {
      wx.showToast({
        title: block.message.trim(),
        icon: 'success',
      })
      return
    }

    if (block.level === 'warning' || block.level === 'error') {
      wx.showToast({
        title: block.message.trim(),
        icon: 'none',
      })
      return
    }
  }
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
  memoryHints: string[]
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
    memoryHints: toStringArrayValue(meta?.memoryHints, 2).length > 0
      ? toStringArrayValue(meta?.memoryHints, 2)
      : toStringArrayValue(explore?.memoryHints, 2),
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

function readListKind(block: GenUIListBlock): string {
  const meta = isRecord(block.meta) ? block.meta : null
  return typeof meta?.listKind === 'string' ? meta.listKind : ''
}

function readListPresentation(block: GenUIListBlock): 'compact-stack' | 'immersive-carousel' | 'partner-carousel' {
  const meta = isRecord(block.meta) ? block.meta : null
  const presentation = meta?.listPresentation

  if (
    presentation === 'compact-stack' ||
    presentation === 'immersive-carousel' ||
    presentation === 'partner-carousel'
  ) {
    return presentation
  }

  return 'compact-stack'
}

function readListShowHeader(block: GenUIListBlock): boolean {
  const meta = isRecord(block.meta) ? block.meta : null
  return meta?.listShowHeader !== false
}

function mapListToWidgetPart(block: GenUIListBlock): WidgetPart {
  const listKind = readListKind(block)
  const presentation = readListPresentation(block)
  const showHeader = readListShowHeader(block)
  if (listKind === 'partner_search_results') {
    // 从 block.meta 读取搜索摘要和全局动作
    const meta = isRecord(block.meta) ? block.meta : null
    const searchSummary = isRecord(meta?.searchSummary) ? meta.searchSummary as Record<string, unknown> : null
    const primaryAction = isRecord(meta?.primaryAction) ? meta.primaryAction as Record<string, unknown> : null
    const secondaryAction = isRecord(meta?.secondaryAction) ? meta.secondaryAction as Record<string, unknown> : null

    // 解析候选人列表
    const results = block.items
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item, index) => ({
        id: toStringValue(item.id, `partner_result_${index}`),
        partnerIntentId: toStringValue(item.partnerIntentId, toStringValue(item.id, `partner_result_${index}`)),
        candidateUserId: toStringValue(item.candidateUserId, ''),
        title: toStringValue(item.title, `搭子 ${index + 1}`),
        avatarUrl: toStringValue(item.avatarUrl, ''),
        type: toStringValue(item.type, '搭子'),
        locationName: toStringValue(item.locationName, '待沟通'),
        locationHint: toStringValue(item.locationHint, ''),
        timePreference: toStringValue(item.timePreference, ''),
        summary: toStringValue(item.summary, ''),
        matchReason: toStringValue(item.matchReason, ''),
        score: toNumberValue(item.score, 0),
        tags: Array.isArray(item.tags)
          ? item.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
          : [],
        actions: Array.isArray(item.actions)
          ? item.actions.filter((action): action is Record<string, unknown> => (
            isRecord(action) && typeof action.label === 'string' && typeof action.action === 'string'
          ))
          : [],
      }))

    return {
      type: 'widget',
      widgetType: 'partner_search_results',
      data: {
        title: block.title || '先看看这些搭子',
        subtitle: block.subtitle,
        presentation,
        showHeader,
        results,
        // 全局搜索摘要
        searchSummary: searchSummary ? {
          locationHint: toStringValue(searchSummary.locationHint, ''),
          timeHint: toStringValue(searchSummary.timeHint, ''),
          count: toNumberValue(searchSummary.count, results.length),
        } : undefined,
        // 全局动作（"帮我继续留意"和"再看看其他人"）
        primaryAction: primaryAction ? {
          label: toStringValue(primaryAction.label, '帮我继续留意'),
          action: toStringValue(primaryAction.action, 'opt_in_partner_pool'),
          ...(isRecord(primaryAction.params) ? { params: primaryAction.params } : {}),
        } : undefined,
        secondaryAction: secondaryAction ? {
          label: toStringValue(secondaryAction.label, '再看看其他人'),
          action: toStringValue(secondaryAction.action, 'search_partners'),
          ...(isRecord(secondaryAction.params) ? { params: secondaryAction.params } : {}),
        } : undefined,
      },
    }
  }

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
      presentation,
      showHeader,
      semanticQuery: exploreMeta.semanticQuery,
      memoryHints: exploreMeta.memoryHints,
      fetchConfig: exploreMeta.fetchConfig,
      interaction: exploreMeta.interaction,
      preview: exploreMeta.preview,
    },
  }
}

function mapCtaGroupToWidgetPart(block: GenUICtaGroupBlock): WidgetPart {
  return {
    type: 'widget',
    widgetType: 'action_chips',
    data: {
      items: block.items.map((item) => ({
        label: item.label,
        action: item.action,
        ...(isRecord(item.params) ? { params: item.params } : {}),
      })),
      disabled: false,
    },
  }
}

function mapFormToWidgetPart(block: GenUIFormBlock): WidgetPart {
  const initial = isRecord(block.initialValues) ? block.initialValues : {}
  const schema = isRecord(block.schema) ? block.schema : {}
  const formType = typeof schema.formType === 'string' ? schema.formType : ''
  const meta = isRecord(block.meta) ? block.meta : null
  const showHeader = meta?.formShowHeader !== false

  if (formType === 'partner_intent') {
    return {
      type: 'widget',
      widgetType: 'partner_intent_form',
      data: {
        title: typeof block.title === 'string' ? block.title : '找搭子偏好',
        schema,
        initialValues: initial,
        showHeader,
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
          inputMode: inferChoiceInputMode(block),
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
      const meta = isRecord(block.meta) ? block.meta : null
      const authRequiredMeta = isRecord(meta?.authRequired) ? meta.authRequired : null
      const pendingAction = authRequiredMeta ? readStructuredPendingAction(authRequiredMeta.pendingAction) : null
      const authMode = authRequiredMeta ? readPendingActionAuthMode(authRequiredMeta.mode) : null

      if (pendingAction && authMode) {
        parts.push({
          type: 'widget',
          widgetType: 'auth_required',
          data: {
            message: block.message,
            mode: authMode,
            pendingAction,
          },
        })
        continue
      }

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

type ChatRuntimeRequest = {
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
    activityMode?: 'review' | 'rebook' | 'kickoff'
    entry?: string
    recentMessages?: GenUIRequestContext['recentMessages']
  }
  trace?: boolean
  [key: string]: unknown
}

interface ChatRuntimeStreamCallbacks {
  onStart?: () => void
  onEvent?: (eventName: string, payload: unknown) => void
  onDone?: () => void
  onError?: (message: string) => void
  onFinish?: () => void
}

type RequestHeadersReceivedResult = {
  statusCode?: number
  header?: WechatMiniprogram.IAnyObject
}

type RequestTaskWithHeadersListener = WechatMiniprogram.RequestTask & {
  onHeadersReceived?: (callback: (result: RequestHeadersReceivedResult) => void) => void
}

const CHAT_RUNTIME_URL = `${API_CONFIG.BASE_URL}/ai/chat`
const TYPEWRITER_INTERVAL_MS = 60  // v5.5: 调慢打字机速度，提升可读性

function buildChatRuntimeRequest(
  conversationId: string | null,
  input: GenUIInput,
  context: {
    locale: string
    timezone: string
    platformVersion: string
    location?: { lat: number; lng: number } | null
    activityId?: string
    activityMode?: 'review' | 'rebook' | 'kickoff'
    entry?: string
    recentMessages?: GenUIRequestContext['recentMessages']
  }
): ChatRuntimeRequest {
  return {
    ...(conversationId ? { conversationId } : {}),
    input,
    trace: false,
    context: {
      client: 'miniprogram',
      locale: context.locale,
      timezone: context.timezone,
      platformVersion: context.platformVersion,
      ...(context.location ? { lat: context.location.lat, lng: context.location.lng } : {}),
      ...(context.activityId ? { activityId: context.activityId } : {}),
      ...(context.activityMode ? { activityMode: context.activityMode } : {}),
      ...(context.entry ? { entry: context.entry } : {}),
      ...(context.recentMessages && context.recentMessages.length > 0
        ? { recentMessages: context.recentMessages }
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

function readStreamEventData(payload: unknown): unknown {
  if (isRecord(payload) && payload.data !== undefined) {
    return payload.data
  }

  return payload
}

function normalizeChatErrorMessage(message: string): string {
  const normalized = message.trim()
  const lowerCased = normalized.toLowerCase()

  if (
    lowerCased.includes('free tier of the model has been exhausted')
    || (lowerCased.includes('use free tier only') && lowerCased.includes('management console'))
  ) {
    return 'AI 服务额度暂时用完了，请稍后再试。'
  }

  return normalized || '请求失败，请稍后再试'
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

function streamChatRuntimeResponse(
  request: ChatRuntimeRequest,
  callbacks: ChatRuntimeStreamCallbacks
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
    url: CHAT_RUNTIME_URL,
    method: 'POST',
    data: request,
    header: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 60000,
    enableChunked: true,
    success: () => {
      if (finished) {
        return
      }

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

  const requestTaskWithHeaders = requestTask as RequestTaskWithHeadersListener
  requestTaskWithHeaders.onHeadersReceived?.((result) => {
    if (finished) {
      return
    }

    const statusCode = typeof result.statusCode === 'number' ? result.statusCode : null
    if (statusCode !== null && (statusCode < 200 || statusCode >= 300)) {
      callbacks.onError?.(`请求失败（${statusCode}）`)
      finishOnce()
      requestTask.abort()
    }
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
  /** 当前输入框内容 */
  input: string
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
  /** 设置当前输入框内容 */
  setInput: (input: string) => void
  /** 提交当前输入框内容 */
  submitInput: (contextOverrides?: ChatPromptContext) => void
  /** 停止生成 */
  stop: () => void
  /** 重试上一轮用户输入 */
  retryLastTurn: () => void
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

export const useChatStore = createStore<ChatState>()(
  persist(
    immer((set, get) => {
      const streamAssistantResponse = (params: {
        aiMessageId: string
        chatRequest: ChatRuntimeRequest
        fallbackConversationId: string
        responseErrorFallbackMessage: string
        buildErrorWidgetData: (normalizedError: string) => WidgetPart['data']
      }) => {
        let currentEnvelope: GenUIResponseEnvelope | null = null
        let settled = false
        let eventQueue: Promise<void> = Promise.resolve()
        let controller: SSEController | null = null
        let controllerRegistered = false

        const isCurrentController = () => (
          controller !== null && (!controllerRegistered || get()._controller === controller)
        )

        const updateAssistantFromEnvelope = (envelope: GenUIResponseEnvelope, status: ChatStatus) => {
          if (!isCurrentController()) {
            return
          }

          const assistantParts = buildAssistantPartsFromBlocks(envelope.response.blocks)

          set((draft) => {
            const msgIndex = draft.messages.findIndex((message) => message.id === params.aiMessageId)
            if (msgIndex !== -1) {
              draft.messages[msgIndex].parts = assistantParts
              draft.messages[msgIndex].suggestions = envelope.response.suggestions
              sanitizeAssistantMessage(draft.messages[msgIndex])
            }
            draft.conversationId = envelope.conversationId
            draft.status = status
            draft.error = null
          })
        }

        const ensureEnvelope = (): GenUIResponseEnvelope => {
          if (currentEnvelope) {
            return currentEnvelope
          }

          currentEnvelope = {
            traceId: `trace_${Date.now()}`,
            conversationId: params.fallbackConversationId,
              response: {
              responseId: `response_${Date.now()}`,
              role: 'assistant',
              status: 'streaming',
              blocks: [],
            },
          }
          return currentEnvelope
        }

        const upsertStreamedBlock = (block: GenUIBlock, mode: 'append' | 'replace'): number => {
          const envelope = ensureEnvelope()
          const blocks = [...envelope.response.blocks]
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
            response: {
              ...envelope.response,
              blocks,
            },
          }
          updateAssistantFromEnvelope(currentEnvelope, 'streaming')
          return targetIndex
        }

        const streamTextBlockIntoEnvelope = async (block: GenUIBlock, mode: 'append' | 'replace') => {
          if (block.type !== 'text') {
            upsertStreamedBlock(block, mode)
            return
          }

          const fullText = block.content || ''
          if (!fullText) {
            // v5.5: 空内容不切换状态，保持 loading 直到有实际内容
            return
          }
          const index = upsertStreamedBlock({ ...block, content: '' }, mode)

          for (let cursor = 1; cursor <= fullText.length; cursor += 1) {
            if (!isCurrentController()) {
              return
            }

            const envelope = ensureEnvelope()
            const blocks = [...envelope.response.blocks]
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
              response: {
                ...envelope.response,
                blocks,
              },
            }

            // v5.5: 第一次有内容时立即切到 streaming，隐藏 loading，开始打字机
            const targetStatus = cursor === 1 ? 'streaming' : get().status
            updateAssistantFromEnvelope(currentEnvelope, targetStatus)
            await delay(TYPEWRITER_INTERVAL_MS)
          }
        }

        const finalizeSuccessfulResponse = () => {
          if (settled || !isCurrentController()) {
            return
          }
          settled = true

          set((draft) => {
            if (currentEnvelope) {
              const assistantParts = buildAssistantPartsFromBlocks(currentEnvelope.response.blocks)
              const msgIndex = draft.messages.findIndex((message) => message.id === params.aiMessageId)
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

          if (currentEnvelope) {
            applyCompletionEffectsFromBlocks(currentEnvelope.response.blocks)
          }
        }

        const finalizeFailedResponse = (errorMessage: string) => {
          if (settled || !isCurrentController()) {
            return
          }
          settled = true
          const normalizedError = normalizeChatErrorMessage(errorMessage)

          set((draft) => {
            draft.status = 'idle'
            draft.streamingMessageId = null
            draft.error = new Error(normalizedError)

            const msgIndex = draft.messages.findIndex((message) => message.id === params.aiMessageId)
            if (msgIndex !== -1) {
              draft.messages[msgIndex].parts = [
                {
                  type: 'widget',
                  widgetType: 'error',
                  data: params.buildErrorWidgetData(normalizedError),
                },
              ]
            }

            if (draft._controller === controller) {
              draft._controller = null
            }
          })
        }

        const consumeStreamEvent = async (eventName: string, payload: unknown) => {
          if (!isCurrentController()) {
            return
          }

          const eventData = readStreamEventData(payload)

          if (eventName === 'trace') {
            return
          }

          if (eventName === 'response-error') {
            const errorData = isRecord(eventData) ? eventData : null
            const message =
              errorData && typeof errorData.message === 'string'
                ? normalizeChatErrorMessage(errorData.message)
                : params.responseErrorFallbackMessage
            throw new Error(message)
          }

          if (eventName === 'response-start') {
            const data = isRecord(eventData) ? eventData : null
            const traceId = data && typeof data.traceId === 'string' ? data.traceId : `trace_${Date.now()}`
            const conversationId =
              data && typeof data.conversationId === 'string'
                ? data.conversationId
                : params.fallbackConversationId
            const responseId = data && typeof data.responseId === 'string' ? data.responseId : `response_${Date.now()}`

            currentEnvelope = {
              traceId,
              conversationId,
              response: {
                responseId,
                role: 'assistant',
                status: 'streaming',
                blocks: [],
              },
            }

            // v5.5: response-start 时保持 submitted 状态（显示 loading），等有内容再切到 streaming
            updateAssistantFromEnvelope(currentEnvelope, 'submitted')
            return
          }

          if (eventName === 'response-status') {
            const data = isRecord(eventData) ? eventData : null
            const status = data && typeof data.status === 'string' ? data.status : ''
            if (status !== 'streaming' && status !== 'completed' && status !== 'error') {
              return
            }

            const envelope = ensureEnvelope()
            currentEnvelope = {
              ...envelope,
              response: {
                ...envelope.response,
                status,
              },
            }
            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            return
          }

          if (eventName === 'response-complete') {
            if (!isGenUIResponseEnvelope(eventData)) {
              return
            }

            currentEnvelope = eventData
            updateAssistantFromEnvelope(currentEnvelope, 'streaming')
            return
          }

          if (eventName === 'block-append' || eventName === 'block-replace') {
            const data = isRecord(eventData) ? eventData : null
            const block = data ? data.block : null
            if (!isGenUIBlock(block)) {
              return
            }

            const mode = eventName === 'block-replace' ? 'replace' : 'append'
            await streamTextBlockIntoEnvelope(block, mode)
          }
        }

        controller = streamChatRuntimeResponse(params.chatRequest, {
          onEvent: (eventName, payload) => {
            eventQueue = eventQueue
              .then(() => consumeStreamEvent(eventName, payload))
              .catch((error) => {
                const message = normalizeChatErrorMessage(
                  error instanceof Error ? error.message : '流式处理失败'
                )
                finalizeFailedResponse(message)
              })
          },
          onDone: () => {
            void eventQueue
              .then(() => finalizeSuccessfulResponse())
              .catch((error) => {
                const message = normalizeChatErrorMessage(
                  error instanceof Error ? error.message : '流式处理失败'
                )
                finalizeFailedResponse(message)
              })
          },
          onError: (message) => {
            void eventQueue.then(() => {
              finalizeFailedResponse(
                normalizeChatErrorMessage(message || params.responseErrorFallbackMessage)
              )
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
      }

      return ({
      // ========== 初始状态 ==========
      messages: [],
      conversationId: null,
      input: '',
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
        const recentMessages = !hasAuthenticatedSession()
          ? buildTransientRecentMessages(state.messages)
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
          draft.input = ''
          draft.status = 'submitted'
          draft.error = null
          draft.streamingMessageId = aiMessageId
          draft._controller = null
        })

        const chatRequest = buildChatRuntimeRequest(
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
            ...(recentMessages && recentMessages.length > 0 ? { recentMessages } : {}),
            ...(contextOverrides || {}),
          }
        )
        streamAssistantResponse({
          aiMessageId,
          chatRequest,
          fallbackConversationId: state.conversationId || `conv_${Date.now()}`,
          responseErrorFallbackMessage: '生成失败，请稍后再试',
          buildErrorWidgetData: () => ({
            message: '抱歉，这次没生成成功，试试再说一次～',
            showRetry: true,
            originalText: normalizedText,
          }),
        })
      },

      /**
       * 设置当前输入框内容
       * 对齐 useChat 的 input / setInput 心智
       */
      setInput: (input) => {
        set((draft) => {
          draft.input = input
        })
      },

      /**
       * 提交当前输入框内容
       * 对齐 useChat 的 submit 能力
       */
      submitInput: (contextOverrides) => {
        const state = get()
        const text = state.input.trim()
        if (!text) {
          return
        }

        state.sendMessage(text, contextOverrides)
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
       * 重试上一轮用户输入
       * 不额外引入新状态机，只复用最近一条用户消息
       */
      retryLastTurn: () => {
        const state = get()
        const lastUserMessage = [...state.messages].reverse().find((message) => message.role === 'user')
        if (!lastUserMessage) {
          return
        }

        if (lastUserMessage.structuredAction) {
          state.sendAction({
            action: lastUserMessage.structuredAction.action,
            payload: lastUserMessage.structuredAction.payload,
            source: lastUserMessage.structuredAction.source,
            originalText:
              lastUserMessage.structuredAction.displayText || lastUserMessage.structuredAction.originalText,
          })
          return
        }

        const text = getTextContent(lastUserMessage).trim()
        if (text) {
          state.sendMessage(text)
        }
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
          draft.input = ''
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
        const recentMessages = !hasAuthenticatedSession()
          ? buildTransientRecentMessages(state.messages)
          : undefined
        
        // 如果正在请求中，先停止
        if (state.status !== 'idle') {
          state.stop()
        }
        
        // 1. 添加用户消息（显示 action 的原始文本或描述）
        const userMessageId = generateId()
        const displayText = action.originalText || `执行 ${action.action}`
        const actionId = generateId()
        const userMessage: UIMessage = {
          id: userMessageId,
          role: 'user',
          parts: [{ type: 'text', text: displayText }],
          structuredAction: {
            ...action,
            actionId,
            displayText,
          },
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
          draft.input = ''
          draft.status = 'submitted'
          draft.error = null
          draft.streamingMessageId = aiMessageId
          draft._controller = null
        })

        const chatRequest = buildChatRuntimeRequest(
          state.conversationId,
          {
            type: 'action',
            action: action.action,
            actionId,
            params: action.payload,
            displayText,
          },
          {
            locale: 'zh-CN',
            timezone: 'Asia/Shanghai',
            platformVersion: 'miniprogram-vnext',
            location: state.location,
            ...(action.source ? { entry: action.source } : {}),
            ...(recentMessages && recentMessages.length > 0 ? { recentMessages } : {}),
          }
        )
        streamAssistantResponse({
          aiMessageId,
          chatRequest,
          fallbackConversationId: state.conversationId || `conv_${Date.now()}`,
          responseErrorFallbackMessage: '操作失败，请稍后再试',
          buildErrorWidgetData: (normalizedError) => ({
            message: normalizedError,
            showRetry: true,
            originalText: action.originalText,
          }),
        })
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
      })
    }),
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

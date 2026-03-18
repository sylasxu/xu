import type { StructuredPendingAction } from '../stores/app'

export type JoinFlowSource =
  | 'activity_detail'
  | 'half_screen_detail'
  | 'activity_explore'
  | 'widget_explore'
  | 'auth_sheet'

export interface JoinFlowPayload {
  activityId: string
  title?: string
  startAt?: string
  locationName?: string
  source?: JoinFlowSource
}

export function buildJoinStructuredAction(payload: JoinFlowPayload): StructuredPendingAction {
  const source = payload.source || 'auth_sheet'

  return {
    type: 'structured_action',
    action: 'join_activity',
    payload: {
      activityId: payload.activityId,
      ...(payload.title ? { title: payload.title } : {}),
      ...(payload.startAt ? { startAt: payload.startAt } : {}),
      ...(payload.locationName ? { locationName: payload.locationName } : {}),
      source,
    },
    source,
    originalText: payload.title ? `报名「${payload.title}」` : '报名这个活动',
  }
}

function normalizeJoinTitle(title?: string): string {
  const normalized = typeof title === 'string' ? title.trim() : ''
  return normalized || '这场活动'
}

export function buildDiscussionEntryUrl(payload: JoinFlowPayload): string {
  const params = [
    `id=${encodeURIComponent(payload.activityId)}`,
    'entry=join_success',
  ]

  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  if (title) {
    params.push(`title=${encodeURIComponent(title)}`)
  }

  if (payload.source) {
    params.push(`source=${encodeURIComponent(payload.source)}`)
  }

  return `/subpackages/activity/discussion/index?${params.join('&')}`
}

export function getJoinQuickStarters(title?: string): string[] {
  const activityTitle = normalizeJoinTitle(title)

  return [
    `哈喽，我刚报名「${activityTitle}」，很高兴认识大家～`,
    `我是刚进来的，关于「${activityTitle}」大家一般几点到呀？`,
    `我会按时到，大家出发前也可以在群里说一声～`,
  ]
}

export function getJoinGuideTitle(title?: string): string {
  return `你已经加入「${normalizeJoinTitle(title)}」`
}

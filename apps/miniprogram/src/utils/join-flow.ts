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
    `哈喽，我刚加入「${activityTitle}」，先和大家打个招呼～`,
    `大家一般提前多久到？我想把时间安排稳一点。`,
    `集合点或到店方式有需要补充的吗？`,
    `如果还缺一个开场，我可以先帮大家确认一下安排。`,
  ]
}

export function getJoinGuideTitle(title?: string): string {
  return `你已经加入「${normalizeJoinTitle(title)}」`
}

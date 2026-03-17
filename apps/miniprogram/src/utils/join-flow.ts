import { postActivitiesByIdJoin } from '../api/endpoints/activities/activities'

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

export interface JoinActivityResult {
  success: boolean
  msg: string
}

export interface JoinSuccessOptions {
  delayMs?: number
  successMessage?: string
  onBeforeNavigate?: () => void
}

function readResponseMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  if ('msg' in value && typeof value.msg === 'string' && value.msg.trim()) {
    return value.msg.trim()
  }

  if ('message' in value && typeof value.message === 'string' && value.message.trim()) {
    return value.message.trim()
  }

  return null
}

function normalizeJoinTitle(title?: string): string {
  const normalized = typeof title === 'string' ? title.trim() : ''
  return normalized || '这场活动'
}

export async function requestJoinActivity(activityId: string): Promise<JoinActivityResult> {
  try {
    const response = await postActivitiesByIdJoin(activityId)

    if (response.status !== 200) {
      return {
        success: false,
        msg: readResponseMessage(response.data) || '报名失败，请重试',
      }
    }

    return {
      success: true,
      msg: '报名成功',
    }
  } catch (error) {
    return {
      success: false,
      msg: error instanceof Error ? error.message : '报名失败，请重试',
    }
  }
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

export function openDiscussionAfterJoin(payload: JoinFlowPayload, delayMs = 800) {
  const url = buildDiscussionEntryUrl(payload)

  setTimeout(() => {
    wx.navigateTo({ url })
  }, delayMs)
}

export function handleJoinSuccess(payload: JoinFlowPayload, options: JoinSuccessOptions = {}) {
  options.onBeforeNavigate?.()

  wx.showToast({
    title: options.successMessage || '报名成功',
    icon: 'success',
  })

  openDiscussionAfterJoin(payload, options.delayMs)
}

export async function submitJoinAndOpenDiscussion(
  payload: JoinFlowPayload,
  options: JoinSuccessOptions = {},
): Promise<JoinActivityResult> {
  const joinResult = await requestJoinActivity(payload.activityId)

  if (!joinResult.success) {
    return joinResult
  }

  handleJoinSuccess(payload, options)

  return joinResult
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
